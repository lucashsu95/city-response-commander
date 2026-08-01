/**
 * MARK_PROCESSING_FAILED — terminal failure Catch (design §10.11e, §15.2, FIX 1;
 * TASK-090).
 *
 * `running → processing_failed`, fenced on `$$.Execution.Id` AND `attempt_count`.
 * Clears the lease, sets `lease_expires_at = now` so a recovery request can
 * compete immediately, clears the running deadline, and records `last_error`.
 *
 * Two variants, and the difference is the whole point:
 *
 *  - **Recoverable** — `retryable = true`, and `recovery_stage` comes from
 *    RecoveryGateFn's `effective_core_committed`: `ENRICHMENT_ONLY` when a core
 *    is already committed (so `DecisionFn` must NOT run again), otherwise
 *    `FULL_WORKFLOW`.
 *  - **CORE_IDENTITY_CONFLICT** — `retryable = false`, `recovery_stage = NONE`.
 *    Terminal and non-recoverable: a different decision is already committed
 *    under this key, so retrying could only attempt to overwrite an immutable
 *    core. This state is what a later same-key POST reads to return `409`
 *    (never `500`), while the original request's `202` stands (FIX 1).
 *  - **Caller-asserted terminal** — `retryableOverride === false`. The ASL's
 *    `PREPARE_*` states know some inputs are unrecoverable for reasons that
 *    cannot be read off `lastError` (a malformed INPUT does not become
 *    well-formed on retry). See {@link MarkProcessingFailedContext.retryableOverride};
 *    the override only narrows, never widens.
 *
 * @module backend/workflow/mark_processing_failed
 */

import { IdempotencyStatus, RecoveryStage } from '@city-commander/shared-schemas';
import { applyOrConfirm } from './apply_or_confirm.js';
import type { ApplyOrConfirmOutcome, IdempotencyStateStore } from './apply_or_confirm.js';
import type { StatusActionContext, WorkflowStatusInput } from './status_context.js';

/** `last_error` values written by this action. */
export const ProcessingFailure = {
  /** Terminal identity conflict on the DecisionCore conditional Put (FIX 1). */
  CORE_IDENTITY_CONFLICT: 'CORE_IDENTITY_CONFLICT',
  /** ENRICHMENT_ONLY recovery found `core_exists=false` (§15.2). */
  RECOVERY_CORE_MISSING: 'RECOVERY_CORE_MISSING',
  /** A running execution passed its deadline (written by RECONCILE_STALE_RUNNING). */
  STALE_RUNNING_EXECUTION: 'STALE_RUNNING_EXECUTION',
} as const;

/** Extra input for MARK_PROCESSING_FAILED. */
export interface MarkProcessingFailedContext extends StatusActionContext {
  /** Machine-readable failure cause written to `last_error`. */
  readonly lastError: string;
  /**
   * RecoveryGateFn's `effective_core_committed`, which decides `recovery_stage`.
   * Ignored for the terminal conflict variant, which is always `NONE`.
   */
  readonly effectiveCoreCommitted: boolean;
  /**
   * The ASL's own `retryable` assertion, when a `PREPARE_*` state made one.
   *
   * Resolves the dual-source problem this action used to have: the ASL asserted
   * `retryable: false` for `INVALID_RECOVERY_MODE` and
   * `UNKNOWN_CORE_WRITE_STATUS`, while this function derived `true` from
   * `lastError`, and whichever ran last won. The record could therefore say
   * "retryable" for an input the state machine had already judged terminal.
   *
   * The override is deliberately ONE-WAY — it can only narrow:
   *
   *  - `false` → terminal wins. The caller knows something this function cannot
   *    infer from `lastError` alone (a malformed INPUT is not going to become
   *    well-formed on retry).
   *  - `true` / `undefined` → the derivation stands. An explicit `true` can NEVER
   *    make `CORE_IDENTITY_CONFLICT` retryable; that invariant is FIX 1 and a
   *    caller must not be able to widen it.
   *
   * Forcing `false` also forces `recovery_stage = NONE`, because
   * `retryable=false` with a live `recovery_stage` is a contradiction that would
   * let a recovery request pick up a record nothing is allowed to retry.
   */
  readonly retryableOverride?: boolean;
}

/**
 * Mark the execution failed, classifying how much may be recovered.
 *
 * @returns `APPLIED` | `ALREADY_APPLIED` → recorded; `FENCED_STALE_EXECUTION` → stop
 */
export function markProcessingFailed(
  store: IdempotencyStateStore,
  input: WorkflowStatusInput,
  context: MarkProcessingFailedContext,
): Promise<ApplyOrConfirmOutcome> {
  const { executionArn, nowEpochMs, nowDisplay, lastError, effectiveCoreCommitted } = context;

  const isTerminalConflict = lastError === ProcessingFailure.CORE_IDENTITY_CONFLICT;
  // One-way narrowing: an explicit `false` from the ASL makes the record terminal,
  // an explicit `true` can never un-terminalise a conflict (FIX 1).
  const forcedTerminal = context.retryableOverride === false;
  const terminal = isTerminalConflict || forcedTerminal;

  const retryable = !terminal;
  const recoveryStage = terminal
    ? RecoveryStage.NONE
    : effectiveCoreCommitted
      ? RecoveryStage.ENRICHMENT_ONLY
      : RecoveryStage.FULL_WORKFLOW;

  return applyOrConfirm(store, {
    idempotencyKey: input.idempotencyKey,
    action: 'MARK_PROCESSING_FAILED',
    fencing: { executionArn, attemptCount: input.attemptCount },
    guard: {
      status: IdempotencyStatus.running,
      workflow_execution_arn: executionArn,
      attempt_count: input.attemptCount,
    },
    mutation: {
      set: {
        status: IdempotencyStatus.processing_failed,
        last_error: lastError,
        retryable,
        recovery_stage: recoveryStage,
        // Expire the lease immediately so a recovery request can take it now,
        // instead of waiting out a lease that nobody holds.
        lease_expires_at: nowEpochMs,
        last_transition_execution_arn: executionArn,
        last_transition_attempt_count: input.attemptCount,
        updated_at: nowDisplay,
      },
      remove: ['lease_owner', 'running_deadline_at'],
    },
    confirmTargetReached: (record) =>
      record.status === IdempotencyStatus.processing_failed && record.last_error === lastError,
  });
}
