/**
 * validators — unit tests (TASK-138, P35)
 *
 * 驗證：
 * - 合法假設條件 → valid
 * - entity_id 前綴非法（無 RD_/BS_）→ clarification_required
 * - field 不在白名單 → clarification_required
 * - entity/field 類型不匹配（路段用 User_Count）→ clarification_required
 * - value 超出範圍 → clarification_required
 * - User_Count 非整數 → clarification_required
 * - 歧義（同 entity+field 重複）→ clarification_required
 * - 空 assumptions → clarification_required
 * - P35 property tests（各 100 runs）
 *
 * Property 編號說明（§22.1）：
 * 本檔的 property 全部屬於 **P35「What-if 4 階段含糊即澄清（不猜測）」**，
 * 以 35 / 35b / 35c 區分不同的失敗成因（範圍 / 型別不匹配 / 歧義）。
 * 早期版本誤標為 P36、P37 —— 那兩條各自是
 * 「多語 Bedrock 失敗不退化為僅中文」與「CMS 核心文字與說明文字之權限分離」，
 * 與 What-if 驗證無關。P1..P37 的編號歸屬屬於成員 1，此處只做對齊。
 */

import * as fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import { validateScenario } from './loaded_entities.js';
import type { WhatIfAssumption } from '../../src/whatif/whatif_types.js';

// ─── Fixture helpers ──────────────────────────────────────────────────────

function makeAssumption(overrides: Partial<WhatIfAssumption> = {}): WhatIfAssumption {
  return {
    entity_id: 'BS_MRT_BL17',
    field: 'User_Count',
    operator: '=',
    value: 40000,
    ...overrides,
  };
}

// ─── Happy path ────────────────────────────────────────────────────────────

describe('validateScenario — happy path', () => {
  it('BS entity + User_Count valid → valid', () => {
    const result = validateScenario([makeAssumption()]);
    expect(result.validation_status).toBe('valid');
    if (result.validation_status === 'valid') {
      expect(result.validated_assumptions).toHaveLength(1);
      expect(result.validated_assumptions[0]?.entity_id).toBe('BS_MRT_BL17');
    }
  });

  it('RD entity + Saturation_Score valid → valid', () => {
    const result = validateScenario([
      makeAssumption({ entity_id: 'RD_TPE_002', field: 'Saturation_Score', value: 0.95 }),
    ]);
    expect(result.validation_status).toBe('valid');
  });

  it('BS entity + Growth_Rate valid → valid', () => {
    const result = validateScenario([
      makeAssumption({ entity_id: 'BS_TPE_DOME', field: 'Growth_Rate', value: -0.20 }),
    ]);
    expect(result.validation_status).toBe('valid');
  });

  it('BS entity + Roaming_User_Pct 0.3 → valid', () => {
    const result = validateScenario([
      makeAssumption({ entity_id: 'BS_X', field: 'Roaming_User_Pct', value: 0.3 }),
    ]);
    expect(result.validation_status).toBe('valid');
  });

  it('multiple valid assumptions → valid', () => {
    const result = validateScenario([
      makeAssumption({ entity_id: 'BS_MRT_BL17', field: 'User_Count', value: 40000 }),
      makeAssumption({ entity_id: 'RD_TPE_002', field: 'Saturation_Score', value: 0.9 }),
    ]);
    expect(result.validation_status).toBe('valid');
  });

  it('Saturation_Score boundary: 0 → valid', () => {
    const result = validateScenario([makeAssumption({ entity_id: 'RD_TPE_001', field: 'Saturation_Score', value: 0 })]);
    expect(result.validation_status).toBe('valid');
  });

  it('Saturation_Score boundary: 1 → valid', () => {
    const result = validateScenario([makeAssumption({ entity_id: 'RD_TPE_001', field: 'Saturation_Score', value: 1 })]);
    expect(result.validation_status).toBe('valid');
  });

  it('User_Count boundary: 0 → valid', () => {
    const result = validateScenario([makeAssumption({ value: 0 })]);
    expect(result.validation_status).toBe('valid');
  });
});

// ─── Schema validation failures ───────────────────────────────────────────

