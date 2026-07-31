/**
 * OrchestratorRole — Step Functions Express service role for the workflow
 *
 * §18, §10.11e, §15.2, TASK-083
 *
 * OrchestratorRole is the Step Functions Express service role that drives the
 * orchestrator state machine. It is NOT a Lambda execution role — AWS Step Functions
 * is the principal that assumes this role. This role grants ONLY the ability to
 * InvokeFunction on the four workflow Lambdas (DecisionFn, RendererFn,
 * WorkflowStatusFn, RecoveryGateFn).
 *
 * ─── What OrchestratorRole OWNS ─────────────────────────────────────
 *
 *   - Invokes the four workflow Lambdas:
 *       DecisionFn, RendererFn, WorkflowStatusFn, RecoveryGateFn
 *
 * ─── What OrchestratorRole MUST NOT do ──────────────────────────────
 *
 *   - Invoke InjectFn / PublishFn / ApiReadFn / WsPushFn / ConnFn / WhatIfFn
 *   - Invoke any future Lambda (NotResource excludes the four allowed ARNs)
 *   - Direct DynamoDB read or write
 *   - Direct S3 read or write
 *   - Call Bedrock
 *   - Start another Step Functions state machine
 *   - Connect / PostToConnection
 *   - SSM / Secrets Manager / KMS reads
 *   - IAM PassRole
 *
 * ─── X-Ray boundary ──────────────────────────────────────────────────
 *
 *   Step Functions tracing rights are owned by the Express state machine iam
 *   configuration, not by this role. This role does NOT grant xray:*.
 *   TASK-179 is the final-binding owner; X-Ray wiring is TASK-179's concern.
 *
 * ─── Security boundaries (precise) ──────────────────────────────────
 *
 * This construct creates:
 *   - 1 × AWS::IAM::Role     (PERSONAL_AWS_DEV / COMPETITION_AWS)
 *   - 1 × AWS::IAM::Policy  (PERSONAL_AWS_DEV / COMPETITION_AWS, inline)
 *
 * This construct NEVER creates:
 *   - Lambda / State Machine / DynamoDB / S3 / SSM / KMS / SNS / etc.
 *   - AWS managed policies
 *   - External references to process.env
 *   - Hard-coded account, region, or ARN
 *
 * LOCAL_MOCK: zero AWS resources (role / policy stay undefined).
 *
 * ─── Ownership chain ─────────────────────────────────────────────────
 *
 *   role defined:                YES (here, TASK-083)
 *   role final-bound to State Machine: NO  (TASK-179)
 *   final binding owner:           TASK-179
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

export interface OrchestratorRoleEvidence {
  /** Lambda invocation resource ARNs (always exactly 4). */
  readonly allowedLambdaArns: readonly string[];

  /** The exact DecisionFn ARN. */
  readonly decisionFunctionArn: string;

  /** The exact RendererFn ARN. */
  readonly rendererFunctionArn: string;

  /** The exact WorkflowStatusFn ARN. */
  readonly workflowStatusFunctionArn: string;

  /** The exact RecoveryGateFn ARN. */
  readonly recoveryGateFunctionArn: string;

  /** Count of ALLOW statements using Resource "*". Must be 0. */
  readonly wildcardAllowCount: number;

  /** Categories explicitly denied (proves the deny list is intentional). */
  readonly explicitDenyCategories: readonly string[];

  /**
   * This role is NOT yet bound to the orchestrator state machine.
   * Final binding is owned by TASK-179.
   */
  readonly roleBoundToStateMachine: false;

  /** The owner responsible for the final role → State Machine binding. */
  readonly finalBindingOwner: 'TASK-179';
}

// ─── Props ────────────────────────────────────────────────────────────────────

export interface OrchestratorRoleConstructProps {
  /** TASK-059 typed environment context */
  readonly envContext: EnvironmentContext;

  /**
   * Stable role name. Must be non-empty, no credential-like substrings.
   */
  readonly roleName: string;

  /**
   * Exact ARN of the DecisionFn Lambda.
   * Must be a valid Lambda function ARN (arn:aws:lambda:...).
   */
  readonly decisionFunctionArn: string;

  /**
   * Exact ARN of the RendererFn Lambda.
   * Must be a valid Lambda function ARN (arn:aws:lambda:...).
   */
  readonly rendererFunctionArn: string;

