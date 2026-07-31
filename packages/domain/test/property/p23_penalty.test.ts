import * as fc from 'fast-check';
import { describe, expect } from 'vitest';
import { Severity } from '@city-commander/shared-schemas';
import { calculateEte } from '../../src/ete/ete_calculator.js';
import { propertyTest } from '../helpers/pbt-helper.js';

describe('ETE penalty properties', () => {
  /** Validates: Requirements REQ-020 */
  propertyTest(23, 'congestion penalty is non-negative and zero below average 0.5', fc.double({ min: 0, max: 1, noNaN: true }), (saturation) => {
    const result = calculateEte({ severity: Severity.Medium, affected_set: { mode: 'directly_affected_roads_at_event_snapshot', affected_set: ['RD'], formula_applicability: 'applicable' }, snapshot_provenance: { selection_status: 'common_exact_snapshot', event_timestamp: '2026-05-20 22:10', common_snapshot_timestamp: '2026-05-20 22:10', readings: [{ road_id: 'RD', observation_timestamp: '2026-05-20 22:10', saturation_score: saturation }] } });
    expect(result.congestion_penalty).toBeGreaterThanOrEqual(0);
    if (saturation < 0.5) expect(result.congestion_penalty).toBe(0);
  });
});
