/**
 * ConnectionsTable — DynamoDB table for WebSocket connection storage.
 *
 * §4.5, §15.1, §6, TASK-065
 *
 * Single DynamoDB table:
 *   PK:    connectionId (STRING, HASH)
 *   SK:    (none)
 *   TTL:   <ttlAttributeName from props> (Enabled)
 *   Billing: PAY_PER_REQUEST (on-demand)
 *
 * Follows the AWS reference pattern documented in §4.5 for WebSocket
 * connection storage: `connectionId` is the partition key, and a TTL
 * attribute enables cleanup of stale connections.
 *
 * DynamoDB is schemaless. Backend (TASK-083 ConnFn / WsConnFnRole) writes
 * additional connection attributes at runtime. CDK must NOT pre-declare
 * them as AttributeDefinitions.
 *
 * ─── TTL attribute name is injected from props ────────────────────────────
 *
 * The TTL attribute name is intentionally NOT hard-coded in this Construct.
 * The design (§4.5) does not pin a specific name, and no cross-service
 * config key currently declares one. TASK-070 (WebSocket API wiring) and
 * TASK-083 (WsConnFnRole) MUST inject the same `ttlAttributeName` at
 * integration time. The runtime writer is responsible for storing
 * Unix-epoch seconds in this attribute per item.
 *
 * ─── TTL is a CLEANUP fallback, not a truth signal (§4.5) ─────────────────
 *
 * TTL exists solely to clean up stale connections caused by:
 *   - abnormal client close
 *   - network interruption
 *   - missed `$disconnect` round-trip
 *
 * TTL is NOT:
 *   - an immediate disconnect signal
 *   - WebSocket online-status truth
 *   - a delivery-success guarantee
 *   - an authorization mechanism
 *
 * Application handlers (`$connect`/`$disconnect`/`$default`, owned by
 * TASK-070+) are the runtime contract. This Construct only enables TTL
 * on the table; it does NOT compute connection lifetimes.
 *
 * ─── Scope of stored data (§4.5, §18) ─────────────────────────────────────
 *
 * The connections table holds TRANSIENT connection data only. It must NOT
 * store:
 *   - DecisionCore, Narrative, or PublishRecord business data
 *   - user credentials, JWTs, or Secrets
 *   - canonical event payloads
 *
 * Runtime writers: TASK-083's WsConnFnRole is the sole read/write
 * principal at runtime. `PostToConnection` is an API Gateway management
 * permission (TASK-083), NOT a DynamoDB table permission and is NOT
 * declared here.
 *
 * This Construct intentionally does NOT implement:
 *   - `$connect` / `$disconnect` / `$default` route handlers
 *   - WsConnFn / WsPushFn
 *   - broadcasting / heartbeat / presence
 *   - `PostToConnection` permission
 *   - GoneException cleanup logic
 *   - any IAM role, policy, grant, Lambda, KMS key, API Gateway, or
 *     Custom Resource
 *   - connection repository / runtime PutItem/DeleteItem
 *
 * LOCAL_MOCK: no DynamoDB Table is created (zero AWS resources).
 *
 * Removal policy:
 *   PERSONAL_AWS_DEV  → DESTROY (teardown by TASK-084)
 *   COMPETITION_AWS   → RETAIN  (teardown only after host confirmation)
 */

import { Construct } from 'constructs';
import { Table, AttributeType, BillingMode } from 'aws-cdk-lib/aws-dynamodb';
import { RemovalPolicy } from 'aws-cdk-lib';
import type { EnvironmentContext } from '../env_context.js';

// ─── Constants ──────────────────────────────────────────────────────────────

/**
 * Suggested config key for `connections_table`.
 * NOTE: this key is NOT yet present in `packages/config/src/config_schema.ts`
 * and MUST NOT be added by this task. The construct accepts the table name via
 * the typed `tableName` prop; TASK-180 (Stack wiring) or a later config
 * integration task adds the schema key.
 */
export const CONNECTIONS_TABLE_CONFIG_KEY = 'dynamodb.connections_table';

/** Partition key name (HASH) */
export const CONNECTIONS_TABLE_PARTITION_KEY = 'connectionId';

// ─── Props ──────────────────────────────────────────────────────────────────

export interface ConnectionsTableProps {
  /** TASK-059 typed environment context */
  readonly envContext: EnvironmentContext;

  /**
   * DynamoDB table name.
   * Must be 3-255 chars, only A-Za-z0-9_-. allowed (no lowercase coercion).
   * Comes from props — no hard-coded value, no AWS account literal,
   * no fixed Region.
   */
  readonly tableName: string;

