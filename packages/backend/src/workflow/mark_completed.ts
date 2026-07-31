/**
 * MARK_COMPLETED — successful terminal transition (design §10.11e, §15.2;
 * TASK-090).
 *
 * `running → completed`, fenced on `workflow_execution_arn = $$.Execution.Id`
 * AND `attempt_count = input.attempt_count`. Writes `completed_execution_arn` /
 * `completed_attempt_count` so a lost response can be confirmed as
 * ALREADY_APPLIED rather than mistaken for a conflict, clears the lease and the
 * running deadline, and sets `recovery_stage = NONE`.
 *
 * After this, a same-key POST reads `completed` and gets `200 OK` with the
 * existing `decision_id` — a distinct branch from the `202` in-progress path
 * (§12 status matrix).
 *
 * @module backend/workflow/mark_completed
 */

import { IdempotencyStatus, RecoveryStage } from '@city-commander/shared-schemas';
import { applyOrConfirm } from './apply_or_confirm.js';
import type { ApplyOrConfirmOutcome, IdempotencyStateStore } from './apply_or_confirm.js';
import type { StatusActionContext, WorkflowStatusInput } from './status_context.js';

/**
 * Mark the execution complete.
 *
 * @returns `APPLIED` | `ALREADY_APPLIED` → done; `FENCED_STALE_EXECUTION` → stop
 */
export function markCompleted(
  store: IdempotencyStateStore,
  input: WorkflowStatusInput,
  context: StatusActionContext,
): Promise<ApplyOrConfirmOutcome> {
  const { executionArn, nowDisplay } = context;

  return applyOrConfirm(store, {
    idempotencyKey: input.idempotencyKey,
    action: 'MARK_COMPLETED',
    fencing: { executionArn, attemptCount: input.attemptCount },
    guard: {
      status: IdempotencyStatus.running,
      workflow_execution_arn: executionArn,
      attempt_count: input.attemptCount,
    },
    mutation: {
      set: {
        status: IdempotencyStatus.completed,
        // Witnesses for apply-or-confirm: they prove WHICH execution completed.
        completed_execution_arn: executionArn,
        completed_attempt_count: input.attemptCount,
        recovery_stage: RecoveryStage.NONE,
        last_transition_execution_arn: executionArn,
        last_transition_attempt_count: input.attemptCount,
        updated_at: nowDisplay,
      },
      // A completed key holds no lease and has no deadline to go stale.
      remove: ['lease_owner', 'running_deadline_at'],
    },
    confirmTargetReached: (record) =>
      record.status === IdempotencyStatus.completed &&
      record.completed_execution_arn === executionArn &&
      record.completed_attempt_count === input.attemptCount,
  });
}
