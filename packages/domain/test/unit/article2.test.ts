/**
 * Unit tests for RuleEngine Article 2 — SOP-2 trigger and candidate qualification
 *
 * Verifies:
 * - 3-AND trigger (status, severity, RD_ prefix)
 * - BS_ events do NOT trigger art.2
 * - Candidate qualification uses exactly 3 ANDs (capacity, direct intersection, upstream)
 * - Saturation is NOT a qualification filter
 * - Capacity boundary: 999 fails, 1000 passes
 * - Downstream candidates get 'secondary' role
 * - Anchor unresolved → unranked_direct_intersection
 */

import { describe, it, expect } from 'vitest';
import {
  IncidentStatus,
  IncidentType,
  Severity,
  RouteCandidateRole,
  UpstreamDownstream,
} from '@city-commander/shared-schemas';
import type { Incident, RoadSegment } from '@city-commander/shared-schemas';
import { isArticle2Triggered, qualifyCandidates } from '../../src/rule_engine/article2.js';
import { RoadNetworkModel } from '../../src/road_network/road_network_model.js';

// ─── Test Helpers ──────────────────────────────────────────

function makeIncident(overrides: Partial<Incident> = {}): Incident {
  return {
    event_id: 'TPE_2026_ACC_001',
    type: IncidentType.Road_Collapse_Accident,
    location: '光復南路與忠孝東路口南側',
    affected_segment: 'RD_TPE_002',
    status: IncidentStatus.Closed,
    severity: Severity.Critical,
    description: '路面坍塌',
    timestamp: '2026-05-20 22:10',
    ...overrides,
  };
}

function makeRoadNetwork(segments: RoadSegment[]): RoadNetworkModel {
  return RoadNetworkModel.load(segments);
}

// ─── Trigger Tests ─────────────────────────────────────────

describe('Article 2 — isArticle2Triggered', () => {
  describe('3-AND trigger (all conditions must hold)', () => {
    it('triggers when all three conditions are met (Closed, Critical, RD_)', () => {
      const incident = makeIncident({
        status: IncidentStatus.Closed,
        severity: Severity.Critical,
        affected_segment: 'RD_TPE_002',
      });
      expect(isArticle2Triggered(incident)).toBe(true);
    });

    it('triggers with status=Blocked, severity=High, RD_ prefix', () => {
      const incident = makeIncident({
        status: IncidentStatus.Blocked,
        severity: Severity.High,
        affected_segment: 'RD_TPE_001',
      });
      expect(isArticle2Triggered(incident)).toBe(true);
    });

    it('triggers with status=Restricted, severity=Critical, RD_ prefix', () => {
      const incident = makeIncident({
        status: IncidentStatus.Restricted,
        severity: Severity.Critical,
        affected_segment: 'RD_TPE_005',
      });
      expect(isArticle2Triggered(incident)).toBe(true);
    });
  });

  describe('does NOT trigger when any condition fails', () => {
    it('does not trigger with status=Open (not in set)', () => {
      const incident = makeIncident({
        status: IncidentStatus.Open,
        severity: Severity.Critical,
        affected_segment: 'RD_TPE_002',
      });
      expect(isArticle2Triggered(incident)).toBe(false);
    });

    it('does not trigger with status=Caution (not in set)', () => {
      const incident = makeIncident({
        status: IncidentStatus.Caution,
        severity: Severity.High,
        affected_segment: 'RD_TPE_002',
      });
      expect(isArticle2Triggered(incident)).toBe(false);
    });

    it('does not trigger with severity=Medium (not in set)', () => {
      const incident = makeIncident({
        status: IncidentStatus.Closed,
        severity: Severity.Medium,
        affected_segment: 'RD_TPE_002',
      });
      expect(isArticle2Triggered(incident)).toBe(false);
    });

    it('does not trigger with BS_ affected_segment (routes to art.3)', () => {
      const incident = makeIncident({
        status: IncidentStatus.Closed,
        severity: Severity.Critical,
        affected_segment: 'BS_MRT_BL17',
      });
      expect(isArticle2Triggered(incident)).toBe(false);
    });

    it('does not trigger with BS_TPE_ prefix', () => {
      const incident = makeIncident({
        status: IncidentStatus.Blocked,
        severity: Severity.High,
        affected_segment: 'BS_TPE_DOME',
      });
      expect(isArticle2Triggered(incident)).toBe(false);
    });
  });

  describe('BS_ events route to art.3, not art.2', () => {
    it('BS_MRT_BL17 never triggers art.2 even with all other conditions met', () => {
      const incident = makeIncident({
        status: IncidentStatus.Restricted,
        severity: Severity.High,
        affected_segment: 'BS_MRT_BL17',
      });
      expect(isArticle2Triggered(incident)).toBe(false);
    });
  });
});

