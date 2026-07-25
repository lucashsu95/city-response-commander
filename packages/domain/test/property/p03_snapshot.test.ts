import * as fc from 'fast-check';
import { describe, expect } from 'vitest';
import { exactOrLatestPriorPerEntity } from '../../src/strategies/time_alignment_strategy.js';
import { propertyTest } from '../helpers/pbt-helper.js';

describe('Strategy A snapshot properties', () => {
  /** Validates: Requirements REQ-001 */
  propertyTest(3, 'selects cohesive per-entity latest-prior rows and never future rows', fc.record({
    eventMinute: fc.integer({ min: 0, max: 120 }),
    rows: fc.uniqueArray(fc.integer({ min: 0, max: 180 }), { maxLength: 20 }),
  }), ({ eventMinute, rows }) => {
    const base = new Date(2026, 4, 20, 20, 0).getTime();
    const records = rows.map((minute) => ({ timestamp_normalized: new Date(base + minute * 60_000), user_count: minute, growth_rate: minute / 1000, marker: `row-${minute}` }));
    const event = new Date(base + eventMinute * 60_000);
    const result = exactOrLatestPriorPerEntity.select('BS_X', event, records, { mode: 'exact_or_latest_prior_per_entity', max_staleness_minutes: 1_000 });
    const legal = rows.filter((minute) => minute <= eventMinute).sort((a, b) => b - a);
    if (legal.length === 0) {
      expect(result.data_status).toBe('insufficient_data'); expect(result.record).toBeNull();
    } else {
      expect(result.record?.timestamp_normalized.getTime()).toBeLessThanOrEqual(event.getTime());
      expect(result.record?.marker).toBe(`row-${legal[0]}`);
      expect(result.record?.user_count).toBe(legal[0]);
      expect(result.record?.growth_rate).toBe(legal[0] / 1000);
    }
  });
});