describe('validateScenario — SchemaValidator failures', () => {
  it('prefix-valid but unloaded entity → clarification_required', () => {
    const result = validateScenario([makeAssumption({ entity_id: 'BS_FAKE_999' })]);
    expect(result.validation_status).toBe('clarification_required');
    if (result.validation_status === 'clarification_required') {
      expect(result.clarification_prompt).toContain('不存在於目前載入');
    }
  });

  it('empty entity_id prefix → clarification_required', () => {
    const result = validateScenario([makeAssumption({ entity_id: 'UNKNOWN_123' })]);
    expect(result.validation_status).toBe('clarification_required');
    if (result.validation_status === 'clarification_required') {
      expect(result.validation_errors.length).toBeGreaterThan(0);
    }
  });

  it('entity_id with no prefix → clarification_required', () => {
    const result = validateScenario([makeAssumption({ entity_id: 'BL17' })]);
    expect(result.validation_status).toBe('clarification_required');
  });

  it('unknown field → clarification_required', () => {
    const result = validateScenario([makeAssumption({ field: 'Invalid_Field' })]);
    expect(result.validation_status).toBe('clarification_required');
  });

  it('empty assumptions → clarification_required', () => {
    const result = validateScenario([]);
    expect(result.validation_status).toBe('clarification_required');
  });
});

// ─── Domain validation failures ──────────────────────────────────────────

describe('validateScenario — DomainValidator failures', () => {
  it('RD entity + User_Count (BS-only field) → clarification_required', () => {
    const result = validateScenario([
      makeAssumption({ entity_id: 'RD_TPE_002', field: 'User_Count', value: 40000 }),
    ]);
    expect(result.validation_status).toBe('clarification_required');
  });

  it('BS entity + Saturation_Score (RD-only field) → clarification_required', () => {
    const result = validateScenario([
      makeAssumption({ entity_id: 'BS_MRT_BL17', field: 'Saturation_Score', value: 0.9 }),
    ]);
    expect(result.validation_status).toBe('clarification_required');
  });

  it('Saturation_Score > 1 → clarification_required', () => {
    const result = validateScenario([
      makeAssumption({ entity_id: 'RD_TPE_002', field: 'Saturation_Score', value: 1.01 }),
    ]);
    expect(result.validation_status).toBe('clarification_required');
  });

  it('Saturation_Score < 0 → clarification_required', () => {
    const result = validateScenario([
      makeAssumption({ entity_id: 'RD_TPE_002', field: 'Saturation_Score', value: -0.01 }),
    ]);
    expect(result.validation_status).toBe('clarification_required');
  });

  it('User_Count negative → clarification_required', () => {
    const result = validateScenario([makeAssumption({ value: -1 })]);
    expect(result.validation_status).toBe('clarification_required');
  });

  it('User_Count non-integer (float) → clarification_required', () => {
    const result = validateScenario([makeAssumption({ value: 40000.5 })]);
    expect(result.validation_status).toBe('clarification_required');
  });

  it('Roaming_User_Pct > 100 → clarification_required（百分比也不可能超過 100）', () => {
    const result = validateScenario([
      makeAssumption({ entity_id: 'BS_X', field: 'Roaming_User_Pct', value: 101 }),
    ]);
    expect(result.validation_status).toBe('clarification_required');
  });

  it('Roaming_User_Pct = 1.01 → 視為 1.01%，正規化為 0.0101', () => {
    // 量綱正規化後 (1, 100] 一律當百分比；1.01 是合法的百分比輸入
    const result = validateScenario([
      makeAssumption({ entity_id: 'BS_X', field: 'Roaming_User_Pct', value: 1.01 }),
    ]);
    expect(result.validation_status).toBe('valid');
    if (result.validation_status !== 'valid') return;
    expect(result.validated_assumptions[0].value).toBeCloseTo(0.0101, 10);
  });

  it('Growth_Rate < -1 → clarification_required', () => {
    const result = validateScenario([
      makeAssumption({ entity_id: 'BS_MRT_BL17', field: 'Growth_Rate', value: -2 }),
    ]);
    expect(result.validation_status).toBe('clarification_required');
  });

  it('Growth_Rate > 100 → clarification_required', () => {
    const result = validateScenario([
      makeAssumption({ entity_id: 'BS_MRT_BL17', field: 'Growth_Rate', value: 101 }),
    ]);
    expect(result.validation_status).toBe('clarification_required');
  });

  it('Roaming_User_Pct < 0 → clarification_required', () => {
    const result = validateScenario([
      makeAssumption({ entity_id: 'BS_X', field: 'Roaming_User_Pct', value: -0.01 }),
    ]);
    expect(result.validation_status).toBe('clarification_required');
  });
});

// ─── Ambiguity detection ──────────────────────────────────────────────────

