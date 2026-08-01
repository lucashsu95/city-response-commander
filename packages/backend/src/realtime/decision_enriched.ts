/**
 * `decision.enriched` WebSocket push (design §13, §10.11b; TASK-119).
 *
 * Fires once — and only once — the three narrative branches (REPORT,
 * PUBLIC_ALERT, EXPLANATION) are all `committed` or `branch_already_completed`.
 * This is also EXPLANATION's readiness signal: there is no separate
 * `explanation.ready` event (see `packages/rag/src/explanation_composer.ts`
 * and `packages/rag/src/narrative_writer.ts`'s NarrativeType→event_type map,
 * which already points EXPLANATION at `decision.enriched`).
 *
 * Three rules, mirroring `decision.fast_path_ready` (TASK-103):
 *
 *  1. **Gated on completeness.** `publishDecisionEnriched` refuses to build a
 *     payload while any of the three narrative types is still missing —
 *     `NarrativeSetNotCompleteError` is thrown rather than emitting early.
 *  2. **`ready_event_id` reuses the EXPLANATION composer's own dedup key**
 *     (`decision_id|decision.enriched|core_version_ref`, from
 *     `@city-commander/rag`'s `buildReadyEventId`), so the DynamoDB item and
 *     the WebSocket push carry the identical id — never a second, parallel
 *     id-builder for the same key.
 *  3. **Push failure never fails the caller.** The narrative items are already
 *     persisted; `GET /decisions/{id}` is the documented polling fallback
 *     (§13, §16.4). Only the completeness precondition throws — delivery
 *     failures are collected and returned.
 *
 * Completeness uses `REQUIRED_NARRATIVE_TYPES` from
 * `../repository/decision_narrative_reader.js` — the single source of truth
 * already defined there (and explicitly annotated for this task) — rather
 * than a second, parallel copy of the same three-element list.
 *
 * @module backend/realtime/decision_enriched
 */

import { NarrativeType, SCHEMA_VERSION, type DecisionEnrichedEvent } from '@city-commander/shared-schemas';
import { buildReadyEventId } from '@city-commander/rag';
import { REQUIRED_NARRATIVE_TYPES } from '../repository/decision_narrative_reader.js';
import { LatencyTrace } from '../metrics/latency_trace.js';
import type { Telemetry } from '../metrics/telemetry_facade.js';
import {
  isStaleConnectionError,
  type ConnectionPublisherPort,
  type ConnectionDeliveryResult,
} from '../events/publish_fast_path_ready.js';

// ─── Completeness ──────────────────────────────────────────────────────────

/** `true` once every required narrative type is present, regardless of order. */
export function isNarrativeSetComplete(existingTypes: readonly NarrativeType[]): boolean {
  const present = new Set(existingTypes);
  return REQUIRED_NARRATIVE_TYPES.every((type) => present.has(type));
}

/** The narrative types still missing from the required set, in stable order. */
export function missingNarrativeTypes(existingTypes: readonly NarrativeType[]): readonly NarrativeType[] {
  const present = new Set(existingTypes);
  return REQUIRED_NARRATIVE_TYPES.filter((type) => !present.has(type));
}

/** Thrown when a caller attempts to publish before all three items exist. */
export class NarrativeSetNotCompleteError extends Error {
  constructor(public readonly missing: readonly NarrativeType[]) {
    super(
      `decision.enriched requires REPORT + PUBLIC_ALERT + EXPLANATION to be committed or ` +
        `branch_already_completed; missing: ${missing.join(', ') || '(none reported)'}.`,
    );
    this.name = 'NarrativeSetNotCompleteError';
  }
}

// ─── Event payload ─────────────────────────────────────────────────────────

/** Inputs needed to build the `decision.enriched` payload. */
export interface DecisionEnrichedInput {
  readonly decisionId: string;
  /** `DecisionCore.version`; the `core_version_ref` folded into `ready_event_id`. */
  readonly coreVersionRef: number;
  readonly traceId: string;
  readonly policyVersion: string;
  /** `DecisionCore.occurred_at`, verbatim (deterministic fact, not LLM text). */
  readonly occurredAt: string;
  /** `DecisionCore.provisional`. */
  readonly provisional: boolean;
}

/**
 * Build the `decision.enriched` payload.
 *
 * `ready_event_id` is computed via the same `buildReadyEventId` the
 * EXPLANATION composer uses for its own dedup key, so both are byte-identical
 * for the same `(decisionId, coreVersionRef)` pair.
 */
