/**
 * DecisionReadModel — four-source aggregation (design §10.11c, §12, FIX 1;
 * TASK-149).
 *
 * Merges, in one strongly-consistent pass:
 *
 *  1. `DecisionCoreTable` — the AUTHORITATIVE numbers. Every numeric/boolean
 *     value in the response comes from here and nowhere else (§9).
 *  2. `DecisionNarrativeTable` — the three LLM text items. Text only; absence is
 *     a normal Fast Path state, not an error.
 *  3. `PublishRecordTable` — mutable publish state + audit trail, kept physically
 *     separate from the immutable core (§10.11d).
 *  4. `IdempotencyTable` — a READ-ONLY `execution` projection
 *     (`status`/`last_error`/`retryable`/`attempt_count`), which is how the
 *     Dashboard surfaces a terminal `CORE_IDENTITY_CONFLICT` (FIX 1).
 *
 * The rule this module exists to enforce: **nothing is fabricated.** A missing
 * core is reported as `data_status=insufficient_data` with `core: null` and a
 * `200`, not as a plausible-looking empty decision and not as a 404 (§12, §21).
 * Missing narratives are reported as `partial` with the gap listed, so the UI can
 * show deterministic truth immediately and fill in AI text when it lands.
 *
 * @module backend/read_model/read_model_aggregator
 */

import { SCHEMA_VERSION } from '@city-commander/shared-schemas';
import type {
  DecisionCore,
  DecisionNarrative,
  NarrativeType,
  PublishRecord,
} from '@city-commander/shared-schemas';
import type { IdempotencyReader } from '../repository/idempotency_repository.js';
import type { DecisionCoreReadPort } from '../repository/decision_core_reader.js';
import type { DecisionNarrativeReadPort } from '../repository/decision_narrative_reader.js';
import { splitNarrativeTypes } from '../repository/decision_narrative_reader.js';
import type { PublishRecordReadPort } from '../repository/publish_record_reader.js';
import { ReaderUsageError } from '../repository/read_errors.js';
import { parseIdempotencyKey } from '../inject/idempotency_key.js';

/**
 * Readiness of the aggregated view.
 *
 * Mirrors the Fast Path / enrichment split, so the Dashboard can render
 * deterministic truth the moment it exists instead of waiting for Bedrock.
 */
export type ReadModelDataStatus =
  /** Core committed and all three narrative items present. */
  | 'ready'
  /** Core committed; some narrative text still pending (normal Fast Path state). */
  | 'partial'
  /** No committed core. Nothing authoritative to show — never fabricated. */
  | 'insufficient_data';

/** Read-only execution projection from IdempotencyTable (FIX 1). */
export interface ExecutionSummary {
  readonly status: string;
  readonly last_error: string | null;
  readonly retryable: boolean;
  readonly attempt_count: number;
}

/** The merged view returned by `GET /decisions/{decision_id}` (§10.11c). */
export interface DecisionReadModel {
  readonly schema_version: string;
  readonly trace_id: string;
  readonly decision_id: string;
  /** Whether the view is complete, partial, or has no authoritative core. */
  readonly data_status: ReadModelDataStatus;
  /** Authoritative numbers. `null` iff `data_status=insufficient_data`. */
  readonly core: DecisionCore | null;
  /** Narrative items present, in required-set order. */
  readonly narratives: readonly DecisionNarrative[];
  /** Narrative items still pending. Empty iff `data_status=ready`. */
  readonly missing_narrative_types: readonly NarrativeType[];
  /** `null` when the decision has not entered the publish flow. */
  readonly publish: PublishRecord | null;
  /** `null` when the idempotency record has expired or never existed. */
  readonly execution: ExecutionSummary | null;
  /**
   * Third segment of `idempotency_key`. Derived, never invented: `null` when the
   * core is absent or the key is malformed.
   */
  readonly policy_version: string | null;
  /** `true` when any provisional (Strategy A–F) policy shaped this decision. */
  readonly provisional: boolean;
  /** Official-source provenance for this decision (§10.0). */
  readonly source_manifest_hash: string | null;
}