describe('validateScenario — ambiguity detection', () => {
  it('same entity_id + field twice → clarification_required', () => {
    const result = validateScenario([
      makeAssumption({ value: 40000 }),
      makeAssumption({ value: 50000 }),
    ]);
    expect(result.validation_status).toBe('clarification_required');
  });

  it('same entity_id but different field → valid (no ambiguity)', () => {
    const result = validateScenario([
      makeAssumption({ entity_id: 'BS_MRT_BL17', field: 'User_Count', value: 40000 }),
      makeAssumption({ entity_id: 'BS_MRT_BL17', field: 'Growth_Rate', value: 0.5 }),
    ]);
    expect(result.validation_status).toBe('valid');
  });

  it('different entity_id same field → valid (no ambiguity)', () => {
    const result = validateScenario([
      makeAssumption({ entity_id: 'BS_MRT_BL17', field: 'User_Count', value: 40000 }),
      makeAssumption({ entity_id: 'BS_TPE_DOME', field: 'User_Count', value: 30000 }),
    ]);
    expect(result.validation_status).toBe('valid');
  });
});

// ─── clarification_prompt quality ─────────────────────────────────────────

describe('validateScenario — clarification_prompt is non-empty', () => {
  it('all failure cases return non-empty clarification_prompt', () => {
    const failCases: readonly WhatIfAssumption[][] = [
      [makeAssumption({ entity_id: 'UNKNOWN_X' })],
      [makeAssumption({ field: 'Bad_Field' })],
      [makeAssumption({ entity_id: 'RD_TPE_001', field: 'User_Count', value: 1 })],
      [makeAssumption({ entity_id: 'RD_TPE_001', field: 'Saturation_Score', value: 2 })],
      [makeAssumption({ value: -1 })],
      [makeAssumption(), makeAssumption()],
    ];
    for (const assumptions of failCases) {
      const result = validateScenario(assumptions);
      expect(result.validation_status).toBe('clarification_required');
      if (result.validation_status === 'clarification_required') {
        expect(result.clarification_prompt.trim().length).toBeGreaterThan(0);
      }
    }
  });
});

// ─── P35 property test ────────────────────────────────────────────────────

describe('P35: invalid or ambiguous assumptions → clarification_required', () => {
  it(
    'Feature: city-response-commander, Property 35: any out-of-range Saturation_Score produces clarification_required',
    () => {
      fc.assert(
        fc.property(
          fc.float({ min: Math.fround(1.001), max: Math.fround(100), noNaN: true }),
          (invalidValue) => {
            const result = validateScenario([
              makeAssumption({ entity_id: 'RD_TPE_001', field: 'Saturation_Score', value: invalidValue }),
            ]);
            expect(result.validation_status).toBe('clarification_required');
          },
        ),
        { numRuns: 100 },
      );
    },
  );

  it(
    'Feature: city-response-commander, Property 35b: entity/field mismatch always produces clarification_required',
    () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 1, max: 100_000 }),
          (value) => {
            // RD entity + BS-only field → always invalid
            const result = validateScenario([
              makeAssumption({ entity_id: 'RD_TPE_001', field: 'User_Count', value }),
            ]);
            expect(result.validation_status).toBe('clarification_required');
          },
        ),
        { numRuns: 100 },
      );
    },
  );

  it(
    'Feature: city-response-commander, Property 35c: duplicate entity+field (ambiguity) always produces clarification_required',
    () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 100_000 }),
          fc.integer({ min: 0, max: 100_000 }),
          (v1, v2) => {
            const result = validateScenario([
              makeAssumption({ value: v1 }),
              makeAssumption({ value: v2 }),
            ]);
            expect(result.validation_status).toBe('clarification_required');
          },
        ),
        { numRuns: 100 },
      );
    },
  );
});

// ─── 量綱正規化：百分比輸入（TASK-138）─────────────────────────────────────

