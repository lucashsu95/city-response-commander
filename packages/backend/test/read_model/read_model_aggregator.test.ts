/**
 * TASK-149 — DecisionReadModel four-source aggregation unit tests.
 *
 * The invariants: numbers come only from DecisionCore, a missing core is
 * `insufficient_data` (never a fabricated decision, never a 404), missing
 * narratives are `partial` with the gap listed, the `execution` projection is
 * read-only, and a read fault is never downgraded to "no data" (§10.11c, §12, §21).
 */

import { describe, it, expect, vi } from 'vitest';
import {
  IdempotencyStatus,
  NarrativeType,
  PublishStatus,
  RecoveryMode,
  RecoveryStage,
  SCHEMA_VERSION,
} from '@city-commander/shared-schemas';
import type {
  DecisionCore,
  DecisionNarrative,
  IdempotencyRecord,
  PublishRecord,
} from '@city-commander/shared-schemas';
import {
  aggregateDecisionReadModel,
  DecisionReadModelAggregator,
  PublishRecordReadError,
  ReaderUsageError,
  TableReadError,
} from '../../src/index.js';
import type { ReadModelPorts } from '../../src/index.js';

const DECISION = 'DEC_TPE_2026_ACC_001_abcdef123456';
const KEY = 'TPE_2026_ACC_001|2026-05-20 22:10|prov-2026a';
const TRACE = 'trace-abc-123';

function core(overrides: Partial<DecisionCore> = {}): DecisionCore {
  return {
    decision_id: DECISION,
    idempotency_key: KEY,
    source_manifest_hash: 'sha256:AAAA',
    core_hash: 'sha256:CORE-1',
    schema_version: '1.0.0',
    provisional: true,
    primary_evacuation: 'RD_TPE_004',
    ...overrides,
  } as unknown as DecisionCore;
}

function narrative(type: NarrativeType): DecisionNarrative {
  return { decision_id: DECISION, narrative_type: type } as unknown as DecisionNarrative;
}

function publishRecord(): PublishRecord {
  return {
    decision_id: DECISION,
    publish_state: PublishStatus.published,
    channels: ['CMS'],
    audit_trail: [],
    version: 2,
    updated_at: '2026-05-20 22:15',
  };
}

function idempotencyRecord(overrides: Partial<IdempotencyRecord> = {}): IdempotencyRecord {
  return {
    idempotency_key: KEY,
    decision_id: DECISION,
    status: IdempotencyStatus.completed,
    attempt_count: 1,
    lease_owner: null,
    lease_expires_at: null,
    last_error: null,
    retryable: true,
    workflow_execution_arn: 'arn:exec:1',
    running_started_at: 1,
    running_deadline_at: null,
    completed_execution_arn: 'arn:exec:1',
    completed_attempt_count: 1,
    last_transition_execution_arn: 'arn:exec:1',
    last_transition_attempt_count: 1,
    evidence_source: null,
    core_committed: true,
    recovery_stage: RecoveryStage.NONE,
    recovery_mode: RecoveryMode.NORMAL,
    previous_last_error: null,
    created_at: '2026-05-20 22:10',
    updated_at: '2026-05-20 22:12',
    expires_at: 1_800_086_400,
    ...overrides,
  };
}

interface Ports extends ReadModelPorts {
  readonly readCore: ReturnType<typeof vi.fn>;
  readonly readNarratives: ReturnType<typeof vi.fn>;
  readonly readPublish: ReturnType<typeof vi.fn>;
  readonly readIdempotency: ReturnType<typeof vi.fn>;
}

function createPorts(options?: {
  core?: DecisionCore | null;
  narratives?: readonly DecisionNarrative[];
  publish?: PublishRecord | null;
  idempotency?: IdempotencyRecord | null;
}): Ports {
  const readCore = vi.fn().mockResolvedValue(options?.core ?? null);
  const readNarratives = vi.fn().mockResolvedValue(options?.narratives ?? []);
  const readPublish = vi.fn().mockResolvedValue(options?.publish ?? null);
  const readIdempotency = vi.fn().mockResolvedValue(options?.idempotency ?? null);

  return {
    readCore,
    readNarratives,
    readPublish,
    readIdempotency,
    decisionCore: {
      getConsistent: readCore,
      exists: async (id: string) => (await readCore(id)) !== null,
    },
    decisionNarrative: { queryConsistent: readNarratives },
    publishRecord: { getConsistent: readPublish },
    idempotency: { getConsistent: readIdempotency },
  } as unknown as Ports;
}

