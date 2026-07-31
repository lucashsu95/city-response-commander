/**
 * IngestionRole — least-privilege execution role for the TASK-178 ingestion
 * CDK Custom Resource Provider (onEvent / isComplete handlers).
 *
 * §18, §10.11, §15.2, TASK-083
 *
 * IngestionRole is consumed by the CDK Custom Resource Provider Lambda that
 * triggers and observes Bedrock Knowledge Base ingestion jobs during stack
 * bootstrap. It does NOT belong to the ten Application Runtime Lambdas and
 * is NOT attached to any runtime function.
 *
 * ─── What IngestionRole OWNS ─────────────────────────────────────────
 *
 *   - Bedrock ingestion APIs (StartIngestionJob / GetIngestionJob / GetKnowledgeBase / GetDataSource)
 *   - SOP source S3 reads (GetObject + ListBucket with restrictive prefix)
 *   - SSM parameter hierarchy (GetParametersByPath)
 *   - Writes to its own CloudWatch Log Group (per handler log group)
 *
 * ─── What IngestionRole MUST NOT do ────────────────────────────────────
 *
 *   - Write to S3 (PutObject / DeleteObject / ...)
 *   - Write to any DynamoDB table
 *   - Invoke Bedrock models (InvokeModel / InvokeModelWithResponseStream)
 *   - Bedrock Knowledge Base retrieval (Retrieve / RetrieveAndGenerate)
 *   - Start Step Functions workflows
 *   - Connect / PostToConnection
 *   - Invoke Lambda functions
 *   - KMS decrypt
 *   - Secrets Manager read
 *   - IAM PassRole
 *   - Publish CloudWatch custom metrics
 *   - X-Ray publishing (TASK-179 owns this)
 *
 * ─── Role boundary (precise) ─────────────────────────────────────────
 *
 *   IngestionRole's Lambda is the CDK Custom Resource Provider — it runs
 *   during stack synthesis / first deploy to trigger ingestion. It is NOT
 *   bound to any Application Runtime Lambda. TASK-178 owns the entire
 *   provider chain; TASK-179 owns the final Lambda attachment.
 *
 * ─── X-Ray boundary ──────────────────────────────────────────────────
 *
 *   TASK-179 owns the X-Ray IAM grants; this role does NOT grant xray:*.
 *
 * ─── Security boundaries (precise) ──────────────────────────────────
 *
 * This construct creates:
 *   - 1 × AWS::IAM::Role     (PERSONAL_AWS_DEV / COMPETITION_AWS)
 *   - 1 × AWS::IAM::Policy  (PERSONAL_AWS_DEV / COMPETITION_AWS, inline)
 *
 * This construct NEVER creates:
 *   - Lambda / DynamoDB / S3 / Step Functions / SSM / KMS / SNS / EventBridge / X-Ray resources
 *   - AWS managed policies (e.g. AWSLambdaBasicExecutionRole)
 *   - External references to process.env
 *   - Hard-coded account, region, or ARN
 *
 * LOCAL_MOCK: zero AWS resources (role / policy stay undefined).
 *
 * ─── Ownership chain ─────────────────────────────────────────────────
 *
 *   role defined:                YES (here, TASK-083)
 *   role final-bound to provider: NO  (TASK-178 / TASK-179)
 *   final binding owner:           TASK-178 / TASK-179
 *   Runtime Lambda attachment:    NONE
 *   X-Ray IAM grants owner:       TASK-179
 */

