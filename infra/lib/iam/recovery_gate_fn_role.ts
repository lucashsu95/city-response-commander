/**
 * RecoveryGateFnRole — least-privilege execution role for the recovery-gate Lambda
 *
 * §18, §10.11e, §15.2, TASK-080
 *
 * RecoveryGateFn is the read-only judgment gate: it reads the current idempotency
 * lease from IdempotencyTable, reads deterministic decisions from DecisionCoreTable,
 * and Queries narrative records from DecisionNarrativeTable to determine whether
 * the pipeline should continue, retry, or gate-stop. It does NOT write any table,
 * call Bedrock, modify S3, or push WebSocket messages.
 *
 * ─── What RecoveryGateFn OWNS ────────────────────────────────────────────
 *
 *   - Reads IdempotencyTable (GetItem with ConsistentRead, execution_id fence)
 *   - Reads DecisionCoreTable (GetItem with ConsistentRead)
 *   - Queries DecisionNarrativeTable (base table only, NOT any GSI/index)
 *   - Writes to its dedicated CloudWatch Log Group (via TASK-075)
 *
 * ─── What RecoveryGateFn MUST NOT do ────────────────────────────────────
 *
 *   - Write to any DynamoDB table (including IdempotencyTable)
 *   - Call Bedrock or Knowledge Base
 *   - Invoke Lambda functions
 *   - Start Step Functions workflows
 *   - PostToConnection (WsPushFn owns WebSocket push)
 *   - Write to S3
 *   - GetSecretValue / KMS / SSM read
 *   - Publish CloudWatch custom metrics
 *   - X-Ray publishing (TASK-179 owns this)
 *
 * ─── Strong consistency boundary (IAM CANNOT enforce) ─────────────────────
 *
 *   RecoveryGateFn uses ConsistentRead on GetItem and Query calls to avoid
 *   stale reads during concurrent pipeline execution. IAM cannot enforce
 *   ConsistentRead=true — this is a runtime responsibility (TASK-093).
 *
 *   IAM capability: GetItem on IdempotencyTable + DecisionCoreTable
 *   IAM capability: Query on DecisionNarrativeTable base table only
 *   Runtime owner: TASK-093
 *
 * ─── Narrative Query base-table boundary ──────────────────────────────────
 *
 *   RecoveryGateFn queries DecisionNarrativeTable using the composite key
 *   (PK=decision_id, SK=narrative_type) directly on the base table.
 *   No GSI is used or needed. IAM grants only the base table ARN so that
 *   any GSI access is implicitly denied. This is the IAM-level enforcement
 *   of the "no eventually-consistent GSI" architectural requirement.
 *
 *   IAM capability: Query on exact DecisionNarrativeTableArn (base table only)
 *   IAM denial:   Query on any index ARN (implicit, not explicitly granted)
 *
 * ─── X-Ray boundary ──────────────────────────────────────────────────────
 *
 *   TASK-075 sets TracingConfig.Mode on the Lambda.  The IAM capability
 *   for xray:PutTraceSegments / PutTelemetryRecords is left to TASK-179,
 *   which is the sole final-binding owner for all role → Lambda bindings.
 *
 * ─── Security boundaries (precise) ─────────────────────────────────────
 *
 * This construct creates:
 *   - 1 × AWS::IAM::Role     (PERSONAL_AWS_DEV / COMPETITION_AWS)
 *   - 1 × AWS::IAM::Policy  (PERSONAL_AWS_DEV / COMPETITION_AWS, inline)
 *
 * This construct NEVER creates:
 *   - Lambda / DynamoDB / S3 / Step Functions / SSM Parameter / Log Group /
 *     KMS / SNS / EventBridge / CloudWatch / X-Ray resources
 *   - AWS managed policies (e.g. AWSLambdaBasicExecutionRole)
 *   - External references to process.env
 *   - Hard-coded account, region, or ARN
 *
 * LOCAL_MOCK: zero AWS resources (role / policy stay undefined).
 *
 * ─── Ownership chain ───────────────────────────────────────────────────
 *
 *   role defined:                YES (here, TASK-080)
 *   role final-bound to Lambda:  NO  (TASK-179)
 *   final binding owner:           TASK-179
 *   consistent-read runtime owner: TASK-093
 *   base-table-only IAM boundary:  TASK-080
 *   X-Ray IAM grants owner:       TASK-179
 */

