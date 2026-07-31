/**
 * WorkflowStatusFnRole — least-privilege execution role for the workflow-status Lambda
 *
 * §18, §10.11e, §15.2, TASK-079
 *
 * WorkflowStatusFn is the state-transition gate: it reads the current idempotency
 * lease from IdempotencyTable and updates status transitions (e.g. core_committed,
 * rendered, published, error). It does NOT write decision records, narratives,
 * publish records, call Bedrock, modify S3, or push WebSocket messages.
 *
 * ─── What WorkflowStatusFn OWNS ────────────────────────────────────────────
 *
 *   - Reads IdempotencyTable (GetItem with ConsistentRead, execution_id fence)
 *   - Updates IdempotencyTable (UpdateItem with execution_id fencing condition)
 *   - Writes to its dedicated CloudWatch Log Group (via TASK-075)
 *
 * ─── What WorkflowStatusFn MUST NOT do ──────────────────────────────────
 *
 *   - Write to DecisionCoreTable / DecisionNarrativeTable / PublishRecordTable
 *   - Write to ConnectionsTable or any other table
 *   - Call Bedrock or Knowledge Base
 *   - Invoke Lambda functions
 *   - Start Step Functions workflows
 *   - PostToConnection (WsPushFn owns WebSocket push)
 *   - Write to S3
 *   - GetSecretValue / KMS / SSM read (not needed by this function)
 *   - Publish CloudWatch custom metrics
 *   - X-Ray publishing (TASK-179 owns this)
 *
 * ─── Runtime fencing boundaries (IAM CANNOT enforce) ─────────────────────
 *
 *   WorkflowStatusFn may GetItem and UpdateItem IdempotencyTable. IAM cannot
 *   enforce the following constraints — they are the sole responsibility of
 *   the WorkflowStatusFn runtime (TASK-089, TASK-090, TASK-091, TASK-097):
 *
 *     1. ConsistentRead=true on every GetItem
 *        (prevents stale in-flight lease reads during concurrent updates)
 *
 *     2. UpdateItem ConditionExpression: attribute_exists(idempotency_key)
 *        AND #execution_id = :expected_execution_id
 *        (prevents cross-workflow state stomping via execution_arn fencing)
 *
 *   These are NOT expressed as IAM Conditions here. Do not add fake Conditions.
 *   TASK-079 declares zero fencing capability in IAM.
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
 *   role defined:                YES (here, TASK-079)
 *   role final-bound to Lambda:  NO  (TASK-179)
 *   final binding owner:           TASK-179
 *   runtime consistent-read owner: TASK-089 / TASK-090 / TASK-091 / TASK-097
 *   runtime fencing owner:         TASK-089 / TASK-090 / TASK-091 / TASK-097
 *   X-Ray IAM grants owner:       TASK-179
 */

