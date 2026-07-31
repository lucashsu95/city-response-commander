/**
 * Standard environment variable key contract for the five DynamoDB tables.
 *
 * ## Why this file exists
 *
 * Every repository in `src/repository/` takes its table name as a constructor
 * option and documents it as "resolved via `ConfigProvider` — never hard-coded".
 * That is the right rule, but at the time of writing nothing in the runtime
 * actually resolves them: `packages/backend` contains zero `process.env` reads,
 * the five `infra/lib/constructs/*_table.ts` constructs accept `tableName` as a
 * CDK prop, and each one carries the same note that the config schema key is
 * deliberately absent until Stack wiring (TASK-180) lands.
 *
 * So the name a Lambda should read at cold start was, in effect, undefined —
 * agreed by nobody, written down nowhere, and different in each entry point that
 * needed one. This module is that missing half: one place naming the keys, so an
 * entry point and a CDK `environment` block can be checked against each other by
 * reading a single file instead of by deploying and watching what breaks.
 *
 * ## Scope, deliberately narrow
 *
 * This is a NAMING contract, not a replacement for `ConfigProvider`. Table names
 * are the one class of value that cannot come from `ConfigProvider`, because
 * `createConfigProvider()` is async and profile-dependent while a DynamoDB client
 * must be constructible synchronously at module scope for connection reuse
 * across warm invocations. Policy knobs, thresholds and strategy modes stay in
 * `ConfigProvider` and must NOT be added here.
 *
 * ## Defaults
 *
 * The defaults are a local-development and integration-test convenience. They
 * are NOT a claim about what the deployed tables are called: no physical table
 * name exists anywhere in `infra/` yet. In an AWS profile the variable is
 * expected to be injected explicitly, and {@link requireTableName} exists for
 * call sites that would rather fail loudly than silently talk to a
 * `CityCommander-`-prefixed table that may not be theirs.
 *
 * @module backend/config/env_keys
 */

// ─── Key names ─────────────────────────────────────────────

/**
 * Environment variable names carrying each table's physical name.
 *
 * Values are the literal variable names, so `TABLE_ENV_KEYS.IDEMPOTENCY` can be
 * used both as the lookup key here and as the key of a CDK `environment` block
 * without the two drifting apart.
 */
export const TABLE_ENV_KEYS = {
  /** IdempotencyTable — lease, fencing and status record (§10.11e). */
  IDEMPOTENCY: 'IDEMPOTENCY_TABLE_NAME',
  /** DecisionCoreTable — the immutable deterministic core. */
  DECISION_CORE: 'DECISION_CORE_TABLE_NAME',
  /** DecisionNarrativeTable — per-`narrative_type` generated text. */
  DECISION_NARRATIVE: 'DECISION_NARRATIVE_TABLE_NAME',
  /** PublishRecordTable — outbound publish audit trail. */
  PUBLISH_RECORD: 'PUBLISH_RECORD_TABLE_NAME',
  /** ConnectionsTable — live WebSocket connection ids. */
  CONNECTIONS: 'CONNECTIONS_TABLE_NAME',
} as const;

/** Logical table identifier (`IDEMPOTENCY`, `DECISION_CORE`, ...). */
export type TableEnvKeyName = keyof typeof TABLE_ENV_KEYS;

/** One of the five literal environment variable names. */
export type TableEnvVarName = (typeof TABLE_ENV_KEYS)[TableEnvKeyName];

/** All five variable names, for CDK-side and test-side exhaustiveness checks. */
export const ALL_TABLE_ENV_VAR_NAMES: readonly TableEnvVarName[] = Object.freeze(
  Object.values(TABLE_ENV_KEYS),
);

// ─── Defaults ──────────────────────────────────────────────

/**
 * Fallback table names, applied only when the variable is absent or blank.
 *
 * Read the module note before treating these as deployment truth: they exist so
 * `LOCAL_MOCK` and DynamoDB-Local integration runs need no environment setup.
 */
export const TABLE_NAME_DEFAULTS: Readonly<Record<TableEnvVarName, string>> = Object.freeze({
  IDEMPOTENCY_TABLE_NAME: 'CityCommander-Idempotency',
  DECISION_CORE_TABLE_NAME: 'CityCommander-DecisionCore',
  DECISION_NARRATIVE_TABLE_NAME: 'CityCommander-DecisionNarrative',
  PUBLISH_RECORD_TABLE_NAME: 'CityCommander-PublishRecord',
  CONNECTIONS_TABLE_NAME: 'CityCommander-Connections',
});

// ─── Errors ────────────────────────────────────────────────

/** Raised when a table name is absent where one was required, or is malformed. */
export class TableEnvError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TableEnvError';
  }
}

// ─── Resolution ────────────────────────────────────────────

