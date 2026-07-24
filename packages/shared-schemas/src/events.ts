/**
 * WebSocket Event Contracts — discriminated union (§13)
 *
 * Every event carries: schema_version, event_type (discriminant),
 * decision_id/event_id, occurred_at, source_timestamps,
 * policy_version, provisional, trace_id, ready_event_id.
 *
 * Each event has an HTTP polling fallback defined in §13.
 *
 * @module shared-schemas/events
 */

import type { PublishStatus } from './enums.js';
import type { AuditTrailEntry } from './publish_record.js';

/** Base fields shared by all WebSocket events */
interface BaseEvent {
  readonly schema_version: string;
  readonly trace_id: string;
  readonly occurred_at: string;
  readonly provisional: boolean;
  readonly policy_version: string;
}

/** timeline.updated — time axis advanced */
export interface TimelineUpdatedEvent extends BaseEvent {
  readonly event_type: 'timeline.updated';
  readonly current_timestamp: string;
  readonly source_timestamps: Record<string, string>;
}

/** anomaly.detected — SOP threshold crossed, auto-popup */
export interface AnomalyDetectedEvent extends BaseEvent {
  readonly event_type: 'anomaly.detected';
  readonly anomaly_type: string;
  readonly segment_or_station_id: string;
  readonly threshold: string;
  readonly value: number;
  readonly summary: string;
}

/** decision.fast_path_ready — deterministic core result ready */
export interface DecisionFastPathReadyEvent extends BaseEvent {
  readonly event_type: 'decision.fast_path_ready';
  readonly decision_id: string;
  readonly ready_event_id: string;
  readonly source_timestamps: Record<string, string>;
  readonly idempotency_key: string;
  readonly summary: {
    readonly triggered_articles: readonly number[];
    readonly invoked_procedures: readonly string[];
    readonly applied_formula_articles: readonly number[];
    readonly primary_evacuation: string | null;
    readonly ete_minutes?: number;
  };
}

/** decision.enriched — all 3 narrative items committed */
export interface DecisionEnrichedEvent extends BaseEvent {
  readonly event_type: 'decision.enriched';
  readonly decision_id: string;
  readonly ready_event_id: string;
}

/** public_alert.ready — PUBLIC_ALERT narrative item committed */
export interface PublicAlertReadyEvent extends BaseEvent {
  readonly event_type: 'public_alert.ready';
  readonly decision_id: string;
  readonly ready_event_id: string;
  readonly languages: readonly string[];
}

/** report.ready — REPORT narrative item committed */
export interface ReportReadyEvent extends BaseEvent {
  readonly event_type: 'report.ready';
  readonly decision_id: string;
  readonly ready_event_id: string;
}

/** publish.status_changed — publish state transition */
export interface PublishStatusChangedEvent extends BaseEvent {
  readonly event_type: 'publish.status_changed';
  readonly decision_id: string;
  readonly publish_state: PublishStatus;
  readonly audit_trail: readonly AuditTrailEntry[];
}

/** processing.failed — workflow stage failure (incl. CORE_IDENTITY_CONFLICT terminal) */
export interface ProcessingFailedEvent extends BaseEvent {
  readonly event_type: 'processing.failed';
  readonly decision_id: string;
  readonly error_code: string;
  readonly retryable: boolean;
  readonly last_error: string;
}

/**
 * Discriminated union of all WebSocket events.
 * Discriminant field: event_type
 */
export type WebSocketEvent =
  | TimelineUpdatedEvent
  | AnomalyDetectedEvent
  | DecisionFastPathReadyEvent
  | DecisionEnrichedEvent
  | PublicAlertReadyEvent
  | ReportReadyEvent
  | PublishStatusChangedEvent
  | ProcessingFailedEvent;
