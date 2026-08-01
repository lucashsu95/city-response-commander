/**
 * Boundary_Snapper.checkEntityScope tests (spec: boundary-snapping-containment, R2).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { checkEntityScope } from '../../src/boundary/boundary_snapper.js';
import { parseRoadNetworkJson } from '../../src/ingestion/road_network_parser.js';
import { parseIncidentsJson } from '../../src/ingestion/incident_parser.js';
import { RoadNetworkModel } from '../../src/road_network/road_network_model.js';
import { roadNetwork, makeIncident } from '../helpers/domain-fixtures.js';

describe('checkEntityScope', () => {
  describe('R2 AC1 — affected_segment in Road_Whitelist', () => {
    it('resolves IN_SCOPE with matched_field=affected_segment', () => {
      const incident = makeIncident({ affected_segment: 'RD_TPE_002' });
      const result = checkEntityScope(incident, roadNetwork());
      expect(result).toEqual({
        coverage_status: 'IN_SCOPE',
        decision_anchor_segment_id: 'RD_TPE_002',
        matched_field: 'affected_segment',
        matched_value: 'RD_TPE_002',
      });
    });
  });

  describe('R2 AC2 — affected_road in Road_Whitelist (affected_segment is not)', () => {
    it('resolves IN_SCOPE with matched_field=affected_road when affected_segment is a BS_ id', () => {
      const incident = makeIncident({
        affected_segment: 'BS_MRT_BL17',
        affected_road: 'RD_TPE_004',
        location: '捷運國父紀念館站 5 號出口',
      });
      const result = checkEntityScope(incident, roadNetwork());
      expect(result).toEqual({
        coverage_status: 'IN_SCOPE',
        decision_anchor_segment_id: 'RD_TPE_004',
        matched_field: 'affected_road',
        matched_value: 'RD_TPE_004',
      });
    });

    it('does not fall through to affected_road when affected_segment already matches (AC1 takes precedence)', () => {
      const incident = makeIncident({
        affected_segment: 'RD_TPE_002',
        affected_road: 'RD_TPE_004',
      });
      const result = checkEntityScope(incident, roadNetwork());
      expect(result.matched_field).toBe('affected_segment');
    });
  });

  describe('R2 AC3/AC6 — intersection text match (single match)', () => {
    it('resolves IN_SCOPE_BY_INTERSECTION using the lexicographically smallest segment_id among matches', () => {
      // '光復南路' is listed as an intersection on both RD_TPE_004 and RD_TPE_005.
      const incident = makeIncident({
        affected_segment: 'RD_TPE_099', // not in whitelist
        affected_road: undefined,
        location: '光復南路口發生事故',
      });
      const result = checkEntityScope(incident, roadNetwork());
      expect(result.coverage_status).toBe('IN_SCOPE_BY_INTERSECTION');
      expect(result.matched_field).toBe('location_intersection');
      expect(result.matched_value).toBe('光復南路');
      // RD_TPE_004 < RD_TPE_005 lexicographically
      expect(result.decision_anchor_segment_id).toBe('RD_TPE_004');
    });

    it('does not accept a section-stripped alias that is not an exact whitelist name', () => {
      const incident = makeIncident({
        affected_segment: 'RD_TPE_099',
        affected_road: undefined,
        location: '忠孝東路發生事故', // segment lists '忠孝東路四段'
      });
      const result = checkEntityScope(incident, roadNetwork());
      expect(result.coverage_status).toBe('OUT_OF_BOUNDS');
      expect(result.matched_value).toBeNull();
    });
  });

  describe('R2 AC4 — no match at all', () => {
    it('resolves OUT_OF_BOUNDS with a null anchor', () => {
      const incident = makeIncident({
        affected_segment: 'RD_TPE_099',
        affected_road: undefined,
        location: '完全不在路網範圍內的地點',
      });
      const result = checkEntityScope(incident, roadNetwork());
      expect(result).toEqual({
        coverage_status: 'OUT_OF_BOUNDS',
        decision_anchor_segment_id: null,
        matched_field: null,
        matched_value: null,
      });
    });
  });

  describe('R2 AC5 — multiple intersection name matches in location text', () => {
    it('prefers the longest matching intersection name', () => {
      // '光復南路' (4 chars) and '忠孝東路四段' (6 chars) both appear.
      const incident = makeIncident({
        affected_segment: 'RD_TPE_099',
        affected_road: undefined,
        location: '光復南路與忠孝東路四段口',
      });
      const result = checkEntityScope(incident, roadNetwork());
      expect(result.matched_value).toBe('忠孝東路四段');
    });

    it('tie-breaks equal-length matches by lexicographically smallest name', () => {
      // Build a network where two equal-length intersection names both appear in the text.
      const network = RoadNetworkModel.load([
        {
          segment_id: 'RD_TPE_100',
          name: 'A路',
          flow_direction: '南北向',
          intersections: ['乙路口'],
          capacity_vph: 1000,
          alternatives: [],
          nearby_stations: [],
        },
        {
          segment_id: 'RD_TPE_101',
          name: 'B路',
          flow_direction: '南北向',
          intersections: ['甲路口'],
          capacity_vph: 1000,
          alternatives: [],
          nearby_stations: [],
        },
      ]);
      const incident = makeIncident({
        affected_segment: 'RD_TPE_099',
        affected_road: undefined,
        location: '甲路口與乙路口之間',
      });
      const result = checkEntityScope(incident, network);
      // Both names are 3 chars — AC5's tie-break is lexicographically smallest,
      // i.e. JS default string ordering (same comparator Array.sort() uses).
      expect(result.matched_value).toBe(['甲路口', '乙路口'].sort()[0]);
    });
  });

  describe('purity / determinism', () => {
    it('returns identical results for repeated calls with the same input', () => {
      const incident = makeIncident({ location: '光復南路口' });
      const network = roadNetwork();
      const first = checkEntityScope(incident, network);
      const second = checkEntityScope(incident, network);
      expect(first).toEqual(second);
    });
  });

  describe('regression against the official 3 live_incidents.json events (done_definition)', () => {
    const ROAD_NETWORK_PATH = resolve(
      __dirname,
      '../../../../中華電信資料集/road_network_geometry.json',
    );
    const LIVE_INCIDENTS_PATH = resolve(
      __dirname,
      '../../../../中華電信資料集/live_incidents.json',
    );
    const officialNetwork = RoadNetworkModel.load(
      parseRoadNetworkJson(readFileSync(ROAD_NETWORK_PATH, 'utf-8')),
    );
    const officialIncidents = parseIncidentsJson(readFileSync(LIVE_INCIDENTS_PATH, 'utf-8'));

    it('all 3 official incidents resolve IN_SCOPE (they are within the official road network)', () => {
      expect(officialIncidents).toHaveLength(3);
      for (const incident of officialIncidents) {
        const result = checkEntityScope(incident, officialNetwork);
        expect(result.coverage_status).toBe('IN_SCOPE');
      }
    });

    it('TPE_2026_ACC_001 matches via affected_segment', () => {
      const incident = officialIncidents.find((i) => i.event_id === 'TPE_2026_ACC_001')!;
      const result = checkEntityScope(incident, officialNetwork);
      expect(result.matched_field).toBe('affected_segment');
      expect(result.decision_anchor_segment_id).toBe('RD_TPE_002');
    });

    it('TPE_2026_EVT_002 matches via affected_road (affected_segment is a BS_ id)', () => {
      const incident = officialIncidents.find((i) => i.event_id === 'TPE_2026_EVT_002')!;
      const result = checkEntityScope(incident, officialNetwork);
      expect(result.matched_field).toBe('affected_road');
      expect(result.decision_anchor_segment_id).toBe('RD_TPE_001');
    });

    it('TPE_2026_EVT_003 matches via affected_segment', () => {
      const incident = officialIncidents.find((i) => i.event_id === 'TPE_2026_EVT_003')!;
      const result = checkEntityScope(incident, officialNetwork);
      expect(result.matched_field).toBe('affected_segment');
      expect(result.decision_anchor_segment_id).toBe('RD_TPE_007');
    });
  });
});
