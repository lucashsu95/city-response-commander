import * as fc from 'fast-check';
import { describe, expect } from 'vitest';
import { allSegmentIntersections, unresolvedManualConfirmation } from '../../src/strategies/affected_intersection_scope_strategy.js';
import { makeIncident, roadSegments } from '../helpers/domain-fixtures.js';
import { propertyTest } from '../helpers/pbt-helper.js';

describe('Police scope properties', () => {
  /** Validates: Requirements REQ-018 */
  propertyTest(31, 'unresolved scope never claims an official total and shown totals are provisional examples', fc.boolean(), (showExample) => {
    const incident = makeIncident(); const segment = roadSegments()[0];
    const scope = showExample ? allSegmentIntersections.resolve(incident, segment, { mode: 'all_segment_intersections' }) : unresolvedManualConfirmation.resolve(incident, segment, { mode: 'unresolved_manual_confirmation' });
    expect(scope.official_golden_answer).toBe(false);
    if (showExample) expect(scope.example_classification).toBe('PROVISIONAL_DERIVED_EXAMPLE');
    else expect(scope).toMatchObject({ affected_intersection_count: 'unresolved', total_police: 'unresolved', manual_confirmation_required: true });
  });
});
