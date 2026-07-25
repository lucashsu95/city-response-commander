import { describe, expect, it } from 'vitest';
import { calculateCoreHash } from '../../src/core_hash/canonical_core_hash.js';
import type { DecisionCoreBuildInput } from '../../src/decision/decision_core_builder.js';
import { buildDecisionCore } from '../../src/decision/decision_core_builder.js';
import { baseCoreInput } from '../helpers/domain-fixtures.js';

type MutableCoreData = {
  core_hash: string;
  event_facts: { description: string };
  classifications: Array<{ segment_id: string; level: 'A' | 'B' | null }>;
  secondary_evacuation: string[];
  evidence: { data_points: Array<{ source: string; field: string; value: string | number | boolean; timestamp: string }> };
  policy: { time_alignment: { mode: string } };
};

const baseInput = (): DecisionCoreBuildInput => baseCoreInput();

describe('canonical core_hash and DecisionCore assembly', () => {
  it('ignores injection and workflow execution metadata', () => {
    const first = buildDecisionCore(baseInput());
    const second = buildDecisionCore({ ...baseInput(), injection_run_id: 'inj-2', workflow_execution_name: 'execution-2' });
    expect(first.core_hash).toBe(second.core_hash);
  });

  it('always commits an immutable core, even when an untyped caller supplies false', () => {
    const legacyInput = { ...baseInput(), immutable_after_commit: false } as unknown as DecisionCoreBuildInput;
    expect(buildDecisionCore(legacyInput).immutable_after_commit).toBe(true);
  });

  it('changes when an immutable official event fact changes', () => {
    const first = buildDecisionCore(baseInput());
    const input = baseInput();
    const second = buildDecisionCore({ ...input, event_facts: { ...input.event_facts, description: 'changed' } });
    expect(first.core_hash).not.toBe(second.core_hash);
  });

  it('changes when a deterministic decision fact changes', () => {
    expect(buildDecisionCore(baseInput()).core_hash).not.toBe(buildDecisionCore({ ...baseInput(), primary_evacuation: 'RD_TPE_009' }).core_hash);
  });

  it('normalizes set-like array order', () => {
    const first = buildDecisionCore(baseInput());
    const reordered = buildDecisionCore({ ...baseInput(), triggered_articles: [2, 1], classifications: [...baseInput().classifications].reverse() });
    expect(first.core_hash).toBe(reordered.core_hash);
  });

  it('rejects Article 7 in triggered_articles', () => {
    expect(() => buildDecisionCore({ ...baseInput(), triggered_articles: [1, 7] })).toThrow('Article 7');
  });

  it('detaches and freezes all nested official and derived facts', () => {
    const input = baseInput();
    const mutableInput = input as unknown as MutableCoreData;
    const core = buildDecisionCore(input);
    const originalHash = core.core_hash;
    mutableInput.event_facts.description = 'changed after build';
    mutableInput.classifications[0].level = 'B';
    mutableInput.secondary_evacuation.push('RD_TPE_006');
    expect(core.event_facts?.description).not.toBe('changed after build');
    expect(core.classifications[0].level).toBe('A');
    expect(core.secondary_evacuation).toEqual(['RD_TPE_005']);

    const mutableCore = core as unknown as MutableCoreData;
    expect(() => { mutableCore.event_facts.description = 'tampered'; }).toThrow(TypeError);
    expect(() => { mutableCore.classifications[0].level = 'B'; }).toThrow(TypeError);
    expect(() => { mutableCore.core_hash = 'tampered'; }).toThrow(TypeError);
    const { core_hash: _coreHash, ...hashlessCore } = core;
    expect(calculateCoreHash(hashlessCore)).toBe(originalHash);
  });
});
