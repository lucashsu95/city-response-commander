/**
 * API Contracts (§12)
 *
 * Defines request/response types for the HTTP API routes.
 * All response facts are produced by deterministic backend/domain code.
 * Frontend consumers render these values and must not recompute data status,
 * staleness, policy selection, classifications, or crowd flags.
 *
 * @module shared-schemas/api-contracts
 */

import type { DecisionCore } from './decision_core.js';
import type { DecisionNarrative } from './decision_narrative.js';
import type { EvidenceTrace } from './evidence.js';
import type { RagTrace } from './rag_trace.js';
import type { EteCalculationTrace } from './ete_calculation.js';
import type { IdempotencyStatus, LaneStatus, Language } from './enums.js';
import type { GuidanceId, SelectionMode } from './hg001_literals.js';
import type { PolicyMetadata } from './policy_metadata.js';
import type { PublishRecord } from './publish_record.js';

/**
 * Deterministic data-availability result for an API read model.
 *
 * `insufficient_data` is explicit; consumers must never infer it from an
 * empty array or absent numeric value.
 */
export type ApiDataStatus = 'ready' | 'insufficient_data';

/** Deterministic freshness classification supplied by the backend. */
export type ObservationStalenessState = 'fresh' | 'stale' | 'unavailable';

/**
 * Authoritative quality metadata for one selected source observation.
 * All fields are required. Nullable fields are null only when no usable
 * observation exists, typically when `data_status` is `insufficient_data`.
 */
export interface ObservationMetadata {
  /** [Required, nullable] Backend-selected source observation timestamp; never UI-calculated. */
  readonly authoritative_observation_timestamp: string | null;
  /** [Required, nullable] Minutes from the deterministic cutoff to the observation. */
  readonly staleness_minutes: number | null;
  /** [Required] Explicit backend freshness state; frontend must not derive it. */
  readonly staleness_state: ObservationStalenessState;
  /** [Required] Explicit backend stale marker; frontend must not calculate it. */
  readonly is_stale: boolean;
  /** [Required, nullable] True for an exact cutoff match; null when no observation exists. */
  readonly exact_match: boolean | null;
  /** [Required, nullable] HG-001 selection mode used to select the observation. */
  readonly selection_mode: SelectionMode | null;
}

/**
 * Source provenance attached to every read response.
 * All fields are required. A source manifest hash is nullable only before a
 * verified manifest is available for the requested read model.
 */
export interface ResponseProvenance {
  /** [Required, nullable] SHA-256 manifest hash for the source set used by the backend. */
  readonly source_manifest_hash: string | null;
  /** [Required] Organizer guidance identifiers that affected the deterministic result. */
  readonly guidance_ids: readonly GuidanceId[];
}

/**
 * OQ-005 station-set policy selected by deterministic backend configuration.
 * The time dimension is organizer-guided; the station-set dimension remains
 * configurable and open until the host provides a unique official rule.
 */
export type StationScopeMode =
  | 'current_snapshot_all_available_stations'
  | 'incident_area_nearby_stations'
  | 'explicit_host_policy';

/** OQ-005 policy/provenance exposed to the crowd panel. */
export interface StationScopePolicy {
  /** [Required] The open-question identifier governing this policy. */
  readonly question_id: 'OQ-005';
  /** [Required] Deterministic configured station-set mode. */
  readonly mode: StationScopeMode;
  /** [Required] Overall OQ-005 resolution state. */
  readonly resolution_status: 'partially_resolved_by_organizer_guidance';
  /** [Required] Time-dimension policy resolved for implementation by HG-001. */
  readonly time_dimension: {
    /** [Required] Guidance that resolved the time cutoff interpretation. */
    readonly guidance_id: 'HG-001';
    /** [Required] Selected deterministic cutoff policy. */
    readonly selection_mode: SelectionMode;
    /** [Required] HG-001 is interpretive guidance, not a unique official rule. */
    readonly official_unique_rule: false;
    /** [Required] The mode remains configurable. */
    readonly configurable: true;
  };
  /** [Required] Station-set policy that remains open pending host confirmation. */
  readonly station_set_dimension: {
    /** [Required] Explicit open-policy state; never infer official authority. */
    readonly status: 'open_awaiting_host_reply';
    /** [Required] The configured station set remains provisional. */
    readonly configurable: true;
    /** [Required] No unique official station-set rule has been supplied. */
    readonly official_unique_rule: false;
  };
}

/** Canonical deterministic flags for a base-station observation. */
export type CrowdFlag =
  'multilingual_required' | 'dome_dispersal_required' | 'sop3_shuttle_required';

