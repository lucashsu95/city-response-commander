/**
 * Schema validation integration test (TASK-120, step 2)
 *
 * 驗證 §9 boundary 在 composer 端對端流程中確實生效：
 * - core-overwrite 嘗試（LLM-prohibited fields）→ SchemaValidator 拒絕 → template fallback
 * - 合法 Bedrock 輸出 → 通過 → bedrock source
 * - Bedrock 完全失敗 → template fallback，不阻擋流程
 * - 使用 MockBedrockAdapter stub（無實際 AWS 呼叫）
 */

import { describe, it, expect, vi } from 'vitest';
import { composeReport } from '../../src/report_composer.js';
import { composePublicAlert } from '../../src/public_alert_composer.js';
import { composeExplanation } from '../../src/explanation_composer.js';
import { validateBedrockPayload } from '../../src/schema_validator.js';
import { NarrativeType } from '@city-commander/shared-schemas';
import type { NarrativeTableClient, NarrativeItem } from '../../src/narrative_writer.js';
import type { BedrockInvoker, BedrockResult } from '../../src/bedrock_adapter.js';
import type { DecisionCore } from '@city-commander/shared-schemas';
import type { SopCitationResult } from '../../src/sop_retriever.js';

// ─── Stub helpers ──────────────────────────────────────────────────────────