  /**
   * Exact ARN of the WorkflowStatusFn Lambda.
   * Must be a valid Lambda function ARN (arn:aws:lambda:...).
   */
  readonly workflowStatusFunctionArn: string;

  /**
   * Exact ARN of the RecoveryGateFn Lambda.
   * Must be a valid Lambda function ARN (arn:aws:lambda:...).
   */
  readonly recoveryGateFunctionArn: string;
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

function validateLambdaArn(label: string, arn: string): void {
  validateArn(label, arn);
  if (arn.startsWith('${') || arn.includes('Token[')) return;
  if (!arn.startsWith('arn:aws:lambda:')) {
    throw new Error(`${label} must be a Lambda function ARN (arn:aws:lambda:...), got: ${arn}`);
  }
  if (arn.includes('*')) {
    throw new Error(`${label} must be an exact Lambda ARN, must not contain "*": ${arn}`);
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

export class OrchestratorRoleConstruct extends Construct {
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
  public readonly evidence: OrchestratorRoleEvidence;

  public constructor(scope: Construct, id: string, props: OrchestratorRoleConstructProps) {
    super(scope, id);

    const {
      envContext,
      roleName,
      decisionFunctionArn,
      rendererFunctionArn,
      workflowStatusFunctionArn,
      recoveryGateFunctionArn,
    } = props;

    // ── Validate before creating any AWS resource ─────────────────────────────

    validateRoleName(roleName);
    validateLambdaArn('decisionFunctionArn', decisionFunctionArn);
    validateLambdaArn('rendererFunctionArn', rendererFunctionArn);
    validateLambdaArn('workflowStatusFunctionArn', workflowStatusFunctionArn);
    validateLambdaArn('recoveryGateFunctionArn', recoveryGateFunctionArn);

    if (
      new Set([
        decisionFunctionArn,
        rendererFunctionArn,
        workflowStatusFunctionArn,
        recoveryGateFunctionArn,
      ]).size < 4
    ) {
      throw new Error(
        'decisionFunctionArn, rendererFunctionArn, workflowStatusFunctionArn, and recoveryGateFunctionArn must all be distinct',
      );
    }

    // ── Build evidence (always populated) ──────────────────────────────────

    const allowedArns = [
      decisionFunctionArn,
      rendererFunctionArn,
      workflowStatusFunctionArn,
      recoveryGateFunctionArn,
    ];

    this.evidence = {
      allowedLambdaArns: Object.freeze(allowedArns.slice()),
      decisionFunctionArn,
      rendererFunctionArn,
      workflowStatusFunctionArn,
      recoveryGateFunctionArn,
      wildcardAllowCount: 0,
      explicitDenyCategories: Object.freeze(['Lambda:invoke-non-workflow', 'Lambda:invoke-future']),
      roleBoundToStateMachine: false,
      finalBindingOwner: 'TASK-179',
    } as OrchestratorRoleEvidence;

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
      assumedBy: new ServicePrincipal('states.amazonaws.com'),
      inlinePolicies: {},
      // No AWS managed policies
    });

    // ── Build inline policy ─────────────────────────────────────────────

    const policyDoc = new PolicyDocument({
      statements: [
        // ── A. Allow: InvokeFunction on the four workflow Lambdas only ───
        //
        // Orchestrator state machine drives DecisionFn → RendererFn → WorkflowStatusFn
        // and may invoke RecoveryGateFn for retry / gating decisions. No other Lambda
        // (InjectFn, PublishFn, ApiReadFn, WsPushFn, ConnFn, WhatIfFn, ...) is callable.
        new PolicyStatement({
          effect: Effect.ALLOW,
          actions: ['lambda:InvokeFunction'],
          resources: [
            decisionFunctionArn,
            rendererFunctionArn,
            workflowStatusFunctionArn,
            recoveryGateFunctionArn,
          ],
        }),

        // ── B. Deny: InvokeFunction on any Lambda other than the four ────
        //
        // The Deny uses NotResource listing the four allowed ARNs so any
        // future Lambda (or any other runtime Lambda) is explicitly denied.
        new PolicyStatement({
          effect: Effect.DENY,
          actions: ['lambda:InvokeFunction'],
          notResources: [
            decisionFunctionArn,
            rendererFunctionArn,
            workflowStatusFunctionArn,
            recoveryGateFunctionArn,
          ],
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