import { Construct } from 'constructs';
import {
  Effect,
  Policy,
  PolicyDocument,
  PolicyStatement,
  Role,
  ServicePrincipal,
} from 'aws-cdk-lib/aws-iam';
import type { EnvironmentContext } from '../env_context.js';

// ─── Evidence contract ────────────────────────────────────────────────────────

/**
 * Machine-readable evidence produced by this construct.
 * Downstream tasks (TASK-179) use this to assert correctness without
 * inspecting the internal policy document.
 */
export interface RecoveryGateFnRoleEvidence {
  /** Actions allowed on the Idempotency DynamoDB table. */
  readonly allowedIdempotencyActions: readonly string[];

  /** Actions allowed on the DecisionCore DynamoDB table. */
  readonly allowedDecisionCoreActions: readonly string[];

  /** Actions allowed on the DecisionNarrative DynamoDB table. */
  readonly allowedNarrativeActions: readonly string[];

  /** The exact Idempotency Table ARN. */
  readonly idempotencyTableArn: string;

  /** The exact DecisionCore Table ARN. */
  readonly decisionCoreTableArn: string;

  /** The exact DecisionNarrative Table ARN (base table, no index suffix). */
  readonly decisionNarrativeTableArn: string;

  /** The dedicated CloudWatch Log Group stream ARN pattern. */
  readonly logGroupStreamArn: string;

  /** Categories explicitly denied (proves the deny list is intentional). */
  readonly explicitDenyCategories: readonly string[];

  /** Count of ALLOW statements using Resource "*". Must be 0. */
  readonly wildcardAllowCount: number;

  /**
   * This role does NOT enforce ConsistentRead on GetItem.
   * ConsistentRead=true enforcement is a runtime responsibility (TASK-093).
   * IAM cannot express this constraint.
   */
  readonly consistentReadEnforcedByIam: false;

  /**
   * This role grants Query only on the base table ARN.
   * No GSI/index ARN is granted; any index Query is implicitly denied.
   */
  readonly baseTableOnlyQuery: true;

  /**
   * Runtime owner for ConsistentRead enforcement.
   */
  readonly consistentReadRuntimeOwner: 'TASK-093';

  /**
   * This role is NOT yet bound to the RecoveryGateFn Lambda.
   * Final binding is owned by TASK-179.
   */
  readonly roleBoundToFunction: false;

  /** The owner responsible for the final role → Lambda binding. */
  readonly finalBindingOwner: 'TASK-179';
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface RecoveryGateFnRoleConstructProps {
  /** TASK-059 typed environment context */
  readonly envContext: EnvironmentContext;

  /**
   * Stable role name. Must be non-empty, no credential-like substrings.
   */
  readonly roleName: string;

  /**
   * Exact ARN of the IdempotencyTable.
   * Must be a valid DynamoDB table ARN (arn:aws:dynamodb:...).
   * RecoveryGateFn may only GetItem this table (read-only).
   */
  readonly idempotencyTableArn: string;

  /**
   * Exact ARN of the DecisionCoreTable.
   * Must be a valid DynamoDB table ARN (arn:aws:dynamodb:...).
   * RecoveryGateFn may only GetItem this table (read-only).
   */
  readonly decisionCoreTableArn: string;

  /**
   * Exact ARN of the DecisionNarrativeTable.
   * Must be a valid DynamoDB table ARN (arn:aws:dynamodb:...).
   * RecoveryGateFn may only Query this table (base table only, no GSI/index).
   * The ARN must NOT include an index suffix.
   */
  readonly decisionNarrativeTableArn: string;

  /**
   * ARN of the RecoveryGateFn's dedicated CloudWatch Log Group (created by TASK-075).
   * Used to scope logs:CreateLogStream / logs:PutLogEvents to this function's streams.
   */
  readonly recoveryGateLogGroupArn: string;
}

// ─── Validation ────────────────────────────────────────────────────────────────

const FORBIDDEN_ROLENAME_SUBSTRINGS = [
  'credential',
  'token',
  'password',
  'access',
  'secret',
  'key',
] as const;

function validateArn(label: string, arn: string): void {
  if (!arn || typeof arn !== 'string' || arn.trim() === '') {
    throw new Error(`${label} must be a non-empty string`);
  }
  if (arn.startsWith('${') || arn.includes('Token[')) return;
}

function validateLogGroupArn(label: string, arn: string): void {
  validateArn(label, arn);
  if (arn.startsWith('${') || arn.includes('Token[')) return;
  if (!arn.startsWith('arn:aws:logs:')) {
    throw new Error(`${label} must be a CloudWatch Logs ARN (arn:aws:logs:...), got: ${arn}`);
  }
  if (arn.endsWith(':log-stream:*') || arn.endsWith(':log-stream')) {
    throw new Error(
      `${label} must be a log-group ARN, not a log-stream ARN (remove :log-stream:* suffix): ${arn}`,
    );
  }
}

function validateDynamoArn(label: string, arn: string): void {
  validateArn(label, arn);
  if (arn.startsWith('${') || arn.includes('Token[')) return;
  if (!arn.startsWith('arn:aws:dynamodb:')) {
    throw new Error(`${label} must be a DynamoDB table ARN (arn:aws:dynamodb:...), got: ${arn}`);
  }
  if (arn.includes('/index/')) {
    throw new Error(
      `${label} must be a base table ARN, not an index ARN (must not contain /index/): ${arn}`,
    );
  }
}

function validateRoleName(name: string): void {
  if (!name || typeof name !== 'string' || name.trim() === '') {
    throw new Error('roleName must be a non-empty string');
  }
  const trimmed = name.trim();
  if (trimmed !== name) {
    throw new Error(`roleName must not have leading/trailing whitespace: "${name}"`);
  }
  for (const forbidden of FORBIDDEN_ROLENAME_SUBSTRINGS) {
    if (trimmed.toLowerCase().includes(forbidden)) {
      throw new Error(
        `roleName "${name}" must not contain credential-like substring "${forbidden}"`,
      );
    }
  }
}

// ─── Construct ───────────────────────────────────────────────────────────────

export class RecoveryGateFnRoleConstruct extends Construct {
  /** The execution role (undefined in LOCAL_MOCK). */
  public readonly role: Role | undefined;

