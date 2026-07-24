/**
 * Unit tests for EvacuationSelector (TASK-025)
 *
 * Verifies:
 * - Primary is the lowest-saturation qualified candidate (role=primary)
 * - Downstream candidates (role=secondary) are listed as secondary, never primary
 * - No fabricated roads appear in the output
 * - Congested-maintain path: saturation >= 0.85 → long-green + public-transit note
 * - No candidate: no_candidate_note = "查無合規替代路段"
 * - Excluded candidates are collected with reasons
 * - Stable sort: first candidate wins on tie
 */

import { describe, it, expect } from 'vitest';
import { RouteCandidateRole, UpstreamDownstream } from '@city-commander/shared-schemas';
import type { RouteCandidate } from '@city-commander/shared-schemas';
import { selectEvacuation, type EvacuationResult } from '../../src/rule_engine/evacuation_selector.js';

// ─── Test Helpers ──────────────────────────────────────────

function makeCandidate(overrides: Partial<RouteCandidate>): RouteCandidate {
  return {
    segment_id: 'RD_TPE_004',
    capacity_vph: 2500,
    passes_capacity: true,
    is_direct_intersection: true,
    upstream_or_downstream: UpstreamDownstream.upstream,
    saturation_at_snapshot: 0.70,
    role: RouteCandidateRole.primary,
    ...overrides,
  };
}

// ─── Primary Selection Tests ───────────────────────────────

