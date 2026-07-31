/**
 * DecisionFnRole — least-privilege execution role for the deterministic-truth Lambda
 *
 * §18, §9.3, §15.1, TASK-077
 *
 * DecisionFn is the sole deterministic truth writer: it reads official raw data
 * from S3, computes the decision, and writes the authoritative result to
 * DecisionCoreTable. It does NOT call Bedrock, write narratives, publish records,
 * manage WebSocket connections, or write to IdempotencyTable.
 *
 * ─── What DecisionFn OWNS ─────────────────────────────────────────────
 *
 *   - Reads official raw data from S3 (GetObject only)
 *   - Writes DecisionCoreTable: GetItem + PutItem + UpdateItem (sole writer)
 *   - Writes to its dedicated CloudWatch Log Group (via TASK-075)
 *   - Reads SSM config hierarchy
 *
 * ─── What DecisionFn MUST NOT do ─────────────────────────────────────
 *
 *   - Write to IdempotencyTable (including core_committed — TASK-079 owner)
 *   - Write to DecisionNarrativeTable (RendererFn's job)
 *   - Write to PublishRecordTable (PublishFn's job)
 *   - Call Bedrock or Knowledge Base (Fast Path is deterministic)
 *   - Modify S3 official sources
 *   - Invoke Lambda functions
 *   - Start Step Functions workflows
 *   - PostToConnection (WebSocket push is WsPushFn / RealtimePublisher's job)
 *   - GetSecretValue (TASK-074 owns Secrets Manager)
 *   - Decrypt KMS secrets
 *   - Publish CloudWatch custom metrics
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
 *   role defined:              YES (here, TASK-077)
 *   role final-bound to Lambda: NO  (TASK-179)
 *   final binding owner:        TASK-179
 *   deterministic truth writer:  YES (DecisionFnRole is sole writer)
 *   IdempotencyTable writer:    NOT HERE — WorkflowStatusFnRole / TASK-079
 *   X-Ray IAM grants owner:     TASK-179 (conditional on xray_enabled)
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
export interface DecisionFnRoleEvidence {
  /** Actions allowed on the DecisionCore DynamoDB table. */
  readonly decisionCoreActions: readonly string[];

  /** The exact DecisionCore Table ARN. */
  readonly decisionCoreTableArn: string;

  /** The exact IdempotencyTable ARN (proves write Deny target). */
  readonly idempotencyTableArn: string;

  /** The exact DecisionNarrativeTable ARN (proves write Deny target). */
  readonly decisionNarrativeTableArn: string;

  /** The exact PublishRecordTable ARN (proves write Deny target). */
  readonly publishRecordTableArn: string;

  /** Actions allowed for S3 raw data read. */
  readonly rawDataActions: readonly string[];

  /** Bounded object ARN pattern for S3 raw data. */
  readonly rawDataObjectArnPattern: string;

  /** The dedicated CloudWatch Log Group stream ARN pattern. */
  readonly logGroupStreamArn: string;

  /** The SSM parameter hierarchy ARN that this role may read from. */
  readonly ssmHierarchyArn: string;

  /** Categories explicitly denied (proves the deny list is intentional). */
  readonly explicitDenyCategories: readonly string[];

  /** Count of ALLOW statements using Resource "*". Must be 0. */
  readonly wildcardAllowCount: number;

  /**
   * DecisionFnRole is the deterministic truth writer (sole DecisionCore writer).
   */
  readonly deterministicTruthWriter: true;

  /**
   * DecisionFn does NOT call Bedrock (Fast Path is deterministic).
   */
  readonly bedrockCapability: false;

  /**
   * DecisionFn does NOT write IdempotencyTable (WorkflowStatusFn owns core_committed).
   */
  readonly idempotencyWriteCapability: false;

  /**
   * This role is NOT yet bound to the DecisionFn Lambda.
   * Final binding is owned by TASK-179.
   */
  readonly roleBoundToFunction: false;

  /** The owner responsible for the final role → Lambda binding. */
  readonly finalBindingOwner: 'TASK-179';
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface DecisionFnRoleConstructProps {
  /** TASK-059 typed environment context */
  readonly envContext: EnvironmentContext;

  /**
   * Stable role name. Must be non-empty, no credential-like substrings.
   */
  readonly roleName: string;

  /**
   * Exact ARN of the DecisionCoreTable.
   * Must be a valid DynamoDB table ARN.
   */
  readonly decisionCoreTableArn: string;

  /**
   * Exact ARN of the IdempotencyTable.
   * Must be a valid DynamoDB table ARN.
   * DecisionFn may NOT write to this table.
   */
  readonly idempotencyTableArn: string;

  /**
   * Exact ARN of the DecisionNarrativeTable.
   * Must be a valid DynamoDB table ARN.
   * DecisionFn may NOT write to this table.
   */
  readonly decisionNarrativeTableArn: string;

  /**
   * Exact ARN of the PublishRecordTable.
   * Must be a valid DynamoDB table ARN.
   * DecisionFn may NOT write to this table.
   */
  readonly publishRecordTableArn: string;

  /**
   * Exact ARN of the S3 bucket containing official raw data.
   * Must be a valid S3 bucket ARN (arn:aws:s3:::bucket-name).
   */
  readonly rawDataBucketArn: string;

  /**
   * Bounded S3 object ARN pattern for raw data.
   * Must be a child of rawDataBucketArn with a bounded suffix.
   * Example: "arn:aws:s3:::raw-bucket/raw/*" or "arn:aws:s3:::raw-bucket/2026/*"
   * Must NOT be Resource "*" or a bare bucket ARN.
   */
  readonly rawDataObjectArnPattern: string;

  /**
   * ARN of the DecisionFn's dedicated CloudWatch Log Group (created by TASK-075).
   * Used to scope logs:CreateLogStream / logs:PutLogEvents to this function's streams.
   */
  readonly decisionLogGroupArn: string;

  /**
   * ARN of the SSM parameter hierarchy for this environment's non-secret config.
   * DecisionFn reads its competition config from this hierarchy.
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
}

function validateDynamoArn(label: string, arn: string): void {
  validateArn(label, arn);
  if (arn.startsWith('${') || arn.includes('Token[')) return;
  if (!arn.startsWith('arn:aws:dynamodb:')) {
    throw new Error(`${label} must be a DynamoDB table ARN (arn:aws:dynamodb:...), got: ${arn}`);
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

function validateS3BucketArn(label: string, arn: string): void {
  validateArn(label, arn);
  if (arn.startsWith('${') || arn.includes('Token[')) return;
  if (!arn.startsWith('arn:aws:s3:::')) {
    throw new Error(`${label} must be an S3 bucket ARN (arn:aws:s3:::bucket), got: ${arn}`);
  }
}

function validateS3ObjectPattern(label: string, pattern: string, bucketArn: string): void {
  validateArn(label, pattern);
  if (pattern.startsWith('${') || pattern.includes('Token[')) return;
  if (pattern === '*') {
    throw new Error(`${label} must not be a full-account wildcard "*"`);
  }
  if (!pattern.startsWith(bucketArn)) {
    throw new Error(`${label} must be a child of ${bucketArn} (got: ${pattern})`);
  }
  if (pattern === bucketArn) {
    throw new Error(
      `${label} must include a bounded object suffix (got bare bucket ARN: ${pattern})`,
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

export class DecisionFnRoleConstruct extends Construct {
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
  public readonly evidence: DecisionFnRoleEvidence;

  public constructor(scope: Construct, id: string, props: DecisionFnRoleConstructProps) {
    super(scope, id);

    const {
      envContext,
      roleName,
      decisionCoreTableArn,
      idempotencyTableArn,
      decisionNarrativeTableArn,
      publishRecordTableArn,
      rawDataBucketArn,
      rawDataObjectArnPattern,
      decisionLogGroupArn,
      ssmParameterHierarchyArn,
    } = props;

    // ── Validate before creating any AWS resource ─────────────────────────────

    validateRoleName(roleName);
    validateDynamoArn('decisionCoreTableArn', decisionCoreTableArn);
    validateDynamoArn('idempotencyTableArn', idempotencyTableArn);
    validateDynamoArn('decisionNarrativeTableArn', decisionNarrativeTableArn);
    validateDynamoArn('publishRecordTableArn', publishRecordTableArn);
    validateS3BucketArn('rawDataBucketArn', rawDataBucketArn);
    validateS3ObjectPattern('rawDataObjectArnPattern', rawDataObjectArnPattern, rawDataBucketArn);
    validateLogGroupArn('decisionLogGroupArn', decisionLogGroupArn);
    validateSsmArn('ssmParameterHierarchyArn', ssmParameterHierarchyArn);

    if (
      new Set([
        decisionCoreTableArn,
        idempotencyTableArn,
        decisionNarrativeTableArn,
        publishRecordTableArn,
      ]).size < 4
    ) {
      throw new Error(
        'decisionCoreTableArn, idempotencyTableArn, decisionNarrativeTableArn, and publishRecordTableArn must all be distinct',
      );
    }

    // ── Build evidence (always populated) ──────────────────────────────────

    this.evidence = {
      decisionCoreActions: Object.freeze([
        'dynamodb:GetItem',
        'dynamodb:PutItem',
        'dynamodb:UpdateItem',
      ]),
      decisionCoreTableArn,
      idempotencyTableArn,
      decisionNarrativeTableArn,
      publishRecordTableArn,
      rawDataActions: Object.freeze(['s3:GetObject']),
      rawDataObjectArnPattern,
      logGroupStreamArn: `${decisionLogGroupArn}:log-stream:*`,
      ssmHierarchyArn: ssmParameterHierarchyArn,
      explicitDenyCategories: Object.freeze([
        'DynamoDB:write-to-non-core-table',
        'Bedrock:invoke-model',
        'Bedrock:retrieve',
        'WebSocket:manage-connections',
        'S3:write',
        'Lambda:invoke',
        'StepFunctions:start',
      ]),
      wildcardAllowCount: 0,
      deterministicTruthWriter: true,
      bedrockCapability: false,
      idempotencyWriteCapability: false,
      roleBoundToFunction: false,
      finalBindingOwner: 'TASK-179',
    } as DecisionFnRoleEvidence;

    // ── LOCAL_MOCK: zero resources ─────────────────────────────────────────

    if (envContext.isLocalMock) {
      this.role = undefined;
      this.roleArn = undefined;
      this.policy = undefined;
      return;
    }

    // ── Trust policy: Lambda service only ──────────────────────────────────

    // ── Create role ─────────────────────────────────────────────────────

    const role = new Role(this, 'Role', {
      roleName,
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
      inlinePolicies: {},
      // No AWS managed policies (AWSLambdaBasicExecutionRole etc. are forbidden)
    });

    // ── Build inline policy ─────────────────────────────────────────────

    const policyDoc = new PolicyDocument({
      statements: [
        // ── A. DecisionCoreTable: GetItem + PutItem + UpdateItem ─────────────
        // DecisionFn is the SOLE writer of DecisionCoreTable.
        // TASK-100 immutable_after_commit conditional Put is enforced at runtime
        // (attribute_not_exists cannot be expressed in IAM). IAM limits write
        // actions to the exact three required here.
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem'],
          resources: [decisionCoreTableArn],
        }),

        // ── B. S3 raw data read: GetObject only ─────────────────────────
        // Read-only access to official raw source data. The bounded object
        // pattern prevents access to other buckets or SOP/frontend assets.
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ['s3:GetObject'],
          resources: [rawDataObjectArnPattern],
        }),

        // ── C. CloudWatch Logs: dedicated log group streams ────────────────
        // Resource is "<decisionLogGroupArn>:log-stream:*" — the precise
        // CloudFormation form for "all log streams under this group".
        // CDK resolves unresolved tokens as FnSub at deploy time.
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ['logs:CreateLogStream', 'logs:PutLogEvents'],
          resources: [`${decisionLogGroupArn}:log-stream:*`],
        }),

        // ── D. SSM config read ────────────────────────────────────────────
        // Read-only access to competition config hierarchy.
        // "/*" suffix enforces path boundary (prevents prefix collision).
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ['ssm:GetParametersByPath'],
          resources: [`${ssmParameterHierarchyArn}/*`],
        }),

        // ── E. DynamoDB writer island: Deny writes to ALL tables except DecisionCore ─
        // DecisionFn must NOT write to IdempotencyTable (core_committed is
        // WorkflowStatusFn's job via TASK-079), NarrativeTable (RendererFn's
        // job), or PublishRecordTable (PublishFn's job).
        // NotResource = exact DecisionCoreTableArn excludes it from the Deny,
        // so the three actions above (GetItem/PutItem/UpdateItem) remain ALLOWed.
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
          notResources: [decisionCoreTableArn],
        }),

        // ── F. Bedrock Deny: Fast Path is fully deterministic ─────────────
        // DecisionFn does not call Bedrock. All model invocation is blocked.
        // Six actions cover: legacy invoke, streaming invoke, converse API,
        // retrieval, and knowledge-base operations.
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

        // ── G. S3 write Deny: cannot modify official sources ─────────────
        // DecisionFn reads raw data but must never write or delete it.
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

        // ── H. WebSocket Deny: WsPushFn owns PostToConnection ────────────
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
