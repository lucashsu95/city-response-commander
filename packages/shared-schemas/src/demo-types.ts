/**
 * Demo API Types — structured response types for the demo backend endpoints.
 *
 * These supplement (not replace) the canonical shared-schemas contracts.
 * All values are derived deterministically from SOP data, traffic/crowd
 * snapshots, or incident facts. No fabricated thresholds or parameters.
 *
 * SOP thresholds used:
 *   Art.1  — B級門檻 0.85, A級門檻 0.95
 *   Art.3  — BL17 Growth_Rate > 0.30 或 User_Count > 25,000
 *   Art.4  — DOME User_Count 历史峰值 >= 30,000 且 Growth_Rate <= -0.20
 *   Art.6  — Roaming_User_Pct >= 0.30  (ratio in [0, 1])
 *   Art.7  — ETE = base_clearance + congestion_penalty
 *            base_clearance: Critical=60, High=40, Medium=20 (分鐘)
 *            congestion_penalty = (avg_saturation - 0.5) * 60, min 0
 *
 * @module shared-schemas/demo-types
 */

import type { Language } from './enums.js';

/**
 * A single traffic record within a timeseries snapshot.
 * `Saturation_Score` is a ratio in [0, 1].
 */
export interface DemoTrafficEntry {
  readonly timestamp_raw: string;
  readonly Segment_ID: string;
  readonly Road_Name: string;
  readonly Avg_Speed: number;
  readonly Vehicle_Count: number;
  /** Ratio in [0, 1]. 0.85 = 85% saturation. */
  readonly Saturation_Score: number;
  readonly Lane_Status: string;
}

/**
 * A single crowd/base-station record within a timeseries snapshot.
 * `roaming_pct_value` is a ratio in [0, 1]; parsed from CSV "30%" → 0.30.
 */
export interface DemoCrowdEntry {
  readonly timestamp_raw: string;
  readonly BS_ID: string;
  readonly Location_Name: string;
  readonly User_Count: number;
  readonly Stay_Time_Avg: number;
  readonly Growth_Rate: number;
  readonly Roaming_User_Pct: string;
  /** Ratio in [0, 1]. 0.30 = 30%. */
  readonly roaming_pct_value: number;
}

/**
 * A timeseries snapshot keyed to one timeline timestamp.
 * The frontend uses `timelineIndex` to select which snapshot to display.
 */
export interface DemoTimeseriesSnapshot {
  readonly timestamp_display: string;
  readonly traffic: readonly DemoTrafficEntry[];
  readonly crowd: readonly DemoCrowdEntry[];
}

// ─── Anomaly (GET /demo/timeseries) ──────────────────────────────────────────

/**
 * A single anomaly detected from live traffic/crowd data analysis.
 * Emitted every time /demo/timeseries is called.
 */
export interface DemoTimeseriesAnomaly {
  /** Stable UUID-like id for this detection event */
  readonly id: string;
  /** SOP article that triggered: 1 | 3 | 4 | 6 */
  readonly type:
    | 'article1_saturation'
    | 'article3_bl17_surge'
    | 'article4_dome_dissipation'
    | 'article6_roaming';
  /** SOP severity label */
  readonly severity: 'high' | 'medium';
  /** Always 'traffic' or 'crowd' */
  readonly source: 'traffic' | 'crowd';
  /** Segment ID (for traffic anomalies) or base-station ID (for crowd anomalies) */
  readonly station_id?: string;
  /** Segment ID (for traffic anomalies) */
  readonly segment_id?: string;
  /** Observed value that crossed the threshold */
  readonly observed_value: number;
  /** Threshold value that was crossed */
  readonly threshold: number;
  /** Unit of the observed value */
  readonly unit: string;
  /** SOP article number that was triggered */
  readonly triggered_article: number;
  /** Chinese summary of the anomaly */
  readonly summary_zh: string;
  /** ISO timestamp when anomaly was detected */
  readonly detected_at: string;
}

// ─── Control Center Recommendation (POST /demo/incidents) ───────────────────

/**
 * A single technical action in the control-center recommendation.
 * All values are deterministically derived from SOP, incident, or traffic data.
 */
