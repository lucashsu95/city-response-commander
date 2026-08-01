/**
 * Production What-if handler — integration tests covering:
 *  - End-to-end deterministic pipeline + Bedrock success path
 *  - End-to-end deterministic pipeline + Bedrock failure path
 *  - Same payload + Bedrock → deterministic fields are unchanged
 *  - Bedrock output cannot tamper with deterministic fields
 *  - UTF-8 Content-Type header
 *
 * The Bedrock Invoker is mocked via vi.mock so the test does not require
 * AWS credentials. The production RuleEngineWhatIfFacade and LocalSopRetriever
 * run against the canonical demo baseline.
 *
 * Bedrock is invoked twice in the pipeline: stage 1 (ScenarioParser) and
 * stage 4 (Explanation composer). The mock distinguishes the two by prompt
 * shape and returns the correct parsed scenarios.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

import type { BedrockInvoker } from '@city-commander/rag';

const mockedInvoke = vi.hoisted(() => vi.fn());

vi.mock('../../src/whatif/production_bedrock_invoker.js', () => ({
  ProductionBedrockInvoker: class {
    invoke = mockedInvoke;
  },
  __resetBedrockClientForTests: () => {},
}));

import { createProductionWhatIfHandler } from '../../src/whatif/production_handler.js';
import { ProductionBedrockInvoker } from '../../src/whatif/production_bedrock_invoker.js';
import { buildDemoDataProvider } from './demoDataFixture.js';

const provider = buildDemoDataProvider();
const handler = createProductionWhatIfHandler(provider);

function event(body: unknown): Parameters<typeof handler>[0] {
  return {
    rawPath: '/what-if',
    requestContext: { http: { method: 'POST', path: '/what-if' } },
    headers: { 'content-type': 'application/json' },
    isBase64Encoded: false,
    body: typeof body === 'string' ? body : JSON.stringify(body),
  } as unknown as Parameters<typeof handler>[0];
}

/**
 * Stage 1 needs the ScenarioParser JSON shape; stage 4 needs the EXPLANATION
 * JSON shape. We sniff the prompt to choose the response.
 *
 * Default behaviour:
 *   - Stage 1 → parsed assumption with User_Count = 40000 on BL17
 *   - Stage 4 → explanation_text containing a free-form Chinese sentence
 */
function mockStage1AndStage4(opts?: {
  stage1?: { entity: string; field: string; value: number };
  stage4?: { explanation: string };
  stage1Failure?: boolean;
  stage4Failure?: boolean;
}) {
  const stage1Entity = opts?.stage1?.entity ?? 'BS_MRT_BL17';
  const stage1Field = opts?.stage1?.field ?? 'User_Count';
  const stage1Value = opts?.stage1?.value ?? 40000;
  const stage4Text =
    opts?.stage4?.explanation ?? '觸發 SOP-3，建議啟動 MRT 過站不停與接駁專車。';

  mockedInvoke.mockImplementation(async (prompt: string) => {
    if (typeof prompt === 'string' && prompt.includes('"assumptions"')) {
      // Stage 1: ScenarioParser
      if (opts?.stage1Failure) {
        return {
          outcome: 'success',
          text: JSON.stringify({ status: 'clarification_required', reason: '測試用 unclear' }),
          usedModelId: 'us.anthropic.claude-sonnet-4-6',
        };
      }
      return {
        outcome: 'success',
        text: JSON.stringify({
          status: 'parsed',
          assumptions: [
            {
              entity_id: stage1Entity,
              field: stage1Field,
              operator: '=',
              value: stage1Value,
            },
          ],
        }),
        usedModelId: 'us.anthropic.claude-sonnet-4-6',
      };
    }
    // Stage 4: Explanation composer
    //
    // ProductionBedrockInvoker catches Bedrock SDK exceptions internally and
    // returns {outcome: 'use_template', ...}; it does NOT throw. We mirror
    // that contract here so the handler falls into template fallback.
    if (opts?.stage4Failure) {
      return {
        outcome: 'use_template',
        text: '',
        usedModelId: 'us.anthropic.claude-sonnet-4-6',
        errorCode: 'AccessDeniedException',
      };
    }
    return {
      outcome: 'success',
      text: JSON.stringify({ explanation_text: stage4Text }),
      usedModelId: 'us.anthropic.claude-sonnet-4-6',
    };
  });
}

