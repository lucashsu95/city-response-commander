/**
 * P33 — recovery, fencing and idempotency state consistency (TASK-098).
 *
 * Design §15.2 / §10.11e enumerate four ways an injection can go wrong:
 * `StartExecution` failure, a MARK_RUNNING registration race, lease expiry, and a
 * stale `running` execution past its deadline. All four must be recoverable
 * WITHOUT a stale execution ever being able to write. P33 is the property that
 * covers them together, rather than one hand-picked interleaving at a time.
 *
 * ## Why a property test rather than more examples
 *
 * `test/integration/recovery_fencing.test.ts` already pins the interleavings a
 * human thought of. The failure mode that matters here is the one nobody thought
 * of: some ordering of takeover, clock advance and transient fault that lets a
 * revived execution clear `core_committed`, or lets `attempt_count` go backwards
 * so an old execution's guard starts matching again. fast-check searches that
 * space and shrinks any counterexample to a minimal sequence.
 *
 * ## What is asserted after EVERY step
 *
 * | Invariant | Why it is the one that matters |
 * | --- | --- |
 * | `core_committed` never true → false | It gates the Fast Path push and ENRICHMENT_ONLY recovery. A regression re-runs DecisionFn against an immutable core. |
 * | `attempt_count` never decreases | It is half the fencing pair. If it goes backwards, a superseded execution's guard matches again. |
 * | `evidence_source` set whenever committed | §10.11e: the flag is only trustworthy with its evidence. |
 * | A non-authoritative actor changes nothing | The whole point of fencing. |
 *
 * The table underneath evaluates the repository's real `ConditionExpression`s, so
 * these hold against the guards that actually ship, not against a stub.
 */

import fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import { EvidenceSource, RecoveryMode, RecoveryStage } from '@city-commander/shared-schemas';
import {
  IdempotencyRepository,
  acquireFirstLease,
  markCoreCommitted,
  markRunning,
  reconcileStaleRunning,
  recoverFromProcessingFailed,
} from '../../src/index.js';
import type { IdempotencyKeyParts, WorkflowStatusInput } from '../../src/index.js';
import { InMemoryIdempotencyTable } from '../support/in_memory_idempotency_table.js';

const TABLE = 'IdempotencyTable-p33';
const KEY_PARTS: IdempotencyKeyParts = {
  eventId: 'TPE_2026_ACC_001',
  eventTimestamp: '2026-05-20 22:10',
  policyVersion: 'prov-2026a',
};
const KEY = 'TPE_2026_ACC_001|2026-05-20 22:10|prov-2026a';
const DECISION = 'DEC_P33';

const T0 = 1_800_000_000_000;
const LEASE_TTL_MS = 30_000;
const RECORD_TTL_MS = 86_400_000;
const EXECUTION_DEADLINE_MS = 60_000;

/** Minimum iterations required by the project test policy. */
const NUM_RUNS = 100;

// ─── Generated action language ─────────────────────────────

/**
 * `CURRENT` is whoever legitimately holds the lease; `STALE` is a pair that was
 * authoritative earlier and has since been superseded.
 */
type Actor = 'CURRENT' | 'STALE';

type Action =
  | { readonly kind: 'MARK_RUNNING'; readonly actor: Actor }
  | { readonly kind: 'MARK_CORE_COMMITTED'; readonly actor: Actor }
  | { readonly kind: 'TAKEOVER' }
  | { readonly kind: 'ADVANCE'; readonly ms: number };

const actorArb = fc.constantFrom<Actor>('CURRENT', 'STALE');

const actionArb: fc.Arbitrary<Action> = fc.oneof(
  fc.record({ kind: fc.constant('MARK_RUNNING' as const), actor: actorArb }),
  fc.record({ kind: fc.constant('MARK_CORE_COMMITTED' as const), actor: actorArb }),
  fc.record({ kind: fc.constant('TAKEOVER' as const) }),
  // Spans both sides of the 60 s execution deadline and the 30 s lease TTL, so
  // lease expiry and stale-running detection are both reachable.
  fc.record({
    kind: fc.constant('ADVANCE' as const),
    ms: fc.integer({ min: 0, max: 90_000 }),
  }),
);

// ─── Model ─────────────────────────────────────────────────

interface LeaseIdentity {
  readonly owner: string;
  readonly attempt: number;
  readonly arn: string;
}

/** Observations the invariants are checked against. */
interface Observation {
  readonly attemptCount: number;
  readonly coreCommitted: boolean;
  readonly evidenceSource: string | null;
  readonly completedExecutionArn: string | null;
  readonly serialized: string;
}

function observe(record: Record<string, unknown> | null): Observation {
  return {
    attemptCount: typeof record?.attempt_count === 'number' ? record.attempt_count : 0,
    coreCommitted: record?.core_committed === true,
    evidenceSource: typeof record?.evidence_source === 'string' ? record.evidence_source : null,
    completedExecutionArn:
      typeof record?.completed_execution_arn === 'string' ? record.completed_execution_arn : null,
    serialized: JSON.stringify(record),
  };
}

