/**
 * API Contracts (§12)
 *
 * Defines request/response types for the HTTP API routes.
 * All responses carry schema_version, trace_id, policy, provisional.
 *
 * @module shared-schemas/api-contracts
 */

import type { DecisionCore } from './decision_core.js';
import type { DecisionNarrative } from './decision_narrative.js';
import type { PublishRecord } from './publish_record.js';
import type { Language } from './enums.js';

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
 * GET /decisions/{id} — DecisionReadModel (§10.11c)
 * Merges: Core + Narrative + Publish + execution summary
 */
export interface GetDecisionResponse {
  readonly schema_version: string;
  readonly trace_id: string;
  /** Immutable decision core (authoritative numbers) */
  readonly core: DecisionCore;
  /** All narrative items (REPORT/PUBLIC_ALERT/EXPLANATION) */
  readonly narratives: readonly DecisionNarrative[];
  /** Publish record (may be null if not published) */
  readonly publish?: PublishRecord;
  /** Read-only execution summary from IdempotencyTable (FIX 1) */
  readonly execution: {
    readonly status: string;
    readonly last_error: string | null;
    readonly retryable: boolean;
    readonly attempt_count: number;
  };
  readonly policy_version: string;
  readonly provisional: boolean;
}

// ─── 路段查詢 GET /roads ───────────────────────────────────

/** GET /roads — 回應體 */
export interface GetRoadsResponse {
  readonly schema_version: string;
  readonly trace_id: string;
  readonly segments: readonly {
    readonly segment_id: string;
    readonly road_name: string;
    readonly saturation_score: number;
    /** 'A' | 'B' | null */
    readonly level: string | null;
    readonly lane_status: string;
  }[];
  readonly timestamp: string;
  readonly provisional: boolean;
}

// ─── 人群查詢 GET /crowd ───────────────────────────────────

/** GET /crowd — 回應體 */
export interface GetCrowdResponse {
  readonly schema_version: string;
  readonly trace_id: string;
  readonly stations: readonly {
    readonly bs_id: string;
    readonly location_name: string;
    readonly user_count: number;
    readonly growth_rate: number;
    readonly roaming_pct_value: number;
    readonly roaming_pct_display: string;
    readonly flags: readonly string[];
  }[];
  readonly timestamp: string;
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