/**
 * DynamoDB's own table-name rule, mirroring `TABLE_NAME_RE` in the five
 * `infra/lib/constructs/*_table.ts` constructs.
 *
 * Validated on read as well as on synth because the two sides are wired by hand:
 * a stray quote or trailing newline in a CDK `environment` value would otherwise
 * surface as a `ResourceNotFoundException` at the first read, several layers away
 * from the typo that caused it.
 */
const TABLE_NAME_RE = /^[A-Za-z0-9_.-]{3,255}$/;

/** An environment-like map. Accepts `process.env` directly. */
export type EnvLike = Record<string, string | undefined>;

function assertUsableTableName(name: string, varName: TableEnvVarName): string {
  if (!TABLE_NAME_RE.test(name)) {
    throw new TableEnvError(
      `${varName}="${name}" is not a valid DynamoDB table name. ` +
        'Expected 3-255 characters of [A-Za-z0-9_.-].',
    );
  }
  return name;
}

/**
 * Read one table name, falling back to {@link TABLE_NAME_DEFAULTS}.
 *
 * A blank or whitespace-only value is treated as absent. CloudFormation renders
 * an unresolved `Ref` as an empty string rather than omitting the variable, so
 * `""` means "nothing was wired here" just as reliably as `undefined` does, and
 * failing on it would strand a local run for no reason.
 *
 * @throws TableEnvError when the resolved value is not a legal table name
 */
export function resolveTableName(key: TableEnvKeyName, env: EnvLike = process.env): string {
  const varName = TABLE_ENV_KEYS[key];
  const raw = env[varName];
  const trimmed = raw?.trim() ?? '';
  const resolved = trimmed === '' ? TABLE_NAME_DEFAULTS[varName] : trimmed;
  return assertUsableTableName(resolved, varName);
}

/**
 * Read one table name, refusing to fall back to a default.
 *
 * Use this for any write path against a real AWS account. A default that happens
 * to be syntactically valid but points at the wrong account's table is a worse
 * failure than a cold start that refuses to begin.
 *
 * @throws TableEnvError when the variable is absent, blank, or malformed
 */
export function requireTableName(key: TableEnvKeyName, env: EnvLike = process.env): string {
  const varName = TABLE_ENV_KEYS[key];
  const trimmed = env[varName]?.trim() ?? '';
  if (trimmed === '') {
    throw new TableEnvError(
      `${varName} is required but was not set. ` +
        `The default ("${TABLE_NAME_DEFAULTS[varName]}") is intentionally not applied here: ` +
        'inject the table name explicitly via the Lambda environment.',
    );
  }
  return assertUsableTableName(trimmed, varName);
}

/** Every table name, resolved in one call. Handy for a cold-start block. */
export function resolveAllTableNames(
  env: EnvLike = process.env,
): Readonly<Record<TableEnvKeyName, string>> {
  return Object.freeze({
    IDEMPOTENCY: resolveTableName('IDEMPOTENCY', env),
    DECISION_CORE: resolveTableName('DECISION_CORE', env),
    DECISION_NARRATIVE: resolveTableName('DECISION_NARRATIVE', env),
    PUBLISH_RECORD: resolveTableName('PUBLISH_RECORD', env),
    CONNECTIONS: resolveTableName('CONNECTIONS', env),
  });
}

// ─── Workflow tuning ───────────────────────────────────────

/**
 * Staleness budget stamped by `MARK_RUNNING`, as an environment variable.
 *
 * Not a table name, but the one other value `WorkflowStatusFn` cannot start
 * without: `WiringContext.executionDeadlineMs` is required on every invocation
 * and has no config schema key yet either.
 */
export const WORKFLOW_EXECUTION_DEADLINE_MS_ENV = 'WORKFLOW_EXECUTION_DEADLINE_MS';

/**
 * Default staleness budget — 60 000 ms.
 *
 * Matches the §20 / REQ-004 official end-to-end deadline and the value every
 * existing test uses. An execution that has run longer than the deadline the
 * whole system is judged against cannot still be considered live.
 */
export const DEFAULT_WORKFLOW_EXECUTION_DEADLINE_MS = 60_000;

/**
 * Read the execution deadline in milliseconds.
 *
 * Rejects non-finite and non-positive values instead of coercing them. `Number("")`
 * is `0`, and a zero deadline would mark every execution stale the instant it
 * started — every request would reconcile away the execution that was still
 * running, which looks like a fencing bug rather than a bad variable.
 *
 * @throws TableEnvError when the variable is present but not a positive number
 */
export function resolveExecutionDeadlineMs(env: EnvLike = process.env): number {
  const raw = env[WORKFLOW_EXECUTION_DEADLINE_MS_ENV]?.trim() ?? '';
  if (raw === '') return DEFAULT_WORKFLOW_EXECUTION_DEADLINE_MS;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new TableEnvError(
      `${WORKFLOW_EXECUTION_DEADLINE_MS_ENV}="${raw}" must be a positive number of milliseconds.`,
    );
  }
  return parsed;
}
