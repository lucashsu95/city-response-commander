/**
 * TASK-089 — MARK_RUNNING unit tests.
 *
 * Exercised through the real `applyOrConfirm` against a fake store, so both the
 * four-part guard and the fencing classification are covered (§10.11e, PATCH 2).
 */

import { describe, it, expect } from 'vitest';
import {
  IdempotencyStatus,
  RecoveryMode,
  StatusActionResult,
} from '@city-commander/shared-schemas';
import { markRunning, isFenced, IdempotencyConditionFailedError } from '../../src/index.js';
import {
  createStore,
  record,
  statusContext,
  statusInput,
  updateOf,
  EXEC,
  KEY,
  NOW_DISPLAY,
  NOW_MS,
  OTHER_EXEC,
} from './status_fixtures.js';

const guardFailure = (): IdempotencyConditionFailedError =>
  new IdempotencyConditionFailedError('guard', 'conditionalUpdateState', KEY);

describe('markRunning (TASK-089)', () => {
  it('guards on status, lease_owner, attempt_count AND recovery_mode', async () => {
    const store = createStore();
    store.conditionalUpdateState.mockResolvedValue(record());

    await markRunning(store, statusInput, { ...statusContext, executionDeadlineMs: 60_000 });

    expect(updateOf(store).guard).toEqual({
      status: IdempotencyStatus.starting,
      lease_owner: 'req-aaa',
      attempt_count: 1,
      recovery_mode: RecoveryMode.NORMAL,
    });
  });

  it('writes running with the execution ARN and both running timestamps', async () => {
    const store = createStore();
    store.conditionalUpdateState.mockResolvedValue(record());

    await markRunning(store, statusInput, { ...statusContext, executionDeadlineMs: 60_000 });

    expect(updateOf(store).mutation.set).toMatchObject({
      status: IdempotencyStatus.running,
      workflow_execution_arn: EXEC,
      running_started_at: NOW_MS,
      running_deadline_at: NOW_MS + 60_000,
      last_transition_execution_arn: EXEC,
      last_transition_attempt_count: 1,
      updated_at: NOW_DISPLAY,
    });
  });

  it('derives running_deadline_at from the configured execution deadline', async () => {
    const store = createStore();
    store.conditionalUpdateState.mockResolvedValue(record());

    await markRunning(store, statusInput, { ...statusContext, executionDeadlineMs: 15_000 });

    expect(updateOf(store).mutation.set?.running_deadline_at).toBe(NOW_MS + 15_000);
  });

  it('is the only writer of starting → running (never writes it elsewhere)', async () => {
    const store = createStore();
    store.conditionalUpdateState.mockResolvedValue(record());

    await markRunning(store, statusInput, { ...statusContext, executionDeadlineMs: 60_000 });

    const update = updateOf(store);
    expect(update.guard.status).toBe(IdempotencyStatus.starting);
    expect(update.mutation.set?.status).toBe(IdempotencyStatus.running);
    expect(update.mutation.remove).toBeUndefined();
  });

  it('returns APPLIED on success', async () => {
    const store = createStore();
    store.conditionalUpdateState.mockResolvedValue(record());

    const outcome = await markRunning(store, statusInput, {
      ...statusContext,
      executionDeadlineMs: 60_000,
    });

    expect(outcome.result).toBe(StatusActionResult.APPLIED);
  });

  it('confirms ALREADY_APPLIED when already running for this execution', async () => {
    const store = createStore();
    store.conditionalUpdateState.mockRejectedValue(guardFailure());
    store.getConsistent.mockResolvedValue(record({ status: IdempotencyStatus.running }));

    const outcome = await markRunning(store, statusInput, {
      ...statusContext,
      executionDeadlineMs: 60_000,
    });

    expect(outcome.result).toBe(StatusActionResult.ALREADY_APPLIED);
  });

  it('fences a stale execution so it never enters DecisionFn', async () => {
    const store = createStore();
    store.conditionalUpdateState.mockRejectedValue(guardFailure());
    store.getConsistent.mockResolvedValue(record({ workflow_execution_arn: OTHER_EXEC }));

    const outcome = await markRunning(store, statusInput, {
      ...statusContext,
      executionDeadlineMs: 60_000,
    });

    expect(outcome.result).toBe(StatusActionResult.FENCED_STALE_EXECUTION);
    if (!isFenced(outcome)) throw new Error('unreachable');
    expect(outcome.reason).toBe('DIFFERENT_EXECUTION');
  });

  it('fences when a newer attempt owns the key', async () => {
    const store = createStore();
    store.conditionalUpdateState.mockRejectedValue(guardFailure());
    store.getConsistent.mockResolvedValue(record({ attempt_count: 2 }));

    const outcome = await markRunning(store, statusInput, {
      ...statusContext,
      executionDeadlineMs: 60_000,
    });

    if (!isFenced(outcome)) throw new Error('unreachable');
    expect(outcome.reason).toBe('DIFFERENT_ATTEMPT');
  });

  it('does not treat a still-starting record as applied', async () => {
    const store = createStore();
    store.conditionalUpdateState.mockRejectedValue(guardFailure());
    // Ours, right attempt, but never transitioned: must not report success.
    store.getConsistent.mockResolvedValue(record({ status: IdempotencyStatus.starting }));

    const outcome = await markRunning(store, statusInput, {
      ...statusContext,
      executionDeadlineMs: 60_000,
    });

    if (!isFenced(outcome)) throw new Error('unreachable');
    expect(outcome.reason).toBe('TARGET_NOT_REACHED');
  });
});
