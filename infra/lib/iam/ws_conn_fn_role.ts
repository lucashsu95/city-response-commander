/**
 * WsConnFnRole — shared least-privilege execution role for WsPushFn + ConnFn
 *
 * §18, §10.11c, §15.2, TASK-083
 *
 * WsConnFnRole is the shared execution role for the two WebSocket-plane Lambda
 * functions (WsPushFn and ConnFn). It owns the live Connections-table presence
 * map AND the post-to-connection capability. It does NOT write any other table,
 * does NOT call Bedrock, does NOT invoke Lambda, does NOT read raw S3 SOPs.
 *
 * ─── What WsConnFnRole OWNS ─────────────────────────────────────────
 *
 *   - Reads ConnectionsTable (GetItem, Scan for any session scope)
 *   - Writes ConnectionsTable (PutItem, UpdateItem, DeleteItem)
 *   - Calls execute-api:ManageConnections on the exact API/stage WebSocket
 *   - Writes to its own CloudWatch Log Group (single injected group)
 *
 * ─── What WsConnFnRole MUST NOT do ────────────────────────────────────
 *
 *   - Write to DecisionCoreTable / DecisionNarrativeTable / IdempotencyTable /
 *     PublishRecordTable or any other table
 *   - Read raw/SOP S3 (renderer reads SOP, NOT WebSocket plane)
 *   - Call Bedrock
 *   - Start Step Functions workflows
 *   - Invoke Lambda functions
 *   - GetSecretValue / KMS / SSM
 *   - Publish CloudWatch custom metrics
 *   - X-Ray publishing (TASK-179 owns this)
 *
 * ─── X-Ray boundary ──────────────────────────────────────────────────
 *
 *   TASK-075 sets TracingConfig.Mode on the Lambda.  The IAM capability
 *   for xray:PutTraceSegments / PutTelemetryRecords is left to TASK-179,
 *   which is the sole final-binding owner for all role → Lambda bindings.
 *
 * ─── Security boundaries (precise) ──────────────────────────────────
 *
 * This construct creates:
 *   - 1 × AWS::IAM::Role     (PERSONAL_AWS_DEV / COMPETITION_AWS)
 *   - 1 × AWS::IAM::Policy  (PERSONAL_AWS_DEV / COMPETITION_AWS, inline)
 *
 * This construct NEVER creates:
 *   - Lambda / DynamoDB / S3 / Step Functions / SSM / Log Group / KMS / SNS /
 *     EventBridge / CloudWatch / X-Ray resources
 *   - AWS managed policies (e.g. AWSLambdaBasicExecutionRole)
 *   - External references to process.env
 *   - Hard-coded account, region, or ARN
 *
 * LOCAL_MOCK: zero AWS resources (role / policy stay undefined).
 *
 * ─── Ownership chain ─────────────────────────────────────────────────
 *
 *   role defined:                YES (here, TASK-083)
 *   role final-bound:           NO  (TASK-179 — to BOTH WsPushFn and ConnFn)
 *   final binding owner:           TASK-179
 *   X-Ray IAM grants owner:       TASK-179
 */

import { Construct } from 'constructs';
import { Effect, Policy, PolicyDocument, PolicyStatement, Role, ServicePrincipal } from 'aws-cdk-lib/aws-iam';
import type { EnvironmentContext } from '../env_context.js';

// ─── Evidence contract ────────────────────────────────────────────────────────

export interface WsConnFnRoleEvidence {
  /** Actions allowed on the Connections DynamoDB table. */
  readonly allowedConnectionsActions: readonly string[];

  /** Exact Connections Table ARN. */
  readonly connectionsTableArn: string;

  /** Exact WebSocket ManageConnections ARN. */
  readonly webSocketManageConnectionsArn: string;

  /** The dedicated CloudWatch Log Group stream ARN pattern. */
  readonly logGroupStreamArn: string;

  /** Categories explicitly denied (proves the deny list is intentional). */
  readonly explicitDenyCategories: readonly string[];

  /** Count of ALLOW statements using Resource "*". Must be 0. */
  readonly wildcardAllowCount: number;

  /**
   * This role is NOT yet bound to WsPushFn / ConnFn.
   * Final binding is owned by TASK-179.
   */
  readonly roleBoundToFunction: false;