  /** The role ARN (undefined in LOCAL_MOCK). */
  public readonly roleArn: string | undefined;

  /** The inline access policy (undefined in LOCAL_MOCK). */
  public readonly policy: Policy | undefined;

  /**
   * Machine-readable evidence for TASK-179 binding assertions.
   * Always populated, even in LOCAL_MOCK (empty arrays / zero counts).
   */
  public readonly evidence: RecoveryGateFnRoleEvidence;

  public constructor(scope: Construct, id: string, props: RecoveryGateFnRoleConstructProps) {
    super(scope, id);

    const {
      envContext,
      roleName,
      idempotencyTableArn,
      decisionCoreTableArn,
      decisionNarrativeTableArn,
      recoveryGateLogGroupArn,
    } = props;

    // ── Validate before creating any AWS resource ─────────────────────────────

    validateRoleName(roleName);
    validateDynamoArn('idempotencyTableArn', idempotencyTableArn);
    validateDynamoArn('decisionCoreTableArn', decisionCoreTableArn);
    validateDynamoArn('decisionNarrativeTableArn', decisionNarrativeTableArn);
    validateLogGroupArn('recoveryGateLogGroupArn', recoveryGateLogGroupArn);

    if (new Set([idempotencyTableArn, decisionCoreTableArn, decisionNarrativeTableArn]).size < 3) {
      throw new Error(
        'idempotencyTableArn, decisionCoreTableArn, and decisionNarrativeTableArn must all be distinct',
      );
    }

    // ── Build evidence (always populated) ──────────────────────────────────

    this.evidence = {
      allowedIdempotencyActions: Object.freeze(['dynamodb:GetItem']),
      allowedDecisionCoreActions: Object.freeze(['dynamodb:GetItem']),
      allowedNarrativeActions: Object.freeze(['dynamodb:Query']),
      idempotencyTableArn,
      decisionCoreTableArn,
      decisionNarrativeTableArn,
      logGroupStreamArn: `${recoveryGateLogGroupArn}:log-stream:*`,
      explicitDenyCategories: Object.freeze([
        'DynamoDB:write-to-any-table',
        'Bedrock:invoke-model',
        'Bedrock:retrieve',
        'S3:write',
        'WebSocket:manage-connections',
      ]),
      wildcardAllowCount: 0,
      consistentReadEnforcedByIam: false,
      baseTableOnlyQuery: true,
      consistentReadRuntimeOwner: 'TASK-093',
      roleBoundToFunction: false,
      finalBindingOwner: 'TASK-179',
    } as RecoveryGateFnRoleEvidence;

    // ── LOCAL_MOCK: zero resources ─────────────────────────────────────────

    if (envContext.isLocalMock) {
      this.role = undefined;
      this.roleArn = undefined;
      this.policy = undefined;
      return;
    }

    // ── Create role ──────────────────────────────────────────────────────

    const role = new Role(this, 'Role', {
      roleName,
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
      inlinePolicies: {},
      // No AWS managed policies (e.g. AWSLambdaBasicExecutionRole is forbidden)
    });

    // ── Build inline policy ─────────────────────────────────────────────

    const policyDoc = new PolicyDocument({
      statements: [
        // ── A. IdempotencyTable: GetItem only (read-only) ──────────────────
        //
        // RecoveryGateFn reads the current idempotency lease to determine
        // pipeline state (starting / core_committed / rendered / published / error).
        // ConsistentRead=true on GetItem is enforced by TASK-093 at runtime.
        // RecoveryGateFn does NOT write IdempotencyTable.
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ['dynamodb:GetItem'],
          resources: [idempotencyTableArn],
        }),

        // ── B. DecisionCoreTable: GetItem only (read-only) ────────────────
        //
        // RecoveryGateFn reads the deterministic decision to evaluate recovery
        // conditions. ConsistentRead=true on GetItem is enforced by TASK-093
        // at runtime. RecoveryGateFn does NOT write DecisionCoreTable.
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ['dynamodb:GetItem'],
          resources: [decisionCoreTableArn],
        }),

