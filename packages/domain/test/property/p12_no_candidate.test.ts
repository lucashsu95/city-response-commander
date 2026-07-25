import * as fc from 'fast-check';
import { describe, expect } from 'vitest';
import type { RouteCandidate } from '@city-commander/shared-schemas';
import { selectEvacuation } from '../../src/rule_engine/evacuation_selector.js';
import { propertyTest } from '../helpers/pbt-helper.js';

describe('No-candidate properties', () => {
  /** Validates: Requirements REQ-005 */
  propertyTest(12, 'no qualifying alternative is documented without fabricating a road', fc.uniqueArray(fc.string({ minLength: 1, maxLength: 10 }), { maxLength: 10 }), (ids) => {
    const routes: RouteCandidate[] = ids.map((id) => ({ segment_id: id, capacity_vph: 999, passes_capacity: false, is_direct_intersection: true, upstream_or_downstream: 'upstream', saturation_at_snapshot: 0.1, role: 'excluded', exclusion_reason: 'capacity_vph 999 < 1000' }));
    const result = selectEvacuation(routes);
    expect(result.primary_evacuation).toBeNull();
    expect(result.no_candidate_note).toBe('查無合規替代路段');
    expect(result.secondary_evacuation).toEqual([]);
    expect(result.excluded_candidates.map((route) => route.segment_id)).toEqual(ids);
  });
});
