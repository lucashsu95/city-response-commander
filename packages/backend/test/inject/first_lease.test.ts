/**
 * TASK-086 — idempotency key derivation + first lease acquisition unit tests.
 *
 * Locks the §10.11e / §15.2 contract: the key is
 * `event_id|event_timestamp|policy_version`, `decision_id` is deterministically
 * derived from it, and the first conditional Put yields `status=starting`,
 * `attempt_count=1` — never `running`.
 */

import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { IdempotencyStatus, RecoveryMode, RecoveryStage } from '@city-commander/shared-schemas';
import type { IdempotencyRecord } from '@city-commander/shared-schemas';
import {
  acquireFirstLease,
  buildFirstLeaseRecord,
  deriveDecisionId,
  deriveIdempotencyKey,
  deriveInjectionIdentity,
  parseIdempotencyKey,
  IdempotencyKeyError,
  IdempotencyConditionFailedError,
  IdempotencyRepositoryError,
  IdempotencyUsageError,
} from '../../src/index.js';
import type { AcquireFirstLeaseInput, IdempotencyRepository } from '../../src/index.js';

const EVENT_ID = 'TPE_2026_ACC_001';
const EVENT_TIMESTAMP = '2026-05-20 22:10';
const POLICY_VERSION = 'prov-2026a';
const KEY = `${EVENT_ID}|${EVENT_TIMESTAMP}|${POLICY_VERSION}`;

const NOW_MS = 1_800_000_000_000;
const NOW_DISPLAY = '2026-05-20 22:11';
const LEASE_TTL_MS = 30_000;
const RECORD_TTL_MS = 86_400_000;

function leaseInput(overrides: Partial<AcquireFirstLeaseInput> = {}): AcquireFirstLeaseInput {
  return {
    keyParts: {
      eventId: EVENT_ID,
      eventTimestamp: EVENT_TIMESTAMP,
      policyVersion: POLICY_VERSION,
    },
    leaseOwner: 'req-aaa',
    clock: { nowEpochMs: NOW_MS, nowDisplay: NOW_DISPLAY },
    durations: { leaseTtlMs: LEASE_TTL_MS, recordTtlMs: RECORD_TTL_MS },
    // shared-schemas has no NORMAL / NONE member yet; design §15.2 expects those.
    recoveryMode: RecoveryMode.NORMAL,
    recoveryStage: RecoveryStage.NONE,
    ...overrides,
  };
}

type PutMock = ReturnType<typeof vi.fn>;

function createRepository(): {
  repo: Pick<IdempotencyRepository, 'conditionalPutNew'>;
  put: PutMock;
} {
  const put = vi.fn();
  return {
    repo: { conditionalPutNew: put } as unknown as Pick<IdempotencyRepository, 'conditionalPutNew'>,
    put,
  };
}

// ─── Key derivation ────────────────────────────────────────

