/**
 * Boundary_Snapper.snap tests (spec: boundary-snapping-containment, R4 AC3-AC8, R5).
 */
import { describe, it, expect } from 'vitest';
import { snap, haversineMeters } from '../../src/boundary/boundary_snapper.js';
import { RoadNetworkModel } from '../../src/road_network/road_network_model.js';
import { makeIncident, roadNetwork } from '../helpers/domain-fixtures.js';
import type { BoundarySnapperConfig } from '@city-commander/shared-schemas';

const disabledConfig: BoundarySnapperConfig = {
  max_snap_distance_meters: 5000,
  coordinate_path_enabled: false,
};

describe('snap', () => {
  describe('R5 AC1/AC2 — config missing', () => {
    it('returns a CONFIG_MISSING error when max_snap_distance_meters is not a finite number', () => {
      const badConfig = { coordinate_path_enabled: false } as unknown as BoundarySnapperConfig;
      const result = snap(makeIncident(), roadNetwork(), badConfig);
      expect(result).toEqual({
        error: 'CONFIG_MISSING',
        missing_key: 'boundary_snapping.max_snap_distance_meters',
      });
    });

    it('does not attempt to snap when config is missing (no anchor computed)', () => {
      const badConfig = { max_snap_distance_meters: NaN, coordinate_path_enabled: false } as BoundarySnapperConfig;
      const result = snap(makeIncident(), roadNetwork(), badConfig);
      expect('error' in result).toBe(true);
    });
  });

  describe('R4 AC5 — no perimeter anchor available', () => {
    it('returns OUT_OF_JURISDICTION with reason no_perimeter_anchor_available', () => {
      const closedNetwork = RoadNetworkModel.load([
        { segment_id: 'RD_A', name: 'A路', flow_direction: '南北向', intersections: ['B路'], capacity_vph: 1000, alternatives: [], nearby_stations: [] },
        { segment_id: 'RD_B', name: 'B路', flow_direction: '東西向', intersections: ['A路'], capacity_vph: 1000, alternatives: [], nearby_stations: [] },
      ]);
      const result = snap(makeIncident(), closedNetwork, disabledConfig);
      expect(result).toEqual({
        coverage_status: 'OUT_OF_JURISDICTION',
        anchor: null,
        distance_meters: null,
        reason: 'no_perimeter_anchor_available',
        evidence: [],
      });
    });
  });

  describe('R4 AC3 — capacity-based selection (coordinate path disabled)', () => {
    const network = RoadNetworkModel.load([
      { segment_id: 'RD_G1', name: 'G1路', flow_direction: '南北向', intersections: ['外部A'], capacity_vph: 1000, alternatives: [], nearby_stations: [] },
      { segment_id: 'RD_G2', name: 'G2路', flow_direction: '南北向', intersections: ['外部B'], capacity_vph: 2000, alternatives: [], nearby_stations: [] },
      { segment_id: 'RD_G3', name: 'G3路', flow_direction: '南北向', intersections: ['外部C'], capacity_vph: 2000, alternatives: [], nearby_stations: [] },
    ]);

    it('picks the highest capacity_vph anchor', () => {
      const result = snap(makeIncident(), network, disabledConfig);
      expect(result).toMatchObject({
        coverage_status: 'OUT_OF_BOUNDS_SNAPPED',
        distance_meters: null,
        reason: 'nearest_perimeter_anchor_by_capacity',
        evidence: ['distance_threshold_not_applicable'],
      });
      expect('anchor' in result && result.anchor?.capacity_vph).toBe(2000);
    });

    it('tie-breaks equal capacity_vph by lexicographically smallest segment_id', () => {
      const result = snap(makeIncident(), network, disabledConfig);
      // RD_G2 and RD_G3 are tied at 2000; RD_G2 < RD_G3.
      expect('anchor' in result && result.anchor?.segment_id).toBe('RD_G2');
    });
  });

  describe('R3 AC3/AC4/AC6, R5 AC6 — coordinate path degradation evidence', () => {
    const network = RoadNetworkModel.load([
      { segment_id: 'RD_G1', name: 'G1路', flow_direction: '南北向', intersections: ['外部A'], capacity_vph: 1000, alternatives: [], nearby_stations: [] },
    ]);

    it('coordinate path disabled -> evidence distance_threshold_not_applicable, distance_meters null', () => {
      const result = snap(makeIncident(), network, { ...disabledConfig });
      expect(result).toMatchObject({ distance_meters: null, evidence: ['distance_threshold_not_applicable'] });
    });

    it('coordinate path enabled but no eventCoordinate supplied -> falls back with distance_threshold_not_applicable', () => {
      const config: BoundarySnapperConfig = { max_snap_distance_meters: 5000, coordinate_path_enabled: true };
      const result = snap(makeIncident(), network, config);
      expect(result).toMatchObject({ distance_meters: null, evidence: ['distance_threshold_not_applicable'] });
    });

    it('invalid coordinate (out of WGS84 bounds) -> evidence invalid_coordinate, falls back to capacity path', () => {
      const config: BoundarySnapperConfig = { max_snap_distance_meters: 5000, coordinate_path_enabled: true };
      const result = snap(makeIncident(), network, config, { lat: 999, lon: 0 });
      expect(result).toMatchObject({ distance_meters: null, evidence: ['invalid_coordinate'] });
    });

    it('valid coordinate but no gazetteer configured -> evidence gazetteer_unavailable, falls back to capacity path', () => {
      const config: BoundarySnapperConfig = { max_snap_distance_meters: 5000, coordinate_path_enabled: true };
      const result = snap(makeIncident(), network, config, { lat: 25, lon: 121 });
      expect(result).toMatchObject({ distance_meters: null, evidence: ['gazetteer_unavailable'] });
    });

    it('gazetteer configured but has no entry for any derived anchor -> evidence gazetteer_unavailable, falls back to capacity path', () => {
      const config: BoundarySnapperConfig = {
        max_snap_distance_meters: 5000,
        coordinate_path_enabled: true,
        anchor_gazetteer: new Map([['RD_UNRELATED', { lat: 0, lon: 0 }]]),
      };
      const result = snap(makeIncident(), network, config, { lat: 25, lon: 121 });
      expect(result).toMatchObject({ distance_meters: null, evidence: ['gazetteer_unavailable'] });
    });
  });

  describe('R4 AC4 — distance-based selection (coordinate path usable)', () => {
    const network = RoadNetworkModel.load([
      { segment_id: 'RD_D1', name: 'D1路', flow_direction: '南北向', intersections: ['外部D1'], capacity_vph: 1000, alternatives: [], nearby_stations: [] },
      { segment_id: 'RD_D2', name: 'D2路', flow_direction: '南北向', intersections: ['外部D2'], capacity_vph: 1000, alternatives: [], nearby_stations: [] },
    ]);
    const gazetteer = new Map([
      ['RD_D1', { lat: 0, lon: 0 }],
      ['RD_D2', { lat: 0, lon: 1 }],
    ]);
    const config: BoundarySnapperConfig = {
      max_snap_distance_meters: 1_000_000,
      coordinate_path_enabled: true,
      anchor_gazetteer: gazetteer,
    };

    it('picks the nearest anchor by haversine distance', () => {
      const eventCoordinate = { lat: 0, lon: 0.4 }; // closer to RD_D1 (lon 0) than RD_D2 (lon 1)
      const result = snap(makeIncident(), network, config, eventCoordinate);
      expect(result).toMatchObject({
        coverage_status: 'OUT_OF_BOUNDS_SNAPPED',
        reason: 'nearest_perimeter_anchor_by_distance',
        evidence: [],
      });
      expect('anchor' in result && result.anchor?.segment_id).toBe('RD_D1');
      expect('distance_meters' in result && typeof result.distance_meters).toBe('number');
    });

    it('tie-breaks equal distances by lexicographically smallest segment_id', () => {
      // From (0,0), a point 0.01deg north and a point 0.01deg east are
      // equidistant on a sphere (both reduce to the same haversine h term).
      const tieNetwork = RoadNetworkModel.load([
        { segment_id: 'RD_TPE_100', name: 'North路', flow_direction: '南北向', intersections: ['外部N'], capacity_vph: 1000, alternatives: [], nearby_stations: [] },
        { segment_id: 'RD_TPE_200', name: 'East路', flow_direction: '東西向', intersections: ['外部E'], capacity_vph: 1000, alternatives: [], nearby_stations: [] },
      ]);
      const tieGazetteer = new Map([
        ['RD_TPE_100', { lat: 0.01, lon: 0 }],
        ['RD_TPE_200', { lat: 0, lon: 0.01 }],
      ]);
      const tieConfig: BoundarySnapperConfig = {
        max_snap_distance_meters: 1_000_000,
        coordinate_path_enabled: true,
        anchor_gazetteer: tieGazetteer,
      };
      const result = snap(makeIncident(), tieNetwork, tieConfig, { lat: 0, lon: 0 });
      expect('anchor' in result && result.anchor?.segment_id).toBe('RD_TPE_100');
    });
  });

  describe('R5 AC3 — Max_Snap_Distance_Meters boundary (R14.7)', () => {
    const network = RoadNetworkModel.load([
      { segment_id: 'RD_D1', name: 'D1路', flow_direction: '南北向', intersections: ['外部D1'], capacity_vph: 1000, alternatives: [], nearby_stations: [] },
    ]);
    const anchorCoordinate = { lat: 25.0478, lon: 121.5319 };
    const eventCoordinate = { lat: 25.06, lon: 121.55 };
    const exactDistance = haversineMeters(eventCoordinate, anchorCoordinate);
    const gazetteer = new Map([['RD_D1', anchorCoordinate]]);

    function snapWithThreshold(threshold: number) {
      const config: BoundarySnapperConfig = {
        max_snap_distance_meters: threshold,
        coordinate_path_enabled: true,
        anchor_gazetteer: gazetteer,
      };
      return snap(makeIncident(), network, config, eventCoordinate);
    }

    it('distance exactly equal to the threshold snaps (not OUT_OF_JURISDICTION)', () => {
      const result = snapWithThreshold(exactDistance);
      expect('coverage_status' in result && result.coverage_status).toBe('OUT_OF_BOUNDS_SNAPPED');
    });

    it('distance one meter below the threshold snaps', () => {
      const result = snapWithThreshold(exactDistance + 1);
      expect('coverage_status' in result && result.coverage_status).toBe('OUT_OF_BOUNDS_SNAPPED');
    });

    it('distance one meter above the threshold is OUT_OF_JURISDICTION', () => {
      const result = snapWithThreshold(exactDistance - 1);
      expect('coverage_status' in result && result.coverage_status).toBe('OUT_OF_JURISDICTION');
      expect('anchor' in result && result.anchor).toBeNull();
      expect('distance_meters' in result && result.distance_meters).toBe(exactDistance);
    });
  });

  describe('purity / determinism', () => {
    it('returns identical results for repeated calls with the same input', () => {
      const network = roadNetwork();
      const first = snap(makeIncident(), network, disabledConfig);
      const second = snap(makeIncident(), network, disabledConfig);
      expect(first).toEqual(second);
    });
  });
});
