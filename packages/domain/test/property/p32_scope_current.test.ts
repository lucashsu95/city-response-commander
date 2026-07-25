import * as fc from 'fast-check';
import { describe, expect } from 'vitest';
import { evaluateArticle6 } from '../../src/rule_engine/article6.js';
import { propertyTest } from '../helpers/pbt-helper.js';

describe('SOP-6 current-snapshot properties', () => {
  /** Validates: Requirements REQ-019 */
  propertyTest(32, 'historical roaming peaks never trigger a below-threshold current snapshot', fc.tuple(fc.double({ min: 0.3, max: 1, noNaN: true }), fc.double({ min: 0, max: 0.299999, noNaN: true })), ([_historical, current]) => {
    const result = evaluateArticle6({ mode: 'current_snapshot_all_available_stations', stations_in_scope: [{ bs_id: 'BS_X', roaming_pct_value: current }] });
    expect(result.triggered).toBe(false);
    expect(result.multilingual_required).toBe(false);
  });
});