describe('deriveIdempotencyKey', () => {
  it('joins the three parts with "|" in order', () => {
    expect(
      deriveIdempotencyKey({
        eventId: EVENT_ID,
        eventTimestamp: EVENT_TIMESTAMP,
        policyVersion: POLICY_VERSION,
      }),
    ).toBe(KEY);
  });

  it('uses the event timestamp verbatim (never normalized)', () => {
    // Slash format is what city_traffic_flow.csv / a raw incident may carry.
    const key = deriveIdempotencyKey({
      eventId: EVENT_ID,
      eventTimestamp: '2026/5/20 22:10',
      policyVersion: POLICY_VERSION,
    });

    expect(key).toContain('2026/5/20 22:10');
    expect(key).not.toContain('2026-05-20');
  });

  it('changes when the policy version changes', () => {
    const a = deriveIdempotencyKey({
      eventId: EVENT_ID,
      eventTimestamp: EVENT_TIMESTAMP,
      policyVersion: 'prov-2026a',
    });
    const b = deriveIdempotencyKey({
      eventId: EVENT_ID,
      eventTimestamp: EVENT_TIMESTAMP,
      policyVersion: 'prov-2026b',
    });

    expect(a).not.toBe(b);
  });

  it('changes when the event timestamp changes', () => {
    const a = deriveIdempotencyKey({
      eventId: EVENT_ID,
      eventTimestamp: '2026-05-20 22:10',
      policyVersion: POLICY_VERSION,
    });
    const b = deriveIdempotencyKey({
      eventId: EVENT_ID,
      eventTimestamp: '2026-05-20 22:20',
      policyVersion: POLICY_VERSION,
    });

    expect(a).not.toBe(b);
  });

  it('is stable across repeated derivations', () => {
    const parts = {
      eventId: EVENT_ID,
      eventTimestamp: EVENT_TIMESTAMP,
      policyVersion: POLICY_VERSION,
    };

    expect(deriveIdempotencyKey(parts)).toBe(deriveIdempotencyKey(parts));
  });

  it.each(['eventId', 'eventTimestamp', 'policyVersion'] as const)(
    'rejects an empty %s',
    (part) => {
      const parts = {
        eventId: EVENT_ID,
        eventTimestamp: EVENT_TIMESTAMP,
        policyVersion: POLICY_VERSION,
        [part]: '',
      };

      expect(() => deriveIdempotencyKey(parts)).toThrow(IdempotencyKeyError);
    },
  );

  it('rejects a part containing the separator (prevents key collisions)', () => {
    // Without this guard ("a|b","c",…) and ("a","b|c",…) would produce one key.
    expect(() =>
      deriveIdempotencyKey({
        eventId: 'TPE|2026',
        eventTimestamp: EVENT_TIMESTAMP,
        policyVersion: POLICY_VERSION,
      }),
    ).toThrow(IdempotencyKeyError);
  });

  it('reports which part was invalid', () => {
    const error = (() => {
      try {
        deriveIdempotencyKey({
          eventId: EVENT_ID,
          eventTimestamp: '',
          policyVersion: POLICY_VERSION,
        });
        return null;
      } catch (e: unknown) {
        return e as IdempotencyKeyError;
      }
    })();

    expect(error?.part).toBe('eventTimestamp');
  });
});

describe('parseIdempotencyKey', () => {
  it('round-trips a derived key', () => {
    expect(parseIdempotencyKey(KEY)).toEqual({
      eventId: EVENT_ID,
      eventTimestamp: EVENT_TIMESTAMP,
      policyVersion: POLICY_VERSION,
    });
  });

  it('returns null for a malformed key', () => {
    expect(parseIdempotencyKey('only-one-part')).toBeNull();
    expect(parseIdempotencyKey('a|b')).toBeNull();
    expect(parseIdempotencyKey('a|b|c|d')).toBeNull();
    expect(parseIdempotencyKey('a||c')).toBeNull();
  });
});

describe('deriveDecisionId', () => {
  it('is deterministic for the same key', () => {
    expect(deriveDecisionId(KEY)).toBe(deriveDecisionId(KEY));
  });

  it('embeds the event id for readability', () => {
    expect(deriveDecisionId(KEY)).toContain(EVENT_ID);
    expect(deriveDecisionId(KEY).startsWith('DEC_')).toBe(true);
  });

  it('uses the first 12 hex chars of SHA-256 over the full key', () => {
    const digest = createHash('sha256').update(KEY, 'utf8').digest('hex').slice(0, 12);

    expect(deriveDecisionId(KEY)).toBe(`DEC_${EVENT_ID}_${digest}`);
  });

  it('differs when only the policy version differs', () => {
    const a = deriveDecisionId(`${EVENT_ID}|${EVENT_TIMESTAMP}|prov-2026a`);
    const b = deriveDecisionId(`${EVENT_ID}|${EVENT_TIMESTAMP}|prov-2026b`);

    expect(a).not.toBe(b);
  });

  it('differs when only the timestamp differs', () => {
    const a = deriveDecisionId(`${EVENT_ID}|2026-05-20 22:10|${POLICY_VERSION}`);
    const b = deriveDecisionId(`${EVENT_ID}|2026-05-20 22:20|${POLICY_VERSION}`);

    expect(a).not.toBe(b);
  });

  it('rejects a malformed key', () => {
    expect(() => deriveDecisionId('not-a-triple')).toThrow(IdempotencyKeyError);
  });
});

