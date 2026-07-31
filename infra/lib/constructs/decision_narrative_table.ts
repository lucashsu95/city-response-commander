/**
 * DecisionNarrativeTable — DynamoDB table for narrative text.
 *
 * §10.11b, §15.1, §6, TASK-063
 *
 * Single DynamoDB table:
 *   PK:    decision_id   (STRING, HASH)
 *   SK:    narrative_type (STRING, RANGE)
 *   Billing: PAY_PER_REQUEST (on-demand)
 *
 * DynamoDB is schemaless. Backend (RendererFn, TASK-108+) writes additional
 * narrative attributes (payload, content, language, citations,
 * citation_article_set, status, created_at, updated_at, trace_id,
 * schema_version, rendered_by, fallback_used, ...) at runtime.
 * CDK must NOT pre-declare them as AttributeDefinitions.
 *
 * ─── Narrative item isolation (§10.11b, PATCH 1 / PATCH 3 / PATCH 5) ─────
 *
 * The same `decision_id` can hold up to THREE independent items under the
 * composite key (PK, SK):
 *   - REPORT        (the report branch)
 *   - PUBLIC_ALERT  (the public-alert branch)
 *   - EXPLANATION   (the explanation branch)
 *
 * Each `narrative_type` value is the SORT KEY, so the three values are
 * physically distinct items at (decision_id, REPORT), (decision_id,
 * PUBLIC_ALERT), and (decision_id, EXPLANATION). Branches therefore do NOT
 * share a single mutable item — they cannot overwrite each other simply by
 * virtue of the composite key.
 *
 * DynamoDB Table IaC does NOT enforce the `narrative_type` enum. Valid
 * narrative_type values are governed by the shared schema and application-
 * level validation. This Construct only declares the key shape.
 *
 * Each branch's true anti-overwrite guarantee is the per-item conditional Put
 * implemented in TASK-116:
 *   - PutItem provides BOTH PK and SK
 *   - ConditionExpression is `attribute_not_exists(decision_id)`
 *     (single-arg form, evaluated against the (PK, SK) item)
 *   - Re-Put of the same (decision_id, narrative_type) →
 *     `ConditionalCheckFailedException` → branch_already_completed
 *
 * The DOUBLE-argument form of `attribute_not_exists` (passing both PK and
 * SK names) is illegal DynamoDB syntax and is NEVER used.
 *
 * This Construct intentionally does NOT implement:
 *   - the conditional Put / repository / writer / reader (TASK-108..120)
 *   - the `narrative_type` enum validator
 *   - RendererFn / Bedrock integration
 *   - application payload schemas
 *   - any IAM role, policy, grant, Lambda, KMS key, or Custom Resource
 *
 * ─── Recovery invariant (§10.11b, PATCH FENCING) ──────────────────────────
 *
 * Recovery (`RecoveryGateFn`, TASK-080) MUST Query the BASE TABLE ONLY.
 * No GSI — and especially no eventually-consistent GSI — is ever the source
 * of recovery truth. There is intentionally no GSI on this table; recovery
 * reads Query the composite key directly with `ConsistentRead = true`.
 *
 * Strong consistency is a CLIENT-SIDE setting (DynamoDB Query/GetItem
 * `ConsistentRead` flag), NOT a Table Construct property. The Construct
 * does not — and cannot — guarantee strong consistency at the table level;
 * that is enforced by the recovery client's request shape.
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
 * Suggested config key for `decision_narrative_table`.
 * NOTE: this key is NOT yet present in `packages/config/src/config_schema.ts`
 * and MUST NOT be added by this task. The construct accepts the table name via
 * the typed `tableName` prop; TASK-180 (Stack wiring) or a later config
 * integration task adds the schema key.
 */
export const DECISION_NARRATIVE_TABLE_CONFIG_KEY = 'dynamodb.decision_narrative_table';

/** Partition key name (HASH) */
export const DECISION_NARRATIVE_TABLE_PARTITION_KEY = 'decision_id';

/** Sort key name (RANGE) */
export const DECISION_NARRATIVE_TABLE_SORT_KEY = 'narrative_type';

/**
 * The three `narrative_type` values written by Renderer branches.
 * Documented here for reader clarity; NOT enforced by Table IaC.
 * Application-level / shared-schema validation is the source of truth.
 */
export const NARRATIVE_TYPES = ['REPORT', 'PUBLIC_ALERT', 'EXPLANATION'] as const;
export type NarrativeType = (typeof NARRATIVE_TYPES)[number];

// ─── Props ──────────────────────────────────────────────────────────────────

export interface DecisionNarrativeTableProps {
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

// ─── DecisionNarrativeTableConstruct ────────────────────────────────────────

export class DecisionNarrativeTableConstruct extends Construct {
  /**
   * The DynamoDB Table resource.
   * `undefined` when constructed under LOCAL_MOCK profile (intentional).
   */
  public readonly table: Table | undefined;

  public constructor(scope: Construct, id: string, props: DecisionNarrativeTableProps) {
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
        name: DECISION_NARRATIVE_TABLE_PARTITION_KEY,
        type: AttributeType.STRING,
      },
      sortKey: {
        name: DECISION_NARRATIVE_TABLE_SORT_KEY,
        type: AttributeType.STRING,
      },
      billingMode: BillingMode.PAY_PER_REQUEST,
      // No TTL — narrative items persist alongside DecisionCore for read model assembly.
      // No GSI / LSI / Stream / ProvisionedThroughput.
      // No point-in-time recovery: items are immutable from the perspective of the
      // schema (RendererFn conditional Put); PITR is intentionally not enabled here.
      // No IAM / Lambda / KMS / Custom Resource in this construct.
      removalPolicy,
    });

    this.table = table;
  }
}
