/**
 * MockBedrockAdapter — unit tests (TASK-112)
 *
 * 重點：LOCAL_MOCK 下 composers 必須真正走到「Bedrock accepted」路徑，
 * 而不是每次都被 JSON.parse 失敗打回 template fallback。
 *
 * @module rag/test/unit/mock_bedrock_adapter
 */

import { describe, it, expect } from 'vitest';
import { MockBedrockAdapter } from '../../src/mock_bedrock_adapter.js';
import { validateBedrockPayload } from '../../src/schema_validator.js';
import { NarrativeType } from '@city-commander/shared-schemas';
import type { DecisionCore } from '@city-commander/shared-schemas';
import { composeReport } from '../../src/report_composer.js';
import { composeExplanation } from '../../src/explanation_composer.js';
import { composePublicAlert } from '../../src/public_alert_composer.js';
import type { NarrativeTableClient } from '../../src/narrative_writer.js';

const adapter = new MockBedrockAdapter();

/** 呼叫 mock 並解析其 JSON 輸出 */
async function invokeJson(prompt: string): Promise<unknown> {
  const result = await adapter.invoke(prompt);
  expect(result.outcome).toBe('success');
  if (result.outcome !== 'success') throw new Error('unreachable');
  expect(result.usedModelId).toBe('mock');
  return JSON.parse(result.text) as unknown;
}

// 各 composer prompt 的判別特徵（與實際 prompt 的指示段落一致）
const REPORT_PROMPT = '請回傳 JSON 物件，只包含以下欄位：\n- report_text：完整建議書文字\n- cms_explanation_text（選填）';
const EXPLANATION_PROMPT = '請回傳 JSON 物件，只包含以下欄位：\n- explanation_text：決策解釋文字';
const PUBLIC_ALERT_PROMPT = `{
  "public_alert_text": {
    "zh": "<繁體中文警示文字>",
    "en": "<English警示文字>"
  }
}
必須包含的語言鍵："zh", "en"`;
const SCENARIO_PARSER_PROMPT = '{\n  "status": "parsed",\n  "assumptions": [\n    {"entity_id": "BS_MRT_BL17"}\n  ]\n}';

describe('MockBedrockAdapter — 輸出恆為合法 JSON', () => {
  it('每種 prompt 形狀都可 JSON.parse（不再落入 non-JSON fallback）', async () => {
    for (const prompt of [
      REPORT_PROMPT,
      EXPLANATION_PROMPT,
      PUBLIC_ALERT_PROMPT,
      SCENARIO_PARSER_PROMPT,
      'totally unknown prompt',
    ]) {
      await expect(invokeJson(prompt)).resolves.toBeTypeOf('object');
    }
  });

  it('不呼叫任何 AWS SDK（純函式，可離線執行）', async () => {
    const result = await adapter.invoke(REPORT_PROMPT);
    expect(result.outcome).toBe('success');
  });
});

describe('MockBedrockAdapter — 通過 SchemaValidator 的 accepted 路徑', () => {
  it('REPORT prompt → 白名單欄位通過驗證', async () => {
    const payload = await invokeJson(REPORT_PROMPT);
    const validation = validateBedrockPayload(NarrativeType.REPORT, payload);
    expect(validation.outcome).toBe('accepted');
    if (validation.outcome !== 'accepted') return;
    expect(validation.fields['report_text']).toContain('[MOCK-BEDROCK]');
  });

  it('EXPLANATION prompt → 白名單欄位通過驗證', async () => {
    const payload = await invokeJson(EXPLANATION_PROMPT);
    const validation = validateBedrockPayload(NarrativeType.EXPLANATION, payload);
    expect(validation.outcome).toBe('accepted');
    if (validation.outcome !== 'accepted') return;
    expect(validation.fields['explanation_text']).toContain('[MOCK-BEDROCK]');
  });

  it('PUBLIC_ALERT prompt → 語言 map 通過驗證，且只含 prompt 要求的語言', async () => {
    const payload = await invokeJson(PUBLIC_ALERT_PROMPT);
    const validation = validateBedrockPayload(NarrativeType.PUBLIC_ALERT, payload);
    expect(validation.outcome).toBe('accepted');
    if (validation.outcome !== 'accepted') return;
    expect(Object.keys(validation.alertTextMap ?? {}).sort()).toEqual(['en', 'zh']);
  });

  it('PUBLIC_ALERT 四語 prompt → 四個語言鍵', async () => {
    const payload = await invokeJson(
      '"public_alert_text" 必須包含的語言鍵："zh", "en", "ja", "ko"',
    );
    const validation = validateBedrockPayload(NarrativeType.PUBLIC_ALERT, payload);
    expect(validation.outcome).toBe('accepted');
    if (validation.outcome !== 'accepted') return;
    expect(Object.keys(validation.alertTextMap ?? {}).sort()).toEqual(['en', 'ja', 'ko', 'zh']);
  });
});

