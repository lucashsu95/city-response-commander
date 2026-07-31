/**
 * TASK-095 — applyOrConfirm unit tests.
 *
 * Verifies the three-way classification every fenced status action depends on:
 * APPLIED / ALREADY_APPLIED / FENCED_STALE_EXECUTION (design §10.11e, §15.2),
 * including the external-fencing variant for RECONCILE_STALE_RUNNING (FIX 3).
 *
 * The IdempotencyStateStore is a vi.fn() fake: no DynamoDB, no AWS.
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
  applyOrConfirm,
  mayProceed,
  isFenced,
  IdempotencyConditionFailedError,
  IdempotencyRepositoryError,
  IdempotencyUsageError,
} from '../../src/index.js';
import type { ApplyOrConfirmRequest, IdempotencyStateStore } from '../../src/index.js';

const KEY = 'TPE_2026_ACC_001|2026-05-20 22:10|policy-v1';
const EXEC = 'arn:aws:states:::execution:city-commander:exec-1';
const OTHER_EXEC = 'arn:aws:states:::execution:city-commander:exec-2';

/**
 * Intersection, not `extends`: the fake must stay assignable to the real port
 * while still exposing the vi.fn() mock surface.
 */
type FakeStore = IdempotencyStateStore & {
  readonly conditionalUpdateState: ReturnType<typeof vi.fn>;
  readonly getConsistent: ReturnType<typeof vi.fn>;
};

function createStore(): FakeStore {
  return {
    conditionalUpdateState: vi.fn(),
    getConsistent: vi.fn(),
  } as unknown as FakeStore;
}

function runningRecord(overrides: Partial<IdempotencyRecord> = {}): IdempotencyRecord {
  return {
    idempotency_key: KEY,
    decision_id: 'DEC_ACC_001',
    status: IdempotencyStatus.running,
    attempt_count: 1,
    lease_owner: 'req-aaa',
    lease_expires_at: 1_800_000_060_000,
    last_error: null,
    retryable: true,
    workflow_execution_arn: EXEC,
    running_started_at: 1_800_000_000_000,
    running_deadline_at: 1_800_000_030_000,
    completed_execution_arn: null,
    completed_attempt_count: null,
    last_transition_execution_arn: EXEC,
    last_transition_attempt_count: 1,
    evidence_source: null,
    core_committed: false,
    // NOTE: design §10.11e expects recovery_stage=NONE / recovery_mode=NORMAL here.
    // shared-schemas currently defines different members (pending member 1's fix),
    // so the fixture uses the values that exist today. applyOrConfirm never reads
    // these fields, so the classification logic is unaffected either way.
    recovery_stage: RecoveryStage.detect,
    recovery_mode: RecoveryMode.FIRST_RUN,
    previous_last_error: null,
    created_at: '2026-05-20 22:10',
    updated_at: '2026-05-20 22:10',
    expires_at: 1_800_086_400,
    ...overrides,
  };
}

function conditionFailed(): IdempotencyConditionFailedError {
  return new IdempotencyConditionFailedError('Guard not satisfied.', 'conditionalUpdateState', KEY);
}

/** MARK_CORE_COMMITTED request — the canonical in-workflow fenced action. */
function markCoreCommittedRequest(
  overrides: Partial<ApplyOrConfirmRequest> = {},
): ApplyOrConfirmRequest {
  return {
    idempotencyKey: KEY,
    action: 'MARK_CORE_COMMITTED',
    fencing: { executionArn: EXEC, attemptCount: 1 },
    guard: {
      status: IdempotencyStatus.running,
      workflow_execution_arn: EXEC,
      attempt_count: 1,
      core_committed: false,
    },
    mutation: { set: { core_committed: true } },
    confirmTargetReached: (record) => record.core_committed === true,
    ...overrides,
  };
}

