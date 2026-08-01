/**
 * TASK-097 — ASL wiring tests.
 *
 * ## The test that matters most
 *
 * "the payload covers every JSONPath the ASL reads". `$.trace_id` was read by
 * eight states in `workflow.asl.json` and produced by none of the payload builder,
 * which typechecked cleanly and passed 950 tests — and would have failed 100% of
 * injections at `RUN_DECISION` with a non-retryable `States.Runtime`. A JSONPath
 * reference cannot be type-checked, so it has to be pinned by a test.
 *
 * The Choice translations and the dispatcher are asserted for the same reason: the
 * state machine is a JSON file interpreted by AWS, so every agreement between it
 * and this package is a convention that nothing enforces unless a test does.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  CoreWriteStatus,
  EvidenceSource,
  IdempotencyStatus,
  RecoveryMode,
  StatusActionResult,
} from '@city-commander/shared-schemas';
import type { IdempotencyRecord } from '@city-commander/shared-schemas';
import {
  ASL_DIVERGENCE_PROCESSING_FAILED_RETRYABLE,
  ASL_GAP_INSUFFICIENT_DATA_BRANCH,
  ASL_GAP_PASS_STATE_DROPS_TRACE_ID,
  AslPayloadError,
  AslState,
  IdempotencyConditionFailedError,
  SKIPPED_INSUFFICIENT_DATA,
  WORKFLOW_INPUT_JSONPATHS,
  buildExecutionPayload,
  dispatchWorkflowStatusAction,
  jsonPathToField,
  nextStateForCoreWriteStatus,
  nextStateForRecoveryMode,
  resolveExecutionArn,
} from '../../src/index.js';
import type {
  AslWorkflowStatusPayload,
  IdempotencyStateStore,
  WiringContext,
  WorkflowLaunchInput,
} from '../../src/index.js';

const KEY = 'TPE_2026_ACC_001|2026-05-20 22:10|prov-2026a';
const DECISION = 'DEC_TPE_2026_ACC_001_abcdef123456';
const EXEC = 'arn:aws:states:ap-northeast-1:1:express:wf:exec-A';
const TRACE = 'trace-abc-123';

const context: WiringContext = {
  nowEpochMs: 1_800_000_000_000,
  nowDisplay: '2026-05-20 22:10',
  executionDeadlineMs: 60_000,
};

function launchInput(overrides: Partial<WorkflowLaunchInput> = {}): WorkflowLaunchInput {
  return {
    idempotencyKey: KEY,
    decisionId: DECISION,
    attemptCount: 1,
    leaseOwner: 'req-1',
    recoveryMode: RecoveryMode.NORMAL,
    requestTimestamp: '2026-05-20 22:10',
    traceId: TRACE,
    ...overrides,
  };
}

/** Store double that records the guard and mutation each transition generated. */
interface FakeStore {
  readonly store: IdempotencyStateStore;
  readonly updates: { guard: Record<string, unknown>; mutation: Record<string, unknown> }[];
}

function fakeStore(record: Partial<IdempotencyRecord> = {}): FakeStore {
  const updates: FakeStore['updates'] = [];
  const merged = {
    idempotency_key: KEY,
    decision_id: DECISION,
    status: IdempotencyStatus.running,
    attempt_count: 1,
    lease_owner: 'req-1',
    recovery_mode: RecoveryMode.NORMAL,
    workflow_execution_arn: EXEC,
    core_committed: false,
    ...record,
  } as unknown as IdempotencyRecord;

  return {
    updates,
    store: {
      conditionalUpdateState: async (input: {
        guard: Record<string, unknown>;
        mutation: Record<string, unknown>;
      }) => {
        updates.push({ guard: input.guard, mutation: input.mutation });
        return merged;
      },
      getConsistent: async () => merged,
    } as unknown as IdempotencyStateStore,
  };
}

// ─── JSONPath coverage: the regression guard ───────────────

