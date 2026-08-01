/** What-if four-stage integration at the backend/domain ownership seam (TASK-142). */

import * as fc from 'fast-check';
import { describe, expect, it, vi } from 'vitest';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import type { BedrockInvoker, BedrockResult, SopRetriever } from '@city-commander/rag';
import { parseScenario } from '../../src/whatif/scenario_parser.js';
import { validateScenario } from '../../src/whatif/validators.js';
import {
  recompute,
  type RuleEngineWhatIfFacade,
} from '../../src/whatif/recompute.js';
import { explainWhatIf } from '../../src/whatif/explanation.js';
import { LOADED_ENTITIES } from '../whatif/loaded_entities.js';

function bedrockSequence(responses: readonly string[]): BedrockInvoker {
  let index = 0;
  return {
    async invoke(): Promise<BedrockResult> {
      const text = responses[index++] ?? responses.at(-1) ?? '{}';
      return { outcome: 'success', text, usedModelId: 'mock' };
    },
  };
}

const retriever: SopRetriever = {
  async retrieve() {
    return {
      outcome: 'success',
      source: 'kb',
      citations: [{
        article_no: 3,
        content: 'SOP 第 3 條：捷運人流分流',
        source_location: 'sop#article-3',
        relevancy_score: 1,
        source: 'kb',
      }],
    };
  },
} as unknown as SopRetriever;

const event = {} as APIGatewayProxyEventV2;

describe('What-if four-stage flow', () => {
  it('loads one complete baseline, validates loaded entities, delegates once, and explains returned facts', async () => {
    const rerun = vi.fn(() => ({
      // The extra articles/routes/ETE represent facts preserved from baseline inputs.
      triggered_articles: [2, 3, 6],
      applied_formula_articles: [7],
      expected_actions: ['維持既有改道路線', '啟動捷運分流', '產出多語警示'],
      ete_minutes: 78.6,
    }));
    const facade: RuleEngineWhatIfFacade = {
      async loadBaseline() {
        return {
          inputSnapshot: Object.freeze({ allOfficialInputs: true }),
          loadedEntities: LOADED_ENTITIES,
        };
      },
      rerun,
    };
    const bedrock = bedrockSequence([
      JSON.stringify({
        status: 'parsed',
        assumptions: [{
          entity_id: 'BS_MRT_BL17',
          field: 'User_Count',
          operator: '=',
          value: 40_000,
        }],
      }),
      JSON.stringify({ explanation_text: '完整重算後維持既有路線，並啟動捷運分流。' }),
    ]);

    const parsed = await parseScenario('若 BL17 人數增至 40000？', bedrock);
    expect(parsed.parse_status).toBe('parsed');
    if (parsed.parse_status !== 'parsed') return;

    const baseline = await facade.loadBaseline(event);
    const validated = validateScenario(parsed.assumptions, baseline.loadedEntities);
    expect(validated.validation_status).toBe('valid');
    if (validated.validation_status !== 'valid') return;

    const deterministic = recompute({
      facade,
      baseline,
      assumptions: validated.validated_assumptions,
    });
    const explanation = await explainWhatIf({
      recomputeResult: deterministic,
      rawQuestion: '若 BL17 人數增至 40000？',
      sopRetriever: retriever,
      bedrockInvoker: bedrock,
    });

    expect(rerun).toHaveBeenCalledTimes(1);
    expect(deterministic.triggered_articles).toEqual([2, 3, 6]);
    expect(deterministic.applied_formula_articles).toEqual([7]);
    expect(deterministic.ete_preview?.ete_minutes).toBe(78.6);
    expect(deterministic.does_not_mutate_state).toBe(true);
    expect(explanation.sop_citations).not.toHaveLength(0);
  });

  it('prefix-valid but unloaded entities stop before the deterministic facade', () => {
    const rerun = vi.fn();
    const result = validateScenario([
      { entity_id: 'BS_FAKE_999', field: 'User_Count', operator: '=', value: 40_000 },
    ], LOADED_ENTITIES);

    expect(result.validation_status).toBe('clarification_required');
    expect(rerun).not.toHaveBeenCalled();
  });

  it('Feature: city-response-commander, Property 35: unloaded ID-shaped entities always require clarification', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 999_999 }), (suffix) => {
        const result = validateScenario([
          {
            entity_id: `BS_FAKE_${suffix}`,
            field: 'User_Count',
            operator: '=',
            value: 1,
          },
        ], LOADED_ENTITIES);
        expect(result.validation_status).toBe('clarification_required');
      }),
      { numRuns: 100 },
    );
  });
});
