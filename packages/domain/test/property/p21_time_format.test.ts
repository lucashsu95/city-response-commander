import * as fc from 'fast-check';
import { describe, expect } from 'vitest';
import { normalizeTimestamp } from '../../src/ingestion/timestamp_normalizer.js';
import { propertyTest } from '../helpers/pbt-helper.js';

describe('Timestamp display properties', () => {
  /** Validates: Requirements REQ-019 */
  propertyTest(21, 'emitted timestamps use YYYY-MM-DD HH:MM', fc.record({
    month: fc.integer({ min: 1, max: 12 }), day: fc.integer({ min: 1, max: 28 }),
    hour: fc.integer({ min: 0, max: 23 }), minute: fc.integer({ min: 0, max: 59 }),
  }), ({ month, day, hour, minute }) => {
    const value = normalizeTimestamp(`2026/${month}/${day} ${hour}:${String(minute).padStart(2, '0')}`);
    expect(value.timestamp_display).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });
});