// ─── Candidate Qualification Tests ─────────────────────────

describe('Article 2 — qualifyCandidates', () => {
  // Road network fixture:
  // RD_TPE_002 (incident road): intersections=[市民大道四段, 忠孝東路四段, 仁愛路四段]
  //   alternatives=[RD_TPE_004, RD_TPE_005, RD_TPE_006, RD_TPE_008]
  // RD_TPE_004 (市民大道四段): capacity=2500 — in intersections, upstream of anchor "忠孝東路四段"
  // RD_TPE_005 (仁愛路四段): capacity=1800 — in intersections, downstream of anchor
  // RD_TPE_006 (敦化南路一段): capacity=2000 — NOT in intersections
  // RD_TPE_008 (延吉街): capacity=600 — in intersections but capacity < 1000
  const segments: RoadSegment[] = [
    {
      segment_id: 'RD_TPE_002',
      name: '光復南路',
      flow_direction: '南北向',
      intersections: ['市民大道四段', '忠孝東路四段', '仁愛路四段'],
      capacity_vph: 1500,
      alternatives: ['RD_TPE_004', 'RD_TPE_005', 'RD_TPE_006', 'RD_TPE_008'],
      nearby_stations: [],
    },
    {
      segment_id: 'RD_TPE_004',
      name: '市民大道四段',
      flow_direction: '東西向',
      intersections: ['光復南路'],
      capacity_vph: 2500,
      alternatives: [],
      nearby_stations: [],
    },
    {
      segment_id: 'RD_TPE_005',
      name: '仁愛路四段',
      flow_direction: '東西向',
      intersections: ['光復南路'],
      capacity_vph: 1800,
      alternatives: [],
      nearby_stations: [],
    },
    {
      segment_id: 'RD_TPE_006',
      name: '敦化南路一段',
      flow_direction: '南北向',
      intersections: [],
      capacity_vph: 2000,
      alternatives: [],
      nearby_stations: [],
    },
    {
      segment_id: 'RD_TPE_008',
      name: '延吉街',
      flow_direction: '南北向',
      intersections: ['忠孝東路四段'],
      capacity_vph: 600,
      alternatives: [],
      nearby_stations: [],
    },
  ];

  const saturationMap: ReadonlyMap<string, number> = new Map([
    ['RD_TPE_004', 0.72],
    ['RD_TPE_005', 0.80],
    ['RD_TPE_006', 0.60],
    ['RD_TPE_008', 0.50],
  ]);

  describe('full qualification with resolved anchor', () => {
    it('qualifies RD_TPE_004 as primary (capacity>=1000, direct intersection, upstream)', () => {
      const roadNetwork = makeRoadNetwork(segments);
      const candidates = qualifyCandidates(
        'RD_TPE_002',
        '忠孝東路四段', // anchor
        roadNetwork,
        saturationMap,
      );

      const rdTpe004 = candidates.find((c) => c.segment_id === 'RD_TPE_004');
      expect(rdTpe004).toBeDefined();
      expect(rdTpe004!.passes_capacity).toBe(true);
      expect(rdTpe004!.is_direct_intersection).toBe(true);
      expect(rdTpe004!.upstream_or_downstream).toBe(UpstreamDownstream.upstream);
      expect(rdTpe004!.role).toBe(RouteCandidateRole.primary);
      expect(rdTpe004!.exclusion_reason).toBeUndefined();
    });

    it('marks RD_TPE_005 as secondary (downstream of anchor)', () => {
      const roadNetwork = makeRoadNetwork(segments);
      const candidates = qualifyCandidates(
        'RD_TPE_002',
        '忠孝東路四段',
        roadNetwork,
        saturationMap,
      );

      const rdTpe005 = candidates.find((c) => c.segment_id === 'RD_TPE_005');
      expect(rdTpe005).toBeDefined();
      expect(rdTpe005!.passes_capacity).toBe(true);
      expect(rdTpe005!.is_direct_intersection).toBe(true);
      expect(rdTpe005!.upstream_or_downstream).toBe(UpstreamDownstream.downstream);
      expect(rdTpe005!.role).toBe(RouteCandidateRole.secondary);
      expect(rdTpe005!.exclusion_reason).toBeUndefined();
    });

    it('excludes RD_TPE_006 (not in intersections)', () => {
      const roadNetwork = makeRoadNetwork(segments);
      const candidates = qualifyCandidates(
        'RD_TPE_002',
        '忠孝東路四段',
        roadNetwork,
        saturationMap,
      );

      const rdTpe006 = candidates.find((c) => c.segment_id === 'RD_TPE_006');
      expect(rdTpe006).toBeDefined();
      expect(rdTpe006!.is_direct_intersection).toBe(false);
      expect(rdTpe006!.role).toBe(RouteCandidateRole.excluded);
      expect(rdTpe006!.exclusion_reason).toContain('非直接相交');
    });

    it('excludes RD_TPE_008 (capacity 600 < 1000)', () => {
      const roadNetwork = makeRoadNetwork(segments);
      const candidates = qualifyCandidates(
        'RD_TPE_002',
        '忠孝東路四段',
        roadNetwork,
        saturationMap,
      );

      const rdTpe008 = candidates.find((c) => c.segment_id === 'RD_TPE_008');
      expect(rdTpe008).toBeDefined();
      expect(rdTpe008!.passes_capacity).toBe(false);
      expect(rdTpe008!.capacity_vph).toBe(600);
      expect(rdTpe008!.role).toBe(RouteCandidateRole.excluded);
      expect(rdTpe008!.exclusion_reason).toContain('600');
      expect(rdTpe008!.exclusion_reason).toContain('1000');
    });
  });

  describe('capacity boundary (999 fail / 1000 pass)', () => {
    it('capacity_vph = 999 does NOT pass capacity check', () => {
      const segmentsWithBoundary: RoadSegment[] = [
        {
          segment_id: 'RD_INC',
          name: 'Incident Road',
          flow_direction: '東西向',
          intersections: ['Candidate Road'],
          capacity_vph: 2000,
          alternatives: ['RD_CAND'],
          nearby_stations: [],
        },
        {
          segment_id: 'RD_CAND',
          name: 'Candidate Road',
          flow_direction: '南北向',
          intersections: [],
          capacity_vph: 999,
          alternatives: [],
          nearby_stations: [],
        },
      ];
      const roadNetwork = makeRoadNetwork(segmentsWithBoundary);
      const candidates = qualifyCandidates(
        'RD_INC',
        'Candidate Road', // anchor at the candidate intersection
        roadNetwork,
        new Map([['RD_CAND', 0.5]]),
      );

      const cand = candidates.find((c) => c.segment_id === 'RD_CAND');
      expect(cand).toBeDefined();
      expect(cand!.passes_capacity).toBe(false);
      expect(cand!.role).toBe(RouteCandidateRole.excluded);
    });

    it('capacity_vph = 1000 PASSES capacity check', () => {
      const segmentsWithBoundary: RoadSegment[] = [
        {
          segment_id: 'RD_INC',
          name: 'Incident Road',
          flow_direction: '東西向',
          intersections: ['Candidate Road', 'Anchor Road'],
          capacity_vph: 2000,
          alternatives: ['RD_CAND'],
          nearby_stations: [],
        },
        {
          segment_id: 'RD_CAND',
          name: 'Candidate Road',
          flow_direction: '南北向',
          intersections: [],
          capacity_vph: 1000,
          alternatives: [],
          nearby_stations: [],
        },
      ];
      const roadNetwork = makeRoadNetwork(segmentsWithBoundary);
      // Anchor = 'Anchor Road' (index 1), Candidate Road is at index 0 = upstream
      const candidates = qualifyCandidates(
        'RD_INC',
        'Anchor Road',
        roadNetwork,
        new Map([['RD_CAND', 0.5]]),
      );

      const cand = candidates.find((c) => c.segment_id === 'RD_CAND');
      expect(cand).toBeDefined();
      expect(cand!.passes_capacity).toBe(true);
      expect(cand!.capacity_vph).toBe(1000);
      // Should be primary since upstream + direct intersection + capacity >= 1000
      expect(cand!.role).toBe(RouteCandidateRole.primary);
    });
  });

  describe('Saturation is NOT a qualification filter', () => {
    it('candidate with very high saturation (0.99) still qualifies if 3-AND passes', () => {
      const segmentsHighSat: RoadSegment[] = [
        {
          segment_id: 'RD_INC',
          name: 'Incident Road',
          flow_direction: '東西向',
          intersections: ['Good Road', 'Anchor'],
          capacity_vph: 2000,
          alternatives: ['RD_GOOD'],
          nearby_stations: [],
        },
        {
          segment_id: 'RD_GOOD',
          name: 'Good Road',
          flow_direction: '南北向',
          intersections: [],
          capacity_vph: 1500,
          alternatives: [],
          nearby_stations: [],
        },
      ];
      const roadNetwork = makeRoadNetwork(segmentsHighSat);
      // Very high saturation = 0.99 (should NOT exclude)
      const candidates = qualifyCandidates(
        'RD_INC',
        'Anchor', // anchor at index 1, Good Road at index 0 = upstream
        roadNetwork,
        new Map([['RD_GOOD', 0.99]]),
      );

      const cand = candidates.find((c) => c.segment_id === 'RD_GOOD');
      expect(cand).toBeDefined();
      expect(cand!.saturation_at_snapshot).toBe(0.99);
      // Still primary because saturation is NOT a filter
      expect(cand!.role).toBe(RouteCandidateRole.primary);
    });

    it('records saturation_at_snapshot on each candidate for downstream ranking', () => {
      const roadNetwork = makeRoadNetwork(segments);
      const candidates = qualifyCandidates(
        'RD_TPE_002',
        '忠孝東路四段',
        roadNetwork,
        saturationMap,
      );

      const rdTpe004 = candidates.find((c) => c.segment_id === 'RD_TPE_004');
      expect(rdTpe004!.saturation_at_snapshot).toBe(0.72);

      const rdTpe005 = candidates.find((c) => c.segment_id === 'RD_TPE_005');
      expect(rdTpe005!.saturation_at_snapshot).toBe(0.80);
    });
  });

  describe('anchor unresolved (null)', () => {
    it('marks candidates passing capacity + direct intersection as unranked_direct_intersection', () => {
      const roadNetwork = makeRoadNetwork(segments);
      const candidates = qualifyCandidates(
        'RD_TPE_002',
        null, // anchor unresolved
        roadNetwork,
        saturationMap,
      );

      // RD_TPE_004 passes capacity and is direct intersection → unranked
      const rdTpe004 = candidates.find((c) => c.segment_id === 'RD_TPE_004');
      expect(rdTpe004).toBeDefined();
      expect(rdTpe004!.role).toBe(RouteCandidateRole.unranked_direct_intersection);

      // RD_TPE_005 passes capacity and is direct intersection → unranked
      const rdTpe005 = candidates.find((c) => c.segment_id === 'RD_TPE_005');
      expect(rdTpe005).toBeDefined();
      expect(rdTpe005!.role).toBe(RouteCandidateRole.unranked_direct_intersection);
    });

    it('still excludes candidates failing capacity even when anchor is null', () => {
      const roadNetwork = makeRoadNetwork(segments);
      const candidates = qualifyCandidates(
        'RD_TPE_002',
        null,
        roadNetwork,
        saturationMap,
      );

      const rdTpe008 = candidates.find((c) => c.segment_id === 'RD_TPE_008');
      expect(rdTpe008).toBeDefined();
      expect(rdTpe008!.role).toBe(RouteCandidateRole.excluded);
      expect(rdTpe008!.exclusion_reason).toContain('600');
    });

    it('still excludes candidates not in intersections when anchor is null', () => {
      const roadNetwork = makeRoadNetwork(segments);
      const candidates = qualifyCandidates(
        'RD_TPE_002',
        null,
        roadNetwork,
        saturationMap,
      );

      const rdTpe006 = candidates.find((c) => c.segment_id === 'RD_TPE_006');
      expect(rdTpe006).toBeDefined();
      expect(rdTpe006!.role).toBe(RouteCandidateRole.excluded);
    });
  });

  describe('returns empty when incident segment not found', () => {
    it('returns empty array for unknown segment_id', () => {
      const roadNetwork = makeRoadNetwork(segments);
      const candidates = qualifyCandidates(
        'RD_NONEXISTENT',
        '忠孝東路四段',
        roadNetwork,
        saturationMap,
      );
      expect(candidates).toEqual([]);
    });
  });

  describe('evaluates all alternatives from incident segment', () => {
    it('returns one candidate per alternative', () => {
      const roadNetwork = makeRoadNetwork(segments);
      const candidates = qualifyCandidates(
        'RD_TPE_002',
        '忠孝東路四段',
        roadNetwork,
        saturationMap,
      );

      // RD_TPE_002 has 4 alternatives
      expect(candidates).toHaveLength(4);
      const ids = candidates.map((c) => c.segment_id);
      expect(ids).toContain('RD_TPE_004');
      expect(ids).toContain('RD_TPE_005');
      expect(ids).toContain('RD_TPE_006');
      expect(ids).toContain('RD_TPE_008');
    });
  });
});