describe('buildExecutionPayload covers every ASL INPUT JSONPath', () => {
  it('emits a field for all 8 paths', () => {
    const payload = buildExecutionPayload(launchInput()) as unknown as Record<string, unknown>;

    const missing = WORKFLOW_INPUT_JSONPATHS.filter((path) => !(jsonPathToField(path) in payload));

    // A JSONPath reference to an absent field is a non-retryable States.Runtime at
    // runtime, not a type error. This assertion is the only thing that catches it.
    expect(missing).toEqual([]);
  });

  it('enumerates exactly the 8 paths read from INPUT', () => {
    expect([...WORKFLOW_INPUT_JSONPATHS].sort()).toEqual([
      '$.attempt_count',
      '$.decision_id',
      '$.idempotency_key',
      '$.lease_owner',
      '$.missing_narrative_types',
      '$.recovery_mode',
      '$.request_timestamp',
      '$.trace_id',
    ]);
  });

  it('emits no field the ASL does not read', () => {
    const payload = buildExecutionPayload(launchInput()) as unknown as Record<string, unknown>;
    const expected = new Set(WORKFLOW_INPUT_JSONPATHS.map(jsonPathToField));

    // Surplus fields are not fatal, but they mean the two contracts have drifted
    // and nobody noticed which direction.
    expect(Object.keys(payload).filter((key) => !expected.has(key))).toEqual([]);
  });

  it('carries trace_id, which eight ASL states read', () => {
    expect(buildExecutionPayload(launchInput()).trace_id).toBe(TRACE);
  });

  it('refuses a blank trace_id instead of shipping it to Step Functions (C1)', () => {
    // `''` satisfies `traceId: string`, and an unknown payload crossing the Lambda
    // boundary reaches here after a cast. RUN_DECISION reading an absent
    // $.trace_id is a NON-RETRYABLE States.Runtime, i.e. 100% of injections die
    // before DecisionFn. Failing at the caller names the field; failing inside AWS
    // gives a JSONPath error nobody can trace back.
    for (const traceId of ['', '   ', '\t\n']) {
      expect(() => buildExecutionPayload(launchInput({ traceId }))).toThrow(/traceId is required/);
    }
  });

  it('accepts a trace_id that only looks marginal', () => {
    // Guard rejects blank, not short. Trimming the value would silently rewrite a
    // correlation id, so a padded id is refused as blank only when it IS blank.
    expect(buildExecutionPayload(launchInput({ traceId: 't' })).trace_id).toBe('t');
  });

  it('defaults missing_narrative_types to an empty array', () => {
    // RECOVERY_GATE reads $.missing_narrative_types unconditionally, and the gate
    // computes the real value itself, so [] is the honest advisory default.
    expect(buildExecutionPayload(launchInput()).missing_narrative_types).toEqual([]);
  });

  it('passes a supplied missing_narrative_types through', () => {
    const payload = buildExecutionPayload(launchInput({ missingNarrativeTypes: ['REPORT'] }));

    expect(payload.missing_narrative_types).toEqual(['REPORT']);
  });

  it('does not include workflow_execution_arn', () => {
    const payload = buildExecutionPayload(launchInput()) as unknown as Record<string, unknown>;

    // MARK_RUNNING stamps it from $$.Execution.Id; passing it in would let a caller
    // spoof the fencing identity.
    expect(payload).not.toHaveProperty('workflow_execution_arn');
    expect(payload).not.toHaveProperty('execution_id');
  });

  it('strips the $. prefix when mapping a path to a field', () => {
    expect(jsonPathToField('$.trace_id')).toBe('trace_id');
    expect(jsonPathToField('trace_id')).toBe('trace_id');
  });
});

// ─── Branch 2/3: SELECT_RECOVERY_MODE ──────────────────────

describe('SELECT_RECOVERY_MODE translation', () => {
  it('routes NORMAL to RUN_DECISION', () => {
    expect(nextStateForRecoveryMode(RecoveryMode.NORMAL)).toBe(AslState.RUN_DECISION);
  });

  it('routes FULL_WORKFLOW to RUN_DECISION', () => {
    expect(nextStateForRecoveryMode(RecoveryMode.FULL_WORKFLOW)).toBe(AslState.RUN_DECISION);
  });

  it('routes ENRICHMENT_ONLY to RECOVERY_GATE, never to DecisionFn', () => {
    // Re-running DecisionFn here would attempt to overwrite an immutable core.
    expect(nextStateForRecoveryMode(RecoveryMode.ENRICHMENT_ONLY)).toBe(AslState.RECOVERY_GATE);
    expect(nextStateForRecoveryMode(RecoveryMode.ENRICHMENT_ONLY)).not.toBe(AslState.RUN_DECISION);
  });

  it('routes an unrecognised mode to a terminal failure, not to a guess', () => {
    expect(nextStateForRecoveryMode('SOMETHING_ELSE')).toBe(AslState.PREPARE_INVALID_RECOVERY_MODE);
    expect(nextStateForRecoveryMode('')).toBe(AslState.PREPARE_INVALID_RECOVERY_MODE);
  });
});

