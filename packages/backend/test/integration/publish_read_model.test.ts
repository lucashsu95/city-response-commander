/**
 * TASK-152 — Publish + read-model integration tests.
 *
 * Drives the real `PublishFn` handler (draft → approved → published) against
 * an in-memory `PublishRecordStore`, then reads the SAME decision back through
 * `aggregateDecisionReadModel` (TASK-149) to verify the four sources merge
 * correctly end-to-end — not just each side's own unit tests in isolation.
 *
 * Invariants under test (§10.11c/d, §12, FIX 1):
 *  - Numbers in the merged view come from DecisionCore only, and are
 *    unaffected by the publish flow running alongside it.
 *  - `publish` reflects every legal transition with a complete, append-only
 *    `audit_trail` (§10.11d, §19).
 *  - Narrative completeness and publish state are independent tracks: a
 *    missing narrative item is `partial`, never blocks or is blocked by
 *    publish.
 *  - `execution` is a read-only IdempotencyTable projection (FIX 1); publish
 *    activity never mutates it, and it surfaces a terminal
 *    `CORE_IDENTITY_CONFLICT` exactly as recorded.
 */

import { describe, it, expect } from 'vitest';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import {
  IdempotencyStatus,
  NarrativeType,
  PublishStatus,
  RecoveryMode,
  RecoveryStage,
} from '@city-commander/shared-schemas';
import type { DecisionCore, DecisionNarrative, IdempotencyRecord } from '@city-commander/shared-schemas';
import { createPublishHandler } from '../../src/publish/publish_fn.js';
import type { PublishFnDependencies } from '../../src/publish/publish_fn.js';
import { applyPublishTransition } from '../../src/publish/publish_state_machine.js';
import { aggregateDecisionReadModel } from '../../src/read_model/read_model_aggregator.js';
import type { ReadModelPorts } from '../../src/read_model/read_model_aggregator.js';
import { createPublishRecordStoreStub } from '../publish/publish_store_stub.js';

const DECISION = 'DEC_TPE_2026_ACC_001';
const KEY = 'TPE_2026_ACC_001|2026-05-20 22:10|prov-2026a';
const ACTOR = 'cognito-sub-commander-1';
const TRACE = 'trace-integration-1';

// ─── Fixtures ──────────────────────────────────────────────────────────────

function core(overrides: Partial<DecisionCore> = {}): DecisionCore {
  return {
    decision_id: DECISION,
    idempotency_key: KEY,
    version: 1,
    source_manifest_hash: 'sha256:AAAA',
    core_hash: 'sha256:CORE-1',
    schema_version: '1.0.0',
    provisional: false,
    event_id: 'ACC_001',
    occurred_at: '2026-05-20 22:10',
    triggered_articles: [1, 2],
    applied_formula_articles: [7],
    primary_evacuation: 'RD_TPE_004',
    secondary_evacuation: ['RD_TPE_005'],
    ete: { calculation_status: 'computed', ete_minutes: 78.6 },
    cms_core_text: '忠孝東路封閉，請改道 光復南路，預計延誤 78.6 分鐘',
    ...overrides,
  } as unknown as DecisionCore;
}

