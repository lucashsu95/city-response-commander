/**
 * IdempotencyRepository — deterministic data-access primitives for the
 * IdempotencyTable lease / status state machine (design §10.11e, §15.2).
 *
 * TASK-085. Shared by:
 *   - `InjectFn`        (TASK-086..088, 092, 094, 096) — lease + recovery transitions
 *   - `WorkflowStatusFn`(TASK-089..091, 095, 102)      — the 5 fenced status actions
 *   - `RecoveryGateFn`  (TASK-093)                      — strong-consistent READ ONLY
 *   - `ApiReadFn`       (TASK-149)                      — read-only `execution` summary (FIX 1)
 *
 * This module owns THREE primitives and nothing else. It contains no business
 * rules: which status may transition to which, and which fencing values apply,
 * are decided by the caller (TASK-086..096) and expressed declaratively through
 * {@link IdempotencyGuard}. That keeps the DynamoDB expression syntax in one
 * place while leaving the state machine itself in the handlers that own it.
 *
 * Invariants enforced here (in addition to IAM, §18):
 *  - Every write is conditional. An unguarded update is rejected as a usage
 *    error, so this table can never be blind-written.
 *  - `conditionalUpdateState` always requires `attribute_exists(idempotency_key)`,
 *    so a DynamoDB Update can never silently upsert a partial record.
 *  - `ConditionalCheckFailedException` is never swallowed. It is surfaced as
 *    {@link IdempotencyConditionFailedError} so the caller can run the
 *    apply-or-confirm protocol (§10.11e) — a strongly-consistent re-read that
 *    classifies the outcome as ALREADY_APPLIED or FENCED_STALE_EXECUTION.
 *  - Read paths use `ConsistentRead: true`. Recovery truth is never derived from
 *    an eventually-consistent read.
 *  - No wall-clock access. Every timestamp / deadline is supplied by the caller,
 *    which keeps the state machine deterministic and testable.
 *
 * FIX 2 (writer isolation) note: `DecisionFn` has zero write access to this
 * table. Components that must only read should depend on {@link IdempotencyReader}
 * (via {@link createIdempotencyReader}) so the write primitives are not even
 * present on the type they hold.
 *
 * @module backend/repository/idempotency_repository
 */

import { ConditionalCheckFailedException, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb';
import type { IdempotencyRecord } from '@city-commander/shared-schemas';

// ─── Operation identifiers ─────────────────────────────────

/** Repository operation, carried on every error for structured logging. */
export type IdempotencyOperation = 'conditionalPutNew' | 'conditionalUpdateState' | 'getConsistent';

// ─── Errors ────────────────────────────────────────────────

/**
 * Base repository error. Any non-conditional DynamoDB failure (throttling,
 * access denied, network) is wrapped in this and re-thrown — fail-closed,
 * never degraded into a false success.
 */
export class IdempotencyRepositoryError extends Error {
  constructor(
    message: string,
    public readonly operation: IdempotencyOperation,
    public readonly idempotencyKey: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'IdempotencyRepositoryError';
  }
}

/**
 * A `ConditionExpression` was not satisfied.
 *
 * This is an EXPECTED control-flow outcome, not a bug:
 *  - `conditionalPutNew`  → the key already exists (duplicate injection).
 *  - `conditionalUpdateState` → the guard did not match, i.e. either the
 *    transition was already applied, or this execution/attempt has been fenced
 *    out by a newer one.
 *
 * The caller MUST resolve which of the two it is by re-reading with
 * {@link IdempotencyRepository.getConsistent} (apply-or-confirm, §10.11e).
 * This error deliberately carries no item snapshot, so the mandated
 * strongly-consistent re-read cannot be skipped.
 */
export class IdempotencyConditionFailedError extends IdempotencyRepositoryError {
  /** Stable machine-readable discriminator. */
  public readonly code = 'CONDITIONAL_CHECK_FAILED' as const;

  constructor(
    message: string,
    operation: IdempotencyOperation,
    idempotencyKey: string,
    options?: { cause?: unknown },
  ) {
    super(message, operation, idempotencyKey, options);
    this.name = 'IdempotencyConditionFailedError';
  }
}

/**
 * The repository was called in a way that can never be correct — an empty
 * guard, a mutation that touches the partition key, or a field that is both set
 * and removed. This is a programming error, surfaced eagerly instead of being
 * sent to DynamoDB.
 */
export class IdempotencyUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'IdempotencyUsageError';
  }
}

