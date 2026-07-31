/**
 * TASK-094 — staged recovery lease transition unit tests.
 *
 * Locks the §15.2 A–D contract: status always returns to `starting`,
 * `attempt_count` increments, the stale execution ARN is REMOVEd, the mode is
 * graded from `effective_core_committed`, and a terminal
 * `CORE_IDENTITY_CONFLICT` (`retryable=false`) can never be recovered.
 */

import { describe, it, expect, vi } from 'vitest';
import { IdempotencyStatus, RecoveryMode, RecoveryStage } from '@city-commander/shared-schemas';
import type { IdempotencyRecord } from '@city-commander/shared-schemas';
import {
  reacquireExpiredStartingLease,
  recoverFromProcessingFailed,
  recoverFromStartFailed,
  IdempotencyConditionFailedError,
  IdempotencyRepositoryError,
  IdempotencyUsageError,
} from '../../src/index.js';
import type {
  ConditionalUpdateStateInput,
  IdempotencyRepository,
  RecoveryLeaseInput,
} from '../../src/index.js';
import { record, KEY, NOW_DISPLAY, NOW_MS } from '../workflow/status_fixtures.js';

type UpdateMock = ReturnType<typeof vi.fn>;

function createRepository(): {
  repo: Pick<IdempotencyRepository, 'conditionalUpdateState'>;
  update: UpdateMock;
} {
  const update = vi.fn();
  return {
    repo: { conditionalUpdateState: update } as unknown as Pick<
      IdempotencyRepository,
      'conditionalUpdateState'
    >,
    update,
  };
}

function leaseInput(overrides: Partial<RecoveryLeaseInput> = {}): RecoveryLeaseInput {
  return {
    idempotencyKey: KEY,
    newLeaseOwner: 'req-bbb',
    currentAttemptCount: 1,
    previousLastError: 'RENDERER_TIMEOUT',
    clock: { nowEpochMs: NOW_MS, nowDisplay: NOW_DISPLAY },
    leaseTtlMs: 30_000,
    ...overrides,
  };
}

function updateOf(update: UpdateMock): ConditionalUpdateStateInput {
  return update.mock.calls[0][0] as ConditionalUpdateStateInput;
}

function recovered(overrides: Partial<IdempotencyRecord> = {}): IdempotencyRecord {
  return record({ status: IdempotencyStatus.starting, attempt_count: 2, ...overrides });
}

const guardFailure = (): IdempotencyConditionFailedError =>
  new IdempotencyConditionFailedError('guard', 'conditionalUpdateState', KEY);

// ─── Shared invariants ─────────────────────────────────────

describe('recovery transitions — shared invariants', () => {
  const transitions = [
    ['recoverFromStartFailed', recoverFromStartFailed],
    ['reacquireExpiredStartingLease', reacquireExpiredStartingLease],
  ] as const;

  it.each(transitions)('%s always sets status back to starting', async (_name, transition) => {
    const { repo, update } = createRepository();
    update.mockResolvedValue(recovered());

    await transition(repo, leaseInput());

    expect(updateOf(update).mutation.set?.status).toBe(IdempotencyStatus.starting);
  });

  it.each(transitions)('%s increments attempt_count', async (_name, transition) => {
    const { repo, update } = createRepository();
    update.mockResolvedValue(recovered());

    await transition(repo, leaseInput());

    expect(updateOf(update).mutation.incrementAttemptCount).toBe(1);
    expect(updateOf(update).mutation.set?.attempt_count).toBeUndefined();
  });

  it.each(transitions)('%s REMOVEs the stale execution metadata', async (_name, transition) => {
    const { repo, update } = createRepository();
    update.mockResolvedValue(recovered());

    await transition(repo, leaseInput());

    expect(updateOf(update).mutation.remove).toEqual([
      'workflow_execution_arn',
      'running_started_at',
      'running_deadline_at',
    ]);
  });

  it.each(transitions)('%s refreshes the lease for the new owner', async (_name, transition) => {
    const { repo, update } = createRepository();
    update.mockResolvedValue(recovered());

    await transition(repo, leaseInput());

    expect(updateOf(update).mutation.set).toMatchObject({
      lease_owner: 'req-bbb',
      lease_expires_at: NOW_MS + 30_000,
      updated_at: NOW_DISPLAY,
    });
  });

  it.each(transitions)('%s preserves the previous error for audit', async (_name, transition) => {
    const { repo, update } = createRepository();
    update.mockResolvedValue(recovered());

    await transition(repo, leaseInput({ previousLastError: 'STALE_RUNNING_EXECUTION' }));

    expect(updateOf(update).mutation.set).toMatchObject({
      previous_last_error: 'STALE_RUNNING_EXECUTION',
      last_error: null,
      retryable: true,
    });
  });

  it.each(transitions)('%s guards on the observed attempt_count', async (_name, transition) => {
    const { repo, update } = createRepository();
    update.mockResolvedValue(recovered());

    await transition(repo, leaseInput({ currentAttemptCount: 3 }));

    expect(updateOf(update).guard.attempt_count).toBe(3);
  });

  it.each(transitions)('%s returns RACE_LOST when the guard fails', async (_name, transition) => {
    const { repo, update } = createRepository();
    update.mockRejectedValue(guardFailure());

    expect((await transition(repo, leaseInput())).outcome).toBe('RACE_LOST');
  });

  it.each(transitions)('%s propagates a non-conditional failure', async (_name, transition) => {
    const { repo, update } = createRepository();
    const failure = new IdempotencyRepositoryError('throttled', 'conditionalUpdateState', KEY);
    update.mockRejectedValue(failure);

    await expect(transition(repo, leaseInput())).rejects.toBe(failure);
  });

  it.each([
    ['empty idempotencyKey', { idempotencyKey: '' }],
    ['empty newLeaseOwner', { newLeaseOwner: '' }],
    ['zero attempt', { currentAttemptCount: 0 }],
    ['non-integer attempt', { currentAttemptCount: 1.5 }],
    ['zero leaseTtlMs', { leaseTtlMs: 0 }],
  ] as const)('rejects %s before touching DynamoDB', async (_label, overrides) => {
    const { repo, update } = createRepository();

    await expect(recoverFromStartFailed(repo, leaseInput(overrides))).rejects.toBeInstanceOf(
      IdempotencyUsageError,
    );
    expect(update).not.toHaveBeenCalled();
  });
});

