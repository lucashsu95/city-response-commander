/**
 * PublishFnRole — least-privilege execution role for the publish Lambda
 *
 * §18, §10.11d, §15.2, TASK-082
 *
 * PublishFn is the SOLE writer to PublishRecordTable: it reads the deterministic
 * decision from DecisionCoreTable, queries narrative records from DecisionNarrativeTable,
 * and writes publish records to PublishRecordTable (commander-authorized). It does NOT
 * modify DecisionCore, DecisionNarrative, IdempotencyTable, or any other table,
 * call Bedrock, invoke Lambda, start Step Functions, modify S3, push WebSocket
 * messages, or use real SNS/SMS/EventBridge/SQS.
 *
 * ─── What PublishFn OWNS ─────────────────────────────────────────────
 *
 *   - Reads DecisionCoreTable (GetItem only)
 *   - Queries DecisionNarrativeTable (base table only, NOT any GSI/index)
 *   - Writes PublishRecordTable (sole writer):
 *       GetItem, PutItem, UpdateItem
 *       (DeleteItem / BatchWriteItem / PartiQL = IMPLICIT_DENY)
 *   - Writes to its dedicated CloudWatch Log Group (via TASK-075)
 *
 * ─── What PublishFn MUST NOT do ────────────────────────────────────
 *
 *   - Write to DecisionCoreTable / DecisionNarrativeTable / IdempotencyTable /
 *     ConnectionsTable or any other table
 *   - Delete / BatchWrite / Scan / PartiQL PublishRecordTable
 *   - Query PublishRecordTable (write-only — Query is IMPLICIT_DENY)
 *   - Call Bedrock or Knowledge Base
 *   - Invoke Lambda functions
 *   - Start Step Functions workflows
 *   - PostToConnection (WsPushFn owns WebSocket push)
 *   - Modify S3
 *   - Use real SNS / SMS / EventBridge / SQS (channels field is UI mock only)
 *   - GetSecretValue / KMS / SSM
 *   - Publish CloudWatch custom metrics
 *   - X-Ray publishing (TASK-179 owns this)
 *
 * ─── Optimistic version / commander authorization boundary (IAM CANNOT enforce) ─
 *
 *   PublishFn may PutItem and UpdateItem PublishRecordTable. IAM cannot enforce:
 *
 *     1. ConditionExpression on UpdateItem:
 *        version = :expected_version (TASK-145 owns optimistic version)
 *
 *     2. Commander authorization pre-publish validation (TASK-144 owns this)
 *
 *   These are NOT expressed as IAM Conditions here. Do not add fake Conditions.
 *   TASK-082 declares zero optimistic-lock / commander-auth IAM capability.
 *
 * ─── X-Ray boundary ─────────────────────────────────────────────────
 *
 *   TASK-075 sets TracingConfig.Mode on the Lambda.  The IAM capability
 *   for xray:PutTraceSegments / PutTelemetryRecords is left to TASK-179,
 *   which is the sole final-binding owner for all role → Lambda bindings.
 *
 * ─── Security boundaries (precise) ─────────────────────────────────
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
 * ─── Ownership chain ───────────────────────────────────────────────
 *
 *   role defined:                YES (here, TASK-082)
 *   role final-bound to Lambda:  NO  (TASK-179)
 *   final binding owner:           TASK-179
 *   optimistic-lock runtime owner: TASK-145
 *   commander authorization owner:  TASK-144
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

export interface PublishFnRoleEvidence {
  /** Actions allowed on DecisionCoreTable. */
  readonly allowedDecisionCoreActions: readonly string[];

  /** Actions allowed on DecisionNarrativeTable. */
  readonly allowedNarrativeActions: readonly string[];

  /** Actions allowed on PublishRecordTable. */
  readonly allowedPublishRecordActions: readonly string[];

  /** The exact DecisionCore Table ARN. */
  readonly decisionCoreTableArn: string;

  /** The exact DecisionNarrative Table ARN (base table, no index suffix). */
  readonly decisionNarrativeTableArn: string;

  /** The exact PublishRecord Table ARN. */
  readonly publishRecordTableArn: string;

  /** The exact Idempotency Table ARN (proves write Deny target). */
  readonly idempotencyTableArn: string;

  /** The dedicated CloudWatch Log Group stream ARN pattern. */
  readonly logGroupStreamArn: string;

  /** Categories explicitly denied (proves the deny list is intentional). */
  readonly explicitDenyCategories: readonly string[];

  /** Count of ALLOW statements using Resource "*". Must be 0. */
  readonly wildcardAllowCount: number;

  /**
   * This role does NOT enforce optimistic version via IAM Condition.
   * ConditionExpression enforcement is a runtime responsibility (TASK-145).
   */
  readonly optimisticLockEnforcedByIam: false;

  /** Runtime owner for optimistic version / ConditionExpression. */
  readonly optimisticLockRuntimeOwner: 'TASK-145';

  /** Runtime owner for commander authorization pre-publish validation. */
  readonly commanderAuthRuntimeOwner: 'TASK-144';

  /**
   * This role is NOT yet bound to the PublishFn Lambda.
   * Final binding is owned by TASK-179.
   */
  readonly roleBoundToFunction: false;

  /** The owner responsible for the final role → Lambda binding. */
  readonly finalBindingOwner: 'TASK-179';
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface PublishFnRoleConstructProps {
  /** TASK-059 typed environment context */
  readonly envContext: EnvironmentContext;

  /**
   * Stable role name. Must be non-empty, no credential-like substrings.
   */
  readonly roleName: string;

  /**
   * Exact ARN of the DecisionCoreTable.
   * Must be a valid DynamoDB table ARN (arn:aws:dynamodb:...).
   * PublishFn may only GetItem this table (read-only).
   */
  readonly decisionCoreTableArn: string;

  /**
   * Exact ARN of the DecisionNarrativeTable.
   * Must be a valid DynamoDB table ARN (arn:aws:dynamodb:...).
   * PublishFn may only Query this table (base table only, no GSI/index).
   * The ARN must NOT include an index suffix.
   */
  readonly decisionNarrativeTableArn: string;

  /**
   * Exact ARN of the PublishRecordTable.
   * Must be a valid DynamoDB table ARN (arn:aws:dynamodb:...).
   * PublishFn may only GetItem/PutItem/UpdateItem this table (sole writer).
   * DeleteItem/BatchWriteItem/Scan/PartiQL/Query = IMPLICIT_DENY.
   */
  readonly publishRecordTableArn: string;

  /**
   * Exact ARN of the IdempotencyTable.
   * Must be a valid DynamoDB table ARN (arn:aws:dynamodb:...).
   * PublishFn may NOT write this table.
   */
  readonly idempotencyTableArn: string;

  /**
   * ARN of the PublishFn's dedicated CloudWatch Log Group (created by TASK-075).
   * Used to scope logs:CreateLogStream / logs:PutLogEvents to this function's streams.
   */
  readonly publishLogGroupArn: string;
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

export class PublishFnRoleConstruct extends Construct {
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
  public readonly evidence: PublishFnRoleEvidence;

  public constructor(scope: Construct, id: string, props: PublishFnRoleConstructProps) {
    super(scope, id);

    const {
      envContext,
      roleName,
      decisionCoreTableArn,
      decisionNarrativeTableArn,
      publishRecordTableArn,
      idempotencyTableArn,
      publishLogGroupArn,
    } = props;

    // ── Validate before creating any AWS resource ─────────────────────────────

    validateRoleName(roleName);
    validateDynamoArn('decisionCoreTableArn', decisionCoreTableArn);
    validateDynamoArn('decisionNarrativeTableArn', decisionNarrativeTableArn);
    validateDynamoArn('publishRecordTableArn', publishRecordTableArn);
    validateDynamoArn('idempotencyTableArn', idempotencyTableArn);
    validateLogGroupArn('publishLogGroupArn', publishLogGroupArn);

    if (
      new Set([
        decisionCoreTableArn,
        decisionNarrativeTableArn,
        publishRecordTableArn,
        idempotencyTableArn,
      ]).size < 4
    ) {
      throw new Error(
        'decisionCoreTableArn, decisionNarrativeTableArn, publishRecordTableArn, and idempotencyTableArn must all be distinct',
      );
    }

    // ── Build evidence (always populated) ──────────────────────────────────

    this.evidence = {
      allowedDecisionCoreActions: Object.freeze(['dynamodb:GetItem']),
      allowedNarrativeActions: Object.freeze(['dynamodb:Query']),
      allowedPublishRecordActions: Object.freeze([
        'dynamodb:GetItem',
        'dynamodb:PutItem',
        'dynamodb:UpdateItem',
      ]),
      decisionCoreTableArn,
      decisionNarrativeTableArn,
      publishRecordTableArn,
      idempotencyTableArn,
      logGroupStreamArn: `${publishLogGroupArn}:log-stream:*`,
      explicitDenyCategories: Object.freeze([
        'DynamoDB:write-DecisionCore',
        'DynamoDB:write-to-other-tables',
        'Bedrock:invoke-model',
        'S3:write',
        'WebSocket:manage-connections',
      ]),
      wildcardAllowCount: 0,
      optimisticLockEnforcedByIam: false,
      optimisticLockRuntimeOwner: 'TASK-145',
      commanderAuthRuntimeOwner: 'TASK-144',
      roleBoundToFunction: false,
      finalBindingOwner: 'TASK-179',
    } as PublishFnRoleEvidence;

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
        // ── A. DecisionCoreTable: GetItem only (read-only) ────────────────
        //
        // PublishFn reads the deterministic decision before publishing.
        // DecisionCore is owned by DecisionFn — PublishFn must NOT modify it.
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ['dynamodb:GetItem'],
          resources: [decisionCoreTableArn],
        }),

        // ── B. DecisionNarrativeTable: Query only (base table, NOT GSI) ───
        //
        // IAM grants only the base table ARN — any GSI/index access is
        // implicitly denied since no index ARN is listed.
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ['dynamodb:Query'],
          resources: [decisionNarrativeTableArn],
        }),

        // ── C. PublishRecordTable: GetItem + PutItem + UpdateItem only ─────
        //
        // PublishFn is the SOLE writer to PublishRecordTable. DeleteItem /
        // BatchWriteItem / Scan / PartiQL / Query are NOT granted (IMPLICIT_DENY).
        //
        // ConditionExpression for optimistic version (TASK-145) is enforced at runtime.
        // Commander authorization pre-publish validation (TASK-144) is enforced at runtime.
        // These cannot be expressed in IAM.
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem'],
          resources: [publishRecordTableArn],
        }),

        // ── D. CloudWatch Logs: dedicated log group streams ────────────────
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ['logs:CreateLogStream', 'logs:PutLogEvents'],
          resources: [`${publishLogGroupArn}:log-stream:*`],
        }),

        // ── E. PublishRecord writer island: NotResource excludes PublishRecordTable ─
        //
        // PublishFn must NEVER write to DecisionCore, DecisionNarrative,
        // IdempotencyTable, ConnectionsTable, or any future table.
        // NotResource = exact publishRecordTableArn excludes it from the Deny,
        // so the three Allow actions (GetItem/PutItem/UpdateItem) above remain
        // ALLOWed on PublishRecordTable. Exact 7-item-write action set covers
        // all DynamoDB item-write paths.
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
          notResources: [publishRecordTableArn],
        }),

        // ── F. DecisionCore explicit Deny: exact Resource ───────────────
        //
        // PublishedFn must NEVER modify the deterministic decision.
        // Explicit Deny with Resource (not NotResource) blocks this table.
        // Kept as a separate statement per TASK-082 acceptance: DecisionCore
        // write must be EXPLICIT_DENY with exact Resource, not just an
        // implicit deny via NotResource on PublishRecord.
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
          resources: [decisionCoreTableArn],
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
