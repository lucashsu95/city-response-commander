/**
 * TASK-102 — MARK_CORE_COMMITTED unit tests.
 *
 * The checkpoint that gates `decision.fast_path_ready`. Verifies the four-part
 * guard (including `core_committed=false`), both evidence sources, once-only
 * semantics, and fencing (§10.11e, FIX 2).
 */

import { describe, it, expect } from 'vitest';
import {
  EvidenceSource,
  IdempotencyStatus,
  StatusActionResult,
} from '@city-commander/shared-schemas';
import { markCoreCommitted, isFenced, IdempotencyConditionFailedError } from '../../src/index.js';
import {
  createStore,
  record,
  statusContext,
  statusInput,
  updateOf,
  EXEC,
  KEY,
  NOW_DISPLAY,
  OTHER_EXEC,
} from './status_fixtures.js';

const guardFailure = (): IdempotencyConditionFailedError =>
  new IdempotencyConditionFailedError('guard', 'conditionalUpdateState', KEY);

const committedContext = {
  ...statusContext,
  evidenceSource: EvidenceSource.DECISIONFN_COMMITTED,
};

describe('markCoreCommitted (TASK-102)', () => {
  it('guards on running, execution ARN, attempt AND core_committed=false', async () => {
    const store = createStore();
    store.conditionalUpdateState.mockResolvedValue(record({ core_committed: true }));

    await markCoreCommitted(store, statusInput, committedContext);

    expect(updateOf(store).guard).toEqual({
      status: IdempotencyStatus.running,
      workflow_execution_arn: EXEC,
      attempt_count: 1,
      core_committed: false,
    });
  });

  it('sets core_committed with DECISIONFN_COMMITTED on the normal path', async () => {
    const store = createStore();
    store.conditionalUpdateState.mockResolvedValue(record({ core_committed: true }));

    await markCoreCommitted(store, statusInput, committedContext);

    expect(updateOf(store).mutation.set).toMatchObject({
      core_committed: true,
      evidence_source: EvidenceSource.DECISIONFN_COMMITTED,
      last_transition_execution_arn: EXEC,
      last_transition_attempt_count: 1,
      updated_at: NOW_DISPLAY,
    });
  });

  it('accepts RECOVERY_GATE_CORE_EXISTS for ENRICHMENT_ONLY recovery', async () => {
    const store = createStore();
    store.conditionalUpdateState.mockResolvedValue(record({ core_committed: true }));

    await markCoreCommitted(store, statusInput, {
      ...statusContext,
      evidenceSource: EvidenceSource.RECOVERY_GATE_CORE_EXISTS,
    });

    expect(updateOf(store).mutation.set?.evidence_source).toBe(
      EvidenceSource.RECOVERY_GATE_CORE_EXISTS,
    );
  });

  it('touches no other status field (it is a checkpoint, not a transition)', async () => {
    const store = createStore();
    store.conditionalUpdateState.mockResolvedValue(record({ core_committed: true }));

    await markCoreCommitted(store, statusInput, committedContext);

    const update = updateOf(store);
    expect(update.mutation.set?.status).toBeUndefined();
    expect(update.mutation.remove).toBeUndefined();
  });

  it('returns APPLIED so the Fast Path may push fast_path_ready', async () => {
    const store = createStore();
    store.conditionalUpdateState.mockResolvedValue(record({ core_committed: true }));

    const outcome = await markCoreCommitted(store, statusInput, committedContext);

    expect(outcome.result).toBe(StatusActionResult.APPLIED);
  });

  it('is once-only: a second call confirms ALREADY_APPLIED', async () => {
    const store = createStore();
    // The guard requires core_committed=false, so the flag is already set.
    store.conditionalUpdateState.mockRejectedValue(guardFailure());
    store.getConsistent.mockResolvedValue(record({ core_committed: true }));

    const outcome = await markCoreCommitted(store, statusInput, committedContext);

    expect(outcome.result).toBe(StatusActionResult.ALREADY_APPLIED);
  });

  it('fences a stale execution so it cannot announce the Fast Path', async () => {
    const store = createStore();
    store.conditionalUpdateState.mockRejectedValue(guardFailure());
    store.getConsistent.mockResolvedValue(
      record({ workflow_execution_arn: OTHER_EXEC, core_committed: true }),
    );

    const outcome = await markCoreCommitted(store, statusInput, committedContext);

    expect(outcome.result).toBe(StatusActionResult.FENCED_STALE_EXECUTION);
    if (!isFenced(outcome)) throw new Error('unreachable');
    expect(outcome.reason).toBe('DIFFERENT_EXECUTION');
  });

  it('does not report success when the flag was never set', async () => {
    const store = createStore();
    store.conditionalUpdateState.mockRejectedValue(guardFailure());
    // Ours, right attempt, but the flag is still false: the guard failed for
    // another reason (e.g. status moved on), so this must not gate the push.
    store.getConsistent.mockResolvedValue(record({ core_committed: false }));

    const outcome = await markCoreCommitted(store, statusInput, committedContext);

    if (!isFenced(outcome)) throw new Error('unreachable');
    expect(outcome.reason).toBe('TARGET_NOT_REACHED');
  });

  it('fences when a newer attempt owns the key', async () => {
    const store = createStore();
    store.conditionalUpdateState.mockRejectedValue(guardFailure());
    store.getConsistent.mockResolvedValue(record({ attempt_count: 2, core_committed: true }));

    const outcome = await markCoreCommitted(store, statusInput, committedContext);

    if (!isFenced(outcome)) throw new Error('unreachable');
    expect(outcome.reason).toBe('DIFFERENT_ATTEMPT');
  });
});
