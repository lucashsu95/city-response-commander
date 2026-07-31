/**
 * WorkflowStateMachineConstruct — Express Workflow orchestration
 *
 * §4.6, §6, §15.2, Figure 8
 * TASK-068
 *
 * Defines exactly ONE Express Workflow with:
 *   - `MARK_RUNNING` as the first state (uses `$$.Execution.Id` for fencing)
 *   - `SELECT_RECOVERY_MODE` Choice (NORMAL/FULL_WORKFLOW → DecisionFn,
 *     ENRICHMENT_ONLY → RecoveryGate; default → fail-closed)
 *   - `DECISION_CORE_WRITE_GATE` Choice (COMMITTED / ALREADY_COMMITTED_SAME_DECISION
 *     → MARK_CORE_COMMITTED_DECISION; CORE_IDENTITY_CONFLICT → terminal Fail;
 *     default → fail-closed)
 *   - `PUBLISH_FAST_PATH_READY` WebSocket push (NOT authoritative state)
 *   - `ENRICHMENT_PARALLEL` with exactly three branches (REPORT / PUBLIC_ALERT /
 *     EXPLANATION) all invoking the same RendererFn with different `mode`
 *   - `MARK_COMPLETED` → `WORKFLOW_SUCCEEDED`
 *   - `RECOVERY_GATE_AFTER_FAILURE` → `MARK_PROCESSING_FAILED` →
 *     `FAIL_PROCESSING_FAILED` for all post-MARK_RUNNING failures
 *
 * applicationStateMachineCount = 1.
 *
 * ─── Strict forbidden ─────────────────────────────────────────────────────
 *
 * - No `lambda_direct` runtime fallback. `orchestration.mode=lambda_direct`
 *   is a deployment-time alternative only.
 * - No DecisionFn before MARK_RUNNING.
 * - No REPORT fn / PUBLIC_ALERT fn / EXPLANATION fn (those are renderer
 *   branches inside RendererFn, NOT three separate Lambdas).
 * - No IAM Role creation; `executionRole` is required and injected.
 * - No Lambda/LogGroup/EventRule/StateMachineAlias.
 * - No `.sync` / `.waitForTaskToken` / Distributed Map / Activity.
 * - No direct DynamoDB / S3 / Bedrock / API Gateway integration.
 * - No hard-coded account, region, Lambda ARN, or StateMachine ARN.
 * - No `grantInvoke` in this task — TASK-179 / TASK-083 wire the exact
 *   Lambda Invoke grants from OrchestratorRole to the five runtime Lambdas.
 * - No `Retry` on `States.ALL` — only the four Lambda transient SDK errors.
 *
 * ─── Out of scope (deferred to other tasks) ───────────────────────────────
 *
 * - Log groups / metrics / alarms / X-Ray (TASK-075)
 * - IAM grants / role binding (TASK-083, TASK-179)
 * - ComputeStack composition (TASK-180)
 * - Exact Handler result contract + apply-or-confirm gates (TASK-097)
 * - RendererFn branch selection for missing_narrative_types (TASK-118)
 * - Strongly-consistent base-table reads inside RecoveryGateFn (TASK-093)
 *
 * ─── Timeout injection (TASK-068 deployment-readiness correction) ─────────
 *
 * `workflowTimeoutSeconds` is injected as a top-level numeric `TimeoutSeconds`
 * into the deployed workflow definition. The canonical `workflow.asl.json`
 * is the single source of truth for the workflow topology (StartAt, the 28
 * state names, Retry/Catch configuration, etc.). Only the `TimeoutSeconds`
 * value is added by the Construct: at instantiation we read the canonical
 * JSON, parse it, build a fresh object with `TimeoutSeconds` set, serialize
 * it deterministically, and pass it via `DefinitionBody.fromString`. The
 * canonical file is not mutated, no duplicate profile-specific file is
 * maintained, and the value is not inlined into the source-of-truth JSON.
 *
 * The CDK 2.262 L2 `StateMachine.timeout` does NOT emit a CFN
 * `TimeoutSeconds` property when using a `FileDefinitionBody` (or any
 * DefinitionBody that resolves to an S3-asset body); the timeout is a
 * no-op for these body types. We therefore use `DefinitionBody.fromString`
 * with the timeout already injected at the root of the definition so the
 * deployed definition carries the value.
 *
 * LOCAL_MOCK:
 *   - 0 AWS resources (no AWS::StepFunctions::StateMachine, no AWS::IAM::*)
 *   - public references stay `undefined`
 *   - props validation still runs so every profile sees the same errors
 */

