/**
 * Production RuleEngineWhatIfFacade — integration tests.
 *
 * Each test exercises the real facade against the canonical demo baseline,
 * applying a single validated assumption and asserting on `triggered_articles`,
 * baseline immutability, and request-to-request isolation.
 */

import { describe, it, expect } from 'vitest';

import { ProductionRuleEngineWhatIfFacade } from '../../src/whatif/production_rule_engine_facade.js';
import type { WhatIfAssumption } from '../../src/whatif/whatif_types.js';
import { buildDemoDataProvider } from './demoDataFixture.js';

function assumption(
  entity_id: string,
  field: string,
  value: number,
): WhatIfAssumption {
  return { entity_id, field, operator: '=', value };
}

async function newFacade() {
  const provider = buildDemoDataProvider();
  return new ProductionRuleEngineWhatIfFacade(provider);
}

describe('ProductionRuleEngineWhatIfFacade (SOP-3 boundary)', () => {
  it('1. BS_MRT_BL17 User_Count = 40000 → triggered_articles includes 3', async () => {
    const facade = await newFacade();
    const baseline = await facade.loadBaseline({} as never);

    const facts = facade.rerun({
      baseline,
      assumptions: [assumption('BS_MRT_BL17', 'User_Count', 40000)],
    });

    expect(facts.triggered_articles).toContain(3);
  });

  it('2. BL17 User_Count=1000 AND Growth_Rate=0 → triggered_articles does NOT include 3', async () => {
    const facade = await newFacade();
    const baseline = await facade.loadBaseline({} as never);

    const facts = facade.rerun({
      baseline,
      assumptions: [
        assumption('BS_MRT_BL17', 'User_Count', 1000),
        assumption('BS_MRT_BL17', 'Growth_Rate', 0),
      ],
    });

    expect(facts.triggered_articles).not.toContain(3);
  });

  it('3. BL17 User_Count=3300 AND Growth_Rate=0 → triggered_articles does NOT include 3', async () => {
    const facade = await newFacade();
    const baseline = await facade.loadBaseline({} as never);

    const facts = facade.rerun({
      baseline,
      assumptions: [
        assumption('BS_MRT_BL17', 'User_Count', 3300),
        assumption('BS_MRT_BL17', 'Growth_Rate', 0),
      ],
    });

    expect(facts.triggered_articles).not.toContain(3);
  });

  it('4. BL17 User_Count=25000 AND Growth_Rate=0.30 → triggered_articles does NOT include 3 (boundary)', async () => {
    const facade = await newFacade();
    const baseline = await facade.loadBaseline({} as never);

    const facts = facade.rerun({
      baseline,
      assumptions: [
        assumption('BS_MRT_BL17', 'User_Count', 25000),
        assumption('BS_MRT_BL17', 'Growth_Rate', 0.30),
      ],
    });

    expect(facts.triggered_articles).not.toContain(3);
  });

  it('5. BL17 User_Count=25001 → triggered_articles includes 3 (boundary strict)', async () => {
    const facade = await newFacade();
    const baseline = await facade.loadBaseline({} as never);

    const facts = facade.rerun({
      baseline,
      assumptions: [assumption('BS_MRT_BL17', 'User_Count', 25001)],
    });

    expect(facts.triggered_articles).toContain(3);
  });

  it('6. BL17 Growth_Rate=0.31 → triggered_articles includes 3 (boundary strict)', async () => {
    const facade = await newFacade();
    const baseline = await facade.loadBaseline({} as never);

    const facts = facade.rerun({
      baseline,
      assumptions: [assumption('BS_MRT_BL17', 'Growth_Rate', 0.31)],
    });

    expect(facts.triggered_articles).toContain(3);
  });
});

describe('ProductionRuleEngineWhatIfFacade (SOP-6 boundary)', () => {
  it('8. Article 6 fires ONLY when at least one station has roaming_pct_value >= 0.30', async () => {
    // Strategy-F aggregates stations by their CURRENT roaming_pct_value.
    // Article 6 (SOP-6 multilingual trigger) fires only when at least one
    // station in scope has roaming_pct_value ≥ 0.30 — NOT from any mention
    // of station/people/BL17 in the text.

    const facade = await newFacade();
    const baseline = await facade.loadBaseline({} as never);
    const allStationIds = [...(baseline.loadedEntities.baseStationIds as Set<string>)];

    // ── Scenario A: clamp every station's roaming to 0.0 (BELOW threshold) ──
    const notTriggered = facade.rerun({
      baseline,
      assumptions: allStationIds.map((id) =>
        assumption(id, 'Roaming_User_Pct', 0.0),
      ),
    });
    expect(notTriggered.triggered_articles).not.toContain(6);

    // ── Scenario B: clamp every station's roaming to 0.30 (AT threshold) ──
    const triggered = facade.rerun({
      baseline,
      assumptions: allStationIds.map((id) =>
        assumption(id, 'Roaming_User_Pct', 0.30),
      ),
    });
    expect(triggered.triggered_articles).toContain(6);

    // ── Scenario C: clamping roaming alone, with a high User_Count at BL17,
    //    must not cause Article 6 to flip — proves it never depends on text
    //    mention / station name / crowd size. ──
    const clampedWithUserCount = facade.rerun({
      baseline,
      assumptions: [
        ...allStationIds.map((id) => assumption(id, 'Roaming_User_Pct', 0.0)),
        assumption('BS_MRT_BL17', 'User_Count', 40000),
      ],
    });
    expect(clampedWithUserCount.triggered_articles).not.toContain(6);
  });
});

describe('ProductionRuleEngineWhatIfFacade (immutability / isolation)', () => {
  it('9. Baseline ingestion object remains byte-for-byte unchanged after rerun', async () => {
    const facade = await newFacade();
    const baseline = await facade.loadBaseline({} as never);
    const snapshot = JSON.stringify(baseline.inputSnapshot);

    facade.rerun({
      baseline,
      assumptions: [assumption('BS_MRT_BL17', 'User_Count', 40000)],
    });

    const after = JSON.stringify(baseline.inputSnapshot);
    expect(after).toBe(snapshot);
  });

  it('10. Two sequential What-if requests do not leak modified state', async () => {
    const facade = await newFacade();

    const baseline1 = await facade.loadBaseline({} as never);
    const facts1 = facade.rerun({
      baseline: baseline1,
      assumptions: [assumption('BS_MRT_BL17', 'User_Count', 40000)],
    });

    const baseline2 = await facade.loadBaseline({} as never);
    const facts2 = facade.rerun({
      baseline: baseline2,
      assumptions: [assumption('BS_MRT_BL17', 'User_Count', 3000)],
    });

    // Second run uses a fresh baseline clone — must NOT inherit the
    // User_Count=40000 override from the previous run.
    expect(facts1.triggered_articles).toContain(3);
    expect(facts2.triggered_articles).not.toContain(3);
  });
});