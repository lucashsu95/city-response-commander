/**
 * Workflow lifecycle — WorkflowStatusFn checkpoints and execution fencing.
 *
 * @module backend/workflow
 */

export { applyOrConfirm, mayProceed, isFenced } from './apply_or_confirm.js';

export type {
  WorkflowStatusAction,
  ExecutionFencing,
  ApplyOrConfirmRequest,
  ApplyOrConfirmOutcome,
  AppliedOutcome,
  AlreadyAppliedOutcome,
  FencedOutcome,
  FencedReason,
  IdempotencyStateStore,
} from './apply_or_confirm.js';

export type { WorkflowStatusInput, StatusActionContext } from './status_context.js';

export { markRunning } from './mark_running.js';
export type { MarkRunningContext } from './mark_running.js';

export { markCompleted } from './mark_completed.js';

export { markProcessingFailed, ProcessingFailure } from './mark_processing_failed.js';
export type { MarkProcessingFailedContext } from './mark_processing_failed.js';

export { reconcileStaleRunning } from './reconcile_stale_running.js';
export type { ReconcileStaleRunningInput } from './reconcile_stale_running.js';
