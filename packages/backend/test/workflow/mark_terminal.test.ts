/**
 * TASK-090 — MARK_COMPLETED / MARK_PROCESSING_FAILED unit tests.
 *
 * Covers the fenced terminal transitions, lease clearing, and the recovery
 * grading that decides whether `DecisionFn` may run again (§10.11e, §15.2, FIX 1).
 */

import { describe, it, expect } from 'vitest';
import {
  IdempotencyStatus,
  RecoveryStage,
  StatusActionResult,
} from '@city-commander/shared-schemas';
import {
  markCompleted,
  markProcessingFailed,
  ProcessingFailure,
  IdempotencyConditionFailedError,
} from '../../src/index.js';
import {
  createStore,
  record,
  statusContext,
  statusInput,
  updateOf,
  EXEC,
  KEY,
  NOW_MS,
  OTHER_EXEC,
} from './status_fixtures.js';

const guardFailure = (): IdempotencyConditionFailedError =>
  new IdempotencyConditionFailedError('guard', 'conditionalUpdateState', KEY);

describe('markCompleted (TASK-090)', () => {
  it('fences on execution ARN and attempt_count', async () => {
    const store = createStore();
    store.conditionalUpdateState.mockResolvedValue(record({ status: IdempotencyStatus.completed }));

    await markCompleted(store, statusInput, statusContext);

    expect(updateOf(store).guard).toEqual({
      status: IdempotencyStatus.running,
      workflow_execution_arn: EXEC,
      attempt_count: 1,
    });
  });

  it('writes the completion witnesses and clears the lease', async () => {
    const store = createStore();
    store.conditionalUpdateState.mockResolvedValue(record({ status: IdempotencyStatus.completed }));

    await markCompleted(store, statusInput, statusContext);

    const update = updateOf(store);
    expect(update.mutation.set).toMatchObject({
      status: IdempotencyStatus.completed,
      completed_execution_arn: EXEC,
      completed_attempt_count: 1,
      recovery_stage: RecoveryStage.NONE,
    });
    expect(update.mutation.remove).toEqual(['lease_owner', 'running_deadline_at']);
  });

  it('confirms ALREADY_APPLIED from the completion witnesses', async () => {
    const store = createStore();
    store.conditionalUpdateState.mockRejectedValue(guardFailure());
    store.getConsistent.mockResolvedValue(
      record({
        status: IdempotencyStatus.completed,
        completed_execution_arn: EXEC,
        completed_attempt_count: 1,
      }),
    );

    const outcome = await markCompleted(store, statusInput, statusContext);

    expect(outcome.result).toBe(StatusActionResult.ALREADY_APPLIED);
  });

  it('fences when a different execution completed the key', async () => {
    const store = createStore();
    store.conditionalUpdateState.mockRejectedValue(guardFailure());
    store.getConsistent.mockResolvedValue(
      record({
        status: IdempotencyStatus.completed,
        workflow_execution_arn: OTHER_EXEC,
        completed_execution_arn: OTHER_EXEC,
      }),
    );

    const outcome = await markCompleted(store, statusInput, statusContext);

    expect(outcome.result).toBe(StatusActionResult.FENCED_STALE_EXECUTION);
  });

  it('does not confirm a completed record that lacks the witnesses', async () => {
    const store = createStore();
    store.conditionalUpdateState.mockRejectedValue(guardFailure());
    store.getConsistent.mockResolvedValue(
      record({ status: IdempotencyStatus.completed, completed_execution_arn: null }),
    );

    const outcome = await markCompleted(store, statusInput, statusContext);

    expect(outcome.result).toBe(StatusActionResult.FENCED_STALE_EXECUTION);
  });
});

