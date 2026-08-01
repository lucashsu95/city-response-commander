/**
 * explainWhatIf — What-if stage 4 unit tests (TASK-140)
 *
 * 驗證 Bedrock 失敗 → template fallback 路徑下，s3_fallback citation 的
 * `source_location` 與「（類比引用，非精準比對）」標記（`formatCitationLocation`）
 * 會出現在 `explanation_text` 中（模板 fallback 端到端覆蓋，對應
 * packages/rag/src/explanation_composer.ts 的同等測試）。
 */

import { describe, it, expect } from 'vitest';
import type { BedrockInvoker, BedrockResult, SopRetriever, SopCitationResult } from '@city-commander/rag';
import { explainWhatIf, type WhatIfExplanationInput } from '../../src/whatif/explanation.js';
import type { RecomputeResult } from '../../src/whatif/whatif_types.js';

// ─── Stub helpers ──────────────────────────────────────────────────────────

function makeRecomputeResult(): RecomputeResult {
  return {
    triggered_articles: [2],
    applied_formula_articles: [7],
    expected_actions: ['維持既有改道路線'],
    ete_preview: { ete_minutes: 42 },
    does_not_mutate_state: true,
  };
}

const SAMPLE_S3_FALLBACK_CITATIONS: readonly SopCitationResult[] = [
  {
    article_no: 2,
    content: 'SOP 第 2 條原文',
    source_location: 's3://bucket/sop/article-2.json',
    relevancy_score: null,
    source: 's3_fallback',
  },
];

function makeBedrockFailure(): BedrockInvoker {
  return {
    async invoke(): Promise<BedrockResult> {
      return { outcome: 'use_template', reason: 'timeout', message: 'timed out' };
    },
  };
}

function makeRetrieverReturning(citations: readonly SopCitationResult[]): SopRetriever {
  return {
    async retrieve() {
      return { outcome: 'success', source: 's3_fallback', citations };
    },
  } as unknown as SopRetriever;
}

function makeInput(overrides: Partial<WhatIfExplanationInput> = {}): WhatIfExplanationInput {
  return {
    recomputeResult: makeRecomputeResult(),
    rawQuestion: '若 BL17 人數增至 40000？',
    sopRetriever: makeRetrieverReturning(SAMPLE_S3_FALLBACK_CITATIONS),
    bedrockInvoker: makeBedrockFailure(),
    ...overrides,
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('explainWhatIf', () => {
  it('Bedrock failure + s3_fallback citation → template fallback explanation_text includes source_location AND 類比引用 marker', async () => {
    const result = await explainWhatIf(makeInput());

    expect(result.text_source).toBe('template');
    expect(result.does_not_mutate_state).toBe(true);
    expect(result.explanation_text).toContain('s3://bucket/sop/article-2.json');
    expect(result.explanation_text).toContain('類比引用');
  });
});
