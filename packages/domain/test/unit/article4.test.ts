import { describe, expect, it } from 'vitest';
import {
  ARTICLE3_SHUTTLE_MECHANISM,
  ARTICLE4_STATION_ID,
  evaluateArticle4,
  type HistoricalUserCountObservation,
} from '../../src/rule_engine/article4.js';

const at = (minute: number) => new Date(2026, 4, 20, 22, minute);
const observations = (...entries: readonly [number, number][]): readonly HistoricalUserCountObservation[] =>
  entries.map(([minute, user_count]) => ({ observed_at: at(minute), user_count }));

describe('RuleEngine Article 4 (SOP-4 dome dispersal)', () => {
  it('marks dispersal and proactively links the Article 3 shuttle mechanism when both conditions hold', () => {
    const result = evaluateArticle4({
      bs_id: ARTICLE4_STATION_ID,
      current_observed_at: at(20),
      historical_observations: observations([0, 18_000], [10, 40_000], [20, 26_000]),
      current_growth_rate: -0.31,
    });

    expect(result).toMatchObject({ triggered: true, dispersal_marked: true, historical_peak: 40_000, adds_to_triggered_articles: [4] });
    expect(result.invoked_procedures).toEqual([ARTICLE3_SHUTTLE_MECHANISM]);
    expect(result.article3_shuttle_actions.join(' ')).toContain('BS_MRT_BL18');
  });

  it.each([
    [observations([0, 29_999]), -0.31],
    [observations([0, 40_000]), -0.19],
  ])('does not trigger when either AND condition is unmet', (historical_observations, current_growth_rate) => {
    const result = evaluateArticle4({ bs_id: ARTICLE4_STATION_ID, current_observed_at: at(20), historical_observations, current_growth_rate });
    expect(result.triggered).toBe(false);
    expect(result.adds_to_triggered_articles).toEqual([]);
  });

  it('excludes future observations from the historical peak as of the current snapshot', () => {
    const result = evaluateArticle4({
      bs_id: ARTICLE4_STATION_ID,
      current_observed_at: at(20),
      historical_observations: observations([10, 29_999], [20, 28_000], [21, 40_000]),
      current_growth_rate: -0.3,
    });

    expect(result).toMatchObject({ triggered: false, historical_peak: 29_999, data_status: 'ready' });
  });

  it('returns insufficient_data rather than inferring a dispersal response from an incomplete as-of series', () => {
    expect(evaluateArticle4({
      bs_id: ARTICLE4_STATION_ID,
      current_observed_at: at(20),
      historical_observations: [],
      current_growth_rate: -0.3,
    })).toMatchObject({ triggered: false, data_status: 'insufficient_data' });
  });
});
