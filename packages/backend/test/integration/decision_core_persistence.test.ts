/**
 * TASK-106 — DecisionCore persistence integration test (RELEASE GATE 1).
 *
 * ## How this differs from the TASK-100/101 unit test
 *
 * `test/decision/core_persistence.test.ts` mocks `DecisionCorePort`, so it proves
 * the classification logic but takes DynamoDB's behaviour on trust — a repository
 * that forgot its `ConditionExpression` would still pass it.
 *
 * This suite drives the REAL `DecisionCoreRepository` against an in-memory table
 * that enforces DynamoDB semantics itself: `attribute_not_exists(#pk)` is
 * evaluated for real, a violation raises a real
 * `ConditionalCheckFailedException`, and `ConsistentRead` is recorded per call.
 * So the three-tier classification is verified through the actual `PutCommand` /
 * `GetCommand` path, not around it.
 *
 * ## What Gate 1 is actually gating
 *
 * A committed DecisionCore is the immutable evidence record the whole demo rests
 * on (§10.11a). If it can be overwritten — by an at-least-once Express retry, by
 * a second execution after a lease expires, or by a recovery run that recomputed
 * from a different snapshot — then the audit trail is worthless and the system
 * can retract a public warning it already issued. Every assertion below exists to
 * make that unrepresentable.
 *
 * The tests therefore check the STORED BYTES after each attempt, not just the
 * returned status. A correct status with a mutated record would still be a failed
 * gate.
 */

