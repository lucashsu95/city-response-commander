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

// ─── UARE fields reach the built DecisionCore (fixes a review finding: ─────
// buildDecisionCore's structuredClone previously had its own separate
// 24-field allowlist that silently dropped sop_matched/sop_authority/
// universal_principles/grounding_candidates even when the caller supplied
// them — nothing that constructs a real DecisionCore via this function would
// ever have carried the 4 UARE fields. Spec: .kiro/specs/unified-adaptive-
// reasoning-engine/requirements.md R5 AC1, AC5.
describe('UARE fields on the built DecisionCore', () => {
  it('propagates sop_matched:false, sop_authority, universal_principles and grounding_candidates', () => {
    const core = buildDecisionCore({
      ...baseInput(),
      triggered_articles: [],
      sop_matched: false,
      sop_authority: 'SYSTEM_DEFAULT_PRINCIPLE',
      universal_principles: [
        { principle_id: 'UPSTREAM_CONTAINMENT', title: '上游截流', description: '上游截流說明' },
      ],
      grounding_candidates: [
        {
          segment_id: 'RD_TPE_004',
          road_name: '市民大道四段',
          saturation_score: 0.2,
          capacity_vph: 2500,
          status_text: '暢通',
        },
      ],
    });

    expect(core.sop_matched).toBe(false);
    expect(core.sop_authority).toBe('SYSTEM_DEFAULT_PRINCIPLE');
    expect(core.universal_principles).toHaveLength(1);
    expect(core.grounding_candidates).toEqual([
      {
        segment_id: 'RD_TPE_004',
        road_name: '市民大道四段',
        saturation_score: 0.2,
        capacity_vph: 2500,
        status_text: '暢通',
      },
    ]);
  });

  it('does not affect core_hash — UARE fields are advisory, not decision-identity facts (§10.11a-1)', () => {
    const withoutUare = buildDecisionCore(baseInput());
    const withUare = buildDecisionCore({
      ...baseInput(),
      sop_matched: false,
      sop_authority: 'SYSTEM_DEFAULT_PRINCIPLE',
      universal_principles: [
        { principle_id: 'UPSTREAM_CONTAINMENT', title: '上游截流', description: '說明' },
      ],
      grounding_candidates: [],
    });

    expect(withUare.core_hash).toBe(withoutUare.core_hash);
  });
});
