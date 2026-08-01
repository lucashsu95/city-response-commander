/**
 * ExplanationComposer — unit tests (TASK-115)
 *
 * 驗證：
 * - Bedrock 失敗 → template fallback，committed
 * - Bedrock 成功（valid JSON）→ bedrock source
 * - Bedrock 回傳空字串 explanation_text → template fallback（不寫空內容）
 * - 禁止欄位注入 → template fallback
 * - DDB 錯誤 → outcome: failed
 * - ready_event_id 包含 decision.enriched（無獨立 explanation.ready）
 * - 寫入的 item 是 EXPLANATION type
 */

import { describe, it, expect, vi } from 'vitest';
import {
  composeExplanation,
  type ExplanationComposerInput,
} from '../../src/explanation_composer.js';
import { NarrativeType } from '@city-commander/shared-schemas';
import type { NarrativeTableClient, NarrativeItem } from '../../src/narrative_writer.js';
import type { BedrockInvoker, BedrockResult } from '../../src/bedrock_adapter.js';
import type { DecisionCore } from '@city-commander/shared-schemas';
import type { SopCitationResult } from '../../src/sop_retriever.js';

// ─── Stub helpers ──────────────────────────────────────────────────────────

function makeCore(): DecisionCore {
  return {
    decision_id: 'dec-expl-001',
    version: 2,
    event_id: 'EVT-003',
    occurred_at: '2026-05-20 22:00',
    primary_evacuation: 'RD_TPE_004',
    secondary_evacuation: ['RD_TPE_005'],
    triggered_articles: [1, 2],
    applied_formula_articles: [7],
    invoked_procedures: ['article2_alternative_route_guidance'],
    classifications: [{ segment_id: 'RD_TPE_002', level: 'A' }],
    excluded_candidates: [],
    multilingual_required: false,
    ete: {
      calculation_status: 'computed',
      ete_minutes: 78.6,
      base_clearance: 60,
      congestion_penalty: 18.6,
      avg_saturation: 0.81,
      severity: 'Critical',
      affected_set: ['RD_TPE_002'],
      lower_bound_only: false,
      manual_confirmation_required: false,
      formula_applicability: 'applicable',
      snapshot_provenance: {
        selection_status: 'common_exact_snapshot',
        event_timestamp: '2026-05-20 22:10',
        common_snapshot_timestamp: '2026-05-20 22:10',
        readings: [],
      },
    } as unknown as DecisionCore['ete'],
    evidence: {
      decision_id: 'dec-expl-001',
      classification_reasoning: [
        { segment_id: 'RD_TPE_002', value: 0.97, threshold: '>= 0.95', conclusion: 'A 級' },
      ],
      excluded_routes: [
        { segment_id: 'RD_TPE_008', reason: 'capacity_vph < 1000' },
      ],
      sop_citations: [],
      data_points: [],
    },
    idempotency_key: 'k',
    injection_run_id: 'inj',
    core_hash: 'h',
    source_manifest_hash: 'sh',
    immutable_after_commit: true,
    cms_core_text: '光復南路封閉，請改道 市民大道四段，預計延誤 78 分鐘',
    provisional: false,
    schema_version: '1.0.0',
    policy: {} as DecisionCore['policy'],
  } as unknown as DecisionCore;
}

function committedClient(): NarrativeTableClient {
  return { conditionalPut: vi.fn(async () => 'committed') };
}

const SAMPLE_KB_CITATIONS: readonly SopCitationResult[] = [
  { article_no: 2, content: 'SOP 第 2 條原文', source_location: 's3://bucket/sop/article-2.json', relevancy_score: null, source: 'kb' },
];

const SAMPLE_S3_FALLBACK_CITATIONS: readonly SopCitationResult[] = [
  { article_no: 2, content: 'SOP 第 2 條原文', source_location: 's3://bucket/sop/article-2.json', relevancy_score: null, source: 's3_fallback' },
];