import { Construct } from 'constructs';
import { Stack, CfnOutput, RemovalPolicy } from 'aws-cdk-lib';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import type { IFunction } from 'aws-cdk-lib/aws-lambda';
import type { IRole } from 'aws-cdk-lib/aws-iam';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { EnvironmentContext } from '../env_context.js';

// ─── Constants ─────────────────────────────────────────────────────────────

/** Fixed count of application State Machines in this Construct. */
export const APPLICATION_STATE_MACHINE_COUNT: 1 = 1;

/** Stable suffix for the Application State Machine name. */
const STATE_MACHINE_NAME_SUFFIX = 'workflow';

/** Minimum allowed workflow timeout (seconds). */
export const WORKFLOW_TIMEOUT_SECONDS_MIN = 1;

/** Maximum allowed workflow timeout (seconds). Express Workflow cap. */
export const WORKFLOW_TIMEOUT_SECONDS_MAX = 300;

/** Definition substitutions keys (must match the ASL `${...}` placeholders). */
export const ASL_SUBSTITUTION_KEYS = [
  'WorkflowStatusFnArn',
  'RecoveryGateFnArn',
  'DecisionFnArn',
  'RendererFnArn',
  'WsPushFnArn',
] as const;
export type AslSubstitutionKey = (typeof ASL_SUBSTITUTION_KEYS)[number];

// ─── Validation ─────────────────────────────────────────────────────────────

function validateWorkflowTimeout(seconds: number): void {
  if (!Number.isInteger(seconds) || seconds < WORKFLOW_TIMEOUT_SECONDS_MIN || seconds > WORKFLOW_TIMEOUT_SECONDS_MAX) {
    throw new Error(
      `workflowTimeoutSeconds must be an integer in [${WORKFLOW_TIMEOUT_SECONDS_MIN}, ${WORKFLOW_TIMEOUT_SECONDS_MAX}], got: ${seconds}`,
    );
  }
}

function validateFunctionArn(label: string, arn: string): void {
  if (!arn || typeof arn !== 'string') {
    throw new Error(`${label}.functionArn is required`);
  }
  if (!arn.startsWith('arn:aws:lambda:')) {
    throw new Error(`${label}.functionArn must be a Lambda ARN; got: ${arn}`);
  }
}

// ─── Props ─────────────────────────────────────────────────────────────────

export interface WorkflowStateMachineProps {
  readonly envContext: EnvironmentContext;

  /**
   * Execution role for the Express Workflow. Injected by the caller.
   * The Construct NEVER creates a Role or Policy.
   */
  readonly executionRole: IRole;

  /** WorkflowStatusFn (used by MARK_RUNNING / MARK_CORE_COMMITTED / MARK_COMPLETED / MARK_PROCESSING_FAILED). */
  readonly workflowStatusFn: IFunction;

  /** RecoveryGateFn (used by ENRICHMENT_ONLY path and after-failure recovery). */
  readonly recoveryGateFn: IFunction;

  /** DecisionFn (canonical fast-path producer). */
  readonly decisionFn: IFunction;

  /** RendererFn (REPORT / PUBLIC_ALERT / EXPLANATION branches). */
  readonly rendererFn: IFunction;

  /** WsPushFn (presentation notification only; NOT authoritative state). */
  readonly wsPushFn: IFunction;

