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
