import * as fc from 'fast-check';
import { describe, expect } from 'vitest';
import { monitorAlerts } from '../../src/monitoring/alert_monitor.js';
import { propertyTest } from '../helpers/pbt-helper.js';

describe('Alert monitor properties', () => {
  /** Validates: Requirements REQ-002 */
  propertyTest(6, 'anomaly event is emitted iff an official threshold is met', fc.record({
    road: fc.double({ min: 0, max: 1, noNaN: true }), count: fc.integer({ min: 0, max: 50_000 }),
    growth: fc.double({ min: -1, max: 1, noNaN: true }), peak: fc.integer({ min: 0, max: 50_000 }),
    domeGrowth: fc.double({ min: -1, max: 1, noNaN: true }), roaming: fc.double({ min: 0, max: 1, noNaN: true }),
  }), (v) => {
    const expected = v.road >= 0.85 || v.count > 25_000 || v.growth > 0.3 || (v.peak >= 30_000 && v.domeGrowth <= -0.2) || v.roaming >= 0.3;
    const result = monitorAlerts({ road_saturations: [v.road], bl17: { user_count: v.count, growth_rate: v.growth }, dome: { historical_peak: v.peak, current_growth_rate: v.domeGrowth }, station_roaming_rates: [v.roaming] });
    expect(result.anomaly_detected).toBe(expected);
    expect(result.event_type).toBe(expected ? 'anomaly.detected' : null);
  });
});