// ─── data_status ───────────────────────────────────────────

describe('data_status', () => {
  it('is ready when the core and all three narratives exist', async () => {
    const ports = createPorts({
      core: core(),
      narratives: [
        narrative(NarrativeType.REPORT),
        narrative(NarrativeType.PUBLIC_ALERT),
        narrative(NarrativeType.EXPLANATION),
      ],
    });

    const model = await aggregateDecisionReadModel(ports, { decisionId: DECISION, traceId: TRACE });

    expect(model.data_status).toBe('ready');
    expect(model.missing_narrative_types).toEqual([]);
  });

  it('is partial when the core exists but narrative text is pending (Fast Path)', async () => {
    const ports = createPorts({
      core: core(),
      narratives: [narrative(NarrativeType.REPORT)],
    });

    const model = await aggregateDecisionReadModel(ports, { decisionId: DECISION, traceId: TRACE });

    expect(model.data_status).toBe('partial');
    expect(model.missing_narrative_types).toEqual([
      NarrativeType.PUBLIC_ALERT,
      NarrativeType.EXPLANATION,
    ]);
    // Numbers are already available even though the AI text is not.
    expect(model.core?.primary_evacuation).toBe('RD_TPE_004');
  });

  it('is insufficient_data when no core is committed', async () => {
    const ports = createPorts({ core: null });

    const model = await aggregateDecisionReadModel(ports, { decisionId: DECISION, traceId: TRACE });

    expect(model.data_status).toBe('insufficient_data');
    expect(model.core).toBeNull();
  });

  it('stays insufficient_data even when narratives exist without a core', async () => {
    // Nothing authoritative to present, so narrative text cannot promote it.
    const ports = createPorts({
      core: null,
      narratives: [narrative(NarrativeType.REPORT), narrative(NarrativeType.PUBLIC_ALERT)],
    });

    const model = await aggregateDecisionReadModel(ports, { decisionId: DECISION, traceId: TRACE });

    expect(model.data_status).toBe('insufficient_data');
  });

  it('never fabricates a core (no empty-decision placeholder)', async () => {
    const ports = createPorts({ core: null });

    const model = await aggregateDecisionReadModel(ports, { decisionId: DECISION, traceId: TRACE });

    expect(model.core).toBeNull();
    expect(model.policy_version).toBeNull();
    expect(model.source_manifest_hash).toBeNull();
    expect(model.provisional).toBe(false);
  });
});

// ─── UARE (TASK-UARE-11): sop_matched/sop_authority/universal_principles/
// grounding_candidates reach GET /decisions/{id} unchanged ─────────────────
// Spec: .kiro/specs/unified-adaptive-reasoning-engine/requirements.md R5, R10
//
// The read model wraps `core` by reference (read_model_aggregator.ts:186
// assigns `core` straight into the model, never reconstructing it field by
// field), so the 4 UARE fields on DecisionCore need no separate mapping code
// here — this test proves that pass-through actually holds, rather than just
// asserting it from reading the source.

