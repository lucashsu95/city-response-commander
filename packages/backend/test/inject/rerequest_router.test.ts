/**
 * TASK-088 — same-key re-request routing unit tests.
 *
 * Covers all §12 status-matrix branches. The two invariants: a normal duplicate
 * never produces a 4xx/5xx, and a healthy in-flight execution is never disturbed.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  IdempotencyStatus,
  RecoveryMode,
  StatusActionResult,
} from '@city-commander/shared-schemas';
import type { IdempotencyRecord } from '@city-commander/shared-schemas';
import {
  isStartingLeaseExpired,
  isTerminalConflict,
  routeSameKeyRequest,
  CoreIdentityConflictError,
  IdempotencyConditionFailedError,
  IdempotencyRepositoryError,
  ProcessingFailure,
} from '../../src/index.js';
import type { RecoveryGateResult, RerequestRouterPorts } from '../../src/index.js';
import { record, DECISION, KEY, NOW_DISPLAY, NOW_MS } from '../workflow/status_fixtures.js';

const TRACE = 'trace-abc-123';
const STALE_EXEC = 'arn:aws:states:::execution:city-commander:exec-stale';

const routerInput = {
  idempotencyKey: KEY,
  leaseOwner: 'req-bbb',
  clock: { nowEpochMs: NOW_MS, nowDisplay: NOW_DISPLAY },
  leaseTtlMs: 30_000,
  traceId: TRACE,
};

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
    observed_running_deadline_at: NOW_MS - 5_000,
    ...overrides,
  };
}

interface Ports extends RerequestRouterPorts {
  readonly read: ReturnType<typeof vi.fn>;
  readonly update: ReturnType<typeof vi.fn>;
  readonly gate: ReturnType<typeof vi.fn>;
  readonly reconcile: ReturnType<typeof vi.fn>;
}

function createPorts(options?: {
  stored?: IdempotencyRecord | null;
  gate?: RecoveryGateResult;
  reconcileResult?: StatusActionResult;
  recovered?: IdempotencyRecord;
}): Ports {
  const read = vi.fn().mockResolvedValue(options?.stored ?? null);
  const update = vi
    .fn()
    .mockResolvedValue(
      options?.recovered ?? record({ status: IdempotencyStatus.starting, attempt_count: 3 }),
    );
  const gate = vi.fn().mockResolvedValue(options?.gate ?? gateResult());
  const reconcile = vi.fn().mockResolvedValue({
    result: options?.reconcileResult ?? StatusActionResult.APPLIED,
    record: record({
      status: IdempotencyStatus.processing_failed,
      last_error: ProcessingFailure.STALE_RUNNING_EXECUTION,
    }),
  });

  const repository = { conditionalUpdateState: update };

  return {
    read,
    update,
    gate,
    reconcile,
    idempotency: { getConsistent: read },
    repository,
    staleOrchestration: {
      invokeRecoveryGate: gate,
      invokeReconcileStaleRunning: reconcile,
      repository,
    },
  } as unknown as Ports;
}

// ─── Predicates ────────────────────────────────────────────

describe('isTerminalConflict', () => {
  it('is true for processing_failed with CORE_IDENTITY_CONFLICT', () => {
    expect(
      isTerminalConflict(
        record({
          status: IdempotencyStatus.processing_failed,
          last_error: ProcessingFailure.CORE_IDENTITY_CONFLICT,
          retryable: false,
        }),
      ),
    ).toBe(true);
  });

  it('is true whenever processing_failed carries retryable=false', () => {
    expect(
      isTerminalConflict(
        record({ status: IdempotencyStatus.processing_failed, last_error: 'X', retryable: false }),
      ),
    ).toBe(true);
  });

  it('is false for a recoverable processing_failed', () => {
    expect(
      isTerminalConflict(
        record({
          status: IdempotencyStatus.processing_failed,
          last_error: 'RENDERER_TIMEOUT',
          retryable: true,
        }),
      ),
    ).toBe(false);
  });

  it('is false for any other status', () => {
    expect(isTerminalConflict(record({ status: IdempotencyStatus.running }))).toBe(false);
  });
});

describe('isStartingLeaseExpired', () => {
  it('is true when the lease expiry is in the past', () => {
    expect(
      isStartingLeaseExpired(
        record({ status: IdempotencyStatus.starting, lease_expires_at: NOW_MS - 1 }),
        NOW_MS,
      ),
    ).toBe(true);
  });

  it('is false exactly at expiry (strict <)', () => {
    expect(
      isStartingLeaseExpired(
        record({ status: IdempotencyStatus.starting, lease_expires_at: NOW_MS }),
        NOW_MS,
      ),
    ).toBe(false);
  });

  it('is false when no expiry is recorded', () => {
    expect(
      isStartingLeaseExpired(
        record({ status: IdempotencyStatus.starting, lease_expires_at: null }),
        NOW_MS,
      ),
    ).toBe(false);
  });
});

// ─── 200 completed ─────────────────────────────────────────

describe('completed → 200', () => {
  it('answers 200 with the existing decision_id', async () => {
    const ports = createPorts({ stored: record({ status: IdempotencyStatus.completed }) });

    const route = await routeSameKeyRequest(ports, routerInput);

    expect(route.route).toBe('RESPOND_COMPLETED');
    if (route.route !== 'RESPOND_COMPLETED') throw new Error('unreachable');
    expect(route.httpStatus).toBe(200);
    expect(route.decisionId).toBe(DECISION);
  });

  it('is a distinct branch from the 202 in-progress path (§12)', async () => {
    const ports = createPorts({ stored: record({ status: IdempotencyStatus.completed }) });

    const route = await routeSameKeyRequest(ports, routerInput);

    expect(route.route).not.toBe('RESPOND_IN_PROGRESS');
    if (route.route !== 'RESPOND_COMPLETED') throw new Error('unreachable');
    expect(route.httpStatus).not.toBe(202);
  });

  it('never starts a second workflow', async () => {
    const ports = createPorts({ stored: record({ status: IdempotencyStatus.completed }) });

    await routeSameKeyRequest(ports, routerInput);

    expect(ports.update).not.toHaveBeenCalled();
    expect(ports.reconcile).not.toHaveBeenCalled();
  });
});

// ─── 202 in-progress ───────────────────────────────────────

describe('healthy in-flight → 202', () => {
  it('answers 202 for a running execution inside its deadline', async () => {
    const ports = createPorts({
      stored: record({ status: IdempotencyStatus.running, running_deadline_at: NOW_MS + 30_000 }),
    });

    const route = await routeSameKeyRequest(ports, routerInput);

    expect(route.route).toBe('RESPOND_IN_PROGRESS');
    if (route.route !== 'RESPOND_IN_PROGRESS') throw new Error('unreachable');
    expect(route.httpStatus).toBe(202);
    expect(route.status).toBe(IdempotencyStatus.running);
  });

  it('answers 202 for a starting record with a live lease', async () => {
    const ports = createPorts({
      stored: record({ status: IdempotencyStatus.starting, lease_expires_at: NOW_MS + 10_000 }),
    });

    const route = await routeSameKeyRequest(ports, routerInput);

    expect(route.route).toBe('RESPOND_IN_PROGRESS');
  });

  it('treats a running record with no deadline as in-flight, not stale', async () => {
    // MARK_RUNNING writes the deadline; its absence means registration is mid-flight.
    const ports = createPorts({
      stored: record({ status: IdempotencyStatus.running, running_deadline_at: null }),
    });

    const route = await routeSameKeyRequest(ports, routerInput);

    expect(route.route).toBe('RESPOND_IN_PROGRESS');
    expect(ports.reconcile).not.toHaveBeenCalled();
  });

  it('never disturbs a healthy in-flight execution', async () => {
    const ports = createPorts({
      stored: record({ status: IdempotencyStatus.running, running_deadline_at: NOW_MS + 1 }),
    });

    await routeSameKeyRequest(ports, routerInput);

    expect(ports.update).not.toHaveBeenCalled();
    expect(ports.gate).not.toHaveBeenCalled();
    expect(ports.reconcile).not.toHaveBeenCalled();
  });

  it('produces no 4xx/5xx for a normal duplicate request', async () => {
    for (const status of [IdempotencyStatus.starting, IdempotencyStatus.running]) {
      const ports = createPorts({
        stored: record({
          status,
          lease_expires_at: NOW_MS + 10_000,
          running_deadline_at: NOW_MS + 10_000,
        }),
      });

      const route = await routeSameKeyRequest(ports, routerInput);

      if (route.route !== 'RESPOND_IN_PROGRESS') throw new Error('unreachable');
      expect(route.httpStatus).toBeLessThan(400);
    }
  });
});

// ─── 409 terminal conflict ─────────────────────────────────

describe('terminal conflict → 409', () => {
  function conflicted(): IdempotencyRecord {
    return record({
      status: IdempotencyStatus.processing_failed,
      last_error: ProcessingFailure.CORE_IDENTITY_CONFLICT,
      retryable: false,
    });
  }

  it('answers 409 with a CoreIdentityConflictError', async () => {
    const ports = createPorts({ stored: conflicted() });

    const route = await routeSameKeyRequest(ports, routerInput);

    expect(route.route).toBe('RESPOND_TERMINAL_CONFLICT');
    if (route.route !== 'RESPOND_TERMINAL_CONFLICT') throw new Error('unreachable');
    expect(route.httpStatus).toBe(409);
    expect(route.error).toBeInstanceOf(CoreIdentityConflictError);
    expect(route.error.errorCode).toBe('CORE_IDENTITY_CONFLICT');
    expect(route.error.retryable).toBe(false);
    expect(route.error.traceId).toBe(TRACE);
  });

  it('is never 500 (§12: the conflict is always 409)', async () => {
    const ports = createPorts({ stored: conflicted() });

    const route = await routeSameKeyRequest(ports, routerInput);

    if (route.route !== 'RESPOND_TERMINAL_CONFLICT') throw new Error('unreachable');
    expect(route.error.httpStatus).toBe(409);
    expect(route.error.httpStatus).not.toBe(500);
  });

  it('never attempts recovery on a terminal conflict', async () => {
    const ports = createPorts({ stored: conflicted() });

    await routeSameKeyRequest(ports, routerInput);

    expect(ports.update).not.toHaveBeenCalled();
    expect(ports.gate).not.toHaveBeenCalled();
  });
});

// ─── Recovery transitions ──────────────────────────────────

describe('start_failed → recovery', () => {
  it('re-leases and asks the caller to retry StartExecution', async () => {
    const ports = createPorts({ stored: record({ status: IdempotencyStatus.start_failed }) });

    const route = await routeSameKeyRequest(ports, routerInput);

    expect(route.route).toBe('RECOVERED_RETRY_START');
    if (route.route !== 'RECOVERED_RETRY_START') throw new Error('unreachable');
    expect(route.recoveryMode).toBe(RecoveryMode.FULL_WORKFLOW);
  });

  it('does not consult the RecoveryGate (no workflow ran, so no core exists)', async () => {
    const ports = createPorts({ stored: record({ status: IdempotencyStatus.start_failed }) });

    await routeSameKeyRequest(ports, routerInput);

    expect(ports.gate).not.toHaveBeenCalled();
  });

  it('answers 202 when another request wins the recovery lease', async () => {
    const ports = createPorts({ stored: record({ status: IdempotencyStatus.start_failed }) });
    ports.update.mockRejectedValue(
      new IdempotencyConditionFailedError('guard', 'conditionalUpdateState', KEY),
    );

    const route = await routeSameKeyRequest(ports, routerInput);

    expect(route.route).toBe('RACE_LOST');
    if (route.route !== 'RACE_LOST') throw new Error('unreachable');
    expect(route.httpStatus).toBe(202);
  });
});

describe('expired starting lease → re-lease', () => {
  it('re-takes the lease when it has expired', async () => {
    const ports = createPorts({
      stored: record({ status: IdempotencyStatus.starting, lease_expires_at: NOW_MS - 1 }),
    });

    const route = await routeSameKeyRequest(ports, routerInput);

    expect(route.route).toBe('RECOVERED_RETRY_START');
    expect(ports.update).toHaveBeenCalledTimes(1);
  });
});

describe('processing_failed retryable → graded recovery', () => {
  function failed(): IdempotencyRecord {
    return record({
      status: IdempotencyStatus.processing_failed,
      last_error: 'RENDERER_TIMEOUT',
      retryable: true,
    });
  }

  it('grades FULL_WORKFLOW when no core is committed', async () => {
    const ports = createPorts({
      stored: failed(),
      gate: gateResult({ effective_core_committed: false }),
    });

    const route = await routeSameKeyRequest(ports, routerInput);

    if (route.route !== 'RECOVERED_RETRY_START') throw new Error('unreachable');
    expect(route.recoveryMode).toBe(RecoveryMode.FULL_WORKFLOW);
  });

  it('grades ENRICHMENT_ONLY when a core already exists', async () => {
    const ports = createPorts({
      stored: failed(),
      gate: gateResult({ core_exists: true, effective_core_committed: true }),
    });

    const route = await routeSameKeyRequest(ports, routerInput);

    if (route.route !== 'RECOVERED_RETRY_START') throw new Error('unreachable');
    expect(route.recoveryMode).toBe(RecoveryMode.ENRICHMENT_ONLY);
  });

  it('grades from the strongly-consistent gate, not from the failed record alone', async () => {
    const ports = createPorts({ stored: failed() });

    await routeSameKeyRequest(ports, routerInput);

    expect(ports.gate).toHaveBeenCalledWith({ idempotencyKey: KEY, decisionId: DECISION });
  });
});

describe('stale running → reconcile then recover', () => {
  function stale(): IdempotencyRecord {
    return record({
      status: IdempotencyStatus.running,
      workflow_execution_arn: STALE_EXEC,
      attempt_count: 2,
      running_deadline_at: NOW_MS - 5_000,
    });
  }

  it('reconciles and re-leases a stale running execution', async () => {
    const ports = createPorts({ stored: stale() });

    const route = await routeSameKeyRequest(ports, routerInput);

    expect(ports.gate).toHaveBeenCalledTimes(1);
    expect(ports.reconcile).toHaveBeenCalledTimes(1);
    expect(route.route).toBe('RECOVERED_RETRY_START');
  });

  it('answers 202 when reconciliation was fenced (the key moved on)', async () => {
    const ports = createPorts({
      stored: stale(),
      reconcileResult: StatusActionResult.FENCED_STALE_EXECUTION,
    });

    const route = await routeSameKeyRequest(ports, routerInput);

    expect(route.route).toBe('RACE_LOST');
    if (route.route !== 'RACE_LOST') throw new Error('unreachable');
    expect(route.httpStatus).toBe(202);
  });

  it('answers 202 when the fencing terms are no longer available', async () => {
    const ports = createPorts({
      stored: stale(),
      gate: gateResult({ expected_stale_execution_arn: null, observed_running_deadline_at: null }),
    });

    const route = await routeSameKeyRequest(ports, routerInput);

    expect(route.route).toBe('RACE_LOST');
    expect(ports.reconcile).not.toHaveBeenCalled();
  });

  it('never reports in-progress forever for a stuck running execution', async () => {
    const ports = createPorts({ stored: stale() });

    const route = await routeSameKeyRequest(ports, routerInput);

    // The stuck state is acted on, not echoed back as a healthy 202.
    expect(route.route).not.toBe('RESPOND_IN_PROGRESS');
  });
});

// ─── Absent key and faults ─────────────────────────────────

describe('absent key and faults', () => {
  it('reports KEY_ABSENT so the caller performs first-lease acquisition', async () => {
    const ports = createPorts({ stored: null });

    const route = await routeSameKeyRequest(ports, routerInput);

    expect(route.route).toBe('KEY_ABSENT');
    expect(ports.update).not.toHaveBeenCalled();
  });

  it('propagates a read fault instead of turning it into a routing decision', async () => {
    const ports = createPorts();
    const failure = new IdempotencyRepositoryError('throttled', 'getConsistent', KEY);
    ports.read.mockRejectedValue(failure);

    await expect(routeSameKeyRequest(ports, routerInput)).rejects.toBe(failure);
  });

  it('propagates a non-conditional write fault during recovery', async () => {
    const ports = createPorts({ stored: record({ status: IdempotencyStatus.start_failed }) });
    const failure = new IdempotencyRepositoryError('throttled', 'conditionalUpdateState', KEY);
    ports.update.mockRejectedValue(failure);

    await expect(routeSameKeyRequest(ports, routerInput)).rejects.toBe(failure);
  });
});
