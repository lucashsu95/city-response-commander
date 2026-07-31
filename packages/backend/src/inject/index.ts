/**
 * Injection — idempotency key derivation and lease ownership.
 *
 * @module backend/inject
 */

export {
  deriveIdempotencyKey,
  parseIdempotencyKey,
  deriveDecisionId,
  deriveInjectionIdentity,
  IdempotencyKeyError,
} from './idempotency_key.js';

export type { IdempotencyKeyParts } from './idempotency_key.js';

export { acquireFirstLease, buildFirstLeaseRecord } from './first_lease.js';

export type {
  AcquireFirstLeaseInput,
  AcquireFirstLeaseOutcome,
  InjectionClock,
  LeaseDurations,
} from './first_lease.js';

export {
  recoverFromStartFailed,
  recoverFromProcessingFailed,
  reacquireExpiredStartingLease,
} from './recovery_transitions.js';

export type { RecoveryLeaseInput, RecoveryLeaseOutcome } from './recovery_transitions.js';

export {
  routeSameKeyRequest,
  isTerminalConflict,
  isStartingLeaseExpired,
} from './rerequest_router.js';

export type {
  RerequestRoute,
  RerequestRouterPorts,
  RerequestRouterInput,
} from './rerequest_router.js';

export { orchestrateStaleRunning, isStaleRunning } from './stale_orchestration.js';

export type {
  StaleOrchestrationPorts,
  StaleOrchestrationInput,
  StaleOrchestrationOutcome,
} from './stale_orchestration.js';

export {
  SfnLauncher,
  SfnLauncherUsageError,
  deriveExecutionName,
  buildExecutionPayload,
  resolveStateMachineArn,
  STATE_MACHINE_ARN_KEY,
  MAX_EXECUTION_NAME_LENGTH,
} from './sfn_launcher.js';

export type {
  ConfigReader,
  WorkflowLaunchInput,
  WorkflowExecutionPayload,
  SfnLaunchResult,
  SfnLauncherOptions,
} from './sfn_launcher.js';
