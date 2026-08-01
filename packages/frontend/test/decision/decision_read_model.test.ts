/**
 * Decision read-model boundary decoder tests (TASK-132).
 *
 * Covers the required envelope fields, the §10.11c `core`/`data_status`
 * invariant in both directions, narrative extraction, fail-closed handling of
 * malformed fields, and the rule that the decoder carries values through
 * verbatim without recomputing anything.
 */

import { describe, expect, it } from 'vitest';
import { decodeDecisionReadModel } from '../../src/decision/decision_read_model.js';
import { wireCore, wireDecision, wireEte, wireNarrative } from './fixtures.js';

function decode(raw: unknown) {
  return decodeDecisionReadModel(raw);
}

function expectError(raw: unknown, code: string): void {
  const result = decode(raw);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error.code).toBe(code);
}

describe('decodeDecisionReadModel — envelope', () => {
  it('decodes a complete ready payload', () => {
    const result = decode(wireDecision());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.schemaVersion).toBe('1.0');
    expect(result.model.traceId).toBe('tr-abc123');
    expect(result.model.decisionId).toBe('dec-acc001');
    expect(result.model.dataStatus).toBe('ready');
    expect(result.model.policyVersion).toBe('prov-2026a');
    expect(result.model.provisional).toBe(true);
    expect(result.model.sourceManifestHash).toBe('sha256:9c1f');
  });

  it.each([
    ['not an object', 'a string body', 'NOT_AN_OBJECT'],
    [
      'missing schema_version',
      { ...wireDecision(), schema_version: undefined },
      'MISSING_SCHEMA_VERSION',
    ],
    ['blank schema_version', { ...wireDecision(), schema_version: '  ' }, 'INVALID_SCHEMA_VERSION'],
    ['missing trace_id', { ...wireDecision(), trace_id: undefined }, 'MISSING_TRACE_ID'],
    ['numeric trace_id', { ...wireDecision(), trace_id: 7 }, 'INVALID_TRACE_ID'],
    ['missing decision_id', { ...wireDecision(), decision_id: undefined }, 'MISSING_DECISION_ID'],
    ['missing data_status', { ...wireDecision(), data_status: undefined }, 'MISSING_DATA_STATUS'],
    ['unknown data_status', { ...wireDecision(), data_status: 'done' }, 'INVALID_DATA_STATUS'],
    ['missing narratives', { ...wireDecision(), narratives: undefined }, 'MISSING_NARRATIVES'],
    ['non-array narratives', { ...wireDecision(), narratives: {} }, 'MISSING_NARRATIVES'],
  ])('fails closed on %s', (_label, body, code) => {
    expectError(body, code as string);
  });

  it('requires the core key even when the core is null', () => {
    const body = wireDecision();
    delete body['core'];
    expectError(body, 'MISSING_CORE_KEY');
  });

  it('accepts every documented data_status', () => {
    for (const status of ['ready', 'partial'] as const) {
      const result = decode(wireDecision({ data_status: status, missing_narrative_types: [] }));
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.model.dataStatus).toBe(status);
    }
  });
});