// ─── Guard (ConditionExpression) ───────────────────────────

/**
 * Declarative pre-condition for a state transition.
 *
 * Every field is ANDed. At least one field is required. The shape covers
 * exactly the conditions design §10.11e specifies and nothing more:
 *
 * | Caller / action                          | Guard fields |
 * | ---------------------------------------- | ------------ |
 * | `MARK_RUNNING`                           | `status`, `lease_owner`, `attempt_count`, `recovery_mode` |
 * | `MARK_CORE_COMMITTED`                    | `status`, `workflow_execution_arn`, `attempt_count`, `core_committed:false` |
 * | `MARK_COMPLETED`                         | `status`, `workflow_execution_arn`, `attempt_count` |
 * | `MARK_PROCESSING_FAILED`                 | `status`, `workflow_execution_arn`, `attempt_count` |
 * | `RECONCILE_STALE_RUNNING` (FIX 3)        | `status`, `workflow_execution_arn` (= expected stale ARN), `attempt_count` (= expected attempt), `running_deadline_at` (= observed), `running_deadline_at_lt` (= now) |
 * | `starting → start_failed`                | `status`, `lease_owner`, `attempt_count` |
 * | `start_failed → starting`                | `status` |
 * | `processing_failed → starting`            | `status`, `retryable:true` |
 * | expired `starting → starting`            | `status`, `lease_expires_at_lt` (= now) |
 */
export interface IdempotencyGuard {
  /** `status = :v`, or `status IN (...)` when an array is given. */
  readonly status?: IdempotencyRecord['status'] | readonly IdempotencyRecord['status'][];
  /** `lease_owner = :v` — the lease holder asserting the transition. */
  readonly lease_owner?: string;
  /** `attempt_count = :v` — attempt fencing. */
  readonly attempt_count?: number;
  /** `recovery_mode = :v`. */
  readonly recovery_mode?: IdempotencyRecord['recovery_mode'];
  /**
   * `workflow_execution_arn = :v` — execution fencing.
   * For the four in-workflow actions this is `$$.Execution.Id`; for
   * `RECONCILE_STALE_RUNNING` it is `expected_stale_execution_arn` (FIX 3).
   */
  readonly workflow_execution_arn?: string;
  /** `core_committed = :v` (MARK_CORE_COMMITTED guards on `false`). */
  readonly core_committed?: boolean;
  /** `retryable = :v` (recovery from `processing_failed` requires `true`). */
  readonly retryable?: boolean;
  /** `running_deadline_at = :v` — the exact deadline observed by RecoveryGateFn. */
  readonly running_deadline_at?: number;
  /** `running_deadline_at < :v` — proves the running execution is stale. */
  readonly running_deadline_at_lt?: number;
  /** `lease_expires_at < :v` — proves the start lease has expired. */
  readonly lease_expires_at_lt?: number;
}

// ─── Mutation (UpdateExpression) ───────────────────────────

/** Fields that may be cleared with `REMOVE` (all are nullable in the record). */
export type ClearableIdempotencyField =
  | 'lease_owner'
  | 'lease_expires_at'
  | 'last_error'
  | 'previous_last_error'
  | 'workflow_execution_arn'
  | 'running_started_at'
  | 'running_deadline_at'
  | 'completed_execution_arn'
  | 'completed_attempt_count'
  | 'last_transition_execution_arn'
  | 'last_transition_attempt_count'
  | 'evidence_source';

