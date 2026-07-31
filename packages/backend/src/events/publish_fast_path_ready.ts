/**
 * `decision.fast_path_ready` WebSocket push (design §13, §16.3, §4.5; TASK-103).
 *
 * The Fast Path's user-visible moment: the deterministic decision is committed
 * and the Dashboard is told, without waiting for Bedrock.
 *
 * Three rules, each of which exists because of a specific failure mode:
 *
 *  1. **Gated on `MARK_CORE_COMMITTED`.** The caller must pass `APPLIED` or
 *     `ALREADY_APPLIED` from that checkpoint. A fenced-out execution must never
 *     announce a decision the current attempt has not committed, so the gate is a
 *     required argument rather than a convention.
 *  2. **`ready_event_id = decision_id|event_type|core_version_ref`.** API Gateway
 *     WebSocket delivery is at-least-once and the client may also be polling, so
 *     the payload carries its own dedup key and the Dashboard renders
 *     effectively-once (§13).
 *  3. **Push failure never fails the decision.** A dead connection or a throttled
 *     `PostToConnection` is not a decision failure — the core is already
 *     committed and `GET /decisions/{id}` is the authoritative fallback (§13,
 *     §16.4). Per-connection errors are collected and reported, not thrown.
 *
 * Transport is API Gateway WebSocket `PostToConnection`, not EventBridge: §13/§4.5
 * define the WebSocket channel, and only the Ws roles are granted
 * `PostToConnection` (§18 / TASK-083).
 *
 * @module backend/events/publish_fast_path_ready
 */

import type { DecisionCore } from '@city-commander/shared-schemas';
import type { LatencyTrace } from '../metrics/latency_trace.js';
import type { Telemetry } from '../metrics/telemetry_facade.js';

/** WebSocket event name (§13). */
export const FAST_PATH_READY_EVENT = 'decision.fast_path_ready' as const;

/** Separator for the dedup key, matching `DecisionNarrative.ready_event_id`. */
const READY_EVENT_ID_SEPARATOR = '|';

/**
 * Build the dedup key: `decision_id|event_type|core_version_ref`.
 *
 * `core_version_ref` is `DecisionCore.version`, so a re-decision of the same
 * event produces a distinct id and is not deduped away.
 */
export function buildReadyEventId(input: {
  readonly decisionId: string;
  readonly eventType: string;
  readonly coreVersionRef: number;
}): string {
  return [input.decisionId, input.eventType, String(input.coreVersionRef)].join(
    READY_EVENT_ID_SEPARATOR,
  );
}

/** Deterministic summary carried in the push (§13). All values from DecisionCore. */
export interface FastPathReadySummary {
  readonly triggered_articles: readonly number[];
  readonly applied_formula_articles: readonly number[];
  readonly primary_evacuation: string | null;
  readonly secondary_evacuation: readonly string[];
  readonly ete_minutes: number | null;
  readonly multilingual_required: boolean;
  /** Official CMS wording. LLM-prohibited (§10.11a). */
  readonly cms_core_text: string | null;
}

/** `decision.fast_path_ready` payload (§13). */
export interface FastPathReadyEvent {
  readonly type: typeof FAST_PATH_READY_EVENT;
  /** Client-side dedup key. */
  readonly ready_event_id: string;
  readonly decision_id: string;
  readonly trace_id: string;
  /** `DecisionCore.version`, the `core_version_ref` in `ready_event_id`. */
  readonly core_version_ref: number;
  /** Official-data provenance for this decision (§10.0). */
  readonly source_manifest_hash: string;
  /** Third segment of the idempotency key; `null` if not derivable. */
  readonly policy_version: string | null;
  /** `true` when a provisional Strategy shaped this decision. */
  readonly provisional: boolean;
  /** Event occurrence time from the official incident, verbatim. */
  readonly occurred_at: string;
  /** Deterministic summary. Never LLM text — narrative arrives later. */
  readonly summary: FastPathReadySummary;
}

/**
 * The `MARK_CORE_COMMITTED` outcomes that permit a push.
 *
 * `FENCED_STALE_EXECUTION` is absent on purpose: a fenced execution cannot reach
 * this function with a valid gate value.
 */
export type CoreCommittedGate = 'APPLIED' | 'ALREADY_APPLIED';

/** One connection's push result. */
export interface ConnectionDeliveryResult {
  readonly connectionId: string;
  readonly delivered: boolean;
  /** `true` when the connection is gone (HTTP 410) and should be pruned. */
  readonly stale: boolean;
  readonly error?: string;
}

/** Outcome of a broadcast. */
export interface FastPathReadyPublishResult {
  readonly event: FastPathReadyEvent;
  readonly delivered: number;
  /** Connections that returned 410 Gone; the caller may prune them. */
  readonly staleConnectionIds: readonly string[];
  readonly failures: readonly ConnectionDeliveryResult[];
}