// ─── Step A: start_failed → starting ───────────────────────

describe('recoverFromStartFailed (step A)', () => {
  it('guards on start_failed', async () => {
    const { repo, update } = createRepository();
    update.mockResolvedValue(recovered());

    await recoverFromStartFailed(repo, leaseInput());

    expect(updateOf(update).guard.status).toBe(IdempotencyStatus.start_failed);
  });

  it('is always FULL_WORKFLOW (the workflow never ran, so no core exists)', async () => {
    const { repo, update } = createRepository();
    update.mockResolvedValue(recovered());

    const outcome = await recoverFromStartFailed(repo, leaseInput());

    expect(updateOf(update).mutation.set).toMatchObject({
      recovery_mode: RecoveryMode.FULL_WORKFLOW,
      recovery_stage: RecoveryStage.FULL_WORKFLOW,
    });
    if (outcome.outcome !== 'LEASE_ACQUIRED') throw new Error('unreachable');
    expect(outcome.recoveryMode).toBe(RecoveryMode.FULL_WORKFLOW);
  });
});

// ─── Steps B/C: processing_failed → starting ───────────────

describe('recoverFromProcessingFailed (steps B/C)', () => {
  it('guards on processing_failed AND retryable=true', async () => {
    const { repo, update } = createRepository();
    update.mockResolvedValue(recovered());

    await recoverFromProcessingFailed(repo, {
      ...leaseInput(),
      effectiveCoreCommitted: false,
    });

    expect(updateOf(update).guard).toMatchObject({
      status: IdempotencyStatus.processing_failed,
      retryable: true,
      attempt_count: 1,
    });
  });

  it('grades FULL_WORKFLOW when no core is committed', async () => {
    const { repo, update } = createRepository();
    update.mockResolvedValue(recovered());

    const outcome = await recoverFromProcessingFailed(repo, {
      ...leaseInput(),
      effectiveCoreCommitted: false,
    });

    expect(updateOf(update).mutation.set).toMatchObject({
      recovery_mode: RecoveryMode.FULL_WORKFLOW,
      recovery_stage: RecoveryStage.FULL_WORKFLOW,
    });
    if (outcome.outcome !== 'LEASE_ACQUIRED') throw new Error('unreachable');
    expect(outcome.recoveryMode).toBe(RecoveryMode.FULL_WORKFLOW);
  });

  it('grades ENRICHMENT_ONLY when a core is committed (never re-runs DecisionFn)', async () => {
    const { repo, update } = createRepository();
    update.mockResolvedValue(recovered());

    const outcome = await recoverFromProcessingFailed(repo, {
      ...leaseInput(),
      effectiveCoreCommitted: true,
    });

    expect(updateOf(update).mutation.set).toMatchObject({
      recovery_mode: RecoveryMode.ENRICHMENT_ONLY,
      recovery_stage: RecoveryStage.ENRICHMENT_ONLY,
    });
    if (outcome.outcome !== 'LEASE_ACQUIRED') throw new Error('unreachable');
    expect(outcome.recoveryMode).toBe(RecoveryMode.ENRICHMENT_ONLY);
  });

  it('cannot recover a terminal conflict: the retryable=true guard excludes it', async () => {
    const { repo, update } = createRepository();
    // DynamoDB rejects the condition because the record carries retryable=false.
    update.mockRejectedValue(guardFailure());

    const outcome = await recoverFromProcessingFailed(repo, {
      ...leaseInput({ previousLastError: 'CORE_IDENTITY_CONFLICT' }),
      effectiveCoreCommitted: true,
    });

    expect(outcome.outcome).toBe('RACE_LOST');
    expect(updateOf(update).guard.retryable).toBe(true);
  });
});

// ─── Step D: expired starting → starting ───────────────────

describe('reacquireExpiredStartingLease (step D)', () => {
  it('guards on starting AND an expired lease', async () => {
    const { repo, update } = createRepository();
    update.mockResolvedValue(recovered());

    await reacquireExpiredStartingLease(repo, leaseInput());

    expect(updateOf(update).guard).toMatchObject({
      status: IdempotencyStatus.starting,
      attempt_count: 1,
      lease_expires_at_lt: NOW_MS,
    });
  });

  it('never steals a live lease (the expiry comparison is part of the guard)', async () => {
    const { repo, update } = createRepository();
    update.mockRejectedValue(guardFailure());

    const outcome = await reacquireExpiredStartingLease(repo, leaseInput());

    expect(outcome.outcome).toBe('RACE_LOST');
    expect(updateOf(update).guard.lease_expires_at_lt).toBe(NOW_MS);
  });
});
