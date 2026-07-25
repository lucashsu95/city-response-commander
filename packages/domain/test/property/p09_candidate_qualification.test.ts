import * as fc from 'fast-check';
import { describe, expect } from 'vitest';
import { qualifyCandidates } from '../../src/rule_engine/article2.js';
import { RoadNetworkModel } from '../../src/road_network/road_network_model.js';
import { propertyTest } from '../helpers/pbt-helper.js';

describe('SOP-2 qualification properties', () => {
  /** Validates: Requirements REQ-013 */
  propertyTest(9, 'candidate qualification is exactly capacity direct-intersection and upstream', fc.record({
    capacity: fc.integer({ min: 0, max: 3000 }), saturation: fc.double({ min: 0, max: 1, noNaN: true }), direct: fc.boolean(), upstream: fc.boolean(),
  }), (v) => {
    const candidateName = v.direct ? (v.upstream ? 'Candidate' : 'Candidate') : 'Other';
    const intersections = v.upstream ? [candidateName, 'Anchor'] : ['Anchor', candidateName];
    const network = RoadNetworkModel.load([
      { segment_id: 'RD_INC', name: 'Incident', flow_direction: 'x', intersections, capacity_vph: 2000, alternatives: ['RD_CAND'], nearby_stations: [] },
      { segment_id: 'RD_CAND', name: v.direct ? 'Candidate' : 'Not Direct', flow_direction: 'y', intersections: [], capacity_vph: v.capacity, alternatives: [], nearby_stations: [] },
    ]);
    const candidate = qualifyCandidates('RD_INC', 'Anchor', network, new Map([['RD_CAND', v.saturation]]))[0];
    const qualifies = v.capacity >= 1000 && v.direct && v.upstream;
    expect(candidate.role === 'primary').toBe(qualifies);
    if (qualifies) expect(candidate.saturation_at_snapshot).toBe(v.saturation);
  });
});