describe('deriveInjectionIdentity', () => {
  it('returns a matching key and decision id', () => {
    const identity = deriveInjectionIdentity({
      eventId: EVENT_ID,
      eventTimestamp: EVENT_TIMESTAMP,
      policyVersion: POLICY_VERSION,
    });

    expect(identity.idempotencyKey).toBe(KEY);
    expect(identity.decisionId).toBe(deriveDecisionId(KEY));
  });
});

// ─── First lease record ────────────────────────────────────

describe('buildFirstLeaseRecord', () => {
  it('creates a starting record with attempt_count = 1', () => {
    const record = buildFirstLeaseRecord(leaseInput());

    expect(record.idempotency_key).toBe(KEY);
    expect(record.decision_id).toBe(deriveDecisionId(KEY));
    expect(record.status).toBe(IdempotencyStatus.starting);
    expect(record.attempt_count).toBe(1);
    expect(record.lease_owner).toBe('req-aaa');
  });

  it('never sets running (MARK_RUNNING owns that transition)', () => {
    const record = buildFirstLeaseRecord(leaseInput());

    expect(record.status).not.toBe(IdempotencyStatus.running);
    expect(record.workflow_execution_arn).toBeNull();
    expect(record.running_started_at).toBeNull();
    expect(record.running_deadline_at).toBeNull();
  });

  it('never sets core_committed (MARK_CORE_COMMITTED owns it, FIX 2)', () => {
    expect(buildFirstLeaseRecord(leaseInput()).core_committed).toBe(false);
    expect(buildFirstLeaseRecord(leaseInput()).evidence_source).toBeNull();
  });

  it('sets lease_expires_at from the injected clock', () => {
    const record = buildFirstLeaseRecord(leaseInput());

    expect(record.lease_expires_at).toBe(NOW_MS + LEASE_TTL_MS);
  });

  it('writes the DynamoDB TTL in epoch SECONDS, not milliseconds', () => {
    const record = buildFirstLeaseRecord(leaseInput());

    expect(record.expires_at).toBe(Math.floor((NOW_MS + RECORD_TTL_MS) / 1000));
    // A millisecond value here would make the item effectively never expire.
    expect(record.expires_at).toBeLessThan(NOW_MS);
  });

  it('stamps created_at and updated_at from the injected display time', () => {
    const record = buildFirstLeaseRecord(leaseInput());

    expect(record.created_at).toBe(NOW_DISPLAY);
    expect(record.updated_at).toBe(NOW_DISPLAY);
  });

  it('starts with no error and no completion metadata', () => {
    const record = buildFirstLeaseRecord(leaseInput());

    expect(record.last_error).toBeNull();
    expect(record.previous_last_error).toBeNull();
    expect(record.completed_execution_arn).toBeNull();
    expect(record.completed_attempt_count).toBeNull();
    expect(record.last_transition_execution_arn).toBeNull();
    expect(record.last_transition_attempt_count).toBeNull();
  });

  it('is byte-identical for identical inputs (deterministic)', () => {
    expect(buildFirstLeaseRecord(leaseInput())).toEqual(buildFirstLeaseRecord(leaseInput()));
  });

  it.each([
    ['empty leaseOwner', { leaseOwner: '' }],
    ['non-finite clock', { clock: { nowEpochMs: Number.NaN, nowDisplay: NOW_DISPLAY } }],
    ['empty nowDisplay', { clock: { nowEpochMs: NOW_MS, nowDisplay: '' } }],
    ['zero leaseTtlMs', { durations: { leaseTtlMs: 0, recordTtlMs: RECORD_TTL_MS } }],
    ['zero recordTtlMs', { durations: { leaseTtlMs: LEASE_TTL_MS, recordTtlMs: 0 } }],
  ] as const)('rejects %s', (_label, overrides) => {
    expect(() => buildFirstLeaseRecord(leaseInput(overrides))).toThrow(IdempotencyUsageError);
  });
});

