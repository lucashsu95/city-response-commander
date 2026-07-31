/**
 * RendererFnRole — least-privilege execution role for the text-enrichment Lambda
 *
 * §18, §9.3, §10.11b, §15.1, TASK-078
 *
 * RendererFn is the text-only enrichment layer: it reads the deterministic decision
 * from DecisionCoreTable, invokes Bedrock for explanation/report/alert generation,
 * retrieves SOP evidence from Knowledge Base, and writes narrative records to
 * DecisionNarrativeTable. It does NOT modify DecisionCore, write IdempotencyTable,
 * publish records, or manage WebSocket connections.
 *
 * ─── What RendererFn OWNS ──────────────────────────────────────────────
 *
 *   - Reads DecisionCoreTable (GetItem only — deterministic truth owned by DecisionFn)
 *   - Invokes approved Bedrock model(s) for text generation
 *   - Retrieves SOP evidence from Knowledge Base
 *   - Writes DecisionNarrativeTable (PutItem only, conditional on TASK-116 runtime)
 *   - Reads S3 SOP objects (GetObject only)
 *   - Reads SSM config hierarchy
 *   - Reads specified Secrets Manager secrets (if configured)
 *   - Writes to its dedicated CloudWatch Log Group
 *
 * ─── What RendererFn MUST NOT do ─────────────────────────────────────
 *
 *   - Write to DecisionCoreTable (DecisionFn owns deterministic truth)
 *   - Write to IdempotencyTable
 *   - Write to PublishRecordTable
 *   - Write to ConnectionsTable or any other table
 *   - Update / Delete / BatchWrite / PartiQL any DynamoDB table
 *   - Call RetrieveAndGenerate (use Retrieve + InvokeModel only)
 *   - Invoke Lambda functions
 *   - Start Step Functions workflows
 *   - PostToConnection (WsPushFn owns WebSocket push)
 *   - Publish SNS / EventBridge / SQS
 *   - Read unlisted Secrets
 *   - PassRole
 *   - Publish CloudWatch custom metrics
 *   - X-Ray publishing (TASK-179 owns this)
 *
 * ─── Runtime conditional Put boundary (§10.11b, TASK-116) ─────────────
 *
 *   RendererFn may only PutItem to DecisionNarrativeTable. The IAM policy
 *   cannot enforce DynamoDB conditional expressions (attribute_not_exists).
 *   The runtime constraint that prevents overwriting existing narrative_type items
 *   (REPORT / PUBLIC_ALERT / EXPLANATION) is the sole responsibility of TASK-116.
 *
 *   IAM capability: PutItem-only on DecisionNarrativeTable
 *   Runtime conditional owner: TASK-116
 *   Branch-overwrite proof: TASK-120
 *
 * ─── Bedrock boundary (§9) ───────────────────────────────────────────
 *
 *   RendererFn may call approved Bedrock models for text generation.
 *   The exact allowed model ARN(s) must be injected as props.
 *   Competition global 1 RPS rate gate is NOT implemented by TASK-078.
 *
 *   Bedrock invocation permission: DEFINED
 *   Competition global rate gate: NOT IMPLEMENTED BY TASK-078
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
 *   role defined:                YES (here, TASK-078)
 *   role final-bound to Lambda:  NO  (TASK-179)
 *   final binding owner:          TASK-179
 *   runtime conditional Put owner: TASK-116
 *   narrative concurrency proof:   TASK-120
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
export interface RendererFnRoleEvidence {
  /** Actions allowed for DecisionCoreTable read. */
  readonly decisionCoreReadActions: readonly string[];

  /** The exact DecisionCore Table ARN. */
  readonly decisionCoreTableArn: string;

  /** The exact DecisionNarrativeTable ARN. */
  readonly decisionNarrativeTableArn: string;

  /** The exact IdempotencyTable ARN (proves write Deny target). */
  readonly idempotencyTableArn: string;

  /** The exact PublishRecordTable ARN (proves write Deny target). */
  readonly publishRecordTableArn: string;

  /** The exact Knowledge Base ARN. */
  readonly knowledgeBaseArn: string;

  /** The allowed Bedrock model/inference ARNs. */
  readonly modelInvocationResourceArns: readonly string[];

  /** Bounded S3 SOP object ARN pattern. */
  readonly sopObjectArnPattern: string;

  /** The dedicated CloudWatch Log Group stream ARN pattern. */
  readonly rendererLogStreamArn: string;

  /** The SSM parameter hierarchy ARN that this role may read from. */
  readonly ssmHierarchyArn: string;

  /** Secrets access mode. */
  readonly secretAccessMode: 'NONE' | 'EXACT';

  /** The exact secret ARNs (only populated when mode = EXACT). */
  readonly secretArns: readonly string[];

  /** Categories explicitly denied (proves the deny list is intentional). */
  readonly explicitDenyCategories: readonly string[];

  /** Count of ALLOW statements using Resource "*". Must be 0. */
  readonly wildcardAllowCount: number;

  /**
   * RendererFn does NOT write DecisionCoreTable.
   * Deterministic truth is owned by DecisionFnRole.
   */
  readonly deterministicTruthWriteCapability: false;

  /**
   * RendererFn may PutItem to DecisionNarrativeTable.
   * (Runtime conditional expression enforced by TASK-116.)
   */
  readonly narrativePutCapability: true;

  /**
   * RendererFn may NOT Update/Delete/BatchWrite/PartiQL NarrativeTable.
   */
  readonly narrativeMutationCapability: false;

  /**
   * RendererFn does NOT use RetrieveAndGenerate.
   * (Uses Retrieve + InvokeModel instead.)
   */
  readonly retrieveAndGenerateCapability: false;

  /**
   * This role is NOT yet bound to the RendererFn Lambda.
   * Final binding is owned by TASK-179.
   */
  readonly roleBoundToFunction: false;

  /** The owner responsible for the final role → Lambda binding. */
  readonly finalBindingOwner: 'TASK-179';

  /**
   * DynamoDB conditional expression owner for narrative PutItem.
   * attribute_not_exists(decision_id) is enforced at runtime, not by IAM.
   */
  readonly runtimeConditionalWriteOwner: 'TASK-116';
}

