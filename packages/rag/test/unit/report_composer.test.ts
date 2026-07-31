/**
 * ReportComposer — unit tests (TASK-113)
 *
 * 驗證：
 * - Bedrock 失敗 → template fallback → committed
 * - Bedrock 成功（valid JSON）→ bedrock source
 * - 禁止欄位注入 → template fallback
 * - DDB 錯誤 → outcome: failed
 * - ready_event_id 包含 report.ready
 * - 寫入的 item 是 REPORT type
 * - cms_core_text 不可被 LLM 修改（不出現在 REPORT payload）
 */

import * as fc from 'fast-check';
import { describe, it, expect, vi } from 'vitest';
import {
  composeReport,
  type ReportComposerInput,
} from '../../src/report_composer.js';
import { NarrativeType } from '@city-commander/shared-schemas';
import type { NarrativeTableClient, NarrativeItem } from '../../src/narrative_writer.js';
import type { BedrockInvoker, BedrockResult } from '../../src/bedrock_adapter.js';
import type { DecisionCore, Art1Measures } from '@city-commander/shared-schemas';
import type { SopCitationResult } from '../../src/sop_retriever.js';

// ─── Stub helpers ──────────────────────────────────────────────────────────

function makeCore(): DecisionCore {
  return {
    decision_id: 'dec-rpt-001',
    version: 1,
    event_id: 'ACC_001',
    occurred_at: '2026-05-20 22:10',
    primary_evacuation: 'RD_TPE_004',
    secondary_evacuation: ['RD_TPE_005'],
    triggered_articles: [1, 2],
    applied_formula_articles: [7],
    invoked_procedures: ['article2_alternative_route_guidance'],
    classifications: [{ segment_id: 'RD_TPE_002', level: 'A' }],
    excluded_candidates: [
      { segment_id: 'RD_TPE_008', exclusion_reason: 'capacity_vph < 1000' } as unknown as DecisionCore['excluded_candidates'][0],
    ],
    multilingual_required: false,
    ete: {
      calculation_status: 'computed',
      ete_minutes: 78.6,
      base_clearance: 60,
      congestion_penalty: 18.6,
      avg_saturation: 0.81,
      severity: 'Critical',
    } as unknown as DecisionCore['ete'],
    evidence: {
      decision_id: 'dec-rpt-001',
      classification_reasoning: [],
      excluded_routes: [],
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

const SAMPLE_CITATIONS: readonly SopCitationResult[] = [
  { article_no: 2, content: 'SOP 第 2 條原文', source_location: 's3://bucket/sop/article-2.json', relevancy_score: null },
  { article_no: 7, content: 'SOP 第 7 條原文', source_location: 's3://bucket/sop/article-7.json', relevancy_score: null },
];

function committedClient(): NarrativeTableClient {
  return { conditionalPut: vi.fn(async () => 'committed') };
}

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

function makeInput(overrides: Partial<ReportComposerInput> = {}): ReportComposerInput {
  return {
    core: makeCore(),
    citations: SAMPLE_CITATIONS,
    narrativeClient: committedClient(),
    bedrockInvoker: makeBedrockFailure(),
    ...overrides,
  };
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('composeReport', () => {
  it('Bedrock failure → template fallback → committed', async () => {
    const result = await composeReport(makeInput());
    expect(result.outcome).toBe('committed');
    if (result.outcome !== 'failed') {
      expect(result.text_source).toBe('template');
    }
  });

  it('Bedrock success with valid report_text → bedrock source', async () => {
    const json = JSON.stringify({ report_text: '交控中心建議書內容' });
    const result = await composeReport(
      makeInput({ bedrockInvoker: makeBedrockSuccess(json) }),
    );
    if (result.outcome !== 'failed') {
      expect(result.text_source).toBe('bedrock');
    }
  });

  it('Bedrock injects cms_core_text (LLM-prohibited) → template fallback', async () => {
    const injected = JSON.stringify({
      report_text: '建議書',
      cms_core_text: 'injected override',
    });
    const result = await composeReport(
      makeInput({ bedrockInvoker: makeBedrockSuccess(injected) }),
    );
    if (result.outcome !== 'failed') {
      expect(result.text_source).toBe('template');
    }
  });

  it('Bedrock injects primary_evacuation (LLM-prohibited) → template fallback', async () => {
    const injected = JSON.stringify({
      report_text: '建議書',
      primary_evacuation: 'RD_TPE_999',
    });
    const result = await composeReport(
      makeInput({ bedrockInvoker: makeBedrockSuccess(injected) }),
    );
    if (result.outcome !== 'failed') {
      expect(result.text_source).toBe('template');
    }
  });

  it('Bedrock returns non-JSON text → template fallback', async () => {
    const result = await composeReport(
      makeInput({ bedrockInvoker: makeBedrockSuccess('純文字') }),
    );
    if (result.outcome !== 'failed') {
      expect(result.text_source).toBe('template');
    }
  });

  it('already_exists → branch_already_completed', async () => {
    const client: NarrativeTableClient = {
      conditionalPut: vi.fn(async () => 'already_exists'),
    };
    const result = await composeReport(makeInput({ narrativeClient: client }));
    expect(result.outcome).toBe('branch_already_completed');
  });

  it('DDB error → outcome: failed', async () => {
    const client: NarrativeTableClient = {
      conditionalPut: vi.fn(async () => { throw new Error('DDB error'); }),
    };
    const result = await composeReport(makeInput({ narrativeClient: client }));
    expect(result.outcome).toBe('failed');
  });

  it('ready_event_id contains report.ready', async () => {
    const result = await composeReport(makeInput());
    if (result.outcome !== 'failed') {
      expect(result.ready_event_id).toContain('report.ready');
    }
  });

  it('writes REPORT item to DDB', async () => {
    const client = committedClient();
    await composeReport(makeInput({ narrativeClient: client }));
    const item = (client.conditionalPut as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as NarrativeItem;
    expect(item.narrative_type).toBe(NarrativeType.REPORT);
    expect(item.payload.type).toBe('REPORT');
  });

  it('REPORT payload does not contain cms_core_text (LLM-prohibited)', async () => {
    const client = committedClient();
    await composeReport(makeInput({ narrativeClient: client }));
    const item = (client.conditionalPut as ReturnType<typeof vi.fn>).mock
      .calls[0]?.[0] as NarrativeItem;
    expect(item.payload).not.toHaveProperty('cms_core_text');
  });

  it('does not mutate DecisionCore', async () => {
    const core = makeCore();
    const before = JSON.stringify(core);
    await composeReport(makeInput({ core }));
    expect(JSON.stringify(core)).toBe(before);
  });
});

// ─── P24 property: report completeness (TASK-048) ─────────────────────────

const SAMPLE_ART1_MEASURES: Art1Measures = {
  level: 'A',
  trigger_segment: 'RD_TPE_001',
  long_green_timing: true,
  alternatives_green_plus_pct: 25,
  police_clear_intersections: true,
  a_level_invokes_article2_alternative_route_guidance: true,
};

async function renderTemplateReportText(core: DecisionCore): Promise<string> {
  const client: NarrativeTableClient = { conditionalPut: vi.fn(async () => 'committed') };
  await composeReport(
    makeInput({ core, narrativeClient: client, bedrockInvoker: makeBedrockFailure() }),
  );
  const item = (client.conditionalPut as ReturnType<typeof vi.fn>).mock
    .calls[0]?.[0] as NarrativeItem;
  const payload = item.payload as { report_text: string };
  return payload.report_text;
}

describe('composeReport — Property 24: template report completeness', () => {
  it(
    'Feature: city-response-commander, Property 24: deterministic template report includes event id, grading, routes, exclusions, signal timing, cross-system requests and ETE facts',
    async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.record({
            art3: fc.boolean(),
            art5: fc.boolean(),
            hasSignalMeasures: fc.boolean(),
            delay: fc.integer({ min: 0, max: 300 }),
          }),
          async ({ art3, art5, hasSignalMeasures, delay }) => {
            const core: DecisionCore = {
              ...makeCore(),
              triggered_articles: [1, 2, ...(art3 ? [3] : []), ...(art5 ? [5] : [])],
              art1_measures: hasSignalMeasures ? SAMPLE_ART1_MEASURES : undefined,
              ete: {
                calculation_status: 'computed',
                ete_minutes: delay,
                base_clearance: 60,
                congestion_penalty: 0,
                avg_saturation: 0.5,
                severity: 'Critical',
              } as unknown as DecisionCore['ete'],
            };

            const text = await renderTemplateReportText(core);

            // 事件辨識
            expect(text).toContain(core.event_id);
            // 路線建議：主/次疏散路段 + 排除理由
            expect(text).toContain(core.primary_evacuation!);
            for (const secondary of core.secondary_evacuation) {
              expect(text).toContain(secondary);
            }
            for (const excluded of core.excluded_candidates) {
              expect(text).toContain(excluded.exclusion_reason!);
            }
            // ETE 數值與依據
            expect(text).toContain(String(delay));
            // 號誌調整建議（僅 art1_measures 存在時）
            if (hasSignalMeasures) {
              expect(text).toContain('號誌調整');
              expect(text).toContain('25');
            }
            // 跨系統聯動（僅觸發第 3/5 條時）
            if (art3) expect(text).toContain('北捷');
            if (art5) expect(text).toContain('警力');
            if (!art3 && !art5) {
              expect(text).not.toContain('跨系統協調');
            }
          },
        ),
        { numRuns: 100 },
      );
    },
  );
});
