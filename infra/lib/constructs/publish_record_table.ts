/**
 * PublishRecordTable — DynamoDB table for mutable publish state + audit trail.
 *
 * §10.11d, §10.17, §15.1, §18, TASK-064
 *
 * Single DynamoDB table:
 *   PK:    decision_id (STRING, HASH)
 *   SK:    (none)
 *   Billing: PAY_PER_REQUEST (on-demand)
 *
 * DynamoDB is schemaless. Backend (TASK-145) writes additional mutable
 * publish attributes (publish_state, channels, published_payload_ref,
 * approved_by, audit_trail, published_by, commander_actor, failure_reason,
 * version, updated_at, core_version_ref, ...) at runtime.
 * CDK must NOT pre-declare them as AttributeDefinitions.
 *
 * ─── Physical separation from DecisionCore (§10.11d / §10.17) ────────────
 *
 * DecisionCoreTable (TASK-062) holds the immutable decision facts.
 * PublishRecordTable (this) holds MUTABLE publish state + audit trail.
 * The two tables are PHYSICALLY SEPARATE — joined only by `decision_id`
 * (and later by `core_version_ref`) at the application read layer
 * (DecisionReadModel, §10.11c).
 *
 * `publish_state` is NEVER written back to DecisionCoreTable. Doing so would
 * break the immutability guarantee established for DecisionCore. PublishFn
 * (§10.11d, TASK-144/145) is the SOLE runtime writer to this table and has
 * zero write permission on DecisionCoreTable.
 *
 * ─── Mutable state machine (deferred to TASK-145) ────────────────────────
 *
 * The intended runtime state transitions, NOT enforced at IaC level:
 *
 *   draft  → approved  → published
 *                  \
 *                   → publish_failed
 *
 * DynamoDB Table IaC does NOT implement state transitions, optimistic
 * locking, audit-trail append, or any conditional Update. Those are
 * application-layer concerns owned by TASK-145.
 *
 * ─── `version` as an application optimistic-lock field ────────────────────
 *
 * `version` is a DynamoDB ITEM-level attribute, NOT a key and NOT an
 * AttributeDefinition. It is used at runtime (TASK-145) as an optimistic-
 * lock guard via conditional Update to prevent lost-update races between
 * concurrent publish actions. This Construct does not declare, validate,
 * or compare `version` — it only documents the boundary.
 *
 * ─── Audit trail boundary ────────────────────────────────────────────────
 *
 * `audit_trail` (and its entries: actor, action, from_state, to_state, at)
 * is a runtime application field whose shape, append semantics, and
 * integrity guarantees are owned by TASK-145 / TASK-147. This Construct
 * does not declare, validate, or shape `audit_trail`.
 *
 * ─── Writer isolation (deferred to TASK-082) ──────────────────────────────
 *
 * At runtime:
 *   - PublishFnRole is the SOLE writer of this table
 *   - ApiReadFn is READ-ONLY on this table
 *   - DecisionFn, RendererFn, WorkflowStatusFn, InjectFn must NOT write
 *     to this table
 *   - PublishFnRole has ZERO write permission on DecisionCoreTable
 *
 * This Construct intentionally does NOT implement:
 *   - the publish state machine (TASK-145)
 *   - the optimistic-lock conditional Update (TASK-145)
 *   - the audit-trail append (TASK-147)
 *   - PublishFnRole / IAM (TASK-082)
 *   - the commander authorization layer (TASK-141)
 *   - CMS / SMS publish-channel implementation
 *   - WebSocket publish events
 *   - DecisionReadModel assembly (TASK-149)
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
 * Suggested config key for `publish_record_table`.
 * NOTE: this key is NOT yet present in `packages/config/src/config_schema.ts`
 * and MUST NOT be added by this task. The construct accepts the table name via
 * the typed `tableName` prop; TASK-180 (Stack wiring) or a later config
 * integration task adds the schema key.
 */
export const PUBLISH_RECORD_TABLE_CONFIG_KEY = 'dynamodb.publish_record_table';

/** Partition key name (HASH) */
export const PUBLISH_RECORD_TABLE_PARTITION_KEY = 'decision_id';

// ─── Props ──────────────────────────────────────────────────────────────────

export interface PublishRecordTableProps {
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
const TABLE_NAME_RE = /^[A-Za-z0-9_.\-]{3,255}$/;

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

// ─── PublishRecordTableConstruct ────────────────────────────────────────────

export class PublishRecordTableConstruct extends Construct {
  /**
   * The DynamoDB Table resource.
   * `undefined` when constructed under LOCAL_MOCK profile (intentional).
   */
  public readonly table: Table | undefined;

  public constructor(scope: Construct, id: string, props: PublishRecordTableProps) {
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
        name: PUBLISH_RECORD_TABLE_PARTITION_KEY,
        type: AttributeType.STRING,
      },
      // No sort key — explicit
      billingMode: BillingMode.PAY_PER_REQUEST,
      // No TTL — publish audit trail must persist with the decision lifecycle.
      // No GSI / LSI / Stream / ProvisionedThroughput.
      // No point-in-time recovery: mutable publish state is not a snapshot
      // source of truth (the immutable DecisionCore is); PITR is intentionally
      // not enabled here.
      // No IAM / Lambda / KMS / Custom Resource in this construct.
      removalPolicy,
    });

    this.table = table;
  }
}
