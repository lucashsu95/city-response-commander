/**
 * TASK-107 — Recovery and Execution Fencing end-to-end integration test.
 *
 * Drives the real chain across five modules, in the order production runs them:
 *
 *   TASK-086 `acquireFirstLease`        new → starting
 *   TASK-089 `markRunning`             starting → running   ($$.Execution.Id stamped)
 *            ── execution crashes, deadline passes ──
 *   TASK-092 `orchestrateStaleRunning` detect → gate → reconcile → re-lease
 *   TASK-093 `evaluateRecoveryGate`    read-only judgement, grades the recovery
 *   TASK-091 `reconcileStaleRunning`   running → processing_failed (external fencing)
 *   TASK-094 `recoverFromProcessingFailed` processing_failed → starting (attempt+1)
 *   TASK-102 `markCoreCommitted`       the Fast Path gate
 *
 * ## Why an expression-evaluating fake, not mocked ports
 *
 * Every guarantee under test is expressed as a DynamoDB `ConditionExpression`
 * that `IdempotencyRepository` GENERATES. A mocked port would let a repository
 * with a dropped guard clause pass. So the fake table below parses and evaluates
 * the real `UpdateExpression` / `ConditionExpression` that the repository emits,
 * including `attribute_exists`, `IN`, `=`, `<`, `REMOVE` and the
 * `attempt_count = attempt_count + :n` increment.
 *
 * ## The invariant all of this protects
 *
 * When a crashed execution comes back to life it must not be able to write
 * anything. Its `workflow_execution_arn` and `attempt_count` no longer match, so
 * every guarded transition it attempts fails closed. Without that, a zombie
 * execution could mark a superseded attempt `completed`, or set `core_committed`
 * for a core the current attempt never wrote.
 */

import { describe, it, expect } from 'vitest';
import { ConditionalCheckFailedException } from '@aws-sdk/client-dynamodb';
import {
  GetCommand,
  PutCommand,
  UpdateCommand,
  type DynamoDBDocumentClient,
} from '@aws-sdk/lib-dynamodb';
import {
  EvidenceSource,
  IdempotencyStatus,
  RecoveryMode,
  RecoveryStage,
  StatusActionResult,
} from '@city-commander/shared-schemas';
import type { DecisionCore, IdempotencyRecord } from '@city-commander/shared-schemas';
import {
  IdempotencyRepository,
  acquireFirstLease,
  evaluateRecoveryGate,
  isStaleRunning,
  markCoreCommitted,
  markRunning,
  orchestrateStaleRunning,
  reconcileStaleRunning,
  recoverFromProcessingFailed,
  recoverFromStartFailed,
  reacquireExpiredStartingLease,
  type DecisionCoreReadPort,
  type DecisionNarrativeReadPort,
  type IdempotencyKeyParts,
  type RecoveryGatePorts,
  type WorkflowStatusInput,
} from '../../src/index.js';

const TABLE = 'IdempotencyTable-test';

const KEY_PARTS: IdempotencyKeyParts = {
  eventId: 'TPE_2026_ACC_001',
  eventTimestamp: '2026-05-20 22:10',
  policyVersion: 'prov-2026a',
};
const IDEMPOTENCY_KEY = 'TPE_2026_ACC_001|2026-05-20 22:10|prov-2026a';

const T0 = 1_800_000_000_000;
const LEASE_TTL_MS = 30_000;
const RECORD_TTL_MS = 86_400_000;
const EXECUTION_DEADLINE_MS = 60_000;

const EXEC_A = 'arn:aws:states:ap-northeast-1:1:express:wf:exec-A';
const EXEC_B = 'arn:aws:states:ap-northeast-1:1:express:wf:exec-B';

function clockAt(nowEpochMs: number): { nowEpochMs: number; nowDisplay: string } {
  return { nowEpochMs, nowDisplay: '2026-05-20 22:10' };
}

// ─── In-memory IdempotencyTable that evaluates real expressions ───

type AttributeValues = Record<string, unknown>;

function resolveName(token: string, names: Record<string, string> | undefined): string {
  const attribute = names?.[token];
  if (attribute === undefined) throw new Error(`Unmapped name placeholder "${token}".`);
  return attribute;
}

function resolveValue(token: string, values: AttributeValues | undefined): unknown {
  if (values === undefined || !(token in values)) {
    throw new Error(`Unmapped value placeholder "${token}".`);
  }
  return values[token];
}