describe('decodeDecisionReadModel — §10.11c core/data_status invariant', () => {
  it('decodes insufficient_data with a null core', () => {
    const result = decode(
      wireDecision({
        data_status: 'insufficient_data',
        core: null,
        narratives: [],
        missing_narrative_types: ['REPORT', 'PUBLIC_ALERT', 'EXPLANATION'],
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.core).toBeNull();
    expect(result.model.missingNarrativeTypes).toEqual(['REPORT', 'PUBLIC_ALERT', 'EXPLANATION']);
  });

  it('rejects a null core with a ready status', () => {
    expectError(wireDecision({ core: null }), 'CORE_STATUS_MISMATCH');
  });

  it('rejects a present core with insufficient_data', () => {
    expectError(wireDecision({ data_status: 'insufficient_data' }), 'CORE_STATUS_MISMATCH');
  });

  it('rejects a non-object core', () => {
    expectError(wireDecision({ core: 'dec-acc001' }), 'INVALID_CORE');
  });
});

describe('decodeDecisionReadModel — core', () => {
  it('carries deterministic values through verbatim', () => {
    const result = decode(wireDecision());
    expect(result.ok).toBe(true);
    if (!result.ok || result.model.core === null) return;
    const core = result.model.core;

    expect(core.eventId).toBe('TPE_2026_ACC_001');
    expect(core.occurredAt).toBe('2026-05-20 22:10');
    expect(core.triggeredArticles).toEqual([1, 2]);
    expect(core.appliedFormulaArticles).toEqual([7]);
    expect(core.invokedProcedures).toEqual(['article2_alternative_route_guidance']);
    expect(core.primaryEvacuation).toBe('RD_TPE_004');
    expect(core.secondaryEvacuation).toEqual(['RD_TPE_005']);
    expect(core.classifications).toEqual([
      { segmentId: 'RD_TPE_002', level: 'A' },
      { segmentId: 'RD_TPE_004', level: 'B' },
    ]);
    expect(core.ete?.eteMinutes).toBe(78.6);
    expect(core.ete?.baseClearance).toBe(60);
    expect(core.multilingualRequired).toBe(true);
    expect(core.eventFacts?.location).toBe('光復南路與忠孝東路口南側');
  });

  it('never rounds or rescales a number', () => {
    const result = decode(
      wireDecision({ core: wireCore({ ete: wireEte({ ete_minutes: 78.63333 }) }) }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.model.core?.ete?.eteMinutes).toBe(78.63333);
  });

  it('accepts primary_evacuation as the design §12 object form', () => {
    const result = decode(
      wireDecision({
        core: wireCore({
          primary_evacuation: {
            segment_id: 'RD_TPE_004',
            example_classification: 'PROVISIONAL_DERIVED_EXAMPLE',
          },
          secondary_evacuation: [{ segment_id: 'RD_TPE_005' }],
        }),
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.core?.primaryEvacuation).toBe('RD_TPE_004');
    expect(result.model.core?.secondaryEvacuation).toEqual(['RD_TPE_005']);
  });

  it('reports an unresolved primary route as null rather than inventing one', () => {
    const result = decode(wireDecision({ core: wireCore({ primary_evacuation: null }) }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.model.core?.primaryEvacuation).toBeNull();
  });

  it('leaves an absent decision_cutoff_timestamp null instead of using occurred_at', () => {
    const result = decode(wireDecision());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.core?.decisionCutoffTimestamp).toBeNull();
    expect(result.model.core?.occurredAt).toBe('2026-05-20 22:10');
  });

  it('exposes the validated core object for the per-concern decoders', () => {
    const result = decode(wireDecision());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.core?.fields['evidence']).toBeTypeOf('object');
    expect(result.model.core?.fields['ete']).toBeTypeOf('object');
  });

  it.each([
    ['string triggered_articles', { triggered_articles: ['1'] }, 'INVALID_CORE_FIELD'],
    ['numeric cms_core_text', { cms_core_text: 12 }, 'INVALID_CORE_FIELD'],
    ['string multilingual_required', { multilingual_required: 'true' }, 'INVALID_CORE_FIELD'],
    ['non-object classification', { classifications: ['RD_TPE_002'] }, 'INVALID_CORE_FIELD'],
    [
      'classification without segment_id',
      { classifications: [{ level: 'A' }] },
      'INVALID_CORE_FIELD',
    ],
    ['non-object event_facts', { event_facts: 'accident' }, 'INVALID_CORE_FIELD'],
    ['string ete_minutes', { ete: wireEte({ ete_minutes: '78.6' }) }, 'INVALID_ETE'],
    ['non-object policy', { policy: 'PROVISIONAL' }, 'INVALID_POLICY'],
  ])('fails closed on %s', (_label, coreOverrides, code) => {
    expectError(
      wireDecision({ core: wireCore(coreOverrides as Record<string, unknown>) }),
      code as string,
    );
  });

  it('decodes the policy mode disclosure verbatim', () => {
    const result = decode(wireDecision());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const policy = result.model.core?.policy;
    expect(policy?.classification).toBe('PROVISIONAL_TEAM_POLICY');
    expect(policy?.isOfficial).toBe(false);
    expect(policy?.guidanceId).toBe('HG-001');
    expect(policy?.timeAlignmentMode).toBe('GLOBAL_AS_OF_EVENT_CUTOFF_LATEST_PRIOR_PER_ENTITY');
    expect(policy?.eteAffectedSetMode).toBe('INCIDENT_PRIMARY_AND_SELECTED_SECONDARY');
    expect(policy?.incidentAnchorMode).toBe('incident_anchor_from_location_text');
    // Not on the live wire; must stay null rather than default to a claim.
    expect(policy?.officialUniqueRule).toBeNull();
  });
});

describe('decodeDecisionReadModel — narratives', () => {
  it('extracts the three required-set items', () => {
    const result = decode(wireDecision());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.report?.reportText).toBe('交控中心建議書內文（AI 生成）');
    expect(result.model.report?.cmsExplanationText).toBe('AI 補充：建議提前引導車流。');
    expect(result.model.alert?.texts).toEqual([
      { language: 'zh', text: '光復南路封閉，請改道 RD_TPE_004。' },
      { language: 'en', text: 'Road closed. Detour via RD_TPE_004.' },
    ]);
    expect(result.model.explanation?.explanationText).toBe('判定為 A 級並排除低容量候選。');
  });

  it('reports a pending narrative as null, not as empty text', () => {
    const result = decode(
      wireDecision({
        data_status: 'partial',
        narratives: [
          wireNarrative('PUBLIC_ALERT', {
            type: 'PUBLIC_ALERT',
            public_alert_text: { zh: '中文簡訊' },
          }),
        ],
        missing_narrative_types: ['REPORT', 'EXPLANATION'],
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.report).toBeNull();
    expect(result.model.explanation).toBeNull();
    expect(result.model.missingNarrativeTypes).toEqual(['REPORT', 'EXPLANATION']);
  });

  it('ignores an unrecognized narrative type without failing', () => {
    const result = decode(
      wireDecision({
        narratives: [...(wireDecision()['narratives'] as unknown[]), wireNarrative('FUTURE', {})],
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.model.report?.reportText).toBeTypeOf('string');
  });

  it.each([
    ['missing narrative_type', [wireNarrative('REPORT', {}, { narrative_type: undefined })]],
    ['non-object payload', [wireNarrative('REPORT', {}, { payload: 'text' })]],
    ['numeric report_text', [wireNarrative('REPORT', { report_text: 5 })]],
    ['non-string alert text', [wireNarrative('PUBLIC_ALERT', { public_alert_text: { zh: 5 } })]],
    ['non-object narrative element', ['REPORT']],
  ])('fails closed on %s', (_label, narratives) => {
    expectError(wireDecision({ narratives }), 'INVALID_NARRATIVE');
  });
});

describe('decodeDecisionReadModel — publish and execution', () => {
  it('decodes the publish record and audit trail', () => {
    const result = decode(wireDecision());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.publish?.publishState).toBe('draft');
    expect(result.model.publish?.channels).toEqual(['CMS', 'SMS']);
    expect(result.model.publish?.auditTrail).toEqual([
      {
        actor: 'commander-1',
        action: 'create_draft',
        fromState: null,
        toState: 'draft',
        at: '2026-05-20 22:11',
      },
    ]);
  });

  it('treats an absent publish record and execution summary as null', () => {
    const result = decode(wireDecision({ publish: null, execution: null }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.publish).toBeNull();
    expect(result.model.execution).toBeNull();
  });

  it('decodes the read-only execution projection', () => {
    const result = decode(
      wireDecision({
        execution: {
          status: 'processing_failed',
          last_error: 'CORE_IDENTITY_CONFLICT',
          retryable: false,
          attempt_count: 2,
        },
      }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.execution).toEqual({
      status: 'processing_failed',
      lastError: 'CORE_IDENTITY_CONFLICT',
      retryable: false,
      attemptCount: 2,
    });
  });

  it.each([
    ['non-object publish', { publish: 'draft' }, 'INVALID_PUBLISH'],
    [
      'non-object audit entry',
      { publish: { publish_state: 'draft', audit_trail: ['x'] } },
      'INVALID_PUBLISH',
    ],
    [
      'string retryable',
      { execution: { status: 'running', retryable: 'no' } },
      'INVALID_EXECUTION',
    ],
    ['numeric policy_version', { policy_version: 3 }, 'MALFORMED_ENVELOPE_FIELD'],
    ['string provisional', { provisional: 'true' }, 'MALFORMED_ENVELOPE_FIELD'],
    [
      'numeric missing_narrative_types',
      { missing_narrative_types: [1] },
      'MALFORMED_ENVELOPE_FIELD',
    ],
  ])('fails closed on %s', (_label, overrides, code) => {
    expectError(wireDecision(overrides as Record<string, unknown>), code as string);
  });
});
