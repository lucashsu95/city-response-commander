/**
 * applyOrConfirm — shared idempotent semantics for every fenced status action
 * (design §10.11e, §15.2; TASK-095).
 *
 * Every `WorkflowStatusFn` action is a guarded conditional update. A failed
 * guard is ambiguous on its own: it may mean "my own update already landed but
 * the Lambda response was lost" (safe, keep going) or "a newer execution/attempt
 * now owns this key" (this execution is stale and must stop). Retrying blindly
 * on the first case would be wasteful; continuing on the second would push a
 * duplicate `decision.fast_path_ready`, run duplicate enrichment, and re-emit a
 * public alert.
 *
 * This module resolves that ambiguity once, for all five actions:
 *
 *   1. attempt the conditional update
 *      → success ................................. APPLIED
 *   2. `ConditionalCheckFailedException`
 *      → re-read with `ConsistentRead: true`
 *        → same execution + same attempt, target reached ... ALREADY_APPLIED
 *        → anything else .......................... FENCED_STALE_EXECUTION
 *
 * `FENCED_STALE_EXECUTION` means the caller terminates immediately: no table
 * write, no `fast_path_ready`, no enrichment, no public alert (§15.2).
 *
 * Two things this module deliberately does NOT do:
 *  - It never treats a non-conditional failure (throttling, access denied,
 *    network) as fencing. Those propagate as {@link IdempotencyRepositoryError}
 *    so a transient fault can never be mistaken for a stale execution.
 *  - It never writes anything itself beyond the single conditional update it was
 *    asked to attempt. The confirm step is a read.
 *
 * Execution fencing identity (§10.11e):
 *  - The four in-workflow actions (`MARK_RUNNING`, `MARK_CORE_COMMITTED`,
 *    `MARK_COMPLETED`, `MARK_PROCESSING_FAILED`) fence on the action's own
 *    `$$.Execution.Id` and `input.attempt_count`.
 *  - `RECONCILE_STALE_RUNNING` is invoked by `InjectFn` from OUTSIDE the stale
 *    execution, so it fences on `expected_stale_execution_arn` and
 *    `expected_attempt` — never on the reconciler's own execution id (FIX 3).
 *
 * @module backend/workflow/apply_or_confirm
 */

import { StatusActionResult } from '@city-commander/shared-schemas';
import type { IdempotencyRecord } from '@city-commander/shared-schemas';
import {
  IdempotencyConditionFailedError,
  IdempotencyUsageError,
} from '../repository/idempotency_repository.js';
import type {
  ConditionalUpdateStateInput,
  IdempotencyGuard,
  IdempotencyMutation,
} from '../repository/idempotency_repository.js';

// ─── Actions ───────────────────────────────────────────────

/**
 * The five `WorkflowStatusFn` actions (§10.11e).
 *
 * Carried through for structured logging and error messages only — it never
 * changes the classification logic.
 */
export type WorkflowStatusAction =
  | 'MARK_RUNNING'
  | 'MARK_CORE_COMMITTED'
  | 'MARK_COMPLETED'
  | 'MARK_PROCESSING_FAILED'
  | 'RECONCILE_STALE_RUNNING';

// ─── Fencing identity ──────────────────────────────────────

/**
 * The (execution, attempt) pair a transition is allowed to act on.
 *
 * @example in-workflow action (TASK-089/090/102)
 * ```ts
 * { executionArn: event.executionId /* $$.Execution.Id *\/, attemptCount: input.attempt_count }
 * ```
 *
 * @example RECONCILE_STALE_RUNNING (TASK-091, FIX 3)
 * ```ts
 * { executionArn: input.expected_stale_execution_arn, attemptCount: input.expected_attempt }
 * ```
 */
export interface ExecutionFencing {
  /**
   * `$$.Execution.Id` for in-workflow actions;
   * `expected_stale_execution_arn` for `RECONCILE_STALE_RUNNING`.
   */
  readonly executionArn: string;
  /**
   * `input.attempt_count` for in-workflow actions;
   * `expected_attempt` for `RECONCILE_STALE_RUNNING`.
   */
  readonly attemptCount: number;
}

// ─── Outcome ───────────────────────────────────────────────

/** Why a transition was classified as fenced. Diagnostic detail for logging. */
export type FencedReason =
  /** The record is gone (TTL expiry / never created). Fail-closed. */
  | 'RECORD_MISSING'
  /** `workflow_execution_arn` belongs to a different execution. */
  | 'DIFFERENT_EXECUTION'
  /** Same execution, but a newer `attempt_count` owns the key. */
  | 'DIFFERENT_ATTEMPT'
  /**
   * The record is ours, yet the target state was not reached — some other part
   * of the guard failed. Not literally "stale", but reporting success would let
   * the workflow proceed on an unverified transition, so it is fenced.
   */
  | 'TARGET_NOT_REACHED';