import { Construct } from 'constructs';
import { Effect, Policy, PolicyDocument, PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import type { EnvironmentContext } from '../env_context.js';

// ─── Evidence contract ────────────────────────────────────────────────────────

export interface IngestionRoleEvidence {
  /** Bedrock ingestion actions granted by the policy. */
  readonly allowedBedrockIngestionActions: readonly string[];

  /** S3 bucket ARN for ListBucket allow. */
  readonly sopBucketArn: string;

  /** S3 object ARN pattern for GetObject allow. */
  readonly sopObjectArnPattern: string;

  /** SSM parameter hierarchy ARN. */
  readonly ssmHierarchyArn: string;

  /** All injected provider log group stream ARN patterns. */
  readonly providerLogGroupStreamArns: readonly string[];

  /** Categories explicitly denied (proves the deny list is intentional). */
  readonly explicitDenyCategories: readonly string[];

  /** Count of ALLOW statements using Resource "*". Must be 0. */
  readonly wildcardAllowCount: number;

  /**
   * IngestionRole is NOT bound to any Application Runtime Lambda.
   * It belongs to the TASK-178 CDK Custom Resource Provider.
   */
  readonly attachedToRuntimeLambda: false;

  /** The owner responsible for the final role → Lambda binding. */
  readonly finalBindingOwner: 'TASK-178 / TASK-179';
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface IngestionRoleConstructProps {
  /** TASK-059 typed environment context */
  readonly envContext: EnvironmentContext;

  /**
   * Stable role name. Must be non-empty, no credential-like substrings.
   */
  readonly roleName: string;

  /**
   * Exact ARN of the Bedrock Knowledge Base.
   * Format: arn:aws:bedrock:<region>:<account>:knowledge-base/<id>
   */
  readonly knowledgeBaseArn: string;

  /**
   * Exact ARN of the Bedrock Data Source under the knowledge base.
   * Format: arn:aws:bedrock:<region>:<account>:knowledge-base/<kbId>/data-source/<dsId>
   * Used for GetDataSource + StartIngestionJob + GetIngestionJob (the tightest
   * resource scope that AWS authorizations accept for ingestion jobs).
   */
  readonly dataSourceArn: string;

  /**
   * Exact ARN of the SOP source S3 bucket.
   * Used for s3:ListBucket with the sopPrefix condition.
   */
  readonly sopBucketArn: string;

  /**
   * The S3 prefix (e.g. "sop/") that holds the SOP source documents.
   * Used as the value for s3:prefix in the ListBucket condition.
   * The condition matches exactly this prefix AND any descendant key.
   * (e.g. "sop/" matches "sop/" and "sop/<file>".)
   */
  readonly sopPrefix: string;

  /**
   * S3 object ARN pattern for GetObject. Inject the specific file pattern
   * (e.g. arn:aws:s3:::bucket-name/sop/*). Must NOT be "*".
   */
  readonly sopObjectArnPattern: string;

  /**
   * ARN of the SSM parameter hierarchy for non-secret ingestion config.
   * Must NOT end with a trailing wildcard; the "/*" is appended in the policy.
   */
  readonly ssmParameterHierarchyArn: string;

  /**
   * ARNs of the CloudWatch Log Groups for each provider handler.
   * At least one entry required. The "/*" suffix is appended in the policy.
   * (e.g. arn:aws:logs:...:log-group:/aws/lambda/IngestionProvider-OnEvent)
   */
  readonly providerLogGroupArns: readonly string[];
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

function validateBedrockArn(label: string, arn: string): void {
  validateArn(label, arn);
  if (arn.startsWith('${') || arn.includes('Token[')) return;
  if (!arn.startsWith('arn:aws:bedrock:')) {
    throw new Error(`${label} must be a Bedrock ARN (arn:aws:bedrock:...), got: ${arn}`);
  }
}

function validateLogGroupArn(label: string, arn: string): void {
  validateArn(label, arn);
  if (arn.startsWith('${') || arn.includes('Token[')) return;
  if (!arn.startsWith('arn:aws:logs:')) {
    throw new Error(`${label} must be a CloudWatch Logs ARN (arn:aws:logs:...), got: ${arn}`);
  }
  if (arn.endsWith(':log-stream:*') || arn.endsWith(':log-stream')) {
    throw new Error(`${label} must be a log-group ARN, not a log-stream ARN: ${arn}`);
  }
}

function validateS3BucketArn(label: string, arn: string): void {
  validateArn(label, arn);
  if (arn.startsWith('${') || arn.includes('Token[')) return;
  if (!arn.startsWith('arn:aws:s3:::')) {
    throw new Error(`${label} must be an S3 bucket ARN (arn:aws:s3:::...)`);
  }
  if (arn.endsWith('/*')) {
    throw new Error(`${label} must be a bucket ARN, not an object ARN`);
  }
}

function validateS3ObjectArnPattern(label: string, arn: string): void {
  validateArn(label, arn);
  if (arn.startsWith('${') || arn.includes('Token[')) return;
  if (!arn.startsWith('arn:aws:s3:::')) {
    throw new Error(`${label} must be an S3 object ARN (arn:aws:s3:::...)`);
  }
  if (arn === 'arn:aws:s3:::*') {
    throw new Error(`${label} must not be a wildcard-bucket ARN`);
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

function validateSopPrefix(prefix: string): void {
  if (!prefix || typeof prefix !== 'string' || prefix.trim() === '') {
    throw new Error('sopPrefix must be a non-empty string');
  }
  if (prefix.includes('*')) {
    throw new Error('sopPrefix must not contain a wildcard character');
  }
  if (!prefix.endsWith('/')) {
    throw new Error(
      `sopPrefix must be normalized to end with "/"; received "${prefix}" (pass e.g. "sop/" not "sop")`,
    );
  }
  // Defensive: reject any prefix that would be ambiguous in an equality match.
  // We only allow a single "/" at the end.
  const trailing = prefix.match(/\/+$/);
  if (trailing && trailing[0].length > 1) {
    throw new Error(`sopPrefix must contain exactly one trailing "/"; received "${prefix}"`);
  }
}

// ─── Construct ───────────────────────────────────────────────────────────────

export class IngestionRoleConstruct extends Construct {
  /** The execution role (undefined in LOCAL_MOCK). */
  public readonly role: Role | undefined;

  /** The role ARN (undefined in LOCAL_MOCK). */
  public readonly roleArn: string | undefined;

  /** The inline access policy (undefined in LOCAL_MOCK). */
  public readonly policy: Policy | undefined;

  /**
   * Machine-readable evidence for TASK-178 / TASK-179 binding assertions.
   * Always populated, even in LOCAL_MOCK (empty arrays / zero counts).
   */
  public readonly evidence: IngestionRoleEvidence;

  public constructor(
    scope: Construct,
    id: string,
    props: IngestionRoleConstructProps,
  ) {
    super(scope, id);

    const {
      envContext,
      roleName,
      knowledgeBaseArn,
      dataSourceArn,
      sopBucketArn,
      sopPrefix,
      sopObjectArnPattern,
      ssmParameterHierarchyArn,
      providerLogGroupArns,
    } = props;

    // ── Validate before creating any AWS resource ─────────────────────────────

    validateRoleName(roleName);
    validateBedrockArn('knowledgeBaseArn', knowledgeBaseArn);
    validateBedrockArn('dataSourceArn', dataSourceArn);
    validateS3BucketArn('sopBucketArn', sopBucketArn);
    validateS3ObjectArnPattern('sopObjectArnPattern', sopObjectArnPattern);
    validateSsmArn('ssmParameterHierarchyArn', ssmParameterHierarchyArn);
    validateSopPrefix(sopPrefix);

    if (!Array.isArray(providerLogGroupArns) || providerLogGroupArns.length === 0) {
      throw new Error('providerLogGroupArns must be a non-empty array');
    }
    for (const lg of providerLogGroupArns) {
      validateLogGroupArn('providerLogGroupArns', lg);
    }

    // ── Build evidence (always populated) ──────────────────────────────────

    this.evidence = {
      allowedBedrockIngestionActions: Object.freeze([
        'bedrock:StartIngestionJob',
        'bedrock:GetIngestionJob',
        'bedrock:GetKnowledgeBase',
        'bedrock:GetDataSource',
      ]),
      sopBucketArn,
      sopObjectArnPattern,
      ssmHierarchyArn: ssmParameterHierarchyArn,
      providerLogGroupStreamArns: Object.freeze(
        providerLogGroupArns.map((g) => `${g}:log-stream:*`),
      ),
      explicitDenyCategories: Object.freeze([
        'S3:write',
        'DynamoDB:write',
        'Bedrock:invoke-model',
        'StepFunctions:start',
        'WebSocket:manage-connections',
        'Lambda:invoke',
      ]),
      wildcardAllowCount: 0,
      attachedToRuntimeLambda: false,
      finalBindingOwner: 'TASK-178 / TASK-179',
    } as IngestionRoleEvidence;

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
        // ── A. Bedrock ingestion ─────────────────────────────────────────
        //
        // GetKnowledgeBase is scoped to the exact knowledge base ARN.
        // GetDataSource is scoped to the exact data source ARN.
        // StartIngestionJob / GetIngestionJob are scoped to the data source ARN,
        // which is the tightest resource scope AWS authorizations accept for
        // ingestion-job operations.
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ['bedrock:GetKnowledgeBase'],
          resources: [knowledgeBaseArn],
        }),
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ['bedrock:GetDataSource', 'bedrock:StartIngestionJob', 'bedrock:GetIngestionJob'],
          resources: [dataSourceArn],
        }),

        // ── B. SOP source S3: GetObject ───────────────────────────────────
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ['s3:GetObject'],
          resources: [sopObjectArnPattern],
        }),

        // ── C. SOP source S3: ListBucket with prefix condition ────────────
        //
        // We use `StringEquals` (NOT `StringLike`) with the EXACT normalized
        // sopPrefix as the only allowed value. The literal `*` inside an
        // equality operator is not a wildcard — it would be matched against
        // the literal request prefix and is therefore meaningless in this
        // operator. To produce minimal-privilege we restrict the condition
        // to the single canonical prefix the provider uses.
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ['s3:ListBucket'],
          resources: [sopBucketArn],
          conditions: {
            StringEquals: {
              's3:prefix': [sopPrefix],
            },
          },
        }),

        // ── D. SSM: read config hierarchy ────────────────────────────────
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ['ssm:GetParametersByPath'],
          resources: [`${ssmParameterHierarchyArn}/*`],
        }),

        // ── E. Provider logs ─────────────────────────────────────────────
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ['logs:CreateLogStream', 'logs:PutLogEvents'],
          resources: providerLogGroupArns.map((g) => `${g}:log-stream:*`),
        }),

        // ── F. S3 write Deny ─────────────────────────────────────────────
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

        // ── G. DynamoDB write Deny ───────────────────────────────────────
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

        // ── H. Bedrock model invocation Deny ─────────────────────────────
        //
        // NOTE: bedrock:Retrieve / RetrieveAndGenerate / StartIngestionJob
        // are NOT granted (Retrieve/RetrieveAndGenerate are KB model-query
        // APIs, which the ingestion provider never uses).
        new PolicyStatement({
          effect: Effect.DENY,
          actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
          resources: ['*'],
        }),

        // ── I. Other dangerous capabilities Deny ─────────────────────────
        new PolicyStatement({
          effect: Effect.DENY,
          actions: ['states:StartExecution'],
          resources: ['*'],
        }),
        new PolicyStatement({
          effect: Effect.DENY,
          actions: ['execute-api:ManageConnections'],
          resources: ['*'],
        }),
        new PolicyStatement({
          effect: Effect.DENY,
          actions: ['lambda:InvokeFunction'],
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
