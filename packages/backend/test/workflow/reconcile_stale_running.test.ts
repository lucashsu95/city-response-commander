/**
 * TASK-091 — RECONCILE_STALE_RUNNING unit tests (external fencing, FIX 3).
 *
 * The property that matters: this action fences on the EXPECTED STALE pair from
 * RecoveryGateFn, never on the reconciler's own execution id. Fencing on its own
 * id would never match, and a crashed execution would report in-progress forever.
 */

import { describe, it, expect } from 'vitest';
import {
  IdempotencyStatus,
  RecoveryStage,
  StatusActionResult,
} from '@city-commander/shared-schemas';
import type { IdempotencyRecord } from '@city-commander/shared-schemas';
import {
  reconcileStaleRunning,
  isFenced,
  ProcessingFailure,
  IdempotencyConditionFailedError,
} from '../../src/index.js';
import {
  createStore,
  record,
  updateOf,
  EXEC,
  KEY,
  NOW_DISPLAY,
  NOW_MS,
} from './status_fixtures.js';

const STALE_EXEC = 'arn:aws:states:::execution:city-commander:exec-stale';
const OBSERVED_DEADLINE = NOW_MS - 5_000;

const reconcileInput = {
  idempotencyKey: KEY,
  expectedStaleExecutionArn: STALE_EXEC,
  expectedAttempt: 2,
  observedRunningDeadlineAt: OBSERVED_DEADLINE,
  effectiveCoreCommitted: false,
  nowEpochMs: NOW_MS,
  nowDisplay: NOW_DISPLAY,
};

function reconciled(overrides: Partial<IdempotencyRecord> = {}): IdempotencyRecord {
  return record({
    status: IdempotencyStatus.processing_failed,
    workflow_execution_arn: STALE_EXEC,
    attempt_count: 2,
    last_error: ProcessingFailure.STALE_RUNNING_EXECUTION,
    ...overrides,
  });
}

const guardFailure = (): IdempotencyConditionFailedError =>
  new IdempotencyConditionFailedError('guard', 'conditionalUpdateState', KEY);

describe('reconcileStaleRunning (TASK-091, FIX 3)', () => {
  it('guards on the expected stale pair, not the reconciler own execution', async () => {
    const store = createStore();
    store.conditionalUpdateState.mockResolvedValue(reconciled());

    await reconcileStaleRunning(store, reconcileInput);

    const guard = updateOf(store).guard;
    expect(guard.workflow_execution_arn).toBe(STALE_EXEC);
    expect(guard.attempt_count).toBe(2);
    // The reconciler's own execution id must not appear anywhere in the guard.
    expect(Object.values(guard)).not.toContain(EXEC);
  });

  it('guards the deadline twice: equality and strictly-in-the-past', async () => {
    const store = createStore();
    store.conditionalUpdateState.mockResolvedValue(reconciled());

    await reconcileStaleRunning(store, reconcileInput);

    const guard = updateOf(store).guard;
    // Equality → nothing changed since RecoveryGateFn read it (no lost update).
    expect(guard.running_deadline_at).toBe(OBSERVED_DEADLINE);
    // Comparison → the execution really is past due.
    expect(guard.running_deadline_at_lt).toBe(NOW_MS);
  });

  it('only ever acts on a running record', async () => {
    const store = createStore();
    store.conditionalUpdateState.mockResolvedValue(reconciled());

    await reconcileStaleRunning(store, reconcileInput);

    expect(updateOf(store).guard.status).toBe(IdempotencyStatus.running);
  });

  it('writes STALE_RUNNING_EXECUTION as retryable', async () => {
    const store = createStore();
    store.conditionalUpdateState.mockResolvedValue(reconciled());

    await reconcileStaleRunning(store, reconcileInput);

    expect(updateOf(store).mutation.set).toMatchObject({
      status: IdempotencyStatus.processing_failed,
      last_error: ProcessingFailure.STALE_RUNNING_EXECUTION,
      retryable: true,
      lease_expires_at: NOW_MS,
    });
  });

  it('attributes the transition to the stale execution, not the caller', async () => {
    const store = createStore();
    store.conditionalUpdateState.mockResolvedValue(reconciled());

    await reconcileStaleRunning(store, reconcileInput);

    expect(updateOf(store).mutation.set).toMatchObject({
      last_transition_execution_arn: STALE_EXEC,
      last_transition_attempt_count: 2,
    });
  });

  it('grades recovery_stage from effective_core_committed', async () => {
    for (const [committed, expected] of [
      [false, RecoveryStage.FULL_WORKFLOW],
      [true, RecoveryStage.ENRICHMENT_ONLY],
    ] as const) {
      const store = createStore();
      store.conditionalUpdateState.mockResolvedValue(reconciled());

      await reconcileStaleRunning(store, { ...reconcileInput, effectiveCoreCommitted: committed });

      expect(updateOf(store).mutation.set?.recovery_stage).toBe(expected);
    }
  });

  it('clears the lease and the deadline', async () => {
    const store = createStore();
    store.conditionalUpdateState.mockResolvedValue(reconciled());

    await reconcileStaleRunning(store, reconcileInput);

    expect(updateOf(store).mutation.remove).toEqual(['lease_owner', 'running_deadline_at']);
  });

  it('returns APPLIED when it reconciles the stale execution', async () => {
    const store = createStore();
    store.conditionalUpdateState.mockResolvedValue(reconciled());

    const outcome = await reconcileStaleRunning(store, reconcileInput);

    expect(outcome.result).toBe(StatusActionResult.APPLIED);
  });

  it('returns ALREADY_APPLIED when another request reconciled the same stale pair', async () => {
    const store = createStore();
    store.conditionalUpdateState.mockRejectedValue(guardFailure());
    store.getConsistent.mockResolvedValue(reconciled());

    const outcome = await reconcileStaleRunning(store, reconcileInput);

    expect(outcome.result).toBe(StatusActionResult.ALREADY_APPLIED);
  });

  it('fences when the key has already been re-leased to a newer attempt', async () => {
    const store = createStore();
    store.conditionalUpdateState.mockRejectedValue(guardFailure());
    store.getConsistent.mockResolvedValue(
      record({ status: IdempotencyStatus.running, workflow_execution_arn: EXEC, attempt_count: 3 }),
    );

    const outcome = await reconcileStaleRunning(store, reconcileInput);

    expect(outcome.result).toBe(StatusActionResult.FENCED_STALE_EXECUTION);
    if (!isFenced(outcome)) throw new Error('unreachable');
    expect(outcome.reason).toBe('DIFFERENT_EXECUTION');
  });

  it('fences when the same stale execution advanced to a different attempt', async () => {
    const store = createStore();
    store.conditionalUpdateState.mockRejectedValue(guardFailure());
    store.getConsistent.mockResolvedValue(
      record({ workflow_execution_arn: STALE_EXEC, attempt_count: 5 }),
    );

    const outcome = await reconcileStaleRunning(store, reconcileInput);

    if (!isFenced(outcome)) throw new Error('unreachable');
    expect(outcome.reason).toBe('DIFFERENT_ATTEMPT');
  });
});
