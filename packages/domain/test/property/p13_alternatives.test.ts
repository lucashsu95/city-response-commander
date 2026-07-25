import * as fc from 'fast-check';
import { describe, expect } from 'vitest';
import { RoadNetworkModel } from '../../src/road_network/road_network_model.js';
import { propertyTest } from '../helpers/pbt-helper.js';

describe('Road alternatives properties', () => {
  /** Validates: Requirements REQ-026 */
  propertyTest(13, 'alternatives are one-way and never inferred symmetrically', fc.string({ minLength: 1, maxLength: 12 }), (suffix) => {
    const a = `A-${suffix}`; const b = `B-${suffix}`;
    const model = RoadNetworkModel.load([
      { segment_id: a, name: a, flow_direction: 'x', intersections: [], capacity_vph: 1, alternatives: [b], nearby_stations: [] },
      { segment_id: b, name: b, flow_direction: 'x', intersections: [], capacity_vph: 1, alternatives: [], nearby_stations: [] },
    ]);
    expect(model.alternativesOf(a)).toEqual([b]);
    expect(model.alternativesOf(b)).toEqual([]);
  });
});