/** Attributes writable by a state transition (the partition key is excluded). */
export type IdempotencyMutableFields = Omit<IdempotencyRecord, 'idempotency_key'>;

/** What a state transition writes. At least one clause is required. */
export interface IdempotencyMutation {
  /** `SET` — assigns absolute values. `undefined` entries are ignored. */
  readonly set?: Partial<IdempotencyMutableFields>;
  /** `REMOVE` — clears an attribute (e.g. `running_deadline_at` on completion). */
  readonly remove?: readonly ClearableIdempotencyField[];
  /** `SET attempt_count = attempt_count + :n` — used by recovery re-lease. */
  readonly incrementAttemptCount?: number;
}

/** Arguments for {@link IdempotencyRepository.conditionalUpdateState}. */
export interface ConditionalUpdateStateInput {
  readonly idempotencyKey: string;
  readonly guard: IdempotencyGuard;
  readonly mutation: IdempotencyMutation;
}

// ─── Construction options ──────────────────────────────────

/** Repository construction options. The table name always comes from config. */
export interface IdempotencyRepositoryOptions {
  /** DynamoDB table name, resolved via `ConfigProvider` — never hard-coded. */
  readonly tableName: string;
  /** Pre-built DocumentClient. Injected in tests; built on demand otherwise. */
  readonly documentClient?: DynamoDBDocumentClient;
  /** Low-level client used only when `documentClient` is absent. */
  readonly dynamoDbClient?: DynamoDBClient;
  /** Region for an on-demand client. Ignored when a client is supplied. */
  readonly region?: string;
}

/**
 * Read-only view of the IdempotencyTable.
 *
 * Held by components that must not write (RecoveryGateFn §18 / TASK-080,
 * ApiReadFn §18 / TASK-081). The write primitives are absent from this type, so
 * a write is a compile error rather than a runtime IAM denial.
 */
export interface IdempotencyReader {
  getConsistent(idempotencyKey: string): Promise<IdempotencyRecord | null>;
}

// ─── Expression builder ────────────────────────────────────

/**
 * Allocates `#name` / `:value` placeholders.
 *
 * Every attribute name is aliased, which sidesteps the DynamoDB reserved-word
 * list entirely (`status` is reserved, and future fields may be too).
 */
class ExpressionPlaceholders {
  private readonly nameByAttribute = new Map<string, string>();
  private readonly valueByPlaceholder = new Map<string, unknown>();
  private valueSeq = 0;

  name(attribute: string): string {
    const existing = this.nameByAttribute.get(attribute);
    if (existing !== undefined) return existing;
    const placeholder = `#n${this.nameByAttribute.size}`;
    this.nameByAttribute.set(attribute, placeholder);
    return placeholder;
  }

  value(value: unknown): string {
    const placeholder = `:v${this.valueSeq++}`;
    this.valueByPlaceholder.set(placeholder, value);
    return placeholder;
  }

  get names(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [attribute, placeholder] of this.nameByAttribute) out[placeholder] = attribute;
    return out;
  }

  get values(): Record<string, unknown> {
    return Object.fromEntries(this.valueByPlaceholder);
  }

  get hasValues(): boolean {
    return this.valueByPlaceholder.size > 0;
  }
}

