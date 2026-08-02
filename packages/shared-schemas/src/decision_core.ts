/** DecisionCore — immutable, LLM-prohibited decision payload (§10.11a). */

import type { EvidenceTrace } from './evidence.js';
import type { PolicyMetadata } from './policy_metadata.js';
import type { ETEResult } from './ete.js';
import type { RouteCandidate } from './route_candidate.js';
import type { UniversalPrinciple, GroundingCandidate } from './universal_defense.js';
import type { SignalConflict, CascadingRisk, CrowdPreWarning } from './grey_zone.js';

export interface SegmentClassification {
  readonly segment_id: string;
  readonly level: 'A' | 'B' | null;
}

export interface Art1Measures {
  readonly level: 'A' | 'B';
  readonly trigger_segment: string;
  readonly long_green_timing: boolean;
  readonly alternatives_green_plus_pct: 25;
  readonly police_clear_intersections: boolean;
  readonly a_level_invokes_article2_alternative_route_guidance: boolean;
}

/** Immutable official incident fields included in canonical core identity. */
export interface ImmutableIncidentFacts {
  readonly type: string;
  readonly location: string;
  readonly affected_segment: string;
  readonly affected_road?: string;
  readonly status: string;
  readonly severity: string;
  readonly description: string;
  readonly timestamp: string;
}

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

export interface AffectedIntersectionScope {
  readonly police_per_intersection: 2;
  readonly affected_intersection_count: number | 'unresolved';
  readonly total_police: number | 'unresolved';
  readonly manual_confirmation_required: boolean;
  readonly example_classification?: 'PROVISIONAL_DERIVED_EXAMPLE';
  readonly official_golden_answer: false;
}

/** Written solely by DecisionFn. Every field is LLM-prohibited. */
export interface DecisionCore {
  readonly decision_id: string;
  readonly idempotency_key: string;
  readonly injection_run_id: string;
  readonly workflow_execution_name?: string;
  readonly version: number;
  readonly core_hash: string;
  readonly source_manifest_hash: string;
  readonly immutable_after_commit: boolean;

  readonly event_id: string;
  readonly occurred_at: string;
  /** Required by the production builder; optional here for backwards-compatible read models. */
  readonly event_facts?: ImmutableIncidentFacts;

  readonly triggered_articles: readonly number[];
  readonly applied_formula_articles: readonly number[];
  readonly invoked_procedures: readonly string[];
  readonly art1_measures?: Art1Measures;
  readonly classifications: readonly SegmentClassification[];

  readonly incident_anchor?: IncidentAnchor;
  readonly primary_evacuation: string | null;
  readonly secondary_evacuation: readonly string[];
  readonly excluded_candidates: readonly RouteCandidate[];
  readonly affected_intersection_scope?: AffectedIntersectionScope;
  readonly ete?: ETEResult;

  readonly multilingual_required: boolean;
  readonly multilingual_scope?: {
    readonly mode: string;
    readonly stations_in_scope: readonly string[];
  };

  readonly evidence: EvidenceTrace;
  readonly policy: PolicyMetadata;
  readonly cms_core_text: string;

  /**
   * UARE (Unified Adaptive Reasoning Engine, §UARE-R1). `true` when
   * `triggered_articles` is non-empty. Optional for backwards-compatible
   * read models built before UARE wiring (decision_pipeline.ts, TASK-UARE-08).
   */
  readonly sop_matched?: boolean;
  /** UARE (§UARE-R1). `OFFICIAL_SOP` when `sop_matched`, else `SYSTEM_DEFAULT_PRINCIPLE`. */
  readonly sop_authority?: 'OFFICIAL_SOP' | 'SYSTEM_DEFAULT_PRINCIPLE';
  /** UARE (§UARE-R2). Non-empty only when `sop_matched` is `false`. */
  readonly universal_principles?: readonly UniversalPrinciple[];
  /** UARE (§UARE-R3, R6). Non-empty only when `sop_matched` is `false` and a grounding anchor was resolvable. */
  readonly grounding_candidates?: readonly GroundingCandidate[];

  /**
   * GZAE (§GZAE-R2). `segment_id`s in the grey zone `[0.80, 0.85)` with a
   * strictly rising 3-point trend. Never affects `classifications.level`.
   * Optional for backwards-compatible read models built before GZAE wiring.
   */
  readonly pre_warning_segments?: readonly string[];
  /**
   * GZAE (§GZAE-R2 extension). Same trend-based grey-zone pre-warning as
   * `pre_warning_segments`, generalized to SOP-3 (User_Count/Growth_Rate),
   * SOP-4 (Growth_Rate) and SOP-6 (Roaming_User_Pct). Never affects
   * `triggered_articles` or any article's own trigger determination.
   */
  readonly crowd_pre_warnings?: readonly CrowdPreWarning[];
  /** GZAE (§GZAE-R3). Cross-article traffic/crowd signal contradictions, advisory-only. */
  readonly signal_conflicts?: readonly SignalConflict[];
  /** GZAE (§GZAE-R4). Adjacent, individually-non-escalating incidents, advisory-only; `null` when none detected. */
  readonly cascading_risk?: CascadingRisk | null;
  /**
   * GZAE (§GZAE-R1). `segment_id`s excluded from evacuation candidacy because
   * they are themselves the `affected_segment` of another active, blocking
   * incident. Subset of `excluded_candidates`; recorded separately to
   * distinguish this mechanism's exclusions from the existing 3-AND ones.
   */
  readonly self_blocked_exclusions?: readonly string[];

  readonly provisional: boolean;
  readonly schema_version: string;
}