describe('applyOrConfirm', () => {
  // ─── APPLIED ─────────────────────────────────────────────

  describe('APPLIED', () => {
    it('returns APPLIED with the updated record when the guard holds', async () => {
      const store = createStore();
      const updated = runningRecord({ core_committed: true });
      store.conditionalUpdateState.mockResolvedValue(updated);

      const outcome = await applyOrConfirm(store, markCoreCommittedRequest());

      expect(outcome.result).toBe(StatusActionResult.APPLIED);
      expect(outcome.record).toEqual(updated);
    });

    it('does not re-read when the update succeeds', async () => {
      const store = createStore();
      store.conditionalUpdateState.mockResolvedValue(runningRecord({ core_committed: true }));

      await applyOrConfirm(store, markCoreCommittedRequest());

      expect(store.conditionalUpdateState).toHaveBeenCalledTimes(1);
      expect(store.getConsistent).not.toHaveBeenCalled();
    });

    it('passes the guard and mutation through unchanged', async () => {
      const store = createStore();
      store.conditionalUpdateState.mockResolvedValue(runningRecord({ core_committed: true }));
      const request = markCoreCommittedRequest();

      await applyOrConfirm(store, request);

      expect(store.conditionalUpdateState).toHaveBeenCalledWith({
        idempotencyKey: KEY,
        guard: request.guard,
        mutation: request.mutation,
      });
    });
  });

  // ─── ALREADY_APPLIED ─────────────────────────────────────

  describe('ALREADY_APPLIED (lost response, same execution + attempt)', () => {
    it('confirms via a strongly-consistent re-read and continues', async () => {
      const store = createStore();
      store.conditionalUpdateState.mockRejectedValue(conditionFailed());
      const stored = runningRecord({ core_committed: true });
      store.getConsistent.mockResolvedValue(stored);

      const outcome = await applyOrConfirm(store, markCoreCommittedRequest());

      expect(outcome.result).toBe(StatusActionResult.ALREADY_APPLIED);
      expect(outcome.record).toEqual(stored);
      expect(store.getConsistent).toHaveBeenCalledTimes(1);
      expect(store.getConsistent).toHaveBeenCalledWith(KEY);
    });

    it('attempts the write exactly once (no retry loop)', async () => {
      const store = createStore();
      store.conditionalUpdateState.mockRejectedValue(conditionFailed());
      store.getConsistent.mockResolvedValue(runningRecord({ core_committed: true }));

      await applyOrConfirm(store, markCoreCommittedRequest());

      expect(store.conditionalUpdateState).toHaveBeenCalledTimes(1);
    });

    it('treats ALREADY_APPLIED as a proceed outcome', async () => {
      const store = createStore();
      store.conditionalUpdateState.mockRejectedValue(conditionFailed());
      store.getConsistent.mockResolvedValue(runningRecord({ core_committed: true }));

      const outcome = await applyOrConfirm(store, markCoreCommittedRequest());

      expect(mayProceed(outcome)).toBe(true);
      expect(isFenced(outcome)).toBe(false);
    });

    it('confirms MARK_RUNNING by status=running', async () => {
      const store = createStore();
      store.conditionalUpdateState.mockRejectedValue(conditionFailed());
      store.getConsistent.mockResolvedValue(runningRecord());

      const outcome = await applyOrConfirm(store, {
        idempotencyKey: KEY,
        action: 'MARK_RUNNING',
        fencing: { executionArn: EXEC, attemptCount: 1 },
        guard: {
          status: IdempotencyStatus.starting,
          lease_owner: 'req-aaa',
          attempt_count: 1,
        },
        mutation: { set: { status: IdempotencyStatus.running, workflow_execution_arn: EXEC } },
        confirmTargetReached: (record) => record.status === IdempotencyStatus.running,
      });

      expect(outcome.result).toBe(StatusActionResult.ALREADY_APPLIED);
    });

    it('confirms MARK_COMPLETED by completed_execution_arn + attempt', async () => {
      const store = createStore();
      store.conditionalUpdateState.mockRejectedValue(conditionFailed());
      store.getConsistent.mockResolvedValue(
        runningRecord({
          status: IdempotencyStatus.completed,
          completed_execution_arn: EXEC,
          completed_attempt_count: 1,
          lease_owner: null,
          running_deadline_at: null,
        }),
      );

      const outcome = await applyOrConfirm(store, {
        idempotencyKey: KEY,
        action: 'MARK_COMPLETED',
        fencing: { executionArn: EXEC, attemptCount: 1 },
        guard: {
          status: IdempotencyStatus.running,
          workflow_execution_arn: EXEC,
          attempt_count: 1,
        },
        mutation: { set: { status: IdempotencyStatus.completed } },
        confirmTargetReached: (record) =>
          record.status === IdempotencyStatus.completed &&
          record.completed_execution_arn === EXEC &&
          record.completed_attempt_count === 1,
      });

      expect(outcome.result).toBe(StatusActionResult.ALREADY_APPLIED);
    });

    it('confirms MARK_PROCESSING_FAILED by status + last_error', async () => {
      const store = createStore();
      store.conditionalUpdateState.mockRejectedValue(conditionFailed());
      store.getConsistent.mockResolvedValue(
        runningRecord({
          status: IdempotencyStatus.processing_failed,
          last_error: 'CORE_IDENTITY_CONFLICT',
          retryable: false,
        }),
      );

      const outcome = await applyOrConfirm(store, {
        idempotencyKey: KEY,
        action: 'MARK_PROCESSING_FAILED',
        fencing: { executionArn: EXEC, attemptCount: 1 },
        guard: {
          status: IdempotencyStatus.running,
          workflow_execution_arn: EXEC,
          attempt_count: 1,
        },
        mutation: { set: { status: IdempotencyStatus.processing_failed } },
        confirmTargetReached: (record) =>
          record.status === IdempotencyStatus.processing_failed &&
          record.last_error === 'CORE_IDENTITY_CONFLICT',
      });

      expect(outcome.result).toBe(StatusActionResult.ALREADY_APPLIED);
    });
  });

  // ─── FENCED_STALE_EXECUTION ──────────────────────────────

  describe('FENCED_STALE_EXECUTION', () => {
    it('fences when a different execution owns the record', async () => {
      const store = createStore();
      store.conditionalUpdateState.mockRejectedValue(conditionFailed());
      store.getConsistent.mockResolvedValue(
        runningRecord({ workflow_execution_arn: OTHER_EXEC, core_committed: true }),
      );

      const outcome = await applyOrConfirm(store, markCoreCommittedRequest());

      expect(outcome.result).toBe(StatusActionResult.FENCED_STALE_EXECUTION);
      expect(isFenced(outcome)).toBe(true);
      if (!isFenced(outcome)) throw new Error('unreachable');
      expect(outcome.reason).toBe('DIFFERENT_EXECUTION');
      expect(outcome.detail).toContain(OTHER_EXEC);
    });

    it('fences when a newer attempt owns the record', async () => {
      const store = createStore();
      store.conditionalUpdateState.mockRejectedValue(conditionFailed());
      store.getConsistent.mockResolvedValue(
        runningRecord({ attempt_count: 2, core_committed: true }),
      );

      const outcome = await applyOrConfirm(store, markCoreCommittedRequest());

      expect(outcome.result).toBe(StatusActionResult.FENCED_STALE_EXECUTION);
      if (!isFenced(outcome)) throw new Error('unreachable');
      expect(outcome.reason).toBe('DIFFERENT_ATTEMPT');
      expect(outcome.detail).toContain('attempt_count=2');
    });

    it('does not mistake a newer attempt of the SAME execution for success', async () => {
      const store = createStore();
      store.conditionalUpdateState.mockRejectedValue(conditionFailed());
      // Same execution ARN, but the key has moved on to attempt 3.
      store.getConsistent.mockResolvedValue(
        runningRecord({ attempt_count: 3, core_committed: true }),
      );

      const outcome = await applyOrConfirm(store, markCoreCommittedRequest());

      expect(outcome.result).toBe(StatusActionResult.FENCED_STALE_EXECUTION);
      expect(mayProceed(outcome)).toBe(false);
    });

    it('fences when the record no longer exists (fail-closed)', async () => {
      const store = createStore();
      store.conditionalUpdateState.mockRejectedValue(conditionFailed());
      store.getConsistent.mockResolvedValue(null);

      const outcome = await applyOrConfirm(store, markCoreCommittedRequest());

      expect(outcome.result).toBe(StatusActionResult.FENCED_STALE_EXECUTION);
      if (!isFenced(outcome)) throw new Error('unreachable');
      expect(outcome.reason).toBe('RECORD_MISSING');
      expect(outcome.record).toBeNull();
    });

    it('fences when the record is ours but the target was not reached', async () => {
      const store = createStore();
      store.conditionalUpdateState.mockRejectedValue(conditionFailed());
      // Ours, right attempt, but core_committed is still false: the guard failed
      // for another reason, so the transition is unverified.
      store.getConsistent.mockResolvedValue(runningRecord({ core_committed: false }));

      const outcome = await applyOrConfirm(store, markCoreCommittedRequest());

      expect(outcome.result).toBe(StatusActionResult.FENCED_STALE_EXECUTION);
      if (!isFenced(outcome)) throw new Error('unreachable');
      expect(outcome.reason).toBe('TARGET_NOT_REACHED');
    });

    it('performs no further writes once fenced', async () => {
      const store = createStore();
      store.conditionalUpdateState.mockRejectedValue(conditionFailed());
      store.getConsistent.mockResolvedValue(runningRecord({ workflow_execution_arn: OTHER_EXEC }));

      await applyOrConfirm(store, markCoreCommittedRequest());

      // One failed attempt, one confirm read, nothing else.
      expect(store.conditionalUpdateState).toHaveBeenCalledTimes(1);
      expect(store.getConsistent).toHaveBeenCalledTimes(1);
    });

    it('reports the action name in the fencing detail', async () => {
      const store = createStore();
      store.conditionalUpdateState.mockRejectedValue(conditionFailed());
      store.getConsistent.mockResolvedValue(runningRecord({ workflow_execution_arn: OTHER_EXEC }));

      const outcome = await applyOrConfirm(
        store,
        markCoreCommittedRequest({ action: 'MARK_COMPLETED' }),
      );

      if (!isFenced(outcome)) throw new Error('unreachable');
      expect(outcome.detail).toContain('MARK_COMPLETED');
    });
  });

  // ─── RECONCILE_STALE_RUNNING (FIX 3) ─────────────────────

  describe('RECONCILE_STALE_RUNNING external fencing (FIX 3)', () => {
    const STALE_EXEC = 'arn:aws:states:::execution:city-commander:exec-stale';

    /** InjectFn invokes this from outside the stale execution. */
    function reconcileRequest(
      overrides: Partial<ApplyOrConfirmRequest> = {},
    ): ApplyOrConfirmRequest {
      return {
        idempotencyKey: KEY,
        action: 'RECONCILE_STALE_RUNNING',
        // Fences on the EXPECTED STALE pair, never on the reconciler's own id.
        fencing: { executionArn: STALE_EXEC, attemptCount: 2 },
        guard: {
          status: IdempotencyStatus.running,
          workflow_execution_arn: STALE_EXEC,
          attempt_count: 2,
          running_deadline_at: 1_800_000_030_000,
          running_deadline_at_lt: 1_800_000_099_000,
        },
        mutation: {
          set: {
            status: IdempotencyStatus.processing_failed,
            last_error: 'STALE_RUNNING_EXECUTION',
            retryable: true,
          },
          remove: ['lease_owner', 'running_deadline_at'],
        },
        confirmTargetReached: (record) =>
          record.status === IdempotencyStatus.processing_failed &&
          record.last_error === 'STALE_RUNNING_EXECUTION',
        ...overrides,
      };
    }

    it('reconciles a stale running execution', async () => {
      const store = createStore();
      const reconciled = runningRecord({
        status: IdempotencyStatus.processing_failed,
        workflow_execution_arn: STALE_EXEC,
        attempt_count: 2,
        last_error: 'STALE_RUNNING_EXECUTION',
        retryable: true,
        lease_owner: null,
        running_deadline_at: null,
      });
      store.conditionalUpdateState.mockResolvedValue(reconciled);

      const outcome = await applyOrConfirm(store, reconcileRequest());

      expect(outcome.result).toBe(StatusActionResult.APPLIED);
      expect(outcome.record?.last_error).toBe('STALE_RUNNING_EXECUTION');
    });

    it('confirms against the expected stale pair, not the reconciler own id', async () => {
      const store = createStore();
      store.conditionalUpdateState.mockRejectedValue(conditionFailed());
      // A concurrent same-key request already reconciled it.
      store.getConsistent.mockResolvedValue(
        runningRecord({
          status: IdempotencyStatus.processing_failed,
          workflow_execution_arn: STALE_EXEC,
          attempt_count: 2,
          last_error: 'STALE_RUNNING_EXECUTION',
        }),
      );

      const outcome = await applyOrConfirm(store, reconcileRequest());

      expect(outcome.result).toBe(StatusActionResult.ALREADY_APPLIED);
    });

    it('fences when the key has already been re-leased to a newer attempt', async () => {
      const store = createStore();
      store.conditionalUpdateState.mockRejectedValue(conditionFailed());
      // Recovery already advanced the key to attempt 3 and a fresh execution.
      store.getConsistent.mockResolvedValue(
        runningRecord({
          status: IdempotencyStatus.running,
          workflow_execution_arn: EXEC,
          attempt_count: 3,
        }),
      );

      const outcome = await applyOrConfirm(store, reconcileRequest());

      expect(outcome.result).toBe(StatusActionResult.FENCED_STALE_EXECUTION);
      if (!isFenced(outcome)) throw new Error('unreachable');
      expect(outcome.reason).toBe('DIFFERENT_EXECUTION');
    });
  });

  // ─── Error propagation ───────────────────────────────────

  describe('non-conditional failures', () => {
    it('propagates a repository error without classifying it as fencing', async () => {
      const store = createStore();
      const failure = new IdempotencyRepositoryError(
        'Throughput exceeded',
        'conditionalUpdateState',
        KEY,
      );
      store.conditionalUpdateState.mockRejectedValue(failure);

      await expect(applyOrConfirm(store, markCoreCommittedRequest())).rejects.toBe(failure);
      expect(store.getConsistent).not.toHaveBeenCalled();
    });

    it('propagates an unknown error untouched', async () => {
      const store = createStore();
      const failure = new Error('socket hang up');
      store.conditionalUpdateState.mockRejectedValue(failure);

      await expect(applyOrConfirm(store, markCoreCommittedRequest())).rejects.toBe(failure);
      expect(store.getConsistent).not.toHaveBeenCalled();
    });

    it('propagates a failure raised by the confirm read (never assumes fenced)', async () => {
      const store = createStore();
      store.conditionalUpdateState.mockRejectedValue(conditionFailed());
      const readFailure = new IdempotencyRepositoryError(
        'Network unreachable',
        'getConsistent',
        KEY,
      );
      store.getConsistent.mockRejectedValue(readFailure);

      await expect(applyOrConfirm(store, markCoreCommittedRequest())).rejects.toBe(readFailure);
    });
  });

  // ─── Usage guards ────────────────────────────────────────

  describe('usage guards (rejected before touching the store)', () => {
    it('rejects an empty idempotencyKey', async () => {
      const store = createStore();

      await expect(
        applyOrConfirm(store, markCoreCommittedRequest({ idempotencyKey: '' })),
      ).rejects.toBeInstanceOf(IdempotencyUsageError);
      expect(store.conditionalUpdateState).not.toHaveBeenCalled();
    });

    it('rejects an empty fencing executionArn', async () => {
      const store = createStore();

      await expect(
        applyOrConfirm(
          store,
          markCoreCommittedRequest({ fencing: { executionArn: '', attemptCount: 1 } }),
        ),
      ).rejects.toBeInstanceOf(IdempotencyUsageError);
      expect(store.conditionalUpdateState).not.toHaveBeenCalled();
    });

    it('rejects attemptCount below 1', async () => {
      const store = createStore();

      await expect(
        applyOrConfirm(
          store,
          markCoreCommittedRequest({ fencing: { executionArn: EXEC, attemptCount: 0 } }),
        ),
      ).rejects.toBeInstanceOf(IdempotencyUsageError);
      expect(store.conditionalUpdateState).not.toHaveBeenCalled();
    });

    it('rejects a non-integer attemptCount', async () => {
      const store = createStore();

      await expect(
        applyOrConfirm(
          store,
          markCoreCommittedRequest({ fencing: { executionArn: EXEC, attemptCount: 1.5 } }),
        ),
      ).rejects.toBeInstanceOf(IdempotencyUsageError);
      expect(store.conditionalUpdateState).not.toHaveBeenCalled();
    });
  });

  // ─── Outcome narrowing helpers ───────────────────────────

  describe('mayProceed / isFenced', () => {
    it('treats APPLIED as proceed', async () => {
      const store = createStore();
      store.conditionalUpdateState.mockResolvedValue(runningRecord({ core_committed: true }));

      const outcome = await applyOrConfirm(store, markCoreCommittedRequest());

      expect(mayProceed(outcome)).toBe(true);
      expect(isFenced(outcome)).toBe(false);
    });

    it('treats FENCED_STALE_EXECUTION as stop', async () => {
      const store = createStore();
      store.conditionalUpdateState.mockRejectedValue(conditionFailed());
      store.getConsistent.mockResolvedValue(null);

      const outcome = await applyOrConfirm(store, markCoreCommittedRequest());

      expect(mayProceed(outcome)).toBe(false);
      expect(isFenced(outcome)).toBe(true);
    });
  });
});
