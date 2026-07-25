/**
 * PolicyMetadata — provisional policy markers (§10.6)
 *
 * classification = PROVISIONAL_TEAM_POLICY
 * status = AWAITING_HOST_REPLY
 *
 * All Strategy A-F mode fields are configurable enums.
 * Never hard-coded; never presented as official rules.
 *
 * @module shared-schemas/policy_metadata
 */

/**
 * PolicyMetadata — carried by every DecisionCore to record
 * which provisional strategies were active for this decision.
 *
 * @provisional @LLM-prohibited
 */
export interface PolicyMetadata {
  /** Always PROVISIONAL_TEAM_POLICY */
  readonly classification: 'PROVISIONAL_TEAM_POLICY';
  /** Always AWAITING_HOST_REPLY */
  readonly status: 'AWAITING_HOST_REPLY';
  /** Never official */
  readonly is_official: false;
  /** Organizer guidance used by the selected implementation policy, when applicable. */
  readonly guidance_id?: 'HG-001';
  /** Golden values derived from policy are examples, never host-provided answers. */
  readonly official_golden_answer?: false;

  // ── Strategy A: Time Alignment (OQ-001) ──
  readonly time_alignment: {
    readonly mode: string;
    readonly max_staleness_minutes: number;
    readonly on_insufficient: string;
  };

  // ── Strategy B: Affected Road Role (OQ-002) ──
  readonly affected_road: {
    readonly role: 'display_only' | 'context_and_ete' | 'parallel_road_impact_explicit_host';
  };

  // ── Strategy C: ETE Affected Set (OQ-003) ──
  readonly ete: {
    readonly affected_set: string;
  };

  // ── Strategy D: Incident Anchor Resolution (OQ-004) ──
  readonly incident_anchor: {
    readonly mode: 'incident_anchor_from_location_text' | 'explicit_host_mapping';
  };

  // ── Strategy E: Affected Intersection Scope (OQ-010) ──
  readonly affected_intersection_scope: {
    readonly mode:
      'unresolved_manual_confirmation' | 'all_segment_intersections' | 'explicit_host_set';
  };

  // ── Strategy F: Multilingual Scope (OQ-005) ──
  readonly multilingual_scope: {
    readonly mode:
      | 'current_snapshot_all_available_stations'
      | 'incident_area_nearby_stations'
      | 'explicit_host_policy';
  };

  // ── OQ-008: Saturated vs Congested ──
  readonly saturated_vs_congested: 'PARTIALLY_DEFINED';
}