import { Construct } from 'constructs';
import { Effect, Policy, PolicyDocument, PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import type { EnvironmentContext } from '../env_context.js';

// ─── Evidence contract ────────────────────────────────────────────────────────

/**
 * Machine-readable evidence produced by this construct.
 * Downstream tasks (TASK-179) use this to assert correctness without
 * inspecting the internal policy document.
 */
export interface WorkflowStatusFnRoleEvidence {
  /** Actions allowed on the Idempotency DynamoDB table. */
  readonly allowedDynamoActions: readonly string[];

  /** The exact Idempotency Table ARN. */
  readonly idempotencyTableArn: string;

  /** The dedicated CloudWatch Log Group stream ARN pattern. */
  readonly logGroupStreamArn: string;

  /** Categories explicitly denied (proves the deny list is intentional). */
  readonly explicitDenyCategories: readonly string[];

  /** Count of ALLOW statements using Resource "*". Must be 0. */
  readonly wildcardAllowCount: number;

  /**
   * This role does NOT use ConsistentRead on GetItem.
   * ConsistentRead=true enforcement is a runtime responsibility (TASK-089+).
   * IAM cannot express this constraint.
   */
  readonly consistentReadEnforcedByIam: false;

  /**
   * This role does NOT enforce UpdateItem execution_id fencing.
   * ConditionExpression enforcement is a runtime responsibility (TASK-089+).
   * IAM cannot express this constraint.
   */
  readonly fencingEnforcedByIam: false;

  /**
   * Runtime owner for ConsistentRead and fencing enforcement.
   */
  readonly runtimeFencingOwner: 'TASK-089 / TASK-090 / TASK-091 / TASK-097';

  /**
   * This role is NOT yet bound to the WorkflowStatusFn Lambda.
   * Final binding is owned by TASK-179.
   */
  readonly roleBoundToFunction: false;

  /** The owner responsible for the final role → Lambda binding. */
  readonly finalBindingOwner: 'TASK-179';
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface WorkflowStatusFnRoleConstructProps {
  /** TASK-059 typed environment context */
  readonly envContext: EnvironmentContext;

  /**
   * Stable role name. Must be non-empty, no credential-like substrings.
   */
  readonly roleName: string;

  /**
   * Exact ARN of the IdempotencyTable.
   * Must be a valid DynamoDB table ARN (arn:aws:dynamodb:...).
   * WorkflowStatusFn may only GetItem / UpdateItem this table.
   */
  readonly idempotencyTableArn: string;

  /**
   * ARN of the WorkflowStatusFn's dedicated CloudWatch Log Group (created by TASK-075).
   * Used to scope logs:CreateLogStream / logs:PutLogEvents to this function's streams.
   */
  readonly workflowStatusLogGroupArn: string;
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

export class WorkflowStatusFnRoleConstruct extends Construct {
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
  public readonly evidence: WorkflowStatusFnRoleEvidence;

  public constructor(
    scope: Construct,
    id: string,
    props: WorkflowStatusFnRoleConstructProps,
  ) {
    super(scope, id);

    const { envContext, roleName, idempotencyTableArn, workflowStatusLogGroupArn } = props;

    // ── Validate before creating any AWS resource ─────────────────────────────

    validateRoleName(roleName);
    validateDynamoArn('idempotencyTableArn', idempotencyTableArn);
    validateLogGroupArn('workflowStatusLogGroupArn', workflowStatusLogGroupArn);

    // ── Build evidence (always populated) ──────────────────────────────────

    this.evidence = {
      allowedDynamoActions: Object.freeze(['dynamodb:GetItem', 'dynamodb:UpdateItem']),
      idempotencyTableArn,
      logGroupStreamArn: `${workflowStatusLogGroupArn}:log-stream:*`,
      explicitDenyCategories: Object.freeze([
        'DynamoDB:write-to-other-tables',
        'Bedrock:invoke-model',
        'Bedrock:retrieve',
        'S3:write',
        'WebSocket:manage-connections',
      ]),
      wildcardAllowCount: 0,
      consistentReadEnforcedByIam: false,
      fencingEnforcedByIam: false,
      runtimeFencingOwner: 'TASK-089 / TASK-090 / TASK-091 / TASK-097',
      roleBoundToFunction: false,
      finalBindingOwner: 'TASK-179',
    } as WorkflowStatusFnRoleEvidence;

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
        // ── A. IdempotencyTable: GetItem + UpdateItem only ──────────────────
        //
        // WorkflowStatusFn reads the current idempotency lease and updates
        // state transitions. IAM allows only these two actions on IdempotencyTable.
        //
        // ConsistentRead=true on GetItem is enforced by TASK-089+ at runtime.
        // UpdateItem execution_id fencing is enforced by TASK-089+ at runtime.
        // These cannot be expressed in IAM.
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ['dynamodb:GetItem', 'dynamodb:UpdateItem'],
          resources: [idempotencyTableArn],
        }),

        // ── B. CloudWatch Logs: dedicated log group streams ────────────────
        // Resource is "<workflowStatusLogGroupArn>:log-stream:*" — the precise
        // CloudFormation form for "all log streams under this group".
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ['logs:CreateLogStream', 'logs:PutLogEvents'],
          resources: [`${workflowStatusLogGroupArn}:log-stream:*`],
        }),

        // ── C. DynamoDB other-table write Deny: NotResource excludes IdempotencyTable ─
        // WorkflowStatusFn must NEVER write to DecisionCore, Narrative, PublishRecord,
        // Connections, or any future table. NotResource = exact idempotencyTableArn
        // excludes it from the Deny, so GetItem/UpdateItem above remain ALLOWed.
        // Exact 7-item-write action set covers all DynamoDB item-write paths.
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
          notResources: [idempotencyTableArn],
        }),

        // ── D. Bedrock Deny: WorkflowStatusFn never calls LLM ────────────
        new PolicyStatement({
          effect: Effect.DENY,
          actions: [
            'bedrock:InvokeModel',
            'bedrock:InvokeModelWithResponseStream',
            'bedrock:Converse',
            'bedrock:ConverseStream',
            'bedrock:Retrieve',
            'bedrock:RetrieveAndGenerate',
          ],
          resources: ['*'],
        }),

        // ── E. S3 write Deny ─────────────────────────────────────────────
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

        // ── F. WebSocket Deny: WsPushFn owns PostToConnection ─────────────
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