function makeCore(): DecisionCore {
  return {
    decision_id: 'dec-schema-001',
    version: 1,
    event_id: 'ACC_001',
    occurred_at: '2026-05-20 22:10',
    primary_evacuation: 'RD_TPE_004',
    secondary_evacuation: ['RD_TPE_005'],
    triggered_articles: [1, 2],
    applied_formula_articles: [7],
    invoked_procedures: ['article2_alternative_route_guidance'],
    classifications: [{ segment_id: 'RD_TPE_002', level: 'A' }],
    excluded_candidates: [],
    multilingual_required: true,
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
      decision_id: 'dec-schema-001',
      classification_reasoning: [
        { segment_id: 'RD_TPE_002', value: 0.97, threshold: '>= 0.95', conclusion: 'A 級' },
      ],
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
  { article_no: 2, content: 'SOP 第 2 條', source_location: 's3://bucket/sop/article-2.json', relevancy_score: 0.9, source: 'kb' },
  { article_no: 7, content: 'SOP 第 7 條', source_location: 's3://bucket/sop/article-7.json', relevancy_score: 0.85, source: 'kb' },
];

function committedClient(): NarrativeTableClient {
  return { conditionalPut: vi.fn(async () => 'committed') };
}

function makeBedrockSuccess(text: string): BedrockInvoker {
  return {
    invoke: vi.fn(async (): Promise<BedrockResult> => ({
      outcome: 'success', text, usedModelId: 'mock',
    })),
  };
}

function makeBedrockFailure(): BedrockInvoker {
  return {
    invoke: vi.fn(async (): Promise<BedrockResult> => ({
      outcome: 'use_template', reason: 'timeout', message: 'timed out',
    })),
  };
}

// ─── SchemaValidator unit: core-overwrite rejection ──────────────────────

describe('SchemaValidator — core-overwrite rejection (§9 boundary)', () => {
  it('REPORT: primary_evacuation injection → use_template', () => {
    const result = validateBedrockPayload(NarrativeType.REPORT, {
      report_text: '建議書',
      primary_evacuation: 'RD_TPE_INJECTED',
    });
    expect(result.outcome).toBe('use_template');
    if (result.outcome === 'use_template') {
      expect(result.reason).toBe('prohibited_field_overwrite');
      expect(result.offendingFields).toContain('primary_evacuation');
    }
  });

  it('REPORT: ete injection → use_template', () => {
    const result = validateBedrockPayload(NarrativeType.REPORT, {
      report_text: '建議書',
      ete: 99,
    });
    expect(result.outcome).toBe('use_template');
    if (result.outcome === 'use_template') {
      expect(result.reason).toBe('prohibited_field_overwrite');
    }
  });

  it('REPORT: cms_core_text injection → use_template', () => {
    const result = validateBedrockPayload(NarrativeType.REPORT, {
      report_text: '建議書',
      cms_core_text: 'INJECTED_CMS',
    });
    expect(result.outcome).toBe('use_template');
  });

  it('EXPLANATION: classifications injection → use_template', () => {
    const result = validateBedrockPayload(NarrativeType.EXPLANATION, {
      explanation_text: '解釋',
      classifications: [{ segment_id: 'RD_X', level: 'A' }],
    });
    expect(result.outcome).toBe('use_template');
    if (result.outcome === 'use_template') {
      expect(result.reason).toBe('prohibited_field_overwrite');
    }
  });

  it('PUBLIC_ALERT: multilingual_required injection → use_template', () => {
    const result = validateBedrockPayload(NarrativeType.PUBLIC_ALERT, {
      public_alert_text: { zh: '警示' },
      multilingual_required: true,
    });
    expect(result.outcome).toBe('use_template');
    if (result.outcome === 'use_template') {
      expect(result.reason).toBe('prohibited_field_overwrite');
    }
  });

  it('valid payload passes through unchanged', () => {
    const result = validateBedrockPayload(NarrativeType.REPORT, {
      report_text: '正常建議書內容',
    });
    expect(result.outcome).toBe('accepted');
    if (result.outcome === 'accepted') {
      expect(result.fields['report_text']).toBe('正常建議書內容');
    }
  });
});

// ─── End-to-end: core-overwrite in composer → template fallback ─────────

describe('Composer integration — core-overwrite triggers template fallback', () => {
  it('ReportComposer: LLM injects primary_evacuation → text_source=template, DDB still committed', async () => {
    const injectedJson = JSON.stringify({
      report_text: '建議書',
      primary_evacuation: 'RD_TPE_999',
    });
    const client = committedClient();
    const result = await composeReport({
      core: makeCore(),
      citations: SAMPLE_CITATIONS,
      narrativeClient: client,
      bedrockInvoker: makeBedrockSuccess(injectedJson),
    });

    expect(result.outcome).toBe('committed');
    if (result.outcome !== 'failed') {
      expect(result.text_source).toBe('template');
    }
    // DecisionCore 仍應原封不動（DDB item 中不含 primary_evacuation）
    const item = (client.conditionalPut as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as NarrativeItem;
    expect(item.payload).not.toHaveProperty('primary_evacuation');
  });

  it('ExplanationComposer: LLM injects ete → text_source=template', async () => {
    const injectedJson = JSON.stringify({
      explanation_text: '解釋',
      ete: 999,
    });
    const result = await composeExplanation({
      core: makeCore(),
      citations: SAMPLE_CITATIONS,
      narrativeClient: committedClient(),
      bedrockInvoker: makeBedrockSuccess(injectedJson),
    });

    if (result.outcome !== 'failed') {
      expect(result.text_source).toBe('template');
    }
  });

  it('PublicAlertComposer: LLM injects multilingual_required → text_source=template', async () => {
    const injectedJson = JSON.stringify({
      public_alert_text: { zh: '警示' },
      multilingual_required: false,
    });
    const result = await composePublicAlert({
      core: makeCore(),
      bonusLanguagesEnabled: false,
      narrativeClient: committedClient(),
      bedrockInvoker: makeBedrockSuccess(injectedJson),
    });

    if (result.outcome !== 'failed') {
      expect(result.text_source).toBe('template');
    }
  });
});

// ─── Bedrock failure never blocks Fast Path ──────────────────────────────

describe('Bedrock failure — never blocks flow, always template fallback', () => {
  it('ReportComposer: Bedrock timeout → template fallback → committed', async () => {
    const result = await composeReport({
      core: makeCore(),
      citations: SAMPLE_CITATIONS,
      narrativeClient: committedClient(),
      bedrockInvoker: makeBedrockFailure(),
    });
    expect(result.outcome).toBe('committed');
    if (result.outcome !== 'failed') {
      expect(result.text_source).toBe('template');
    }
  });

  it('ExplanationComposer: Bedrock timeout → template fallback → committed', async () => {
    const result = await composeExplanation({
      core: makeCore(),
      citations: [],
      narrativeClient: committedClient(),
      bedrockInvoker: makeBedrockFailure(),
    });
    expect(result.outcome).toBe('committed');
    if (result.outcome !== 'failed') {
      expect(result.text_source).toBe('template');
    }
  });

  it('PublicAlertComposer: Bedrock timeout → template fallback → committed', async () => {
    const result = await composePublicAlert({
      core: makeCore(),
      bonusLanguagesEnabled: true,
      narrativeClient: committedClient(),
      bedrockInvoker: makeBedrockFailure(),
    });
    expect(result.outcome).toBe('committed');
    if (result.outcome !== 'failed') {
      expect(result.text_source).toBe('template');
    }
  });
});
