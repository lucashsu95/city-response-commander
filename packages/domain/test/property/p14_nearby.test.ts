import * as fc from 'fast-check';
import { describe, expect } from 'vitest';
import { RoadNetworkModel } from '../../src/road_network/road_network_model.js';
import { propertyTest } from '../helpers/pbt-helper.js';

describe('Nearby station properties', () => {
  /** Validates: Requirements REQ-027 */
  propertyTest(14, 'an empty nearby-stations array stays empty', fc.string({ minLength: 1, maxLength: 12 }), (id) => {
    const model = RoadNetworkModel.load([{ segment_id: id, name: id, flow_direction: 'x', intersections: [], capacity_vph: 1, alternatives: [], nearby_stations: [] }]);
    expect(model.nearbyStations(id)).toEqual([]);
    expect(model.getSegment(id)?.nearby_stations).toEqual([]);
  });
});
