/**
 * explainWhatIf — unit + integration tests (TASK-140)
 *
 * 驗證：
 * - Bedrock success + s3_fallback citation 無揭露 → 附加 FALLBACK_DISCLOSURE
 * - Bedrock failure + s3_fallback citation → template fallback 含 類比引用 marker
 * - Bedrock success + kb citation → 不附加 disclosure
 */

import { describe, it, expect, vi } from 'vitest';
import { FALLBACK_DISCLOSURE } from '@city-commander/shared-schemas';
import { explainWhatIf, type WhatIfExplanationInput } from '../../src/whatif/explanation.js';
import type {
  BedrockInvoker,
  BedrockResult,
  SopRetriever,
  SopCitationResult,
  SopRetrieveResult,
} from '@city-commander/rag';
import type { RecomputeResult } from '../../src/whatif/whatif_types.js';

// ─── Stub helpers ──────────────────────────────────────────────────────────

function makeRecomputeResult(): RecomputeResult {
  return {
    triggered_articles: [1, 2],
    applied_formula_articles: [7],
    expected_actions: ['SOP-1：封閉事故路段', 'SOP-2：替代路線導引'],
    ete_preview: { ete_minutes: 45 },
    does_not_mutate_state: true,
  };
}

const S3_FALLBACK_CITATIONS: readonly SopCitationResult[] = [
  {
    article_no: 1,
    content: 'SOP 第 1 條：事故路段封閉原文',
    source_location: 's3://my-bucket/sop/article-1.json',
    relevancy_score: null,
    source: 's3_fallback',
  },
  {
    article_no: 2,
    content: 'SOP 第 2 條：替代路線導引原文',
    source_location: 's3://my-bucket/sop/article-2.json',
    relevancy_score: null,
    source: 's3_fallback',
  },
];

const KB_CITATIONS: readonly SopCitationResult[] = [
  {
    article_no: 1,
    content: 'SOP 第 1 條 KB 原文',
    source_location: 's3://kb-bucket/chunks/article-1.json',
    relevancy_score: 0.92,
    source: 'kb',
  },
];

function makeSopRetriever(citations: readonly SopCitationResult[]): SopRetriever {
  return {
    retrieve: vi.fn(async (): Promise<SopRetrieveResult> => ({
      outcome: 'success',
      citations,
      source: citations.some((c) => c.source === 's3_fallback') ? 's3_fallback' : 'kb',
    })),
  } as unknown as SopRetriever;
}

function makeBedrockSuccess(text: string): BedrockInvoker {
  return {
    invoke: vi.fn(async (): Promise<BedrockResult> => ({
      outcome: 'success',
      text,
      usedModelId: 'mock-model',
    })),
  };
}

function makeBedrockFailure(): BedrockInvoker {
  return {
    invoke: vi.fn(async (): Promise<BedrockResult> => ({
      outcome: 'use_template',
      reason: 'timeout',
      message: 'timed out',
    })),
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('explainWhatIf', () => {
  it('Bedrock success + s3_fallback citations WITHOUT disclosure → appends 類比引用 disclosure', async () => {
    const json = JSON.stringify({ explanation_text: '假設成立時會觸發封閉措施' });
    const input: WhatIfExplanationInput = {
      recomputeResult: makeRecomputeResult(),
      rawQuestion: '如果人潮超過兩萬會怎樣？',
      sopRetriever: makeSopRetriever(S3_FALLBACK_CITATIONS),
      bedrockInvoker: makeBedrockSuccess(json),
    };

    const result = await explainWhatIf(input);

    expect(result.text_source).toBe('bedrock');
    expect(result.explanation_text).toContain('假設成立時會觸發封閉措施');
    expect(result.explanation_text).toContain('類比引用');
    expect(result.does_not_mutate_state).toBe(true);
  });

  it('Bedrock success + s3_fallback citations with partial disclosure → appends complete disclosure', async () => {
    const json = JSON.stringify({ explanation_text: '解釋文字，已提及類比引用' });
    const input: WhatIfExplanationInput = {
      recomputeResult: makeRecomputeResult(),
      rawQuestion: '如果人潮超過兩萬會怎樣？',
      sopRetriever: makeSopRetriever(S3_FALLBACK_CITATIONS),
      bedrockInvoker: makeBedrockSuccess(json),
    };

    const result = await explainWhatIf(input);

    expect(result.explanation_text).toContain('解釋文字，已提及類比引用');
    expect(result.explanation_text).toContain(FALLBACK_DISCLOSURE.trim());
  });

  it('Bedrock success + s3_fallback citations with complete disclosure → no double-append', async () => {
    const json = JSON.stringify({ explanation_text: `解釋文字${FALLBACK_DISCLOSURE}` });
    const input: WhatIfExplanationInput = {
      recomputeResult: makeRecomputeResult(),
      rawQuestion: '如果人潮超過兩萬會怎樣？',
      sopRetriever: makeSopRetriever(S3_FALLBACK_CITATIONS),
      bedrockInvoker: makeBedrockSuccess(json),
    };

    const result = await explainWhatIf(input);

    expect(result.text_source).toBe('bedrock');
    expect(result.explanation_text.split(FALLBACK_DISCLOSURE.trim())).toHaveLength(2);
  });

  it('Bedrock success + kb-only citations → no disclosure appended', async () => {
    const json = JSON.stringify({ explanation_text: '純 KB 解釋' });
    const input: WhatIfExplanationInput = {
      recomputeResult: makeRecomputeResult(),
      rawQuestion: '如果飽和度超標？',
      sopRetriever: makeSopRetriever(KB_CITATIONS),
      bedrockInvoker: makeBedrockSuccess(json),
    };

    const result = await explainWhatIf(input);

    expect(result.text_source).toBe('bedrock');
    expect(result.explanation_text).toBe('純 KB 解釋');
    expect(result.explanation_text).not.toContain('類比引用');
  });

  it('Bedrock failure + s3_fallback → template contains source_location and complete disclosure', async () => {
    const input: WhatIfExplanationInput = {
      recomputeResult: makeRecomputeResult(),
      rawQuestion: '如果人潮破三萬？',
      sopRetriever: makeSopRetriever(S3_FALLBACK_CITATIONS),
      bedrockInvoker: makeBedrockFailure(),
    };

    const result = await explainWhatIf(input);

    expect(result.text_source).toBe('template');
    // Template fallback uses formatCitationLocation and must carry the full caveat.
    expect(result.explanation_text).toContain('s3://my-bucket/sop/article-1.json');
    expect(result.explanation_text).toContain('類比引用');
    expect(result.explanation_text).toContain(FALLBACK_DISCLOSURE.trim());
    expect(result.does_not_mutate_state).toBe(true);
  });
});