import { describe, it, expect } from 'vitest';
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import { GetCommand, PutCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { CoreWriteStatus } from '@city-commander/shared-schemas';
import type { DecisionCore } from '@city-commander/shared-schemas';
import {
  DecisionCoreRepository,
  DecisionCoreAlreadyExistsError,
  TableReadError,
  persistDecisionCore,
} from '../../src/index.js';

const TABLE = 'DecisionCoreTable-test';
const DECISION = 'DEC_TPE_2026_ACC_001_abcdef123456';
const KEY = 'TPE_2026_ACC_001|2026-05-20 22:10|prov-2026a';

/** Identity fields (§15.2) plus execution-volatile metadata (excluded, FIX 4). */
function core(overrides: Partial<Record<string, unknown>> = {}): DecisionCore {
  return {
    decision_id: DECISION,
    idempotency_key: KEY,
    source_manifest_hash: 'sha256:MANIFEST-A',
    core_hash: 'sha256:CORE-HASH-1',
    schema_version: '1.0.0',
    // Volatile: differs between executions of the SAME decision.
    injection_run_id: 'inj-1',
    workflow_execution_name: 'exec-name-1',
    attempt_count: 1,
    committed_at: '2026-05-20T22:10:03+08:00',
    ...overrides,
  } as unknown as DecisionCore;
}

interface RecordedGet {
  readonly key: string;
  readonly consistentRead: boolean | undefined;
}

/**
 * In-memory DecisionCoreTable that enforces DynamoDB conditional-write semantics.
 *
 * Items are stored and returned as deep copies, so a caller holding a reference
 * cannot mutate the table — the same guarantee the wire gives us, and the thing
 * an immutability test must not accidentally fake away.
 */
class InMemoryDecisionCoreTable {
  private readonly items = new Map<string, string>();
  readonly documentClient: DynamoDBDocumentClient;

  putAttempts = 0;
  conditionRejections = 0;
  readonly gets: RecordedGet[] = [];
  readonly seenConditionExpressions: (string | undefined)[] = [];
  /** When set, the next Put fails with this error instead of being evaluated. */
  failNextPutWith: Error | null = null;
  /** When set, the next Get fails with this error. */
  failNextGetWith: Error | null = null;
  /**
   * When true, Get reports every key as absent while Put still sees the item.
   *
   * Emulates the contradictory view the writer must fail closed on: the guard
   * rejects because the key exists, yet the strongly-consistent read returns
   * nothing.
   */
  hideItemsFromGet = false;

  constructor() {
    this.documentClient = {
      send: (command: unknown): Promise<unknown> => this.send(command),
    } as unknown as DynamoDBDocumentClient;
  }

  /** Raw stored JSON, for byte-level immutability assertions. */
  rawItem(decisionId: string): string | undefined {
    return this.items.get(decisionId);
  }

  storedCore(decisionId: string): DecisionCore | null {
    const raw = this.items.get(decisionId);
    return raw === undefined ? null : (JSON.parse(raw) as DecisionCore);
  }

  get size(): number {
    return this.items.size;
  }

  /** Seed a committed core without going through the guarded write path. */
  seed(item: DecisionCore): void {
    this.items.set((item as unknown as { decision_id: string }).decision_id, JSON.stringify(item));
  }

  private async send(command: unknown): Promise<unknown> {
    if (command instanceof PutCommand) return this.put(command);
    if (command instanceof GetCommand) return this.get(command);
    throw new Error('InMemoryDecisionCoreTable received an unsupported command.');
  }

  private put(command: PutCommand): Record<string, never> {
    this.putAttempts += 1;
    const input = command.input;

    if (this.failNextPutWith !== null) {
      const error = this.failNextPutWith;
      this.failNextPutWith = null;
      throw error;
    }

    expect(input.TableName).toBe(TABLE);
    this.seenConditionExpressions.push(input.ConditionExpression);

    const item = input.Item as unknown as { decision_id: string };
    const attributeName = input.ExpressionAttributeNames?.['#pk'];
    const guarded =
      input.ConditionExpression === 'attribute_not_exists(#pk)' && attributeName === 'decision_id';

    // An unguarded Put would silently overwrite. Refuse to emulate one: the
    // repository must never issue it, and a test that tolerated it would hide
    // exactly the regression this gate exists to catch.
    if (!guarded) {
      throw new Error(
        `Unguarded Put on DecisionCoreTable (ConditionExpression=${String(
          input.ConditionExpression,
        )}). The core is immutable_after_commit (§10.11a).`,
      );
    }

    if (this.items.has(item.decision_id)) {
      this.conditionRejections += 1;
      throw new ConditionalCheckFailedException({
        $metadata: {},
        message: 'The conditional request failed',
      });
    }

    this.items.set(item.decision_id, JSON.stringify(item));
    return {};
  }

  private get(command: GetCommand): { Item?: DecisionCore } {
    const input = command.input;

    if (this.failNextGetWith !== null) {
      const error = this.failNextGetWith;
      this.failNextGetWith = null;
      throw error;
    }

    expect(input.TableName).toBe(TABLE);
    const key = (input.Key as { decision_id: string } | undefined)?.decision_id ?? '';
    this.gets.push({ key, consistentRead: input.ConsistentRead });

    if (this.hideItemsFromGet) return {};

    const raw = this.items.get(key);
    return raw === undefined ? {} : { Item: JSON.parse(raw) as DecisionCore };
  }
}

function newHarness(): {
  table: InMemoryDecisionCoreTable;
  repository: DecisionCoreRepository;
} {
  const table = new InMemoryDecisionCoreTable();
  const repository = new DecisionCoreRepository({
    tableName: TABLE,
    documentClient: table.documentClient,
  });
  return { table, repository };
}

// ─── Tier 1: Fresh Write ───────────────────────────────────

describe('Gate 1 · tier 1 — fresh write', () => {
  it('commits on the first attempt', async () => {
    const { table, repository } = newHarness();

    const outcome = await persistDecisionCore(repository, core());

    expect(outcome.status).toBe(CoreWriteStatus.COMMITTED);
    expect(table.size).toBe(1);
  });

  it('issues the attribute_not_exists guard on the real PutCommand', async () => {
    const { table, repository } = newHarness();

    await persistDecisionCore(repository, core());

    expect(table.seenConditionExpressions).toEqual(['attribute_not_exists(#pk)']);
  });

  it('stores the core verbatim', async () => {
    const { table, repository } = newHarness();
    const written = core();

    await persistDecisionCore(repository, written);

    expect(table.storedCore(DECISION)).toEqual(written);
  });

  it('does not read the table when the write wins', async () => {
    const { table, repository } = newHarness();

    await persistDecisionCore(repository, core());

    expect(table.gets).toEqual([]);
  });

  it('never persists the execution-local core_write_status (§6)', async () => {
    const { table, repository } = newHarness();

    await persistDecisionCore(repository, core());

    // The same stored core yields a different status per execution, so storing it
    // would make the record self-contradictory.
    expect(table.storedCore(DECISION)).not.toHaveProperty('core_write_status');
  });
});

// ─── Tier 2: Duplicate, same core_hash ─────────────────────

describe('Gate 1 · tier 2 — duplicate with identical core_hash', () => {
  it('classifies an at-least-once retry as ALREADY_COMMITTED_SAME_DECISION', async () => {
    const { repository } = newHarness();
    await persistDecisionCore(repository, core());

    const outcome = await persistDecisionCore(
      repository,
      // Express retried the task: same decision facts, new execution metadata.
      core({ injection_run_id: 'inj-2', workflow_execution_name: 'exec-name-2', attempt_count: 2 }),
    );

    expect(outcome.status).toBe(CoreWriteStatus.ALREADY_COMMITTED_SAME_DECISION);
  });

  it('leaves the stored bytes untouched by the retry', async () => {
    const { table, repository } = newHarness();
    await persistDecisionCore(repository, core());
    const before = table.rawItem(DECISION);

    await persistDecisionCore(
      repository,
      core({ injection_run_id: 'inj-2', workflow_execution_name: 'exec-name-2', attempt_count: 2 }),
    );

    expect(table.rawItem(DECISION)).toBe(before);
    expect(table.storedCore(DECISION)).toMatchObject({
      injection_run_id: 'inj-1',
      workflow_execution_name: 'exec-name-1',
      attempt_count: 1,
    });
  });

  it('returns the STORED core, not this execution\u2019s copy', async () => {
    const { repository } = newHarness();
    await persistDecisionCore(repository, core());

    const outcome = await persistDecisionCore(repository, core({ injection_run_id: 'inj-2' }));

    if (outcome.status !== CoreWriteStatus.ALREADY_COMMITTED_SAME_DECISION) {
      throw new Error(`expected ALREADY_COMMITTED_SAME_DECISION, got ${outcome.status}`);
    }
    // The workflow must continue against committed truth.
    expect(outcome.core.injection_run_id).toBe('inj-1');
  });

  it('re-reads with ConsistentRead after the condition fails', async () => {
    const { table, repository } = newHarness();
    await persistDecisionCore(repository, core());

    await persistDecisionCore(repository, core({ injection_run_id: 'inj-2' }));

    // An eventually consistent read could miss the very write that just failed.
    expect(table.gets).toEqual([{ key: DECISION, consistentRead: true }]);
  });

  it('attempts exactly one Put per execution and rejects the second', async () => {
    const { table, repository } = newHarness();
    await persistDecisionCore(repository, core());

    await persistDecisionCore(repository, core({ injection_run_id: 'inj-2' }));

    expect(table.putAttempts).toBe(2);
    expect(table.conditionRejections).toBe(1);
    expect(table.size).toBe(1);
  });

  it('is stable across repeated retries', async () => {
    const { table, repository } = newHarness();
    await persistDecisionCore(repository, core());
    const before = table.rawItem(DECISION);

    for (let attempt = 2; attempt <= 5; attempt += 1) {
      const outcome = await persistDecisionCore(repository, core({ attempt_count: attempt }));
      expect(outcome.status).toBe(CoreWriteStatus.ALREADY_COMMITTED_SAME_DECISION);
    }

    expect(table.rawItem(DECISION)).toBe(before);
  });
});

// ─── Tier 3: Identity conflict ─────────────────────────────

describe('Gate 1 · tier 3 — differing core_hash is a terminal conflict', () => {
  it('classifies a different core_hash as CORE_IDENTITY_CONFLICT', async () => {
    const { repository } = newHarness();
    await persistDecisionCore(repository, core());

    const outcome = await persistDecisionCore(
      repository,
      core({ core_hash: 'sha256:CORE-HASH-2' }),
    );

    expect(outcome.status).toBe(CoreWriteStatus.CORE_IDENTITY_CONFLICT);
  });

  it('reports the diverged field for the security alert (TASK-159)', async () => {
    const { repository } = newHarness();
    await persistDecisionCore(repository, core());

    const outcome = await persistDecisionCore(
      repository,
      core({ core_hash: 'sha256:CORE-HASH-2' }),
    );

    if (outcome.status !== CoreWriteStatus.CORE_IDENTITY_CONFLICT) {
      throw new Error(`expected CORE_IDENTITY_CONFLICT, got ${outcome.status}`);
    }
    expect(outcome.mismatches).toEqual([
      {
        field: 'core_hash',
        expected: 'sha256:CORE-HASH-2',
        actual: 'sha256:CORE-HASH-1',
      },
    ]);
  });

  it('does not overwrite the committed core', async () => {
    const { table, repository } = newHarness();
    await persistDecisionCore(repository, core());
    const before = table.rawItem(DECISION);

    await persistDecisionCore(repository, core({ core_hash: 'sha256:CORE-HASH-2' }));

    expect(table.rawItem(DECISION)).toBe(before);
    expect(table.size).toBe(1);
  });

  it('surfaces the stored core so the alert can name what is committed', async () => {
    const { repository } = newHarness();
    await persistDecisionCore(repository, core());

    const outcome = await persistDecisionCore(
      repository,
      core({ core_hash: 'sha256:CORE-HASH-2' }),
    );

    if (outcome.status !== CoreWriteStatus.CORE_IDENTITY_CONFLICT) {
      throw new Error(`expected CORE_IDENTITY_CONFLICT, got ${outcome.status}`);
    }
    expect(outcome.storedCore.core_hash).toBe('sha256:CORE-HASH-1');
  });

  it('treats a different source_manifest_hash as a conflict (different official data)', async () => {
    const { table, repository } = newHarness();
    await persistDecisionCore(repository, core());
    const before = table.rawItem(DECISION);

    // A recovery run that loaded a NEWER snapshot must not silently replace the
    // decision that was already broadcast.
    const outcome = await persistDecisionCore(
      repository,
      core({ source_manifest_hash: 'sha256:MANIFEST-B', core_hash: 'sha256:CORE-HASH-9' }),
    );

    expect(outcome.status).toBe(CoreWriteStatus.CORE_IDENTITY_CONFLICT);
    expect(table.rawItem(DECISION)).toBe(before);
  });

  it('treats a different schema_version as a conflict', async () => {
    const { repository } = newHarness();
    await persistDecisionCore(repository, core());

    const outcome = await persistDecisionCore(repository, core({ schema_version: '2.0.0' }));

    expect(outcome.status).toBe(CoreWriteStatus.CORE_IDENTITY_CONFLICT);
  });

  it('reports every diverged identity field at once', async () => {
    const { repository } = newHarness();
    await persistDecisionCore(repository, core());

    const outcome = await persistDecisionCore(
      repository,
      core({ core_hash: 'sha256:X', schema_version: '2.0.0', idempotency_key: 'other-key' }),
    );

    if (outcome.status !== CoreWriteStatus.CORE_IDENTITY_CONFLICT) {
      throw new Error(`expected CORE_IDENTITY_CONFLICT, got ${outcome.status}`);
    }
    expect(outcome.mismatches.map((mismatch) => mismatch.field).sort()).toEqual([
      'core_hash',
      'idempotency_key',
      'schema_version',
    ]);
  });

  it('stays terminal on repeated conflicting attempts', async () => {
    const { table, repository } = newHarness();
    await persistDecisionCore(repository, core());
    const before = table.rawItem(DECISION);

    for (let i = 0; i < 3; i += 1) {
      const outcome = await persistDecisionCore(repository, core({ core_hash: `sha256:X${i}` }));
      expect(outcome.status).toBe(CoreWriteStatus.CORE_IDENTITY_CONFLICT);
    }

    expect(table.rawItem(DECISION)).toBe(before);
  });
});

// ─── Immutability across lease expiry / time travel ────────

describe('Gate 1 · immutability across lease expiry', () => {
  it('keeps the core intact when a takeover recomputes the same decision', async () => {
    const { table, repository } = newHarness();
    // Execution A commits, then its lease expires before MARK_COMPLETED lands.
    await persistDecisionCore(repository, core({ injection_run_id: 'inj-A' }));
    const before = table.rawItem(DECISION);

    // Execution B takes the expired lease and re-runs the deterministic pipeline
    // over the same snapshot, so it derives the same core_hash.
    const outcome = await persistDecisionCore(
      repository,
      core({ injection_run_id: 'inj-B', workflow_execution_name: 'exec-B', attempt_count: 2 }),
    );

    expect(outcome.status).toBe(CoreWriteStatus.ALREADY_COMMITTED_SAME_DECISION);
    expect(table.rawItem(DECISION)).toBe(before);
  });

  it('refuses the write when a takeover recomputes a DIFFERENT decision', async () => {
    const { table, repository } = newHarness();
    await persistDecisionCore(repository, core({ injection_run_id: 'inj-A' }));
    const before = table.rawItem(DECISION);

    // Worst case: B ran after the traffic snapshot rolled over, so it produced a
    // different recommendation for a warning the public has already received.
    const outcome = await persistDecisionCore(
      repository,
      core({
        injection_run_id: 'inj-B',
        source_manifest_hash: 'sha256:MANIFEST-B',
        core_hash: 'sha256:CORE-HASH-LATER',
      }),
    );

    expect(outcome.status).toBe(CoreWriteStatus.CORE_IDENTITY_CONFLICT);
    expect(table.rawItem(DECISION)).toBe(before);
  });

  it('holds even when the lease has been expired for an arbitrarily long time', async () => {
    const { table, repository } = newHarness();
    await persistDecisionCore(repository, core());
    const before = table.rawItem(DECISION);

    // Immutability is enforced by the key condition, not by a TTL or a clock, so
    // no amount of elapsed time opens a window. DecisionCoreTable has no TTL.
    const outcome = await persistDecisionCore(
      repository,
      core({
        committed_at: '2027-01-01T00:00:00+08:00',
        core_hash: 'sha256:MUCH-LATER',
      }),
    );

    expect(outcome.status).toBe(CoreWriteStatus.CORE_IDENTITY_CONFLICT);
    expect(table.rawItem(DECISION)).toBe(before);
  });

  it('resolves two concurrent executions to exactly one committed core', async () => {
    const { table, repository } = newHarness();

    const [first, second] = await Promise.all([
      persistDecisionCore(repository, core({ injection_run_id: 'inj-A' })),
      persistDecisionCore(repository, core({ injection_run_id: 'inj-B' })),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual(
      [CoreWriteStatus.ALREADY_COMMITTED_SAME_DECISION, CoreWriteStatus.COMMITTED].sort(),
    );
    expect(table.size).toBe(1);
  });

  it('resolves concurrent CONFLICTING executions without either overwriting', async () => {
    const { table, repository } = newHarness();

    const [first, second] = await Promise.all([
      persistDecisionCore(repository, core({ core_hash: 'sha256:A' })),
      persistDecisionCore(repository, core({ core_hash: 'sha256:B' })),
    ]);

    const outcomes = [first.status, second.status];
    expect(outcomes).toContain(CoreWriteStatus.COMMITTED);
    expect(outcomes).toContain(CoreWriteStatus.CORE_IDENTITY_CONFLICT);
    expect(table.size).toBe(1);
  });
});

// ─── Transient faults must not be classified ───────────────

describe('Gate 1 · a transient fault is never a conflict', () => {
  it('propagates a throttled Put as TableReadError', async () => {
    const { table, repository } = newHarness();
    table.failNextPutWith = Object.assign(new Error('Throughput exceeded'), {
      name: 'ProvisionedThroughputExceededException',
    });

    await expect(persistDecisionCore(repository, core())).rejects.toBeInstanceOf(TableReadError);
    expect(table.size).toBe(0);
  });

  it('does not classify identity after a transient Put failure', async () => {
    const { table, repository } = newHarness();
    table.failNextPutWith = Object.assign(new Error('socket hang up'), {
      name: 'TimeoutError',
    });

    await expect(persistDecisionCore(repository, core())).rejects.toBeInstanceOf(TableReadError);
    // Reporting a network blip as ALREADY_COMMITTED would let the workflow
    // continue as if a core existed when none does.
    expect(table.gets).toEqual([]);
  });

  it('propagates a failure raised by the identity re-read', async () => {
    const { table, repository } = newHarness();
    await persistDecisionCore(repository, core());
    table.failNextGetWith = Object.assign(new Error('Throughput exceeded'), {
      name: 'ProvisionedThroughputExceededException',
    });

    await expect(
      persistDecisionCore(repository, core({ injection_run_id: 'inj-2' })),
    ).rejects.toBeInstanceOf(TableReadError);
  });

  it('fails closed when the Put says exists but the consistent read says absent', async () => {
    const { table, repository } = newHarness();
    table.seed(core());
    table.hideItemsFromGet = true;

    const outcome = await persistDecisionCore(repository, core());

    // Both views cannot be true. Retrying the write against an inconsistent view
    // could overwrite a committed core, so the only safe answer is terminal.
    expect(outcome.status).toBe(CoreWriteStatus.CORE_IDENTITY_CONFLICT);
    if (outcome.status !== CoreWriteStatus.CORE_IDENTITY_CONFLICT) {
      throw new Error('unreachable');
    }
    expect(outcome.mismatches).toEqual([
      {
        field: 'decision_id',
        expected: DECISION,
        actual: '<absent on consistent read>',
      },
    ]);
  });

  it('does not attempt a second Put after failing closed on the absent read', async () => {
    const { table, repository } = newHarness();
    table.seed(core());
    table.hideItemsFromGet = true;

    await persistDecisionCore(repository, core());

    expect(table.putAttempts).toBe(1);
    expect(table.size).toBe(1);
  });
});

// ─── Repository-level guarantees ───────────────────────────

describe('Gate 1 · repository write surface', () => {
  it('raises DecisionCoreAlreadyExistsError from the guarded Put itself', async () => {
    const { repository } = newHarness();
    await repository.conditionalPutNew(core());

    await expect(repository.conditionalPutNew(core())).rejects.toBeInstanceOf(
      DecisionCoreAlreadyExistsError,
    );
  });

  it('exposes no update or delete operation', () => {
    const { repository } = newHarness();

    // Immutability is a property of the available API surface, not of caller
    // discipline. There is nothing to call that could overwrite a core.
    const surface = [
      ...Object.getOwnPropertyNames(Object.getPrototypeOf(repository) as object),
      ...Object.getOwnPropertyNames(
        Object.getPrototypeOf(Object.getPrototypeOf(repository) as object) as object,
      ),
    ];
    expect(surface).not.toContain('update');
    expect(surface).not.toContain('delete');
    expect(surface).not.toContain('put');
    expect(surface).toContain('conditionalPutNew');
  });

  it('reads back a committed core with strong consistency', async () => {
    const { table, repository } = newHarness();
    await persistDecisionCore(repository, core());

    const stored = await repository.getConsistent(DECISION);

    expect(stored?.core_hash).toBe('sha256:CORE-HASH-1');
    expect(table.gets.at(-1)?.consistentRead).toBe(true);
  });

  it('reports a never-committed core as absent rather than throwing', async () => {
    const { repository } = newHarness();

    expect(await repository.getConsistent('DEC_NEVER_WRITTEN')).toBeNull();
    expect(await repository.exists('DEC_NEVER_WRITTEN')).toBe(false);
  });
});