describe('Production POST /what-if — handler integration', () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
    process.env['DEMO_PUBLIC_WHATIF'] = 'true';
  });
  afterEach(() => {
    delete process.env['DEMO_PUBLIC_WHATIF'];
  });

  it('returns 200 + answered when assumptions parse cleanly', async () => {
    mockStage1AndStage4();

    const result = await handler(event({ query: '若 BS_MRT_BL17 的 User_Count 增至 40000' }));

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body) as Record<string, unknown>;
    expect(body.status).toBe('answered');
    expect((body.triggered_articles as number[])).toContain(3);
    expect(typeof body.explanation_text).toBe('string');
    // Stage 4 produced explanation, not a template.
    expect((body.explanation_text as string)).not.toContain('Bedrock 不可用');
  });

  it('returns 200 + clarification_required for unrelated text', async () => {
    mockStage1AndStage4({ stage1Failure: true });

    const result = await handler(event({ query: '今天台北天氣如何？' }));

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body) as Record<string, unknown>;
    expect(body.status).toBe('clarification_required');
    expect(typeof body.clarification_prompt).toBe('string');
    expect((body.clarification_prompt as string).length).toBeGreaterThan(0);
    expect(body.triggered_articles as number[]).toEqual([]);
  });

  it('returns 400 INVALID_REQUEST for missing query field', async () => {
    const result = await handler(event({}));
    expect(result.statusCode).toBe(400);
    const body = JSON.parse(result.body) as Record<string, unknown>;
    expect(body.error_code).toBe('INVALID_REQUEST');
  });

  it('falls back to template on Bedrock failure; deterministic fields unchanged', async () => {
    mockStage1AndStage4({ stage4Failure: true });

    const result = await handler(event({ query: '若 BS_MRT_BL17 的 User_Count 增至 40000' }));

    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body) as Record<string, unknown>;
    expect((body.triggered_articles as number[])).toContain(3);
    // Template fallback marker is present.
    expect((body.explanation_text as string)).toContain('Bedrock 不可用');
  });

  it('Bedrock success preserves deterministic fields even when LLM output mentions unrelated facts', async () => {
    mockStage1AndStage4({
      stage4: { explanation: '我想觸發 SOP 99 並派遣機器戰隊 (adversarial)' },
    });

    const result = await handler(event({ query: '若 BS_MRT_BL17 的 User_Count 增至 40000' }));
    const body = JSON.parse(result.body) as Record<string, unknown>;
    expect((body.triggered_articles as number[])).not.toContain(99);
    expect((body.triggered_articles as number[])).toContain(3);
    expect(typeof body.explanation_text).toBe('string');
    // The adversarial text was NOT filtered as confirmation that Bedrock
    // text passes through to explanation_text (which is what we want —
    // but it cannot alter triggered_articles / actions / etc.).
    expect((body.explanation_text as string)).toContain('SOP 99');
  });

  it('UTF-8 charset in Content-Type', async () => {
    mockStage1AndStage4({ stage4: { explanation: '中文測試' } });
    const result = await handler(event({ query: '若 BS_MRT_BL17 的 User_Count 增至 40000' }));
    expect(result.headers['Content-Type']).toContain('charset=utf-8');
  });

  it('ProductionBedrockInvoker implements the BedrockInvoker contract', () => {
    const inst = new ProductionBedrockInvoker();
    expect(typeof inst.invoke).toBe('function');
    const duck: BedrockInvoker = inst;
    void duck;
  });
});