// ─── Props ────────────────────────────────────────────────────────────────────

/**
 * Discriminated union for Secrets Manager access.
 *
 *   mode: 'NONE'     — RendererFn reads no secrets
 *   mode: 'EXACT'   — RendererFn reads only the listed secret ARNs
 */
export type SecretAccessConfig =
  | { readonly mode: 'NONE' }
  | {
      readonly mode: 'EXACT';
      /** At least one secret ARN must be provided. */
      readonly secretArns: readonly string[];
    };

export interface RendererFnRoleConstructProps {
  /** TASK-059 typed environment context */
  readonly envContext: EnvironmentContext;

  /**
   * Stable role name. Must be non-empty, no credential-like substrings.
   */
  readonly roleName: string;

  /**
   * Exact ARN of the DecisionCoreTable.
   * Must be a valid DynamoDB table ARN.
   * RendererFn may only GetItem this table.
   */
  readonly decisionCoreTableArn: string;

  /**
   * Exact ARN of the DecisionNarrativeTable.
   * Must be a valid DynamoDB table ARN.
   * RendererFn may only PutItem this table (conditional on TASK-116 runtime).
   */
  readonly decisionNarrativeTableArn: string;

  /**
   * Exact ARN of the IdempotencyTable.
   * Must be a valid DynamoDB table ARN.
   * RendererFn may NOT write this table.
   */
  readonly idempotencyTableArn: string;

  /**
   * Exact ARN of the PublishRecordTable.
   * Must be a valid DynamoDB table ARN.
   * RendererFn may NOT write this table.
   */
  readonly publishRecordTableArn: string;

  /**
   * Exact ARN of the S3 SOP bucket.
   * Must be a valid S3 bucket ARN (arn:aws:s3:::bucket-name).
   */
  readonly sopBucketArn: string;

  /**
   * Bounded S3 object ARN pattern for SOP documents.
   * Must be a child of sopBucketArn with a bounded suffix.
   * Example: "arn:aws:s3:::sop-bucket/sop/*" or "arn:aws:s3:::sop-bucket/2026/*"
   */
  readonly sopObjectArnPattern: string;

