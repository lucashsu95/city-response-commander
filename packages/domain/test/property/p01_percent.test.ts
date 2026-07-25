import * as fc from 'fast-check';
import { describe, expect } from 'vitest';
import { formatPercent, parsePercent } from '../../src/ingestion/percent_parser.js';
import { propertyTest } from '../helpers/pbt-helper.js';

describe('Percent parser properties', () => {
  /** Validates: Requirements REQ-001 */
  propertyTest(1, 'percent parse and format round-trip', fc.integer({ min: 0, max: 10_000 }), (hundredths) => {
    const original = `${(hundredths / 100).toFixed(2)}%`;
    expect(formatPercent(parsePercent(original), 2)).toBe(original);
    expect(parsePercent('30%')).toBe(0.3);
  });
});