/** Builds the ANDed `ConditionExpression` fragments for a guard. */
function buildGuardConditions(guard: IdempotencyGuard, ph: ExpressionPlaceholders): string[] {
  const conditions: string[] = [];

  const eq = (attribute: string, value: unknown): void => {
    conditions.push(`${ph.name(attribute)} = ${ph.value(value)}`);
  };
  const lt = (attribute: string, value: unknown): void => {
    conditions.push(`${ph.name(attribute)} < ${ph.value(value)}`);
  };

  if (guard.status !== undefined) {
    if (Array.isArray(guard.status)) {
      const statuses = guard.status as readonly IdempotencyRecord['status'][];
      if (statuses.length === 0) {
        throw new IdempotencyUsageError('Guard "status" was an empty array; it can never match.');
      }
      const placeholders = statuses.map((status) => ph.value(status)).join(', ');
      conditions.push(`${ph.name('status')} IN (${placeholders})`);
    } else {
      eq('status', guard.status);
    }
  }
  if (guard.lease_owner !== undefined) eq('lease_owner', guard.lease_owner);
  if (guard.attempt_count !== undefined) eq('attempt_count', guard.attempt_count);
  if (guard.recovery_mode !== undefined) eq('recovery_mode', guard.recovery_mode);
  if (guard.workflow_execution_arn !== undefined) {
    eq('workflow_execution_arn', guard.workflow_execution_arn);
  }
  if (guard.core_committed !== undefined) eq('core_committed', guard.core_committed);
  if (guard.retryable !== undefined) eq('retryable', guard.retryable);
  if (guard.running_deadline_at !== undefined) eq('running_deadline_at', guard.running_deadline_at);
  if (guard.running_deadline_at_lt !== undefined) {
    lt('running_deadline_at', guard.running_deadline_at_lt);
  }
  if (guard.lease_expires_at_lt !== undefined) lt('lease_expires_at', guard.lease_expires_at_lt);

  return conditions;
}

/** Collects the attribute names a mutation writes, for overlap validation. */
function collectSetAttributes(mutation: IdempotencyMutation): string[] {
  const attributes: string[] = [];
  if (mutation.set) {
    for (const [attribute, value] of Object.entries(mutation.set)) {
      if (value === undefined) continue;
      attributes.push(attribute);
    }
  }
  if (mutation.incrementAttemptCount !== undefined) attributes.push('attempt_count');
  return attributes;
}

/** Validates a mutation before any network call. */
function assertMutationIsUsable(mutation: IdempotencyMutation): void {
  const setAttributes = collectSetAttributes(mutation);
  const removeAttributes = mutation.remove ?? [];

  if (setAttributes.length === 0 && removeAttributes.length === 0) {
    throw new IdempotencyUsageError(
      'Mutation is empty: provide at least one of "set", "remove" or "incrementAttemptCount".',
    );
  }
  if (setAttributes.includes('idempotency_key')) {
    throw new IdempotencyUsageError(
      'Mutation must not write "idempotency_key": the partition key is immutable.',
    );
  }
  if (mutation.set?.attempt_count !== undefined && mutation.incrementAttemptCount !== undefined) {
    throw new IdempotencyUsageError(
      'Mutation sets and increments "attempt_count"; choose exactly one.',
    );
  }

  const duplicated = setAttributes.filter((attribute) =>
    (removeAttributes as readonly string[]).includes(attribute),
  );
  if (duplicated.length > 0) {
    throw new IdempotencyUsageError(
      `Mutation both writes and removes: ${duplicated.join(', ')}. DynamoDB rejects overlapping document paths.`,
    );
  }
}

/** True when the thrown value is a DynamoDB conditional-check failure. */
function isConditionalCheckFailure(error: unknown): boolean {
  if (error instanceof ConditionalCheckFailedException) return true;
  // Mocked clients and cross-version SDK instances surface the name only.
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'ConditionalCheckFailedException'
  );
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// ─── Repository ────────────────────────────────────────────

/**
 * DynamoDB-backed IdempotencyTable repository (AWS SDK v3 DocumentClient).
 *
 * @example MARK_RUNNING (WorkflowStatusFn, TASK-089)
 * ```ts
 * await repo.conditionalUpdateState({
 *   idempotencyKey,
 *   guard: { status: IdempotencyStatus.starting, lease_owner, attempt_count, recovery_mode },
 *   mutation: {
 *     set: {
 *       status: IdempotencyStatus.running,
 *       workflow_execution_arn: executionId,
 *       running_started_at: now,
 *       running_deadline_at: now + executionDeadlineMs,
 *       last_transition_execution_arn: executionId,
 *       last_transition_attempt_count: attempt_count,
 *       updated_at: displayTimestamp,
 *     },
 *   },
 * });
 * ```
 */