/** The update was applied by this call. */
export interface AppliedOutcome {
  readonly result: StatusActionResult.APPLIED;
  /** Record after the transition (`ReturnValues: ALL_NEW`). */
  readonly record: IdempotencyRecord;
}

/**
 * The guard failed, but a strongly-consistent re-read proves this execution and
 * attempt already reached the target — a lost response, not a conflict. The
 * workflow continues.
 */
export interface AlreadyAppliedOutcome {
  readonly result: StatusActionResult.ALREADY_APPLIED;
  /** Record as confirmed by the `ConsistentRead` re-read. */
  readonly record: IdempotencyRecord;
}

/**
 * This execution has been fenced out. The caller terminates immediately with no
 * side effects: no table write, no `fast_path_ready`, no enrichment, no alert.
 */
export interface FencedOutcome {
  readonly result: StatusActionResult.FENCED_STALE_EXECUTION;
  /** Record observed during the re-read; `null` when it no longer exists. */
  readonly record: IdempotencyRecord | null;
  readonly reason: FencedReason;
  /** Human-readable detail for the structured log / security signal. */
  readonly detail: string;
}

/** Result of {@link applyOrConfirm}. */
export type ApplyOrConfirmOutcome = AppliedOutcome | AlreadyAppliedOutcome | FencedOutcome;

/**
 * Narrows to the two outcomes where the workflow may proceed.
 *
 * `APPLIED` and `ALREADY_APPLIED` are both success (§10.11e); only
 * `FENCED_STALE_EXECUTION` stops the execution.
 */
export function mayProceed(
  outcome: ApplyOrConfirmOutcome,
): outcome is AppliedOutcome | AlreadyAppliedOutcome {
  return outcome.result !== StatusActionResult.FENCED_STALE_EXECUTION;
}

/** Narrows to the fenced outcome. */
export function isFenced(outcome: ApplyOrConfirmOutcome): outcome is FencedOutcome {
  return outcome.result === StatusActionResult.FENCED_STALE_EXECUTION;
}

// ─── Port ──────────────────────────────────────────────────

/**
 * The slice of `IdempotencyRepository` this module needs.
 *
 * Declared as a port so `WorkflowStatusFn` can be unit-tested without a
 * DynamoDB client; `IdempotencyRepository` satisfies it structurally.
 */
export interface IdempotencyStateStore {
  conditionalUpdateState(input: ConditionalUpdateStateInput): Promise<IdempotencyRecord>;
  getConsistent(idempotencyKey: string): Promise<IdempotencyRecord | null>;
}

// ─── Request ───────────────────────────────────────────────

/** Arguments for {@link applyOrConfirm}. */
export interface ApplyOrConfirmRequest {
  /** IdempotencyTable partition key. */
  readonly idempotencyKey: string;
  /** Which of the five actions is being applied (logging only). */
  readonly action: WorkflowStatusAction;
  /** The (execution, attempt) pair permitted to act — see {@link ExecutionFencing}. */
  readonly fencing: ExecutionFencing;
  /** Pre-condition for the transition. Must include the fencing terms it needs. */
  readonly guard: IdempotencyGuard;
  /** What the transition writes. */
  readonly mutation: IdempotencyMutation;
  /**
   * Confirms the re-read record actually reached this action's target state.
   *
   * Ownership alone is not proof: `MARK_RUNNING` must see `status=running`,
   * `MARK_CORE_COMMITTED` must see `core_committed=true`, and so on. Without
   * this check a same-execution guard failure for an unrelated reason would be
   * misreported as ALREADY_APPLIED.
   *
   * @example
   * ```ts
   * confirmTargetReached: (r) => r.status === IdempotencyStatus.running
   * ```
   */
  readonly confirmTargetReached: (record: IdempotencyRecord) => boolean;
}

// ─── Implementation ────────────────────────────────────────

