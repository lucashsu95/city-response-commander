/**
 * Unit tests for Grey-Zone Arbitration Engine (GZAE) — requirements.md R1–R4, R5 AC6/AC9.
 */

import { describe, it, expect } from 'vitest';
import {
  IncidentStatus,
  IncidentType,
  Severity,
  RouteCandidateRole,
  UpstreamDownstream,
} from '@city-commander/shared-schemas';
import type { Incident, RoadSegment, RouteCandidate, SegmentClassification } from '@city-commander/shared-schemas';
import {
  excludeSelfBlockedCandidates,
  diffSelfBlockedExclusions,
  GREY_ZONE_LOWER_BOUND,
  detectPreWarning,
  detectSignalConflicts,
  buildAdjacencyGraph,
  detectCascadingRisk,
} from '../../src/rule_engine/grey_zone_arbitration.js';

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

function makeCandidate(overrides: Partial<RouteCandidate> = {}): RouteCandidate {
  return {
    segment_id: 'RD_TPE_004',
    capacity_vph: 2500,
    passes_capacity: true,
    is_direct_intersection: true,
    upstream_or_downstream: UpstreamDownstream.upstream,
    saturation_at_snapshot: 0.4,
    role: RouteCandidateRole.primary,
    ...overrides,
  };
}

function makeSegment(overrides: Partial<RoadSegment> = {}): RoadSegment {
  return {
    segment_id: 'RD_TPE_001',
    name: '忠孝東路四段',
    flow_direction: '東西向',
    intersections: [],
    capacity_vph: 3000,
    alternatives: [],
    nearby_stations: [],
    ...overrides,
  };
}

// ─── R1: excludeSelfBlockedCandidates ──────────────────────

describe('GZAE R1 — excludeSelfBlockedCandidates', () => {
  it('excludes a candidate blocked by another active incident (AC1, AC2)', () => {
    const candidates = [makeCandidate({ segment_id: 'RD_TPE_004', role: RouteCandidateRole.primary })];
    const other = makeIncident({
      event_id: 'TPE_2026_EVT_099',
      affected_segment: 'RD_TPE_004',
      status: IncidentStatus.Closed,
    });

    const result = excludeSelfBlockedCandidates(candidates, 'TPE_2026_ACC_001', [other]);

    expect(result[0].role).toBe(RouteCandidateRole.excluded);
    expect(result[0].exclusion_reason).toBe(
      '候選路段本身正被事件 TPE_2026_EVT_099 封鎖（status: Closed）',
    );
  });

  it('does not touch a candidate already excluded by the 3-AND check (AC3)', () => {
    const candidates = [
      makeCandidate({
        segment_id: 'RD_TPE_004',
        role: RouteCandidateRole.excluded,
        exclusion_reason: 'capacity_vph 500 < 1000',
      }),
    ];
    const other = makeIncident({
      event_id: 'TPE_2026_EVT_099',
      affected_segment: 'RD_TPE_004',
      status: IncidentStatus.Closed,
    });

    const result = excludeSelfBlockedCandidates(candidates, 'TPE_2026_ACC_001', [other]);

    expect(result[0].exclusion_reason).toBe('capacity_vph 500 < 1000');
  });

  it('does not exclude candidates blocked by a non-blocking status (AC2)', () => {
    const candidates = [makeCandidate({ segment_id: 'RD_TPE_004' })];
    const other = makeIncident({
      event_id: 'TPE_2026_EVT_099',
      affected_segment: 'RD_TPE_004',
      status: IncidentStatus.Caution,
    });

    const result = excludeSelfBlockedCandidates(candidates, 'TPE_2026_ACC_001', [other]);

    expect(result[0].role).toBe(RouteCandidateRole.primary);
  });

  it('excludes nothing when there are no other active incidents', () => {
    const candidates = [makeCandidate()];
    const result = excludeSelfBlockedCandidates(candidates, 'TPE_2026_ACC_001', []);
    expect(result[0].role).toBe(RouteCandidateRole.primary);
  });

  it('ignores the current incident itself, never self-compares (AC6)', () => {
    const candidates = [makeCandidate({ segment_id: 'RD_TPE_002' })];
    const self = makeIncident({ event_id: 'TPE_2026_ACC_001', affected_segment: 'RD_TPE_002' });

    const result = excludeSelfBlockedCandidates(candidates, 'TPE_2026_ACC_001', [self]);

    expect(result[0].role).toBe(RouteCandidateRole.primary);
  });

  it('is pure: does not mutate the input array', () => {
    const candidates = [makeCandidate({ segment_id: 'RD_TPE_004' })];
    const other = makeIncident({ event_id: 'X', affected_segment: 'RD_TPE_004', status: IncidentStatus.Closed });
    excludeSelfBlockedCandidates(candidates, 'TPE_2026_ACC_001', [other]);
    expect(candidates[0].role).toBe(RouteCandidateRole.primary);
  });

  it('is deterministic: same input twice yields same output', () => {
    const candidates = [makeCandidate({ segment_id: 'RD_TPE_004' })];
    const other = makeIncident({ event_id: 'X', affected_segment: 'RD_TPE_004', status: IncidentStatus.Closed });
    const r1 = excludeSelfBlockedCandidates(candidates, 'TPE_2026_ACC_001', [other]);
    const r2 = excludeSelfBlockedCandidates(candidates, 'TPE_2026_ACC_001', [other]);
    expect(r1).toEqual(r2);
  });
});