export class IdempotencyRepository implements IdempotencyReader {
  private readonly tableName: string;
  private readonly client: DynamoDBDocumentClient;

  constructor(options: IdempotencyRepositoryOptions) {
    if (!options.tableName) {
      throw new IdempotencyUsageError(
        'IdempotencyRepository requires a "tableName" (resolved via ConfigProvider).',
      );
    }
    this.tableName = options.tableName;
    this.client =
      options.documentClient ??
      DynamoDBDocumentClient.from(
        options.dynamoDbClient ??
          new DynamoDBClient(options.region ? { region: options.region } : {}),
        { marshallOptions: { removeUndefinedValues: true } },
      );
  }

  /**
   * Acquire a brand-new key atomically: `attribute_not_exists(idempotency_key)`.
   *
   * Exactly one concurrent caller wins the start lease; every other caller gets
   * {@link IdempotencyConditionFailedError} and must route to same-key
   * re-request handling (TASK-088).
   *
   * @throws IdempotencyConditionFailedError when the key already exists
   * @throws IdempotencyRepositoryError on any other DynamoDB failure
   */
  async conditionalPutNew(record: IdempotencyRecord): Promise<IdempotencyRecord> {
    if (!record.idempotency_key) {
      throw new IdempotencyUsageError('conditionalPutNew requires a non-empty "idempotency_key".');
    }

    try {
      await this.client.send(
        new PutCommand({
          TableName: this.tableName,
          Item: record,
          // Single-argument form only. attribute_not_exists takes one path.
          ConditionExpression: 'attribute_not_exists(#pk)',
          ExpressionAttributeNames: { '#pk': 'idempotency_key' },
        }),
      );
      return record;
    } catch (error: unknown) {
      if (isConditionalCheckFailure(error)) {
        throw new IdempotencyConditionFailedError(
          `IdempotencyTable key already exists: "${record.idempotency_key}". ` +
            'Route to same-key re-request handling; re-read with getConsistent to classify.',
          'conditionalPutNew',
          record.idempotency_key,
          { cause: error },
        );
      }
      throw new IdempotencyRepositoryError(
        `conditionalPutNew failed for "${record.idempotency_key}": ${describe(error)}`,
        'conditionalPutNew',
        record.idempotency_key,
        { cause: error },
      );
    }
  }