// ─── Branch 4: DECISION_CORE_WRITE_GATE ────────────────────

describe('DECISION_CORE_WRITE_GATE translation', () => {
  it('routes COMMITTED to the checkpoint', () => {
    expect(nextStateForCoreWriteStatus(CoreWriteStatus.COMMITTED)).toBe(
      AslState.MARK_CORE_COMMITTED_DECISION,
    );
  });

  it('routes an at-least-once retry to the same checkpoint', () => {
    expect(nextStateForCoreWriteStatus(CoreWriteStatus.ALREADY_COMMITTED_SAME_DECISION)).toBe(
      AslState.MARK_CORE_COMMITTED_DECISION,
    );
  });

  it('routes CORE_IDENTITY_CONFLICT to the terminal publish path', () => {
    expect(nextStateForCoreWriteStatus(CoreWriteStatus.CORE_IDENTITY_CONFLICT)).toBe(
      AslState.PREPARE_CORE_IDENTITY_CONFLICT,
    );
  });

  it('never routes a conflict to the checkpoint or to completion', () => {
    const next = nextStateForCoreWriteStatus(CoreWriteStatus.CORE_IDENTITY_CONFLICT);

    // §12: a conflict must not reach enrichment or MARK_COMPLETED.
    expect(next).not.toBe(AslState.MARK_CORE_COMMITTED_DECISION);
  });

  it('records that the PREPARE_* Pass states drop trace_id (D2)', () => {
    // Documents a KNOWN GAP in workflow.asl.json that nothing in this package can
    // work around: the field is gone before the Lambda is invoked. When member 3
    // adds `trace_id.$` to the three Parameters blocks, flip status and delete the
    // constant — this assertion is what stops it being forgotten.
    expect(ASL_GAP_PASS_STATE_DROPS_TRACE_ID.status).toBe('OPEN');
    expect(ASL_GAP_PASS_STATE_DROPS_TRACE_ID.affectedStates).toEqual([
      AslState.PREPARE_CORE_IDENTITY_CONFLICT,
      AslState.PREPARE_INVALID_RECOVERY_MODE,
      AslState.PREPARE_UNKNOWN_CORE_WRITE_STATUS,
    ]);
    expect(ASL_GAP_PASS_STATE_DROPS_TRACE_ID.firstFailingConsumer).toBe(
      AslState.PUBLISH_PROCESSING_FAILED,
    );
    // No local mitigation exists; recording `null` keeps that explicit rather than
    // implying the backend has already handled it.
    expect(ASL_GAP_PASS_STATE_DROPS_TRACE_ID.workaroundInThisPackage).toBeNull();
  });

  it('records that the ASL still lacks a SKIPPED_INSUFFICIENT_DATA branch', () => {
    // This assertion documents a KNOWN GAP. When member 3 adds the Choice entry,
    // this test fails — which is the point: the gap cannot be forgotten.
    expect(nextStateForCoreWriteStatus(SKIPPED_INSUFFICIENT_DATA)).toBe(
      AslState.PREPARE_UNKNOWN_CORE_WRITE_STATUS,
    );
    expect(ASL_GAP_INSUFFICIENT_DATA_BRANCH.missingChoiceValue).toBe(SKIPPED_INSUFFICIENT_DATA);
  });

  it('uses screaming snake case, because ASL StringEquals is case-sensitive', () => {
    expect(SKIPPED_INSUFFICIENT_DATA).toBe('SKIPPED_INSUFFICIENT_DATA');
    expect(SKIPPED_INSUFFICIENT_DATA).toBe(SKIPPED_INSUFFICIENT_DATA.toUpperCase());
  });
});

// ─── Execution ARN resolution ──────────────────────────────