/** The four read-only ports. No writer is accepted (§18 / TASK-081). */
export interface ReadModelPorts {
  readonly decisionCore: DecisionCoreReadPort;
  readonly decisionNarrative: DecisionNarrativeReadPort;
  readonly publishRecord: PublishRecordReadPort;
  /** Read-only IdempotencyTable access for the `execution` projection (FIX 1). */
  readonly idempotency: IdempotencyReader;
}

/** Arguments for {@link aggregateDecisionReadModel}. */
export interface ReadModelInput {
  readonly decisionId: string;
  /** Correlation id echoed into the response envelope (§12). */
  readonly traceId: string;
  /**
   * Idempotency key for the `execution` projection.
   *
   * Optional: the key is not derivable from `decision_id` (the derivation runs
   * the other way, TASK-086). When absent the view simply carries
   * `execution: null` rather than guessing a key.
   */
  readonly idempotencyKey?: string;
}

/** Project only the four read-only execution fields (§10.11c, FIX 1). */
function toExecutionSummary(record: {
  readonly status: string;
  readonly last_error: string | null;
  readonly retryable: boolean;
  readonly attempt_count: number;
}): ExecutionSummary {
  return {
    status: record.status,
    last_error: record.last_error,
    retryable: record.retryable,
    attempt_count: record.attempt_count,
  };
}

/**
 * Merge the four sources into one read model.
 *
 * @throws ReaderUsageError when the decision id or trace id is empty
 * @throws TableReadError / PublishRecordReadError / IdempotencyRepositoryError
 *         on a read failure — a fault is never downgraded to `insufficient_data`,
 *         because that would present a throttled read as "no decision exists"
 *
 * @example GET /decisions/{id}
 * ```ts
 * const model = await aggregateDecisionReadModel(ports, { decisionId, traceId });
 * return { statusCode: 200, body: JSON.stringify(model) }; // 200 even when insufficient
 * ```
 */
export async function aggregateDecisionReadModel(
  ports: ReadModelPorts,
  input: ReadModelInput,
): Promise<DecisionReadModel> {
  const { decisionId, traceId, idempotencyKey } = input;

  if (!decisionId) {
    throw new ReaderUsageError('aggregateDecisionReadModel requires a non-empty "decisionId".');
  }
  if (!traceId) {
    throw new ReaderUsageError('aggregateDecisionReadModel requires a non-empty "traceId".');
  }

  // Independent reads: issue them together rather than serially, since this sits
  // on the Dashboard's polling path.
  const [core, narratives, publish, idempotencyRecord] = await Promise.all([
    ports.decisionCore.getConsistent(decisionId),
    ports.decisionNarrative.queryConsistent(decisionId),
    ports.publishRecord.getConsistent(decisionId),
    idempotencyKey === undefined
      ? Promise.resolve(null)
      : ports.idempotency.getConsistent(idempotencyKey),
  ]);

  const { existing, missing } = splitNarrativeTypes(narratives);

  // Order matters: no core means nothing authoritative, regardless of how much
  // narrative text happens to exist.
  const dataStatus: ReadModelDataStatus =
    core === null ? 'insufficient_data' : missing.length === 0 ? 'ready' : 'partial';

  // Keep only the required-set items, in required-set order, so the response is
  // deterministic regardless of DynamoDB item order.
  const orderedNarratives = existing.flatMap((type) =>
    narratives.filter((narrative) => narrative.narrative_type === type),
  );

  return {
    schema_version: core?.schema_version ?? SCHEMA_VERSION,
    trace_id: traceId,
    decision_id: decisionId,
    data_status: dataStatus,
    core,
    narratives: orderedNarratives,
    missing_narrative_types: missing,
    publish,
    execution: idempotencyRecord === null ? null : toExecutionSummary(idempotencyRecord),
    policy_version:
      core === null ? null : (parseIdempotencyKey(core.idempotency_key)?.policyVersion ?? null),
    provisional: core?.provisional ?? false,
    source_manifest_hash: core?.source_manifest_hash ?? null,
  };
}

/** Read model bound to a fixed set of ports, for reuse across invocations. */
export class DecisionReadModelAggregator {
  constructor(private readonly ports: ReadModelPorts) {}

  aggregate(input: ReadModelInput): Promise<DecisionReadModel> {
    return aggregateDecisionReadModel(this.ports, input);
  }
}