export function buildDecisionEnrichedEvent(input: DecisionEnrichedInput): DecisionEnrichedEvent {
  return {
    event_type: 'decision.enriched',
    schema_version: SCHEMA_VERSION,
    trace_id: input.traceId,
    occurred_at: input.occurredAt,
    provisional: input.provisional,
    policy_version: input.policyVersion,
    decision_id: input.decisionId,
    ready_event_id: buildReadyEventId(input.decisionId, NarrativeType.EXPLANATION, input.coreVersionRef),
  };
}

// ─── Publish result ────────────────────────────────────────────────────────

/** Outcome of a `decision.enriched` broadcast. */
export interface DecisionEnrichedPublishResult {
  readonly event: DecisionEnrichedEvent;
  readonly delivered: number;
  /** Connections that returned 410 Gone; the caller may prune them. */
  readonly staleConnectionIds: readonly string[];
  readonly failures: readonly ConnectionDeliveryResult[];
}

// ─── Main emitter ──────────────────────────────────────────────────────────

/**
 * Broadcast `decision.enriched` to every live connection.
 *
 * @param existingNarrativeTypes - the narrative types currently on record for
 *   this decision (from a strongly-consistent read); need not be in any
 *   particular order.
 * @throws NarrativeSetNotCompleteError when any of REPORT / PUBLIC_ALERT /
 *   EXPLANATION is still missing — this function never emits an early signal.
 *
 * Delivery failures do NOT throw: the three narrative items are already
 * persisted, and polling (`GET /decisions/{id}`) is the documented fallback.
 */
export async function publishDecisionEnriched(
  publisher: ConnectionPublisherPort,
  input: DecisionEnrichedInput & {
    readonly existingNarrativeTypes: readonly NarrativeType[];
    /**
     * Latency instrumentation (TASK-104/119/154/170), optional. Unlike
     * `publishFastPathReady`, this takes `now`/`telemetry` rather than an
     * already-built `LatencyTrace`: this push runs in a Lambda invocation
     * (recovery, or the eventual enrichment publisher) separate from the one
     * that ran `DecisionFn`, so there is no in-process trace instance to
     * reuse. `occurredAt` (= `DecisionCore.occurred_at`) is carried in every
     * caller's input already and is the same origin the official 60s budget
     * is measured from, so a fresh trace is rebuilt from it here — that
     * works across Lambda boundaries where a live object reference would not.
     */
    readonly latency?: {
      readonly now: () => number;
      readonly telemetry?: Telemetry;
    };
  },
): Promise<DecisionEnrichedPublishResult> {
  const missing = missingNarrativeTypes(input.existingNarrativeTypes);
  if (missing.length > 0) {
    throw new NarrativeSetNotCompleteError(missing);
  }

  const event = buildDecisionEnrichedEvent(input);
  const payload = JSON.stringify(event);

  const connectionIds = await publisher.listConnectionIds();

  const results = await Promise.all(
    connectionIds.map(async (connectionId): Promise<ConnectionDeliveryResult> => {
      try {
        await publisher.postToConnection(connectionId, payload);
        return { connectionId, delivered: true, stale: false };
      } catch (error: unknown) {
        return {
          connectionId,
          delivered: false,
          stale: isStaleConnectionError(error),
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );

  if (input.latency !== undefined) {
    // Marked after the fan-out, and unconditionally: enrichment is complete
    // once the broadcast has been attempted. Gating this on `delivered > 0`
    // would silently drop the measurement whenever no dashboard happened to
    // be connected — exactly when the data is least likely to be looked at
    // and most likely to be needed later (mirrors `publishFastPathReady`).
    //
    // A malformed `occurredAt` must not fail an otherwise-successful push —
    // the narrative items and the broadcast above are already done — so the
    // trace is built defensively rather than let LatencyTrace's constructor
    // throw out of this function.
    const startedAtMs = Date.parse(input.occurredAt);
    if (Number.isFinite(startedAtMs)) {
      try {
        const trace = new LatencyTrace({
          decisionId: input.decisionId,
          traceId: input.traceId,
          startedAtMs,
        });
        trace.markEnriched(input.latency.now());
        input.latency.telemetry?.recordLatency(trace);
      } catch {
        // Instrumentation must never fail a decision that is otherwise done.
      }
    }
  }

  return {
    event,
    delivered: results.filter((r) => r.delivered).length,
    staleConnectionIds: results.filter((r) => r.stale).map((r) => r.connectionId),
    failures: results.filter((r) => !r.delivered),
  };
}
