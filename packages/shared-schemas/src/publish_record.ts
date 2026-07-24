/**
 * PublishRecord — mutable publish state + audit trail (§10.11d, §10.17)
 *
 * Stored in PublishRecordTable (PK decision_id).
 * Sole writer: PublishFnRole.
 * publish_state is NEVER written back to the immutable DecisionCore.
 *
 * @module shared-schemas/publish_record
 */

import type { PublishStatus } from './enums.js';

/** A single entry in the publish audit trail */
export interface AuditTrailEntry {
  readonly actor: string;
  readonly action: string;
  readonly from_state: PublishStatus | null;
  readonly to_state: PublishStatus;
  /** YYYY-MM-DD HH:MM */
  readonly at: string;
}

/**
 * PublishRecord — publish state isolated from immutable DecisionCore
 *
 * State machine: draft → approved → published (or publish_failed)
 */
export interface PublishRecord {
  /** PK — corresponds to DecisionCore.decision_id */
  readonly decision_id: string;
  /** Current publish state */
  readonly publish_state: PublishStatus;
  /** Channels used for publishing (CMS/SMS mock, copy, export) */
  readonly channels: readonly string[];
  /** Approver (Cognito identity) */
  readonly approved_by?: string;
  /** Commander who executed publish (Cognito identity) */
  readonly published_by?: string;
  /** Complete audit trail of state transitions */
  readonly audit_trail: readonly AuditTrailEntry[];
  /** Failure reason when publish_failed */
  readonly failure_reason?: string;
  /** Optimistic lock version */
  readonly version: number;
  /** Last update timestamp YYYY-MM-DD HH:MM */
  readonly updated_at: string;
}
