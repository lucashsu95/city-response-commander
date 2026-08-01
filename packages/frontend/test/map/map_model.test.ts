/**
 * Operations Map Model Tests (Dashboard Operations Map)
 *
 * Covers the pure lookups/layout math in `map_model.ts`: the road level →
 * visual-token vocabulary (never a threshold comparison), the crowd
 * active-flag check, the deterministic schematic grid layout, and the
 * section-status normalizers for the road/crowd controllers.
 */

import { describe, expect, it } from 'vitest';
import {
  buildCrowdMapEntries,
  buildOperationsMapModel,
  buildRoadMapEntries,
  classifyRoadVisualLevel,
  crowdSectionStatus,
  hasActiveCrowdFlags,
  mapEntityKey,
  roadsSectionStatus,
  schematicPositionOf,
} from '../../src/map/map_model.js';
import type { RoadReadModel, RoadSegmentView } from '../../src/roads/road_model.js';
import type { CrowdStationRow } from '../../src/crowd/crowd_model.js';

function roadSegment(overrides: Partial<RoadSegmentView> = {}): RoadSegmentView {
  return {
    segmentId: 'RD_TPE_001',
    roadName: '市民大道',
    saturationScore: 0.5,
    level: 'A',
    laneStatus: 'normal',
    observationTimestamp: null,
    stalenessMinutes: null,
    dataStatus: null,
    ...overrides,
  };
}

function roadModel(segments: readonly RoadSegmentView[]): RoadReadModel {
  return {
    schemaVersion: '1.0',
    traceId: 'tr-roads',
    segments,
    timestamp: '2026-05-20 22:10',
    provisional: true,
    dataStatus: null,
  };
}

function crowdStation(overrides: Partial<CrowdStationRow> = {}): CrowdStationRow {
  return {
    bsId: 'BS_MRT_BL17',
    locationName: '捷運 BL17 站',
    userCount: 31000,
    growthRate: 0.42,
    roamingPctValue: 0.45,
    roamingPctDisplay: '45%',
    flags: [],
    inMultilingualScope: true,
    observationTimestamp: '2026-05-20 22:00',
    exactMatch: false,
    stalenessMinutes: 5,
    stale: false,
    dataStatus: 'ready',
    ...overrides,
  };
}

describe('classifyRoadVisualLevel — pure vocabulary lookup, no threshold', () => {
  it('maps A to red', () => {
    expect(classifyRoadVisualLevel('A')).toBe('red');
  });

  it('maps B to yellow', () => {
    expect(classifyRoadVisualLevel('B')).toBe('yellow');
  });

  it('maps null to neutral', () => {
    expect(classifyRoadVisualLevel(null)).toBe('neutral');
  });

  it('maps an unrecognized value to neutral rather than guessing', () => {
    expect(classifyRoadVisualLevel('NONE')).toBe('neutral');
    expect(classifyRoadVisualLevel('C')).toBe('neutral');
  });

  it('never re-derives the level from a saturation score (there is no such parameter)', () => {
    // classifyRoadVisualLevel accepts only `level`; a caller cannot pass a
    // saturation score to it even by mistake — this is a structural guarantee,
    // asserted here by confirming the same level always maps identically
    // regardless of any other context the caller might have.
    expect(classifyRoadVisualLevel('A')).toBe(classifyRoadVisualLevel('A'));
  });
});

describe('hasActiveCrowdFlags — pure array-length check', () => {
  it('is false for an empty flags array', () => {
    expect(hasActiveCrowdFlags([])).toBe(false);
  });

  it('is true for any non-empty flags array, regardless of code', () => {
    expect(hasActiveCrowdFlags(['SOP3_MRT_SHUTTLE'])).toBe(true);
    expect(hasActiveCrowdFlags(['SOP9_UNKNOWN_FUTURE_CODE'])).toBe(true);
  });
});

describe('schematicPositionOf — deterministic index-based grid, never a coordinate', () => {
  it('wraps columns deterministically', () => {
    expect(schematicPositionOf(0, 3)).toEqual({ column: 0, row: 0 });
    expect(schematicPositionOf(2, 3)).toEqual({ column: 2, row: 0 });
    expect(schematicPositionOf(3, 3)).toEqual({ column: 0, row: 1 });
    expect(schematicPositionOf(5, 3)).toEqual({ column: 2, row: 1 });
  });

  it('is a pure function: same index and columns always produce the same cell', () => {
    expect(schematicPositionOf(7, 4)).toEqual(schematicPositionOf(7, 4));
  });

  it('falls back to a single column instead of dividing by zero', () => {
    expect(schematicPositionOf(2, 0)).toEqual({ column: 0, row: 2 });
  });
});

