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

export { markCoreCommitted } from './mark_core_committed.js';
export type { MarkCoreCommittedContext } from './mark_core_committed.js';

export { handleCoreIdentityConflict, PROCESSING_FAILED_EVENT } from './async_conflict_handler.js';

export type {
  AsyncConflictPorts,
  AsyncConflictInput,
  AsyncConflictResult,
  ProcessingFailedEvent,
  ProcessingFailedPublisherPort,
} from './async_conflict_handler.js';

export {
  WORKFLOW_INPUT_JSONPATHS,
  AslState,
  AslPayloadError,
  ASL_GAP_INSUFFICIENT_DATA_BRANCH,
  ASL_DIVERGENCE_PROCESSING_FAILED_RETRYABLE,
  jsonPathToField,
  nextStateForRecoveryMode,
  nextStateForCoreWriteStatus,
  resolveExecutionArn,
  dispatchWorkflowStatusAction,
} from './wiring.js';

export type {
  AslStateName,
  AslMarkRunningPayload,
  AslMarkCoreCommittedPayload,
  AslMarkCompletedPayload,
  AslMarkProcessingFailedPayload,
  AslReconcileStaleRunningPayload,
  AslWorkflowStatusPayload,
  WiringContext,
} from './wiring.js';