describe('validateScenario — Roaming_User_Pct 百分比量綱', () => {
  function roaming(value: number): WhatIfAssumption {
    return { entity_id: 'BS_MRT_BL17', field: 'Roaming_User_Pct', operator: '=', value };
  }

  it('35（百分比寫法）→ 正規化為 0.35 並通過', () => {
    const result = validateScenario([roaming(35)]);
    expect(result.validation_status).toBe('valid');
    if (result.validation_status !== 'valid') return;
    expect(result.validated_assumptions[0].value).toBeCloseTo(0.35, 10);
  });

  it('0.35（小數寫法）→ 原值通過，不被再次除以 100', () => {
    const result = validateScenario([roaming(0.35)]);
    expect(result.validation_status).toBe('valid');
    if (result.validation_status !== 'valid') return;
    expect(result.validated_assumptions[0].value).toBe(0.35);
  });

  it('30（REQ-010 的門檻寫法）→ 0.30，正好等於 SOP-6 門檻', () => {
    const result = validateScenario([roaming(30)]);
    expect(result.validation_status).toBe('valid');
    if (result.validation_status !== 'valid') return;
    expect(result.validated_assumptions[0].value).toBeCloseTo(0.3, 10);
  });

  it('100 → 1.0（上限）', () => {
    const result = validateScenario([roaming(100)]);
    expect(result.validation_status).toBe('valid');
    if (result.validation_status !== 'valid') return;
    expect(result.validated_assumptions[0].value).toBe(1);
  });

  it('值為 1 → 單位無法判定，回 clarification（不猜測）', () => {
    const result = validateScenario([roaming(1)]);
    expect(result.validation_status).toBe('clarification_required');
    if (result.validation_status !== 'clarification_required') return;
    expect(result.clarification_prompt).toContain('無法判定單位');
  });

  it('超過 100 → 超出範圍', () => {
    const result = validateScenario([roaming(150)]);
    expect(result.validation_status).toBe('clarification_required');
  });

  it('負值 → 超出範圍', () => {
    const result = validateScenario([roaming(-5)]);
    expect(result.validation_status).toBe('clarification_required');
  });

  it('0 → 通過（0% 與 0 小數同義）', () => {
    const result = validateScenario([roaming(0)]);
    expect(result.validation_status).toBe('valid');
  });
});

describe('validateScenario — Growth_Rate 維持小數量綱', () => {
  function growth(value: number): WhatIfAssumption {
    return { entity_id: 'BS_MRT_BL17', field: 'Growth_Rate', operator: '=', value };
  }

  it('0.35（小數）→ 原值通過，不做百分比換算', () => {
    const result = validateScenario([growth(0.35)]);
    expect(result.validation_status).toBe('valid');
    if (result.validation_status !== 'valid') return;
    expect(result.validated_assumptions[0].value).toBe(0.35);
  });

  it('35（百分比誤寫）→ 超出範圍並提示小數寫法，不再靜默觸發 SOP-3', () => {
    const result = validateScenario([growth(35)]);
    expect(result.validation_status).toBe('clarification_required');
    if (result.validation_status !== 'clarification_required') return;
    expect(result.clarification_prompt).toContain('0.35');
  });

  it('2.0（200% 成長）仍屬合法小數輸入', () => {
    const result = validateScenario([growth(2)]);
    expect(result.validation_status).toBe('valid');
    if (result.validation_status !== 'valid') return;
    expect(result.validated_assumptions[0].value).toBe(2);
  });

  it('-0.2（SOP-4 門檻）合法', () => {
    const result = validateScenario([growth(-0.2)]);
    expect(result.validation_status).toBe('valid');
  });
});

// ─── 回顯清潔：clarification_prompt 出口（§17）─────────────────────────────

describe('validateScenario — clarification_prompt 不得成為回顯通道', () => {
  it('entity_id 中的控制字元被移除', () => {
    const result = validateScenario([
      { entity_id: 'XX_BAD\u0000\u001b[31m\r\nFAKE', field: 'User_Count', operator: '=', value: 1 },
    ]);
    expect(result.validation_status).toBe('clarification_required');
    if (result.validation_status !== 'clarification_required') return;
    expect(result.clarification_prompt).not.toMatch(/[\u0000-\u001F]/);
    // 換行被壓成空白，無法偽造多行訊息
    expect(result.clarification_prompt.split('\n')).toHaveLength(1);
  });

  it('超長 field 名稱被截斷，不會洗掉真正的錯誤原因', () => {
    const longField = 'F'.repeat(5000);
    const result = validateScenario([
      { entity_id: 'BS_MRT_BL17', field: longField, operator: '=', value: 1 },
    ]);
    expect(result.validation_status).toBe('clarification_required');
    if (result.validation_status !== 'clarification_required') return;
    // 回顯片段受長度上限約束（80 + 省略號），整體訊息不會被灌爆
    expect(result.clarification_prompt.length).toBeLessThan(400);
    expect(result.clarification_prompt).toContain('…');
    expect(result.clarification_prompt).toContain('不在支援的欄位清單中');
  });

  it('合法輸入的訊息內容不受清潔影響', () => {
    const result = validateScenario([
      { entity_id: 'BS_MRT_BL17', field: 'Saturation_Score', operator: '=', value: 0.5 },
    ]);
    expect(result.validation_status).toBe('clarification_required');
    if (result.validation_status !== 'clarification_required') return;
    expect(result.clarification_prompt).toContain('Saturation_Score');
    expect(result.clarification_prompt).toContain('BS_MRT_BL17');
  });
});