describe('GZAE R1 — diffSelfBlockedExclusions', () => {
  it('reports only newly-excluded segments, not pre-existing 3-AND exclusions', () => {
    const before = [
      makeCandidate({ segment_id: 'RD_TPE_004', role: RouteCandidateRole.primary }),
      makeCandidate({ segment_id: 'RD_TPE_005', role: RouteCandidateRole.excluded }),
    ];
    const after = [
      makeCandidate({ segment_id: 'RD_TPE_004', role: RouteCandidateRole.excluded }),
      makeCandidate({ segment_id: 'RD_TPE_005', role: RouteCandidateRole.excluded }),
    ];
    expect(diffSelfBlockedExclusions(before, after)).toEqual(['RD_TPE_004']);
  });
});

// ─── R2: detectPreWarning ───────────────────────────────────

describe('GZAE R2 — detectPreWarning', () => {
  it('flags true when in grey zone with a strictly monotonic rising trend (AC3, AC4)', () => {
    const history = [{ saturation_score: 0.78 }, { saturation_score: 0.8 }, { saturation_score: 0.82 }];
    expect(detectPreWarning(0.83, history)).toBe(true);
  });

  it('flags false when in grey zone but not monotonically increasing', () => {
    const history = [{ saturation_score: 0.82 }, { saturation_score: 0.8 }, { saturation_score: 0.83 }];
    expect(detectPreWarning(0.83, history)).toBe(false);
  });

  it('flags false when already at or above the B-level threshold (not grey zone)', () => {
    const history = [{ saturation_score: 0.8 }, { saturation_score: 0.83 }, { saturation_score: 0.86 }];
    expect(detectPreWarning(0.86, history)).toBe(false);
  });

  it('flags false when below the grey-zone lower bound', () => {
    expect(detectPreWarning(GREY_ZONE_LOWER_BOUND - 0.01, [{ saturation_score: 0.7 }, { saturation_score: 0.75 }])).toBe(
      false,
    );
  });

  it('flags false with insufficient history, without interpolating (AC7)', () => {
    expect(detectPreWarning(0.82, [])).toBe(false);
    expect(detectPreWarning(0.82, [{ saturation_score: 0.8 }])).toBe(false);
  });

  it('is deterministic: same input twice yields same output (AC8)', () => {
    const history = [{ saturation_score: 0.78 }, { saturation_score: 0.8 }, { saturation_score: 0.82 }];
    expect(detectPreWarning(0.83, history)).toBe(detectPreWarning(0.83, history));
  });
});

// ─── R3: detectSignalConflicts ──────────────────────────────

describe('GZAE R3 — detectSignalConflicts', () => {
  const classifications: SegmentClassification[] = [
    { segment_id: 'RD_TPE_001', level: null },
    { segment_id: 'RD_TPE_002', level: 'A' },
    { segment_id: 'RD_TPE_003', level: 'B' },
  ];
  const nearbyStationsOf = (segmentId: string): readonly string[] =>
    ({
      RD_TPE_001: ['BS_MRT_BL17'],
      RD_TPE_002: ['BS_TPE_DOME'],
      RD_TPE_003: [],
    })[segmentId] ?? [];

  it('flags crowd_heavy_traffic_light when traffic is free but nearby crowd article triggered (AC2)', () => {
    // BS_TPE_DOME also marked triggered so RD_TPE_002 (A-level) is not "crowd quiet"
    // and does not additionally qualify for AC3 in this fixture — isolates AC2.
    const conflicts = detectSignalConflicts(
      classifications,
      nearbyStationsOf,
      new Set(['BS_MRT_BL17', 'BS_TPE_DOME']),
    );
    expect(conflicts).toEqual([
      {
        segment_id: 'RD_TPE_001',
        conflict_type: 'crowd_heavy_traffic_light',
        advisory_text: '車道彈性縮減並限速，優先保障行人通行',
      },
    ]);
  });

  it('flags traffic_heavy_crowd_light when traffic is A-level but crowd is quiet (AC3)', () => {
    const conflicts = detectSignalConflicts(classifications, nearbyStationsOf, new Set());
    expect(conflicts).toEqual([
      {
        segment_id: 'RD_TPE_002',
        conflict_type: 'traffic_heavy_crowd_light',
        advisory_text: '維持既有車流疏導措施，暫緩人流相關資源調度',
      },
    ]);
  });

  it('flags nothing when neither condition holds (AC4)', () => {
    const conflicts = detectSignalConflicts(classifications, nearbyStationsOf, new Set(['BS_TPE_DOME']));
    expect(conflicts.find((c) => c.segment_id === 'RD_TPE_002')).toBeUndefined();
  });

  it('is deterministic', () => {
    const r1 = detectSignalConflicts(classifications, nearbyStationsOf, new Set(['BS_MRT_BL17']));
    const r2 = detectSignalConflicts(classifications, nearbyStationsOf, new Set(['BS_MRT_BL17']));
    expect(r1).toEqual(r2);
  });
});