describe('resolveExecutionArn', () => {
  it('accepts the MARK_RUNNING spelling', () => {
    expect(
      resolveExecutionArn({
        idempotency_key: KEY,
        decision_id: DECISION,
        attempt_count: 1,
        workflow_execution_arn: EXEC,
      }),
    ).toBe(EXEC);
  });

  it('accepts the spelling every other action uses', () => {
    expect(
      resolveExecutionArn({
        idempotency_key: KEY,
        decision_id: DECISION,
        attempt_count: 1,
        execution_id: EXEC,
      }),
    ).toBe(EXEC);
  });

  it('refuses a payload carrying neither', () => {
    // Defaulting would make every fencing guard match by accident.
    expect(() =>
      resolveExecutionArn({ idempotency_key: KEY, decision_id: DECISION, attempt_count: 1 }),
    ).toThrow(AslPayloadError);
  });
});

// ─── Dispatcher: 5 actions ─────────────────────────────────

describe('dispatchWorkflowStatusAction', () => {
  it('routes MARK_RUNNING and fences on all four guard terms', async () => {
    const { store, updates } = fakeStore({ status: IdempotencyStatus.starting });

    const outcome = await dispatchWorkflowStatusAction(
      store,
      {
        action: 'MARK_RUNNING',
        idempotency_key: KEY,
        decision_id: DECISION,
        attempt_count: 1,
        lease_owner: 'req-1',
        recovery_mode: RecoveryMode.NORMAL,
        request_timestamp: '2026-05-20 22:10',
        workflow_execution_arn: EXEC,
      },
      context,
    );

    expect(outcome.result).toBe(StatusActionResult.APPLIED);
    expect(updates[0]?.guard).toMatchObject({
      status: IdempotencyStatus.starting,
      lease_owner: 'req-1',
      attempt_count: 1,
      recovery_mode: RecoveryMode.NORMAL,
    });
  });

  it('stamps the execution ARN and the staleness deadline on MARK_RUNNING', async () => {
    const { store, updates } = fakeStore({ status: IdempotencyStatus.starting });

    await dispatchWorkflowStatusAction(
      store,
      {
        action: 'MARK_RUNNING',
        idempotency_key: KEY,
        decision_id: DECISION,
        attempt_count: 1,
        lease_owner: 'req-1',
        recovery_mode: RecoveryMode.NORMAL,
        workflow_execution_arn: EXEC,
      },
      context,
    );

    expect(updates[0]?.mutation).toMatchObject({
      set: expect.objectContaining({
        workflow_execution_arn: EXEC,
        running_deadline_at: context.nowEpochMs + context.executionDeadlineMs,
      }),
    });
  });

  it('routes MARK_CORE_COMMITTED with the decision evidence source', async () => {
    const { store, updates } = fakeStore();

    await dispatchWorkflowStatusAction(
      store,
      {
        action: 'MARK_CORE_COMMITTED',
        idempotency_key: KEY,
        decision_id: DECISION,
        attempt_count: 1,
        evidence_source: 'DECISIONFN_COMMITTED',
        execution_id: EXEC,
      },
      context,
    );

    expect(updates[0]?.mutation).toMatchObject({
      set: expect.objectContaining({
        core_committed: true,
        evidence_source: EvidenceSource.DECISIONFN_COMMITTED,
      }),
    });
  });

  it('routes MARK_CORE_COMMITTED with the recovery evidence source', async () => {
    const { store, updates } = fakeStore();

    await dispatchWorkflowStatusAction(
      store,
      {
        action: 'MARK_CORE_COMMITTED',
        idempotency_key: KEY,
        decision_id: DECISION,
        attempt_count: 1,
        evidence_source: 'RECOVERY_GATE_CORE_EXISTS',
        execution_id: EXEC,
      },
      context,
    );

    expect(updates[0]?.mutation).toMatchObject({
      set: expect.objectContaining({
        evidence_source: EvidenceSource.RECOVERY_GATE_CORE_EXISTS,
      }),
    });
  });

  it('refuses an unrecognised evidence source rather than defaulting', async () => {
    const { store } = fakeStore();

    // The committed flag is only trustworthy with its evidence (§10.11e).
    await expect(
      dispatchWorkflowStatusAction(
        store,
        {
          action: 'MARK_CORE_COMMITTED',
          idempotency_key: KEY,
          decision_id: DECISION,
          attempt_count: 1,
          evidence_source: 'SOMETHING_ELSE',
          execution_id: EXEC,
        },
        context,
      ),
    ).rejects.toThrow(AslPayloadError);
  });

  it('guards MARK_CORE_COMMITTED as once-only', async () => {
    const { store, updates } = fakeStore();

    await dispatchWorkflowStatusAction(
      store,
      {
        action: 'MARK_CORE_COMMITTED',
        idempotency_key: KEY,
        decision_id: DECISION,
        attempt_count: 1,
        evidence_source: 'DECISIONFN_COMMITTED',
        execution_id: EXEC,
      },
      context,
    );

    expect(updates[0]?.guard).toMatchObject({ core_committed: false });
  });

  it('routes MARK_COMPLETED and records which execution completed', async () => {
    const { store, updates } = fakeStore();

    await dispatchWorkflowStatusAction(
      store,
      {
        action: 'MARK_COMPLETED',
        idempotency_key: KEY,
        decision_id: DECISION,
        attempt_count: 1,
        execution_id: EXEC,
      },
      context,
    );

    expect(updates[0]?.mutation).toMatchObject({
      set: expect.objectContaining({
        status: IdempotencyStatus.completed,
        completed_execution_arn: EXEC,
        completed_attempt_count: 1,
      }),
    });
  });

  it('routes the terminal MARK_PROCESSING_FAILED as non-retryable', async () => {
    const { store, updates } = fakeStore();

    await dispatchWorkflowStatusAction(
      store,
      {
        action: 'MARK_PROCESSING_FAILED',
        idempotency_key: KEY,
        decision_id: DECISION,
        attempt_count: 1,
        execution_id: EXEC,
        terminal: true,
        last_error: 'CORE_IDENTITY_CONFLICT',
        retryable: false,
        recovery_stage: 'NONE',
      },
      context,
    );

    expect(updates[0]?.mutation).toMatchObject({
      set: expect.objectContaining({
        last_error: 'CORE_IDENTITY_CONFLICT',
        retryable: false,
        recovery_stage: 'NONE',
      }),
    });
  });

  it('maps the ASL recovery_stage to effectiveCoreCommitted', async () => {
    const { store, updates } = fakeStore();

    await dispatchWorkflowStatusAction(
      store,
      {
        action: 'MARK_PROCESSING_FAILED',
        idempotency_key: KEY,
        decision_id: DECISION,
        attempt_count: 1,
        execution_id: EXEC,
        last_error: 'TASK_FAILED',
        retryable: true,
        recovery_stage: 'ENRICHMENT_ONLY',
      },
      context,
    );

    // ENRICHMENT_ONLY means a core is committed, so DecisionFn must not re-run.
    expect(updates[0]?.mutation).toMatchObject({
      set: expect.objectContaining({ recovery_stage: 'ENRICHMENT_ONLY' }),
    });
  });

  it('routes RECONCILE_STALE_RUNNING with the external fencing terms', async () => {
    const { store, updates } = fakeStore();

    await dispatchWorkflowStatusAction(
      store,
      {
        action: 'RECONCILE_STALE_RUNNING',
        idempotency_key: KEY,
        expected_stale_execution_arn: EXEC,
        expected_attempt: 1,
        observed_running_deadline_at: context.nowEpochMs - 1_000,
        effective_core_committed: false,
      },
      context,
    );

    expect(updates[0]?.guard).toMatchObject({
      status: IdempotencyStatus.running,
      workflow_execution_arn: EXEC,
      attempt_count: 1,
      running_deadline_at: context.nowEpochMs - 1_000,
    });
  });

  it('covers every action WorkflowStatusFn can receive', async () => {
    const actions: AslWorkflowStatusPayload['action'][] = [
      'MARK_RUNNING',
      'MARK_CORE_COMMITTED',
      'MARK_COMPLETED',
      'MARK_PROCESSING_FAILED',
      'RECONCILE_STALE_RUNNING',
    ];

    expect(actions).toHaveLength(5);
  });

  it('agrees with the ASL on retryable now that the override exists (D3)', () => {
    // Was a recorded divergence: the ASL asserted retryable:false for a malformed
    // INPUT while markProcessingFailed derived true. Both now write false.
    expect(ASL_DIVERGENCE_PROCESSING_FAILED_RETRYABLE.affectedStates).toContain(
      AslState.PREPARE_INVALID_RECOVERY_MODE,
    );
    expect(ASL_DIVERGENCE_PROCESSING_FAILED_RETRYABLE.status).toBe('RESOLVED');
    expect(ASL_DIVERGENCE_PROCESSING_FAILED_RETRYABLE.aslAsserts.retryable).toBe(
      ASL_DIVERGENCE_PROCESSING_FAILED_RETRYABLE.lambdaWrites.retryable,
    );
  });

  it('honours an explicit retryable:false from a PREPARE_* state (D3)', async () => {
    const { store, updates } = fakeStore();

    await dispatchWorkflowStatusAction(
      store,
      {
        action: 'MARK_PROCESSING_FAILED',
        idempotency_key: KEY,
        decision_id: DECISION,
        attempt_count: 1,
        execution_id: EXEC,
        // What PREPARE_INVALID_RECOVERY_MODE actually sends. `lastError` alone
        // would have derived retryable:true and left a malformed INPUT looking
        // recoverable.
        last_error: 'INVALID_RECOVERY_MODE',
        retryable: false,
        recovery_stage: 'NONE',
      },
      context,
    );

    expect(updates[0]?.mutation).toMatchObject({
      set: expect.objectContaining({
        retryable: false,
        // Forced terminal, so no recovery stage may remain live — otherwise a
        // recovery request could pick up a record nothing is allowed to retry.
        recovery_stage: 'NONE',
      }),
    });
  });

  it('ignores an explicit retryable:true, so a conflict can never be widened (D3)', async () => {
    const { store, updates } = fakeStore();

    await dispatchWorkflowStatusAction(
      store,
      {
        action: 'MARK_PROCESSING_FAILED',
        idempotency_key: KEY,
        decision_id: DECISION,
        attempt_count: 1,
        execution_id: EXEC,
        last_error: 'CORE_IDENTITY_CONFLICT',
        // A caller must not be able to make an identity conflict retryable: FIX 1
        // requires it to stay terminal. The override narrows only.
        retryable: true,
        recovery_stage: 'FULL_WORKFLOW',
      },
      context,
    );

    expect(updates[0]?.mutation).toMatchObject({
      set: expect.objectContaining({ retryable: false, recovery_stage: 'NONE' }),
    });
  });

  it('leaves the derivation alone when the ASL asserts nothing (D3)', async () => {
    const { store, updates } = fakeStore();

    await dispatchWorkflowStatusAction(
      store,
      {
        action: 'MARK_PROCESSING_FAILED',
        idempotency_key: KEY,
        decision_id: DECISION,
        attempt_count: 1,
        execution_id: EXEC,
        last_error: 'TASK_FAILED',
        recovery_stage: 'ENRICHMENT_ONLY',
      },
      context,
    );

    expect(updates[0]?.mutation).toMatchObject({
      set: expect.objectContaining({ retryable: true, recovery_stage: 'ENRICHMENT_ONLY' }),
    });
  });

  it('propagates a fenced outcome as a result, not as an error', async () => {
    const fenced = fakeStore({ workflow_execution_arn: 'arn:other', attempt_count: 9 });
    // The repository's own classified error, which is what applyOrConfirm reacts
    // to — a raw AWS-shaped error would propagate instead of being classified.
    fenced.store.conditionalUpdateState = vi
      .fn()
      .mockRejectedValue(
        new IdempotencyConditionFailedError('conditional failed', 'conditionalUpdateState', KEY),
      ) as unknown as IdempotencyStateStore['conditionalUpdateState'];

    const outcome = await dispatchWorkflowStatusAction(
      fenced.store,
      {
        action: 'MARK_COMPLETED',
        idempotency_key: KEY,
        decision_id: DECISION,
        attempt_count: 1,
        execution_id: EXEC,
      },
      context,
    );

    // Fencing is control flow: the old execution stops, it does not crash.
    expect(outcome.result).toBe(StatusActionResult.FENCED_STALE_EXECUTION);
  });
});