        // ── C. DecisionNarrativeTable: Query only (base table, NOT GSI) ──────
        //
        // RecoveryGateFn Queries narrative records to assess branch completion.
        // IAM grants only the base table ARN — any GSI/index access is implicitly
        // denied since no index ARN is listed. ConsistentRead=true on Query is
        // enforced by TASK-093 at runtime. RecoveryGateFn does NOT write Narrative.
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ['dynamodb:Query'],
          resources: [decisionNarrativeTableArn],
        }),

        // ── D. CloudWatch Logs: dedicated log group streams ────────────────
        // Resource is "<recoveryGateLogGroupArn>:log-stream:*" — the precise
        // CloudFormation form for "all log streams under this group".
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ['logs:CreateLogStream', 'logs:PutLogEvents'],
          resources: [`${recoveryGateLogGroupArn}:log-stream:*`],
        }),

        // ── E. DynamoDB write Deny: all tables, all write actions ──────────
        // RecoveryGateFn is strictly read-only. All DynamoDB write operations
        // on all tables (including IdempotencyTable, DecisionCoreTable, Narrative)
        // are explicitly denied. This prevents any future code path from
        // accidentally writing through this role.
        new PolicyStatement({
          effect: Effect.DENY,
          actions: [
            'dynamodb:PutItem',
            'dynamodb:UpdateItem',
            'dynamodb:DeleteItem',
            'dynamodb:BatchWriteItem',
            'dynamodb:PartiQLInsert',
            'dynamodb:PartiQLUpdate',
            'dynamodb:PartiQLDelete',
          ],
          resources: ['*'],
        }),

        // ── F. Bedrock Deny: RecoveryGateFn never calls LLM ──────────────
        // RecoveryGateFn reads deterministic data only. It does NOT invoke
        // Bedrock models or retrieve Knowledge Base content.
        // Note: Converse/ConverseStream are NOT included because they are
        // IAM action names that are aliases for InvokeModel/InvokeModelWithResponseStream.
        new PolicyStatement({
          effect: Effect.DENY,
          actions: [
            'bedrock:InvokeModel',
            'bedrock:InvokeModelWithResponseStream',
            'bedrock:Retrieve',
            'bedrock:RetrieveAndGenerate',
          ],
          resources: ['*'],
        }),

        // ── G. S3 write Deny ─────────────────────────────────────────────
        new PolicyStatement({
          effect: Effect.DENY,
          actions: [
            's3:PutObject',
            's3:DeleteObject',
            's3:DeleteObjectVersion',
            's3:AbortMultipartUpload',
            's3:RestoreObject',
          ],
          resources: ['*'],
        }),

        // ── H. WebSocket Deny: WsPushFn owns PostToConnection ─────────────
        new PolicyStatement({
          effect: Effect.DENY,
          actions: ['execute-api:ManageConnections'],
          resources: ['*'],
        }),
      ],
    });

    const policy = new Policy(this, 'Policy', {
      document: policyDoc,
    });

    role.attachInlinePolicy(policy);

    this.role = role;
    this.roleArn = role.roleArn;
    this.policy = policy;
  }
}
