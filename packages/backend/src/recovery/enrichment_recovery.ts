/**
 * ENRICHMENT_ONLY recovery (design §15.2 stage C, §10.11b; TASK-118).
 *
 * `RecoveryGateFn` (TASK-093) is read-only: it judges what is missing but
 * writes nothing. This module is the write side for the ENRICHMENT_ONLY
 * branch — it re-runs *only* the narrative composers named in
 * `gate.missing_narrative_types`, never `DecisionFn`, and never touches
 * `DecisionCore` or `IdempotencyTable`.
 *
 * Boundary (§9, docs/team-roles.md 成員 4 紅線):
 *  - Reads `DecisionCore` read-only (passed in already fetched by the caller —
 *    this module performs no additional core read or write).
 *  - The only writes are the composers' own conditional Puts to
 *    `DecisionNarrativeTable`, one item per `narrative_type` (TASK-116); a
 *    branch that already exists resolves to `branch_already_completed`, never
 *    an overwrite.
 *  - Never re-emits `decision.fast_path_ready` — that belongs to
 *    `MARK_CORE_COMMITTED` (TASK-102), which this module never calls.
 *  - After rendering, re-reads `DecisionNarrativeTable` (strongly consistent)
 *    rather than trusting composer outcomes alone, and emits
 *    `decision.enriched` (TASK-119) only if that read confirms all three
 *    items are now present — the same "never guess" posture as
 *    `RecoveryGateFn` itself.
 *
 * @module backend/recovery/enrichment_recovery
 */

import { NarrativeType, RecoveryMode, type DecisionCore } from '@city-commander/shared-schemas';
import {
  composeReport,
  composePublicAlert,
  composeExplanation,
  type NarrativeTableClient,
  type BedrockInvoker,
  type SopCitationResult,
} from '@city-commander/rag';
import type { RecoveryGateResult } from './recovery_gate.js';
import { splitNarrativeTypes, type DecisionNarrativeReadPort } from '../repository/decision_narrative_reader.js';
import {
  publishDecisionEnriched,
  isNarrativeSetComplete,
  type DecisionEnrichedPublishResult,
} from '../realtime/decision_enriched.js';
import type { ConnectionPublisherPort } from '../events/publish_fast_path_ready.js';
import type { Telemetry } from '../metrics/telemetry_facade.js';

// ─── Guard errors ──────────────────────────────────────────────────────────

/**
 * Thrown when the caller passes a gate result whose `core_exists` is false.
 *
 * Per `RecoveryGateFn`'s own documented contract, `core_exists=false` means
 * `RECOVERY_CORE_MISSING` → `FULL_WORKFLOW` (TASK-097) — a different code
 * path entirely. Enrichment recovery must never run against a missing core.
 */
export class EnrichmentRecoveryCoreMissingError extends Error {
  constructor(decisionId: string) {
    super(
      `enrichment recovery requires gate.core_exists=true; decision "${decisionId}" has no ` +
        `committed core (expected caller to route this to RECOVERY_CORE_MISSING instead).`,
    );
    this.name = 'EnrichmentRecoveryCoreMissingError';
  }
}

/** Thrown when the gate recommends `FULL_WORKFLOW` instead of `ENRICHMENT_ONLY`. */
export class EnrichmentRecoveryWrongModeError extends Error {
  constructor(mode: RecoveryGateResult['recommended_recovery_mode']) {
    super(
      `enrichment recovery requires gate.recommended_recovery_mode === 'ENRICHMENT_ONLY', got ` +
        `"${mode}". FULL_WORKFLOW re-runs DecisionFn, which this module never does.`,
    );
    this.name = 'EnrichmentRecoveryWrongModeError';
  }
}

// ─── Input / Output ────────────────────────────────────────────────────────

/** Per-branch outcome of a single composer invocation. */
export type NarrativeBranchOutcome = 'committed' | 'branch_already_completed' | 'failed';

export interface EnrichmentRecoveryInput {
  /** Read-only judgement from `evaluateRecoveryGate`; must be ENRICHMENT_ONLY with core_exists. */
  readonly gate: RecoveryGateResult;
  /** The already-committed DecisionCore for `gate.decision_id` (read-only). */
  readonly core: DecisionCore;
  /** SOP citations for `core`'s citation_article_set (REPORT + EXPLANATION prompts). */
  readonly citations: readonly SopCitationResult[];
  /** From config `multilingual.bonus_languages_enabled` (PUBLIC_ALERT only). */
  readonly bonusLanguagesEnabled: boolean;
  readonly narrativeClient: NarrativeTableClient;
  readonly narrativeReader: DecisionNarrativeReadPort;
  readonly bedrockInvoker: BedrockInvoker;
  readonly connectionPublisher: ConnectionPublisherPort;
  readonly traceId: string;
  readonly policyVersion: string;
  /**
   * Latency instrumentation (TASK-170), optional. Passed straight through to
   * `publishDecisionEnriched`, which rebuilds a `LatencyTrace` from
   * `core.occurred_at` — this recovery Lambda never had DecisionFn's
   * in-process trace to begin with, so there is nothing to thread but
   * `now`/`telemetry`.
   */
  readonly latency?: {
    readonly now: () => number;
    readonly telemetry?: Telemetry;
  };
}