  /** Workflow timeout in seconds (1-300). Required, no default. */
  readonly workflowTimeoutSeconds: number;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

/**
 * Read the canonical workflow ASL JSON file and inject a top-level
 * `TimeoutSeconds` value. The result is a fresh object (no mutation of
 * the parsed import) so multiple Construct instances in the same Node
 * process get independent definitions.
 *
 * The canonical `workflow.asl.json` file is the single source of truth
 * for the workflow topology (StartAt, the state names, Retry/Catch
 * configuration, etc.). Only the `TimeoutSeconds` is injected here.
 */
function loadAslWithTimeout(aslPath: string, workflowTimeoutSeconds: number): string {
  const raw = fs.readFileSync(aslPath, 'utf8');
  const parsed = JSON.parse(raw) as Record<string, unknown>;
  // Build a new object so we never mutate the parsed-in import cache.
  const withTimeout: Record<string, unknown> = {
    ...parsed,
    TimeoutSeconds: workflowTimeoutSeconds,
  };
  return JSON.stringify(withTimeout);
}

// ─── ASL pre-synth validation (TASK-068 canonical-source patch) ───────────

interface AslLikeState {
  Type?: string;
  Next?: string;
  End?: boolean;
  Default?: string;
  Choices?: Array<{ Next?: string }>;
  Catch?: Array<{ Next?: string }>;
  Branches?: Array<{ StartAt?: string; States?: Record<string, unknown> }>;
}

export type { AslLikeState };

/**
 * Walk the ASL state map once and validate that every Next / Default /
 * Choices.Next / Catch.Next target references a state name that actually
 * exists in the same scope. Branch-internal references are validated
 * against the branch-local States map.
 *
 * Returns the list of validated (scope, state-name) pairs.
 */
function validateStateReferences(
  scopeLabel: string,
  states: Record<string, AslLikeState>,
): Set<string> {
  const seen = new Set<string>();
  for (const [name, s] of Object.entries(states)) {
    seen.add(name);
    if (s.Next && !(s.Next in states)) {
      throw new Error(
        `TASK-068 ASL validation: ${scopeLabel}.${name}.Next -> '${s.Next}' is not a defined state`,
      );
    }
    if (s.Default && !(s.Default in states)) {
      throw new Error(
        `TASK-068 ASL validation: ${scopeLabel}.${name}.Default -> '${s.Default}' is not a defined state`,
      );
    }
    if (s.Choices) {
      for (const c of s.Choices) {
        if (!c.Next) continue;
        if (!(c.Next in states)) {
          throw new Error(
            `TASK-068 ASL validation: ${scopeLabel}.${name}.Choices -> '${c.Next}' is not a defined state`,
          );
        }
      }
    }
    if (s.Catch) {
      for (const c of s.Catch) {
        if (!c.Next) continue;
        if (!(c.Next in states)) {
          throw new Error(
            `TASK-068 ASL validation: ${scopeLabel}.${name}.Catch -> '${c.Next}' is not a defined state`,
          );
        }
      }
    }
    if (s.Branches) {
      s.Branches.forEach((b, i) => {
        if (!b.StartAt) {
          throw new Error(
            `TASK-068 ASL validation: ${scopeLabel}.${name}.Branches[${i}] is missing StartAt`,
          );
        }
        const localStates = (b.States ?? {}) as Record<string, AslLikeState>;
        if (!(b.StartAt in localStates)) {
          throw new Error(
            `TASK-068 ASL validation: ${scopeLabel}.${name}.Branches[${i}].StartAt -> '${b.StartAt}' is not defined in the branch`,
          );
        }
        const inner = validateStateReferences(
          `${scopeLabel}.${name}.Branches[${i}]`,
          localStates,
        );
        for (const n of inner) seen.add(`${name}::${n}`);
      });
    }
  }
  return seen;
}

/**
 * Pre-synth validation of the canonical ASL document.
 *
 * Asserts:
 *   1. JSON parses (this is implied by the caller having parsed it)
 *   2. `StartAt` is a non-empty string pointing to a defined top-level state
 *   3. Every `Next` / `Default` / `Choices[i].Next` / `Catch[i].Next`
 *      references a state that exists in the same scope
 *   4. Every `${XxxArn}` placeholder the Construct expects to substitute
 *      actually appears at least once in the serialized document (so CDK
 *      can substitute it; otherwise the placeholder would be silently
 *      left intact and Step Functions would fail at runtime)
 *   5. After applying the supplied substitution map, no `${…}` token
 *      remains in the serialized document (so the deployed definition
 *      contains no unresolved placeholders)
 *
 * The function returns the validated state-name set for callers that
 * want to assert reachability separately.
 */
export function validateAslDocument(
  parsed: Record<string, unknown>,
  expectedPlaceholders: readonly string[],
  substitutions: Record<string, string>,
): Set<string> {
  if (typeof parsed['StartAt'] !== 'string' || parsed['StartAt'].length === 0) {
    throw new Error('TASK-068 ASL validation: missing or empty StartAt');
  }
  const states = parsed['States'] as Record<string, AslLikeState> | undefined;
  if (!states || typeof states !== 'object') {
    throw new Error('TASK-068 ASL validation: missing or invalid States map');
  }
  const startAt = parsed['StartAt'] as string;
  if (!(startAt in states)) {
    throw new Error(
      `TASK-068 ASL validation: StartAt '${startAt}' is not a defined state`,
    );
  }

  const reachable = validateStateReferences('root', states);

  const serialized = JSON.stringify(parsed);
  for (const placeholder of expectedPlaceholders) {
    const token = '${' + placeholder + '}';
    if (!serialized.includes(token)) {
      throw new Error(
        `TASK-068 ASL validation: expected placeholder '${token}' not present in workflow.asl.json`,
      );
    }
  }

  let afterSubstitution = serialized;
  for (const [k, v] of Object.entries(substitutions)) {
    afterSubstitution = afterSubstitution.split('${' + k + '}').join(v);
  }
  const leftover = afterSubstitution.match(/\$\{[^}]+\}/g);
  if (leftover && leftover.length > 0) {
    throw new Error(
      `TASK-068 ASL validation: unresolved placeholders after substitution: ${leftover.join(', ')}`,
    );
  }

