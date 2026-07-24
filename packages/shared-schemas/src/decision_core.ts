/**
 * DecisionCore — immutable decision payload (§10.11a)
 *
 * All fields are LLM-prohibited; RendererFn has zero write permission.
 * Written solely by DecisionFn. immutable_after_commit.
 *
 * Field markers:
 * - @immutable-official — official read-only value from source data
 * - @normalized — normalized from raw
 * - @derived — deterministically derived (LLM-prohibited)
 * - @provisional — depends on provisional strategy (LLM-prohibited)
 * - @LLM-prohibited — Bedrock MUST NOT write this field
 *
 * @module shared-schemas/decision_core
 */

import type {
  NarrativeType,
  Severity,
  RouteCandidateRole,
  UpstreamDownstream,
} from './enums.js';
import type { EvidenceTrace } from './evidence.js';
import type { PolicyMetadata } from './policy_metadata.js';
import type { ETEResult } from './ete.js';
import type { RouteCandidate } from './route_candidate.js';

/** @derived @LLM-prohibited */
export interface SegmentClassification {
  readonly segment_id: string;
  readonly level: 'A' | 'B' | null;
}

/**
 * Art.1 measures applied when RD_TPE_001/002 reaches B or A level
 * @derived @LLM-prohibited
 */
export interface Art1Measures {
  readonly level: 'A' | 'B';
  readonly trigger_segment: string;
  readonly long_green_timing: boolean;
  readonly alternatives_green_plus_pct: 25;
  readonly police_clear_intersections: boolean;
  readonly a_level_invokes_article2_alternative_route_guidance: boolean;
}

/**
 * Incident anchor resolution result (Strategy D, §10.8a)
 * @provisional @LLM-prohibited
 */
export interface IncidentAnchor {
  readonly affected_road: string;
  readonly anchor_intersection: string;
  readonly anchor_index: number;
  readonly travel_direction: string;
  readonly position_relative_to_intersection: string;
  readonly resolution_confidence: 'high' | 'medium' | 'low';
  readonly source_evidence: string;
  readonly manual_confirmation_required: boolean;
  readonly unranked_direct_intersections: readonly string[];
  readonly provisional: true;
}

/**
 * Affected intersection scope (Strategy E, §10.9a)
 * @provisional @LLM-prohibited
 */
export interface AffectedIntersectionScope {
  /** @immutable-official SOP5 mandates 2 per intersection */
  readonly police_per_intersection: 2;
  /** @provisional unresolved until scope confirmed */
  readonly affected_intersection_count: number | 'unresolved';
  /** @provisional = 2 * count, unresolved if count unknown */
  readonly total_police: number | 'unresolved';
  readonly manual_confirmation_required: boolean;
  readonly example_classification?: 'PROVISIONAL_DERIVED_EXAMPLE';
  readonly official_golden_answer: false;
}

/**
 * DecisionCore — the immutable decision payload (§10.11a)
 *
 * All numeric/boolean fields are LLM-prohibited.
 * Written solely by DecisionFn via conditional Put.
 */
export interface DecisionCore {
  /** @derived deterministically derived decision_id */
  readonly decision_id: string;
  /** @derived event_id|event_timestamp|policy_version */
  readonly idempotency_key: string;
  /** @derived injection run identifier */
  readonly injection_run_id: string;
  /** @derived Step Functions execution name (traceability only, NOT dedup) */
  readonly workflow_execution_name?: string;
  /** @derived optimistic lock version */
  readonly version: number;
  /**
   * SHA-256 of canonical deterministic decision payload (§10.11a-1)
   * @derived @LLM-prohibited
   */
  readonly core_hash: string;
  /** @derived source manifest hash for this decision */
  readonly source_manifest_hash: string;
  /** @derived immutable after first commit */
  readonly immutable_after_commit: boolean;

  // ── Event facts ──
  /** @immutable-official */
  readonly event_id: string;
  /** @derived YYYY-MM-DD HH:MM */
  readonly occurred_at: string;

  // ── Rule Engine outputs ──
  /**
   * Triggered articles (art.1-6 only; art.7 NEVER here)
   * @derived @LLM-prohibited
   */
  readonly triggered_articles: readonly number[];
  /**
   * Formula articles applied (e.g. [7])
   * @derived @LLM-prohibited
   */
  readonly applied_formula_articles: readonly number[];
  /**
   * Procedures invoked (e.g. article2_alternative_route_guidance)
   * @derived @LLM-prohibited
   */
  readonly invoked_procedures: readonly string[];
  /** @derived @LLM-prohibited */
  readonly art1_measures?: Art1Measures;
  /** @derived @LLM-prohibited all 15 segments */
  readonly classifications: readonly SegmentClassification[];

  // ── Route decision ──
  /** @provisional @LLM-prohibited Strategy D anchor */
  readonly incident_anchor?: IncidentAnchor;
  /** @provisional @LLM-prohibited null if anchor unresolved */
  readonly primary_evacuation: string | null;
  /** @provisional @LLM-prohibited */
  readonly secondary_evacuation: readonly string[];
  /** @derived @LLM-prohibited */
  readonly excluded_candidates: readonly RouteCandidate[];
  /** @provisional @LLM-prohibited Strategy E */
  readonly affected_intersection_scope?: AffectedIntersectionScope;

  // ── ETE ──
  /** @derived @LLM-prohibited */
  readonly ete?: ETEResult;

  // ── Multilingual ──
  /** @derived @LLM-prohibited */
  readonly multilingual_required: boolean;
  /** @provisional @LLM-prohibited Strategy F */
  readonly multilingual_scope?: {
    readonly mode: string;
    readonly stations_in_scope: readonly string[];
  };

  // ── Evidence ──
  /** @derived @LLM-prohibited */
  readonly evidence: EvidenceTrace;

  // ── Policy ──
  /** @provisional @LLM-prohibited */
  readonly policy: PolicyMetadata;

  // ── CMS ──
  /**
   * Deterministic CMS template text (LLM-prohibited)
   * e.g. "{incident_road}封閉，請改道 {primary_evacuation}，預計延誤 {ETE} 分鐘"
   * @derived @LLM-prohibited
   */
  readonly cms_core_text: string;

  /** @derived */
  readonly provisional: boolean;
  /** @derived */
  readonly schema_version: string;
}