describe('EvacuationSelector — selectEvacuation', () => {
  describe('Primary selection (lowest saturation among qualified)', () => {
    it('selects the single primary candidate', () => {
      const candidates: RouteCandidate[] = [
        makeCandidate({ segment_id: 'RD_TPE_004', saturation_at_snapshot: 0.60, role: RouteCandidateRole.primary }),
      ];

      const result = selectEvacuation(candidates);

      expect(result.primary_evacuation).toBe('RD_TPE_004');
      expect(result.no_candidate_note).toBeNull();
    });

    it('selects the candidate with the lowest saturation among multiple primaries', () => {
      const candidates: RouteCandidate[] = [
        makeCandidate({ segment_id: 'RD_TPE_004', saturation_at_snapshot: 0.80, role: RouteCandidateRole.primary }),
        makeCandidate({ segment_id: 'RD_TPE_009', saturation_at_snapshot: 0.50, role: RouteCandidateRole.primary }),
        makeCandidate({ segment_id: 'RD_TPE_010', saturation_at_snapshot: 0.65, role: RouteCandidateRole.primary }),
      ];

      const result = selectEvacuation(candidates);

      expect(result.primary_evacuation).toBe('RD_TPE_009');
    });

    it('uses stable sort: first candidate wins on equal saturation', () => {
      const candidates: RouteCandidate[] = [
        makeCandidate({ segment_id: 'RD_TPE_004', saturation_at_snapshot: 0.50, role: RouteCandidateRole.primary }),
        makeCandidate({ segment_id: 'RD_TPE_009', saturation_at_snapshot: 0.50, role: RouteCandidateRole.primary }),
      ];

      const result = selectEvacuation(candidates);

      expect(result.primary_evacuation).toBe('RD_TPE_004');
    });
  });

  // ─── Downstream / Secondary Tests ──────────────────────────

  describe('Downstream candidates (secondary only)', () => {
    it('lists downstream candidates as secondary_evacuation', () => {
      const candidates: RouteCandidate[] = [
        makeCandidate({ segment_id: 'RD_TPE_004', saturation_at_snapshot: 0.60, role: RouteCandidateRole.primary }),
        makeCandidate({ segment_id: 'RD_TPE_005', role: RouteCandidateRole.secondary }),
        makeCandidate({ segment_id: 'RD_TPE_011', role: RouteCandidateRole.secondary }),
      ];

      const result = selectEvacuation(candidates);

      expect(result.secondary_evacuation).toEqual(['RD_TPE_005', 'RD_TPE_011']);
      expect(result.primary_evacuation).toBe('RD_TPE_004');
    });

    it('downstream candidates are never selected as primary', () => {
      const candidates: RouteCandidate[] = [
        makeCandidate({ segment_id: 'RD_TPE_005', saturation_at_snapshot: 0.10, role: RouteCandidateRole.secondary }),
        makeCandidate({ segment_id: 'RD_TPE_004', saturation_at_snapshot: 0.80, role: RouteCandidateRole.primary }),
      ];

      const result = selectEvacuation(candidates);

      // Primary is the qualified one, not the lower-saturation downstream
      expect(result.primary_evacuation).toBe('RD_TPE_004');
      expect(result.secondary_evacuation).toEqual(['RD_TPE_005']);
    });
  });

  // ─── No Candidate Tests ────────────────────────────────────

  describe('No qualifying candidate', () => {
    it('returns no_candidate_note when no primary candidates exist', () => {
      const candidates: RouteCandidate[] = [
        makeCandidate({
          segment_id: 'RD_TPE_008',
          role: RouteCandidateRole.excluded,
          exclusion_reason: 'capacity_vph 600 < 1000',
        }),
        makeCandidate({
          segment_id: 'RD_TPE_006',
          role: RouteCandidateRole.excluded,
          exclusion_reason: '不在事故路段的 intersections（非直接相交）',
        }),
      ];

      const result = selectEvacuation(candidates);

      expect(result.primary_evacuation).toBeNull();
      expect(result.no_candidate_note).toBe('查無合規替代路段');
      expect(result.primary_congested).toBe(false);
      expect(result.long_green_timing_for_primary).toBe(false);
      expect(result.public_transit_recommended).toBe(false);
      expect(result.congestion_note).toBeNull();
    });

    it('returns no_candidate_note when candidates list is empty', () => {
      const result = selectEvacuation([]);

      expect(result.primary_evacuation).toBeNull();
      expect(result.no_candidate_note).toBe('查無合規替代路段');
    });

    it('returns no_candidate_note when only secondary/unranked candidates exist', () => {
      const candidates: RouteCandidate[] = [
        makeCandidate({ segment_id: 'RD_TPE_005', role: RouteCandidateRole.secondary }),
        makeCandidate({ segment_id: 'RD_TPE_007', role: RouteCandidateRole.unranked_direct_intersection }),
      ];

      const result = selectEvacuation(candidates);

      expect(result.primary_evacuation).toBeNull();
      expect(result.no_candidate_note).toBe('查無合規替代路段');
      // Secondary still listed even if no primary
      expect(result.secondary_evacuation).toEqual(['RD_TPE_005']);
    });
  });

  // ─── Congested-Maintain Tests ──────────────────────────────

  describe('Congested primary (saturation >= 0.85)', () => {
    it('maintains route with saturation exactly 0.85, activates long-green + transit', () => {
      const candidates: RouteCandidate[] = [
        makeCandidate({ segment_id: 'RD_TPE_004', saturation_at_snapshot: 0.85, role: RouteCandidateRole.primary }),
      ];

      const result = selectEvacuation(candidates);

      expect(result.primary_evacuation).toBe('RD_TPE_004');
      expect(result.primary_congested).toBe(true);
      expect(result.long_green_timing_for_primary).toBe(true);
      expect(result.public_transit_recommended).toBe(true);
      expect(result.congestion_note).toBe('主疏散路段已壅塞，建議併行大眾運輸');
      expect(result.no_candidate_note).toBeNull();
    });

    it('maintains route with saturation 0.95, activates congestion handling', () => {
      const candidates: RouteCandidate[] = [
        makeCandidate({ segment_id: 'RD_TPE_004', saturation_at_snapshot: 0.95, role: RouteCandidateRole.primary }),
      ];

      const result = selectEvacuation(candidates);

      expect(result.primary_evacuation).toBe('RD_TPE_004');
      expect(result.primary_congested).toBe(true);
      expect(result.long_green_timing_for_primary).toBe(true);
      expect(result.public_transit_recommended).toBe(true);
      expect(result.congestion_note).toBe('主疏散路段已壅塞，建議併行大眾運輸');
    });

    it('does not activate congestion handling when saturation < 0.85', () => {
      const candidates: RouteCandidate[] = [
        makeCandidate({ segment_id: 'RD_TPE_004', saturation_at_snapshot: 0.84, role: RouteCandidateRole.primary }),
      ];

      const result = selectEvacuation(candidates);

      expect(result.primary_evacuation).toBe('RD_TPE_004');
      expect(result.primary_congested).toBe(false);
      expect(result.long_green_timing_for_primary).toBe(false);
      expect(result.public_transit_recommended).toBe(false);
      expect(result.congestion_note).toBeNull();
    });

    it('selects lowest saturation even if it is still congested (>= 0.85)', () => {
      const candidates: RouteCandidate[] = [
        makeCandidate({ segment_id: 'RD_TPE_004', saturation_at_snapshot: 0.90, role: RouteCandidateRole.primary }),
        makeCandidate({ segment_id: 'RD_TPE_009', saturation_at_snapshot: 0.87, role: RouteCandidateRole.primary }),
      ];

      const result = selectEvacuation(candidates);

      // Lowest saturation is chosen even if congested — route is maintained
      expect(result.primary_evacuation).toBe('RD_TPE_009');
      expect(result.primary_congested).toBe(true);
      expect(result.long_green_timing_for_primary).toBe(true);
    });
  });

  // ─── Excluded Candidates Tests ─────────────────────────────

  describe('Excluded candidates', () => {
    it('populates excluded_candidates with reasons', () => {
      const candidates: RouteCandidate[] = [
        makeCandidate({ segment_id: 'RD_TPE_004', saturation_at_snapshot: 0.60, role: RouteCandidateRole.primary }),
        makeCandidate({
          segment_id: 'RD_TPE_008',
          capacity_vph: 600,
          passes_capacity: false,
          role: RouteCandidateRole.excluded,
          exclusion_reason: 'capacity_vph 600 < 1000',
        }),
        makeCandidate({
          segment_id: 'RD_TPE_006',
          is_direct_intersection: false,
          role: RouteCandidateRole.excluded,
          exclusion_reason: '不在事故路段的 intersections（非直接相交）',
        }),
      ];

      const result = selectEvacuation(candidates);

      expect(result.excluded_candidates).toHaveLength(2);
      expect(result.excluded_candidates[0].segment_id).toBe('RD_TPE_008');
      expect(result.excluded_candidates[0].exclusion_reason).toBe('capacity_vph 600 < 1000');
      expect(result.excluded_candidates[1].segment_id).toBe('RD_TPE_006');
      expect(result.excluded_candidates[1].exclusion_reason).toBe('不在事故路段的 intersections（非直接相交）');
    });
  });

  // ─── Combined Scenario (ACC_001-like) ──────────────────────

  describe('ACC_001-like scenario', () => {
    it('selects RD_TPE_004 as primary, RD_TPE_005 as secondary, excludes others', () => {
      const candidates: RouteCandidate[] = [
        makeCandidate({
          segment_id: 'RD_TPE_004',
          capacity_vph: 2500,
          passes_capacity: true,
          is_direct_intersection: true,
          upstream_or_downstream: UpstreamDownstream.upstream,
          saturation_at_snapshot: 0.72,
          role: RouteCandidateRole.primary,
        }),
        makeCandidate({
          segment_id: 'RD_TPE_005',
          capacity_vph: 2000,
          passes_capacity: true,
          is_direct_intersection: true,
          upstream_or_downstream: UpstreamDownstream.downstream,
          saturation_at_snapshot: 0.45,
          role: RouteCandidateRole.secondary,
        }),
        makeCandidate({
          segment_id: 'RD_TPE_006',
          capacity_vph: 1500,
          passes_capacity: true,
          is_direct_intersection: false,
          upstream_or_downstream: UpstreamDownstream.upstream,
          saturation_at_snapshot: 0.30,
          role: RouteCandidateRole.excluded,
          exclusion_reason: '不在事故路段的 intersections（非直接相交）',
        }),
        makeCandidate({
          segment_id: 'RD_TPE_008',
          capacity_vph: 600,
          passes_capacity: false,
          is_direct_intersection: true,
          upstream_or_downstream: UpstreamDownstream.upstream,
          saturation_at_snapshot: 0.40,
          role: RouteCandidateRole.excluded,
          exclusion_reason: 'capacity_vph 600 < 1000',
        }),
      ];

      const result = selectEvacuation(candidates);

      expect(result.primary_evacuation).toBe('RD_TPE_004');
      expect(result.secondary_evacuation).toEqual(['RD_TPE_005']);
      expect(result.excluded_candidates).toHaveLength(2);
      expect(result.no_candidate_note).toBeNull();
      expect(result.primary_congested).toBe(false);
    });
  });

  // ─── Unranked Direct Intersection ──────────────────────────

  describe('Unranked direct intersections (anchor unresolved)', () => {
    it('unranked_direct_intersection candidates do not appear as primary or secondary', () => {
      const candidates: RouteCandidate[] = [
        makeCandidate({
          segment_id: 'RD_TPE_004',
          saturation_at_snapshot: 0.50,
          role: RouteCandidateRole.unranked_direct_intersection,
        }),
        makeCandidate({
          segment_id: 'RD_TPE_005',
          saturation_at_snapshot: 0.60,
          role: RouteCandidateRole.unranked_direct_intersection,
        }),
      ];

      const result = selectEvacuation(candidates);

      expect(result.primary_evacuation).toBeNull();
      expect(result.secondary_evacuation).toEqual([]);
      expect(result.no_candidate_note).toBe('查無合規替代路段');
    });
  });
});