export interface EnrichmentRecoveryResult {
  readonly decisionId: string;
  /** Outcome per narrative type that was actually re-rendered this call. */
  readonly renderedTypes: Readonly<Partial<Record<NarrativeType, NarrativeBranchOutcome>>>;
  /** Narrative types confirmed present after a fresh strongly-consistent read. */
  readonly existingNarrativeTypesAfter: readonly NarrativeType[];
  /** `true` iff `decision.enriched` was broadcast this call. */
  readonly enrichedEmitted: boolean;
  readonly enrichedPublishResult?: DecisionEnrichedPublishResult;
}

// ─── Main entry point ──────────────────────────────────────────────────────

/**
 * Re-render only the missing narrative branches for an ENRICHMENT_ONLY
 * recovery, then emit `decision.enriched` if — and only if — a fresh read
 * confirms all three are now present.
 *
 * Never calls `DecisionFn`, never writes `DecisionCore` or `IdempotencyTable`,
 * never re-emits `decision.fast_path_ready`.
 */
export async function recoverMissingNarratives(
  input: EnrichmentRecoveryInput,
): Promise<EnrichmentRecoveryResult> {
  const { gate } = input;

  if (!gate.core_exists) {
    throw new EnrichmentRecoveryCoreMissingError(gate.decision_id);
  }
  if (gate.recommended_recovery_mode !== RecoveryMode.ENRICHMENT_ONLY) {
    throw new EnrichmentRecoveryWrongModeError(gate.recommended_recovery_mode);
  }

  // Each missing branch writes its own (decision_id, narrative_type) item —
  // conditional Puts to disjoint keys never collide, so render concurrently
  // (matching the three-branch-concurrency guarantee TASK-116/120 already prove).
  const renderedEntries = await Promise.all(
    gate.missing_narrative_types.map(
      async (type): Promise<readonly [NarrativeType, NarrativeBranchOutcome]> => {
        const outcome = await renderNarrativeBranch(type, input);
        return [type, outcome] as const;
      },
    ),
  );
  const renderedTypes: Partial<Record<NarrativeType, NarrativeBranchOutcome>> = {};
  for (const [type, outcome] of renderedEntries) {
    renderedTypes[type] = outcome;
  }

  // Never trust composer outcomes alone for the enriched gate: re-read
  // DecisionNarrativeTable strongly-consistent, the same "never guess"
  // posture RecoveryGateFn itself uses.
  const narratives = await input.narrativeReader.queryConsistent(gate.decision_id);
  const { existing } = splitNarrativeTypes(narratives);

  let enrichedEmitted = false;
  let enrichedPublishResult: DecisionEnrichedPublishResult | undefined;

  if (isNarrativeSetComplete(existing)) {
    try {
      enrichedPublishResult = await publishDecisionEnriched(input.connectionPublisher, {
        existingNarrativeTypes: existing,
        decisionId: gate.decision_id,
        coreVersionRef: input.core.version,
        traceId: input.traceId,
        policyVersion: input.policyVersion,
        occurredAt: input.core.occurred_at,
        provisional: input.core.provisional,
        latency: input.latency,
      });
      enrichedEmitted = true;
    } catch {
      // Push failure must not fail recovery: narrative state is already
      // correct in DynamoDB; GET /decisions/{id} is the documented fallback.
      enrichedEmitted = false;
    }
  }

  return {
    decisionId: gate.decision_id,
    renderedTypes,
    existingNarrativeTypesAfter: existing,
    enrichedEmitted,
    enrichedPublishResult,
  };
}

// ─── Branch dispatch ───────────────────────────────────────────────────────

async function renderNarrativeBranch(
  type: NarrativeType,
  input: EnrichmentRecoveryInput,
): Promise<NarrativeBranchOutcome> {
  switch (type) {
    case NarrativeType.REPORT: {
      const result = await composeReport({
        core: input.core,
        citations: input.citations,
        narrativeClient: input.narrativeClient,
        bedrockInvoker: input.bedrockInvoker,
      });
      return result.outcome;
    }
    case NarrativeType.PUBLIC_ALERT: {
      const result = await composePublicAlert({
        core: input.core,
        bonusLanguagesEnabled: input.bonusLanguagesEnabled,
        narrativeClient: input.narrativeClient,
        bedrockInvoker: input.bedrockInvoker,
      });
      return result.outcome;
    }
    case NarrativeType.EXPLANATION: {
      const result = await composeExplanation({
        core: input.core,
        citations: input.citations,
        narrativeClient: input.narrativeClient,
        bedrockInvoker: input.bedrockInvoker,
      });
      return result.outcome;
    }
    default: {
      const _exhaustive: never = type;
      throw new Error(`Unsupported narrative_type: ${_exhaustive}`);
    }
  }
}
