/**
 * TASK-085 — IdempotencyRepository unit tests (mocked DynamoDB DocumentClient).
 *
 * Covers the three primitives plus the guard/mutation expression contract that
 * the lease state machine (§10.11e) and execution fencing depend on.
 * No AWS calls: the DocumentClient is injected as a vi.fn() stub.
 */

import { describe, it, expect, vi } from 'vitest';
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import type { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import {
  IdempotencyStatus,
  RecoveryStage,
  RecoveryMode,
  EvidenceSource,
} from '@city-commander/shared-schemas';
import type { IdempotencyRecord } from '@city-commander/shared-schemas';
import {
  IdempotencyRepository,
  createIdempotencyReader,
  IdempotencyRepositoryError,
  IdempotencyConditionFailedError,
  IdempotencyUsageError,
} from '../../src/repository/index.js';

const TABLE = 'city-commander-LOCAL_MOCK-IdempotencyTable';
const KEY = 'TPE_2026_ACC_001|2026-05-20 22:10|policy-v1';

type SendMock = ReturnType<typeof vi.fn>;

interface MockClient {
  readonly client: DynamoDBDocumentClient;
  readonly send: SendMock;
}

/** Creates a DocumentClient whose `send` is a vi.fn() stub. */
function createMockDocumentClient(): MockClient {
  const send = vi.fn();
  const client = { send } as unknown as DynamoDBDocumentClient;
  return { client, send };
}

function createRepository(): { repo: IdempotencyRepository; send: SendMock } {
  const { client, send } = createMockDocumentClient();
  const repo = new IdempotencyRepository({ tableName: TABLE, documentClient: client });
  return { repo, send };
}

/** A complete, valid IdempotencyRecord in the first-lease state. */
function startingRecord(overrides: Partial<IdempotencyRecord> = {}): IdempotencyRecord {
  return {
    idempotency_key: KEY,
    decision_id: 'DEC_ACC_001',
    status: IdempotencyStatus.starting,
    attempt_count: 1,
    lease_owner: 'req-aaa',
    lease_expires_at: 1_800_000_060_000,
    last_error: null,
    retryable: true,
    workflow_execution_arn: null,
    running_started_at: null,
    running_deadline_at: null,
    completed_execution_arn: null,
    completed_attempt_count: null,
    last_transition_execution_arn: null,
    last_transition_attempt_count: null,
    evidence_source: null,
    core_committed: false,
    recovery_stage: RecoveryStage.detect,
    recovery_mode: RecoveryMode.FIRST_RUN,
    previous_last_error: null,
    created_at: '2026-05-20 22:10',
    updated_at: '2026-05-20 22:10',
    expires_at: 1_800_086_400,
    ...overrides,
  };
}

/** The AWS-shaped conditional failure, as the real SDK throws it. */
function conditionalCheckFailed(): ConditionalCheckFailedException {
  return new ConditionalCheckFailedException({
    message: 'The conditional request failed',
    $metadata: { httpStatusCode: 400 },
  });
}

/** Reads the plain input object off the command passed to `send`. */
function inputOf(send: SendMock, callIndex = 0): Record<string, unknown> {
  return send.mock.calls[callIndex][0].input as Record<string, unknown>;
}

/** Resolves an expression's `#nX` placeholders back to attribute names. */
function resolveNames(expression: string, names: Record<string, string>): string {
  // Longest placeholder first, so #n1 never partially matches #n10.
  return Object.keys(names)
    .sort((a, b) => b.length - a.length)
    .reduce((acc, placeholder) => acc.split(placeholder).join(names[placeholder]), expression);
}

describe('IdempotencyRepository', () => {
  describe('construction', () => {
    it('rejects a missing table name (config must supply it)', () => {
      const { client } = createMockDocumentClient();
      expect(() => new IdempotencyRepository({ tableName: '', documentClient: client })).toThrow(
        IdempotencyUsageError,
      );
    });

    it('uses the injected DocumentClient without creating an AWS client', async () => {
      const { repo, send } = createRepository();
      send.mockResolvedValue({ Item: startingRecord() });

      await repo.getConsistent(KEY);

      expect(send).toHaveBeenCalledTimes(1);
    });
  });

  // ─── conditionalPutNew ───────────────────────────────────

  describe('conditionalPutNew', () => {
    it('writes the record with attribute_not_exists on the partition key', async () => {
      const { repo, send } = createRepository();
      send.mockResolvedValue({});
      const record = startingRecord();

      const result = await repo.conditionalPutNew(record);

      expect(result).toEqual(record);
      const input = inputOf(send);
      expect(input.TableName).toBe(TABLE);
      expect(input.Item).toEqual(record);
      expect(input.ConditionExpression).toBe('attribute_not_exists(#pk)');
      expect(input.ExpressionAttributeNames).toEqual({ '#pk': 'idempotency_key' });
    });

    it('uses the single-argument attribute_not_exists form only', async () => {
      const { repo, send } = createRepository();
      send.mockResolvedValue({});

      await repo.conditionalPutNew(startingRecord());

      // A two-argument attribute_not_exists(a, b) is invalid DynamoDB syntax.
      expect(inputOf(send).ConditionExpression).not.toMatch(/attribute_not_exists\([^)]*,/);
    });

    it('persists the first lease exactly as given (status=starting, attempt_count=1)', async () => {
      const { repo, send } = createRepository();
      send.mockResolvedValue({});

      await repo.conditionalPutNew(startingRecord());

      const item = inputOf(send).Item as IdempotencyRecord;
      expect(item.status).toBe(IdempotencyStatus.starting);
      expect(item.attempt_count).toBe(1);
      expect(item.core_committed).toBe(false);
      expect(item.workflow_execution_arn).toBeNull();
    });

    it('raises IdempotencyConditionFailedError when the key already exists', async () => {
      const { repo, send } = createRepository();
      send.mockRejectedValue(conditionalCheckFailed());

      await expect(repo.conditionalPutNew(startingRecord())).rejects.toBeInstanceOf(
        IdempotencyConditionFailedError,
      );
    });

    it('exposes operation, key and code on the duplicate-key error', async () => {
      const { repo, send } = createRepository();
      const cause = conditionalCheckFailed();
      send.mockRejectedValue(cause);

      const error = await repo.conditionalPutNew(startingRecord()).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(IdempotencyConditionFailedError);
      const failure = error as IdempotencyConditionFailedError;
      expect(failure.code).toBe('CONDITIONAL_CHECK_FAILED');
      expect(failure.operation).toBe('conditionalPutNew');
      expect(failure.idempotencyKey).toBe(KEY);
      expect(failure.cause).toBe(cause);
    });

    it('recognises a conditional failure identified by name alone', async () => {
      const { repo, send } = createRepository();
      send.mockRejectedValue(
        Object.assign(new Error('The conditional request failed'), {
          name: 'ConditionalCheckFailedException',
        }),
      );

      await expect(repo.conditionalPutNew(startingRecord())).rejects.toBeInstanceOf(
        IdempotencyConditionFailedError,
      );
    });

    it('wraps non-conditional failures as IdempotencyRepositoryError (fail-closed)', async () => {
      const { repo, send } = createRepository();
      send.mockRejectedValue(
        Object.assign(new Error('Throughput exceeded'), {
          name: 'ProvisionedThroughputExceededException',
        }),
      );

      const error = await repo.conditionalPutNew(startingRecord()).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(IdempotencyRepositoryError);
      expect(error).not.toBeInstanceOf(IdempotencyConditionFailedError);
      expect((error as Error).message).toContain('Throughput exceeded');
    });

    it('rejects an empty idempotency_key before calling DynamoDB', async () => {
      const { repo, send } = createRepository();

      await expect(
        repo.conditionalPutNew(startingRecord({ idempotency_key: '' })),
      ).rejects.toBeInstanceOf(IdempotencyUsageError);
      expect(send).not.toHaveBeenCalled();
    });
  });

  // ─── conditionalUpdateState ──────────────────────────────

  describe('conditionalUpdateState', () => {
    it('applies MARK_RUNNING with the four-part starting guard', async () => {
      const { repo, send } = createRepository();
      const updated = startingRecord({
        status: IdempotencyStatus.running,
        workflow_execution_arn: 'arn:exec:1',
        running_started_at: 1_800_000_000_000,
        running_deadline_at: 1_800_000_030_000,
      });
      send.mockResolvedValue({ Attributes: updated });

      const result = await repo.conditionalUpdateState({
        idempotencyKey: KEY,
        guard: {
          status: IdempotencyStatus.starting,
          lease_owner: 'req-aaa',
          attempt_count: 1,
          recovery_mode: RecoveryMode.FIRST_RUN,
        },
        mutation: {
          set: {
            status: IdempotencyStatus.running,
            workflow_execution_arn: 'arn:exec:1',
            running_started_at: 1_800_000_000_000,
            running_deadline_at: 1_800_000_030_000,
            last_transition_execution_arn: 'arn:exec:1',
            last_transition_attempt_count: 1,
            updated_at: '2026-05-20 22:10',
          },
        },
      });

      expect(result).toEqual(updated);

      const input = inputOf(send);
      const names = input.ExpressionAttributeNames as Record<string, string>;
      const condition = resolveNames(input.ConditionExpression as string, names);

      expect(input.TableName).toBe(TABLE);
      expect(input.Key).toEqual({ idempotency_key: KEY });
      expect(input.ReturnValues).toBe('ALL_NEW');
      expect(condition).toContain('attribute_exists(idempotency_key)');
      expect(condition).toContain('status = ');
      expect(condition).toContain('lease_owner = ');
      expect(condition).toContain('attempt_count = ');
      expect(condition).toContain('recovery_mode = ');
    });

    it('always requires attribute_exists so an Update can never upsert', async () => {
      const { repo, send } = createRepository();
      send.mockResolvedValue({ Attributes: startingRecord() });

      await repo.conditionalUpdateState({
        idempotencyKey: KEY,
        guard: { status: IdempotencyStatus.start_failed },
        mutation: { set: { status: IdempotencyStatus.starting } },
      });

      const input = inputOf(send);
      const names = input.ExpressionAttributeNames as Record<string, string>;
      expect(resolveNames(input.ConditionExpression as string, names)).toMatch(
        /^attribute_exists\(idempotency_key\) AND /,
      );
    });

    it('aliases every attribute name so reserved words like "status" are safe', async () => {
      const { repo, send } = createRepository();
      send.mockResolvedValue({ Attributes: startingRecord() });

      await repo.conditionalUpdateState({
        idempotencyKey: KEY,
        guard: { status: IdempotencyStatus.running },
        mutation: { set: { status: IdempotencyStatus.completed } },
      });

      const input = inputOf(send);
      expect(input.ConditionExpression).not.toContain('status');
      expect(input.UpdateExpression).not.toContain('status');
      expect(Object.values(input.ExpressionAttributeNames as Record<string, string>)).toContain(
        'status',
      );
    });

    it('fences MARK_CORE_COMMITTED on execution ARN, attempt and core_committed=false', async () => {
      const { repo, send } = createRepository();
      send.mockResolvedValue({
        Attributes: startingRecord({ status: IdempotencyStatus.running, core_committed: true }),
      });

      await repo.conditionalUpdateState({
        idempotencyKey: KEY,
        guard: {
          status: IdempotencyStatus.running,
          workflow_execution_arn: 'arn:exec:1',
          attempt_count: 1,
          core_committed: false,
        },
        mutation: {
          set: { core_committed: true, evidence_source: EvidenceSource.DECISIONFN_COMMITTED },
        },
      });

      const input = inputOf(send);
      const names = input.ExpressionAttributeNames as Record<string, string>;
      const condition = resolveNames(input.ConditionExpression as string, names);
      const values = input.ExpressionAttributeValues as Record<string, unknown>;

      expect(condition).toContain('workflow_execution_arn = ');
      expect(condition).toContain('core_committed = ');
      expect(Object.values(values)).toContain('arn:exec:1');
      expect(Object.values(values)).toContain(false);
    });

    it('builds the external fencing guard for RECONCILE_STALE_RUNNING (FIX 3)', async () => {
      const { repo, send } = createRepository();
      send.mockResolvedValue({
        Attributes: startingRecord({ status: IdempotencyStatus.processing_failed }),
      });

      await repo.conditionalUpdateState({
        idempotencyKey: KEY,
        guard: {
          status: IdempotencyStatus.running,
          workflow_execution_arn: 'arn:exec:stale',
          attempt_count: 2,
          running_deadline_at: 1_800_000_030_000,
          running_deadline_at_lt: 1_800_000_099_000,
        },
        mutation: {
          set: {
            status: IdempotencyStatus.processing_failed,
            last_error: 'STALE_RUNNING_EXECUTION',
            retryable: true,
            lease_expires_at: 1_800_000_099_000,
          },
          remove: ['lease_owner', 'running_deadline_at'],
        },
      });

      const input = inputOf(send);
      const names = input.ExpressionAttributeNames as Record<string, string>;
      const condition = resolveNames(input.ConditionExpression as string, names);
      const update = resolveNames(input.UpdateExpression as string, names);

      // Equality on the observed deadline AND proof that it is in the past.
      expect(condition).toContain('running_deadline_at = ');
      expect(condition).toContain('running_deadline_at < ');
      expect(update).toContain('REMOVE');
      expect(update).toContain('lease_owner');
      expect(update).toContain('running_deadline_at');
    });

    it('supports an expired-lease guard (lease_expires_at < now)', async () => {
      const { repo, send } = createRepository();
      send.mockResolvedValue({ Attributes: startingRecord({ attempt_count: 2 }) });

      await repo.conditionalUpdateState({
        idempotencyKey: KEY,
        guard: { status: IdempotencyStatus.starting, lease_expires_at_lt: 1_800_000_099_000 },
        mutation: { set: { lease_owner: 'req-bbb' }, incrementAttemptCount: 1 },
      });

      const input = inputOf(send);
      const names = input.ExpressionAttributeNames as Record<string, string>;
      expect(resolveNames(input.ConditionExpression as string, names)).toContain(
        'lease_expires_at < ',
      );
    });

    it('supports a retryable guard for processing_failed recovery', async () => {
      const { repo, send } = createRepository();
      send.mockResolvedValue({ Attributes: startingRecord() });

      await repo.conditionalUpdateState({
        idempotencyKey: KEY,
        guard: { status: IdempotencyStatus.processing_failed, retryable: true },
        mutation: { set: { status: IdempotencyStatus.starting } },
      });

      const input = inputOf(send);
      const names = input.ExpressionAttributeNames as Record<string, string>;
      expect(resolveNames(input.ConditionExpression as string, names)).toContain('retryable = ');
      expect(Object.values(input.ExpressionAttributeValues as Record<string, unknown>)).toContain(
        true,
      );
    });

    it('builds an IN condition for a multi-status guard', async () => {
      const { repo, send } = createRepository();
      send.mockResolvedValue({ Attributes: startingRecord() });

      await repo.conditionalUpdateState({
        idempotencyKey: KEY,
        guard: { status: [IdempotencyStatus.start_failed, IdempotencyStatus.processing_failed] },
        mutation: { set: { status: IdempotencyStatus.starting } },
      });

      const input = inputOf(send);
      const names = input.ExpressionAttributeNames as Record<string, string>;
      expect(resolveNames(input.ConditionExpression as string, names)).toMatch(
        /status IN \(:v\d+, :v\d+\)/,
      );
    });

    it('increments attempt_count in place for recovery re-lease', async () => {
      const { repo, send } = createRepository();
      send.mockResolvedValue({ Attributes: startingRecord({ attempt_count: 2 }) });

      const result = await repo.conditionalUpdateState({
        idempotencyKey: KEY,
        guard: { status: IdempotencyStatus.start_failed },
        mutation: {
          set: { status: IdempotencyStatus.starting, lease_owner: 'req-bbb' },
          remove: ['workflow_execution_arn'],
          incrementAttemptCount: 1,
        },
      });

      const input = inputOf(send);
      const names = input.ExpressionAttributeNames as Record<string, string>;
      const update = resolveNames(input.UpdateExpression as string, names);

      expect(update).toContain('attempt_count = attempt_count + ');
      expect(update).toContain('REMOVE');
      expect(result.attempt_count).toBe(2);
    });

    it('clears fields with REMOVE on MARK_COMPLETED', async () => {
      const { repo, send } = createRepository();
      send.mockResolvedValue({
        Attributes: startingRecord({ status: IdempotencyStatus.completed }),
      });

      await repo.conditionalUpdateState({
        idempotencyKey: KEY,
        guard: {
          status: IdempotencyStatus.running,
          workflow_execution_arn: 'arn:exec:1',
          attempt_count: 1,
        },
        mutation: {
          set: {
            status: IdempotencyStatus.completed,
            completed_execution_arn: 'arn:exec:1',
            completed_attempt_count: 1,
          },
          remove: ['lease_owner', 'running_deadline_at'],
        },
      });

      const input = inputOf(send);
      const names = input.ExpressionAttributeNames as Record<string, string>;
      const update = resolveNames(input.UpdateExpression as string, names);

      expect(update).toMatch(/^SET .* REMOVE /);
      expect(update).toContain('completed_execution_arn = ');
    });

    it('ignores undefined values in the set clause', async () => {
      const { repo, send } = createRepository();
      send.mockResolvedValue({ Attributes: startingRecord() });

      await repo.conditionalUpdateState({
        idempotencyKey: KEY,
        guard: { status: IdempotencyStatus.running },
        mutation: { set: { status: IdempotencyStatus.completed, last_error: undefined } },
      });

      const input = inputOf(send);
      const names = input.ExpressionAttributeNames as Record<string, string>;
      expect(resolveNames(input.UpdateExpression as string, names)).not.toContain('last_error');
    });

    it('raises IdempotencyConditionFailedError when the guard does not match', async () => {
      const { repo, send } = createRepository();
      send.mockRejectedValue(conditionalCheckFailed());

      const error = await repo
        .conditionalUpdateState({
          idempotencyKey: KEY,
          guard: {
            status: IdempotencyStatus.running,
            workflow_execution_arn: 'arn:exec:old',
            attempt_count: 1,
          },
          mutation: { set: { status: IdempotencyStatus.completed } },
        })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(IdempotencyConditionFailedError);
      expect((error as IdempotencyConditionFailedError).operation).toBe('conditionalUpdateState');
      // The message points the caller at apply-or-confirm rather than at a retry.
      expect((error as Error).message).toContain('apply-or-confirm');
    });

    it('never swallows a conditional failure into a false success', async () => {
      const { repo, send } = createRepository();
      send.mockRejectedValue(conditionalCheckFailed());

      await expect(
        repo.conditionalUpdateState({
          idempotencyKey: KEY,
          guard: { status: IdempotencyStatus.running },
          mutation: { set: { status: IdempotencyStatus.completed } },
        }),
      ).rejects.toThrow();
    });

    it('fails when DynamoDB returns no attributes (transition unconfirmable)', async () => {
      const { repo, send } = createRepository();
      send.mockResolvedValue({});

      const error = await repo
        .conditionalUpdateState({
          idempotencyKey: KEY,
          guard: { status: IdempotencyStatus.running },
          mutation: { set: { status: IdempotencyStatus.completed } },
        })
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(IdempotencyRepositoryError);
      expect(error).not.toBeInstanceOf(IdempotencyConditionFailedError);
    });

    describe('usage guards (rejected before any network call)', () => {
      it('rejects an unguarded update', async () => {
        const { repo, send } = createRepository();

        await expect(
          repo.conditionalUpdateState({
            idempotencyKey: KEY,
            guard: {},
            mutation: { set: { status: IdempotencyStatus.completed } },
          }),
        ).rejects.toBeInstanceOf(IdempotencyUsageError);
        expect(send).not.toHaveBeenCalled();
      });

      it('rejects an empty mutation', async () => {
        const { repo, send } = createRepository();

        await expect(
          repo.conditionalUpdateState({
            idempotencyKey: KEY,
            guard: { status: IdempotencyStatus.running },
            mutation: {},
          }),
        ).rejects.toBeInstanceOf(IdempotencyUsageError);
        expect(send).not.toHaveBeenCalled();
      });

      it('rejects writing the partition key', async () => {
        const { repo, send } = createRepository();

        await expect(
          repo.conditionalUpdateState({
            idempotencyKey: KEY,
            guard: { status: IdempotencyStatus.running },
            // Deliberately invalid: the PK is immutable.
            mutation: { set: { idempotency_key: 'other' } as Partial<IdempotencyRecord> },
          }),
        ).rejects.toBeInstanceOf(IdempotencyUsageError);
        expect(send).not.toHaveBeenCalled();
      });

      it('rejects a field that is both set and removed', async () => {
        const { repo, send } = createRepository();

        await expect(
          repo.conditionalUpdateState({
            idempotencyKey: KEY,
            guard: { status: IdempotencyStatus.running },
            mutation: { set: { lease_owner: 'req-bbb' }, remove: ['lease_owner'] },
          }),
        ).rejects.toBeInstanceOf(IdempotencyUsageError);
        expect(send).not.toHaveBeenCalled();
      });

      it('rejects setting and incrementing attempt_count together', async () => {
        const { repo, send } = createRepository();

        await expect(
          repo.conditionalUpdateState({
            idempotencyKey: KEY,
            guard: { status: IdempotencyStatus.start_failed },
            mutation: { set: { attempt_count: 3 }, incrementAttemptCount: 1 },
          }),
        ).rejects.toBeInstanceOf(IdempotencyUsageError);
        expect(send).not.toHaveBeenCalled();
      });

      it('rejects an empty status array guard', async () => {
        const { repo, send } = createRepository();

        await expect(
          repo.conditionalUpdateState({
            idempotencyKey: KEY,
            guard: { status: [] },
            mutation: { set: { status: IdempotencyStatus.starting } },
          }),
        ).rejects.toBeInstanceOf(IdempotencyUsageError);
        expect(send).not.toHaveBeenCalled();
      });

      it('rejects an empty idempotencyKey', async () => {
        const { repo, send } = createRepository();

        await expect(
          repo.conditionalUpdateState({
            idempotencyKey: '',
            guard: { status: IdempotencyStatus.running },
            mutation: { set: { status: IdempotencyStatus.completed } },
          }),
        ).rejects.toBeInstanceOf(IdempotencyUsageError);
        expect(send).not.toHaveBeenCalled();
      });
    });
  });

  // ─── getConsistent ───────────────────────────────────────

  describe('getConsistent', () => {
    it('reads with ConsistentRead: true', async () => {
      const { repo, send } = createRepository();
      send.mockResolvedValue({ Item: startingRecord() });

      await repo.getConsistent(KEY);

      const input = inputOf(send);
      expect(input.ConsistentRead).toBe(true);
      expect(input.TableName).toBe(TABLE);
      expect(input.Key).toEqual({ idempotency_key: KEY });
    });

    it('returns the stored record', async () => {
      const { repo, send } = createRepository();
      const record = startingRecord({
        status: IdempotencyStatus.running,
        workflow_execution_arn: 'arn:exec:1',
        attempt_count: 2,
      });
      send.mockResolvedValue({ Item: record });

      const result = await repo.getConsistent(KEY);

      expect(result).toEqual(record);
      expect(result?.status).toBe(IdempotencyStatus.running);
      expect(result?.attempt_count).toBe(2);
    });

    it('returns null for a key that was never injected', async () => {
      const { repo, send } = createRepository();
      send.mockResolvedValue({});

      expect(await repo.getConsistent(KEY)).toBeNull();
    });

    it('round-trips a put then a consistent read', async () => {
      const { repo, send } = createRepository();
      const record = startingRecord();
      send.mockResolvedValueOnce({}).mockResolvedValueOnce({ Item: record });

      await repo.conditionalPutNew(record);
      const read = await repo.getConsistent(KEY);

      expect(read).toEqual(record);
      expect(inputOf(send, 1).ConsistentRead).toBe(true);
    });

    it('supports apply-or-confirm: a failed guard is followed by a consistent re-read', async () => {
      const { repo, send } = createRepository();
      const stored = startingRecord({
        status: IdempotencyStatus.running,
        workflow_execution_arn: 'arn:exec:new',
        attempt_count: 2,
      });
      send.mockRejectedValueOnce(conditionalCheckFailed()).mockResolvedValueOnce({ Item: stored });

      const failure = await repo
        .conditionalUpdateState({
          idempotencyKey: KEY,
          guard: {
            status: IdempotencyStatus.running,
            workflow_execution_arn: 'arn:exec:old',
            attempt_count: 1,
          },
          mutation: { set: { status: IdempotencyStatus.completed } },
        })
        .catch((e: unknown) => e);
      const confirmed = await repo.getConsistent(KEY);

      expect(failure).toBeInstanceOf(IdempotencyConditionFailedError);
      // A different execution/attempt owns the record → the caller will classify
      // this as FENCED_STALE_EXECUTION (TASK-095).
      expect(confirmed?.workflow_execution_arn).toBe('arn:exec:new');
      expect(confirmed?.attempt_count).toBe(2);
      expect(inputOf(send, 1).ConsistentRead).toBe(true);
    });

    it('propagates read failures instead of reporting the key as absent', async () => {
      const { repo, send } = createRepository();
      send.mockRejectedValue(new Error('Network unreachable'));

      const error = await repo.getConsistent(KEY).catch((e: unknown) => e);

      expect(error).toBeInstanceOf(IdempotencyRepositoryError);
      expect((error as IdempotencyRepositoryError).operation).toBe('getConsistent');
    });

    it('rejects an empty idempotencyKey', async () => {
      const { repo, send } = createRepository();

      await expect(repo.getConsistent('')).rejects.toBeInstanceOf(IdempotencyUsageError);
      expect(send).not.toHaveBeenCalled();
    });
  });

  // ─── read-only handle (FIX 2 writer isolation) ───────────

  describe('createIdempotencyReader', () => {
    it('reads with strong consistency', async () => {
      const { client, send } = createMockDocumentClient();
      send.mockResolvedValue({ Item: startingRecord() });

      const reader = createIdempotencyReader({ tableName: TABLE, documentClient: client });
      const result = await reader.getConsistent(KEY);

      expect(result?.idempotency_key).toBe(KEY);
      expect(inputOf(send).ConsistentRead).toBe(true);
    });

    it('exposes no write primitives', () => {
      const { client } = createMockDocumentClient();
      const reader = createIdempotencyReader({ tableName: TABLE, documentClient: client });

      const surface = reader as unknown as Record<string, unknown>;
      expect(Object.keys(reader)).toEqual(['getConsistent']);
      expect(surface.conditionalPutNew).toBeUndefined();
      expect(surface.conditionalUpdateState).toBeUndefined();
    });
  });
});