  /**
   * Guarded state transition (lease transitions and the 5 fenced status actions).
   *
   * `attribute_exists(idempotency_key)` is always ANDed in, so an Update can
   * never upsert a partial record, and an unguarded call is rejected outright.
   *
   * @returns the record after the transition (`ReturnValues: ALL_NEW`)
   * @throws IdempotencyUsageError when the guard or mutation cannot be correct
   * @throws IdempotencyConditionFailedError when the guard did not match —
   *         caller runs apply-or-confirm (ALREADY_APPLIED vs FENCED_STALE_EXECUTION)
   * @throws IdempotencyRepositoryError on any other DynamoDB failure
   */
  async conditionalUpdateState(input: ConditionalUpdateStateInput): Promise<IdempotencyRecord> {
    const { idempotencyKey, guard, mutation } = input;

    if (!idempotencyKey) {
      throw new IdempotencyUsageError(
        'conditionalUpdateState requires a non-empty "idempotencyKey".',
      );
    }
    assertMutationIsUsable(mutation);

    const ph = new ExpressionPlaceholders();
    const guardConditions = buildGuardConditions(guard, ph);
    if (guardConditions.length === 0) {
      throw new IdempotencyUsageError(
        'conditionalUpdateState requires at least one guard field: ' +
          'unguarded writes to the IdempotencyTable are not permitted (§10.11e).',
      );
    }

    const setClauses: string[] = [];
    if (mutation.set) {
      for (const [attribute, value] of Object.entries(mutation.set)) {
        if (value === undefined) continue;
        setClauses.push(`${ph.name(attribute)} = ${ph.value(value)}`);
      }
    }
    if (mutation.incrementAttemptCount !== undefined) {
      const attemptName = ph.name('attempt_count');
      setClauses.push(
        `${attemptName} = ${attemptName} + ${ph.value(mutation.incrementAttemptCount)}`,
      );
    }
    const removeClauses = (mutation.remove ?? []).map((attribute) => ph.name(attribute));

    const updateExpression = [
      setClauses.length > 0 ? `SET ${setClauses.join(', ')}` : '',
      removeClauses.length > 0 ? `REMOVE ${removeClauses.join(', ')}` : '',
    ]
      .filter((part) => part.length > 0)
      .join(' ');

    const conditionExpression = [
      `attribute_exists(${ph.name('idempotency_key')})`,
      ...guardConditions,
    ].join(' AND ');

    try {
      const result = await this.client.send(
        new UpdateCommand({
          TableName: this.tableName,
          Key: { idempotency_key: idempotencyKey },
          UpdateExpression: updateExpression,
          ConditionExpression: conditionExpression,
          ExpressionAttributeNames: ph.names,
          ...(ph.hasValues ? { ExpressionAttributeValues: ph.values } : {}),
          ReturnValues: 'ALL_NEW',
        }),
      );

      const attributes = result.Attributes;
      if (!attributes) {
        throw new IdempotencyRepositoryError(
          `conditionalUpdateState returned no attributes for "${idempotencyKey}"; cannot confirm the transition.`,
          'conditionalUpdateState',
          idempotencyKey,
        );
      }
      return attributes as IdempotencyRecord;
    } catch (error: unknown) {
      if (error instanceof IdempotencyRepositoryError) throw error;
      if (isConditionalCheckFailure(error)) {
        throw new IdempotencyConditionFailedError(
          `Guard not satisfied for "${idempotencyKey}". Run apply-or-confirm: re-read with ` +
            'getConsistent and classify as ALREADY_APPLIED or FENCED_STALE_EXECUTION (§10.11e).',
          'conditionalUpdateState',
          idempotencyKey,
          { cause: error },
        );
      }
      throw new IdempotencyRepositoryError(
        `conditionalUpdateState failed for "${idempotencyKey}": ${describe(error)}`,
        'conditionalUpdateState',
        idempotencyKey,
        { cause: error },
      );
    }
  }

  /**
   * Strongly-consistent read (`ConsistentRead: true`).
   *
   * This is the only read used for recovery judgement and apply-or-confirm; an
   * eventually-consistent read must never decide recovery truth (§10.11e).
   *
   * @returns the record, or `null` when the key has never been injected
   * @throws IdempotencyRepositoryError on any DynamoDB failure (fail-closed —
   *         a read failure is never reported as "key absent")
   */
  async getConsistent(idempotencyKey: string): Promise<IdempotencyRecord | null> {
    if (!idempotencyKey) {
      throw new IdempotencyUsageError('getConsistent requires a non-empty "idempotencyKey".');
    }

    try {
      const result = await this.client.send(
        new GetCommand({
          TableName: this.tableName,
          Key: { idempotency_key: idempotencyKey },
          ConsistentRead: true,
        }),
      );
      return (result.Item as IdempotencyRecord | undefined) ?? null;
    } catch (error: unknown) {
      throw new IdempotencyRepositoryError(
        `getConsistent failed for "${idempotencyKey}": ${describe(error)}`,
        'getConsistent',
        idempotencyKey,
        { cause: error },
      );
    }
  }
}

/**
 * Build a read-only handle on the IdempotencyTable.
 *
 * Use this in `RecoveryGateFn` (TASK-093) and `ApiReadFn` (TASK-149): the
 * returned type exposes `getConsistent` only, so the software layer mirrors the
 * IAM read-only grant instead of relying on it alone.
 */
export function createIdempotencyReader(options: IdempotencyRepositoryOptions): IdempotencyReader {
  const repository = new IdempotencyRepository(options);
  return {
    getConsistent: (idempotencyKey: string) => repository.getConsistent(idempotencyKey),
  };
}
