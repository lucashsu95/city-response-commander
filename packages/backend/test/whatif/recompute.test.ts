/**
 * recompute - unit tests (TASK-139, P28)
 *
 * Validates:
 * - BL17 User_Count = 40000 -> SOP-3 triggered (article 3 in triggered_articles)
 * - BL17 User_Count = 25000 -> SOP-3 NOT triggered (boundary: strictly > 25000)
 * - BL17 Growth_Rate = 0.31 -> SOP-3 triggered
 * - BL17 Growth_Rate = 0.30 -> SOP-3 NOT triggered (boundary: strictly > 0.30)
 * - Saturation_Score = 0.95 -> A level (article 1 triggered)
 * - Saturation_Score = 0.85 -> B level (article 1 triggered)
 * - Saturation_Score = 0.84 -> normal (article 1 NOT triggered)
 * - Roaming_User_Pct = 0.30 -> SOP-6 triggered (article 6 in triggered_articles)
 * - Roaming_User_Pct = 0.29 -> NOT triggered
 * - does_not_mutate_state = true (static type guarantee)
 * - expected_actions non-empty when triggered
 * - ete_preview present when Saturation_Score assumption exists
 * - P28: recompute never mutates state
 */

import * as fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import { recompute } from '../../src/whatif/recompute.js';
import type { WhatIfAssumption } from '../../src/whatif/whatif_types.js';

// ─── Fixture helpers ──────────────────────────────────────────────────────

function makeBL17Count(value: number): WhatIfAssumption {
  return { entity_id: 'BS_MRT_BL17', field: 'User_Count', operator: '=', value };
}

function makeBL17Growth(value: number): WhatIfAssumption {
  return { entity_id: 'BS_MRT_BL17', field: 'Growth_Rate', operator: '=', value };
}

function makeSaturation(segmentId: string, value: number): WhatIfAssumption {
  return { entity_id: segmentId, field: 'Saturation_Score', operator: '=', value };
}

function makeRoaming(bsId: string, value: number): WhatIfAssumption {
  return { entity_id: bsId, field: 'Roaming_User_Pct', operator: '=', value };
}

// ─── SOP-3 (BL17 User_Count / Growth_Rate) ───────────────────────────────

describe('recompute - SOP-3 (BL17)', () => {
  it('User_Count = 40000 -> article 3 triggered', () => {
    const result = recompute({ assumptions: [makeBL17Count(40000)] });
    expect(result.triggered_articles).toContain(3);
    expect(result.does_not_mutate_state).toBe(true);
  });

  it('User_Count = 25001 -> article 3 triggered (strictly > 25000)', () => {
    const result = recompute({ assumptions: [makeBL17Count(25001)] });
    expect(result.triggered_articles).toContain(3);
  });

  it('User_Count = 25000 -> NOT triggered (boundary: must be strictly > 25000)', () => {
    const result = recompute({ assumptions: [makeBL17Count(25000)] });
    expect(result.triggered_articles).not.toContain(3);
  });

  it('Growth_Rate = 0.31 -> article 3 triggered', () => {
    const result = recompute({ assumptions: [makeBL17Growth(0.31)] });
    expect(result.triggered_articles).toContain(3);
  });

  it('Growth_Rate = 0.30 -> NOT triggered (boundary: must be strictly > 0.30)', () => {
    const result = recompute({ assumptions: [makeBL17Growth(0.30)] });
    expect(result.triggered_articles).not.toContain(3);
  });

  it('User_Count OR Growth_Rate -> article 3 triggered (OR logic)', () => {
    const r1 = recompute({ assumptions: [makeBL17Growth(0.5)] });
    expect(r1.triggered_articles).toContain(3);
    const r2 = recompute({ assumptions: [makeBL17Count(30000)] });
    expect(r2.triggered_articles).toContain(3);
  });

  it('triggered SOP-3 -> expected_actions non-empty', () => {
    const result = recompute({ assumptions: [makeBL17Count(40000)] });
    expect(result.expected_actions.length).toBeGreaterThan(0);
  });
});

// ─── SOP-1 (Saturation_Score) ─────────────────────────────────────────────