/** WebSocket transport port. Implemented by the API Gateway Management client. */
export interface ConnectionPublisherPort {
  /** Live connection ids from the connections table (§4.5). */
  listConnectionIds(): Promise<readonly string[]>;
  /**
   * Send to one connection.
   *
   * @throws an error carrying `$metadata.httpStatusCode === 410` (or
   *         `name === 'GoneException'`) when the connection no longer exists
   */
  postToConnection(connectionId: string, payload: string): Promise<void>;
}

/** `true` when the failure means "this connection is gone" (HTTP 410). */
export function isStaleConnectionError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const name = (error as { name?: unknown }).name;
  if (name === 'GoneException') return true;
  const status = (error as { $metadata?: { httpStatusCode?: unknown } }).$metadata?.httpStatusCode;
  return status === 410;
}

/** Build the payload from the committed core. */
export function buildFastPathReadyEvent(input: {
  readonly core: DecisionCore;
  readonly traceId: string;
  readonly policyVersion: string | null;
}): FastPathReadyEvent {
  const { core, traceId, policyVersion } = input;

  return {
    type: FAST_PATH_READY_EVENT,
    ready_event_id: buildReadyEventId({
      decisionId: core.decision_id,
      eventType: FAST_PATH_READY_EVENT,
      coreVersionRef: core.version,
    }),
    decision_id: core.decision_id,
    trace_id: traceId,
    core_version_ref: core.version,
    source_manifest_hash: core.source_manifest_hash,
    policy_version: policyVersion,
    provisional: core.provisional,
    occurred_at: core.occurred_at,
    summary: {
      triggered_articles: core.triggered_articles,
      applied_formula_articles: core.applied_formula_articles,
      primary_evacuation: core.primary_evacuation,
      secondary_evacuation: core.secondary_evacuation,
      ete_minutes: core.ete?.ete_minutes ?? null,
      multilingual_required: core.multilingual_required,
      cms_core_text: core.cms_core_text,
    },
  };
}

/** The checkpoint gate was not satisfied, so no push may happen. */
export class FastPathGateNotSatisfiedError extends Error {
  constructor(public readonly gate: string) {
    super(
      `decision.fast_path_ready requires MARK_CORE_COMMITTED to have returned APPLIED or ` +
        `ALREADY_APPLIED, got "${gate}". A fenced execution must not announce a decision.`,
    );
    this.name = 'FastPathGateNotSatisfiedError';
  }
}

/**
 * Broadcast `decision.fast_path_ready` to every live connection.
 *
 * @param gate the `MARK_CORE_COMMITTED` result (TASK-102). Required.
 * @throws FastPathGateNotSatisfiedError when the gate is not a permitted value
 *
 * Delivery failures do NOT throw: the decision is already committed and polling
 * is the documented fallback. They are returned for the failure counters
 * (TASK-155) and the degraded-mode badge.
 */
export async function publishFastPathReady(
  publisher: ConnectionPublisherPort,
  input: {
    readonly core: DecisionCore;
    readonly traceId: string;
    readonly policyVersion: string | null;
    readonly coreCommittedGate: CoreCommittedGate;
    /**
     * Latency instrumentation (TASK-104/154). Optional, but this is the
     * AUTHORITATIVE point at which the Fast Path completes: the budget runs from
     * detection to this push, so a `fast_path_ms` measured earlier understates it
     * by the MARK_CORE_COMMITTED checkpoint plus the push itself.
     */
    readonly latency?: {
      readonly trace: LatencyTrace;
      readonly now: () => number;
      readonly telemetry?: Telemetry;
    };
  },
): Promise<FastPathReadyPublishResult> {
  if (input.coreCommittedGate !== 'APPLIED' && input.coreCommittedGate !== 'ALREADY_APPLIED') {
    throw new FastPathGateNotSatisfiedError(String(input.coreCommittedGate));
  }

  const event = buildFastPathReadyEvent(input);
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
    // Marked after the fan-out, and unconditionally: the Fast Path is complete
    // once the broadcast has been attempted. Gating this on `delivered > 0` would
    // silently drop the measurement whenever no dashboard happened to be
    // connected, which is exactly when latency data is least likely to be looked
    // at and most likely to be needed later.
    input.latency.trace.markFastPathReady(input.latency.now());
    input.latency.telemetry?.recordLatency(input.latency.trace.snapshot());
  }

  return {
    event,
    delivered: results.filter((result) => result.delivered).length,
    staleConnectionIds: results.filter((result) => result.stale).map((r) => r.connectionId),
    failures: results.filter((result) => !result.delivered),
  };
}
