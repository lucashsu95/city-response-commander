/**
 * ApiReadFnRole — least-privilege execution role for the API read Lambda
 *
 * §18, §12, §15.2, TASK-081
 *
 * ApiReadFn is the fully read-only execution model query role: it reads
 * decision records from DecisionCoreTable, narrative records from DecisionNarrativeTable,
 * publish records from PublishRecordTable, and execution summaries from IdempotencyTable,
 * plus competition config from SSM. It does NOT write any DynamoDB table, call Bedrock,
 * invoke Step Functions, modify S3, or push WebSocket messages.
 *
 * ─── What ApiReadFn OWNS ─────────────────────────────────────────────
 *
 *   - Reads DecisionCoreTable (GetItem only)
 *   - Queries DecisionNarrativeTable (base table only, NOT any GSI/index)
 *   - Reads PublishRecordTable (GetItem only)
 *   - Reads IdempotencyTable (GetItem only — execution summary, read-only)
 *   - Reads SSM parameter hierarchy
 *   - Writes to its dedicated CloudWatch Log Group (via TASK-075)
 *
 * ─── What ApiReadFn MUST NOT do ────────────────────────────────────
 *
 *   - Write to any DynamoDB table (including IdempotencyTable)
 *   - Query IdempotencyTable (not needed; GetItem is sufficient)
 *   - Scan any table
 *   - Call Bedrock or Knowledge Base
 *   - Start Step Functions workflows
 *   - Invoke Lambda functions
 *   - PostToConnection (WsPushFn owns WebSocket push)
 *   - Write to S3
 *   - GetSecretValue / KMS / Secrets Manager
 *   - Publish CloudWatch custom metrics
 *   - X-Ray publishing (TASK-179 owns this)
 *
 * ─── IdempotencyTable boundary ─────────────────────────────────────
 *
 *   ApiReadFn reads IdempotencyTable only via GetItem (execution summary).
 *   It does NOT Query, Scan, PutItem, or UpdateItem IdempotencyTable.
 *   The GetItem-only constraint is enforced by IAM (not the runtime).
 *
 * ─── Narrative Query base-table boundary ─────────────────────────────
 *
 *   ApiReadFn queries DecisionNarrativeTable using the composite key
 *   (PK=decision_id, SK=narrative_type) directly on the base table.
 *   No GSI is used or needed. IAM grants only the base table ARN so that
 *   any GSI/index access is implicitly denied.
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
 *   role defined:          YES (here, TASK-081)
 *   role final-bound:     NO  (TASK-179)
 *   final binding owner:    TASK-179
 *   X-Ray IAM grants:      TASK-179
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

export interface ApiReadFnRoleEvidence {
  /** Actions allowed on DecisionCoreTable. */
  readonly allowedDecisionCoreActions: readonly string[];

  /** Actions allowed on DecisionNarrativeTable. */
  readonly allowedNarrativeActions: readonly string[];

  /** Actions allowed on PublishRecordTable. */
  readonly allowedPublishRecordActions: readonly string[];

  /** Actions allowed on IdempotencyTable. */
  readonly allowedIdempotencyActions: readonly string[];

  /** The exact DecisionCore Table ARN. */
  readonly decisionCoreTableArn: string;

  /** The exact DecisionNarrative Table ARN (base table, no index suffix). */
  readonly decisionNarrativeTableArn: string;

  /** The exact PublishRecord Table ARN. */
  readonly publishRecordTableArn: string;

  /** The exact Idempotency Table ARN. */
  readonly idempotencyTableArn: string;

  /** The dedicated CloudWatch Log Group stream ARN pattern. */
  readonly logGroupStreamArn: string;

  /** The SSM parameter hierarchy ARN. */
  readonly ssmHierarchyArn: string;

  /** Categories explicitly denied (proves the deny list is intentional). */
  readonly explicitDenyCategories: readonly string[];

  /** Count of ALLOW statements using Resource "*". Must be 0. */
  readonly wildcardAllowCount: number;

  /**
   * ApiReadFn may NOT Query IdempotencyTable.
   * GetItem is the only allowed action on IdempotencyTable.
   */
  readonly idempotencyQueryCapability: false;

  /**
   * ApiReadFn may NOT write IdempotencyTable.
   * IdempotencyTable write is owned by WorkflowStatusFn (TASK-079).
   */
  readonly idempotencyWriteCapability: false;

  /**
   * This role is NOT yet bound to the ApiReadFn Lambda.
   * Final binding is owned by TASK-179.
   */
  readonly roleBoundToFunction: false;

  /** The owner responsible for the final role → Lambda binding. */
  readonly finalBindingOwner: 'TASK-179';
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface ApiReadFnRoleConstructProps {
  /** TASK-059 typed environment context */
  readonly envContext: EnvironmentContext;

  /**
   * Stable role name. Must be non-empty, no credential-like substrings.
   */
  readonly roleName: string;

  /**
   * Exact ARN of the DecisionCoreTable.
   * Must be a valid DynamoDB table ARN (arn:aws:dynamodb:...).
   * ApiReadFn may only GetItem this table (read-only).
   */
  readonly decisionCoreTableArn: string;

  /**
   * Exact ARN of the DecisionNarrativeTable.
   * Must be a valid DynamoDB table ARN (arn:aws:dynamodb:...).
   * ApiReadFn may only Query this table (base table only, no GSI/index).
   * The ARN must NOT include an index suffix.
   */
  readonly decisionNarrativeTableArn: string;

  /**
   * Exact ARN of the PublishRecordTable.
   * Must be a valid DynamoDB table ARN (arn:aws:dynamodb:...).
   * ApiReadFn may only GetItem this table (read-only).
   */
  readonly publishRecordTableArn: string;

  /**
   * Exact ARN of the IdempotencyTable.
   * Must be a valid DynamoDB table ARN (arn:aws:dynamodb:...).
   * ApiReadFn may only GetItem this table (read-only — execution summary).
   * ApiReadFn may NOT Query, Scan, PutItem, or UpdateItem IdempotencyTable.
   */
  readonly idempotencyTableArn: string;

  /**
   * ARN of the ApiReadFn's dedicated CloudWatch Log Group (created by TASK-075).
   * Used to scope logs:CreateLogStream / logs:PutLogEvents to this function's streams.
   */
  readonly apiReadLogGroupArn: string;

  /**
   * ARN of the SSM parameter hierarchy for this environment's non-secret config.
   * ApiReadFn reads competition config from this hierarchy.
   * Must NOT end with a trailing wildcard; the "/*" suffix is applied in the policy.
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

function validateSsmArn(label: string, arn: string): void {
  validateArn(label, arn);
  if (arn.startsWith('${') || arn.includes('Token[')) return;
  if (!arn.startsWith('arn:aws:ssm:')) {
    throw new Error(`${label} must be an SSM ARN (arn:aws:ssm:...), got: ${arn}`);
  }
  if (arn.endsWith('/*')) {
    throw new Error(
      `${label} must be a hierarchy ARN without the /* suffix (the /* is added in the policy): ${arn}`,
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

export class ApiReadFnRoleConstruct extends Construct {
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
  public readonly evidence: ApiReadFnRoleEvidence;

  public constructor(scope: Construct, id: string, props: ApiReadFnRoleConstructProps) {
    super(scope, id);

    const {
      envContext,
      roleName,
      decisionCoreTableArn,
      decisionNarrativeTableArn,
      publishRecordTableArn,
      idempotencyTableArn,
      apiReadLogGroupArn,
      ssmParameterHierarchyArn,
    } = props;

    // ── Validate before creating any AWS resource ─────────────────────────────

    validateRoleName(roleName);
    validateDynamoArn('decisionCoreTableArn', decisionCoreTableArn);
    validateDynamoArn('decisionNarrativeTableArn', decisionNarrativeTableArn);
    validateDynamoArn('publishRecordTableArn', publishRecordTableArn);
    validateDynamoArn('idempotencyTableArn', idempotencyTableArn);
    validateLogGroupArn('apiReadLogGroupArn', apiReadLogGroupArn);
    validateSsmArn('ssmParameterHierarchyArn', ssmParameterHierarchyArn);

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
      allowedPublishRecordActions: Object.freeze(['dynamodb:GetItem']),
      allowedIdempotencyActions: Object.freeze(['dynamodb:GetItem']),
      decisionCoreTableArn,
      decisionNarrativeTableArn,
      publishRecordTableArn,
      idempotencyTableArn,
      logGroupStreamArn: `${apiReadLogGroupArn}:log-stream:*`,
      ssmHierarchyArn: ssmParameterHierarchyArn,
      explicitDenyCategories: Object.freeze([
        'DynamoDB:write-to-any-table',
        'Bedrock:invoke-model',
        'Bedrock:retrieve',
        'StepFunctions:start',
        'WebSocket:manage-connections',
        'S3:write',
      ]),
      wildcardAllowCount: 0,
      idempotencyQueryCapability: false,
      idempotencyWriteCapability: false,
      roleBoundToFunction: false,
      finalBindingOwner: 'TASK-179',
    } as ApiReadFnRoleEvidence;

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

        // ── C. PublishRecordTable: GetItem only (read-only) ────────────────
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ['dynamodb:GetItem'],
          resources: [publishRecordTableArn],
        }),

        // ── D. IdempotencyTable: GetItem only (read-only — execution summary) ─
        //
        // ApiReadFn reads IdempotencyTable via GetItem only (execution summary).
        // It may NOT Query, Scan, PutItem, or UpdateItem IdempotencyTable.
        // Write actions are blocked by the explicit Deny below.
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ['dynamodb:GetItem'],
          resources: [idempotencyTableArn],
        }),

        // ── E. CloudWatch Logs: dedicated log group streams ────────────────
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ['logs:CreateLogStream', 'logs:PutLogEvents'],
          resources: [`${apiReadLogGroupArn}:log-stream:*`],
        }),

        // ── F. SSM: read config hierarchy ────────────────────────────────
        // "/*" suffix enforces path boundary (prevents prefix collision).
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ['ssm:GetParametersByPath'],
          resources: [`${ssmParameterHierarchyArn}/*`],
        }),

        // ── G. DynamoDB write Deny: all tables, all write actions ──────────
        // ApiReadFn is strictly read-only. All DynamoDB write operations
        // on all tables (including IdempotencyTable) are explicitly denied.
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

        // ── H. Bedrock Deny: ApiReadFn never calls LLM ─────────────────
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

        // ── I. Step Functions Deny ───────────────────────────────────────
        new PolicyStatement({
          effect: Effect.DENY,
          actions: ['states:StartExecution'],
          resources: ['*'],
        }),

        // ── J. WebSocket Deny: WsPushFn owns PostToConnection ─────────────
        new PolicyStatement({
          effect: Effect.DENY,
          actions: ['execute-api:ManageConnections'],
          resources: ['*'],
        }),

        // ── K. S3 write Deny ─────────────────────────────────────────────
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
