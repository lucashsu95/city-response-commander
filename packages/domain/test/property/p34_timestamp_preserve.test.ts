import * as fc from 'fast-check';
import { describe, expect } from 'vitest';
import { normalizeTimestamp } from '../../src/ingestion/timestamp_normalizer.js';
import { propertyTest } from '../helpers/pbt-helper.js';

describe('Timestamp preservation properties', () => {
  /** Validates: Requirements REQ-001 */
  propertyTest(34, 'raw timestamp is preserved while display and instant are normalized', fc.record({
    month: fc.integer({ min: 1, max: 12 }), day: fc.integer({ min: 1, max: 28 }), hour: fc.integer({ min: 0, max: 23 }), minute: fc.integer({ min: 0, max: 59 }),
  }), ({ month, day, hour, minute }) => {
    const raw = `2026/${month}/${day} ${hour}:${String(minute).padStart(2, '0')}`;
    const result = normalizeTimestamp(raw);
    expect(result.timestamp_raw).toBe(raw);
    expect(result.timestamp_display).toBe(`2026-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`);
    expect(result.timestamp_normalized.getFullYear()).toBe(2026);
    expect(result.timestamp_normalized.getMonth()).toBe(month - 1);
  });
});
