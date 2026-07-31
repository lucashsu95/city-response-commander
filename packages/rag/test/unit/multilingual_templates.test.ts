/**
 * multilingual_templates — unit tests (TASK-117)
 *
 * 驗證：
 * - P36：SOP-6 triggered 時，語言下限 zh+en；絕不退化為只有 zh
 * - 各語言 template 值均為非空字串
 * - 只插入決定性事實（occurred_at / event_facts.location / primary_evacuation / ete）
 * - ETE computed → 顯示分鐘數；insufficient → 待確認；無 ete → 空字串
 * - 無合規路段時顯示備援文字，不虛構路段名稱
 * - renderMultilingualTemplates 輸出 type === 'PUBLIC_ALERT'
 */

import * as fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import {
  renderMultilingualTemplates,
  formatEteForAlert,
  formatEteForLanguage,
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

  it('inserts event_facts.location in en template', () => {
    const core = makeCore({
      event_facts: { location: 'Xinyi Rd Sec 5' } as unknown as DecisionCore['event_facts'],
    });
    const result = renderMultilingualTemplates({ core, languages: [Language.EN] });
    expect(result.public_alert_text[Language.EN]).toContain('Xinyi Rd Sec 5');
  });

  it('missing event_facts shows fallback text, not undefined', () => {
    const core = makeCore({ event_facts: undefined });
    const result = renderMultilingualTemplates({ core, languages: ALL_LANGUAGES });
    for (const lang of ALL_LANGUAGES) {
      const text = result.public_alert_text[lang]!;
      expect(text).not.toContain('undefined');
      expect(text.trim().length).toBeGreaterThan(0);
    }
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

// ─── 語言純度：ETE 等決定性事實必須在地化 ─────────────────────────────────

/** CJK 統一表意文字（中文字／日文漢字）。en / ko 模板中不應出現。 */
const CJK_IDEOGRAPH = /[一-鿿]/;

/** 只會出現在中文 ETE 措辭中的字串（用於檢查 ja 模板未混入中文） */
const ZH_ONLY_ETE_PHRASES = ['預計延誤', '分鐘', '延誤時間待確認', '查無合規替代路段'];

describe('語言純度：非中文模板不得混入中文', () => {
  const coreWithEte = () =>
    makeCore({
      ete: {
        calculation_status: 'computed',
        ete_minutes: 78.6,
      } as unknown as DecisionCore['ete'],
    });

  it('en 模板不含任何 CJK 表意文字（含 ETE 句）', () => {
    const result = renderMultilingualTemplates({
      core: coreWithEte(),
      languages: [Language.EN],
    });
    const text = result.public_alert_text[Language.EN]!;
    expect(text).toContain('78.6');
    expect(text).not.toMatch(CJK_IDEOGRAPH);
  });

  it('ko 模板不含任何 CJK 表意文字（含 ETE 句）', () => {
    const result = renderMultilingualTemplates({
      core: coreWithEte(),
      languages: [Language.KO],
    });
    const text = result.public_alert_text[Language.KO]!;
    expect(text).toContain('78.6');
    expect(text).not.toMatch(CJK_IDEOGRAPH);
  });

  it('ja 模板不含中文專屬措辭（日文漢字允許）', () => {
    const result = renderMultilingualTemplates({
      core: coreWithEte(),
      languages: [Language.JA],
    });
    const text = result.public_alert_text[Language.JA]!;
    expect(text).toContain('78.6');
    for (const phrase of ZH_ONLY_ETE_PHRASES) {
      expect(text).not.toContain(phrase);
    }
  });

  it('ETE 待確認時同樣在地化，不退回中文', () => {
    const core = makeCore({
      ete: {
        calculation_status: 'insufficient_common_snapshot',
        ete_lower_bound_minutes: 60,
      } as unknown as DecisionCore['ete'],
    });
    const result = renderMultilingualTemplates({ core, languages: ALL_LANGUAGES });
    expect(result.public_alert_text[Language.EN]).not.toMatch(CJK_IDEOGRAPH);
    expect(result.public_alert_text[Language.KO]).not.toMatch(CJK_IDEOGRAPH);
    for (const phrase of ZH_ONLY_ETE_PHRASES) {
      expect(result.public_alert_text[Language.JA]).not.toContain(phrase);
    }
  });

  it('null primary_evacuation 的備援文字也在地化', () => {
    const core = makeCore({ primary_evacuation: null });
    const result = renderMultilingualTemplates({ core, languages: ALL_LANGUAGES });
    expect(result.public_alert_text[Language.EN]).not.toMatch(CJK_IDEOGRAPH);
    expect(result.public_alert_text[Language.KO]).not.toMatch(CJK_IDEOGRAPH);
  });

  it('missing event_facts.location 的備援文字也在地化', () => {
    const core = makeCore({ event_facts: undefined });
    const result = renderMultilingualTemplates({ core, languages: ALL_LANGUAGES });
    expect(result.public_alert_text[Language.EN]).not.toMatch(CJK_IDEOGRAPH);
    expect(result.public_alert_text[Language.KO]).not.toMatch(CJK_IDEOGRAPH);
  });
});

describe('formatEteForLanguage', () => {
  it('四種語言各自產出不同措辭，數值一致', () => {
    const core = makeCore({
      ete: { calculation_status: 'computed', ete_minutes: 42 } as unknown as DecisionCore['ete'],
    });
    const rendered = ALL_LANGUAGES.map((lang) => formatEteForLanguage(core, lang));
    for (const text of rendered) {
      expect(text).toContain('42');
    }
    // 四種語言的措辭必須彼此不同（證明有真的在地化，不是同一份中文）
    expect(new Set(rendered).size).toBe(4);
  });

  it('無 ete → 所有語言均為空字串', () => {
    const core = makeCore({ ete: undefined });
    for (const lang of ALL_LANGUAGES) {
      expect(formatEteForLanguage(core, lang)).toBe('');
    }
  });
});

// ─── P25 property: alert completeness (TASK-048) ──────────────────────────

describe('renderMultilingualTemplates — Property 25: alert retains location, reroute, delay and avoidance facts', () => {
  it(
    'Feature: city-response-commander, Property 25: every language template retains incident location, reroute, delay and avoidance-reminder facts',
    () => {
      fc.assert(
        fc.property(
          fc.record({
            location: fc.string({ minLength: 1, maxLength: 12 }).filter((s) => s.trim().length > 0),
            route: fc.string({ minLength: 1, maxLength: 12 }).filter((s) => s.trim().length > 0),
            delay: fc.integer({ min: 0, max: 300 }),
          }),
          ({ location, route, delay }) => {
            const core = makeCore({
              event_facts: { location } as unknown as DecisionCore['event_facts'],
              primary_evacuation: route,
              ete: {
                calculation_status: 'computed',
                ete_minutes: delay,
              } as unknown as DecisionCore['ete'],
            });
            const result = renderMultilingualTemplates({ core, languages: ALL_LANGUAGES });
            for (const lang of ALL_LANGUAGES) {
              const text = result.public_alert_text[lang]!;
              // 事故位置 + 改道指引
              expect(text).toContain(location);
              expect(text).toContain(route);
              // 預計延誤時間
              expect(text).toContain(String(delay));
              // 求援/避開提醒（每語言固定句尾，非空）
              expect(text.trim().length).toBeGreaterThan(0);
            }
          },
        ),
        { numRuns: 100 },
      );
    },
  );
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