describe('UARE fields reach DecisionReadModel.core unchanged', () => {
  it('passes sop_matched:false, sop_authority, universal_principles and grounding_candidates through untouched', async () => {
    const uareCore = core({
      triggered_articles: [],
      sop_matched: false,
      sop_authority: 'SYSTEM_DEFAULT_PRINCIPLE',
      universal_principles: [
        { principle_id: 'UPSTREAM_CONTAINMENT', title: '上游截流', description: '上游截流說明' },
        { principle_id: 'PERIMETER_GUIDANCE', title: '周邊引導', description: '周邊引導說明' },
        { principle_id: 'PUBLIC_NOTIFICATION', title: '資訊通報', description: '資訊通報說明' },
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
    const ports = createPorts({ core: uareCore });

    const model = await aggregateDecisionReadModel(ports, { decisionId: DECISION, traceId: TRACE });

    expect(model.core?.sop_matched).toBe(false);
    expect(model.core?.sop_authority).toBe('SYSTEM_DEFAULT_PRINCIPLE');
    expect(model.core?.universal_principles).toHaveLength(3);
    expect(model.core?.grounding_candidates).toEqual([
      {
        segment_id: 'RD_TPE_004',
        road_name: '市民大道四段',
        saturation_score: 0.2,
        capacity_vph: 2500,
        status_text: '暢通',
      },
    ]);
  });

  it('passes sop_matched:true through with empty universal_principles/grounding_candidates', async () => {
    const uareCore = core({
      triggered_articles: [1, 2],
      sop_matched: true,
      sop_authority: 'OFFICIAL_SOP',
      universal_principles: [],
      grounding_candidates: [],
    });
    const ports = createPorts({ core: uareCore });

    const model = await aggregateDecisionReadModel(ports, { decisionId: DECISION, traceId: TRACE });

    expect(model.core?.sop_matched).toBe(true);
    expect(model.core?.sop_authority).toBe('OFFICIAL_SOP');
    expect(model.core?.universal_principles).toEqual([]);
    expect(model.core?.grounding_candidates).toEqual([]);
  });
});

// ─── Four-source merge ─────────────────────────────────────

describe('four-source merge', () => {
  it('reads all four sources exactly once', async () => {
    const ports = createPorts({ core: core(), idempotency: idempotencyRecord() });

    await aggregateDecisionReadModel(ports, {
      decisionId: DECISION,
      traceId: TRACE,
      idempotencyKey: KEY,
    });

    expect(ports.readCore).toHaveBeenCalledTimes(1);
    expect(ports.readCore).toHaveBeenCalledWith(DECISION);
    expect(ports.readNarratives).toHaveBeenCalledTimes(1);
    expect(ports.readPublish).toHaveBeenCalledTimes(1);
    expect(ports.readIdempotency).toHaveBeenCalledTimes(1);
    expect(ports.readIdempotency).toHaveBeenCalledWith(KEY);
  });

  it('projects only the four read-only execution fields (FIX 1)', async () => {
    const ports = createPorts({
      core: core(),
      idempotency: idempotencyRecord({
        status: IdempotencyStatus.processing_failed,
        last_error: 'CORE_IDENTITY_CONFLICT',
        retryable: false,
        attempt_count: 3,
      }),
    });

    const model = await aggregateDecisionReadModel(ports, {
      decisionId: DECISION,
      traceId: TRACE,
      idempotencyKey: KEY,
    });

    expect(model.execution).toEqual({
      status: 'processing_failed',
      last_error: 'CORE_IDENTITY_CONFLICT',
      retryable: false,
      attempt_count: 3,
    });
    // Lease internals must not leak into a public read model.
    expect(Object.keys(model.execution ?? {})).toEqual([
      'status',
      'last_error',
      'retryable',
      'attempt_count',
    ]);
  });

  it('surfaces a terminal identity conflict through the execution projection', async () => {
    const ports = createPorts({
      core: core(),
      idempotency: idempotencyRecord({
        status: IdempotencyStatus.processing_failed,
        last_error: 'CORE_IDENTITY_CONFLICT',
        retryable: false,
      }),
    });

    const model = await aggregateDecisionReadModel(ports, {
      decisionId: DECISION,
      traceId: TRACE,
      idempotencyKey: KEY,
    });

    expect(model.execution?.retryable).toBe(false);
    expect(model.execution?.last_error).toBe('CORE_IDENTITY_CONFLICT');
  });

  it('omits the execution projection when no idempotency key is supplied', async () => {
    const ports = createPorts({ core: core() });

    const model = await aggregateDecisionReadModel(ports, {
      decisionId: DECISION,
      traceId: TRACE,
    });

    expect(model.execution).toBeNull();
    expect(ports.readIdempotency).not.toHaveBeenCalled();
  });

  it('reports publish state when the decision has been published', async () => {
    const ports = createPorts({ core: core(), publish: publishRecord() });

    const model = await aggregateDecisionReadModel(ports, { decisionId: DECISION, traceId: TRACE });

    expect(model.publish?.publish_state).toBe(PublishStatus.published);
    expect(model.publish?.version).toBe(2);
  });

  it('reports publish as null when the decision was never published', async () => {
    const ports = createPorts({ core: core(), publish: null });

    const model = await aggregateDecisionReadModel(ports, { decisionId: DECISION, traceId: TRACE });

    expect(model.publish).toBeNull();
  });

  it('returns narratives in required-set order regardless of item order', async () => {
    const ports = createPorts({
      core: core(),
      narratives: [
        narrative(NarrativeType.EXPLANATION),
        narrative(NarrativeType.PUBLIC_ALERT),
        narrative(NarrativeType.REPORT),
      ],
    });

    const model = await aggregateDecisionReadModel(ports, { decisionId: DECISION, traceId: TRACE });

    expect(model.narratives.map((n) => n.narrative_type)).toEqual([
      NarrativeType.REPORT,
      NarrativeType.PUBLIC_ALERT,
      NarrativeType.EXPLANATION,
    ]);
  });
});

// ─── Envelope fields ───────────────────────────────────────

describe('response envelope (§12)', () => {
  it('echoes the trace id and decision id', async () => {
    const ports = createPorts({ core: core() });

    const model = await aggregateDecisionReadModel(ports, { decisionId: DECISION, traceId: TRACE });

    expect(model.trace_id).toBe(TRACE);
    expect(model.decision_id).toBe(DECISION);
  });

  it('takes schema_version from the core when present', async () => {
    const ports = createPorts({ core: core({ schema_version: '1.2.3' }) });

    const model = await aggregateDecisionReadModel(ports, { decisionId: DECISION, traceId: TRACE });

    expect(model.schema_version).toBe('1.2.3');
  });

  it('falls back to the package schema_version when no core exists', async () => {
    const ports = createPorts({ core: null });

    const model = await aggregateDecisionReadModel(ports, { decisionId: DECISION, traceId: TRACE });

    expect(model.schema_version).toBe(SCHEMA_VERSION);
  });

  it('derives policy_version from the idempotency key, never invents it', async () => {
    const ports = createPorts({ core: core() });

    const model = await aggregateDecisionReadModel(ports, { decisionId: DECISION, traceId: TRACE });

    expect(model.policy_version).toBe('prov-2026a');
  });

  it('reports policy_version as null when the key is malformed', async () => {
    const ports = createPorts({ core: core({ idempotency_key: 'malformed-key' }) });

    const model = await aggregateDecisionReadModel(ports, { decisionId: DECISION, traceId: TRACE });

    expect(model.policy_version).toBeNull();
  });

  it('propagates the provisional marker from the core', async () => {
    const ports = createPorts({ core: core({ provisional: true }) });

    const model = await aggregateDecisionReadModel(ports, { decisionId: DECISION, traceId: TRACE });

    expect(model.provisional).toBe(true);
  });

  it('carries the source manifest hash for provenance', async () => {
    const ports = createPorts({ core: core() });

    const model = await aggregateDecisionReadModel(ports, { decisionId: DECISION, traceId: TRACE });

    expect(model.source_manifest_hash).toBe('sha256:AAAA');
  });
});

// ─── Failure handling ──────────────────────────────────────

describe('failure handling', () => {
  it('propagates a core read failure instead of reporting insufficient_data', async () => {
    const ports = createPorts();
    const failure = new TableReadError('throttled', 'DecisionCoreTable', 'GetItem', DECISION);
    ports.readCore.mockRejectedValue(failure);

    await expect(
      aggregateDecisionReadModel(ports, { decisionId: DECISION, traceId: TRACE }),
    ).rejects.toBe(failure);
  });

  it('propagates a narrative read failure instead of reporting all missing', async () => {
    const ports = createPorts({ core: core() });
    const failure = new TableReadError('throttled', 'DecisionNarrativeTable', 'Query', DECISION);
    ports.readNarratives.mockRejectedValue(failure);

    await expect(
      aggregateDecisionReadModel(ports, { decisionId: DECISION, traceId: TRACE }),
    ).rejects.toBe(failure);
  });

  it('propagates a publish read failure instead of reporting unpublished', async () => {
    const ports = createPorts({ core: core() });
    const failure = new PublishRecordReadError('throttled', DECISION);
    ports.readPublish.mockRejectedValue(failure);

    await expect(
      aggregateDecisionReadModel(ports, { decisionId: DECISION, traceId: TRACE }),
    ).rejects.toBe(failure);
  });

  it('rejects an empty decisionId', async () => {
    const ports = createPorts();

    await expect(
      aggregateDecisionReadModel(ports, { decisionId: '', traceId: TRACE }),
    ).rejects.toBeInstanceOf(ReaderUsageError);
    expect(ports.readCore).not.toHaveBeenCalled();
  });

  it('rejects an empty traceId (a response must be correlatable)', async () => {
    const ports = createPorts();

    await expect(
      aggregateDecisionReadModel(ports, { decisionId: DECISION, traceId: '' }),
    ).rejects.toBeInstanceOf(ReaderUsageError);
  });
});

// ─── Class wrapper ─────────────────────────────────────────

describe('DecisionReadModelAggregator', () => {
  it('aggregates with the ports bound at construction', async () => {
    const ports = createPorts({ core: core() });
    const aggregator = new DecisionReadModelAggregator(ports);

    const model = await aggregator.aggregate({ decisionId: DECISION, traceId: TRACE });

    expect(model.data_status).toBe('partial');
  });
});
