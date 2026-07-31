/**
 * RecoveryGateFn — strongly-consistent, READ-ONLY recovery judgement
 * (design §10.11e, §15.2; TASK-093).
 *
 * The gate answers one question: if this idempotency key has to run again, how
 * much of it has to run again? It reads three tables with `ConsistentRead: true`
 * and returns facts. It changes nothing.
 *
 * Zero writes is a correctness property, not a preference:
 *  - `IdempotencyTable` state transitions belong to `InjectFn` (lease/recovery)
 *    and `WorkflowStatusFn` (the five fenced actions). FIX 2 keeps those owners
 *    distinct so a status can never be written from two places.
 *  - `RecoveryGateFnRole` has an explicit `Deny` on every DynamoDB write, on
 *    Bedrock, on `PostToConnection` and on S3 write (§18 / TASK-080). This module
 *    accepts read-only ports only, so a write is a compile error before it is
 *    ever an IAM denial.
 *
 * Strong consistency is likewise not optional. The gate decides whether
 * `DecisionFn` re-runs; an eventually-consistent read that missed a
 * just-committed core would send recovery down FULL_WORKFLOW and attempt to
 * rewrite an immutable DecisionCore. For the same reason the narrative read uses
 * the base table only, never an eventually-consistent GSI.
 *
 * @module backend/recovery/recovery_gate
 */

import type { NarrativeType } from '@city-commander/shared-schemas';
import type { IdempotencyReader } from '../repository/idempotency_repository.js';
import type { DecisionCoreReadPort } from '../repository/decision_core_reader.js';
import type { DecisionNarrativeReadPort } from '../repository/decision_narrative_reader.js';
import { splitNarrativeTypes } from '../repository/decision_narrative_reader.js';
import { ReaderUsageError } from '../repository/read_errors.js';

// ─── Recovery mode ─────────────────────────────────────────

/**
 * Recommended recovery scope (§15.2).
 *
 * - `FULL_WORKFLOW` — no core is committed, so `DecisionFn` must run again.
 * - `ENRICHMENT_ONLY` — a core is already committed; re-running `DecisionFn`
 *   would attempt to rewrite an immutable record. Only the missing narrative
 *   items are regenerated, and `fast_path_ready` is not re-emitted.
 *
 * Declared locally on purpose: `shared-schemas`' `RecoveryMode` currently holds
 * a different member set (`FIRST_RUN` / `STALE_RECOVERY` / `START_FAILED_RETRY`)
 * than design §10.11e requires (`NORMAL` / `FULL_WORKFLOW` / `ENRICHMENT_ONLY`).
 * Once that enum is corrected by its owner (TASK-003), this alias should be
 * replaced by the shared enum; the string values here already match the design,
 * so the migration is type-only.
 */
export type RecommendedRecoveryMode = 'FULL_WORKFLOW' | 'ENRICHMENT_ONLY';

export const RecommendedRecoveryMode = {
  FULL_WORKFLOW: 'FULL_WORKFLOW',
  ENRICHMENT_ONLY: 'ENRICHMENT_ONLY',
} as const satisfies Record<string, RecommendedRecoveryMode>;

// ─── Result ────────────────────────────────────────────────

/**
 * The gate's output (§10.11e).
 *
 * Consumed by:
 *  - `InjectFn` stale-running orchestration (TASK-092) and staged recovery
 *    (TASK-094) — via `recommended_recovery_mode` and the three fencing fields.
 *  - `WorkflowStatusFn(RECONCILE_STALE_RUNNING)` (TASK-091) — the fencing fields
 *    are its external fencing terms (FIX 3).
 *  - The Step Functions ENRICHMENT_ONLY branch (TASK-097) — `core_exists` and
 *    `missing_narrative_types`.
 */
export interface RecoveryGateResult {
  /** Key being judged. */
  readonly idempotency_key: string;
  /** Decision id used for the core / narrative reads. */
  readonly decision_id: string;

  /**
   * Whether the IdempotencyTable record itself exists.
   *
   * Not in the design's output list, but required for a total function: without
   * it, "no record" and "record with nothing committed" would be
   * indistinguishable, and TTL expiry would silently look like a fresh key.
   */
  readonly idempotency_record_exists: boolean;

  /** A DecisionCore row is present (strongly-consistent `GetItem`). */
  readonly core_exists: boolean;
  /** `IdempotencyTable.core_committed`, as written by `MARK_CORE_COMMITTED`. */
  readonly idempotency_core_committed: boolean;
  /**
   * `idempotency_core_committed OR core_exists`.
   *
   * The OR is deliberate: the checkpoint write can fail after the core has
   * already been committed. Trusting only the flag would rewrite the core;
   * trusting only the row would lose the checkpoint's evidence. Either witness
   * is sufficient to skip `DecisionFn`.
   */
  readonly effective_core_committed: boolean;

  /** Narrative types already committed, in required-set order. */
  readonly existing_narrative_types: readonly NarrativeType[];
  /** Narrative types still to generate, in required-set order. */
  readonly missing_narrative_types: readonly NarrativeType[];

  /** How much has to run again. */
  readonly recommended_recovery_mode: RecommendedRecoveryMode;