function narrative(type: NarrativeType): DecisionNarrative {
  return { decision_id: DECISION, narrative_type: type } as unknown as DecisionNarrative;
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

function makeEvent(body: unknown = {}): APIGatewayProxyEventV2 {
  return {
    body: JSON.stringify(body),
    pathParameters: { id: DECISION },
    requestContext: {
      requestId: 'req-integration-1',
      authorizer: { jwt: { claims: { sub: ACTOR, 'cognito:groups': ['commanders'] } } },
    },
  } as unknown as APIGatewayProxyEventV2;
}

function statusOf(result: unknown): number {
  return (result as { statusCode: number }).statusCode;
}

/** One shared in-memory PublishRecordTable + a PublishFn handler bound to it. */
function makeWorld(): {
  readonly handler: (event: APIGatewayProxyEventV2) => ReturnType<ReturnType<typeof createPublishHandler>>;
  readonly store: ReturnType<typeof createPublishRecordStoreStub>;
} {
  const store = createPublishRecordStoreStub();
  const deps: PublishFnDependencies = {
    readDecisionCoreStatus: async () => ({ exists: true, core_committed: true }),
    readPublishRecord: async (id) => store.getRecord(id) ?? null,
    readCmsCoreText: async () => core().cms_core_text,
    readPublicAlertText: async () => ({ zh: '繁中民眾警示', en: 'Public alert' }),
    acquirePublishDispatch: async () => 'ACQUIRED',
    writePublishRecord: (record, expectedVersion) =>
      applyPublishTransition(store, record, expectedVersion),
  };
  return { handler: createPublishHandler(deps), store };
}

/** Read-model ports backed by fixed in-memory values (plus the live publish store). */
function makeReadModelPorts(options: {
  readonly core: DecisionCore | null;
  readonly narratives: readonly DecisionNarrative[];
  readonly publishStore: ReturnType<typeof createPublishRecordStoreStub>;
  readonly idempotency: IdempotencyRecord | null;
}): ReadModelPorts {
  return {
    decisionCore: {
      getConsistent: async () => options.core,
      exists: async () => options.core !== null,
    },
    decisionNarrative: {
      queryConsistent: async () => options.narratives,
    },
    publishRecord: {
      getConsistent: async (id) => options.publishStore.getRecord(id) ?? null,
    },
    idempotency: {
      getConsistent: async () => options.idempotency,
    },
  };
}

// ─── End-to-end: publish flow + read model merge ──────────────────────────

describe('Publish + read model — end-to-end draft→approved→published', () => {
  it('read model reflects the published state with a complete audit trail, while core numbers are untouched', async () => {
    const { handler, store } = makeWorld();

    const r1 = await handler(makeEvent({}));
    expect(statusOf(r1)).toBe(200);
    const r2 = await handler(makeEvent({}));
    expect(statusOf(r2)).toBe(200);
    const r3 = await handler(makeEvent({}));
    expect(statusOf(r3)).toBe(200);

    const decisionCore = core();
    const ports = makeReadModelPorts({
      core: decisionCore,
      narratives: [
        narrative(NarrativeType.REPORT),
        narrative(NarrativeType.PUBLIC_ALERT),
        narrative(NarrativeType.EXPLANATION),
      ],
      publishStore: store,
      idempotency: idempotencyRecord(),
    });

    const model = await aggregateDecisionReadModel(ports, { decisionId: DECISION, traceId: TRACE, idempotencyKey: KEY });

    expect(model.data_status).toBe('ready');
    // Numbers come from DecisionCore only, and are the SAME object the
    // publish flow never touched.
    expect(model.core).toBe(decisionCore);
    expect(model.core?.ete).toEqual({ calculation_status: 'computed', ete_minutes: 78.6 });
    expect(model.core?.primary_evacuation).toBe('RD_TPE_004');

    expect(model.narratives.map((n) => n.narrative_type)).toEqual([
      NarrativeType.REPORT,
      NarrativeType.PUBLIC_ALERT,
      NarrativeType.EXPLANATION,
    ]);
    expect(model.missing_narrative_types).toEqual([]);

    expect(model.publish?.publish_state).toBe(PublishStatus.published);
    expect(model.publish?.audit_trail).toHaveLength(3);
    expect(model.publish?.audit_trail.map((entry) => entry.to_state)).toEqual([
      PublishStatus.draft,
      PublishStatus.approved,
      PublishStatus.published,
    ]);
    for (const entry of model.publish?.audit_trail ?? []) {
      expect(entry.actor).toBe(ACTOR);
    }
  });

  it('a retried publish request does not grow the audit trail or change the read model', async () => {
    const { handler, store } = makeWorld();
    await handler(makeEvent({}));
    await handler(makeEvent({}));
    await handler(makeEvent({})); // now published

    const ports = makeReadModelPorts({
      core: core(),
      narratives: [narrative(NarrativeType.REPORT)],
      publishStore: store,
      idempotency: idempotencyRecord(),
    });
    const before = await aggregateDecisionReadModel(ports, { decisionId: DECISION, traceId: TRACE, idempotencyKey: KEY });

    // Retry the same "advance" request against an already-published record.
    await handler(makeEvent({}));

    const after = await aggregateDecisionReadModel(ports, { decisionId: DECISION, traceId: TRACE, idempotencyKey: KEY });
    expect(after.publish?.audit_trail.length).toBe(before.publish?.audit_trail.length);
    expect(after.publish?.version).toBe(before.publish?.version);
  });
});

// ─── Narrative completeness and publish state are independent tracks ─────

describe('Publish + read model — narrative completeness is independent of publish state', () => {
  it('publish can reach "published" while a narrative item is still missing (partial)', async () => {
    const { handler, store } = makeWorld();
    await handler(makeEvent({}));
    await handler(makeEvent({}));
    const r3 = await handler(makeEvent({}));
    expect(statusOf(r3)).toBe(200);

    const ports = makeReadModelPorts({
      core: core(),
      // EXPLANATION missing — a normal Fast Path state, not an error.
      narratives: [narrative(NarrativeType.REPORT), narrative(NarrativeType.PUBLIC_ALERT)],
      publishStore: store,
      idempotency: idempotencyRecord(),
    });

    const model = await aggregateDecisionReadModel(ports, { decisionId: DECISION, traceId: TRACE, idempotencyKey: KEY });
    expect(model.data_status).toBe('partial');
    expect(model.missing_narrative_types).toEqual([NarrativeType.EXPLANATION]);
    // Publish is unaffected by narrative completeness.
    expect(model.publish?.publish_state).toBe(PublishStatus.published);
  });
});

// ─── execution is a read-only projection, independent of publish/core ────

describe('Publish + read model — execution projection is read-only', () => {
  it('publish activity never changes the execution projection', async () => {
    const { handler, store } = makeWorld();
    const idempotency = idempotencyRecord();
    const ports = makeReadModelPorts({
      core: core(),
      narratives: [],
      publishStore: store,
      idempotency,
    });

    const before = await aggregateDecisionReadModel(ports, { decisionId: DECISION, traceId: TRACE, idempotencyKey: KEY });
    await handler(makeEvent({}));
    await handler(makeEvent({}));
    await handler(makeEvent({}));
    const after = await aggregateDecisionReadModel(ports, { decisionId: DECISION, traceId: TRACE, idempotencyKey: KEY });

    expect(after.execution).toEqual(before.execution);
    expect(after.publish?.publish_state).toBe(PublishStatus.published);
  });

  it('a terminal CORE_IDENTITY_CONFLICT is surfaced in execution exactly as recorded', async () => {
    const { store } = makeWorld();
    const conflicted = idempotencyRecord({
      status: IdempotencyStatus.processing_failed,
      last_error: 'CORE_IDENTITY_CONFLICT',
      retryable: false,
      attempt_count: 3,
    });
    const ports = makeReadModelPorts({
      core: core(),
      narratives: [],
      publishStore: store,
      idempotency: conflicted,
    });

    const model = await aggregateDecisionReadModel(ports, { decisionId: DECISION, traceId: TRACE, idempotencyKey: KEY });
    expect(model.execution).toEqual({
      status: IdempotencyStatus.processing_failed,
      last_error: 'CORE_IDENTITY_CONFLICT',
      retryable: false,
      attempt_count: 3,
    });
    // The conflict is a fact about a prior workflow attempt; it does not
    // fabricate or withhold the core/publish state alongside it.
    expect(model.core?.decision_id).toBe(DECISION);
  });

  it('execution is null (never fabricated) when no idempotency record is found', async () => {
    const { store } = makeWorld();
    const ports = makeReadModelPorts({
      core: core(),
      narratives: [],
      publishStore: store,
      idempotency: null,
    });
    const model = await aggregateDecisionReadModel(ports, { decisionId: DECISION, traceId: TRACE, idempotencyKey: KEY });
    expect(model.execution).toBeNull();
  });
});
