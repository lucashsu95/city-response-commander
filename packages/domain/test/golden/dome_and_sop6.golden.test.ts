import { describe, expect, it } from 'vitest';
import { evaluateArticle4 } from '../../src/rule_engine/article4.js';
import { evaluateArticle6 } from '../../src/rule_engine/article6.js';

describe('DOME and SOP-6 station goldens', () => {
  it('marks DOME dispersal at historical peak 40000 and current growth -0.31 and links article 3', () => {
    const current = new Date(2026, 4, 20, 22, 30);
    const result = evaluateArticle4({ bs_id: 'BS_TPE_DOME', current_observed_at: current, historical_observations: [{ observed_at: new Date(2026, 4, 20, 22, 0), user_count: 40_000 }], current_growth_rate: -0.31 });
    expect(result).toMatchObject({ triggered: true, dispersal_marked: true, historical_peak: 40_000, adds_to_triggered_articles: [4], invoked_procedures: ['article3_mrt_shuttle_mechanism'] });
  });
  it.each([['BS_TPE_101', 0.4], ['BS_TPE_101', 0.45], ['BS_XY_ATT', 0.3], ['BS_XY_ATT', 0.35]] as const)('triggers multilingual for %s at %s', (bs_id, roaming_pct_value) => {
    const result = evaluateArticle6({ mode: 'current_snapshot_all_available_stations', stations_in_scope: [{ bs_id, roaming_pct_value }] });
    expect(result).toMatchObject({ triggered: true, multilingual_required: true, adds_to_triggered_articles: [6], multilingual_scope: { mode: 'current_snapshot_all_available_stations', stations_in_scope: [bs_id] } });
  });
});
