import * as fc from 'fast-check';
import { describe, expect } from 'vitest';
import { RoadNetworkModel } from '../../src/road_network/road_network_model.js';
import { propertyTest } from '../helpers/pbt-helper.js';

describe('Intersection ordering properties', () => {
  /** Validates: Requirements REQ-028 */
  propertyTest(15, 'upstream and downstream follow intersection array order', fc.tuple(fc.integer({ min: 0, max: 9 }), fc.integer({ min: 0, max: 9 })).filter(([a, b]) => a !== b), ([candidateIndex, anchorIndex]) => {
    const intersections = Array.from({ length: 10 }, (_, index) => `R${index}`);
    const model = RoadNetworkModel.load([{ segment_id: 'RD', name: 'road', flow_direction: 'forward', intersections, capacity_vph: 1, alternatives: [], nearby_stations: [] }]);
    expect(model.positionRelativeToAnchor('RD', intersections[candidateIndex], intersections[anchorIndex])).toBe(candidateIndex < anchorIndex ? 'upstream' : 'downstream');
  });
});