describe('recompute - SOP-1 (Saturation_Score)', () => {
  it('Saturation_Score = 0.95 -> A level -> article 1 triggered', () => {
    const result = recompute({ assumptions: [makeSaturation('RD_TPE_001', 0.95)] });
    expect(result.triggered_articles).toContain(1);
  });

  it('Saturation_Score = 0.85 -> B level -> article 1 triggered', () => {
    const result = recompute({ assumptions: [makeSaturation('RD_TPE_001', 0.85)] });
    expect(result.triggered_articles).toContain(1);
  });

  it('Saturation_Score = 0.84 -> normal -> article 1 NOT triggered', () => {
    const result = recompute({ assumptions: [makeSaturation('RD_TPE_001', 0.84)] });
    expect(result.triggered_articles).not.toContain(1);
  });

  it('Saturation_Score = 0.9499 -> B level (boundary)', () => {
    const result = recompute({ assumptions: [makeSaturation('RD_TPE_001', 0.9499)] });
    expect(result.triggered_articles).toContain(1);
  });

  it('Saturation_Score hypothesis -> ete_preview present', () => {
    const result = recompute({ assumptions: [makeSaturation('RD_TPE_002', 0.9)] });
    expect(result.ete_preview).toBeDefined();
    expect(result.ete_preview?.ete_minutes).toBeGreaterThan(0);
  });

  it('no Saturation_Score hypothesis -> ete_preview absent', () => {
    const result = recompute({ assumptions: [makeBL17Count(40000)] });
    expect(result.ete_preview).toBeUndefined();
  });
});

// ─── SOP-6 (Roaming_User_Pct) ────────────────────────────────────────────

describe('recompute - SOP-6 (Roaming_User_Pct)', () => {
  it('Roaming_User_Pct = 0.30 -> SOP-6 triggered -> article 6', () => {
    const result = recompute({ assumptions: [makeRoaming('BS_X', 0.30)] });
    expect(result.triggered_articles).toContain(6);
  });

  it('Roaming_User_Pct = 0.31 -> SOP-6 triggered', () => {
    const result = recompute({ assumptions: [makeRoaming('BS_X', 0.31)] });
    expect(result.triggered_articles).toContain(6);
  });

  it('Roaming_User_Pct = 0.299 -> NOT triggered', () => {
    const result = recompute({ assumptions: [makeRoaming('BS_X', 0.299)] });
    expect(result.triggered_articles).not.toContain(6);
  });
});

// ─── does_not_mutate_state ────────────────────────────────────────────────

describe('recompute - does_not_mutate_state', () => {
  it('always returns does_not_mutate_state = true', () => {
    const cases: readonly WhatIfAssumption[][] = [
      [makeBL17Count(40000)],
      [makeSaturation('RD_TPE_001', 0.95)],
      [makeRoaming('BS_X', 0.3)],
      [],
    ];
    for (const assumptions of cases) {
      const result = recompute({ assumptions });
      expect(result.does_not_mutate_state).toBe(true);
    }
  });

  it('input assumptions are not mutated', () => {
    const assumptions: WhatIfAssumption[] = [makeBL17Count(40000)];
    const before = JSON.stringify(assumptions);
    recompute({ assumptions });
    expect(JSON.stringify(assumptions)).toBe(before);
  });
});

// ─── Empty assumptions ────────────────────────────────────────────────────

describe('recompute - empty assumptions', () => {
  it('empty -> no triggered articles, does_not_mutate_state=true', () => {
    const result = recompute({ assumptions: [] });
    expect(result.triggered_articles).toHaveLength(0);
    expect(result.does_not_mutate_state).toBe(true);
  });
});

// ─── P28 property test ────────────────────────────────────────────────────

describe('P28: recompute never mutates state', () => {
  it(
    'Feature: city-response-commander, Property 28: recompute always returns does_not_mutate_state=true for any valid input',
    () => {
      fc.assert(
        fc.property(
          fc.integer({ min: 0, max: 100_000 }),
          fc.double({ min: 0, max: 1, noNaN: true }),
          (userCount, saturation) => {
            const result = recompute({
              assumptions: [
                makeBL17Count(userCount),
                makeSaturation('RD_TPE_001', saturation),
              ],
            });
            expect(result.does_not_mutate_state).toBe(true);
            for (const article of result.triggered_articles) {
              expect([1, 2, 3, 4, 5, 6, 7]).toContain(article);
            }
          },
        ),
        { numRuns: 100 },
      );
    },
  );
});
