/**
 * Grey-Zone Arbitration Engine (GZAE) — shared types (§GZAE-R1, R2, R3, R4, R5).
 *
 * Covers four SOP grey-zone situations that occur even when `triggered_articles`
 * IS non-empty (orthogonal to UARE, which covers the empty case): threshold-boundary
 * trend pre-warning, cross-article signal contradiction, adjacent micro-incident
 * cascading risk, and self-blocked evacuation candidates. All four are additive
 * annotations except self-blocked exclusion, which corrects an existing candidate's
 * `role` (see `packages/domain/src/rule_engine/grey_zone_arbitration.ts`).
 *
 * @module shared-schemas/grey_zone
 */

/** GZAE-R3: cross-article signal contradiction for a road segment's area. */
export interface SignalConflict {
  readonly segment_id: string;
  readonly conflict_type: 'crowd_heavy_traffic_light' | 'traffic_heavy_crowd_light';
  /** Fixed template text (requirements.md R3 AC6) — never LLM-generated. */
  readonly advisory_text: string;
}

/** GZAE-R4: adjacent, individually-non-escalating incidents flagged as a cascading risk. */
export interface CascadingRisk {
  readonly event_ids: readonly string[];
  /** Fixed template text (requirements.md R4 AC5) — never LLM-generated. */
  readonly advisory_text: string;
}

/**
 * GZAE-R2 extension: threshold-boundary trend pre-warning for a crowd field
 * (SOP-3 User_Count/Growth_Rate, SOP-4 Growth_Rate, SOP-6 Roaming_User_Pct).
 * Same additive-only contract as R2's `pre_warning_segments` — never affects
 * the article's own trigger determination.
 */
export interface CrowdPreWarning {
  readonly bs_id: string;
  readonly article: 3 | 4 | 6;
  readonly field: 'User_Count' | 'Growth_Rate' | 'Roaming_User_Pct';
  /** Fixed template text — never LLM-generated. */
  readonly advisory_text: string;
}
