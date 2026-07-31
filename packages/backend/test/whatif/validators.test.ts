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
 * - P35 property test（100 runs）：任何含非法前綴/field/範圍的 assumption → clarification_required
 */

import * as fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import { validateScenario } from '../../src/whatif/validators.js';
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

  it('Roaming_User_Pct > 1 → clarification_required', () => {
    const result = validateScenario([
      makeAssumption({ entity_id: 'BS_X', field: 'Roaming_User_Pct', value: 1.01 }),
    ]);
    expect(result.validation_status).toBe('clarification_required');
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
    'Feature: city-response-commander, Property 36: entity/field mismatch always produces clarification_required',
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
    'Feature: city-response-commander, Property 37: duplicate entity+field always produces clarification_required',
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
