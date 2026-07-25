import { describe, expect, it } from 'vitest';
import { classifySegments } from '../../src/rule_engine/classification_engine.js';
import { evaluateArticle3 } from '../../src/rule_engine/article3.js';
import { evaluateArticle6 } from '../../src/rule_engine/article6.js';
import { qualifyCandidates } from '../../src/rule_engine/article2.js';
import { RoadNetworkModel } from '../../src/road_network/road_network_model.js';

const level = (score: number) => classifySegments([{ segment_id: 'RD', saturation_score: score }])[0].level;

describe('official numeric boundary matrix', () => {
  it.each([[0.8499, null], [0.85, 'B'], [0.9499, 'B'], [0.95, 'A']] as const)('classifies saturation %s as %s', (score, expected) => expect(level(score)).toBe(expected));
  it('uses strict SOP-3 count and growth boundaries', () => {
    expect(evaluateArticle3({ bs_id: 'BS_MRT_BL17', user_count: 25_000, growth_rate: 0 }).triggered).toBe(false);
    expect(evaluateArticle3({ bs_id: 'BS_MRT_BL17', user_count: 25_001, growth_rate: 0 }).triggered).toBe(true);
    expect(evaluateArticle3({ bs_id: 'BS_MRT_BL17', user_count: 0, growth_rate: 0.3 }).triggered).toBe(false);
    expect(evaluateArticle3({ bs_id: 'BS_MRT_BL17', user_count: 0, growth_rate: 0.3001 }).triggered).toBe(true);
  });
  it('uses inclusive SOP-6 30 percent boundary', () => {
    expect(evaluateArticle6({ mode: 'current_snapshot_all_available_stations', stations_in_scope: [{ bs_id: 'B', roaming_pct_value: 0.2999 }] }).triggered).toBe(false);
    expect(evaluateArticle6({ mode: 'current_snapshot_all_available_stations', stations_in_scope: [{ bs_id: 'B', roaming_pct_value: 0.3 }] }).triggered).toBe(true);
  });
  it('uses inclusive SOP-2 capacity 1000 boundary', () => {
    const evaluate = (capacity: number) => {
      const model = RoadNetworkModel.load([
        { segment_id: 'INC', name: 'incident', flow_direction: 'x', intersections: ['Candidate', 'Anchor'], capacity_vph: 1, alternatives: ['CAND'], nearby_stations: [] },
        { segment_id: 'CAND', name: 'Candidate', flow_direction: 'y', intersections: [], capacity_vph: capacity, alternatives: [], nearby_stations: [] },
      ]);
      return qualifyCandidates('INC', 'Anchor', model, new Map([['CAND', 0.1]]))[0].passes_capacity;
    };
    expect(evaluate(999)).toBe(false); expect(evaluate(1000)).toBe(true);
  });
});
