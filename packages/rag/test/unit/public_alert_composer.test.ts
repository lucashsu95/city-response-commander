/**
 * PublicAlertComposer — unit tests (TASK-114, TASK-050 P36)
 *
 * P36（§22.1）：SOP-6 觸發時，語言下限 zh+en；bonus 啟用時 zh+en+ja+ko；
 *              Bedrock 失敗時 template fallback 絕不退化為只有 zh。
 */

import * as fc from 'fast-check';
import { describe, it, expect, vi } from 'vitest';
import {
  composePublicAlert,
  resolveLanguages,
  type PublicAlertComposerInput,
} from '../../src/public_alert_composer.js';
import { Language, NarrativeType } from '@city-commander/shared-schemas';
import { requiredAlertLanguages } from '@city-commander/domain';
import type { NarrativeTableClient, NarrativeItem } from '../../src/narrative_writer.js';
import type { BedrockInvoker, BedrockResult } from '../../src/bedrock_adapter.js';
import type { DecisionCore } from '@city-commander/shared-schemas';

// ─── Stub helpers ──────────────────────────────────────────────────────────

function makeMinimalCore(multilingual_required: boolean): DecisionCore {
  return {
    decision_id: 'dec-001',
    version: 1,
    multilingual_required,
    event_id: 'EVT-001',
    occurred_at: '2026-05-20 22:10',
    primary_evacuation: 'RD_TPE_004',
    secondary_evacuation: [],
    triggered_articles: [6],
    applied_formula_articles: [],
    invoked_procedures: [],
    classifications: [],
    excluded_candidates: [],
    ete: undefined,
    evidence: {
      decision_id: 'dec-001',
      classification_reasoning: [],
      excluded_routes: [],
      sop_citations: [],
      data_points: [],
    },
    // other required fields — not used by PublicAlertComposer
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

function makeBedrockSuccess(text: string): BedrockInvoker {
  return { invoke: vi.fn(async (): Promise<BedrockResult> => ({ outcome: 'success', text, usedModelId: 'mock' })) };
}

function makeBedrockFailure(): BedrockInvoker {
  return { invoke: vi.fn(async (): Promise<BedrockResult> => ({ outcome: 'use_template', reason: 'timeout', message: 'timed out' })) };
}

function makeInput(
  opts: {
    multilingual?: boolean;
    bonus?: boolean;
    bedrock?: BedrockInvoker;
    client?: NarrativeTableClient;
  } = {},
): PublicAlertComposerInput {
  return {
    core: makeMinimalCore(opts.multilingual ?? false),
    bonusLanguagesEnabled: opts.bonus ?? false,
    narrativeClient: opts.client ?? committedClient(),
    bedrockInvoker: opts.bedrock ?? makeBedrockFailure(),
  };
}

// ─── resolveLanguages (deterministic, LLM-prohibited) ─────────────────────

describe('resolveLanguages', () => {
  it('SOP-6 not triggered → only zh', () => {
    expect(resolveLanguages(false, false)).toEqual([Language.ZH]);
  });

  it('SOP-6 triggered, no bonus → zh + en', () => {
    const langs = resolveLanguages(true, false);
    expect(langs).toContain(Language.ZH);
    expect(langs).toContain(Language.EN);
    expect(langs).toHaveLength(2);
  });

  it('SOP-6 triggered + bonus → zh + en + ja + ko', () => {
    const langs = resolveLanguages(true, true);
    expect(langs).toContain(Language.ZH);
    expect(langs).toContain(Language.EN);
    expect(langs).toContain(Language.JA);
    expect(langs).toContain(Language.KO);
    expect(langs).toHaveLength(4);
  });
});

// ─── 語言下限單一來源（domain）────────────────────────────────────────────

describe('resolveLanguages 委派 domain 的 requiredAlertLanguages', () => {
  it(
    'Feature: city-response-commander, Property 36e: resolveLanguages 對所有 (sop6, bonus) 組合均等於 domain 的語言下限',
    () => {
      fc.assert(
        fc.property(fc.boolean(), fc.boolean(), (sop6Triggered, bonusEnabled) => {
          // domain 是語言下限的唯一真值來源；rag 只做 enum 型別轉換
          expect(resolveLanguages(sop6Triggered, bonusEnabled)).toEqual(
            requiredAlertLanguages(sop6Triggered, bonusEnabled),
          );
        }),
        { numRuns: 100 },
      );
    },
  );
});

// ─── P36 property test ─────────────────────────────────────────────────────

describe('P36: language floor never degrades to zh-only when SOP-6 triggered', () => {
  it(
    'Feature: city-response-commander, Property 36: triggered SOP-6 always produces zh+en minimum',
    () => {
      fc.assert(
        fc.property(fc.boolean(), (bonusEnabled) => {
          const langs = resolveLanguages(true, bonusEnabled);
          expect(langs).toContain(Language.ZH);
          expect(langs).toContain(Language.EN);
          // 絕不只有 zh
          expect(langs.length).toBeGreaterThanOrEqual(2);
        }),
        { numRuns: 100 },
      );
    },
  );

  it(
    'Feature: city-response-commander, Property 36b: untriggered SOP-6 → exactly zh only',
    () => {
      fc.assert(
        fc.property(fc.boolean(), (bonusEnabled) => {
          const langs = resolveLanguages(false, bonusEnabled);
          expect(langs).toEqual([Language.ZH]);
        }),
        { numRuns: 100 },
      );
    },
  );
});

// ─── composePublicAlert ────────────────────────────────────────────────────

describe('composePublicAlert', () => {
  it('Bedrock failure → template fallback → committed', async () => {
    const result = await composePublicAlert(
      makeInput({ multilingual: false, bedrock: makeBedrockFailure() }),
    );
    expect(result.outcome).toBe('committed');
    if (result.outcome !== 'failed') {
      expect(result.text_source).toBe('template');
    }
  });

  it('Bedrock success with valid JSON map → bedrock source', async () => {
    const validJson = JSON.stringify({
      public_alert_text: { zh: '警示', en: 'Alert' },
    });
    const result = await composePublicAlert(
      makeInput({ multilingual: true, bedrock: makeBedrockSuccess(validJson) }),
    );
    if (result.outcome !== 'failed') {
      expect(result.text_source).toBe('bedrock');
    }
  });

  it('Bedrock success with prohibited field → template fallback', async () => {
    const injectedJson = JSON.stringify({
      public_alert_text: { zh: '警示' },
      cms_core_text: 'injected',
    });
    const result = await composePublicAlert(
      makeInput({ multilingual: true, bedrock: makeBedrockSuccess(injectedJson) }),
    );
    if (result.outcome !== 'failed') {
      expect(result.text_source).toBe('template');
    }
  });

  it('already_exists → branch_already_completed', async () => {
    const client: NarrativeTableClient = {
      conditionalPut: vi.fn(async () => 'already_exists'),
    };
    const result = await composePublicAlert(
      makeInput({ bedrock: makeBedrockFailure(), client }),
    );
    expect(result.outcome).toBe('branch_already_completed');
  });

  it('DDB error → outcome: failed', async () => {
    const client: NarrativeTableClient = {
      conditionalPut: vi.fn(async () => { throw new Error('DDB down'); }),
    };
    const result = await composePublicAlert(
      makeInput({ bedrock: makeBedrockFailure(), client }),
    );
    expect(result.outcome).toBe('failed');
  });

  it('ready_event_id contains public_alert.ready', async () => {
    const result = await composePublicAlert(makeInput());
    if (result.outcome !== 'failed') {
      expect(result.ready_event_id).toContain('public_alert.ready');
    }
  });

  it('writes PUBLIC_ALERT item to DDB', async () => {
    const client = committedClient();
    await composePublicAlert(makeInput({ client }));
    const item = (client.conditionalPut as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as NarrativeItem;
    expect(item.narrative_type).toBe(NarrativeType.PUBLIC_ALERT);
  });

  it('languages exposed in success result', async () => {
    const result = await composePublicAlert(
      makeInput({ multilingual: true, bonus: true }),
    );
    if (result.outcome !== 'failed') {
      expect(result.languages).toContain(Language.ZH);
      expect(result.languages).toContain(Language.EN);
      expect(result.languages).toContain(Language.JA);
      expect(result.languages).toContain(Language.KO);
    }
  });
});

// ─── P29 property test (TASK-050) ──────────────────────────────────────────

describe('composePublicAlert — Property 29: bonus languages share the same ETE fact', () => {
  it(
    'Feature: city-response-commander, Property 29: triggered bonus alerts include Japanese and Korean carrying the same ETE fact in the same response',
    async () => {
      await fc.assert(
        fc.asyncProperty(fc.integer({ min: 0, max: 300 }), async (delay) => {
          const core: DecisionCore = {
            ...makeMinimalCore(true),
            ete: {
              calculation_status: 'computed',
              ete_minutes: delay,
              base_clearance: 60,
              congestion_penalty: 0,
              avg_saturation: 0.5,
              severity: 'Critical',
            } as unknown as DecisionCore['ete'],
          };
          const client = committedClient();
          const result = await composePublicAlert({
            core,
            bonusLanguagesEnabled: true,
            narrativeClient: client,
            bedrockInvoker: makeBedrockFailure(),
          });

          if (result.outcome === 'failed') return;
          expect(result.languages).toEqual([Language.ZH, Language.EN, Language.JA, Language.KO]);

          const item = (client.conditionalPut as ReturnType<typeof vi.fn>).mock
            .calls[0]?.[0] as NarrativeItem;
          const payload = item.payload as { public_alert_text: Record<string, string> };
          expect(payload.public_alert_text[Language.ZH]).toBeTruthy();
          expect(payload.public_alert_text[Language.EN]).toBeTruthy();
          expect(payload.public_alert_text[Language.JA]).toContain(String(delay));
          expect(payload.public_alert_text[Language.KO]).toContain(String(delay));
        }),
        { numRuns: 100 },
      );
    },
  );
});
