import * as fc from 'fast-check';
import { describe, expect } from 'vitest';
import { evaluateArticle4 } from '../../src/rule_engine/article4.js';
import { propertyTest } from '../helpers/pbt-helper.js';

describe('SOP-4 properties', () => {
  /** Validates: Requirements REQ-017 */
  propertyTest(17, 'dome dispersal requires peak and current-growth conditions and links article 3', fc.record({ peak: fc.integer({ min: 0, max: 50_000 }), growth: fc.double({ min: -1, max: 1, noNaN: true }) }), ({ peak, growth }) => {
    const now = new Date(2026, 4, 20, 22, 30);
    const result = evaluateArticle4({ bs_id: 'BS_TPE_DOME', current_observed_at: now, historical_observations: [{ observed_at: now, user_count: peak }], current_growth_rate: growth });
    const expected = peak >= 30_000 && growth <= -0.2;
    expect(result.triggered).toBe(expected);
    expect(result.invoked_procedures.includes('article3_mrt_shuttle_mechanism')).toBe(expected);
  });
});
