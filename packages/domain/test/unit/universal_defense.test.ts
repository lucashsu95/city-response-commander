/**
 * Unit tests for the Unified Adaptive Reasoning Engine (UARE) — deterministic
 * SOP-match judgment and grounding-candidate selection for the "SOP type
 * coverage gap" case.
 *
 * Spec: .kiro/specs/unified-adaptive-reasoning-engine/{requirements,design}.md
 */

import { describe, it, expect } from 'vitest';
import type { RoadSegment } from '@city-commander/shared-schemas';
import {
  resolveSopMatch,
  selectGroundingCandidates,
  UNIVERSAL_DEFENSE_PRINCIPLES,
} from '../../src/rule_engine/universal_defense.js';
import { RoadNetworkModel } from '../../src/road_network/road_network_model.js';
import { roadSegments } from '../helpers/domain-fixtures.js';

// ─── resolveSopMatch (R1) ──────────────────────────────────────────────────

describe('resolveSopMatch', () => {
  it('returns sop_matched:false, sop_authority:SYSTEM_DEFAULT_PRINCIPLE when no article triggered', () => {
    expect(resolveSopMatch([])).toEqual({
      sop_matched: false,
      sop_authority: 'SYSTEM_DEFAULT_PRINCIPLE',
    });
  });

  it('returns sop_matched:true, sop_authority:OFFICIAL_SOP when at least one article triggered', () => {
    expect(resolveSopMatch([1])).toEqual({
      sop_matched: true,
      sop_authority: 'OFFICIAL_SOP',
    });
    expect(resolveSopMatch([2, 5])).toEqual({
      sop_matched: true,
      sop_authority: 'OFFICIAL_SOP',
    });
  });

  it('is a pure function: identical input yields identical output', () => {
    const input = [1, 2, 5];
    expect(resolveSopMatch(input)).toEqual(resolveSopMatch(input));
  });
});

// ─── UNIVERSAL_DEFENSE_PRINCIPLES (R2) ─────────────────────────────────────

describe('UNIVERSAL_DEFENSE_PRINCIPLES', () => {
  it('contains exactly the 3 specified principles', () => {
    expect(UNIVERSAL_DEFENSE_PRINCIPLES).toHaveLength(3);
    expect(UNIVERSAL_DEFENSE_PRINCIPLES.map((p) => p.principle_id)).toEqual([
      'UPSTREAM_CONTAINMENT',
      'PERIMETER_GUIDANCE',
      'PUBLIC_NOTIFICATION',
    ]);
  });

  it('every principle has non-empty title and description text', () => {
    for (const principle of UNIVERSAL_DEFENSE_PRINCIPLES) {
      expect(principle.title.length).toBeGreaterThan(0);
      expect(principle.description.length).toBeGreaterThan(0);
    }
  });
});

// ─── selectGroundingCandidates (R3, R6, R7) ────────────────────────────────

function saturationMapOf(values: Record<string, number | null>): (segmentId: string) => number | null {
  return (segmentId) => values[segmentId] ?? null;
}

describe('selectGroundingCandidates', () => {
  const network = () => RoadNetworkModel.load(roadSegments());

  it('filters candidates below CAPACITY_THRESHOLD (RD_TPE_008 @ 600 vph excluded)', () => {
    // RD_TPE_002's alternatives: RD_TPE_004, RD_TPE_005, RD_TPE_006, RD_TPE_008 (600 vph)
    const result = selectGroundingCandidates(
      'RD_TPE_002',
      network(),
      saturationMapOf({ RD_TPE_004: 0.3, RD_TPE_005: 0.5, RD_TPE_006: 0.4, RD_TPE_008: 0.1 }),
    );
    expect(result.candidates.map((c) => c.segment_id)).not.toContain('RD_TPE_008');
  });

  it('excludes candidates with no legal saturation observation instead of defaulting to 0 (R7 AC3)', () => {
    const result = selectGroundingCandidates(
      'RD_TPE_002',
      network(),
      saturationMapOf({ RD_TPE_004: null, RD_TPE_005: 0.5, RD_TPE_006: 0.4 }),
    );
    expect(result.candidates.map((c) => c.segment_id)).not.toContain('RD_TPE_004');
  });

  it('sorts by saturation ascending and caps at 3 candidates', () => {
    const result = selectGroundingCandidates(
      'RD_TPE_002',
      network(),
      saturationMapOf({ RD_TPE_004: 0.9, RD_TPE_005: 0.2, RD_TPE_006: 0.5 }),
    );
    expect(result.candidates.map((c) => c.segment_id)).toEqual([
      'RD_TPE_005',
      'RD_TPE_006',
      'RD_TPE_004',
    ]);
    expect(result.candidates.length).toBeLessThanOrEqual(3);
  });

  it('computes status_text from the shared A/B classification thresholds', () => {
    const result = selectGroundingCandidates(
      'RD_TPE_002',
      network(),
      saturationMapOf({ RD_TPE_004: 0.5, RD_TPE_005: 0.9, RD_TPE_006: 0.97 }),
    );
    const byId = new Map(result.candidates.map((c) => [c.segment_id, c.status_text]));
    expect(byId.get('RD_TPE_004')).toBe('暢通');
    expect(byId.get('RD_TPE_005')).toBe('注意');
    expect(byId.get('RD_TPE_006')).toBe('壅塞');
  });

  it('returns empty candidates with reason "no_grounding_candidate_available" when the anchor has no alternatives (R3 AC7)', () => {
    // RD_TPE_004 has alternatives: [] in the fixture
    const result = selectGroundingCandidates('RD_TPE_004', network(), saturationMapOf({}));
    expect(result).toEqual({ candidates: [], reason: 'no_grounding_candidate_available' });
  });

  it('returns empty candidates when every alternative lacks a legal observation', () => {
    const result = selectGroundingCandidates('RD_TPE_002', network(), saturationMapOf({}));
    expect(result).toEqual({ candidates: [], reason: 'no_grounding_candidate_available' });
  });

  it('never returns a segment_id absent from the road network (zero-hallucination)', () => {
    const result = selectGroundingCandidates(
      'RD_TPE_002',
      network(),
      saturationMapOf({ RD_TPE_004: 0.3, RD_TPE_005: 0.5, RD_TPE_006: 0.4 }),
    );
    const whitelist = new Set(roadSegments().map((s: RoadSegment) => s.segment_id));
    for (const candidate of result.candidates) {
      expect(whitelist.has(candidate.segment_id)).toBe(true);
    }
  });

  it('is a pure function: identical input yields identical output', () => {
    const saturation = saturationMapOf({ RD_TPE_004: 0.3, RD_TPE_005: 0.5, RD_TPE_006: 0.4 });
    const a = selectGroundingCandidates('RD_TPE_002', network(), saturation);
    const b = selectGroundingCandidates('RD_TPE_002', network(), saturation);
    expect(a).toEqual(b);
  });
});
