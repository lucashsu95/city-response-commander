import * as fc from 'fast-check';
import { describe, expect } from 'vitest';
import type { RouteCandidate } from '@city-commander/shared-schemas';
import { selectEvacuation } from '../../src/rule_engine/evacuation_selector.js';
import { propertyTest } from '../helpers/pbt-helper.js';

describe('Congested primary properties', () => {
  /** Validates: Requirements REQ-014 */
  propertyTest(11, 'a congested selected primary is maintained with long-green and transit advice', fc.double({ min: 0.85, max: 1, noNaN: true }), (saturation) => {
    const route: RouteCandidate = { segment_id: 'RD_KEEP', capacity_vph: 1000, passes_capacity: true, is_direct_intersection: true, upstream_or_downstream: 'upstream', saturation_at_snapshot: saturation, role: 'primary' };
    const result = selectEvacuation([route]);
    expect(result.primary_evacuation).toBe('RD_KEEP');
    expect(result).toMatchObject({ primary_congested: true, long_green_timing_for_primary: true, public_transit_recommended: true });
    expect(result.congestion_note).toContain('大眾運輸');
  });
});
