/**
 * explainWhatIf — unit + integration tests (TASK-140 + RAG/ETE traces)
 *
 * 驗證：
 * - Bedrock success + s3_fallback citation 無揭露 → 附加 FALLBACK_DISCLOSURE
 * - Bedrock failure + s3_fallback citation → template fallback 含 類比引用 marker
 * - Bedrock success + kb citation → 不附加 disclosure
 * - rag_trace is always present with correct retriever_type
 * - ete_calculation present when article 7 is applied
 * - Bedrock failure does not prevent rag_trace / ete_calculation from being populated
 */

import { describe, it, expect, vi } from 'vitest';
import { FALLBACK_DISCLOSURE } from '@city-commander/shared-schemas';
import {
  buildWhatIfSummaryText,
  explainWhatIf,
  type WhatIfExplanationInput,
} from '../../src/whatif/explanation.js';
import type {
  BedrockInvoker,
  BedrockResult,
  SopRetriever,
  SopCitationResult,
  SopRetrieveResult,
} from '@city-commander/rag';
import type { RecomputeResult } from '../../src/whatif/whatif_types.js';

// ─── Stub helpers ──────────────────────────────────────────────────────────

function makeRecomputeResultArticle7(): RecomputeResult {
  return {
    triggered_articles: [1, 2],
    applied_formula_articles: [7],
    expected_actions: ['SOP-1：封閉事故路段', 'SOP-2：替代路線導引'],
    ete_preview: { ete_minutes: 64.4 },
    ete_severity: 'Critical',
    // ACC_001 gold standard: ETE=64.4, base_clearance=60 → congestion_penalty=4.4
    // 4.4 / 60 + 0.5 = 0.5733...
    ete_avg_saturation: 0.5733,
    ete_base_timestamp: '2026-05-20 22:10',
    does_not_mutate_state: true,
  };
}

