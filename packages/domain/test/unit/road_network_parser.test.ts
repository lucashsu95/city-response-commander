/**
 * Unit tests for road_network_parser.ts
 *
 * Validates:
 * - Well-formed JSON is parsed into RoadSegment[] with correct field types
 * - intersections order (upstream→downstream) is preserved
 * - alternatives order is preserved verbatim
 * - Empty nearby_stations remains empty (not filled)
 * - Malformed geometry → abort with RoadNetworkParseError
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  parseRoadNetworkJson,
  RoadNetworkParseError,
} from '../../src/ingestion/road_network_parser.js';

// Load the actual official data for integration-level assertions
const ROAD_NETWORK_PATH = resolve(
  __dirname,
  '../../../../中華電信資料集/road_network_geometry.json',
);

describe('parseRoadNetworkJson', () => {
  describe('well-formed data', () => {
    it('parses the official road_network_geometry.json into 15 segments', () => {
      const content = readFileSync(ROAD_NETWORK_PATH, 'utf-8');
      const segments = parseRoadNetworkJson(content);
      expect(segments).toHaveLength(15);
    });

    it('preserves segment_id correctly for all segments', () => {
      const content = readFileSync(ROAD_NETWORK_PATH, 'utf-8');
      const segments = parseRoadNetworkJson(content);
      const ids = segments.map((s) => s.segment_id);
      expect(ids).toContain('RD_TPE_001');
      expect(ids).toContain('RD_TPE_015');
    });

    it('preserves intersections order (upstream→downstream) for RD_TPE_002', () => {
      const content = readFileSync(ROAD_NETWORK_PATH, 'utf-8');
      const segments = parseRoadNetworkJson(content);
      const rd002 = segments.find((s) => s.segment_id === 'RD_TPE_002');
      expect(rd002).toBeDefined();
      // Per official data: upstream → downstream
      expect(rd002!.intersections).toEqual([
        '市民大道四段',
        '忠孝東路四段',
        '仁愛路四段',
      ]);
    });

    it('preserves alternatives order verbatim for RD_TPE_002', () => {
      const content = readFileSync(ROAD_NETWORK_PATH, 'utf-8');
      const segments = parseRoadNetworkJson(content);
      const rd002 = segments.find((s) => s.segment_id === 'RD_TPE_002');
      expect(rd002).toBeDefined();
      expect(rd002!.alternatives).toEqual([
        'RD_TPE_004',
        'RD_TPE_005',
        'RD_TPE_006',
        'RD_TPE_008',
      ]);
    });

    it('keeps empty nearby_stations as empty array (RD_TPE_003)', () => {
      const content = readFileSync(ROAD_NETWORK_PATH, 'utf-8');
      const segments = parseRoadNetworkJson(content);
      const rd003 = segments.find((s) => s.segment_id === 'RD_TPE_003');
      expect(rd003).toBeDefined();
      expect(rd003!.nearby_stations).toEqual([]);
      expect(rd003!.nearby_stations).toHaveLength(0);
    });

    it('preserves non-empty nearby_stations for RD_TPE_001', () => {
      const content = readFileSync(ROAD_NETWORK_PATH, 'utf-8');
      const segments = parseRoadNetworkJson(content);
      const rd001 = segments.find((s) => s.segment_id === 'RD_TPE_001');
      expect(rd001).toBeDefined();
      expect(rd001!.nearby_stations).toEqual([
        'BS_TPE_DOME',
        'BS_MRT_BL17',
        'BS_MRT_BL16',
        'BS_MRT_BL18',
      ]);
    });

    it('parses capacity_vph as a number', () => {
      const content = readFileSync(ROAD_NETWORK_PATH, 'utf-8');
      const segments = parseRoadNetworkJson(content);
      const rd008 = segments.find((s) => s.segment_id === 'RD_TPE_008');
      expect(rd008).toBeDefined();
      expect(rd008!.capacity_vph).toBe(600);
      expect(typeof rd008!.capacity_vph).toBe('number');
    });

    it('returns a frozen array (readonly)', () => {
      const content = readFileSync(ROAD_NETWORK_PATH, 'utf-8');
      const segments = parseRoadNetworkJson(content);
      expect(Object.isFrozen(segments)).toBe(true);
    });

    it('returns frozen segment objects with frozen arrays', () => {
      const content = readFileSync(ROAD_NETWORK_PATH, 'utf-8');
      const segments = parseRoadNetworkJson(content);
      const seg = segments[0];
      expect(Object.isFrozen(seg)).toBe(true);
      expect(Object.isFrozen(seg.intersections)).toBe(true);
      expect(Object.isFrozen(seg.alternatives)).toBe(true);
      expect(Object.isFrozen(seg.nearby_stations)).toBe(true);
    });

    it('parses a minimal valid JSON array', () => {
      const json = JSON.stringify([
        {
          segment_id: 'RD_TEST_001',
          name: 'Test Road',
          flow_direction: '東西向',
          intersections: ['A', 'B'],
          capacity_vph: 1000,
          alternatives: ['RD_TEST_002'],
          nearby_stations: [],
        },
      ]);
      const segments = parseRoadNetworkJson(json);
      expect(segments).toHaveLength(1);
      expect(segments[0].segment_id).toBe('RD_TEST_001');
      expect(segments[0].nearby_stations).toEqual([]);
    });
  });

  describe('malformed data → abort', () => {
    it('throws INVALID_JSON for non-JSON content', () => {
      expect(() => parseRoadNetworkJson('not json {')).toThrow(
        RoadNetworkParseError,
      );
      try {
        parseRoadNetworkJson('not json {');
      } catch (e) {
        expect((e as RoadNetworkParseError).code).toBe('INVALID_JSON');
      }
    });

    it('throws NOT_ARRAY for a JSON object (not array)', () => {
      expect(() => parseRoadNetworkJson('{"key": "value"}')).toThrow(
        RoadNetworkParseError,
      );
      try {
        parseRoadNetworkJson('{"key": "value"}');
      } catch (e) {
        expect((e as RoadNetworkParseError).code).toBe('NOT_ARRAY');
      }
    });

    it('throws EMPTY_DATA for empty array', () => {
      expect(() => parseRoadNetworkJson('[]')).toThrow(RoadNetworkParseError);
      try {
        parseRoadNetworkJson('[]');
      } catch (e) {
        expect((e as RoadNetworkParseError).code).toBe('EMPTY_DATA');
      }
    });

    it('throws INVALID_SEGMENT for missing segment_id', () => {
      const json = JSON.stringify([
        {
          name: 'Test',
          flow_direction: '東西向',
          intersections: [],
          capacity_vph: 1000,
          alternatives: [],
          nearby_stations: [],
        },
      ]);
      expect(() => parseRoadNetworkJson(json)).toThrow(RoadNetworkParseError);
      try {
        parseRoadNetworkJson(json);
      } catch (e) {
        expect((e as RoadNetworkParseError).code).toBe('INVALID_SEGMENT');
        expect((e as RoadNetworkParseError).details?.field).toBe('segment_id');
      }
    });

    it('throws INVALID_SEGMENT for non-array intersections', () => {
      const json = JSON.stringify([
        {
          segment_id: 'RD_TEST_001',
          name: 'Test',
          flow_direction: '東西向',
          intersections: 'not an array',
          capacity_vph: 1000,
          alternatives: [],
          nearby_stations: [],
        },
      ]);
      expect(() => parseRoadNetworkJson(json)).toThrow(RoadNetworkParseError);
      try {
        parseRoadNetworkJson(json);
      } catch (e) {
        expect((e as RoadNetworkParseError).code).toBe('INVALID_SEGMENT');
        expect((e as RoadNetworkParseError).details?.field).toBe(
          'intersections',
        );
      }
    });

    it('throws INVALID_SEGMENT for non-numeric capacity_vph', () => {
      const json = JSON.stringify([
        {
          segment_id: 'RD_TEST_001',
          name: 'Test',
          flow_direction: '東西向',
          intersections: [],
          capacity_vph: 'high',
          alternatives: [],
          nearby_stations: [],
        },
      ]);
      expect(() => parseRoadNetworkJson(json)).toThrow(RoadNetworkParseError);
      try {
        parseRoadNetworkJson(json);
      } catch (e) {
        expect((e as RoadNetworkParseError).code).toBe('INVALID_SEGMENT');
        expect((e as RoadNetworkParseError).details?.field).toBe(
          'capacity_vph',
        );
      }
    });

    it('throws INVALID_SEGMENT for null element in array', () => {
      const json = JSON.stringify([null]);
      expect(() => parseRoadNetworkJson(json)).toThrow(RoadNetworkParseError);
      try {
        parseRoadNetworkJson(json);
      } catch (e) {
        expect((e as RoadNetworkParseError).code).toBe('INVALID_SEGMENT');
      }
    });

    it('throws INVALID_SEGMENT for intersections containing non-string', () => {
      const json = JSON.stringify([
        {
          segment_id: 'RD_TEST_001',
          name: 'Test',
          flow_direction: '東西向',
          intersections: ['A', 123],
          capacity_vph: 1000,
          alternatives: [],
          nearby_stations: [],
        },
      ]);
      expect(() => parseRoadNetworkJson(json)).toThrow(RoadNetworkParseError);
    });
  });
});
