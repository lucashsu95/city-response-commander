/**
 * MARK_RUNNING — the Step Functions FIRST state (design §10.11e, §15.2, PATCH 2;
 * TASK-089).
 *
 * This action is the sole writer of `starting → running`, and it is what makes
 * the registration race impossible. `InjectFn` acquires the lease and calls
 * StartExecution, then returns `202` WITHOUT writing `running` — because Express
 * can begin executing before `InjectFn`'s own write would have landed. The
 * execution therefore registers itself, stamping `$$.Execution.Id`, and only
 * after that does the workflow proceed to `DecisionFn` (NORMAL / FULL_WORKFLOW)
 * or to `RecoveryGate` (ENRICHMENT_ONLY).
 *
 * The guard is four-part — `status`, `lease_owner`, `attempt_count` and
 * `recovery_mode` all from the INPUT. Anything else means this execution was
 * started for a lease that no longer exists, so it must not proceed.
 *
 * @module backend/workflow/mark_running
 */

import { IdempotencyStatus } from '@city-commander/shared-schemas';
import { applyOrConfirm } from './apply_or_confirm.js';
import type { ApplyOrConfirmOutcome, IdempotencyStateStore } from './apply_or_confirm.js';
import type { StatusActionContext, WorkflowStatusInput } from './status_context.js';

/** Extra input for MARK_RUNNING. */
export interface MarkRunningContext extends StatusActionContext {
  /**
   * How long this execution has to finish before it is considered stale.
   *
   * `running_deadline_at = now + executionDeadlineMs`. A later same-key request
   * that finds `running_deadline_at < now` triggers stale reconciliation
   * (TASK-091/092), which is what stops a crashed execution from reporting
   * in-progress forever.
   */
  readonly executionDeadlineMs: number;
}

/**
 * Register this execution as the running one.
 *
 * @returns `APPLIED` | `ALREADY_APPLIED` → proceed; `FENCED_STALE_EXECUTION` → stop
 * @throws IdempotencyUsageError / IdempotencyRepositoryError as thrown by the store
 *
 * @example Step Functions first state
 * ```ts
 * const outcome = await markRunning(repo, input, {
 *   executionArn: event.executionId,
 *   nowEpochMs: clock.nowEpochMs,
 *   nowDisplay: clock.nowDisplay,
 *   executionDeadlineMs: 60_000,
 * });
 * if (!mayProceed(outcome)) return terminate();   // never enters DecisionFn
 * ```
 */
export function markRunning(
  store: IdempotencyStateStore,
  input: WorkflowStatusInput,
  context: MarkRunningContext,
): Promise<ApplyOrConfirmOutcome> {
  const { executionArn, nowEpochMs, nowDisplay, executionDeadlineMs } = context;

  return applyOrConfirm(store, {
    idempotencyKey: input.idempotencyKey,
    action: 'MARK_RUNNING',
    fencing: { executionArn, attemptCount: input.attemptCount },
    guard: {
      status: IdempotencyStatus.starting,
      lease_owner: input.leaseOwner,
      attempt_count: input.attemptCount,
      recovery_mode: input.recoveryMode,
    },
    mutation: {
      set: {
        status: IdempotencyStatus.running,
        workflow_execution_arn: executionArn,
        running_started_at: nowEpochMs,
        running_deadline_at: nowEpochMs + executionDeadlineMs,
        last_transition_execution_arn: executionArn,
        last_transition_attempt_count: input.attemptCount,
        updated_at: nowDisplay,
      },
    },
    // Ownership alone is not proof: the record must actually be `running`.
    confirmTargetReached: (record) => record.status === IdempotencyStatus.running,
  });
}
