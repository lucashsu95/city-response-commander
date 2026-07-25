import * as fc from 'fast-check';
import { describe, expect } from 'vitest';
import { calculateCoreHash } from '../../src/core_hash/canonical_core_hash.js';
import { buildDecisionCore } from '../../src/decision/decision_core_builder.js';
import { baseCoreInput } from '../helpers/domain-fixtures.js';
import { propertyTest } from '../helpers/pbt-helper.js';

describe('Canonical core hash A/B/C properties', () => {
  propertyTest(33, 'A volatile metadata aliases do not alter core hash', fc.record({ run: fc.string(), attempt: fc.integer(), timestamp: fc.string(), status: fc.string(), latency: fc.integer() }), (v) => {
    const base = baseCoreInput();
    const original = buildDecisionCore(base);
    const noisy = { ...base, injection_run_id: v.run, workflow_execution_name: `wf-${v.run}`, workflow_execution_arn: v.run, trace_id: v.run, attempt_count: v.attempt, lease_owner: v.run, lease_expires_at: v.timestamp, status: v.status, recovery_stage: v.status, recovery_mode: v.status, created_at: v.timestamp, updated_at: v.timestamp, running_started_at: v.timestamp, running_deadline_at: v.timestamp, completed_execution_arn: v.run, completed_attempt_count: v.attempt, last_transition_execution_arn: v.run, last_transition_attempt_count: v.attempt, latency_ms: v.latency, cloudwatch: { request: v.run }, xray: { trace: v.run } };
    const result = buildDecisionCore(noisy);
    expect(result.core_hash).toBe(original.core_hash);
    expect('trace_id' in result).toBe(false);
    expect('status' in result).toBe(false);
  });

  propertyTest(33, 'B every changed deterministic decision fact changes core hash', fc.constantFrom('event', 'classification', 'route', 'trigger', 'applied', 'ete', 'manifest', 'evidence', 'policy', 'cms', 'multilingual'), (field) => {
    const base = baseCoreInput();
    const changed = structuredClone(base);
    if (field === 'event') changed.event_facts.description = 'changed official event fact';
    if (field === 'classification') changed.classifications = [{ segment_id: 'RD_TPE_002', level: 'B' }];
    if (field === 'route') changed.primary_evacuation = 'RD_OTHER';
    if (field === 'trigger') changed.triggered_articles = [1];
    if (field === 'applied') changed.applied_formula_articles = [];
    if (field === 'ete' && changed.ete?.calculation_status === 'computed') changed.ete = { ...changed.ete, ete_minutes: changed.ete.ete_minutes + 1 };
    if (field === 'manifest') changed.source_manifest_hash = 'other';
    if (field === 'evidence') changed.evidence = { ...changed.evidence, decision_id: 'other' };
    if (field === 'policy') changed.policy = { ...changed.policy, affected_road: { role: 'context_and_ete' } };
    if (field === 'cms') changed.cms_core_text = 'other';
    if (field === 'multilingual') changed.multilingual_required = !changed.multilingual_required;
    expect(buildDecisionCore(changed).core_hash).not.toBe(buildDecisionCore(base).core_hash);
  });

  propertyTest(33, 'C set-like and object-key reorderings preserve core hash while null differs from absent', fc.shuffledSubarray([1, 2], { minLength: 2, maxLength: 2 }), (articles) => {
    const base = baseCoreInput();
    const reordered = {
      ...base,
      triggered_articles: articles,
      classifications: [...base.classifications].reverse(),
      policy: { ...base.policy },
    };
    expect(buildDecisionCore(reordered).core_hash).toBe(buildDecisionCore(base).core_hash);
    const payloadWithNull = { ...base, incident_anchor: null } as unknown as Parameters<typeof calculateCoreHash>[0];
    const payloadAbsent = { ...base } as unknown as Record<string, unknown>;
    delete payloadAbsent.incident_anchor;
    expect(calculateCoreHash(payloadWithNull)).not.toBe(calculateCoreHash(payloadAbsent as Parameters<typeof calculateCoreHash>[0]));
  });
});