describe('MockBedrockAdapter — 邊界', () => {
  it('mock 不產生任何 LLM-prohibited 欄位', async () => {
    const prohibited = ['ete', 'triggered_articles', 'classifications', 'cms_core_text', 'core_hash'];
    for (const prompt of [REPORT_PROMPT, EXPLANATION_PROMPT, PUBLIC_ALERT_PROMPT]) {
      const payload = (await invokeJson(prompt)) as Record<string, unknown>;
      for (const key of prohibited) {
        expect(payload).not.toHaveProperty(key);
      }
    }
  });

  it('What-if stage 1 → clarification（mock 不假裝能做自然語言解析）', async () => {
    const payload = (await invokeJson(SCENARIO_PARSER_PROMPT)) as Record<string, unknown>;
    expect(payload['status']).toBe('clarification_required');
    expect(String(payload['reason'])).toContain('LOCAL_MOCK');
  });

  it('未知 prompt 形狀 → 不含白名單欄位，呼叫端會走 template fallback', async () => {
    const payload = await invokeJson('unrecognized');
    expect(validateBedrockPayload(NarrativeType.REPORT, payload).outcome).toBe('use_template');
  });

  it('所有生成文字都帶 [MOCK-BEDROCK] 標記，不會被誤認為真實輸出', async () => {
    const report = (await invokeJson(REPORT_PROMPT)) as Record<string, string>;
    expect(report['report_text']).toContain('[MOCK-BEDROCK]');
    expect(report['cms_explanation_text']).toContain('[MOCK-BEDROCK]');
  });
});

// ─── 與真實 composer prompt 的整合（避免只驗證合成 prompt）───────────────

describe('MockBedrockAdapter — 對真實 composer prompt 生效', () => {
  function makeCore(overrides: Partial<DecisionCore> = {}): DecisionCore {
    return {
      decision_id: 'dec-mock-001',
      version: 1,
      event_id: 'ACC_001',
      occurred_at: '2026-05-20 22:10',
      primary_evacuation: 'RD_TPE_004',
      secondary_evacuation: [],
      triggered_articles: [1, 2],
      applied_formula_articles: [7],
      invoked_procedures: [],
      classifications: [],
      excluded_candidates: [],
      multilingual_required: true,
      ete: undefined,
      evidence: {
        decision_id: 'dec-mock-001',
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
      cms_core_text: 'CMS text',
      provisional: false,
      schema_version: '1.0.0',
      policy: {} as DecisionCore['policy'],
      ...overrides,
    } as unknown as DecisionCore;
  }

  const narrativeClient: NarrativeTableClient = {
    async conditionalPut() {
      return 'committed';
    },
  };

  it('composeReport 走到 bedrock 路徑（不再是 template）', async () => {
    const result = await composeReport({
      core: makeCore(),
      citations: [],
      narrativeClient,
      bedrockInvoker: adapter,
    });
    expect(result.outcome).toBe('committed');
    if (result.outcome === 'failed') return;
    expect(result.text_source).toBe('bedrock');
  });

  it('composeExplanation 走到 bedrock 路徑', async () => {
    const result = await composeExplanation({
      core: makeCore(),
      citations: [],
      narrativeClient,
      bedrockInvoker: adapter,
    });
    expect(result.outcome).toBe('committed');
    if (result.outcome === 'failed') return;
    expect(result.text_source).toBe('bedrock');
  });

  it('composePublicAlert 走到 bedrock 路徑，且語言集合仍由決定性程式決定', async () => {
    const result = await composePublicAlert({
      core: makeCore({ multilingual_required: true }),
      bonusLanguagesEnabled: true,
      narrativeClient,
      bedrockInvoker: adapter,
    });
    expect(result.outcome).toBe('committed');
    if (result.outcome === 'failed') return;
    expect(result.text_source).toBe('bedrock');
    expect(result.languages).toEqual(['zh', 'en', 'ja', 'ko']);
  });
});