// ─── acquireFirstLease ─────────────────────────────────────

describe('acquireFirstLease', () => {
  it('returns LEASE_ACQUIRED when the conditional Put succeeds', async () => {
    const { repo, put } = createRepository();
    put.mockImplementation(async (record: IdempotencyRecord) => record);

    const result = await acquireFirstLease(repo, leaseInput());

    expect(result.outcome).toBe('LEASE_ACQUIRED');
    expect(result.idempotencyKey).toBe(KEY);
    expect(result.decisionId).toBe(deriveDecisionId(KEY));
  });

  it('writes the starting record exactly once', async () => {
    const { repo, put } = createRepository();
    put.mockImplementation(async (record: IdempotencyRecord) => record);

    await acquireFirstLease(repo, leaseInput());

    expect(put).toHaveBeenCalledTimes(1);
    const written = put.mock.calls[0][0] as IdempotencyRecord;
    expect(written.status).toBe(IdempotencyStatus.starting);
    expect(written.attempt_count).toBe(1);
  });

  it('returns KEY_ALREADY_EXISTS on a duplicate key (not an error)', async () => {
    const { repo, put } = createRepository();
    put.mockRejectedValue(new IdempotencyConditionFailedError('exists', 'conditionalPutNew', KEY));

    const result = await acquireFirstLease(repo, leaseInput());

    expect(result.outcome).toBe('KEY_ALREADY_EXISTS');
    expect(result.idempotencyKey).toBe(KEY);
    // The decision id is still derivable, so the caller can read the existing record.
    expect(result.decisionId).toBe(deriveDecisionId(KEY));
  });

  it('gives the same decision id to the winner and the duplicate', async () => {
    const { repo: repoA, put: putA } = createRepository();
    putA.mockImplementation(async (record: IdempotencyRecord) => record);
    const { repo: repoB, put: putB } = createRepository();
    putB.mockRejectedValue(new IdempotencyConditionFailedError('exists', 'conditionalPutNew', KEY));

    const winner = await acquireFirstLease(repoA, leaseInput({ leaseOwner: 'req-aaa' }));
    const loser = await acquireFirstLease(repoB, leaseInput({ leaseOwner: 'req-bbb' }));

    expect(winner.decisionId).toBe(loser.decisionId);
  });

  it('propagates a non-conditional repository failure', async () => {
    const { repo, put } = createRepository();
    const failure = new IdempotencyRepositoryError('throttled', 'conditionalPutNew', KEY);
    put.mockRejectedValue(failure);

    await expect(acquireFirstLease(repo, leaseInput())).rejects.toBe(failure);
  });

  it('rejects an invalid key part before touching DynamoDB', async () => {
    const { repo, put } = createRepository();

    await expect(
      acquireFirstLease(
        repo,
        leaseInput({
          keyParts: {
            eventId: EVENT_ID,
            eventTimestamp: '',
            policyVersion: POLICY_VERSION,
          },
        }),
      ),
    ).rejects.toBeInstanceOf(IdempotencyKeyError);
    expect(put).not.toHaveBeenCalled();
  });

  it('does not call StartExecution (that is the lease holder step, TASK-087)', async () => {
    const { repo, put } = createRepository();
    put.mockImplementation(async (record: IdempotencyRecord) => record);

    await acquireFirstLease(repo, leaseInput());

    // The repository surface handed to this module has one method only.
    expect(Object.keys(repo)).toEqual(['conditionalPutNew']);
  });
});
