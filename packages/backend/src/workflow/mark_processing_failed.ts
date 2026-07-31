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
  const retryable = !isTerminalConflict;
  const recoveryStage = isTerminalConflict
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
