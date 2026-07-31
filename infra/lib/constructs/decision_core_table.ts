/**
 * DecisionCoreTable — DynamoDB table for immutable core decisions.
 *
 * §10.11a, §15.1, §6, TASK-062
 *
 * Single DynamoDB table:
 *   PK:    decision_id (STRING, HASH)
 *   SK:    (none)
 *   Billing: PAY_PER_REQUEST (on-demand)
 *
 * DynamoDB is schemaless. Backend (TASK-085+) writes additional immutable
 * DecisionCore attributes (immutable_after_commit, core_hash, event_id,
 * triggered_articles, invoked_procedures, applied_formula_articles,
 * primary_evacuation, secondary_evacuation, ete, evidence, policy,
 * source_manifest_hash, created_at, version, ...) at runtime.
 * CDK must NOT pre-declare them as AttributeDefinitions.
 *
 * ─── Immutability semantics (§10.11a) ────────────────────────────────────
 *
 * A DecisionCore item, once committed, is treated as IMMUTABLE. DynamoDB
 * Table itself CANNOT enforce item-level immutability — there is no
 * "immutable" CDK property or AWS DynamoDB table config that prevents a
 * subsequent Put/Update/Delete on an existing item.
 *
 * Immutability is enforced by the COMBINATION of two later layers:
 *   1. DecisionFn writes with a conditional Put, e.g.
 *        `ConditionExpression: "attribute_not_exists(decision_id)"`
 *      so an existing decision_id cannot be silently overwritten. (TASK-085+)
 *   2. TASK-077 grants DecisionFnRole as the SOLE writer to this table;
 *      RendererFn, PublishFn, ApiReadFn are READ-ONLY (§18). This writer
 *      isolation is what actually makes the conditional Put effective:
 *      no other principal can attempt a non-conditional write.
 *
 * `publish_state` is NEVER written back to this table — that mutable
 * state lives in PublishRecordTable (§10.11d), written only by PublishFn.
 *
 * This Construct intentionally does NOT implement:
 *   - the conditional Put / repository code (TASK-085+)
 *   - DecisionFnRole IAM (TASK-077)
 *   - any IAM role, policy, grant, Lambda, KMS key, or Custom Resource
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
 * Suggested config key for `decision_core_table`.
 * NOTE: this key is NOT yet present in `packages/config/src/config_schema.ts`
 * and MUST NOT be added by this task. The construct accepts the table name via
 * the typed `tableName` prop; TASK-180 (Stack wiring) or a later config
 * integration task adds the schema key.
 */
export const DECISION_CORE_TABLE_CONFIG_KEY = 'dynamodb.decision_core_table';

/** Partition key name (HASH) */
export const DECISION_CORE_TABLE_PARTITION_KEY = 'decision_id';

// ─── Props ──────────────────────────────────────────────────────────────────

export interface DecisionCoreTableProps {
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

// ─── DecisionCoreTableConstruct ─────────────────────────────────────────────

export class DecisionCoreTableConstruct extends Construct {
  /**
   * The DynamoDB Table resource.
   * `undefined` when constructed under LOCAL_MOCK profile (intentional).
   */
  public readonly table: Table | undefined;

  public constructor(scope: Construct, id: string, props: DecisionCoreTableProps) {
    super(scope, id);

    const { envContext, tableName } = props;

    validateTableName(tableName);

    // LOCAL_MOCK: zero AWS resources
    if (envContext.isLocalMock) {
      this.table = undefined;
      return;
    }

    const removalPolicy = envContext.isCompetition ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;

    const table = new Table(this, 'Table', {
      tableName,
      partitionKey: {
        name: DECISION_CORE_TABLE_PARTITION_KEY,
        type: AttributeType.STRING,
      },
      // No sort key — explicit
      billingMode: BillingMode.PAY_PER_REQUEST,
      // No TTL — DecisionCore items are retained indefinitely (immutable record).
      // No GSI / LSI / Stream / ProvisionedThroughput.
      // No IAM / Lambda / KMS / Custom Resource in this construct.
      removalPolicy,
      // No point-in-time recovery requested in this IaC; teardown lifecycle handled in TASK-084
      pointInTimeRecoverySpecification: { pointInTimeRecoveryEnabled: false },
    });

    this.table = table;
  }
}
