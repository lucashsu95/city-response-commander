/**
 * multilingual_templates — unit tests (TASK-117)
 *
 * 驗證：
 * - P36：SOP-6 triggered 時，語言下限 zh+en；絕不退化為只有 zh
 * - 各語言 template 值均為非空字串
 * - 只插入決定性事實（occurred_at / primary_evacuation / ete）
 * - ETE computed → 顯示分鐘數；insufficient → 待確認；無 ete → 空字串
 * - 無合規路段時顯示備援文字，不虛構路段名稱
 * - renderMultilingualTemplates 輸出 type === 'PUBLIC_ALERT'
 */

import * as fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import {
  renderMultilingualTemplates,
  formatEteForAlert,
} from '../../src/multilingual_templates.js';
import { Language } from '@city-commander/shared-schemas';
import type { DecisionCore } from '@city-commander/shared-schemas';

// ─── Stub helpers ──────────────────────────────────────────────────────────

function makeCore(overrides: Partial<DecisionCore> = {}): DecisionCore {
  return {
    decision_id: 'dec-ml-001',
    version: 1,
    event_id: 'EVT-001',
    occurred_at: '2026-05-20 22:10',
    primary_evacuation: 'RD_TPE_004',
    secondary_evacuation: [],
    triggered_articles: [6],
    applied_formula_articles: [],
    invoked_procedures: [],
    classifications: [],
    excluded_candidates: [],
    multilingual_required: true,
    ete: undefined,
    evidence: {
      decision_id: 'dec-ml-001',
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

const ALL_LANGUAGES: readonly Language[] = [Language.ZH, Language.EN, Language.JA, Language.KO];
const SOP6_LANGUAGES: readonly Language[] = [Language.ZH, Language.EN];

// ─── renderMultilingualTemplates ──────────────────────────────────────────

describe('renderMultilingualTemplates', () => {
  it('returns PUBLIC_ALERT payload type', () => {
    const result = renderMultilingualTemplates({
      core: makeCore(),
      languages: SOP6_LANGUAGES,
    });
    expect(result.type).toBe('PUBLIC_ALERT');
  });

  it('produces non-empty string for each required language', () => {
    const result = renderMultilingualTemplates({
      core: makeCore(),
      languages: ALL_LANGUAGES,
    });
    for (const lang of ALL_LANGUAGES) {
      const text = result.public_alert_text[lang];
      expect(typeof text).toBe('string');
      expect(text!.trim().length).toBeGreaterThan(0);
    }
  });

  it('only produces keys for requested languages (zh only)', () => {
    const result = renderMultilingualTemplates({
      core: makeCore({ multilingual_required: false }),
      languages: [Language.ZH],
    });
    expect(Object.keys(result.public_alert_text)).toEqual([Language.ZH]);
    expect(result.public_alert_text[Language.EN]).toBeUndefined();
  });

  it('zh+en languages → exactly two keys', () => {
    const result = renderMultilingualTemplates({
      core: makeCore(),
      languages: SOP6_LANGUAGES,
    });
    expect(Object.keys(result.public_alert_text)).toHaveLength(2);
    expect(result.public_alert_text[Language.ZH]).toBeDefined();
    expect(result.public_alert_text[Language.EN]).toBeDefined();
  });

  it('all four languages → four non-empty entries', () => {
    const result = renderMultilingualTemplates({
      core: makeCore(),
      languages: ALL_LANGUAGES,
    });
    expect(Object.keys(result.public_alert_text)).toHaveLength(4);
  });

  it('inserts occurred_at in zh template', () => {
    const core = makeCore({ occurred_at: '2026-08-01 14:30' });
    const result = renderMultilingualTemplates({ core, languages: [Language.ZH] });
    expect(result.public_alert_text[Language.ZH]).toContain('2026-08-01 14:30');
  });

  it('inserts primary_evacuation in en template', () => {
    const core = makeCore({ primary_evacuation: 'RD_TPE_004' });
    const result = renderMultilingualTemplates({ core, languages: [Language.EN] });
    expect(result.public_alert_text[Language.EN]).toContain('RD_TPE_004');
  });

  it('null primary_evacuation shows fallback text, not null', () => {
    const core = makeCore({ primary_evacuation: null });
    const result = renderMultilingualTemplates({ core, languages: ALL_LANGUAGES });
    for (const lang of ALL_LANGUAGES) {
      const text = result.public_alert_text[lang]!;
      expect(text).not.toContain('null');
      expect(text.trim().length).toBeGreaterThan(0);
    }
  });

  it('with computed ETE → ete_minutes appears in zh', () => {
    const core = makeCore({
      ete: {
        calculation_status: 'computed',
        ete_minutes: 78.6,
      } as unknown as DecisionCore['ete'],
    });
    const result = renderMultilingualTemplates({ core, languages: [Language.ZH] });
    expect(result.public_alert_text[Language.ZH]).toContain('78.6');
  });

  it('with insufficient_common_snapshot → shows pending text, not minutes', () => {
    const core = makeCore({
      ete: {
        calculation_status: 'insufficient_common_snapshot',
        ete_lower_bound_minutes: 60,
      } as unknown as DecisionCore['ete'],
    });
    const result = renderMultilingualTemplates({ core, languages: [Language.ZH] });
    const text = result.public_alert_text[Language.ZH]!;
    expect(text).not.toContain('undefined');
    expect(text.length).toBeGreaterThan(0);
  });

  it('no ete → no ETE text in template', () => {
    const core = makeCore({ ete: undefined });
    const result = renderMultilingualTemplates({ core, languages: [Language.ZH] });
    const text = result.public_alert_text[Language.ZH]!;
    expect(text).not.toContain('預計延誤');
    expect(text).not.toContain('待確認');
  });
});

// ─── formatEteForAlert ────────────────────────────────────────────────────

describe('formatEteForAlert', () => {
  it('no ete → empty string', () => {
    expect(formatEteForAlert(makeCore({ ete: undefined }))).toBe('');
  });

  it('computed → 預計延誤 N 分鐘', () => {
    const core = makeCore({
      ete: { calculation_status: 'computed', ete_minutes: 42 } as unknown as DecisionCore['ete'],
    });
    expect(formatEteForAlert(core)).toBe('預計延誤 42 分鐘');
  });

  it('insufficient_common_snapshot → 延誤時間待確認', () => {
    const core = makeCore({
      ete: {
        calculation_status: 'insufficient_common_snapshot',
        ete_lower_bound_minutes: 60,
      } as unknown as DecisionCore['ete'],
    });
    expect(formatEteForAlert(core)).toBe('延誤時間待確認');
  });
});

// ─── P36 property: language floor never degrades ─────────────────────────

describe('P36 template: language floor guarantee', () => {
  it(
    'Feature: city-response-commander, Property 36c: renderMultilingualTemplates never drops en when it is in languages',
    () => {
      fc.assert(
        fc.property(
          fc.boolean(), // bonus (controls whether ja/ko included)
          (bonus) => {
            const languages = bonus
              ? [Language.ZH, Language.EN, Language.JA, Language.KO]
              : [Language.ZH, Language.EN];
            const result = renderMultilingualTemplates({ core: makeCore(), languages });
            // en 必須在輸出中
            expect(result.public_alert_text[Language.EN]).toBeDefined();
            expect(result.public_alert_text[Language.EN]!.trim().length).toBeGreaterThan(0);
            // zh 也必須在輸出中
            expect(result.public_alert_text[Language.ZH]).toBeDefined();
          },
        ),
        { numRuns: 100 },
      );
    },
  );

  it(
    'Feature: city-response-commander, Property 36d: all requested languages have non-empty template output',
    () => {
      const langArb = fc.shuffledSubarray(
        [Language.ZH, Language.EN, Language.JA, Language.KO],
        { minLength: 1 },
      );
      fc.assert(
        fc.property(langArb, (languages) => {
          const result = renderMultilingualTemplates({ core: makeCore(), languages });
          for (const lang of languages) {
            const text = result.public_alert_text[lang];
            expect(typeof text).toBe('string');
            expect(text!.trim().length).toBeGreaterThan(0);
          }
          // 沒有要求的語言不應出現
          for (const lang of ALL_LANGUAGES) {
            if (!languages.includes(lang)) {
              expect(result.public_alert_text[lang]).toBeUndefined();
            }
          }
        }),
        { numRuns: 100 },
      );
    },
  );
});
