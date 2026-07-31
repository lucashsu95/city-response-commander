/**
 * TASK-092 — InjectFn stale-running orchestration unit tests.
 *
 * Verifies the §15.2 step E sequence: detect → RecoveryGateFn (read-only) →
 * RECONCILE_STALE_RUNNING (external fencing) → staged recovery, and that a stuck
 * `running` can never report in-progress forever.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  IdempotencyStatus,
  RecoveryMode,
  RecoveryStage,
  StatusActionResult,
} from '@city-commander/shared-schemas';
import type { IdempotencyRecord } from '@city-commander/shared-schemas';
import {
  isStaleRunning,
  orchestrateStaleRunning,
  ProcessingFailure,
  IdempotencyRepositoryError,
} from '../../src/index.js';
import type {
  RecoveryGateResult,
  ReconcileStaleRunningInput,
  StaleOrchestrationPorts,
} from '../../src/index.js';
import { record, DECISION, KEY, NOW_DISPLAY, NOW_MS } from '../workflow/status_fixtures.js';

const STALE_EXEC = 'arn:aws:states:::execution:city-commander:exec-stale';
const PAST_DEADLINE = NOW_MS - 5_000;

const lease = {
  idempotencyKey: KEY,
  newLeaseOwner: 'req-bbb',
  clock: { nowEpochMs: NOW_MS, nowDisplay: NOW_DISPLAY },
  leaseTtlMs: 30_000,
};

function staleRecord(overrides: Partial<IdempotencyRecord> = {}): IdempotencyRecord {
  return record({
    status: IdempotencyStatus.running,
    workflow_execution_arn: STALE_EXEC,
    attempt_count: 2,
    running_deadline_at: PAST_DEADLINE,
    ...overrides,
  });
}

function gateResult(overrides: Partial<RecoveryGateResult> = {}): RecoveryGateResult {
  return {
    idempotency_key: KEY,
    decision_id: DECISION,
    idempotency_record_exists: true,
    core_exists: false,
    idempotency_core_committed: false,
    effective_core_committed: false,
    existing_narrative_types: [],
    missing_narrative_types: [],
    recommended_recovery_mode: RecoveryMode.FULL_WORKFLOW,
    expected_stale_execution_arn: STALE_EXEC,
    expected_attempt: 2,
    observed_running_deadline_at: PAST_DEADLINE,
    ...overrides,
  };
}

interface Ports extends StaleOrchestrationPorts {
  readonly gate: ReturnType<typeof vi.fn>;
  readonly reconcile: ReturnType<typeof vi.fn>;
  readonly update: ReturnType<typeof vi.fn>;
}

function createPorts(options?: {
  gate?: RecoveryGateResult;
  reconcileResult?: StatusActionResult;
  recovered?: IdempotencyRecord;
}): Ports {
  const gate = vi.fn().mockResolvedValue(options?.gate ?? gateResult());
  const reconcile = vi.fn().mockResolvedValue({
    result: options?.reconcileResult ?? StatusActionResult.APPLIED,
    record: record({
      status: IdempotencyStatus.processing_failed,
      last_error: ProcessingFailure.STALE_RUNNING_EXECUTION,
    }),
    ...(options?.reconcileResult === StatusActionResult.FENCED_STALE_EXECUTION
      ? { reason: 'DIFFERENT_ATTEMPT', detail: 'fenced' }
      : {}),
  });
  const update = vi
    .fn()
    .mockResolvedValue(
      options?.recovered ?? record({ status: IdempotencyStatus.starting, attempt_count: 3 }),
    );

  return {
    gate,
    reconcile,
    update,
    invokeRecoveryGate: gate,
    invokeReconcileStaleRunning: reconcile,
    repository: { conditionalUpdateState: update },
  } as unknown as Ports;
}

// ─── isStaleRunning ────────────────────────────────────────

describe('isStaleRunning', () => {
  it('is true for a running record past its deadline', () => {
    expect(isStaleRunning(staleRecord(), NOW_MS)).toBe(true);
  });

  it('is false for a running record still inside its deadline', () => {
    expect(isStaleRunning(staleRecord({ running_deadline_at: NOW_MS + 1_000 }), NOW_MS)).toBe(
      false,
    );
  });

  it('is false exactly at the deadline (design uses a strict <)', () => {
    expect(isStaleRunning(staleRecord({ running_deadline_at: NOW_MS }), NOW_MS)).toBe(false);
  });

  it('is false when no deadline has been written yet (MARK_RUNNING pending)', () => {
    expect(isStaleRunning(staleRecord({ running_deadline_at: null }), NOW_MS)).toBe(false);
  });

  it.each([
    IdempotencyStatus.starting,
    IdempotencyStatus.completed,
    IdempotencyStatus.start_failed,
    IdempotencyStatus.processing_failed,
  ])('is false for status=%s', (status) => {
    expect(isStaleRunning(staleRecord({ status }), NOW_MS)).toBe(false);
  });
});

// ─── Orchestration ─────────────────────────────────────────

describe('orchestrateStaleRunning (TASK-092)', () => {
  it('short-circuits when the record is not stale', async () => {
    const ports = createPorts();

    const result = await orchestrateStaleRunning(ports, {
      record: staleRecord({ running_deadline_at: NOW_MS + 1_000 }),
      lease,
    });

    expect(result.outcome).toBe('NOT_STALE');
    expect(ports.gate).not.toHaveBeenCalled();
    expect(ports.reconcile).not.toHaveBeenCalled();
    expect(ports.update).not.toHaveBeenCalled();
  });

  it('calls the read-only RecoveryGate before reconciling', async () => {
    const ports = createPorts();

    await orchestrateStaleRunning(ports, { record: staleRecord(), lease });

    expect(ports.gate).toHaveBeenCalledWith({
      idempotencyKey: KEY,
      decisionId: DECISION,
    });
    expect(ports.gate.mock.invocationCallOrder[0]).toBeLessThan(
      ports.reconcile.mock.invocationCallOrder[0],
    );
  });

  it('passes the gate observations as external fencing terms (FIX 3)', async () => {
    const ports = createPorts();

    await orchestrateStaleRunning(ports, { record: staleRecord(), lease });

    const reconcileInput = ports.reconcile.mock.calls[0][0] as ReconcileStaleRunningInput;
    expect(reconcileInput).toMatchObject({
      idempotencyKey: KEY,
      expectedStaleExecutionArn: STALE_EXEC,
      expectedAttempt: 2,
      observedRunningDeadlineAt: PAST_DEADLINE,
      effectiveCoreCommitted: false,
      nowEpochMs: NOW_MS,
    });
  });

  it('recovers the lease after a successful reconciliation', async () => {
    const ports = createPorts();

    const result = await orchestrateStaleRunning(ports, { record: staleRecord(), lease });

    expect(result.outcome).toBe('RECOVERED');
    if (result.outcome !== 'RECOVERED') throw new Error('unreachable');
    expect(result.recoveryMode).toBe(RecoveryMode.FULL_WORKFLOW);
    expect(result.record.status).toBe(IdempotencyStatus.starting);
  });

  it('guards the recovery on the attempt the gate observed', async () => {
    const ports = createPorts();

    await orchestrateStaleRunning(ports, { record: staleRecord(), lease });

    const update = ports.update.mock.calls[0][0] as { guard: { attempt_count?: number } };
    expect(update.guard.attempt_count).toBe(2);
  });

  it('grades the recovery ENRICHMENT_ONLY when a core already exists', async () => {
    const ports = createPorts({
      gate: gateResult({
        core_exists: true,
        effective_core_committed: true,
        recommended_recovery_mode: RecoveryMode.ENRICHMENT_ONLY,
      }),
    });

    const result = await orchestrateStaleRunning(ports, { record: staleRecord(), lease });

    if (result.outcome !== 'RECOVERED') throw new Error('unreachable');
    expect(result.recoveryMode).toBe(RecoveryMode.ENRICHMENT_ONLY);
    const update = ports.update.mock.calls[0][0] as {
      mutation: { set?: { recovery_stage?: string } };
    };
    expect(update.mutation.set?.recovery_stage).toBe(RecoveryStage.ENRICHMENT_ONLY);
  });

  it('propagates the reconciled failure into previous_last_error', async () => {
    const ports = createPorts();

    await orchestrateStaleRunning(ports, { record: staleRecord(), lease });

    const update = ports.update.mock.calls[0][0] as {
      mutation: { set?: { previous_last_error?: string | null } };
    };
    expect(update.mutation.set?.previous_last_error).toBe(
      ProcessingFailure.STALE_RUNNING_EXECUTION,
    );
  });

  it('stops at RECONCILE_FENCED without attempting a recovery lease', async () => {
    const ports = createPorts({ reconcileResult: StatusActionResult.FENCED_STALE_EXECUTION });

    const result = await orchestrateStaleRunning(ports, { record: staleRecord(), lease });

    expect(result.outcome).toBe('RECONCILE_FENCED');
    expect(ports.update).not.toHaveBeenCalled();
  });

  it('treats ALREADY_APPLIED reconciliation as reconciled and continues', async () => {
    const ports = createPorts({ reconcileResult: StatusActionResult.ALREADY_APPLIED });

    const result = await orchestrateStaleRunning(ports, { record: staleRecord(), lease });

    expect(result.outcome).toBe('RECOVERED');
  });

  it('reports RACE_LOST when another request wins the recovery lease', async () => {
    const ports = createPorts();
    ports.update.mockRejectedValue(
      Object.assign(new Error('guard'), { name: 'ConditionalCheckFailedException' }),
    );

    // The repository surfaces a typed conditional failure; simulate it directly.
    const { IdempotencyConditionFailedError } = await import('../../src/index.js');
    ports.update.mockRejectedValue(
      new IdempotencyConditionFailedError('guard', 'conditionalUpdateState', KEY),
    );

    const result = await orchestrateStaleRunning(ports, { record: staleRecord(), lease });

    expect(result.outcome).toBe('RACE_LOST');
  });

  it('refuses to reconcile when the gate no longer sees the fencing terms', async () => {
    const ports = createPorts({
      gate: gateResult({
        expected_stale_execution_arn: null,
        observed_running_deadline_at: null,
      }),
    });

    const result = await orchestrateStaleRunning(ports, { record: staleRecord(), lease });

    expect(result.outcome).toBe('FENCING_TERMS_UNAVAILABLE');
    expect(ports.reconcile).not.toHaveBeenCalled();
    expect(ports.update).not.toHaveBeenCalled();
  });

  it('propagates a gate read failure instead of treating it as not-stale', async () => {
    const ports = createPorts();
    const failure = new IdempotencyRepositoryError('throttled', 'getConsistent', KEY);
    ports.gate.mockRejectedValue(failure);

    await expect(orchestrateStaleRunning(ports, { record: staleRecord(), lease })).rejects.toBe(
      failure,
    );
  });
});