describe('markProcessingFailed (TASK-090)', () => {
  const failedContext = {
    ...statusContext,
    lastError: 'RENDERER_TIMEOUT',
    effectiveCoreCommitted: false,
  };

  function failed(overrides = {}) {
    return record({
      status: IdempotencyStatus.processing_failed,
      last_error: 'RENDERER_TIMEOUT',
      ...overrides,
    });
  }

  it('records the failure, expires the lease and clears the deadline', async () => {
    const store = createStore();
    store.conditionalUpdateState.mockResolvedValue(failed());

    await markProcessingFailed(store, statusInput, failedContext);

    const update = updateOf(store);
    expect(update.mutation.set).toMatchObject({
      status: IdempotencyStatus.processing_failed,
      last_error: 'RENDERER_TIMEOUT',
      retryable: true,
      // Expired immediately so a recovery request can compete right away.
      lease_expires_at: NOW_MS,
    });
    expect(update.mutation.remove).toEqual(['lease_owner', 'running_deadline_at']);
  });

  it('sets recovery_stage=FULL_WORKFLOW when no core is committed', async () => {
    const store = createStore();
    store.conditionalUpdateState.mockResolvedValue(failed());

    await markProcessingFailed(store, statusInput, {
      ...failedContext,
      effectiveCoreCommitted: false,
    });

    expect(updateOf(store).mutation.set?.recovery_stage).toBe(RecoveryStage.FULL_WORKFLOW);
  });

  it('sets recovery_stage=ENRICHMENT_ONLY when a core is committed', async () => {
    const store = createStore();
    store.conditionalUpdateState.mockResolvedValue(failed());

    await markProcessingFailed(store, statusInput, {
      ...failedContext,
      effectiveCoreCommitted: true,
    });

    expect(updateOf(store).mutation.set?.recovery_stage).toBe(RecoveryStage.ENRICHMENT_ONLY);
  });

  it('makes CORE_IDENTITY_CONFLICT terminal: retryable=false, recovery_stage=NONE', async () => {
    const store = createStore();
    store.conditionalUpdateState.mockResolvedValue(
      failed({ last_error: ProcessingFailure.CORE_IDENTITY_CONFLICT }),
    );

    await markProcessingFailed(store, statusInput, {
      ...statusContext,
      lastError: ProcessingFailure.CORE_IDENTITY_CONFLICT,
      // Even with a committed core, the conflict variant stays terminal.
      effectiveCoreCommitted: true,
    });

    expect(updateOf(store).mutation.set).toMatchObject({
      last_error: ProcessingFailure.CORE_IDENTITY_CONFLICT,
      retryable: false,
      recovery_stage: RecoveryStage.NONE,
    });
  });

  it('records RECOVERY_CORE_MISSING as recoverable with FULL_WORKFLOW', async () => {
    const store = createStore();
    store.conditionalUpdateState.mockResolvedValue(
      failed({ last_error: ProcessingFailure.RECOVERY_CORE_MISSING }),
    );

    await markProcessingFailed(store, statusInput, {
      ...statusContext,
      lastError: ProcessingFailure.RECOVERY_CORE_MISSING,
      effectiveCoreCommitted: false,
    });

    expect(updateOf(store).mutation.set).toMatchObject({
      retryable: true,
      recovery_stage: RecoveryStage.FULL_WORKFLOW,
    });
  });

  it('confirms ALREADY_APPLIED by status and last_error', async () => {
    const store = createStore();
    store.conditionalUpdateState.mockRejectedValue(guardFailure());
    store.getConsistent.mockResolvedValue(failed());

    const outcome = await markProcessingFailed(store, statusInput, failedContext);

    expect(outcome.result).toBe(StatusActionResult.ALREADY_APPLIED);
  });

  it('does not confirm when a different failure was recorded', async () => {
    const store = createStore();
    store.conditionalUpdateState.mockRejectedValue(guardFailure());
    store.getConsistent.mockResolvedValue(failed({ last_error: 'SOMETHING_ELSE' }));

    const outcome = await markProcessingFailed(store, statusInput, failedContext);

    expect(outcome.result).toBe(StatusActionResult.FENCED_STALE_EXECUTION);
  });
});