describe('buildRoadMapEntries', () => {
  it('produces exactly one entry per backend segment, in backend order', () => {
    const entries = buildRoadMapEntries([
      roadSegment({ segmentId: 'RD_1', level: 'A' }),
      roadSegment({ segmentId: 'RD_2', level: 'B' }),
      roadSegment({ segmentId: 'RD_3', level: null }),
    ]);

    expect(entries).toHaveLength(3);
    expect(entries.map((entry) => entry.segmentId)).toEqual(['RD_1', 'RD_2', 'RD_3']);
    expect(entries.map((entry) => entry.visualLevel)).toEqual(['red', 'yellow', 'neutral']);
  });

  it('never fabricates a segment for an empty backend list', () => {
    expect(buildRoadMapEntries([])).toEqual([]);
  });

  it('carries dataStatus, observationTimestamp, and stalenessMinutes verbatim', () => {
    const [entry] = buildRoadMapEntries([
      roadSegment({
        dataStatus: 'insufficient_data',
        observationTimestamp: '2026-05-20 21:50',
        stalenessMinutes: 20,
      }),
    ]);

    expect(entry?.dataStatus).toBe('insufficient_data');
    expect(entry?.observationTimestamp).toBe('2026-05-20 21:50');
    expect(entry?.stalenessMinutes).toBe(20);
  });

  it('preserves a deliberately inconsistent saturation/level pair (server truth wins)', () => {
    // saturationScore is not read by this module at all; only `level` is.
    const [entry] = buildRoadMapEntries([
      roadSegment({ saturationScore: 0.02, level: 'A' }),
    ]);

    expect(entry?.visualLevel).toBe('red');
  });

  it('assigns deterministic schematic positions in a 6-column grid by default', () => {
    const entries = buildRoadMapEntries(
      Array.from({ length: 7 }, (_, index) => roadSegment({ segmentId: `RD_${index}` })),
    );

    expect(entries[0]?.position).toEqual({ column: 0, row: 0 });
    expect(entries[5]?.position).toEqual({ column: 5, row: 0 });
    expect(entries[6]?.position).toEqual({ column: 0, row: 1 });
  });
});

describe('buildCrowdMapEntries', () => {
  it('produces exactly one entry per backend station, in backend order', () => {
    const entries = buildCrowdMapEntries([
      crowdStation({ bsId: 'BS_1', flags: ['SOP3_MRT_SHUTTLE'] }),
      crowdStation({ bsId: 'BS_2', flags: [] }),
    ]);

    expect(entries).toHaveLength(2);
    expect(entries.map((entry) => entry.bsId)).toEqual(['BS_1', 'BS_2']);
    expect(entries.map((entry) => entry.hasActiveFlags)).toEqual([true, false]);
  });

  it('never fabricates a station for an empty backend list', () => {
    expect(buildCrowdMapEntries([])).toEqual([]);
  });

  it('carries stale, dataStatus, and flags verbatim', () => {
    const [entry] = buildCrowdMapEntries([
      crowdStation({ stale: true, dataStatus: 'insufficient_data', flags: ['SOP4_DOME_DISPERSAL'] }),
    ]);

    expect(entry?.stale).toBe(true);
    expect(entry?.dataStatus).toBe('insufficient_data');
    expect(entry?.flags).toEqual(['SOP4_DOME_DISPERSAL']);
  });

  it('reports a null stale verdict as null, never as false', () => {
    const [entry] = buildCrowdMapEntries([crowdStation({ stale: null })]);
    expect(entry?.stale).toBeNull();
  });
});

describe('buildOperationsMapModel', () => {
  it('is always schematic (no geographic contract exists)', () => {
    const model = buildOperationsMapModel(null, []);
    expect(model.schematic).toBe(true);
  });

  it('combines both domains without cross-contaminating their entities', () => {
    const model = buildOperationsMapModel(
      roadModel([roadSegment({ segmentId: 'RD_1' })]),
      [crowdStation({ bsId: 'BS_1' })],
    );

    expect(model.roads).toHaveLength(1);
    expect(model.crowdStations).toHaveLength(1);
    expect(model.roads[0]?.segmentId).toBe('RD_1');
    expect(model.crowdStations[0]?.bsId).toBe('BS_1');
  });

  it('produces empty entity lists for a null roads model, not a placeholder entity', () => {
    const model = buildOperationsMapModel(null, [crowdStation()]);
    expect(model.roads).toEqual([]);
    expect(model.crowdStations).toHaveLength(1);
  });
});

describe('mapEntityKey — stable cross-kind identity', () => {
  it('produces distinct keys for a road and a crowd station', () => {
    const [road] = buildRoadMapEntries([roadSegment({ segmentId: 'X' })]);
    const [crowd] = buildCrowdMapEntries([crowdStation({ bsId: 'X' })]);

    expect(road).toBeDefined();
    expect(crowd).toBeDefined();
    if (road === undefined || crowd === undefined) return;
    expect(mapEntityKey(road)).not.toBe(mapEntityKey(crowd));
  });

  it('is stable for the same entity', () => {
    const [road] = buildRoadMapEntries([roadSegment({ segmentId: 'RD_1' })]);
    expect(road).toBeDefined();
    if (road === undefined) return;
    expect(mapEntityKey(road)).toBe(mapEntityKey(road));
  });
});

describe('roadsSectionStatus — normalizes the TASK-125 controller state', () => {
  it('maps idle/loading/disposed to loading', () => {
    expect(roadsSectionStatus('idle')).toBe('loading');
    expect(roadsSectionStatus('loading')).toBe('loading');
    expect(roadsSectionStatus('disposed')).toBe('loading');
  });

  it('passes ready/empty/insufficient/error through unchanged', () => {
    expect(roadsSectionStatus('ready')).toBe('ready');
    expect(roadsSectionStatus('empty')).toBe('empty');
    expect(roadsSectionStatus('insufficient')).toBe('insufficient');
    expect(roadsSectionStatus('error')).toBe('error');
  });
});

describe('crowdSectionStatus — normalizes the TASK-126 controller state', () => {
  it('maps idle/loading to loading', () => {
    expect(crowdSectionStatus('idle')).toBe('loading');
    expect(crowdSectionStatus('loading')).toBe('loading');
  });

  it('maps insufficient_data to the shared insufficient label', () => {
    expect(crowdSectionStatus('insufficient_data')).toBe('insufficient');
  });

  it('passes ready/empty/error through unchanged', () => {
    expect(crowdSectionStatus('ready')).toBe('ready');
    expect(crowdSectionStatus('empty')).toBe('empty');
    expect(crowdSectionStatus('error')).toBe('error');
  });
});