/** Canonical road observation rendered by the road-traffic panel. */
export interface RoadPanelSegment {
  /** [Required] Official road segment identifier. */
  readonly segment_id: string;
  /** [Required] Official road display name. */
  readonly road_name: string;
  /** [Required] Deterministic saturation score; frontend must not recalculate the level. */
  readonly saturation_score: number;
  /** [Required, nullable] Deterministic SOP-1 level; null when no A/B level applies. */
  readonly level: 'A' | 'B' | null;
  /** [Required] Official lane status literal from the source dataset. */
  readonly lane_status: LaneStatus;
  /** [Required] Backend-selected timestamp and stale metadata for this segment. */
  readonly observation: ObservationMetadata;
}

/** Canonical base-station observation rendered by the crowd panel. */
export interface CrowdPanelStation {
  /** [Required] Official base-station identifier. */
  readonly bs_id: string;
  /** [Required] Official base-station location name. */
  readonly location_name: string;
  /** [Required] Deterministic observed user count. */
  readonly user_count: number;
  /** [Required] Deterministic observed growth rate. */
  readonly growth_rate: number;
  /** [Required] Deterministic roaming percentage numeric value. */
  readonly roaming_pct_value: number;
  /** [Required] Backend-formatted roaming percentage display value. */
  readonly roaming_pct_display: string;
  /** [Required] Closed canonical flag set; frontend must not derive additional flags. */
  readonly flags: readonly CrowdFlag[];
  /** [Required] Backend-selected timestamp and stale metadata for this station. */
  readonly observation: ObservationMetadata;
}

/** Read-only workflow state attached to the canonical decision read model. */
export interface DecisionExecutionStatus {
  /** [Required] Idempotency/workflow processing state. */
  readonly status: IdempotencyStatus;
  /** [Required, nullable] Last deterministic processing error, if any. */
  readonly last_error: string | null;
  /** [Required] Whether deterministic recovery may retry the workflow. */
  readonly retryable: boolean;
  /** [Required] Current workflow start/recovery attempt count. */
  readonly attempt_count: number;
  /** [Required, nullable] Workflow execution ARN when a workflow has started. */
  readonly workflow_execution_arn: string | null;
  /** [Required] Whether the immutable DecisionCore has been committed. */
  readonly core_committed: boolean;
}

// ─── 事件注入 POST /incidents/{id}/inject ──────────────────

/** POST /incidents/{event_id}/inject — 請求體 */
export interface InjectIncidentRequest {
  /** 事件 ID (from live_incidents.json) */
  readonly event_id: string;
}

/** POST /incidents/{event_id}/inject — 回應體 */
export interface InjectIncidentResponse {
  /** 決策 ID */
  readonly decision_id: string;
  /** Trace ID for observability */
  readonly trace_id: string;
  /** Status indication */
  readonly status: string;
  /** Error code (when applicable) */
  readonly error_code?: string;
  /** Whether error is retryable */
  readonly retryable?: boolean;
}

// ─── 決策查詢 GET /decisions/{id} ──────────────────────────

/**
 * Canonical GET /decisions/{id} read model (§10.11c).
 *
 * Every field is required. Nullable projections are null for a deterministic
 * insufficient-data result or when their corresponding record does not exist.
 */
export interface DecisionReadModel {
  /** [Required] Wire-contract schema version. */
  readonly schema_version: string;
  /** [Required] Trace ID for observability and support correlation. */
  readonly trace_id: string;
  /** [Required] Explicit deterministic availability result. */
  readonly data_status: ApiDataStatus;
  /** [Required, nullable] Immutable core; null when data was insufficient to build one. */
  readonly core: DecisionCore | null;
  /** [Required, nullable] Deterministic evidence trace; null when no core exists. */
  readonly evidence: EvidenceTrace | null;
  /** [Required] Active policy metadata, including provisional policy markers. */
  readonly policy: PolicyMetadata;
  /** [Required] Source/guidance provenance for this read model. */
  readonly provenance: ResponseProvenance;
  /** [Required] All generated narrative items; empty when none are available. */
  readonly narratives: readonly DecisionNarrative[];
  /** [Required, nullable] Publish projection; null until a publish record exists. */
  readonly publish: PublishRecord | null;
  /** [Required] Deterministic processing and workflow status. */
  readonly execution: DecisionExecutionStatus;
  /** [Required] Explicit backend manual-confirmation state; frontend must not infer it. */
  readonly manual_confirmation_required: boolean;
  /** [Required] Active policy version. */
  readonly policy_version: string;
  /** [Required] Whether any active decision policy is provisional. */
  readonly provisional: boolean;
}

/** GET /decisions/{id} response is the canonical DecisionReadModel. */
export type GetDecisionResponse = DecisionReadModel;

// ─── 路段查詢 GET /roads ───────────────────────────────────

