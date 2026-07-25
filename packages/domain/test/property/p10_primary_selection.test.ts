import * as fc from 'fast-check';
import { describe, expect } from 'vitest';
import type { RouteCandidate } from '@city-commander/shared-schemas';
import { selectEvacuation } from '../../src/rule_engine/evacuation_selector.js';
import { propertyTest } from '../helpers/pbt-helper.js';

const candidate = (id: string, saturation: number, role: 'primary' | 'secondary'): RouteCandidate => ({ segment_id: id, capacity_vph: 1500, passes_capacity: true, is_direct_intersection: true, upstream_or_downstream: role === 'primary' ? 'upstream' : 'downstream', saturation_at_snapshot: saturation, role });

describe('SOP-2 selection properties', () => {
  /** Validates: Requirements REQ-013 */
  propertyTest(10, 'lowest-saturation qualified route is primary and downstream stays secondary', fc.tuple(fc.double({ min: 0, max: 1, noNaN: true }), fc.double({ min: 0, max: 1, noNaN: true })), ([a, b]) => {
    const result = selectEvacuation([candidate('A', a, 'primary'), candidate('B', b, 'primary'), candidate('DOWN', 0, 'secondary')]);
    expect(result.primary_evacuation).toBe(a <= b ? 'A' : 'B');
    expect(result.secondary_evacuation).toEqual(['DOWN']);
  });
});
