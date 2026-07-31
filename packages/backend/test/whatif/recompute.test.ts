/** What-if stage-3 ownership-boundary tests (TASK-139, P28). */

import * as fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';
import {
  recompute,
  type RuleEngineWhatIfBaseline,
  type RuleEngineWhatIfFacade,
} from '../../src/whatif/recompute.js';
import type { WhatIfAssumption } from '../../src/whatif/whatif_types.js';
import { LOADED_ENTITIES } from './loaded_entities.js';

const baseline: RuleEngineWhatIfBaseline = {
  inputSnapshot: Object.freeze({ source: 'full-loaded-input-copy', untouched: true }),
  loadedEntities: LOADED_ENTITIES,
};

function assumption(value = 40_000): WhatIfAssumption {
  return { entity_id: 'BS_MRT_BL17', field: 'User_Count', operator: '=', value };
}

describe('recompute — member-1 facade delegation', () => {
  it('passes the complete opaque baseline and validated assumptions to one facade call', () => {
    const rerun = vi.fn(() => ({
      triggered_articles: [3],
      applied_formula_articles: [7],
      expected_actions: ['SOP-3：啟動分流'],
      ete_minutes: 42,
    }));
    const facade: RuleEngineWhatIfFacade = {
      loadBaseline: vi.fn(),
      rerun,
    };
    const assumptions = [assumption()];

    const result = recompute({ facade, baseline, assumptions });

    expect(rerun).toHaveBeenCalledTimes(1);
    expect(rerun).toHaveBeenCalledWith({ baseline, assumptions });
    expect(result).toEqual({
      triggered_articles: [3],
      applied_formula_articles: [7],
      expected_actions: ['SOP-3：啟動分流'],
      ete_preview: { ete_minutes: 42 },
      does_not_mutate_state: true,
    });
  });

  it('does not invent an ETE preview when the facade does not return one', () => {
    const facade: RuleEngineWhatIfFacade = {
      loadBaseline: vi.fn(),
      rerun: () => ({
        triggered_articles: [],
        applied_formula_articles: [],
        expected_actions: [],
      }),
    };

    expect(recompute({ facade, baseline, assumptions: [] })).not.toHaveProperty('ete_preview');
  });

  it('Feature: city-response-commander, Property 28: adapter preserves facade facts and never mutates assumptions', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10_000_000 }), (value) => {
        const assumptions = [assumption(value)];
        const before = JSON.stringify(assumptions);
        const facade: RuleEngineWhatIfFacade = {
          loadBaseline: vi.fn(),
          rerun: ({ assumptions: received }) => ({
            triggered_articles: received[0]?.value === value ? [3] : [],
            applied_formula_articles: [],
            expected_actions: [`value=${value}`],
          }),
        };

        const result = recompute({ facade, baseline, assumptions });

        expect(result.triggered_articles).toEqual([3]);
        expect(result.does_not_mutate_state).toBe(true);
        expect(JSON.stringify(assumptions)).toBe(before);
      }),
      { numRuns: 100 },
    );
  });
});
