/**
 * IdempotencyTable — DynamoDB table for idempotency keys, lease state, and stale-running reconciliation
 *
 * §10.11e, §15.1, §6, TASK-061
 *
 * Single DynamoDB table:
 *   PK:   idempotency_key (STRING, HASH)
 *   TTL:  expires_at
 *   Billing: PAY_PER_REQUEST (on-demand)
 *
 * DynamoDB is schemaless. Backend (TASK-085+) writes additional state attributes
 * (status, attempt_count, lease_expires_at, workflow_execution_arn, recovery_mode,
 *  recovery_stage, decision_id, last_error, core_committed) at runtime.
 * CDK must NOT pre-declare them as AttributeDefinitions.
 *
 * LOCAL_MOCK: no DynamoDB Table is created (zero AWS resources).
 *
 * Removal policy:
 *   PERSONAL_AWS_DEV  → DESTROY (teardown by TASK-084)
 *   COMPETITION_AWS  → RETAIN  (teardown only after host confirmation)
 */

import { Construct } from 'constructs';
import { Table, AttributeType, BillingMode } from 'aws-cdk-lib/aws-dynamodb';
import { RemovalPolicy } from 'aws-cdk-lib';
import type { EnvironmentContext } from '../env_context.js';

// ─── Constants ──────────────────────────────────────────────────────────────

/**
 * Suggested config key for `idempotency_table`.
 * NOTE: this key is NOT yet present in `packages/config/src/config_schema.ts`
 * and MUST NOT be added by this task. The construct accepts the table name via
 * the typed `tableName` prop; TASK-180 (Stack wiring) or a later config
 * integration task adds the schema key.
 */
export const IDEMPOTENCY_TABLE_CONFIG_KEY = 'dynamodb.idempotency_table';

/** Partition key name (HASH) */
export const IDEMPOTENCY_TABLE_PARTITION_KEY = 'idempotency_key';

/** TTL attribute name (NOT a key schema attribute) */
export const IDEMPOTENCY_TABLE_TTL_ATTRIBUTE = 'expires_at';

// ─── Props ──────────────────────────────────────────────────────────────────

export interface IdempotencyTableProps {
  /** TASK-059 typed environment context */
  readonly envContext: EnvironmentContext;

  /**
   * DynamoDB table name.
   * Must be 3-255 chars, only A-Za-z0-9_-. allowed (no lowercase coercion).
   * Comes from props — no hard-coded value, no AWS account literal,
   * no fixed Region.
   */
  readonly tableName: string;
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

// ─── IdempotencyTableConstruct ──────────────────────────────────────────────

export class IdempotencyTableConstruct extends Construct {
  /**
   * The DynamoDB Table resource.
   * `undefined` when constructed under LOCAL_MOCK profile (intentional).
   */
  public readonly table: Table | undefined;

  public constructor(scope: Construct, id: string, props: IdempotencyTableProps) {
    super(scope, id);

    const { envContext, tableName } = props;

    validateTableName(tableName);

    // LOCAL_MOCK: zero AWS resources
    if (envContext.isLocalMock) {
      this.table = undefined;
      return;
    }

    const removalPolicy = envContext.isCompetition
      ? RemovalPolicy.RETAIN
      : RemovalPolicy.DESTROY;

    const table = new Table(this, 'Table', {
      tableName,
      partitionKey: {
        name: IDEMPOTENCY_TABLE_PARTITION_KEY,
        type: AttributeType.STRING,
      },
      // No sort key — explicit
      billingMode: BillingMode.PAY_PER_REQUEST,
      // TTL on expires_at (attribute is written by backend at runtime)
      timeToLiveAttribute: IDEMPOTENCY_TABLE_TTL_ATTRIBUTE,
      removalPolicy,
      // No point-in-time recovery requested in this IaC; teardown lifecycle handled in TASK-084
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: false },
    });

    this.table = table;
  }
}