/** Evaluate an ANDed `ConditionExpression` against a stored item. */
function evaluateCondition(
  expression: string,
  names: Record<string, string> | undefined,
  values: AttributeValues | undefined,
  item: Record<string, unknown> | undefined,
): boolean {
  for (const rawTerm of expression.split(' AND ')) {
    const term = rawTerm.trim();

    const exists = /^attribute_exists\((#\w+)\)$/.exec(term);
    if (exists?.[1] !== undefined) {
      if (item?.[resolveName(exists[1], names)] === undefined) return false;
      continue;
    }

    const notExists = /^attribute_not_exists\((#\w+)\)$/.exec(term);
    if (notExists?.[1] !== undefined) {
      if (item?.[resolveName(notExists[1], names)] !== undefined) return false;
      continue;
    }

    const inList = /^(#\w+) IN \(([^)]*)\)$/.exec(term);
    if (inList?.[1] !== undefined && inList[2] !== undefined) {
      const actual = item?.[resolveName(inList[1], names)];
      const candidates = inList[2].split(',').map((token) => resolveValue(token.trim(), values));
      if (!candidates.includes(actual)) return false;
      continue;
    }

    const comparison = /^(#\w+) (=|<) (:\w+)$/.exec(term);
    if (
      comparison?.[1] !== undefined &&
      comparison[2] !== undefined &&
      comparison[3] !== undefined
    ) {
      const actual = item?.[resolveName(comparison[1], names)];
      const expected = resolveValue(comparison[3], values);
      if (comparison[2] === '=') {
        if (actual !== expected) return false;
      } else if (
        typeof actual !== 'number' ||
        typeof expected !== 'number' ||
        !(actual < expected)
      ) {
        return false;
      }
      continue;
    }

    throw new Error(`Unsupported condition term: "${term}".`);
  }
  return true;
}

/** Apply a real `UpdateExpression` (`SET ... REMOVE ...`) to an item copy. */
function applyUpdate(
  expression: string,
  names: Record<string, string> | undefined,
  values: AttributeValues | undefined,
  item: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...item };
  const removeIndex = expression.indexOf('REMOVE ');

  const setPart = expression.startsWith('SET ')
    ? expression.slice(4, removeIndex >= 0 ? removeIndex : undefined).trim()
    : '';
  const removePart =
    removeIndex >= 0 ? expression.slice(removeIndex + 'REMOVE '.length).trim() : '';

  if (setPart.length > 0) {
    for (const rawClause of setPart.split(', ')) {
      const clause = rawClause.trim();

      const increment = /^(#\w+) = (#\w+) \+ (:\w+)$/.exec(clause);
      if (
        increment?.[1] !== undefined &&
        increment[2] !== undefined &&
        increment[3] !== undefined
      ) {
        const target = resolveName(increment[1], names);
        const source = resolveName(increment[2], names);
        const delta = resolveValue(increment[3], values);
        if (typeof next[source] !== 'number' || typeof delta !== 'number') {
          throw new Error(`Cannot increment non-numeric "${source}".`);
        }
        next[target] = next[source] + delta;
        continue;
      }

      const assign = /^(#\w+) = (:\w+)$/.exec(clause);
      if (assign?.[1] !== undefined && assign[2] !== undefined) {
        next[resolveName(assign[1], names)] = resolveValue(assign[2], values);
        continue;
      }

      throw new Error(`Unsupported SET clause: "${clause}".`);
    }
  }

  if (removePart.length > 0) {
    for (const token of removePart.split(', ')) {
      // REMOVE leaves the attribute ABSENT, not null. normalizeIdempotencyRecord
      // is what restores the declared `| null` on read.
      delete next[resolveName(token.trim(), names)];
    }
  }

  return next;
}

/** IdempotencyTable fake with real conditional-write semantics. */
class InMemoryIdempotencyTable {
  private readonly items = new Map<string, string>();
  readonly documentClient: DynamoDBDocumentClient;

  putAttempts = 0;
  updateAttempts = 0;
  rejectedUpdates = 0;
  readonly consistentReads: boolean[] = [];
  /** Every ConditionExpression the repository generated, for guard assertions. */
  readonly conditionExpressions: string[] = [];

  constructor() {
    this.documentClient = {
      send: (command: unknown): Promise<unknown> => this.send(command),
    } as unknown as DynamoDBDocumentClient;
  }

  item(key = IDEMPOTENCY_KEY): Record<string, unknown> | null {
    const raw = this.items.get(key);
    return raw === undefined ? null : (JSON.parse(raw) as Record<string, unknown>);
  }

  /** Force a state the happy path cannot reach, e.g. a terminal conflict. */
  patch(overrides: Record<string, unknown>, key = IDEMPOTENCY_KEY): void {
    const current = this.item(key);
    if (current === null) throw new Error(`No record for "${key}".`);
    this.items.set(key, JSON.stringify({ ...current, ...overrides }));
  }

  private async send(command: unknown): Promise<unknown> {
    if (command instanceof PutCommand) return this.put(command);
    if (command instanceof UpdateCommand) return this.update(command);
    if (command instanceof GetCommand) return this.get(command);
    throw new Error('InMemoryIdempotencyTable received an unsupported command.');
  }

  private put(command: PutCommand): Record<string, never> {
    this.putAttempts += 1;
    const input = command.input;
    expect(input.TableName).toBe(TABLE);

    const item = input.Item as Record<string, unknown>;
    const key = item.idempotency_key as string;

    if (input.ConditionExpression === undefined) {
      throw new Error('Unguarded Put on IdempotencyTable: every write must be conditional.');
    }
    this.conditionExpressions.push(input.ConditionExpression);

    if (
      !evaluateCondition(
        input.ConditionExpression,
        input.ExpressionAttributeNames,
        input.ExpressionAttributeValues,
        this.item(key) ?? undefined,
      )
    ) {
      throw new ConditionalCheckFailedException({
        $metadata: {},
        message: 'The conditional request failed',
      });
    }

    this.items.set(key, JSON.stringify(item));
    return {};
  }

  private update(command: UpdateCommand): { Attributes: Record<string, unknown> } {
    this.updateAttempts += 1;
    const input = command.input;
    expect(input.TableName).toBe(TABLE);

    const key = (input.Key as { idempotency_key: string }).idempotency_key;
    const current = this.item(key);

    if (input.ConditionExpression === undefined) {
      throw new Error('Unguarded Update on IdempotencyTable (§10.11e).');
    }
    this.conditionExpressions.push(input.ConditionExpression);

    if (
      !evaluateCondition(
        input.ConditionExpression,
        input.ExpressionAttributeNames,
        input.ExpressionAttributeValues,
        current ?? undefined,
      )
    ) {
      this.rejectedUpdates += 1;
      throw new ConditionalCheckFailedException({
        $metadata: {},
        message: 'The conditional request failed',
      });
    }

    const updated = applyUpdate(
      input.UpdateExpression ?? '',
      input.ExpressionAttributeNames,
      input.ExpressionAttributeValues,
      current ?? {},
    );
    this.items.set(key, JSON.stringify(updated));
    return { Attributes: updated };
  }

  private get(command: GetCommand): { Item?: Record<string, unknown> } {
    const input = command.input;
    expect(input.TableName).toBe(TABLE);
    this.consistentReads.push(input.ConsistentRead === true);

    const key = (input.Key as { idempotency_key: string }).idempotency_key;
    const item = this.item(key);
    return item === null ? {} : { Item: item };
  }
}

// ─── Harness ───────────────────────────────────────────────

function fakeCoreReader(stored: DecisionCore | null): DecisionCoreReadPort {
  return {
    getConsistent: async () => stored,
    exists: async () => stored !== null,
  };
}

const emptyNarrativeReader: DecisionNarrativeReadPort = {
  queryConsistent: async () => [],
};

interface Harness {
  readonly table: InMemoryIdempotencyTable;
  readonly repository: IdempotencyRepository;
  gatePorts(core?: DecisionCore | null): RecoveryGatePorts;
}

function newHarness(): Harness {
  const table = new InMemoryIdempotencyTable();
  const repository = new IdempotencyRepository({
    tableName: TABLE,
    documentClient: table.documentClient,
  });

  return {
    table,
    repository,
    gatePorts: (core = null) => ({
      idempotency: { getConsistent: (key) => repository.getConsistent(key) },
      decisionCore: fakeCoreReader(core),
      decisionNarrative: emptyNarrativeReader,
    }),
  };
}

function committedCore(): DecisionCore {
  return {
    decision_id: 'DEC_X',
    idempotency_key: IDEMPOTENCY_KEY,
    source_manifest_hash: 'sha256:MANIFEST-A',
    core_hash: 'sha256:CORE-1',
    schema_version: '1.0.0',
  } as unknown as DecisionCore;
}

/** Take the first lease as `leaseOwner`. */
async function firstLease(
  harness: Harness,
  leaseOwner = 'req-1',
  nowEpochMs = T0,
): Promise<{ record: IdempotencyRecord; decisionId: string }> {
  const result = await acquireFirstLease(harness.repository, {
    keyParts: KEY_PARTS,
    leaseOwner,
    clock: clockAt(nowEpochMs),
    durations: { leaseTtlMs: LEASE_TTL_MS, recordTtlMs: RECORD_TTL_MS },
    recoveryMode: RecoveryMode.NORMAL,
    recoveryStage: RecoveryStage.NONE,
  });
  if (result.outcome !== 'LEASE_ACQUIRED') {
    throw new Error(`expected LEASE_ACQUIRED, got ${result.outcome}`);
  }
  return { record: result.record, decisionId: result.decisionId };
}

function statusInput(overrides: Partial<WorkflowStatusInput> = {}): WorkflowStatusInput {
  return {
    idempotencyKey: IDEMPOTENCY_KEY,
    decisionId: 'DEC_X',
    attemptCount: 1,
    leaseOwner: 'req-1',
    recoveryMode: RecoveryMode.NORMAL,
    ...overrides,
  };
}

/** Lease + register execution A as running. */
async function runningExecutionA(harness: Harness): Promise<{ decisionId: string }> {
  const { decisionId } = await firstLease(harness);
  const outcome = await markRunning(harness.repository, statusInput({ decisionId }), {
    executionArn: EXEC_A,
    ...clockAt(T0 + 100),
    executionDeadlineMs: EXECUTION_DEADLINE_MS,
  });
  expect(outcome.result).toBe(StatusActionResult.APPLIED);
  return { decisionId };
}

// ─── Step 1: first lease (TASK-086) ────────────────────────

describe('chain step 1 · first lease (TASK-086)', () => {
  it('creates a starting record at attempt 1 with no execution stamped', async () => {
    const harness = newHarness();

    const { record } = await firstLease(harness);

    expect(record.status).toBe(IdempotencyStatus.starting);
    expect(record.attempt_count).toBe(1);
    // MARK_RUNNING owns the ARN (PATCH 2); InjectFn must never stamp it.
    expect(record.workflow_execution_arn).toBeNull();
    expect(record.core_committed).toBe(false);
  });

  it('lets exactly one of two concurrent injections win the lease', async () => {
    const harness = newHarness();

    const attempt = async (owner: string): Promise<string> =>
      (
        await acquireFirstLease(harness.repository, {
          keyParts: KEY_PARTS,
          leaseOwner: owner,
          clock: clockAt(T0),
          durations: { leaseTtlMs: LEASE_TTL_MS, recordTtlMs: RECORD_TTL_MS },
          recoveryMode: RecoveryMode.NORMAL,
          recoveryStage: RecoveryStage.NONE,
        })
      ).outcome;

    const outcomes = await Promise.all([attempt('req-1'), attempt('req-2')]);

    expect(outcomes.filter((outcome) => outcome === 'LEASE_ACQUIRED')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome === 'KEY_ALREADY_EXISTS')).toHaveLength(1);
  });
});

// ─── Step 2: MARK_RUNNING fencing (TASK-089) ───────────────

describe('chain step 2 · MARK_RUNNING registration and fencing (TASK-089)', () => {
  it('stamps the execution ARN and the staleness deadline', async () => {
    const harness = newHarness();
    await runningExecutionA(harness);

    expect(harness.table.item()).toMatchObject({
      status: IdempotencyStatus.running,
      workflow_execution_arn: EXEC_A,
      running_deadline_at: T0 + 100 + EXECUTION_DEADLINE_MS,
    });
  });

  it('fences an execution started for a lease owner that no longer holds it', async () => {
    const harness = newHarness();
    await firstLease(harness, 'req-1');

    const outcome = await markRunning(
      harness.repository,
      statusInput({ leaseOwner: 'req-OTHER' }),
      {
        executionArn: EXEC_B,
        ...clockAt(T0 + 100),
        executionDeadlineMs: EXECUTION_DEADLINE_MS,
      },
    );

    expect(outcome.result).toBe(StatusActionResult.FENCED_STALE_EXECUTION);
    expect(harness.table.item()).toMatchObject({ status: IdempotencyStatus.starting });
  });

  it('fences an execution whose attempt has been superseded', async () => {
    const harness = newHarness();
    await firstLease(harness);

    const outcome = await markRunning(harness.repository, statusInput({ attemptCount: 2 }), {
      executionArn: EXEC_B,
      ...clockAt(T0 + 100),
      executionDeadlineMs: EXECUTION_DEADLINE_MS,
    });

    expect(outcome.result).toBe(StatusActionResult.FENCED_STALE_EXECUTION);
  });

  it('fences an execution started with the wrong recovery_mode', async () => {
    const harness = newHarness();
    await firstLease(harness);

    // A FULL_WORKFLOW execution must not register against a NORMAL lease: the
    // mode decides whether DecisionFn re-runs.
    const outcome = await markRunning(
      harness.repository,
      statusInput({ recoveryMode: RecoveryMode.FULL_WORKFLOW }),
      { executionArn: EXEC_B, ...clockAt(T0 + 100), executionDeadlineMs: EXECUTION_DEADLINE_MS },
    );

    expect(outcome.result).toBe(StatusActionResult.FENCED_STALE_EXECUTION);
  });

  it('resolves a duplicated MARK_RUNNING from the same execution as ALREADY_APPLIED', async () => {
    const harness = newHarness();
    const { decisionId } = await runningExecutionA(harness);

    const outcome = await markRunning(harness.repository, statusInput({ decisionId }), {
      executionArn: EXEC_A,
      ...clockAt(T0 + 200),
      executionDeadlineMs: EXECUTION_DEADLINE_MS,
    });

    // Express is at-least-once. A retried first state is not a fencing event.
    expect(outcome.result).toBe(StatusActionResult.ALREADY_APPLIED);
  });

  it('reads with strong consistency when confirming a failed guard', async () => {
    const harness = newHarness();
    await firstLease(harness);
    await markRunning(harness.repository, statusInput({ attemptCount: 2 }), {
      executionArn: EXEC_B,
      ...clockAt(T0 + 100),
      executionDeadlineMs: EXECUTION_DEADLINE_MS,
    });

    expect(harness.table.consistentReads).toEqual([true]);
  });
});

// ─── Step 3: staleness detection (TASK-092) ────────────────

describe('chain step 3 · staleness detection (TASK-092)', () => {
  it('treats a running execution inside its deadline as healthy', async () => {
    const harness = newHarness();
    await runningExecutionA(harness);
    const record = await harness.repository.getConsistent(IDEMPOTENCY_KEY);

    expect(isStaleRunning(record as IdempotencyRecord, T0 + 1_000)).toBe(false);
  });

  it('treats a running execution past its deadline as stale', async () => {
    const harness = newHarness();
    await runningExecutionA(harness);
    const record = await harness.repository.getConsistent(IDEMPOTENCY_KEY);

    expect(isStaleRunning(record as IdempotencyRecord, T0 + 100 + EXECUTION_DEADLINE_MS + 1)).toBe(
      true,
    );
  });

  it('does not treat a starting record as stale, however old', async () => {
    const harness = newHarness();
    const { record } = await firstLease(harness);

    // No deadline yet means registration has not completed; the execution may
    // still be starting normally.
    expect(isStaleRunning(record, T0 + 10_000_000)).toBe(false);
  });
});

// ─── Step 4: recovery gate grading (TASK-093) ──────────────

describe('chain step 4 · recovery gate grading (TASK-093)', () => {
  it('recommends FULL_WORKFLOW when no core is committed', async () => {
    const harness = newHarness();
    const { decisionId } = await runningExecutionA(harness);

    const gate = await evaluateRecoveryGate(harness.gatePorts(null), {
      idempotencyKey: IDEMPOTENCY_KEY,
      decisionId,
    });

    expect(gate.effective_core_committed).toBe(false);
    expect(gate.recommended_recovery_mode).toBe(RecoveryMode.FULL_WORKFLOW);
  });

  it('recommends ENRICHMENT_ONLY when a DecisionCore row exists', async () => {
    const harness = newHarness();
    const { decisionId } = await runningExecutionA(harness);

    const gate = await evaluateRecoveryGate(harness.gatePorts(committedCore()), {
      idempotencyKey: IDEMPOTENCY_KEY,
      decisionId,
    });

    expect(gate.core_exists).toBe(true);
    expect(gate.recommended_recovery_mode).toBe(RecoveryMode.ENRICHMENT_ONLY);
  });

  it('treats the core as committed when the row exists but the flag was never written', async () => {
    const harness = newHarness();
    const { decisionId } = await runningExecutionA(harness);

    const gate = await evaluateRecoveryGate(harness.gatePorts(committedCore()), {
      idempotencyKey: IDEMPOTENCY_KEY,
      decisionId,
    });

    // MARK_CORE_COMMITTED can fail AFTER the core landed. Trusting only the flag
    // would send recovery down FULL_WORKFLOW and rewrite an immutable core.
    expect(gate.idempotency_core_committed).toBe(false);
    expect(gate.effective_core_committed).toBe(true);
  });

  it('supplies the three external fencing terms from the record', async () => {
    const harness = newHarness();
    const { decisionId } = await runningExecutionA(harness);

    const gate = await evaluateRecoveryGate(harness.gatePorts(null), {
      idempotencyKey: IDEMPOTENCY_KEY,
      decisionId,
    });

    expect(gate.expected_stale_execution_arn).toBe(EXEC_A);
    expect(gate.expected_attempt).toBe(1);
    expect(gate.observed_running_deadline_at).toBe(T0 + 100 + EXECUTION_DEADLINE_MS);
  });

  it('writes nothing', async () => {
    const harness = newHarness();
    const { decisionId } = await runningExecutionA(harness);
    const before = JSON.stringify(harness.table.item());
    const writesBefore = harness.table.putAttempts + harness.table.updateAttempts;

    await evaluateRecoveryGate(harness.gatePorts(null), {
      idempotencyKey: IDEMPOTENCY_KEY,
      decisionId,
    });

    expect(harness.table.putAttempts + harness.table.updateAttempts).toBe(writesBefore);
    expect(JSON.stringify(harness.table.item())).toBe(before);
  });
});

// ─── Step 5: external fencing reconcile (TASK-091) ─────────

describe('chain step 5 · RECONCILE_STALE_RUNNING external fencing (TASK-091)', () => {
  const STALE_NOW = T0 + 100 + EXECUTION_DEADLINE_MS + 5_000;

  async function stalePair(harness: Harness): Promise<{
    expectedStaleExecutionArn: string;
    expectedAttempt: number;
    observedRunningDeadlineAt: number;
  }> {
    const { decisionId } = await runningExecutionA(harness);
    const gate = await evaluateRecoveryGate(harness.gatePorts(null), {
      idempotencyKey: IDEMPOTENCY_KEY,
      decisionId,
    });
    return {
      expectedStaleExecutionArn: gate.expected_stale_execution_arn as string,
      expectedAttempt: gate.expected_attempt as number,
      observedRunningDeadlineAt: gate.observed_running_deadline_at as number,
    };
  }

  it('reconciles running → processing_failed and keeps it retryable', async () => {
    const harness = newHarness();
    const terms = await stalePair(harness);

    const outcome = await reconcileStaleRunning(harness.repository, {
      idempotencyKey: IDEMPOTENCY_KEY,
      ...terms,
      effectiveCoreCommitted: false,
      ...clockAt(STALE_NOW),
    });

    expect(outcome.result).toBe(StatusActionResult.APPLIED);
    expect(harness.table.item()).toMatchObject({
      status: IdempotencyStatus.processing_failed,
      retryable: true,
      recovery_stage: RecoveryStage.FULL_WORKFLOW,
    });
  });

  it('grades recovery_stage ENRICHMENT_ONLY when a core is already committed', async () => {
    const harness = newHarness();
    const terms = await stalePair(harness);

    await reconcileStaleRunning(harness.repository, {
      idempotencyKey: IDEMPOTENCY_KEY,
      ...terms,
      effectiveCoreCommitted: true,
      ...clockAt(STALE_NOW),
    });

    expect(harness.table.item()).toMatchObject({
      recovery_stage: RecoveryStage.ENRICHMENT_ONLY,
    });
  });

  it('refuses to reconcile a still-healthy execution', async () => {
    const harness = newHarness();
    const terms = await stalePair(harness);

    // `running_deadline_at < now` is false: the execution is still within budget.
    const outcome = await reconcileStaleRunning(harness.repository, {
      idempotencyKey: IDEMPOTENCY_KEY,
      ...terms,
      effectiveCoreCommitted: false,
      ...clockAt(T0 + 200),
    });

    expect(outcome.result).toBe(StatusActionResult.FENCED_STALE_EXECUTION);
    expect(harness.table.item()).toMatchObject({ status: IdempotencyStatus.running });
  });

  it('refuses to reconcile when the deadline moved since the gate read it', async () => {
    const harness = newHarness();
    const terms = await stalePair(harness);
    // A lost-update guard: something changed the record after the gate read.
    harness.table.patch({ running_deadline_at: terms.observedRunningDeadlineAt + 1 });

    const outcome = await reconcileStaleRunning(harness.repository, {
      idempotencyKey: IDEMPOTENCY_KEY,
      ...terms,
      effectiveCoreCommitted: false,
      ...clockAt(STALE_NOW),
    });

    expect(outcome.result).toBe(StatusActionResult.FENCED_STALE_EXECUTION);
  });

  it('lets only one of two concurrent reconcilers win', async () => {
    const harness = newHarness();
    const terms = await stalePair(harness);

    const results = await Promise.all([
      reconcileStaleRunning(harness.repository, {
        idempotencyKey: IDEMPOTENCY_KEY,
        ...terms,
        effectiveCoreCommitted: false,
        ...clockAt(STALE_NOW),
      }),
      reconcileStaleRunning(harness.repository, {
        idempotencyKey: IDEMPOTENCY_KEY,
        ...terms,
        effectiveCoreCommitted: false,
        ...clockAt(STALE_NOW),
      }),
    ]);

    // The loser sees the target already reached for the same stale pair, which is
    // ALREADY_APPLIED rather than a fencing event.
    expect(results.map((outcome) => outcome.result).sort()).toEqual(
      [StatusActionResult.ALREADY_APPLIED, StatusActionResult.APPLIED].sort(),
    );
  });
});

// ─── Step 6: staged recovery re-lease (TASK-094) ───────────

describe('chain step 6 · staged recovery re-lease (TASK-094)', () => {
  const STALE_NOW = T0 + 100 + EXECUTION_DEADLINE_MS + 5_000;

  async function reconciled(harness: Harness, effectiveCoreCommitted = false): Promise<void> {
    const { decisionId } = await runningExecutionA(harness);
    const gate = await evaluateRecoveryGate(
      harness.gatePorts(effectiveCoreCommitted ? committedCore() : null),
      { idempotencyKey: IDEMPOTENCY_KEY, decisionId },
    );
    await reconcileStaleRunning(harness.repository, {
      idempotencyKey: IDEMPOTENCY_KEY,
      expectedStaleExecutionArn: gate.expected_stale_execution_arn as string,
      expectedAttempt: gate.expected_attempt as number,
      observedRunningDeadlineAt: gate.observed_running_deadline_at as number,
      effectiveCoreCommitted,
      ...clockAt(STALE_NOW),
    });
  }

  it('returns status to starting, increments the attempt and clears the stale ARN', async () => {
    const harness = newHarness();
    await reconciled(harness);

    const outcome = await recoverFromProcessingFailed(harness.repository, {
      idempotencyKey: IDEMPOTENCY_KEY,
      newLeaseOwner: 'req-2',
      currentAttemptCount: 1,
      previousLastError: 'STALE_RUNNING_EXECUTION',
      clock: clockAt(STALE_NOW),
      leaseTtlMs: LEASE_TTL_MS,
      effectiveCoreCommitted: false,
    });

    expect(outcome.outcome).toBe('LEASE_ACQUIRED');
    expect(harness.table.item()).toMatchObject({
      status: IdempotencyStatus.starting,
      attempt_count: 2,
      lease_owner: 'req-2',
      recovery_mode: RecoveryMode.FULL_WORKFLOW,
    });
    // The old execution's ARN must not survive to satisfy a fencing guard.
    expect(harness.table.item()).not.toHaveProperty('workflow_execution_arn');
  });

  it('preserves the cause in previous_last_error and clears last_error', async () => {
    const harness = newHarness();
    await reconciled(harness);

    await recoverFromProcessingFailed(harness.repository, {
      idempotencyKey: IDEMPOTENCY_KEY,
      newLeaseOwner: 'req-2',
      currentAttemptCount: 1,
      previousLastError: 'STALE_RUNNING_EXECUTION',
      clock: clockAt(STALE_NOW),
      leaseTtlMs: LEASE_TTL_MS,
      effectiveCoreCommitted: false,
    });

    expect(harness.table.item()).toMatchObject({
      previous_last_error: 'STALE_RUNNING_EXECUTION',
      last_error: null,
      retryable: true,
    });
  });

  it('selects ENRICHMENT_ONLY when the gate saw a committed core', async () => {
    const harness = newHarness();
    await reconciled(harness, true);

    const outcome = await recoverFromProcessingFailed(harness.repository, {
      idempotencyKey: IDEMPOTENCY_KEY,
      newLeaseOwner: 'req-2',
      currentAttemptCount: 1,
      previousLastError: null,
      clock: clockAt(STALE_NOW),
      leaseTtlMs: LEASE_TTL_MS,
      effectiveCoreCommitted: true,
    });

    if (outcome.outcome !== 'LEASE_ACQUIRED') throw new Error('expected LEASE_ACQUIRED');
    // ENRICHMENT_ONLY must never re-run DecisionFn: the core is immutable.
    expect(outcome.recoveryMode).toBe(RecoveryMode.ENRICHMENT_ONLY);
  });

  it('cannot revive a terminal conflict (retryable=false)', async () => {
    const harness = newHarness();
    await reconciled(harness);
    // What MARK_PROCESSING_FAILED writes for CORE_IDENTITY_CONFLICT.
    harness.table.patch({ retryable: false, recovery_stage: RecoveryStage.NONE });

    const outcome = await recoverFromProcessingFailed(harness.repository, {
      idempotencyKey: IDEMPOTENCY_KEY,
      newLeaseOwner: 'req-2',
      currentAttemptCount: 1,
      previousLastError: 'CORE_IDENTITY_CONFLICT',
      clock: clockAt(STALE_NOW),
      leaseTtlMs: LEASE_TTL_MS,
      effectiveCoreCommitted: false,
    });

    // The guard requires retryable=true, so a terminal conflict simply cannot be
    // retried into overwriting a committed core.
    expect(outcome.outcome).toBe('RACE_LOST');
    expect(harness.table.item()).toMatchObject({
      status: IdempotencyStatus.processing_failed,
      attempt_count: 1,
    });
  });

  it('lets only one of two concurrent recovery requests take the lease', async () => {
    const harness = newHarness();
    await reconciled(harness);

    const attempt = (owner: string): Promise<{ outcome: string }> =>
      recoverFromProcessingFailed(harness.repository, {
        idempotencyKey: IDEMPOTENCY_KEY,
        newLeaseOwner: owner,
        currentAttemptCount: 1,
        previousLastError: null,
        clock: clockAt(STALE_NOW),
        leaseTtlMs: LEASE_TTL_MS,
        effectiveCoreCommitted: false,
      });

    const outcomes = (await Promise.all([attempt('req-2'), attempt('req-3')])).map(
      (result) => result.outcome,
    );

    expect(outcomes.filter((outcome) => outcome === 'LEASE_ACQUIRED')).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome === 'RACE_LOST')).toHaveLength(1);
    expect(harness.table.item()).toMatchObject({ attempt_count: 2 });
  });

  it('does not steal a start lease that has not expired', async () => {
    const harness = newHarness();
    await firstLease(harness, 'req-1', T0);

    const outcome = await reacquireExpiredStartingLease(harness.repository, {
      idempotencyKey: IDEMPOTENCY_KEY,
      newLeaseOwner: 'req-2',
      currentAttemptCount: 1,
      previousLastError: null,
      // Still inside leaseTtlMs.
      clock: clockAt(T0 + 1_000),
      leaseTtlMs: LEASE_TTL_MS,
    });

    expect(outcome.outcome).toBe('RACE_LOST');
    expect(harness.table.item()).toMatchObject({ lease_owner: 'req-1', attempt_count: 1 });
  });

  it('re-leases an expired starting lease', async () => {
    const harness = newHarness();
    await firstLease(harness, 'req-1', T0);

    const outcome = await reacquireExpiredStartingLease(harness.repository, {
      idempotencyKey: IDEMPOTENCY_KEY,
      newLeaseOwner: 'req-2',
      currentAttemptCount: 1,
      previousLastError: null,
      clock: clockAt(T0 + LEASE_TTL_MS + 1),
      leaseTtlMs: LEASE_TTL_MS,
    });

    expect(outcome.outcome).toBe('LEASE_ACQUIRED');
    expect(harness.table.item()).toMatchObject({ attempt_count: 2, lease_owner: 'req-2' });
  });

  it('recovers a start_failed record without needing a gate read', async () => {
    const harness = newHarness();
    await firstLease(harness);
    harness.table.patch({
      status: IdempotencyStatus.start_failed,
      last_error: 'START_EXECUTION_FAILED',
    });

    const outcome = await recoverFromStartFailed(harness.repository, {
      idempotencyKey: IDEMPOTENCY_KEY,
      newLeaseOwner: 'req-2',
      currentAttemptCount: 1,
      previousLastError: 'START_EXECUTION_FAILED',
      clock: clockAt(T0 + 5_000),
      leaseTtlMs: LEASE_TTL_MS,
    });

    if (outcome.outcome !== 'LEASE_ACQUIRED') throw new Error('expected LEASE_ACQUIRED');
    // The workflow never ran, so no core can exist. Always FULL_WORKFLOW.
    expect(outcome.recoveryMode).toBe(RecoveryMode.FULL_WORKFLOW);
  });
});

// ─── Step 7: the zombie execution is powerless ─────────────

describe('chain step 7 · a revived execution can write nothing', () => {
  const STALE_NOW = T0 + 100 + EXECUTION_DEADLINE_MS + 5_000;

  /** Full takeover: A crashes, B owns attempt 2 and is running. */
  async function afterTakeover(harness: Harness): Promise<{ decisionId: string }> {
    const { decisionId } = await runningExecutionA(harness);
    const result = await orchestrateStaleRunning(
      {
        invokeRecoveryGate: (input) => evaluateRecoveryGate(harness.gatePorts(null), input),
        invokeReconcileStaleRunning: (input) => reconcileStaleRunning(harness.repository, input),
        repository: harness.repository,
      },
      {
        record: (await harness.repository.getConsistent(IDEMPOTENCY_KEY)) as IdempotencyRecord,
        lease: {
          idempotencyKey: IDEMPOTENCY_KEY,
          newLeaseOwner: 'req-2',
          clock: clockAt(STALE_NOW),
          leaseTtlMs: LEASE_TTL_MS,
        },
      },
    );
    expect(result.outcome).toBe('RECOVERED');

    const registered = await markRunning(
      harness.repository,
      statusInput({
        decisionId,
        attemptCount: 2,
        leaseOwner: 'req-2',
        recoveryMode: RecoveryMode.FULL_WORKFLOW,
      }),
      {
        executionArn: EXEC_B,
        ...clockAt(STALE_NOW + 10),
        executionDeadlineMs: EXECUTION_DEADLINE_MS,
      },
    );
    expect(registered.result).toBe(StatusActionResult.APPLIED);
    return { decisionId };
  }

  it('drives the whole takeover end to end', async () => {
    const harness = newHarness();

    await afterTakeover(harness);

    expect(harness.table.item()).toMatchObject({
      status: IdempotencyStatus.running,
      attempt_count: 2,
      workflow_execution_arn: EXEC_B,
      recovery_mode: RecoveryMode.FULL_WORKFLOW,
    });
  });

  it('fences the crashed execution out of MARK_CORE_COMMITTED', async () => {
    const harness = newHarness();
    const { decisionId } = await afterTakeover(harness);

    // Execution A wakes up and tries to announce a core it may never have written.
    const outcome = await markCoreCommitted(harness.repository, statusInput({ decisionId }), {
      executionArn: EXEC_A,
      ...clockAt(STALE_NOW + 20),
      evidenceSource: EvidenceSource.DECISIONFN_COMMITTED,
    });

    expect(outcome.result).toBe(StatusActionResult.FENCED_STALE_EXECUTION);
    expect(harness.table.item()).toMatchObject({ core_committed: false });
  });

  it('fences the crashed execution even if it claims the new attempt number', async () => {
    const harness = newHarness();
    const { decisionId } = await afterTakeover(harness);

    const outcome = await markCoreCommitted(
      harness.repository,
      statusInput({ decisionId, attemptCount: 2 }),
      {
        executionArn: EXEC_A,
        ...clockAt(STALE_NOW + 20),
        evidenceSource: EvidenceSource.DECISIONFN_COMMITTED,
      },
    );

    // Attempt fencing alone is not enough; the ARN must match too.
    expect(outcome.result).toBe(StatusActionResult.FENCED_STALE_EXECUTION);
  });

  it('fences a stale MARK_RUNNING from the crashed execution', async () => {
    const harness = newHarness();
    const { decisionId } = await afterTakeover(harness);

    const outcome = await markRunning(harness.repository, statusInput({ decisionId }), {
      executionArn: EXEC_A,
      ...clockAt(STALE_NOW + 20),
      executionDeadlineMs: EXECUTION_DEADLINE_MS,
    });

    expect(outcome.result).toBe(StatusActionResult.FENCED_STALE_EXECUTION);
    expect(harness.table.item()).toMatchObject({ workflow_execution_arn: EXEC_B });
  });

  it('lets the current attempt commit the core', async () => {
    const harness = newHarness();
    const { decisionId } = await afterTakeover(harness);

    const outcome = await markCoreCommitted(
      harness.repository,
      statusInput({
        decisionId,
        attemptCount: 2,
        leaseOwner: 'req-2',
        recoveryMode: RecoveryMode.FULL_WORKFLOW,
      }),
      {
        executionArn: EXEC_B,
        ...clockAt(STALE_NOW + 20),
        evidenceSource: EvidenceSource.DECISIONFN_COMMITTED,
      },
    );

    expect(outcome.result).toBe(StatusActionResult.APPLIED);
    expect(harness.table.item()).toMatchObject({
      core_committed: true,
      evidence_source: EvidenceSource.DECISIONFN_COMMITTED,
    });
  });

  it('increments attempt_count monotonically across two takeovers', async () => {
    const harness = newHarness();
    await afterTakeover(harness);

    const secondTakeover = await orchestrateStaleRunning(
      {
        invokeRecoveryGate: (input) => evaluateRecoveryGate(harness.gatePorts(null), input),
        invokeReconcileStaleRunning: (input) => reconcileStaleRunning(harness.repository, input),
        repository: harness.repository,
      },
      {
        record: (await harness.repository.getConsistent(IDEMPOTENCY_KEY)) as IdempotencyRecord,
        lease: {
          idempotencyKey: IDEMPOTENCY_KEY,
          newLeaseOwner: 'req-3',
          clock: clockAt(STALE_NOW + EXECUTION_DEADLINE_MS + 10_000),
          leaseTtlMs: LEASE_TTL_MS,
        },
      },
    );

    expect(secondTakeover.outcome).toBe('RECOVERED');
    expect(harness.table.item()).toMatchObject({ attempt_count: 3 });
  });

  it('reports NOT_STALE and writes nothing for a healthy running execution', async () => {
    const harness = newHarness();
    await runningExecutionA(harness);
    const writesBefore = harness.table.updateAttempts;

    const result = await orchestrateStaleRunning(
      {
        invokeRecoveryGate: () => {
          throw new Error('the gate must not be invoked for a healthy execution');
        },
        invokeReconcileStaleRunning: () => {
          throw new Error('reconciliation must not be attempted for a healthy execution');
        },
        repository: harness.repository,
      },
      {
        record: (await harness.repository.getConsistent(IDEMPOTENCY_KEY)) as IdempotencyRecord,
        lease: {
          idempotencyKey: IDEMPOTENCY_KEY,
          newLeaseOwner: 'req-2',
          clock: clockAt(T0 + 1_000),
          leaseTtlMs: LEASE_TTL_MS,
        },
      },
    );

    expect(result.outcome).toBe('NOT_STALE');
    expect(harness.table.updateAttempts).toBe(writesBefore);
  });
});

// ─── MARK_CORE_COMMITTED once-only (TASK-102) ──────────────

describe('MARK_CORE_COMMITTED is once-only (TASK-102)', () => {
  it('resolves a repeat from the same execution as ALREADY_APPLIED', async () => {
    const harness = newHarness();
    const { decisionId } = await runningExecutionA(harness);
    const context = {
      executionArn: EXEC_A,
      ...clockAt(T0 + 500),
      evidenceSource: EvidenceSource.DECISIONFN_COMMITTED,
    };

    await markCoreCommitted(harness.repository, statusInput({ decisionId }), context);
    const second = await markCoreCommitted(
      harness.repository,
      statusInput({ decisionId }),
      context,
    );

    expect(second.result).toBe(StatusActionResult.ALREADY_APPLIED);
  });

  it('does not overwrite the original evidence source on a repeat', async () => {
    const harness = newHarness();
    const { decisionId } = await runningExecutionA(harness);

    await markCoreCommitted(harness.repository, statusInput({ decisionId }), {
      executionArn: EXEC_A,
      ...clockAt(T0 + 500),
      evidenceSource: EvidenceSource.DECISIONFN_COMMITTED,
    });
    await markCoreCommitted(harness.repository, statusInput({ decisionId }), {
      executionArn: EXEC_A,
      ...clockAt(T0 + 600),
      evidenceSource: EvidenceSource.RECOVERY_GATE_CORE_EXISTS,
    });

    // `core_committed=false` is in the guard, so the second write never applies.
    expect(harness.table.item()).toMatchObject({
      evidence_source: EvidenceSource.DECISIONFN_COMMITTED,
    });
  });

  it('accepts RECOVERY_GATE_CORE_EXISTS as evidence on the ENRICHMENT_ONLY path', async () => {
    const harness = newHarness();
    const { decisionId } = await runningExecutionA(harness);

    const outcome = await markCoreCommitted(harness.repository, statusInput({ decisionId }), {
      executionArn: EXEC_A,
      ...clockAt(T0 + 500),
      evidenceSource: EvidenceSource.RECOVERY_GATE_CORE_EXISTS,
    });

    // Persisting the flag here is what prevents `completed` with
    // `core_committed=false` while a DecisionCore actually exists.
    expect(outcome.result).toBe(StatusActionResult.APPLIED);
    expect(harness.table.item()).toMatchObject({
      core_committed: true,
      evidence_source: EvidenceSource.RECOVERY_GATE_CORE_EXISTS,
    });
  });
});

// ─── Every write was guarded ───────────────────────────────

describe('no unguarded write reached the table', () => {
  it('guards every Put and Update issued across the whole chain', async () => {
    const harness = newHarness();
    const STALE_NOW = T0 + 100 + EXECUTION_DEADLINE_MS + 5_000;
    const { decisionId } = await runningExecutionA(harness);

    const gate = await evaluateRecoveryGate(harness.gatePorts(null), {
      idempotencyKey: IDEMPOTENCY_KEY,
      decisionId,
    });
    await reconcileStaleRunning(harness.repository, {
      idempotencyKey: IDEMPOTENCY_KEY,
      expectedStaleExecutionArn: gate.expected_stale_execution_arn as string,
      expectedAttempt: gate.expected_attempt as number,
      observedRunningDeadlineAt: gate.observed_running_deadline_at as number,
      effectiveCoreCommitted: false,
      ...clockAt(STALE_NOW),
    });
    await recoverFromProcessingFailed(harness.repository, {
      idempotencyKey: IDEMPOTENCY_KEY,
      newLeaseOwner: 'req-2',
      currentAttemptCount: 1,
      previousLastError: null,
      clock: clockAt(STALE_NOW),
      leaseTtlMs: LEASE_TTL_MS,
      effectiveCoreCommitted: false,
    });

    expect(harness.table.conditionExpressions.length).toBeGreaterThanOrEqual(4);
    for (const expression of harness.table.conditionExpressions) {
      expect(expression.length).toBeGreaterThan(0);
    }
    // Every Update additionally proves the item exists, so no Update can upsert.
    const updates = harness.table.conditionExpressions.filter((expression) =>
      expression.includes('attribute_exists'),
    );
    expect(updates.length).toBeGreaterThanOrEqual(3);
  });
});
