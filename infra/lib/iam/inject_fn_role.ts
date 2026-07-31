/**
 * InjectFnRole — least-privilege execution role for the event-injection Lambda
 *
 * §18, §8, §15.1, §9, FIX-2, TASK-076
 *
 * InjectFn is the event gateway: it acquires a idempotency lease, starts the
 * Step Functions workflow, and resolves stale-running requests. It does NOT
 * own decision truth, publish records, WebSocket pushes, or Bedrock calls.
 *
 * ─── What InjectFn OWNS ──────────────────────────────────────────────
 *
 *   - Acquires / renews idempotency lease (new → starting, retry,
 *     stale-running → starting)
 *   - Starts the Step Functions workflow (exactly one state machine)
 *   - Calls RecoveryGateFn (read-only, for stale-running reconciliation)
 *   - Calls WorkflowStatusFn (status transitions, fenced by execution ARN)
 *   - Writes to its own dedicated CloudWatch Log Group (via TASK-075)
 *   - Reads its competition-environment SSM config hierarchy
 *
 * ─── What InjectFn MUST NOT do ─────────────────────────────────────
 *
 *   - Write to DecisionCoreTable / DecisionNarrativeTable / PublishRecordTable
 *   - Invoke any Lambda other than RecoveryGateFn / WorkflowStatusFn
 *   - Call Bedrock or Knowledge Base
 *   - PostToConnection (WebSocket push is WsPushFn / RealtimePublisher's job)
 *   - Write to S3
 *   - GetSecretValue (TASK-074 owns Secrets Manager)
 *
 * ─── X-Ray boundary ─────────────────────────────────────────────────
 *
 *   TASK-075 sets TracingConfig.Mode on the Lambda.  The IAM capability
 *   for xray:PutTraceSegments / PutTelemetryRecords is left to TASK-179,
 *   which is the sole final-binding owner for all role → Lambda bindings.
 *
 *   ACTIVE tracing infrastructure exists (TracingConfig), but effective
 *   X-Ray IAM publishing depends on TASK-179 completing the conditional
 *   role grants based on observability.xray_enabled.
 *
 * ─── Security boundaries (precise) ─────────────────────────────────
 *
 * This construct creates:
 *   - 1 × AWS::IAM::Role     (PERSONAL_AWS_DEV / COMPETITION_AWS)
 *   - 1 × AWS::IAM::Policy  (PERSONAL_AWS_DEV / COMPETITION_AWS, inline)
 *
 * This construct NEVER creates:
 *   - Lambda / DynamoDB / Step Functions / SSM Parameter / Log Group /
 *     KMS / Secret / SNS / EventBridge / CloudWatch / X-Ray resources
 *   - AWS managed policies (e.g. AWSLambdaBasicExecutionRole)
 *   - External references to process.env
 *   - Hard-coded account, region, or ARN
 *
 * LOCAL_MOCK: zero AWS resources (role / policy stay undefined).
 *
 * ─── Ownership chain ───────────────────────────────────────────────
 *
 *   role defined:              YES (here, TASK-076)
 *   role final-bound to Lambda: NO  (TASK-179)
 *   final binding owner:        TASK-179
 *   X-Ray IAM grants owner:     TASK-179 (conditional on xray_enabled)
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
export interface InjectFnRoleEvidence {
  /** Actions allowed on the Idempotency DynamoDB table. */
  readonly allowedDynamoActions: readonly string[];

  /** The exact Idempotency Table ARN. */
  readonly idempotencyTableArn: string;

  /** The exact Step Functions state machine ARN. */
  readonly stateMachineArn: string;

  /** The two Lambda ARNs that this role may invoke. */
  readonly allowedLambdaArns: readonly [string, string];

  /** The dedicated CloudWatch Log Group ARN that this role may write to. */
  readonly allowedLogGroupArn: string;

  /** The SSM parameter hierarchy ARN that this role may read from. */
  readonly ssmHierarchyArn: string;

  /** Categories explicitly denied (proves the deny list is intentional). */
  readonly explicitDenyCategories: readonly string[];

  /** Count of ALLOW statements using Resource "*". Must be 0. */
  readonly wildcardAllowCount: number;

  /**
   * This role is NOT yet bound to the InjectFn Lambda.
   * Final binding is owned by TASK-179.
   */
  readonly roleBoundToFunction: false;

  /** The owner responsible for the final role → Lambda binding. */
  readonly finalBindingOwner: 'TASK-179';
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface InjectFnRoleConstructProps {
  /** TASK-059 typed environment context */
  readonly envContext: EnvironmentContext;

  /**
   * Stable role name. Must be non-empty, no credential-like substrings.
   */
  readonly roleName: string;

  /**
   * Exact ARN of the IdempotencyTable.
   * Must be a valid DynamoDB table ARN (arn:aws:dynamodb:...:table/...).
   */
  readonly idempotencyTableArn: string;

  /**
   * Exact ARN of the Workflow State Machine.
   * Must be a valid Step Functions state machine ARN.
   */
  readonly workflowStateMachineArn: string;

  /**
   * Exact ARN of the RecoveryGateFn Lambda.
   * Must be a valid Lambda function ARN.
   */
  readonly recoveryGateFunctionArn: string;

  /**
   * Exact ARN of the WorkflowStatusFn Lambda.
   * Must be a valid Lambda function ARN and must differ from recoveryGateFunctionArn.
   */
  readonly workflowStatusFunctionArn: string;

  /**
   * ARN of the InjectFn's dedicated CloudWatch Log Group (created by TASK-075).
   * Used to scope logs:CreateLogStream / logs:PutLogEvents to this function's streams.
   */
  readonly injectLogGroupArn: string;

  /**
   * ARN of the SSM parameter hierarchy for this environment's non-secret config.
   * InjectFn reads its competition config from this hierarchy.
   * Must be a valid SSM parameter ARN prefix (e.g. arn:aws:ssm:...:parameter/city-commander/personal-dev).
   */
  readonly ssmParameterHierarchyArn: string;
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
  // Allow unresolved CDK tokens (they resolve at deploy time)
  if (arn.startsWith('${') || arn.includes('Token[')) return;
}

