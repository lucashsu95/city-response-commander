/**
 * RECONCILE_STALE_RUNNING — external fencing (design §10.11e, §15.2 step E,
 * FIX 3; TASK-091).
 *
 * This is the one status action invoked from OUTSIDE the execution it acts on.
 * A crashed or timed-out Express execution leaves `status=running` with a
 * `running_deadline_at` in the past; nobody inside that execution is alive to
 * clean it up. A later same-key request notices it through `InjectFn`, calls the
 * read-only `RecoveryGateFn`, and then invokes this action.
 *
 * Because the caller is not the stale execution, it MUST NOT fence on its own
 * `$$.Execution.Id` — doing so would never match, and the key would report
 * in-progress forever. It fences on what RecoveryGateFn observed instead:
 *
 *   `status = running`
 *   AND `workflow_execution_arn = expected_stale_execution_arn`
 *   AND `attempt_count = expected_attempt`
 *   AND `running_deadline_at = observed_running_deadline_at`
 *   AND `running_deadline_at < now`
 *
 * The deadline appears twice deliberately: equality proves nothing has changed
 * since the gate read it (no lost update), and the `<` comparison proves the
 * execution really is past due. Both together mean two concurrent requests
 * cannot both reconcile, and a still-healthy execution cannot be killed.
 *
 * @module backend/workflow/reconcile_stale_running
 */

import { IdempotencyStatus, RecoveryStage } from '@city-commander/shared-schemas';
import { applyOrConfirm } from './apply_or_confirm.js';
import type { ApplyOrConfirmOutcome, IdempotencyStateStore } from './apply_or_confirm.js';
import { ProcessingFailure } from './mark_processing_failed.js';

/**
 * Everything this action needs, taken from `RecoveryGateFn` output rather than
 * from an ambient execution context (FIX 3).
 */
export interface ReconcileStaleRunningInput {
  readonly idempotencyKey: string;
  /** `RecoveryGateResult.expected_stale_execution_arn`. */
  readonly expectedStaleExecutionArn: string;
  /** `RecoveryGateResult.expected_attempt`. */
  readonly expectedAttempt: number;
  /** `RecoveryGateResult.observed_running_deadline_at`. */
  readonly observedRunningDeadlineAt: number;
  /** `RecoveryGateResult.effective_core_committed` — decides `recovery_stage`. */
  readonly effectiveCoreCommitted: boolean;
  /** Current time, epoch milliseconds. Must be after the observed deadline. */
  readonly nowEpochMs: number;
  /** Current time as `YYYY-MM-DD HH:MM` in Asia/Taipei. */
  readonly nowDisplay: string;
}

/**
 * Reconcile a stale `running` record to `processing_failed` so staged recovery
 * can take over.
 *
 * @returns `APPLIED` → reconciled; `ALREADY_APPLIED` → another request got there
 *          first for the same stale pair; `FENCED_STALE_EXECUTION` → the key has
 *          already moved on (e.g. re-leased to a newer attempt), so do nothing
 * @throws IdempotencyRepositoryError on a non-conditional failure
 */
export function reconcileStaleRunning(
  store: IdempotencyStateStore,
  input: ReconcileStaleRunningInput,
): Promise<ApplyOrConfirmOutcome> {
  const {
    idempotencyKey,
    expectedStaleExecutionArn,
    expectedAttempt,
    observedRunningDeadlineAt,
    effectiveCoreCommitted,
    nowEpochMs,
    nowDisplay,
  } = input;

  return applyOrConfirm(store, {
    idempotencyKey,
    action: 'RECONCILE_STALE_RUNNING',
    // External fencing: the EXPECTED STALE pair, never the reconciler's own id.
    fencing: { executionArn: expectedStaleExecutionArn, attemptCount: expectedAttempt },
    guard: {
      status: IdempotencyStatus.running,
      workflow_execution_arn: expectedStaleExecutionArn,
      attempt_count: expectedAttempt,
      // Equality: nothing changed since RecoveryGateFn read it.
      running_deadline_at: observedRunningDeadlineAt,
      // Comparison: the deadline really has passed.
      running_deadline_at_lt: nowEpochMs,
    },
    mutation: {
      set: {
        status: IdempotencyStatus.processing_failed,
        last_error: ProcessingFailure.STALE_RUNNING_EXECUTION,
        // Recoverable: the work never finished, so a new attempt is legitimate.
        retryable: true,
        recovery_stage: effectiveCoreCommitted
          ? RecoveryStage.ENRICHMENT_ONLY
          : RecoveryStage.FULL_WORKFLOW,
        lease_expires_at: nowEpochMs,
        // Audit trail points at the execution that was reconciled, not the caller.
        last_transition_execution_arn: expectedStaleExecutionArn,
        last_transition_attempt_count: expectedAttempt,
        updated_at: nowDisplay,
      },
      remove: ['lease_owner', 'running_deadline_at'],
    },
    confirmTargetReached: (record) =>
      record.status === IdempotencyStatus.processing_failed &&
      record.last_error === ProcessingFailure.STALE_RUNNING_EXECUTION,
  });
}