  return reachable;
}

// ─── Construct ─────────────────────────────────────────────────────────────

export class WorkflowStateMachineConstruct extends Construct {
  public readonly stateMachine?: sfn.StateMachine;
  public readonly stateMachineArn?: string;
  public readonly stateMachineName?: string;
  public readonly stateMachineRole?: IRole;
  /** Configured workflow timeout in seconds (1-300). Stored for tooling visibility. */
  public readonly workflowTimeoutSeconds: number;

  /** Fixed count = 1. */
  public readonly applicationStateMachineCount: 1 = APPLICATION_STATE_MACHINE_COUNT;

  public constructor(scope: Construct, id: string, props: WorkflowStateMachineProps) {
    super(scope, id);

    const {
      envContext,
      executionRole,
      workflowStatusFn,
      recoveryGateFn,
      decisionFn,
      rendererFn,
      wsPushFn,
      workflowTimeoutSeconds,
    } = props;

    // ─── Cross-cutting validation (run BEFORE LOCAL_MOCK bail-out so all
    //     profiles see the same errors). ──────────────────────────────────

    validateWorkflowTimeout(workflowTimeoutSeconds);

    if (!executionRole) throw new Error('executionRole is required');
    if (!workflowStatusFn) throw new Error('workflowStatusFn is required');
    if (!recoveryGateFn) throw new Error('recoveryGateFn is required');
    if (!decisionFn) throw new Error('decisionFn is required');
    if (!rendererFn) throw new Error('rendererFn is required');
    if (!wsPushFn) throw new Error('wsPushFn is required');

    validateFunctionArn('workflowStatusFn', workflowStatusFn.functionArn);
    validateFunctionArn('recoveryGateFn', recoveryGateFn.functionArn);
    validateFunctionArn('decisionFn', decisionFn.functionArn);
    validateFunctionArn('rendererFn', rendererFn.functionArn);
    validateFunctionArn('wsPushFn', wsPushFn.functionArn);

    // TASK-068 canonical-source patch: pre-synth validation runs here,
    // BEFORE the LOCAL_MOCK bail-out so all profiles (LOCAL_MOCK,
    // PERSONAL_AWS_DEV, COMPETITION_AWS) see the same errors when the
    // canonical `workflow.asl.json` is malformed. This rejects:
    //   - unparseable JSON (thrown by `JSON.parse`)
    //   - missing or empty `StartAt`
    //   - `Next` / `Default` / `Choices[i].Next` / `Catch[i].Next`
    //     pointing to a state that does not exist in the same scope
    //   - placeholder names that the Construct expects to substitute but
    //     that are absent from the document
    //   - `${...}` tokens that remain after substitution (unresolved
    //     placeholders would break Step Functions at deploy time)
    //
    // The substitutions map here mirrors the `definitionSubstitutions`
    // prop below; it is applied manually so we can detect any token CDK
    // would leave in the deployed definition. The Construct itself
    // relies on CDK to perform the real substitution at synth time.
    const aslPath = path.resolve(__dirname, '..', '..', 'statemachine', 'workflow.asl.json');
    const rawAsl = fs.readFileSync(aslPath, 'utf8');
    const parsedAsl = JSON.parse(rawAsl) as Record<string, unknown>;
    const substitutions: Record<string, string> = {
      WorkflowStatusFnArn: workflowStatusFn.functionArn,
      RecoveryGateFnArn: recoveryGateFn.functionArn,
      DecisionFnArn: decisionFn.functionArn,
      RendererFnArn: rendererFn.functionArn,
      WsPushFnArn: wsPushFn.functionArn,
    };
    validateAslDocument(parsedAsl, ASL_SUBSTITUTION_KEYS, substitutions);

    this.workflowTimeoutSeconds = workflowTimeoutSeconds;

    if (envContext.isLocalMock) {
      // Zero AWS resources. Public references stay `undefined`.
      return;
    }

    const stack = Stack.of(this);

    const stateMachineName = `${envContext.resourcePrefix}-${STATE_MACHINE_NAME_SUFFIX}`;
    // Name sanity check: 1-80 chars, A-Za-z0-9_-.
    if (!/^[A-Za-z0-9_-]{1,80}$/.test(stateMachineName)) {
      throw new Error(`Generated stateMachineName '${stateMachineName}' is invalid`);
    }

    // Read the canonical `workflow.asl.json`. The Construct then injects
    // the configured `TimeoutSeconds` at the top level for deployment.
    // The canonical file remains the single source of truth for the
    // workflow topology (StartAt, the state names, Retry/Catch
    // configuration, etc.). Only the timeout value is injected here —
    // the file is NOT mutated, and no duplicate PERSONAL/COMPETITION
    // file is maintained. The pre-synth validation above already ran
    // against the same file before the LOCAL_MOCK bail-out.
    const definitionBody = sfn.DefinitionBody.fromString(
      loadAslWithTimeout(aslPath, workflowTimeoutSeconds),
    );

    const sm = new sfn.StateMachine(this, 'WorkflowStateMachine', {
      stateMachineName,
      stateMachineType: sfn.StateMachineType.EXPRESS,
      role: executionRole,
      definitionBody,
      definitionSubstitutions: {
        WorkflowStatusFnArn: workflowStatusFn.functionArn,
        RecoveryGateFnArn: recoveryGateFn.functionArn,
        DecisionFnArn: decisionFn.functionArn,
        RendererFnArn: rendererFn.functionArn,
        WsPushFnArn: wsPushFn.functionArn,
      },
      tracingEnabled: false,
      logs: undefined,
      timeout: undefined,
    });

    // Removal policy is driven by the environment profile.
    const cfnSm = sm.node.defaultChild as sfn.CfnStateMachine;
    cfnSm.applyRemovalPolicy(envContext.isCompetition ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY);

    // CloudFormation Output (no cross-stack exportName; for deploy-time
    // evidence and for InjectFn / TASK-180 wiring).
    new CfnOutput(this, 'WorkflowStateMachineArn', {
      description: 'ARN of the City Response Commander Express Workflow (TASK-068).',
      value: sm.stateMachineArn,
    });

    this.stateMachine = sm;
    this.stateMachineArn = sm.stateMachineArn;
    this.stateMachineName = sm.stateMachineName;
    this.stateMachineRole = executionRole;
  }
}