import * as fc from 'fast-check';
import { describe, expect } from 'vitest';
import { Severity } from '@city-commander/shared-schemas';
import { calculateEte } from '../../src/rule_engine/ete_calculator.js';
import { propertyTest } from '../helpers/pbt-helper.js';

describe('ETE formula properties', () => {
  /** Validates: Requirements REQ-009, REQ-020 */
  propertyTest(22, 'ETE equals severity base plus official congestion penalty', fc.record({ severity: fc.constantFrom(...Object.values(Severity)), saturation: fc.double({ min: 0, max: 1, noNaN: true }) }), ({ severity, saturation }) => {
    const result = calculateEte({ severity, affected_set: { mode: 'directly_affected_roads_at_event_snapshot', affected_set: ['RD'], formula_applicability: 'applicable' }, snapshot_provenance: { selection_status: 'common_exact_snapshot', event_timestamp: '2026-05-20 22:10', common_snapshot_timestamp: '2026-05-20 22:10', readings: [{ road_id: 'RD', observation_timestamp: '2026-05-20 22:10', saturation_score: saturation }] } });
    const base = severity === Severity.Critical ? 60 : severity === Severity.High ? 40 : 20;
    expect(result.ete_minutes).toBeCloseTo(base + Math.max(0, (saturation - 0.5) * 60), 10);
  });
});