function validateLogGroupArn(label: string, arn: string): void {
  if (!arn || typeof arn !== 'string' || arn.trim() === '') {
    throw new Error(`${label} must be a non-empty string`);
  }
  if (arn.startsWith('${') || arn.includes('Token[')) return;
  if (!arn.startsWith('arn:aws:logs:')) {
    throw new Error(`${label} must be a CloudWatch Logs ARN (arn:aws:logs:...), got: ${arn}`);
  }
}

function validateLambdaArn(label: string, arn: string): void {
  validateArn(label, arn);
  if (arn.startsWith('${') || arn.includes('Token[')) return;
  if (!arn.startsWith('arn:aws:lambda:')) {
    throw new Error(`${label} must be a Lambda ARN (arn:aws:lambda:...), got: ${arn}`);
  }
}

function validateDynamoArn(label: string, arn: string): void {
  validateArn(label, arn);
  if (arn.startsWith('${') || arn.includes('Token[')) return;
  if (!arn.startsWith('arn:aws:dynamodb:')) {
    throw new Error(`${label} must be a DynamoDB table ARN (arn:aws:dynamodb:...), got: ${arn}`);
  }
}

function validateSfnArn(label: string, arn: string): void {
  validateArn(label, arn);
  if (arn.startsWith('${') || arn.includes('Token[')) return;
  if (!arn.startsWith('arn:aws:states:')) {
    throw new Error(`${label} must be a Step Functions ARN (arn:aws:states:...), got: ${arn}`);
  }
}