export interface DemoTechnicalAction {
  /** Target system: 號誌控制, 路線引導, 廣播, 警力調度 */
  readonly system: string;
  /** Target entity: segment ID or intersection name */
  readonly target: string;
  /** Action to perform */
  readonly action: string;
  /** Parameter name (e.g., 'green_phase_pct', 'cycle_seconds') */
  readonly parameter: string;
  /** Parameter value. Set to null when parameter_status = 'sop_not_specific' */
  readonly value: number | null;
  /** Unit of the value */
  readonly unit: string;
  /** Time window for the action */
  readonly time_window: string;
  /** Why this action is recommended */
  readonly rationale: string;
  /** SOP article that mandates this action */
  readonly source_article: number;
  /** Whether SOP provides exact parameter value; 'sop_not_specific' means SOP gives direction only */
  readonly parameter_status: 'sop_specific' | 'sop_not_specific';
}

/** Control-center recommendation for a processed incident. */
export interface DemoControlCenterRecommendation {
  /** Recommendation title */
  readonly title: string;
  /** Incident summary paragraph */
  readonly incident_summary: string;
  /** Incident type classification */
  readonly classification: string;
  /** SOP articles triggered by this incident */
  readonly triggered_articles: readonly number[];
  /** Technical actions to execute */
  readonly technical_actions: readonly DemoTechnicalAction[];
  /** Route guidance actions */
  readonly route_actions: {
    readonly primary_route: string;
    readonly primary_route_segment_id: string;
    readonly secondary_routes: readonly string[];
    readonly excluded_routes: readonly { segment_id: string; reason: string }[];
    readonly cms_message_zh: string;
    readonly cms_message_en: string;
  };
  /** Coordination actions for traffic police / control center */
  readonly coordination_actions: readonly string[];
  /** Public guidance text in all available languages */
  readonly public_guidance: {
    readonly zh: string;
    readonly en: string;
    readonly ja?: string;
    readonly ko?: string;
  };
  /** ISO timestamp when recommendation was generated */
  readonly generated_at: string;
}

// ─── Public Alerts (POST /demo/incidents inline) ────────────────────────────

/** Multilingual public alert content attached to incident responses. */
export interface DemoPublicAlerts {
  readonly multilingual_required: boolean;
  readonly languages: readonly Language[];
  readonly messages: Partial<Record<Language, string>>;
  /** SOP article that triggered multilingual generation */
  readonly triggered_article: number | null;
  readonly text_source: 'deterministic';
}

// ─── Publish Endpoint ─────────────────────────────────────────────────────────

/** Request body for POST /decisions/{id}/publish */
export interface DemoPublishRequest {
  /** Channels to publish to */
  readonly channels: readonly string[];
  /** Approver / commander identity */
  readonly approved_by: string;
  /** Language versions to include */
  readonly languages: readonly Language[];
}

// ─── Alert Endpoint Enhancement ─────────────────────────────────────────────

/**
 * Enhanced alert request that matches the POST /demo/alerts contract.
 * Supports roaming-based (SOP Art.6) triggering.
 */
export interface DemoAlertRequest {
  /** Optional decision_id from a prior incident response */
  readonly decision_id?: string;
  /** Optional event_id from a prior incident response */
  readonly event_id?: string;
  /** Base-station ID (BS_MRT_BL17, BS_XY_ATT, etc.) */
  readonly station_id: string;
  /** Roaming user percentage (0.0 - 1.0) */
  readonly roaming_user_pct: number;
  /** Incident severity for message tailoring */
  readonly severity?: 'Critical' | 'High' | 'Medium';
  /** Affected road name for contextual messages */
  readonly route?: string;
  /** Languages to generate. Defaults to ['zh', 'en'] */
  readonly languages?: readonly Language[];
}

/** Response from POST /demo/alerts */
export interface DemoAlertResponse {
  readonly triggered: boolean;
  readonly roaming_user_pct: number;
  readonly roaming_threshold: number;
  readonly station_id: string;
  readonly messages: {
    readonly zh: string;
    readonly en: string;
    readonly ja?: string;
    readonly ko?: string;
  };
  readonly text_source: 'deterministic' | 'none';
  readonly triggered_article: number | null;
  readonly multilingual_required: boolean;
}
