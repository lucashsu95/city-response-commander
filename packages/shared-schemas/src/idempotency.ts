/**
 * IdempotencyTable — injection dedup + lease state machine (§10.11e)
 *
 * PK: idempotency_key (= event_id|event_timestamp|policy_version)
 * Status shared-write model (FIX 2):
 *   InjectFn OWNS lease/recovery transitions
 *   WorkflowStatusFn OWNS 5 fenced actions
 *
 * @module shared-schemas/idempotency
 */

import type {
  IdempotencyStatus,
  RecoveryStage,
  RecoveryMode,
  EvidenceSource,
} from './enums.js';

/**
 * IdempotencyTable record — the lease/status state machine
 *
 * Status enum has exactly 5 values:
 * starting | running | completed | start_failed | processing_failed
 * (HTTP 202 Accepted is API response semantic, NOT a DynamoDB status)
 */
export interface IdempotencyRecord {
  /** PK = event_id|event_timestamp|policy_version */
  readonly idempotency_key: string;
  /** Decision identifier derived on first request */
  readonly decision_id: string;
  /** Status: exactly 5 values, no 'accepted' */
  readonly status: IdempotencyStatus;
  /** StartExecution attempt count; first lease = 1 */
  readonly attempt_count: number;
  /** Current lease holder (request ID); cleared on terminal transitions */
  readonly lease_owner: string | null;
  /** Lease expiry timestamp; set to now on start_failed/processing_failed */
  readonly lease_expires_at: number | null;
  /** Last error from StartExecution or processing failure */
  readonly last_error: string | null;
  /**
   * Whether this processing_failed is recoverable.
   * CORE_IDENTITY_CONFLICT → retryable=false (terminal)
   */
  readonly retryable: boolean;
  /** Written by MARK_RUNNING with $$.Execution.Id */
  readonly workflow_execution_arn: string | null;
  /** Running start timestamp (MARK_RUNNING) */
  readonly running_started_at: number | null;
  /** Running deadline (MARK_RUNNING); stale if < now */
  readonly running_deadline_at: number | null;
  /** Written by MARK_COMPLETED */
  readonly completed_execution_arn: string | null;
  /** Written by MARK_COMPLETED */
  readonly completed_attempt_count: number | null;
  /** Last transition execution ARN (for fencing/audit) */
  readonly last_transition_execution_arn: string | null;
  /** Last transition attempt count */
  readonly last_transition_attempt_count: number | null;
  /** Evidence source for core_committed (MARK_CORE_COMMITTED only) */
  readonly evidence_source: EvidenceSource | null;
  /**
   * Whether DecisionCore is committed.
   * ONLY written by WorkflowStatusFn MARK_CORE_COMMITTED.
   * DecisionFn has zero write to this table.
   */
  readonly core_committed: boolean;
  /** Recovery stage classification */
  readonly recovery_stage: RecoveryStage;
  /** Recovery mode for next workflow execution */
  readonly recovery_mode: RecoveryMode;
  /** Previous last_error (preserved on recovery for audit) */
  readonly previous_last_error: string | null;
  /** Creation timestamp YYYY-MM-DD HH:MM */
  readonly created_at: string;
  /** Last update timestamp YYYY-MM-DD HH:MM */
  readonly updated_at: string;
  /** TTL expiry timestamp (epoch seconds) */
  readonly expires_at: number;
}