// ─── R4: buildAdjacencyGraph / detectCascadingRisk ──────────

describe('GZAE R4 — buildAdjacencyGraph + detectCascadingRisk', () => {
  const segments: RoadSegment[] = [
    makeSegment({ segment_id: 'RD_TPE_001', name: '忠孝東路四段', alternatives: ['RD_TPE_004'] }),
    makeSegment({ segment_id: 'RD_TPE_002', name: '光復南路', intersections: ['忠孝東路四段'] }),
    makeSegment({ segment_id: 'RD_TPE_004', name: '市民大道四段' }),
    makeSegment({ segment_id: 'RD_TPE_009', name: '孤立路段' }),
  ];

  it('links segments via alternatives and via intersections-by-name (AC1)', () => {
    const adjacency = buildAdjacencyGraph(segments);
    expect(adjacency.get('RD_TPE_001')?.has('RD_TPE_004')).toBe(true);
    expect(adjacency.get('RD_TPE_002')?.has('RD_TPE_001')).toBe(true);
    expect(adjacency.get('RD_TPE_009')).toBeUndefined();
  });

  it('flags cascading risk for 2+ non-escalated, adjacent incidents (AC2)', () => {
    const adjacency = buildAdjacencyGraph(segments);
    const incidents = [
      makeIncident({
        event_id: 'A',
        affected_segment: 'RD_TPE_001',
        status: IncidentStatus.Caution,
        severity: Severity.Medium,
      }),
      makeIncident({
        event_id: 'B',
        affected_segment: 'RD_TPE_004',
        status: IncidentStatus.Caution,
        severity: Severity.Medium,
      }),
    ];

    const risk = detectCascadingRisk(incidents, adjacency);

    expect(risk).not.toBeNull();
    expect(risk?.event_ids.sort()).toEqual(['A', 'B']);
    expect(risk?.advisory_text).toContain('2 起鄰近未達 SOP 第 2 條門檻之事件');
  });

  it('excludes incidents that already trigger art.2 (AC3, AC4)', () => {
    const adjacency = buildAdjacencyGraph(segments);
    const incidents = [
      makeIncident({
        event_id: 'A',
        affected_segment: 'RD_TPE_001',
        status: IncidentStatus.Closed,
        severity: Severity.Critical,
      }),
      makeIncident({
        event_id: 'B',
        affected_segment: 'RD_TPE_004',
        status: IncidentStatus.Caution,
        severity: Severity.Medium,
      }),
    ];

    expect(detectCascadingRisk(incidents, adjacency)).toBeNull();
  });

  it('returns null when fewer than 2 incidents are adjacent', () => {
    const adjacency = buildAdjacencyGraph(segments);
    const incidents = [
      makeIncident({
        event_id: 'A',
        affected_segment: 'RD_TPE_009',
        status: IncidentStatus.Caution,
        severity: Severity.Medium,
      }),
    ];
    expect(detectCascadingRisk(incidents, adjacency)).toBeNull();
  });

  it('is deterministic', () => {
    const adjacency = buildAdjacencyGraph(segments);
    const incidents = [
      makeIncident({ event_id: 'A', affected_segment: 'RD_TPE_001', status: IncidentStatus.Caution, severity: Severity.Medium }),
      makeIncident({ event_id: 'B', affected_segment: 'RD_TPE_004', status: IncidentStatus.Caution, severity: Severity.Medium }),
    ];
    expect(detectCascadingRisk(incidents, adjacency)).toEqual(detectCascadingRisk(incidents, adjacency));
  });
});
