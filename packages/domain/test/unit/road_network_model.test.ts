/**
 * Unit tests for road_network_model.ts
 *
 * Validates:
 * - Segments load correctly and are accessible by segment_id
 * - getSegment returns correct segment or undefined
 * - getAllSegments returns all segments in original order
 * - Array orders (intersections, alternatives, nearby_stations) preserved
 * - Empty nearby_stations remains empty after loading
 * - Duplicate segment_id throws an error
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseRoadNetworkJson } from '../../src/ingestion/road_network_parser.js';
import { RoadNetworkModel } from '../../src/road_network/road_network_model.js';

const ROAD_NETWORK_PATH = resolve(
  __dirname,
  '../../../../中華電信資料集/road_network_geometry.json',
);

function loadModel(): RoadNetworkModel {
  const content = readFileSync(ROAD_NETWORK_PATH, 'utf-8');
  const segments = parseRoadNetworkJson(content);
  return RoadNetworkModel.load(segments);
}

describe('RoadNetworkModel', () => {
  describe('load and basic access', () => {
    it('loads all 15 segments', () => {
      const model = loadModel();
      expect(model.size).toBe(15);
    });

    it('getAllSegments returns all 15 in original order', () => {
      const model = loadModel();
      const all = model.getAllSegments();
      expect(all).toHaveLength(15);
      // First and last should match source order
      expect(all[0].segment_id).toBe('RD_TPE_001');
      expect(all[14].segment_id).toBe('RD_TPE_015');
    });

    it('getSegment returns the correct segment by ID', () => {
      const model = loadModel();
      const seg = model.getSegment('RD_TPE_002');
      expect(seg).toBeDefined();
      expect(seg!.segment_id).toBe('RD_TPE_002');
      expect(seg!.name).toBe('光復南路');
      expect(seg!.capacity_vph).toBe(1800);
    });

    it('getSegment returns undefined for non-existent ID', () => {
      const model = loadModel();
      expect(model.getSegment('RD_TPE_999')).toBeUndefined();
      expect(model.getSegment('')).toBeUndefined();
    });
  });

  describe('array order preservation', () => {
    it('preserves intersections order (upstream→downstream) for RD_TPE_002', () => {
      const model = loadModel();
      const seg = model.getSegment('RD_TPE_002');
      expect(seg!.intersections).toEqual([
        '市民大道四段',
        '忠孝東路四段',
        '仁愛路四段',
      ]);
    });

    it('preserves alternatives order for RD_TPE_001', () => {
      const model = loadModel();
      const seg = model.getSegment('RD_TPE_001');
      expect(seg!.alternatives).toEqual([
        'RD_TPE_004',
        'RD_TPE_005',
        'RD_TPE_007',
      ]);
    });

    it('preserves intersections order for RD_TPE_007', () => {
      const model = loadModel();
      const seg = model.getSegment('RD_TPE_007');
      expect(seg!.intersections).toEqual(['基隆路一段', '市府路', '松智路']);
    });
  });

  describe('empty nearby_stations remains empty', () => {
    it('RD_TPE_003 has empty nearby_stations', () => {
      const model = loadModel();
      const seg = model.getSegment('RD_TPE_003');
      expect(seg!.nearby_stations).toEqual([]);
      expect(seg!.nearby_stations).toHaveLength(0);
    });

    it('RD_TPE_005 has empty nearby_stations', () => {
      const model = loadModel();
      const seg = model.getSegment('RD_TPE_005');
      expect(seg!.nearby_stations).toEqual([]);
    });

    it('RD_TPE_008 has empty nearby_stations', () => {
      const model = loadModel();
      const seg = model.getSegment('RD_TPE_008');
      expect(seg!.nearby_stations).toEqual([]);
    });

    it('RD_TPE_009 has empty nearby_stations', () => {
      const model = loadModel();
      const seg = model.getSegment('RD_TPE_009');
      expect(seg!.nearby_stations).toEqual([]);
    });
  });

  describe('non-empty nearby_stations preserved', () => {
    it('RD_TPE_001 has 4 nearby stations in order', () => {
      const model = loadModel();
      const seg = model.getSegment('RD_TPE_001');
      expect(seg!.nearby_stations).toEqual([
        'BS_TPE_DOME',
        'BS_MRT_BL17',
        'BS_MRT_BL16',
        'BS_MRT_BL18',
      ]);
    });

    it('RD_TPE_007 has 2 nearby stations', () => {
      const model = loadModel();
      const seg = model.getSegment('RD_TPE_007');
      expect(seg!.nearby_stations).toEqual(['BS_BUS_TERM', 'BS_XY_VIESHOW']);
    });
  });

  describe('alternativesOf', () => {
    it('returns the alternatives list of the segment (one-way, no symmetric inference)', () => {
      const model = loadModel();
      const alts = model.alternativesOf('RD_TPE_002');
      expect(alts).toEqual([
        'RD_TPE_004',
        'RD_TPE_005',
        'RD_TPE_006',
        'RD_TPE_008',
      ]);
    });

    it('A listing B does NOT imply B lists A', () => {
      const model = loadModel();
      // RD_TPE_002 lists RD_TPE_004 in alternatives
      expect(model.alternativesOf('RD_TPE_002')).toContain('RD_TPE_004');
      // But RD_TPE_004's alternatives should NOT necessarily list RD_TPE_002
      const alts004 = model.alternativesOf('RD_TPE_004');
      // We just verify we're returning what's there - no symmetric inference
      expect(alts004).toBeDefined();
    });

    it('returns empty array for non-existent segment', () => {
      const model = loadModel();
      expect(model.alternativesOf('NONEXISTENT')).toEqual([]);
    });

    it('returns empty array for segment with no alternatives', () => {
      const segments = Object.freeze([
        Object.freeze({
          segment_id: 'RD_TEST',
          name: 'Test Road',
          flow_direction: '東西向',
          intersections: Object.freeze(['X']),
          capacity_vph: 1000,
          alternatives: Object.freeze([]),
          nearby_stations: Object.freeze([]),
        }),
      ]);
      const model = RoadNetworkModel.load(segments);
      expect(model.alternativesOf('RD_TEST')).toEqual([]);
    });
  });

  describe('nearbyStations', () => {
    it('returns the exact nearby_stations set for segment with stations', () => {
      const model = loadModel();
      expect(model.nearbyStations('RD_TPE_001')).toEqual([
        'BS_TPE_DOME',
        'BS_MRT_BL17',
        'BS_MRT_BL16',
        'BS_MRT_BL18',
      ]);
    });

    it('returns empty array for segment with empty nearby_stations (preserved)', () => {
      const model = loadModel();
      expect(model.nearbyStations('RD_TPE_003')).toEqual([]);
      expect(model.nearbyStations('RD_TPE_005')).toEqual([]);
    });

    it('returns empty array for non-existent segment', () => {
      const model = loadModel();
      expect(model.nearbyStations('NONEXISTENT')).toEqual([]);
    });
  });

  describe('positionRelativeToAnchor', () => {
    it('identifies upstream position correctly (index < anchor)', () => {
      const model = loadModel();
      // RD_TPE_002 intersections: [市民大道四段, 忠孝東路四段, 仁愛路四段]
      // 市民大道四段 (index 0) is upstream of 忠孝東路四段 (index 1)
      const result = model.positionRelativeToAnchor(
        'RD_TPE_002',
        '市民大道四段',
        '忠孝東路四段',
      );
      expect(result).toBe('upstream');
    });

    it('identifies downstream position correctly (index > anchor)', () => {
      const model = loadModel();
      // RD_TPE_002 intersections: [市民大道四段, 忠孝東路四段, 仁愛路四段]
      // 仁愛路四段 (index 2) is downstream of 忠孝東路四段 (index 1)
      const result = model.positionRelativeToAnchor(
        'RD_TPE_002',
        '仁愛路四段',
        '忠孝東路四段',
      );
      expect(result).toBe('downstream');
    });

    it('returns null when candidate is the same as anchor (same index)', () => {
      const model = loadModel();
      const result = model.positionRelativeToAnchor(
        'RD_TPE_002',
        '忠孝東路四段',
        '忠孝東路四段',
      );
      expect(result).toBeNull();
    });

    it('returns null when candidate intersection not in the array', () => {
      const model = loadModel();
      const result = model.positionRelativeToAnchor(
        'RD_TPE_002',
        '不存在的路',
        '忠孝東路四段',
      );
      expect(result).toBeNull();
    });

    it('returns null when anchor intersection not in the array', () => {
      const model = loadModel();
      const result = model.positionRelativeToAnchor(
        'RD_TPE_002',
        '市民大道四段',
        '不存在的路',
      );
      expect(result).toBeNull();
    });

    it('returns null for non-existent segment', () => {
      const model = loadModel();
      const result = model.positionRelativeToAnchor(
        'NONEXISTENT',
        '市民大道四段',
        '忠孝東路四段',
      );
      expect(result).toBeNull();
    });

    it('works for RD_TPE_007 intersections [基隆路一段, 市府路, 松智路]', () => {
      const model = loadModel();
      // 基隆路一段 (index 0) upstream of 松智路 (index 2)
      expect(
        model.positionRelativeToAnchor('RD_TPE_007', '基隆路一段', '松智路'),
      ).toBe('upstream');
      // 松智路 (index 2) downstream of 市府路 (index 1)
      expect(
        model.positionRelativeToAnchor('RD_TPE_007', '松智路', '市府路'),
      ).toBe('downstream');
    });
  });

  describe('isDirectIntersection', () => {
    it('returns true when candidate road name is in intersections', () => {
      const model = loadModel();
      // RD_TPE_002 intersections: [市民大道四段, 忠孝東路四段, 仁愛路四段]
      expect(model.isDirectIntersection('RD_TPE_002', '市民大道四段')).toBe(
        true,
      );
      expect(model.isDirectIntersection('RD_TPE_002', '忠孝東路四段')).toBe(
        true,
      );
      expect(model.isDirectIntersection('RD_TPE_002', '仁愛路四段')).toBe(
        true,
      );
    });

    it('returns false when candidate road name is NOT in intersections', () => {
      const model = loadModel();
      expect(model.isDirectIntersection('RD_TPE_002', '敦化南路一段')).toBe(
        false,
      );
      expect(model.isDirectIntersection('RD_TPE_002', '不存在的路')).toBe(
        false,
      );
    });

    it('returns false for non-existent segment', () => {
      const model = loadModel();
      expect(model.isDirectIntersection('NONEXISTENT', '市民大道四段')).toBe(
        false,
      );
    });
  });

  describe('error cases', () => {
    it('throws on duplicate segment_id', () => {
      const segments = Object.freeze([
        Object.freeze({
          segment_id: 'RD_DUP',
          name: 'Road A',
          flow_direction: '東西向',
          intersections: Object.freeze(['X']),
          capacity_vph: 1000,
          alternatives: Object.freeze([]),
          nearby_stations: Object.freeze([]),
        }),
        Object.freeze({
          segment_id: 'RD_DUP',
          name: 'Road B',
          flow_direction: '南北向',
          intersections: Object.freeze(['Y']),
          capacity_vph: 2000,
          alternatives: Object.freeze([]),
          nearby_stations: Object.freeze([]),
        }),
      ]);
      expect(() => RoadNetworkModel.load(segments)).toThrow(
        /Duplicate segment_id/,
      );
    });
  });
});
