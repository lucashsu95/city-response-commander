import * as fc from 'fast-check';
import { describe, expect } from 'vitest';
import { evaluateArticle3 } from '../../src/rule_engine/article3.js';
import { propertyTest } from '../helpers/pbt-helper.js';

describe('SOP-3 properties', () => {
  /** Validates: Requirements REQ-016 */
  propertyTest(16, 'article 3 uses strict OR thresholds and includes all actions', fc.record({ count: fc.integer({ min: 0, max: 50_000 }), growth: fc.double({ min: -1, max: 1, noNaN: true }) }), ({ count, growth }) => {
    const result = evaluateArticle3({ bs_id: 'BS_MRT_BL17', user_count: count, growth_rate: growth });
    expect(result.triggered).toBe(count > 25_000 || growth > 0.3);
    expect(result.actions.length).toBe(result.triggered ? 3 : 0);
    expect(result.adds_to_triggered_articles).toEqual(result.triggered ? [3] : []);
  });
});