/** GET /roads — canonical road-traffic panel response. */
export interface GetRoadsResponse {
  /** [Required] Wire-contract schema version. */
  readonly schema_version: string;
  /** [Required] Trace ID for observability and support correlation. */
  readonly trace_id: string;
  /** [Required] Explicit deterministic availability result; do not infer from segments. */
  readonly data_status: ApiDataStatus;
  /** [Required] Road observations; may be empty only with explicit data_status. */
  readonly segments: readonly RoadPanelSegment[];
  /** [Required] Backend response generation timestamp; not an observation timestamp. */
  readonly timestamp: string;
  /** [Required, nullable] Aggregate authoritative observation time when the backend has one. */
  readonly authoritative_observation_timestamp: string | null;
  /** [Required, nullable] Deterministic response cutoff used to select observations. */
  readonly decision_cutoff_timestamp: string | null;
  /** [Required] Active policy metadata, including provisional policy markers. */
  readonly policy: PolicyMetadata;
  /** [Required] Source/guidance provenance for this response. */
  readonly provenance: ResponseProvenance;
  /** [Required] Active policy version. */
  readonly policy_version: string;
  /** [Required] Whether active policy is provisional. */
  readonly provisional: boolean;
}

// ─── 人群查詢 GET /crowd ───────────────────────────────────

/** GET /crowd — canonical base-station crowd panel response. */
export interface GetCrowdResponse {
  /** [Required] Wire-contract schema version. */
  readonly schema_version: string;
  /** [Required] Trace ID for observability and support correlation. */
  readonly trace_id: string;
  /** [Required] Explicit deterministic availability result; do not infer from stations. */
  readonly data_status: ApiDataStatus;
  /** [Required] Base-station observations; may be empty only with explicit data_status. */
  readonly stations: readonly CrowdPanelStation[];
  /** [Required] Backend response generation timestamp; not an observation timestamp. */
  readonly timestamp: string;
  /** [Required, nullable] Aggregate authoritative observation time when the backend has one. */
  readonly authoritative_observation_timestamp: string | null;
  /** [Required, nullable] Deterministic response cutoff used to select observations. */
  readonly decision_cutoff_timestamp: string | null;
  /** [Required] OQ-005 station-scope mode and explicit open-policy disclosure. */
  readonly station_scope_policy: StationScopePolicy;
  /** [Required] Active policy metadata, including provisional policy markers. */
  readonly policy: PolicyMetadata;
  /** [Required] Source/guidance provenance for this response. */
  readonly provenance: ResponseProvenance;
  /** [Required] Active policy version. */
  readonly policy_version: string;
  /** [Required] Whether active policy is provisional. */
  readonly provisional: boolean;
}

// ─── What-if POST /what-if ──────────────────────────────────

/** POST /what-if — 請求體 (§14.5) */
export interface WhatIfRequest {
  /** raw_question is UNTRUSTED_USER_INPUT */
  readonly query: string;
}

/** POST /what-if — 回應體 (WhatIfResult §10.15) */
export interface WhatIfResponse {
  readonly schema_version: string;
  readonly trace_id: string;
  readonly request_id: string;
  readonly status: 'answered' | 'clarification_required';
  /** Triggered articles from stage 3 (LLM-prohibited) */
  readonly triggered_articles: readonly number[];
  /** Applied formula articles (LLM-prohibited) */
  readonly applied_formula_articles: readonly number[];
  /** Expected actions (LLM-prohibited) */
  readonly expected_actions: readonly string[];
  /** ETE preview if applicable */
  readonly ete_preview?: { readonly ete_minutes: number };
  /**
   * Verbatim SOP citations with deterministic provenance. `source` distinguishes
   * a Knowledge Base match from a non-exact S3 fallback citation.
   */
  readonly sop_citations: readonly {
    readonly article_no: number;
    readonly content: string;
    readonly source_location: string;
    readonly source: 'kb' | 's3_fallback';
  }[];
  /** Stage 4 Bedrock explanation (LLM-writable) */
  readonly explanation_text?: string;
  /** Clarification prompt when status=clarification_required */
  readonly clarification_prompt?: string;
  /** Full RAG retrieval trace for SOP grounding (optional, available after stage 4) */
  readonly rag_trace?: import('./rag_trace.js').RagTrace;
  /** ETE formula calculation trace when article 7 is applied */
  readonly ete_calculation?: import('./ete_calculation.js').EteCalculationTrace;
  /** What-if never mutates state */
  readonly does_not_mutate_state: true;
  readonly provisional: boolean;
}

// ─── 多語警示 ──────────────────────────────────────────────

/** Multilingual alert content */
export interface MultilingualAlert {
  /** Triggered SOP article */
  readonly triggered_sop: number;
  /** Languages included (determined by deterministic trigger) */
  readonly languages: readonly Language[];
  /** Message text per language */
  readonly messages: Partial<Record<Language, string>>;
}
