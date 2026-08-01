import * as fc from 'fast-check';
import { describe, expect } from 'vitest';
import { evaluateArticle6 } from '../../src/rule_engine/article6.js';
import { requiredAlertLanguages } from '../../src/content/multilingual_template_renderer.js';
import { propertyTest } from '../helpers/pbt-helper.js';

describe('SOP-6 trigger properties', () => {
  /** Validates: Requirements REQ-010, REQ-019 */
  propertyTest(20, 'any in-scope current roaming rate at least 30 percent triggers same-response zh and en', fc.array(fc.double({ min: 0, max: 1, noNaN: true }), { minLength: 1, maxLength: 12 }), (rates) => {
    const result = evaluateArticle6({ mode: 'current_snapshot_all_available_stations', stations_in_scope: rates.map((rate, i) => ({ bs_id: `BS_${i}`, roaming_pct_value: rate })) });
    const expected = rates.some((rate) => rate >= 0.3);
    expect(result.triggered).toBe(expected);
    expect(requiredAlertLanguages(result.triggered, false)).toEqual(expected ? ['zh', 'en'] : ['zh']);
  });
});