function assertRequestIsUsable(request: ApplyOrConfirmRequest): void {
  if (!request.idempotencyKey) {
    throw new IdempotencyUsageError('applyOrConfirm requires a non-empty "idempotencyKey".');
  }
  if (!request.fencing.executionArn) {
    throw new IdempotencyUsageError(
      'applyOrConfirm requires a non-empty "fencing.executionArn" ' +
        '($$.Execution.Id, or expected_stale_execution_arn for RECONCILE_STALE_RUNNING).',
    );
  }
  if (!Number.isInteger(request.fencing.attemptCount) || request.fencing.attemptCount < 1) {
    throw new IdempotencyUsageError(
      `applyOrConfirm requires an integer "fencing.attemptCount" >= 1, got ${String(
        request.fencing.attemptCount,
      )}.`,
    );
  }
}

/** Classifies a re-read record against the fencing pair and the target state. */
function classifyConfirmedRecord(
  record: IdempotencyRecord | null,
  request: ApplyOrConfirmRequest,
): ApplyOrConfirmOutcome {
  const { action, fencing } = request;

  if (record === null) {
    return {
      result: StatusActionResult.FENCED_STALE_EXECUTION,
      record: null,
      reason: 'RECORD_MISSING',
      detail:
        `${action}: guard failed and the IdempotencyTable record for ` +
        `"${request.idempotencyKey}" no longer exists; cannot confirm the transition.`,
    };
  }

  if (record.workflow_execution_arn !== fencing.executionArn) {
    return {
      result: StatusActionResult.FENCED_STALE_EXECUTION,
      record,
      reason: 'DIFFERENT_EXECUTION',
      detail:
        `${action}: record is owned by execution "${String(record.workflow_execution_arn)}", ` +
        `not "${fencing.executionArn}". This execution is stale and must terminate.`,
    };
  }

  if (record.attempt_count !== fencing.attemptCount) {
    return {
      result: StatusActionResult.FENCED_STALE_EXECUTION,
      record,
      reason: 'DIFFERENT_ATTEMPT',
      detail:
        `${action}: record is at attempt_count=${record.attempt_count}, ` +
        `this execution holds attempt_count=${fencing.attemptCount}. Superseded by a newer attempt.`,
    };
  }

  if (!request.confirmTargetReached(record)) {
    return {
      result: StatusActionResult.FENCED_STALE_EXECUTION,
      record,
      reason: 'TARGET_NOT_REACHED',
      detail:
        `${action}: record belongs to this execution and attempt, but the target state was ` +
        'not reached, so the guard failed for another reason. Failing closed rather than ' +
        'continuing on an unverified transition.',
    };
  }

  // Same execution, same attempt, target reached: the first update landed and
  // only its response was lost. Idempotent success.
  return { result: StatusActionResult.ALREADY_APPLIED, record };
}

/**
 * Apply a fenced status transition, or confirm it was already applied.
 *
 * @returns `APPLIED` | `ALREADY_APPLIED` (both: continue) | `FENCED_STALE_EXECUTION` (stop)
 * @throws IdempotencyUsageError when the request can never be correct
 * @throws IdempotencyRepositoryError on a non-conditional DynamoDB failure —
 *         transient faults are never reported as fencing
 *
 * @example MARK_CORE_COMMITTED (TASK-102)
 * ```ts
 * const outcome = await applyOrConfirm(repo, {
 *   idempotencyKey,
 *   action: 'MARK_CORE_COMMITTED',
 *   fencing: { executionArn, attemptCount },
 *   guard: {
 *     status: IdempotencyStatus.running,
 *     workflow_execution_arn: executionArn,
 *     attempt_count: attemptCount,
 *     core_committed: false,
 *   },
 *   mutation: { set: { core_committed: true, evidence_source } },
 *   confirmTargetReached: (r) => r.core_committed === true,
 * });
 *
 * if (!mayProceed(outcome)) return terminateWithoutSideEffects(outcome);
 * await publishFastPathReady();
 * ```
 */
export async function applyOrConfirm(
  store: IdempotencyStateStore,
  request: ApplyOrConfirmRequest,
): Promise<ApplyOrConfirmOutcome> {
  assertRequestIsUsable(request);

  try {
    const record = await store.conditionalUpdateState({
      idempotencyKey: request.idempotencyKey,
      guard: request.guard,
      mutation: request.mutation,
    });
    return { result: StatusActionResult.APPLIED, record };
  } catch (error: unknown) {
    // Only a failed ConditionExpression is ambiguous. Everything else — throttling,
    // access denied, network — propagates untouched (fail-closed).
    if (!(error instanceof IdempotencyConditionFailedError)) throw error;

    // Mandated confirm step: strongly consistent read, never eventually consistent.
    const confirmed = await store.getConsistent(request.idempotencyKey);
    return classifyConfirmedRecord(confirmed, request);
  }
}