  /**
   * Exact ARN of the Bedrock Knowledge Base.
   * Must be a valid knowledge-base ARN.
   */
  readonly knowledgeBaseArn: string;

  /**
   * Allowed Bedrock model/inference/inference-profile ARNs.
   * Each ARN must be a literal, non-wildcard, service=bedrock resource.
   * RendererFn may invoke InvokeModel / InvokeModelWithResponseStream
   * on exactly these resources.
   *
   * Supported resource types:
   *   - foundation-model
   *   - inference-profile
   *   - application-inference-profile
   *   - provisioned-model
   *   - imported-model
   *   - custom-model-deployment
   *
   * Must be non-empty, unique, and contain no wildcards.
   */
  readonly modelInvocationResourceArns: readonly string[];

  /**
   * ARN of the RendererFn's dedicated CloudWatch Log Group (created by TASK-075).
   * Used to scope logs:CreateLogStream / logs:PutLogEvents to this function's streams.
   */
  readonly rendererLogGroupArn: string;

  /**
   * ARN of the SSM parameter hierarchy for this environment's non-secret config.
   * RendererFn reads its competition config from this hierarchy.
   */
  readonly ssmParameterHierarchyArn: string;

  /**
   * Secrets Manager access configuration.
   *
   *   mode: 'NONE'     — no Secrets Manager access
   *   mode: 'EXACT'   — GetSecretValue on exactly the listed secret ARNs
   *
   * No wildcard secrets, no Resource "*", no auto-default.
   */
  readonly secretAccess: SecretAccessConfig;
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

function validateKnowledgeBaseArn(label: string, arn: string): void {
  validateArn(label, arn);
  if (arn.startsWith('${') || arn.includes('Token[')) return;
  if (!arn.startsWith('arn:aws:bedrock:')) {
    throw new Error(
      `${label} must be a Bedrock Knowledge Base ARN (arn:aws:bedrock:...), got: ${arn}`,
    );
  }
}

function validateModelArns(arns: readonly string[]): void {
  if (!arns || arns.length === 0) {
    throw new Error('modelInvocationResourceArns must be non-empty');
  }
  const seen = new Set<string>();
  for (const arn of arns) {
    if (!arn || arn.trim() === '') {
      throw new Error('modelInvocationResourceArns contains a blank ARN');
    }
    if (seen.has(arn)) {
      throw new Error(`modelInvocationResourceArns contains duplicate: ${arn}`);
    }
    seen.add(arn);
    if (arn === '*') {
      throw new Error('modelInvocationResourceArns must not contain wildcard "*"');
    }
    if (arn.startsWith('${') || arn.includes('Token[')) continue;
    if (!arn.startsWith('arn:aws:bedrock:')) {
      throw new Error(
        `modelInvocationResourceArns entry must be a Bedrock ARN (arn:aws:bedrock:...), got: ${arn}`,
      );
    }
  }
}

function validateSecretArns(arns: readonly string[]): void {
  const seen = new Set<string>();
  for (const arn of arns) {
    if (!arn || arn.trim() === '') {
      throw new Error('secretArns contains a blank ARN');
    }
    if (seen.has(arn)) {
      throw new Error(`secretArns contains duplicate: ${arn}`);
    }
    seen.add(arn);
    if (arn === '*') {
      throw new Error('secretArns must not contain wildcard "*"');
    }
    if (arn.startsWith('${') || arn.includes('Token[')) continue;
    if (!arn.startsWith('arn:aws:secretsmanager:')) {
      throw new Error(
        `secretArns entry must be a Secrets Manager ARN (arn:aws:secretsmanager:...), got: ${arn}`,
      );
    }
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

export class RendererFnRoleConstruct extends Construct {
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
  public readonly evidence: RendererFnRoleEvidence;

  public constructor(scope: Construct, id: string, props: RendererFnRoleConstructProps) {
    super(scope, id);

    const {
      envContext,
      roleName,
      decisionCoreTableArn,
      decisionNarrativeTableArn,
      idempotencyTableArn,
      publishRecordTableArn,
      sopBucketArn,
      sopObjectArnPattern,
      knowledgeBaseArn,
      modelInvocationResourceArns,
      rendererLogGroupArn,
      ssmParameterHierarchyArn,
      secretAccess,
    } = props;

    // ── Validate before creating any AWS resource ─────────────────────────────

    validateRoleName(roleName);
    validateDynamoArn('decisionCoreTableArn', decisionCoreTableArn);
    validateDynamoArn('decisionNarrativeTableArn', decisionNarrativeTableArn);
    validateDynamoArn('idempotencyTableArn', idempotencyTableArn);
    validateDynamoArn('publishRecordTableArn', publishRecordTableArn);
    validateS3BucketArn('sopBucketArn', sopBucketArn);
    validateS3ObjectPattern('sopObjectArnPattern', sopObjectArnPattern, sopBucketArn);
    validateKnowledgeBaseArn('knowledgeBaseArn', knowledgeBaseArn);
    validateModelArns(modelInvocationResourceArns);
    validateLogGroupArn('rendererLogGroupArn', rendererLogGroupArn);
    validateSsmArn('ssmParameterHierarchyArn', ssmParameterHierarchyArn);

    if (
      new Set([
        decisionCoreTableArn,
        decisionNarrativeTableArn,
        idempotencyTableArn,
        publishRecordTableArn,
      ]).size < 4
    ) {
      throw new Error(
        'decisionCoreTableArn, decisionNarrativeTableArn, idempotencyTableArn, and publishRecordTableArn must all be distinct',
      );
    }

    if (secretAccess.mode === 'EXACT' && secretAccess.secretArns.length === 0) {
      throw new Error('secretAccess.mode = EXACT requires at least one secret ARN');
    }

    if (secretAccess.mode === 'EXACT') {
      validateSecretArns(secretAccess.secretArns);
    }

    // ── Build evidence (always populated) ──────────────────────────────────

    this.evidence = {
      decisionCoreReadActions: Object.freeze(['dynamodb:GetItem']),
      decisionCoreTableArn,
      decisionNarrativeTableArn,
      idempotencyTableArn,
      publishRecordTableArn,
      knowledgeBaseArn,
      modelInvocationResourceArns: Object.freeze([...modelInvocationResourceArns]),
      sopObjectArnPattern,
      rendererLogStreamArn: `${rendererLogGroupArn}:log-stream:*`,
      ssmHierarchyArn: ssmParameterHierarchyArn,
      secretAccessMode: secretAccess.mode,
      secretArns:
        secretAccess.mode === 'EXACT'
          ? Object.freeze([...secretAccess.secretArns])
          : Object.freeze([]),
      explicitDenyCategories: Object.freeze([
        'DynamoDB:write-DecisionCore',
        'DynamoDB:write-Idempotency',
        'DynamoDB:write-PublishRecord',
        'DynamoDB:write-Narrative-mutation',
        'Bedrock:unlisted-model',
        'Bedrock:RetrieveAndGenerate',
        'WebSocket:manage-connections',
        'S3:write',
        'Lambda:invoke',
        'StepFunctions:start',
      ]),
      wildcardAllowCount: 0,
      deterministicTruthWriteCapability: false,
      narrativePutCapability: true,
      narrativeMutationCapability: false,
      retrieveAndGenerateCapability: false,
      roleBoundToFunction: false,
      finalBindingOwner: 'TASK-179',
      runtimeConditionalWriteOwner: 'TASK-116',
    } as RendererFnRoleEvidence;

    // ── LOCAL_MOCK: zero resources ─────────────────────────────────────────

    if (envContext.isLocalMock) {
      this.role = undefined;
      this.roleArn = undefined;
      this.policy = undefined;
      return;
    }

    // ── Build inline policy ─────────────────────────────────────────────

    const statements: PolicyStatement[] = [
      // ── A. DecisionCoreTable: GetItem only (read-only) ─────────────────
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['dynamodb:GetItem'],
        resources: [decisionCoreTableArn],
      }),

      // ── B. DecisionNarrativeTable: PutItem only (conditional runtime) ──
      // RendererFn may ONLY PutItem to DecisionNarrativeTable.
      // The runtime constraint (attribute_not_exists on decision_id) is
      // enforced by TASK-116 at execution time. IAM cannot express this.
      // RendererFn may NOT Update/Delete/BatchWrite/PartiQL Narrative.
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['dynamodb:PutItem'],
        resources: [decisionNarrativeTableArn],
      }),

      // ── C. S3 SOP read: GetObject only ────────────────────────────────
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['s3:GetObject'],
        resources: [sopObjectArnPattern],
      }),

      // ── D. CloudWatch Logs: dedicated log group streams ────────────────
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['logs:CreateLogStream', 'logs:PutLogEvents'],
        resources: [`${rendererLogGroupArn}:log-stream:*`],
      }),

      // ── E. SSM config read ────────────────────────────────────────────
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['ssm:GetParametersByPath'],
        resources: [`${ssmParameterHierarchyArn}/*`],
      }),

      // ── F. DecisionCoreTable write Deny: exact Resource ───────────────
      // RendererFn must NEVER modify the deterministic decision.
      // Explicit Deny with Resource (not NotResource) blocks this table.
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

      // ── G. DynamoDB writer island: Deny writes to ALL tables except Narrative ─
      // DecisionFn must NOT write to IdempotencyTable, PublishRecordTable, etc.
      // NotResource = exact NarrativeTableArn excludes it from the Deny.
      // This allows the Narrative PutItem above and blocks everything else.
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
        notResources: [decisionNarrativeTableArn],
      }),

      // ── H. Bedrock model invocation: allow only approved ARNs ────────
      // IAM actions (NOT Converse/ConverseStream — those are API names,
      // the IAM actions are InvokeModel and InvokeModelWithResponseStream).
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
        resources: [...modelInvocationResourceArns],
      }),

      // ── I. Bedrock model Deny: NotResource blocks all other models ────
      // Only the injected model ARNs are excluded from this Deny.
      new PolicyStatement({
        effect: Effect.DENY,
        actions: ['bedrock:InvokeModel', 'bedrock:InvokeModelWithResponseStream'],
        notResources: [...modelInvocationResourceArns],
      }),

      // ── J. Knowledge Base Retrieve: exact KB ARN ───────────────────────
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['bedrock:Retrieve'],
        resources: [knowledgeBaseArn],
      }),

      // ── K. Knowledge Base Retrieve Deny: NotResource blocks other KBs ──
      new PolicyStatement({
        effect: Effect.DENY,
        actions: ['bedrock:Retrieve'],
        notResources: [knowledgeBaseArn],
      }),

      // ── L. Bedrock RetrieveAndGenerate Deny ───────────────────────────
      // RendererFn must NOT use RetrieveAndGenerate (it merges retrieval with
      // generation, bypassing SchemaValidator and evidence tracing).
      // Architecture: Retrieve → InvokeModel → validate → output.
      new PolicyStatement({
        effect: Effect.DENY,
        actions: ['bedrock:RetrieveAndGenerate'],
        resources: ['*'],
      }),

      // ── M. S3 write Deny: RendererFn reads SOP but never modifies it ──
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

      // ── N. WebSocket Deny ─────────────────────────────────────────────
      new PolicyStatement({
        effect: Effect.DENY,
        actions: ['execute-api:ManageConnections'],
        resources: ['*'],
      }),
    ];

    // ── O. Secrets Manager (conditional on config mode) ────────────────
    if (secretAccess.mode === 'EXACT') {
      statements.push(
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ['secretsmanager:GetSecretValue'],
          resources: [...secretAccess.secretArns],
        }),
      );
    }

    // ── Create role ─────────────────────────────────────────────────────

    const role = new Role(this, 'Role', {
      roleName,
      assumedBy: new ServicePrincipal('lambda.amazonaws.com'),
      inlinePolicies: {},
      // No AWS managed policies (forbidden)
    });

    const policyDoc = new PolicyDocument({ statements });
    const policy = new Policy(this, 'Policy', { document: policyDoc });

    role.attachInlinePolicy(policy);

    this.role = role;
    this.roleArn = role.roleArn;
    this.policy = policy;
  }
}