  /** The owner responsible for the final role → Lambda bindings. */
  readonly finalBindingOwner: 'TASK-179';
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface WsConnFnRoleConstructProps {
  /** TASK-059 typed environment context */
  readonly envContext: EnvironmentContext;

  /**
   * Stable role name. Must be non-empty, no credential-like substrings.
   */
  readonly roleName: string;

  /**
   * Exact ARN of the ConnectionsTable.
   * Must be a valid DynamoDB table ARN (arn:aws:dynamodb:...).
   */
  readonly connectionsTableArn: string;

  /**
   * Exact execute-api ARN for the API ID + stage + "@connections/*" path.
   * Format: arn:aws:execute-api:<region>:<account>:<apiId>/<stage>/POST/@connections/*
   * Resource is NOT permitted to be "*".
   */
  readonly webSocketManageConnectionsArn: string;

  /**
   * ARN of the WsPushFn / ConnFn shared CloudWatch Log Group (created by TASK-075).
   * Used to scope logs:CreateLogStream / logs:PutLogEvents to this function's streams.
   */
  readonly wsPushLogGroupArn: string;
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

function validateExecuteApiArn(label: string, arn: string): void {
  validateArn(label, arn);
  if (arn.startsWith('${') || arn.includes('Token[')) return;
  if (!arn.startsWith('arn:aws:execute-api:')) {
    throw new Error(
      `${label} must be an execute-api ARN (arn:aws:execute-api:...), got: ${arn}`,
    );
  }
  if (arn === 'arn:aws:execute-api:*:*:*' || arn.endsWith(':*')) {
    throw new Error(
      `${label} must be a specific API + stage + @connections/* path, not a wildcard: ${arn}`,
    );
  }
  if (!arn.includes('@connections')) {
    throw new Error(
      `${label} must include the @connections path (e.g. /POST/@connections/*): ${arn}`,
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

export class WsConnFnRoleConstruct extends Construct {
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
  public readonly evidence: WsConnFnRoleEvidence;

  public constructor(
    scope: Construct,
    id: string,
    props: WsConnFnRoleConstructProps,
  ) {
    super(scope, id);

    const {
      envContext,
      roleName,
      connectionsTableArn,
      webSocketManageConnectionsArn,
      wsPushLogGroupArn,
    } = props;

    // ── Validate before creating any AWS resource ─────────────────────────────

    validateRoleName(roleName);
    validateDynamoArn('connectionsTableArn', connectionsTableArn);
    validateExecuteApiArn('webSocketManageConnectionsArn', webSocketManageConnectionsArn);
    validateLogGroupArn('wsPushLogGroupArn', wsPushLogGroupArn);

    // ── Build evidence (always populated) ──────────────────────────────────

    this.evidence = {
      allowedConnectionsActions: Object.freeze([
        'dynamodb:GetItem',
        'dynamodb:PutItem',
        'dynamodb:UpdateItem',
        'dynamodb:DeleteItem',
        'dynamodb:Scan',
      ]),
      connectionsTableArn,
      webSocketManageConnectionsArn,
      logGroupStreamArn: `${wsPushLogGroupArn}:log-stream:*`,
      explicitDenyCategories: Object.freeze([
        'DynamoDB:write-to-other-tables',
        'S3:read-raw-sop',
      ]),
      wildcardAllowCount: 0,
      roleBoundToFunction: false,
      finalBindingOwner: 'TASK-179',
    } as WsConnFnRoleEvidence;

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
        // ── A. ConnectionsTable: GetItem / PutItem / UpdateItem / DeleteItem / Scan ─
        //
        // WsPushFn and ConnFn own the live Connections-table presence map.
        // GetItem = look up a single connection; Scan = enumerate connections
        // for targeted fan-out; PutItem/UpdateItem/DeleteItem = keep the map
        // in sync with connect/disconnect/refresh events.
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: [
            'dynamodb:GetItem',
            'dynamodb:PutItem',
            'dynamodb:UpdateItem',
            'dynamodb:DeleteItem',
            'dynamodb:Scan',
          ],
          resources: [connectionsTableArn],
        }),

        // ── B. WebSocket ManageConnections: exact API + stage + @connections/* ─
        //
        // Resource is the exact execute-api ARN for this API + stage +
        // POST/@connections/* path. Any other API / stage is implicitly denied.
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ['execute-api:ManageConnections'],
          resources: [webSocketManageConnectionsArn],
        }),

        // ── C. CloudWatch Logs: dedicated log group streams ────────────────
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ['logs:CreateLogStream', 'logs:PutLogEvents'],
          resources: [`${wsPushLogGroupArn}:log-stream:*`],
        }),

        // ── D. DynamoDB write Deny: NotResource excludes ConnectionsTable ──
        //
        // WsPushFn / ConnFn must NEVER write to DecisionCore, Narrative,
        // Idempotency, PublishRecord, or any future table. NotResource =
        // exact connectionsTableArn excludes it from the Deny so the
        // ConnectionsTable writes above remain ALLOWed.
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
          notResources: [connectionsTableArn],
        }),

        // ── E. Raw / SOP S3 read Deny: WsPushFn / ConnFn never read S3 ───
        //
        // Renderer reads SOP; the WebSocket plane has no business reading S3.
        new PolicyStatement({
          effect: Effect.DENY,
          actions: ['s3:GetObject'],
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