function statusInput(lease: LeaseIdentity, recoveryMode: RecoveryMode): WorkflowStatusInput {
  return {
    idempotencyKey: KEY,
    decisionId: DECISION,
    attemptCount: lease.attempt,
    leaseOwner: lease.owner,
    recoveryMode,
  };
}

/**
 * Drive one generated sequence and assert the invariants after every step.
 *
 * Every repository call is wrapped: an injected transient fault must leave the
 * invariants intact, which is the whole purpose of the failure-injection suite. A
 * thrown fault is a legitimate outcome, corrupted state is not.
 */
async function runSequence(
  actions: readonly Action[],
  options: { readonly injectFault?: (operation: 'put' | 'update' | 'get') => Error | null } = {},
): Promise<{ readonly table: InMemoryIdempotencyTable; readonly steps: number }> {
  const table = new InMemoryIdempotencyTable({
    tableName: TABLE,
    ...(options.injectFault === undefined ? {} : { injectFault: options.injectFault }),
  });
  const repository = new IdempotencyRepository({
    tableName: TABLE,
    documentClient: table.documentClient,
  });

  let now = T0;
  const clock = (): { nowEpochMs: number; nowDisplay: string } => ({
    nowEpochMs: now,
    nowDisplay: '2026-05-20 22:10',
  });

  // The first lease. A fault here simply means nothing was created; the sequence
  // still has to preserve the invariants, so it is not skipped.
  let current: LeaseIdentity = { owner: 'req-1', attempt: 1, arn: 'arn:exec-1' };
  let stale: LeaseIdentity = { owner: 'req-0', attempt: 1, arn: 'arn:exec-0' };
  let recoveryMode = RecoveryMode.NORMAL;
  let executionCounter = 1;

  try {
    await acquireFirstLease(repository, {
      keyParts: KEY_PARTS,
      leaseOwner: current.owner,
      clock: clock(),
      durations: { leaseTtlMs: LEASE_TTL_MS, recordTtlMs: RECORD_TTL_MS },
      recoveryMode: RecoveryMode.NORMAL,
      recoveryStage: RecoveryStage.NONE,
    });
  } catch {
    // Injected fault on the initial Put. Nothing committed; carry on.
  }

  let previous = observe(table.item(KEY));
  let steps = 0;

  for (const action of actions) {
    const actorLease = 'actor' in action && action.actor === 'STALE' ? stale : current;
    const isAuthoritative = !('actor' in action) || action.actor === 'CURRENT';

    try {
      switch (action.kind) {
        case 'ADVANCE':
          now += action.ms;
          break;

        case 'MARK_RUNNING':
          await markRunning(repository, statusInput(actorLease, recoveryMode), {
            executionArn: actorLease.arn,
            ...clock(),
            executionDeadlineMs: EXECUTION_DEADLINE_MS,
          });
          break;

        case 'MARK_CORE_COMMITTED':
          await markCoreCommitted(repository, statusInput(actorLease, recoveryMode), {
            executionArn: actorLease.arn,
            ...clock(),
            evidenceSource: EvidenceSource.DECISIONFN_COMMITTED,
          });
          break;

        case 'TAKEOVER': {
          // Reconcile the stale running execution, then re-lease. Both guarded, so
          // either can legitimately fail — the point is that neither may corrupt.
          const record = await repository.getConsistent(KEY);
          if (record !== null) {
            await reconcileStaleRunning(repository, {
              idempotencyKey: KEY,
              expectedStaleExecutionArn: record.workflow_execution_arn ?? current.arn,
              expectedAttempt: record.attempt_count,
              observedRunningDeadlineAt: record.running_deadline_at ?? now,
              effectiveCoreCommitted: record.core_committed,
              ...clock(),
            });
            const recovered = await recoverFromProcessingFailed(repository, {
              idempotencyKey: KEY,
              newLeaseOwner: `req-${String(executionCounter + 1)}`,
              currentAttemptCount: record.attempt_count,
              previousLastError: 'STALE_RUNNING_EXECUTION',
              clock: clock(),
              leaseTtlMs: LEASE_TTL_MS,
              effectiveCoreCommitted: record.core_committed,
            });
            if (recovered.outcome === 'LEASE_ACQUIRED') {
              executionCounter += 1;
              stale = current;
              current = {
                owner: `req-${String(executionCounter)}`,
                attempt: record.attempt_count + 1,
                arn: `arn:exec-${String(executionCounter)}`,
              };
              recoveryMode = recovered.recoveryMode;
            }
          }
          break;
        }
      }
    } catch {
      // A guarded write may reject and a fault may be injected. Both are allowed
      // outcomes; the invariants below are what must never break.
    }

    const observed = observe(table.item(KEY));

    // ── Invariant 1: core_committed is a latch, never cleared ──
    if (previous.coreCommitted) {
      expect(observed.coreCommitted).toBe(true);
    }

    // ── Invariant 2: attempt_count is monotonic non-decreasing ──
    expect(observed.attemptCount).toBeGreaterThanOrEqual(previous.attemptCount);

    // ── Invariant 3: the committed flag always carries its evidence ──
    if (observed.coreCommitted) {
      expect(observed.evidenceSource).not.toBeNull();
    }

    // ── Invariant 4: a terminal completion record is never rewritten ──
    if (previous.completedExecutionArn !== null) {
      expect(observed.completedExecutionArn).toBe(previous.completedExecutionArn);
    }

    // ── Invariant 5: a non-authoritative actor changes nothing ──
    if (!isAuthoritative && action.kind !== 'ADVANCE') {
      expect(observed.serialized).toBe(previous.serialized);
    }

    previous = observed;
    steps += 1;
  }

  return { table, steps };
}