function makeRecomputeResultNoEte(): RecomputeResult {
  return {
    triggered_articles: [3],
    applied_formula_articles: [],
    expected_actions: ['SOP-3：啟動分流'],
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

const ARTICLE3_CITATION: readonly SopCitationResult[] = [
  {
    article_no: 3,
    content: 'SOP 第 3 條：捷運與接駁分流',
    source_location: 'emergency_traffic_sop.txt#article-3',
    relevancy_score: null,
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

describe('buildWhatIfSummaryText', () => {
  it('summarizes deterministic SOP, first action, and ETE facts in one paragraph', () => {
    expect(buildWhatIfSummaryText(makeRecomputeResult())).toBe(
      '觸發 SOP 第 1、2 條；首要動作：SOP-1：封閉事故路段；預估恢復時間 45 分鐘。',
    );
  });

  it('states deterministic no-trigger and no-action outcomes without inventing ETE', () => {
    expect(
      buildWhatIfSummaryText({
        triggered_articles: [],
        applied_formula_articles: [],
        expected_actions: [],
        does_not_mutate_state: true,
      }),
    ).toBe('未觸發新的 SOP 條款；目前無新增預期動作。');
  });

  it('caps a long first action so the summary stays concise', () => {
    const summary = buildWhatIfSummaryText({
      triggered_articles: [3],
      applied_formula_articles: [],
      expected_actions: [
        '啟動接駁分流並通知所有相關單位持續監看沿線各站人流與道路狀況，直到現場指揮官確認解除應變為止',
      ],
      does_not_mutate_state: true,
    });

    expect(summary).toContain('…');
    expect(summary.length).toBeLessThan(90);
  });
});

describe('explainWhatIf', () => {
  it('Bedrock success + s3_fallback citations WITHOUT disclosure → appends 類比引用 disclosure', async () => {
    const json = JSON.stringify({ explanation_text: '假設成立時會觸發封閉措施' });
    const input: WhatIfExplanationInput = {
      recomputeResult: makeRecomputeResultArticle7(),
      rawQuestion: '如果人潮超過兩萬會怎樣？',
      sopRetriever: makeSopRetriever(S3_FALLBACK_CITATIONS),
      bedrockInvoker: makeBedrockSuccess(json),
      retrieverType: 'local_sop_knowledge_base',
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
      recomputeResult: makeRecomputeResultArticle7(),
      rawQuestion: '如果人潮超過兩萬會怎樣？',
      sopRetriever: makeSopRetriever(S3_FALLBACK_CITATIONS),
      bedrockInvoker: makeBedrockSuccess(json),
      retrieverType: 'local_sop_knowledge_base',
    };

    const result = await explainWhatIf(input);

    expect(result.explanation_text).toContain('解釋文字，已提及類比引用');
    expect(result.explanation_text).toContain(FALLBACK_DISCLOSURE.trim());
  });

  it('Bedrock success + s3_fallback citations with complete disclosure → no double-append', async () => {
    const json = JSON.stringify({ explanation_text: `解釋文字${FALLBACK_DISCLOSURE}` });
    const input: WhatIfExplanationInput = {
      recomputeResult: makeRecomputeResultArticle7(),
      rawQuestion: '如果人潮超過兩萬會怎樣？',
      sopRetriever: makeSopRetriever(S3_FALLBACK_CITATIONS),
      bedrockInvoker: makeBedrockSuccess(json),
      retrieverType: 'local_sop_knowledge_base',
    };

    const result = await explainWhatIf(input);

    expect(result.text_source).toBe('bedrock');
    expect(result.explanation_text.split(FALLBACK_DISCLOSURE.trim())).toHaveLength(2);
  });

  it('Bedrock success + kb-only citations → no disclosure appended', async () => {
    const json = JSON.stringify({ explanation_text: '純 KB 解釋' });
    const input: WhatIfExplanationInput = {
      recomputeResult: makeRecomputeResultNoEte(),
      rawQuestion: '如果飽和度超標？',
      sopRetriever: makeSopRetriever(KB_CITATIONS),
      bedrockInvoker: makeBedrockSuccess(json),
      retrieverType: 'aws_bedrock_kb',
    };

    const result = await explainWhatIf(input);

    expect(result.text_source).toBe('bedrock');
    expect(result.explanation_text).toBe('純 KB 解釋');
    expect(result.explanation_text).not.toContain('類比引用');
  });

  it('Bedrock failure + s3_fallback → template contains source_location and complete disclosure', async () => {
    const input: WhatIfExplanationInput = {
      recomputeResult: makeRecomputeResultArticle7(),
      rawQuestion: '如果人潮破三萬？',
      sopRetriever: makeSopRetriever(S3_FALLBACK_CITATIONS),
      bedrockInvoker: makeBedrockFailure(),
      retrieverType: 'local_sop_knowledge_base',
    };

    const result = await explainWhatIf(input);

    expect(result.text_source).toBe('template');
    expect(result.explanation_text).toContain('s3://my-bucket/sop/article-1.json');
    expect(result.explanation_text).toContain('類比引用');
    expect(result.explanation_text).toContain(FALLBACK_DISCLOSURE.trim());
    expect(result.does_not_mutate_state).toBe(true);
  });

  // ── rag_trace tests ───────────────────────────────────────────────────────

  it('rag_trace is present and has correct retriever_type=local_sop_knowledge_base', async () => {
    const json = JSON.stringify({ explanation_text: '解釋文字' });
    const input: WhatIfExplanationInput = {
      recomputeResult: makeRecomputeResultArticle7(),
      rawQuestion: 'test query',
      sopRetriever: makeSopRetriever(S3_FALLBACK_CITATIONS),
      bedrockInvoker: makeBedrockSuccess(json),
      retrieverType: 'local_sop_knowledge_base',
    };

    const result = await explainWhatIf(input);

    expect(result.rag_trace).toBeDefined();
    expect(result.rag_trace!.retriever_type).toBe('local_sop_knowledge_base');
    expect(result.rag_trace!.knowledge_source).toBe('emergency_traffic_sop.txt');
    expect(result.rag_trace!.query).toBeTruthy();
    expect(Array.isArray(result.rag_trace!.retrieved_chunks)).toBe(true);
    expect(result.rag_trace!.citations).toContain(1);
    expect(result.rag_trace!.citations).toContain(2);
    expect(result.rag_trace!.retrieval_count).toBe(2);
  });

  it('rag_trace.retriever_type=aws_bedrock_kb when retrieverType=aws_bedrock_kb', async () => {
    const json = JSON.stringify({ explanation_text: 'KB 解釋' });
    const input: WhatIfExplanationInput = {
      recomputeResult: makeRecomputeResultNoEte(),
      rawQuestion: 'test query',
      sopRetriever: makeSopRetriever(KB_CITATIONS),
      bedrockInvoker: makeBedrockSuccess(json),
      retrieverType: 'aws_bedrock_kb',
    };

    const result = await explainWhatIf(input);

    expect(result.rag_trace!.retriever_type).toBe('aws_bedrock_kb');
    expect(result.rag_trace!.knowledge_source).toBe('AWS Bedrock Knowledge Base');
  });

  it('rag_trace.retrieved_chunks contain article, heading, excerpt, source', async () => {
    const json = JSON.stringify({ explanation_text: '解釋文字' });
    const input: WhatIfExplanationInput = {
      recomputeResult: makeRecomputeResultNoEte(),
      rawQuestion: 'test',
      sopRetriever: makeSopRetriever(ARTICLE3_CITATION),
      bedrockInvoker: makeBedrockSuccess(json),
      retrieverType: 'local_sop_knowledge_base',
    };

    const result = await explainWhatIf(input);

    expect(result.rag_trace!.retrieved_chunks).toHaveLength(1);
    const chunk = result.rag_trace!.retrieved_chunks[0];
    expect(chunk.article).toBe(3);
    expect(chunk.heading).toBe('捷運與接駁分流');
    expect(chunk.excerpt).toBe('SOP 第 3 條：捷運與接駁分流');
    expect(chunk.source).toBe('emergency_traffic_sop.txt#article-3');
    expect(chunk.score).toBeNull();
  });

  // ── ete_calculation tests ─────────────────────────────────────────────────

  it('ete_calculation is present when article 7 is applied', async () => {
    const json = JSON.stringify({ explanation_text: '解釋文字' });
    // ACC_001 gold standard: ETE=64.4 → congestion_penalty=4.4 → avg_saturation≈0.5734
    const input: WhatIfExplanationInput = {
      recomputeResult: makeRecomputeResultArticle7(),
      rawQuestion: 'test',
      sopRetriever: makeSopRetriever(S3_FALLBACK_CITATIONS),
      bedrockInvoker: makeBedrockSuccess(json),
      retrieverType: 'local_sop_knowledge_base',
    };

    const result = await explainWhatIf(input);

    expect(result.ete_calculation).not.toBeNull();
    expect(result.ete_calculation!.source_article).toBe(7);
    expect(result.ete_calculation!.formula).toBeTruthy();
    // ACC_001 gold standard: 60 + 4.4 = 64.4
    expect(result.ete_calculation!.result_minutes).toBeCloseTo(64.4, 2);
    expect(result.ete_calculation!.substitution).toContain('60');
    expect(result.ete_calculation!.base_timestamp).toBe('2026-05-20 22:10');
    expect(result.ete_calculation!.timezone).toBe('Asia/Taipei');
    expect(result.ete_calculation!.recovery_at).toBeTruthy();
    expect(result.ete_calculation!.missing_inputs).toEqual([]);
  });

  it('ete_calculation is null when article 7 is not applied', async () => {
    const json = JSON.stringify({ explanation_text: '解釋文字' });
    const input: WhatIfExplanationInput = {
      recomputeResult: makeRecomputeResultNoEte(),
      rawQuestion: 'test',
      sopRetriever: makeSopRetriever(ARTICLE3_CITATION),
      bedrockInvoker: makeBedrockSuccess(json),
      retrieverType: 'local_sop_knowledge_base',
    };

    const result = await explainWhatIf(input);

    expect(result.ete_calculation).toBeNull();
  });

  it('ete_calculation records missing inputs when ETE fields are absent', async () => {
    const json = JSON.stringify({ explanation_text: '解釋文字' });
    const input: WhatIfExplanationInput = {
      recomputeResult: {
        triggered_articles: [7],
        applied_formula_articles: [7],
        expected_actions: [],
        ete_preview: undefined,
        does_not_mutate_state: true,
      },
      rawQuestion: 'test',
      sopRetriever: makeSopRetriever([]),
      bedrockInvoker: makeBedrockSuccess(json),
      retrieverType: 'local_sop_knowledge_base',
    };

    const result = await explainWhatIf(input);

    expect(result.ete_calculation).not.toBeNull();
    expect(result.ete_calculation!.result_minutes).toBeNull();
    expect(result.ete_calculation!.missing_inputs.length).toBeGreaterThan(0);
  });

  it('ete_calculation result_minutes matches ACC_001 gold standard (64.4)', async () => {
    const json = JSON.stringify({ explanation_text: '解釋文字' });
    // ACC_001: ETE=64.4 = base_clearance(Critical=60) + congestion_penalty(4.4)
    // avg_saturation = 0.5 + 4.4/60 = 0.5733...
    const input: WhatIfExplanationInput = {
      recomputeResult: {
        triggered_articles: [2],
        applied_formula_articles: [7],
        expected_actions: ['SOP-2 替代路線'],
        ete_preview: { ete_minutes: 64.4 },
        ete_severity: 'Critical',
        ete_avg_saturation: 0.5 + 4.4 / 60, // = 0.5733...
        ete_base_timestamp: '2026-05-20 22:10',
        does_not_mutate_state: true,
      },
      rawQuestion: 'test',
      sopRetriever: makeSopRetriever([]),
      bedrockInvoker: makeBedrockSuccess(json),
      retrieverType: 'local_sop_knowledge_base',
    };

    const result = await explainWhatIf(input);

    expect(result.ete_calculation!.result_minutes).toBeCloseTo(64.4, 2);
  });

  it('Bedrock failure does NOT prevent rag_trace from being populated', async () => {
    const input: WhatIfExplanationInput = {
      recomputeResult: makeRecomputeResultArticle7(),
      rawQuestion: 'test',
      sopRetriever: makeSopRetriever(S3_FALLBACK_CITATIONS),
      bedrockInvoker: makeBedrockFailure(),
      retrieverType: 'local_sop_knowledge_base',
    };

    const result = await explainWhatIf(input);

    expect(result.rag_trace).toBeDefined();
    expect(result.rag_trace!.retrieved_chunks).toHaveLength(2);
    expect(result.ete_calculation).not.toBeNull();
  });
});
