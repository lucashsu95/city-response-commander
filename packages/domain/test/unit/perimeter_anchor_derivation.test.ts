/**
 * derivePerimeterAnchors tests (spec: boundary-snapping-containment, R4 AC1/AC2/AC6/AC7).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it, expect } from 'vitest';
import { derivePerimeterAnchors } from '../../src/boundary/boundary_snapper.js';
import { parseRoadNetworkJson } from '../../src/ingestion/road_network_parser.js';
import { RoadNetworkModel } from '../../src/road_network/road_network_model.js';
import { roadNetwork } from '../helpers/domain-fixtures.js';

const ROAD_NETWORK_PATH = resolve(__dirname, '../../../../中華電信資料集/road_network_geometry.json');

describe('derivePerimeterAnchors', () => {
  describe('golden fixture — official 15-segment road_network_geometry.json', () => {
    const officialNetwork = RoadNetworkModel.load(
      parseRoadNetworkJson(readFileSync(ROAD_NETWORK_PATH, 'utf-8')),
    );

    it('derives exactly one Perimeter_Anchor: RD_TPE_009 / 正氣橋', () => {
      // Hand-verified against the 15 official segments: every intersection
      // name used across the network resolves to some segment's `name`,
      // except '正氣橋' (only listed under RD_TPE_009's intersections; no
      // segment is named 正氣橋).
      const anchors = derivePerimeterAnchors(officialNetwork);
      expect(anchors).toEqual([
        { segment_id: 'RD_TPE_009', gateway_intersection: '正氣橋', capacity_vph: 2800 },
      ]);
    });

    it('every anchor segment_id is a real Road_Whitelist member (R4 AC6)', () => {
      const validSegmentIds = new Set(officialNetwork.getAllSegments().map((s) => s.segment_id));
      for (const anchor of derivePerimeterAnchors(officialNetwork)) {
        expect(validSegmentIds.has(anchor.segment_id)).toBe(true);
      }
    });

    it('every anchor gateway_intersection is a real Intersection_Whitelist member (R4 AC7)', () => {
      const validIntersectionNames = new Set(
        officialNetwork.getAllSegments().flatMap((s) => s.intersections),
      );
      for (const anchor of derivePerimeterAnchors(officialNetwork)) {
        expect(validIntersectionNames.has(anchor.gateway_intersection)).toBe(true);
      }
    });

    it('no anchor gateway_intersection matches any segment name (that would make it NOT a gateway)', () => {
      const segmentNames = new Set(officialNetwork.getAllSegments().map((s) => s.name));
      for (const anchor of derivePerimeterAnchors(officialNetwork)) {
        expect(segmentNames.has(anchor.gateway_intersection)).toBe(false);
      }
    });
  });

  describe('caching (topology is immutable once loaded)', () => {
    it('returns the same array reference on repeated calls for the same RoadNetworkModel instance', () => {
      const network = roadNetwork();
      const first = derivePerimeterAnchors(network);
      const second = derivePerimeterAnchors(network);
      expect(first).toBe(second);
    });

    it('computes independently for different RoadNetworkModel instances with different topology', () => {
      const networkA = roadNetwork();
      const networkB = RoadNetworkModel.load([
        { segment_id: 'RD_X_001', name: 'X路', flow_direction: '南北向', intersections: ['外部路口'], capacity_vph: 1000, alternatives: [], nearby_stations: [] },
      ]);
      const anchorsA = derivePerimeterAnchors(networkA);
      const anchorsB = derivePerimeterAnchors(networkB);
      expect(anchorsB).toEqual([
        { segment_id: 'RD_X_001', gateway_intersection: '外部路口', capacity_vph: 1000 },
      ]);
      expect(anchorsA).not.toEqual(anchorsB);
    });
  });

  describe('edge cases', () => {
    it('returns an empty array when every intersection name resolves to a modeled segment (R4 AC5 precondition)', () => {
      const closedNetwork = RoadNetworkModel.load([
        { segment_id: 'RD_A', name: 'A路', flow_direction: '南北向', intersections: ['B路'], capacity_vph: 1000, alternatives: [], nearby_stations: [] },
        { segment_id: 'RD_B', name: 'B路', flow_direction: '東西向', intersections: ['A路'], capacity_vph: 1000, alternatives: [], nearby_stations: [] },
      ]);
      expect(derivePerimeterAnchors(closedNetwork)).toEqual([]);
    });

    it('emits one anchor per (segment, gateway_intersection) pair, not deduplicated across segments', () => {
      const network = RoadNetworkModel.load([
        { segment_id: 'RD_A', name: 'A路', flow_direction: '南北向', intersections: ['外部路口'], capacity_vph: 1000, alternatives: [], nearby_stations: [] },
        { segment_id: 'RD_B', name: 'B路', flow_direction: '東西向', intersections: ['外部路口'], capacity_vph: 2000, alternatives: [], nearby_stations: [] },
      ]);
      const anchors = derivePerimeterAnchors(network);
      expect(anchors).toHaveLength(2);
      expect(anchors).toEqual([
        { segment_id: 'RD_A', gateway_intersection: '外部路口', capacity_vph: 1000 },
        { segment_id: 'RD_B', gateway_intersection: '外部路口', capacity_vph: 2000 },
      ]);
    });

    it('the 5-segment unit-test fixture (domain-fixtures.roadNetwork) has exactly one gateway: RD_TPE_002 / 忠孝東路四段', () => {
      // Hand-verified: names in this subset are {光復南路, 市民大道四段,
      // 仁愛路四段, 敦化南路一段, 延吉街}. RD_TPE_002 lists 忠孝東路四段,
      // which is not among them (only the full 15-segment network has that
      // segment) — so it is a gateway in this smaller fixture network.
      const anchors = derivePerimeterAnchors(roadNetwork());
      expect(anchors).toEqual([
        { segment_id: 'RD_TPE_002', gateway_intersection: '忠孝東路四段', capacity_vph: 1500 },
      ]);
    });
  });
});