  /**
   * External fencing terms for `RECONCILE_STALE_RUNNING` (FIX 3).
   * `null` when no record exists or the field is unset.
   */
  readonly expected_stale_execution_arn: string | null;
  /** Attempt observed on the record; the reconcile fencing term. */
  readonly expected_attempt: number | null;
  /** Deadline observed on the record; the reconcile fencing term. */
  readonly observed_running_deadline_at: number | null;
}

// ─── Input ─────────────────────────────────────────────────

/** Arguments for {@link evaluateRecoveryGate}. */
export interface RecoveryGateInput {
  /** IdempotencyTable partition key. */
  readonly idempotencyKey: string;
  /**
   * Decision id from the workflow INPUT (§10.11e: INPUT always carries
   * `idempotency_key` and `decision_id`). Falls back to the value on the
   * IdempotencyTable record when omitted.
   */
  readonly decisionId?: string;
}

/** The three read-only ports the gate depends on. No writer is accepted. */
export interface RecoveryGatePorts {
  readonly idempotency: IdempotencyReader;
  readonly decisionCore: DecisionCoreReadPort;
  readonly decisionNarrative: DecisionNarrativeReadPort;
}

// ─── Implementation ────────────────────────────────────────

/** Result shape used when neither the record nor a decision id is available. */
function unresolvableResult(idempotencyKey: string): RecoveryGateResult {
  return {
    idempotency_key: idempotencyKey,
    decision_id: '',
    idempotency_record_exists: false,
    core_exists: false,
    idempotency_core_committed: false,
    effective_core_committed: false,
    existing_narrative_types: [],
    missing_narrative_types: [],
    // Nothing is committed and nothing is known: the only safe recommendation is
    // to run the whole workflow. The caller still decides what to do with it —
    // for the ENRICHMENT_ONLY branch, `core_exists=false` means
    // MARK_PROCESSING_FAILED with RECOVERY_CORE_MISSING (§15.2), not an enrich.
    recommended_recovery_mode: RecommendedRecoveryMode.FULL_WORKFLOW,
    expected_stale_execution_arn: null,
    expected_attempt: null,
    observed_running_deadline_at: null,
  };
}

/**
 * Evaluate the recovery gate. Performs three strongly-consistent reads and no
 * writes.
 *
 * @throws ReaderUsageError when the key is empty
 * @throws IdempotencyRepositoryError / TableReadError on a read failure —
 *         a fault is never reported as "absent", so a throttled read can never
 *         be mistaken for a missing core
 *
 * @example ENRICHMENT_ONLY branch (TASK-097)
 * ```ts
 * const gate = await evaluateRecoveryGate(ports, { idempotencyKey, decisionId });
 * if (!gate.core_exists) return markProcessingFailed('RECOVERY_CORE_MISSING');
 * await markCoreCommitted(EvidenceSource.RECOVERY_GATE_CORE_EXISTS);
 * await renderOnly(gate.missing_narrative_types);
 * ```
 */
export async function evaluateRecoveryGate(
  ports: RecoveryGatePorts,
  input: RecoveryGateInput,
): Promise<RecoveryGateResult> {
  const { idempotencyKey } = input;
  if (!idempotencyKey) {
    throw new ReaderUsageError('evaluateRecoveryGate requires a non-empty "idempotencyKey".');
  }

  // 1. IdempotencyTable — ConsistentRead. Read first: it supplies decision_id
  //    when the workflow INPUT did not, plus the three fencing terms.
  const record = await ports.idempotency.getConsistent(idempotencyKey);

  const decisionId = input.decisionId ?? record?.decision_id ?? '';
  if (!decisionId) {
    // No record and no decision id: nothing can be read, so report the facts
    // rather than guessing at a core that cannot be located.
    return unresolvableResult(idempotencyKey);
  }

  // 2 & 3. DecisionCoreTable GetItem + DecisionNarrativeTable Query, both
  //        ConsistentRead, base table only. Independent, so run them together.
  const [core, narratives] = await Promise.all([
    ports.decisionCore.getConsistent(decisionId),
    ports.decisionNarrative.queryConsistent(decisionId),
  ]);

  const coreExists = core !== null;
  const idempotencyCoreCommitted = record?.core_committed === true;
  const effectiveCoreCommitted = idempotencyCoreCommitted || coreExists;

  const { existing, missing } = splitNarrativeTypes(narratives);

  return {
    idempotency_key: idempotencyKey,
    decision_id: decisionId,
    idempotency_record_exists: record !== null,
    core_exists: coreExists,
    idempotency_core_committed: idempotencyCoreCommitted,
    effective_core_committed: effectiveCoreCommitted,
    existing_narrative_types: existing,
    missing_narrative_types: missing,
    recommended_recovery_mode: effectiveCoreCommitted
      ? RecommendedRecoveryMode.ENRICHMENT_ONLY
      : RecommendedRecoveryMode.FULL_WORKFLOW,
    expected_stale_execution_arn: record?.workflow_execution_arn ?? null,
    expected_attempt: record?.attempt_count ?? null,
    observed_running_deadline_at: record?.running_deadline_at ?? null,
  };
}

/**
 * Read-only recovery gate bound to a fixed set of ports.
 *
 * Convenience wrapper for the `RecoveryGateFn` handler, which builds its ports
 * once per container and evaluates per invocation.
 */
export class RecoveryGate {
  constructor(private readonly ports: RecoveryGatePorts) {}

  evaluate(input: RecoveryGateInput): Promise<RecoveryGateResult> {
    return evaluateRecoveryGate(this.ports, input);
  }
}