// ─── Property: concurrency, lease expiry, takeover ─────────

describe('P33 — recovery fencing state consistency', () => {
  it('never lets any interleaving clear core_committed or rewind attempt_count', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(actionArb, { minLength: 1, maxLength: 14 }), async (actions) => {
        await runSequence(actions);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('holds when every action comes from a superseded execution', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(
          fc.oneof(
            fc.record({
              kind: fc.constant('MARK_RUNNING' as const),
              actor: fc.constant<Actor>('STALE'),
            }),
            fc.record({
              kind: fc.constant('MARK_CORE_COMMITTED' as const),
              actor: fc.constant<Actor>('STALE'),
            }),
            fc.record({
              kind: fc.constant('ADVANCE' as const),
              ms: fc.integer({ min: 0, max: 90_000 }),
            }),
          ),
          { minLength: 1, maxLength: 12 },
        ),
        async (actions) => {
          // A zombie execution replaying its whole sequence must be inert.
          await runSequence([{ kind: 'TAKEOVER' }, ...actions]);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('holds across repeated takeovers with arbitrary clock advances', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(fc.integer({ min: 0, max: 120_000 }), { minLength: 2, maxLength: 8 }),
        async (advances) => {
          const actions: Action[] = [];
          for (const ms of advances) {
            actions.push({ kind: 'MARK_RUNNING', actor: 'CURRENT' });
            actions.push({ kind: 'ADVANCE', ms });
            actions.push({ kind: 'TAKEOVER' });
          }
          await runSequence(actions);
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('keeps attempt_count strictly increasing across successful takeovers', async () => {
    await fc.assert(
      fc.asyncProperty(fc.integer({ min: 1, max: 5 }), async (takeovers) => {
        const actions: Action[] = [];
        for (let i = 0; i < takeovers; i += 1) {
          actions.push({ kind: 'MARK_RUNNING', actor: 'CURRENT' });
          actions.push({ kind: 'ADVANCE', ms: EXECUTION_DEADLINE_MS + 5_000 });
          actions.push({ kind: 'TAKEOVER' });
        }

        const { table } = await runSequence(actions);
        const record = table.item(KEY);

        // Each takeover must consume an attempt; reusing one would let the
        // superseded execution's guard match again.
        expect(record?.attempt_count).toBe(takeovers + 1);
      }),
      { numRuns: NUM_RUNS },
    );
  });
});

// ─── Failure injection suite ───────────────────────────────

describe('P33 — failure injection', () => {
  /** A retryable AWS-shaped transient fault. */
  function transient(): Error {
    return Object.assign(new Error('Rate exceeded'), {
      name: 'ProvisionedThroughputExceededException',
    });
  }

  it('preserves every invariant when the repository throws transient errors', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.array(actionArb, { minLength: 1, maxLength: 12 }),
        // One flag per command, consumed in order: a deterministic fault schedule
        // rather than randomness inside the run, so a counterexample replays.
        fc.array(fc.boolean(), { minLength: 1, maxLength: 40 }),
        async (actions, faultSchedule) => {
          let index = 0;
          await runSequence(actions, {
            injectFault: () => {
              const shouldFail = faultSchedule[index % faultSchedule.length] === true;
              index += 1;
              return shouldFail ? transient() : null;
            },
          });
        },
      ),
      { numRuns: NUM_RUNS },
    );
  });

  it('never commits a partial state when the write itself fails', async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(actionArb, { minLength: 1, maxLength: 10 }), async (actions) => {
        // Every mutating command fails; reads still work. The record must stay
        // exactly as the first lease left it — a failed conditional write must be
        // all-or-nothing.
        const { table } = await runSequence(actions, {
          injectFault: (operation) => (operation === 'get' ? null : transient()),
        });

        expect(table.item(KEY)).toBeNull();
        expect(table.injectedFaults).toBeGreaterThan(0);
      }),
      { numRuns: NUM_RUNS },
    );
  });

  it('reaches the guards at least sometimes, so the property is not vacuous', async () => {
    // A property test that never exercises a rejection would pass trivially.
    const { table } = await runSequence([
      { kind: 'MARK_RUNNING', actor: 'CURRENT' },
      { kind: 'MARK_RUNNING', actor: 'STALE' },
      { kind: 'ADVANCE', ms: EXECUTION_DEADLINE_MS + 1_000 },
      { kind: 'TAKEOVER' },
      { kind: 'MARK_CORE_COMMITTED', actor: 'STALE' },
    ]);

    expect(table.rejectedWrites).toBeGreaterThan(0);
    expect(table.conditionExpressions.length).toBeGreaterThan(3);
  });
});