function validateSsmArn(label: string, arn: string): void {
  if (!arn || typeof arn !== 'string' || arn.trim() === '') {
    throw new Error(`${label} must be a non-empty string`);
  }
  if (arn.startsWith('${') || arn.includes('Token[')) return;
  if (!arn.startsWith('arn:aws:ssm:')) {
    throw new Error(`${label} must be an SSM ARN (arn:aws:ssm:...), got: ${arn}`);
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

export class InjectFnRoleConstruct extends Construct {
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
  public readonly evidence: InjectFnRoleEvidence;

  public constructor(scope: Construct, id: string, props: InjectFnRoleConstructProps) {
    super(scope, id);

    const {
      envContext,
      roleName,
      idempotencyTableArn,
      workflowStateMachineArn,
      recoveryGateFunctionArn,
      workflowStatusFunctionArn,
      injectLogGroupArn,
      ssmParameterHierarchyArn,
    } = props;

    // ── Validate before creating any AWS resource ─────────────────────────────

    validateRoleName(roleName);
    validateDynamoArn('idempotencyTableArn', idempotencyTableArn);
    validateSfnArn('workflowStateMachineArn', workflowStateMachineArn);
    validateLambdaArn('recoveryGateFunctionArn', recoveryGateFunctionArn);
    validateLambdaArn('workflowStatusFunctionArn', workflowStatusFunctionArn);
    validateLogGroupArn('injectLogGroupArn', injectLogGroupArn);
    validateSsmArn('ssmParameterHierarchyArn', ssmParameterHierarchyArn);

    if (recoveryGateFunctionArn === workflowStatusFunctionArn) {
      throw new Error(
        'recoveryGateFunctionArn and workflowStatusFunctionArn must be distinct ARNs',
      );
    }

    // ── Build evidence (always populated) ──────────────────────────────────

    this.evidence = {
      allowedDynamoActions: Object.freeze(['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem']),
      idempotencyTableArn,
      stateMachineArn: workflowStateMachineArn,
      allowedLambdaArns: Object.freeze([recoveryGateFunctionArn, workflowStatusFunctionArn]),
      allowedLogGroupArn: injectLogGroupArn,
      ssmHierarchyArn: ssmParameterHierarchyArn,
      explicitDenyCategories: Object.freeze([
        'Lambda:invoke-unknown-function',
        'DynamoDB:write-to-unknown-table',
        'Bedrock:invoke-model',
        'Bedrock:retrieve',
        'WebSocket:manage-connections',
        'S3:write',
      ]),
      wildcardAllowCount: 0,
      roleBoundToFunction: false,
      finalBindingOwner: 'TASK-179',
    } as InjectFnRoleEvidence;

    // ── LOCAL_MOCK: zero resources ─────────────────────────────────────────

    if (envContext.isLocalMock) {
      this.role = undefined;
      this.roleArn = undefined;
      this.policy = undefined;
      return;
    }

    // ── Trust policy: Lambda service only ──────────────────────────────────
    //
    // The trust policy is attached implicitly via `Role.assumedBy` below;
    // a separate PolicyDocument would be redundant and is unused.

    // ── Create role ──────────────────────────────────────────────────────

    const role = new Role(this, 'Role', {
      roleName,
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
      inlinePolicies: {},
      // No AWS managed policies (AWSLambdaBasicExecutionRole etc. are forbidden)
    });

    // ── Build inline policy ───────────────────────────────────────────────

    const policyDoc = new PolicyDocument({
      statements: [
        // ── A. Idempotency Table: exact GetItem + PutItem + UpdateItem ────
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem'],
          resources: [idempotencyTableArn],
        }),

        // ── B. Step Functions: StartExecution only ────────────────────────
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ['states:StartExecution'],
          resources: [workflowStateMachineArn],
        }),

        // ── C. Lambda: exact RecoveryGateFn + WorkflowStatusFn ────────────
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ['lambda:InvokeFunction'],
          resources: [recoveryGateFunctionArn, workflowStatusFunctionArn],
        }),

        // ── D. CloudWatch Logs: scoped to dedicated log group streams ─────────
        // The resource is "<injectLogGroupArn>:log-stream:*" — this is the
        // precise CloudFormation form for "all log streams under this group".
        // CDK resolves unresolved logGroupArn tokens as FnSub at deploy time,
        // so the composite string is evaluated after the token resolves.
        // NOT a full-account wildcard; NOT a bare log group ARN.
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ['logs:CreateLogStream', 'logs:PutLogEvents'],
          resources: [`${injectLogGroupArn}:log-stream:*`],
        }),

        // ── E. SSM: read config hierarchy ────────────────────────────────
        // The SSM hierarchy ARN with "/*" suffix — matches all parameters
        // beneath the hierarchy (bounded, not cross-environment).
        // Example: ".../COMPETITION_AWS/*" matches ".../COMPETITION_AWS/api/endpoint"
        // but NOT ".../COMPETITION_AWS_EVIL/..." (path boundary enforced by /).
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ['ssm:GetParametersByPath'],
          resources: [`${ssmParameterHierarchyArn}/*`],
        }),

        // ── F. Lambda Deny: NotResource — blocks all OTHER functions ─────
        // AWS evaluates explicit ALLOW before this Deny. The two exact ARNs
        // above remain ALLOWED. All other Lambda invocations are denied.
        new PolicyStatement({
          effect: Effect.DENY,
          actions: ['lambda:InvokeFunction'],
          notResources: [recoveryGateFunctionArn, workflowStatusFunctionArn],
        }),

        // ── G. DynamoDB Deny: block writes to ALL tables except IdempotencyTable ─
        // Only the exact IdempotencyTable ARN is excluded (ALLOW above covers it).
        // Uses `notResources: [exactArn]` so the Deny does NOT apply to IdempotencyTable.
        // Exact action set covers all item-write andPartiQL-write paths:
        //   PutItem, UpdateItem, DeleteItem, BatchWriteItem,
        //   PartiQLInsert, PartiQLUpdate, PartiQLDelete
        // Invalid (excluded): TransactWriteItems, ExecuteTransaction,
        //   ExecuteTransactionItems — those are table-level wrappers, not item writes.
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

        // ── H. Bedrock Deny: all model invocation actions ─────────────────
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

        // ── I. WebSocket Deny: prevent direct PostToConnection ───────────
        // The execute-api:ManageConnections is the IAM action used by
        // API Gateway WebSocket $connect / PostToConnection.
        new PolicyStatement({
          effect: Effect.DENY,
          actions: ['execute-api:ManageConnections'],
          resources: ['*'],
        }),

        // ── J. S3 Deny: block all S3 write operations ───────────────────
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