  /**
   * TTL attribute name used to expire stale connection items.
   * MUST be injected from the integration layer (TASK-070 / TASK-083) and
   * MUST match the attribute name that the runtime writer writes.
   * DynamoDB TTL item values are Unix-epoch seconds.
   */
  readonly ttlAttributeName: string;
}

// ─── Validation ─────────────────────────────────────────────────────────────

/** DynamoDB table name: 3-255 chars, A-Za-z0-9_-. only */
const TABLE_NAME_RE = /^[A-Za-z0-9_.-]{3,255}$/;

function validateTableName(name: string): void {
  if (!name || typeof name !== 'string' || name.trim() === '') {
    throw new Error(`tableName must be a non-empty string`);
  }
  if (name.length < 3 || name.length > 255) {
    throw new Error(
      `tableName '${name}' has invalid length ${name.length}. ` +
        'DynamoDB table names must be 3-255 characters.',
    );
  }
  if (!TABLE_NAME_RE.test(name)) {
    throw new Error(
      `tableName '${name}' is not a valid DynamoDB table name. ` +
        'Allowed characters: A-Z a-z 0-9 _ - . (no spaces, slashes, colons, etc).',
    );
  }
}

/**
 * Characters forbidden anywhere in a DynamoDB attribute name.
 * Mirrors the previous regex `[\s.\[\]#:\x00-\x1F\x7F]` without
 * triggering `no-control-regex`. Kept as a code point set so the
 * validator below can do a single-pass scan.
 */
const FORBIDDEN_ATTR_NAME_CHARS = new Set<string>([
  ' ',
  '\t',
  '\n',
  '\r',
  '\f',
  '\v',
  '.',
  '[',
  ']',
  '#',
  ':',
]);

function isForbiddenAttrNameChar(ch: string): boolean {
  const code = ch.charCodeAt(0);
  // ASCII control characters (C0: 0x00-0x1F) and DEL (0x7F).
  if (code <= 0x1f || code === 0x7f) {
    return true;
  }
  return FORBIDDEN_ATTR_NAME_CHARS.has(ch);
}

function validateTtlAttributeName(name: string): void {
  if (!name || typeof name !== 'string' || name.trim() === '') {
    throw new Error(`ttlAttributeName must be a non-empty string`);
  }
  // Reject leading/trailing whitespace explicitly — must not be silently trimmed
  if (name !== name.trim()) {
    throw new Error(`ttlAttributeName '${name}' has leading or trailing whitespace`);
  }
  if (name === CONNECTIONS_TABLE_PARTITION_KEY) {
    throw new Error(
      `ttlAttributeName must not equal the partition key '${CONNECTIONS_TABLE_PARTITION_KEY}'`,
    );
  }
  for (const ch of name) {
    if (isForbiddenAttrNameChar(ch)) {
      throw new Error(
        `ttlAttributeName '${name}' is not a valid DynamoDB attribute name. ` +
          'Allowed: any non-whitespace characters except ".", "[", "]", "#", ":" and control characters.',
      );
    }
  }
}

// ─── ConnectionsTableConstruct ──────────────────────────────────────────────

export class ConnectionsTableConstruct extends Construct {
  /**
   * The DynamoDB Table resource.
   * `undefined` when constructed under LOCAL_MOCK profile (intentional).
   */
  public readonly table: Table | undefined;

  /**
   * The TTL attribute name as injected from props.
   * Echoed here for downstream wiring (TASK-070 / TASK-083) so the runtime
   * writer uses the IDENTICAL attribute name as the IaC TTL setting.
   */
  public readonly ttlAttributeName: string;

  public constructor(scope: Construct, id: string, props: ConnectionsTableProps) {
    super(scope, id);

    const { envContext, tableName, ttlAttributeName } = props;

    validateTableName(tableName);
    validateTtlAttributeName(ttlAttributeName);

    // LOCAL_MOCK: zero AWS resources — but the validated ttlAttributeName is
    // still echoed so callers can wire runtime layers identically.
    this.ttlAttributeName = ttlAttributeName;

    if (envContext.isLocalMock) {
      this.table = undefined;
      return;
    }

    const removalPolicy = envContext.isCompetition ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;

    const table = new Table(this, 'Table', {
      tableName,
      partitionKey: {
        name: CONNECTIONS_TABLE_PARTITION_KEY,
        type: AttributeType.STRING,
      },
      // No sort key — explicit
      billingMode: BillingMode.PAY_PER_REQUEST,
      // TTL on the injected attribute name. The runtime writer must store
      // Unix-epoch seconds in this attribute per item.
      timeToLiveAttribute: ttlAttributeName,
      removalPolicy,
      // No point-in-time recovery: items are transient by design (TTL cleanup).
      // No GSI / LSI / Stream / ProvisionedThroughput / IAM / Lambda / KMS.
    });

    this.table = table;
  }
}