function makeBedrockSuccess(text: string): BedrockInvoker {
  return {
    invoke: vi.fn(async (): Promise<BedrockResult> => ({
      outcome: 'success',
      text,
      usedModelId: 'mock',
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

function makeInput(overrides: Partial<ExplanationComposerInput> = {}): ExplanationComposerInput {
  return {
    core: makeCore(),
    citations: [],
    narrativeClient: committedClient(),
    bedrockInvoker: makeBedrockFailure(),
    ...overrides,
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('composeExplanation', () => {
  it('Bedrock failure → template fallback → committed', async () => {
    const result = await composeExplanation(makeInput());
    expect(result.outcome).toBe('committed');
    if (result.outcome !== 'failed') {
      expect(result.text_source).toBe('template');
    }
  });

  it('Bedrock success with valid explanation_text → bedrock source', async () => {
    const json = JSON.stringify({ explanation_text: '決策解釋文字' });
    const result = await composeExplanation(
      makeInput({ bedrockInvoker: makeBedrockSuccess(json) }),
    );
    if (result.outcome !== 'failed') {
      expect(result.text_source).toBe('bedrock');
    }
  });

  it('Bedrock returns empty explanation_text → template fallback (empty string guard)', async () => {
    const json = JSON.stringify({ explanation_text: '' });
    const result = await composeExplanation(
      makeInput({ bedrockInvoker: makeBedrockSuccess(json) }),
    );
    // empty string falls back to template (guard: trim().length > 0)
    if (result.outcome !== 'failed') {
      expect(result.text_source).toBe('template');
    }
  });

  it('Bedrock returns whitespace-only explanation_text → template fallback', async () => {
    const json = JSON.stringify({ explanation_text: '   ' });
    const result = await composeExplanation(
      makeInput({ bedrockInvoker: makeBedrockSuccess(json) }),
    );
    if (result.outcome !== 'failed') {
      expect(result.text_source).toBe('template');
    }
  });

  it('Bedrock injects prohibited field → template fallback', async () => {
    const injected = JSON.stringify({
      explanation_text: '解釋',
      primary_evacuation: 'RD_TPE_999',
    });
    const result = await composeExplanation(
      makeInput({ bedrockInvoker: makeBedrockSuccess(injected) }),
    );
    if (result.outcome !== 'failed') {
      expect(result.text_source).toBe('template');
    }
  });

  it('Bedrock returns non-JSON text → template fallback', async () => {
    const result = await composeExplanation(
      makeInput({ bedrockInvoker: makeBedrockSuccess('純文字不是 JSON') }),
    );
    if (result.outcome !== 'failed') {
      expect(result.text_source).toBe('template');
    }
  });

  it('already_exists → branch_already_completed', async () => {
    const client: NarrativeTableClient = {
      conditionalPut: vi.fn(async () => 'already_exists'),
    };
    const result = await composeExplanation(makeInput({ narrativeClient: client }));
    expect(result.outcome).toBe('branch_already_completed');
  });

  it('DDB error → outcome: failed', async () => {
    const client: NarrativeTableClient = {
      conditionalPut: vi.fn(async () => { throw new Error('DDB down'); }),
    };
    const result = await composeExplanation(makeInput({ narrativeClient: client }));
    expect(result.outcome).toBe('failed');
    if (result.outcome === 'failed') {
      expect(result.error).toContain('DDB down');
    }
  });

  it('ready_event_id contains decision.enriched (no standalone explanation.ready)', async () => {
    const result = await composeExplanation(makeInput());
    if (result.outcome !== 'failed') {
      expect(result.ready_event_id).toContain('decision.enriched');
      expect(result.ready_event_id).not.toContain('explanation.ready');
    }
  });

  it('writes EXPLANATION item to DDB', async () => {
    const client = committedClient();
    await composeExplanation(makeInput({ narrativeClient: client }));
    const item = (client.conditionalPut as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as NarrativeItem;
    expect(item.narrative_type).toBe(NarrativeType.EXPLANATION);
    expect(item.payload.type).toBe('EXPLANATION');
  });

  it('does not mutate DecisionCore (read-only)', async () => {
    const core = makeCore();
    const before = JSON.stringify(core);
    await composeExplanation(makeInput({ core }));
    expect(JSON.stringify(core)).toBe(before);
  });

  it('s3_fallback citation → fallback explanation_text includes source_location AND 類比引用 marker', async () => {
    const client = committedClient();
    await composeExplanation(
      makeInput({ citations: SAMPLE_S3_FALLBACK_CITATIONS, narrativeClient: client }),
    );
    const item = (client.conditionalPut as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as NarrativeItem;
    const payload = item.payload as { explanation_text: string };
    expect(payload.explanation_text).toContain('s3://bucket/sop/article-2.json');
    expect(payload.explanation_text).toContain('類比引用');
  });

  it('kb citation → fallback explanation_text includes source_location WITHOUT 類比引用 marker', async () => {
    const client = committedClient();
    await composeExplanation(
      makeInput({ citations: SAMPLE_KB_CITATIONS, narrativeClient: client }),
    );
    const item = (client.conditionalPut as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as NarrativeItem;
    const payload = item.payload as { explanation_text: string };
    expect(payload.explanation_text).toContain('s3://bucket/sop/article-2.json');
    expect(payload.explanation_text).not.toContain('類比引用');
  });

  it('Bedrock success + s3_fallback citation WITHOUT disclosure → appends fallback disclosure', async () => {
    const json = JSON.stringify({ explanation_text: '這是 Bedrock 產生的解釋文字，不含揭露' });
    const client = committedClient();
    const result = await composeExplanation(
      makeInput({
        bedrockInvoker: makeBedrockSuccess(json),
        citations: SAMPLE_S3_FALLBACK_CITATIONS,
        narrativeClient: client,
      }),
    );
    if (result.outcome !== 'failed') {
      expect(result.text_source).toBe('bedrock');
    }
    const item = (client.conditionalPut as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as NarrativeItem;
    const payload = item.payload as { explanation_text: string };
    expect(payload.explanation_text).toContain('類比引用');
    expect(payload.explanation_text).toContain('這是 Bedrock 產生的解釋文字');
  });

  it('Bedrock success + s3_fallback citation WITH disclosure already → does NOT double-append', async () => {
    const json = JSON.stringify({ explanation_text: '這是解釋，本次含類比引用資料' });
    const client = committedClient();
    const result = await composeExplanation(
      makeInput({
        bedrockInvoker: makeBedrockSuccess(json),
        citations: SAMPLE_S3_FALLBACK_CITATIONS,
        narrativeClient: client,
      }),
    );
    if (result.outcome !== 'failed') {
      expect(result.text_source).toBe('bedrock');
    }
    const item = (client.conditionalPut as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as NarrativeItem;
    const payload = item.payload as { explanation_text: string };
    // Should contain 類比引用 exactly once (already in text, not appended)
    const matches = payload.explanation_text.match(/類比引用/g);
    expect(matches).toHaveLength(1);
  });

  it('Bedrock success + kb-only citation → no fallback disclosure appended', async () => {
    const json = JSON.stringify({ explanation_text: '純 KB 解釋文字' });
    const client = committedClient();
    await composeExplanation(
      makeInput({
        bedrockInvoker: makeBedrockSuccess(json),
        citations: SAMPLE_KB_CITATIONS,
        narrativeClient: client,
      }),
    );
    const item = (client.conditionalPut as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as NarrativeItem;
    const payload = item.payload as { explanation_text: string };
    expect(payload.explanation_text).not.toContain('類比引用');
    expect(payload.explanation_text).toBe('純 KB 解釋文字');
  });
});
