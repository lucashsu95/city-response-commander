/**
 * Route boundary decoder tests (TASK-130).
 *
 * Covers the §10.8 / §10.8a decode contract: absence vs malformation, the
 * R13.3 blank-reason breach, the unresolved-anchor rule of §11.5, and the
 * congestion-disposition drift (absent on the live wire ⇒ `null`, never
 * inferred from a saturation threshold).
 */

import { describe, expect, it } from 'vitest';
import {
  anchorPrimaryConflict,
  anchorUnresolved,
  decodeRouteView,
} from '../../src/decision/route_model.js';
import { routeViewOf } from '../../src/decision/use_route_view.js';
import { coreView, wireIncidentAnchor, wireRouteCandidate } from './fixtures.js';

function decode(wireOverrides: Record<string, unknown>) {
  const result = decodeRouteView(coreView(wireOverrides));
  if (!result.ok) throw new Error(`unexpected decode failure: ${result.error.code}`);
  return result.routes;
}

describe('decodeRouteView — candidates', () => {
  it('reads every RouteCandidate field verbatim', () => {
    const routes = decode({ excluded_candidates: [wireRouteCandidate()] });

    expect(routes.excludedCandidates).toEqual([
      {
        segmentId: 'RD_TPE_008',
        capacityVph: 600,
        passesCapacity: false,
        isDirectIntersection: true,
        upstreamOrDownstream: 'upstream',
        saturationAtSnapshot: 0.32,
        role: 'excluded',
        exclusionReason: 'capacity_vph 600 < 1000',
      },
    ]);
    expect(routes.reasonlessExclusions).toEqual([]);
  });

  it('preserves wire order and never re-sorts by saturation', () => {
    const routes = decode({
      excluded_candidates: [
        wireRouteCandidate({ segment_id: 'RD_TPE_008', saturation_at_snapshot: 0.9 }),
        wireRouteCandidate({ segment_id: 'RD_TPE_006', saturation_at_snapshot: 0.1 }),
        wireRouteCandidate({ segment_id: 'RD_TPE_009', saturation_at_snapshot: 0.5 }),
      ],
    });

    expect(routes.excludedCandidates.map((candidate) => candidate.segmentId)).toEqual([
      'RD_TPE_008',
      'RD_TPE_006',
      'RD_TPE_009',
    ]);
  });

  it('reports a blank exclusion reason as an R13.3 gap without dropping the row', () => {
    const routes = decode({
      excluded_candidates: [
        wireRouteCandidate({ segment_id: 'RD_TPE_008', exclusion_reason: '   ' }),
        wireRouteCandidate({ segment_id: 'RD_TPE_006', exclusion_reason: null }),
        wireRouteCandidate({ segment_id: 'RD_TPE_009' }),
      ],
    });

    expect(routes.excludedCandidates).toHaveLength(3);
    expect(routes.reasonlessExclusions).toEqual(['RD_TPE_008', 'RD_TPE_006']);
  });

  it('fails the decode when a candidate field has the wrong type', () => {
    const result = decodeRouteView(
      coreView({ excluded_candidates: [wireRouteCandidate({ capacity_vph: '600' })] }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INVALID_EXCLUDED_CANDIDATES');
  });

  it('treats an absent excluded_candidates block as an empty list', () => {
    const routes = decode({ excluded_candidates: undefined });

    expect(routes.excludedCandidates).toEqual([]);
  });
});

describe('decodeRouteView — incident anchor (§11.5)', () => {
  it('reads the anchor verbatim', () => {
    const routes = decode({ incident_anchor: wireIncidentAnchor() });

    expect(routes.incidentAnchor).toEqual({
      affectedRoad: 'RD_TPE_002',
      anchorIntersection: '忠孝東路四段',
      anchorIndex: 1,
      travelDirection: '南下',
      positionRelativeToIntersection: 'south',
      resolutionConfidence: 'high',
      sourceEvidence: "location='光復南路與忠孝東路口南側'",
      manualConfirmationRequired: false,
      unrankedDirectIntersections: [],
      provisional: true,
    });
    expect(anchorUnresolved(routes)).toBe(false);
  });

  it('distinguishes an absent anchor from an unresolved anchor', () => {
    const routes = decode({ incident_anchor: null });

    expect(routes.incidentAnchor).toBeNull();
    expect(anchorUnresolved(routes)).toBe(false);
  });

  it('reports an unresolved anchor with its unranked intersections', () => {
    const routes = decode({
      primary_evacuation: null,
      incident_anchor: wireIncidentAnchor({
        manual_confirmation_required: true,
        anchor_intersection: null,
        anchor_index: null,
        position_relative_to_intersection: null,
        resolution_confidence: 'low',
        unranked_direct_intersections: ['RD_TPE_004', 'RD_TPE_005'],
      }),
    });

    expect(anchorUnresolved(routes)).toBe(true);
    expect(routes.primaryEvacuation).toBeNull();
    expect(routes.incidentAnchor?.unrankedDirectIntersections).toEqual([
      'RD_TPE_004',
      'RD_TPE_005',
    ]);
    expect(anchorPrimaryConflict(routes)).toBe(false);
  });

  it('flags an unresolved anchor that still names a primary as a contract breach', () => {
    const routes = decode({
      primary_evacuation: 'RD_TPE_004',
      incident_anchor: wireIncidentAnchor({ manual_confirmation_required: true }),
    });

    expect(anchorPrimaryConflict(routes)).toBe(true);
  });

  it('fails the decode when the anchor is present but malformed', () => {
    const result = decodeRouteView(coreView({ incident_anchor: { anchor_index: 'first' } }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INVALID_INCIDENT_ANCHOR');
  });
});

describe('decodeRouteView — congestion disposition (§11.7)', () => {
  it('returns null when the backend supplies no disposition fields', () => {
    // The live core carries none of them, even for a congested primary: the
    // disposition must be disclosed as missing, never inferred client-side.
    const routes = decode({});

    expect(routes.congestion).toBeNull();
    expect(routes.noCandidateNote).toBeNull();
  });

  it('reads the disposition verbatim when supplied', () => {
    const routes = decode({
      primary_congested: true,
      long_green_timing_for_primary: true,
      public_transit_recommended: true,
      congestion_note: '主疏散路段已壅塞，建議併行大眾運輸',
    });

    expect(routes.congestion).toEqual({
      primaryCongested: true,
      longGreenTimingForPrimary: true,
      publicTransitRecommended: true,
      congestionNote: '主疏散路段已壅塞，建議併行大眾運輸',
    });
  });

  it('does not infer congestion from a high candidate saturation', () => {
    const routes = decode({
      excluded_candidates: [wireRouteCandidate({ saturation_at_snapshot: 0.99 })],
    });

    expect(routes.congestion).toBeNull();
  });

  it('reads no_candidate_note when supplied', () => {
    const routes = decode({ primary_evacuation: null, no_candidate_note: '查無合規替代路段' });

    expect(routes.noCandidateNote).toBe('查無合規替代路段');
  });
});

describe('routeViewOf', () => {
  it('reports an absent core distinctly from a decode error', () => {
    expect(routeViewOf(null)).toEqual({ kind: 'absent' });
  });

  it('wraps a successful decode', () => {
    const result = routeViewOf(coreView({ excluded_candidates: [wireRouteCandidate()] }));

    expect(result.kind).toBe('ok');
  });

  it('wraps a decode failure', () => {
    const result = routeViewOf(coreView({ incident_anchor: { anchor_index: 'first' } }));

    expect(result).toEqual({
      kind: 'error',
      error: { code: 'INVALID_INCIDENT_ANCHOR', message: 'core.incident_anchor 欄位型別不正確' },
    });
  });
});
