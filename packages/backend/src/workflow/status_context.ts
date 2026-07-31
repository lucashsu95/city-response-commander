/**
 * Shared inputs for the five `WorkflowStatusFn` actions (design §10.11e).
 *
 * The Step Functions INPUT always carries `idempotency_key`, `decision_id`,
 * `attempt_count`, `lease_owner` and `recovery_mode`; each action additionally
 * takes its own `$$.Execution.Id` and the current time.
 *
 * @module backend/workflow/status_context
 */

import type { RecoveryMode } from '@city-commander/shared-schemas';

/** The Step Functions workflow INPUT (§10.11e). */
export interface WorkflowStatusInput {
  /** IdempotencyTable partition key. */
  readonly idempotencyKey: string;
  /** Deterministically derived decision id (TASK-086). */
  readonly decisionId: string;
  /** Attempt this execution was started for; an attempt fencing term. */
  readonly attemptCount: number;
  /** Lease holder that called StartExecution; guards MARK_RUNNING. */
  readonly leaseOwner: string;
  /** Recovery mode this execution was started with; guards MARK_RUNNING. */
  readonly recoveryMode: RecoveryMode;
}

/**
 * Per-invocation execution context.
 *
 * `executionArn` is `$$.Execution.Id` for the four in-workflow actions. It is
 * NOT used by `RECONCILE_STALE_RUNNING`, which fences on the expected stale pair
 * instead (FIX 3) and therefore takes its own input type.
 */
export interface StatusActionContext {
  /** `$$.Execution.Id` of the execution performing the transition. */
  readonly executionArn: string;
  /** Current time, epoch milliseconds. */
  readonly nowEpochMs: number;
  /** Current time as `YYYY-MM-DD HH:MM` in Asia/Taipei. */
  readonly nowDisplay: string;
}
