/**
 * RuntimeLambdas — Ten application Runtime Lambda function definitions
 *
 * §6 圖2 (compute nodes), §8, §14.5 (WhatIfFn), §18, §20 (timeouts), §27 (concurrency)
 * TASK-067
 *
 * Defines exactly TEN application runtime Lambdas. The RuntimeLambdaNames
 * constant is the canonical list and is the single source of truth:
 *
 *   1. InjectFn
 *   2. WorkflowStatusFn
 *   3. RecoveryGateFn
 *   4. DecisionFn
 *   5. RendererFn
 *   6. PublishFn
 *   7. ApiReadFn
 *   8. WsPushFn
 *   9. ConnFn
 *  10. WhatIfFn
 *
 * applicationRuntimeLambdaCount = 10.
 *
 * ─── Strict forbidden additions ────────────────────────────────────────────
 *
 * - `IngestionFn` is NOT a runtime Lambda. KB ingestion is a deployment-time
 *   mechanism (§14.1, §25 step 1) provisioned by the TASK-178
 *   Custom Resource Provider. It is NOT one of the ten and is never created
 *   by this Construct.
 * - `IdempotencyGateFn` is NOT a separate eleventh Lambda; it is the
 *   `MARK_RUNNING` action of the Task-067.1 §10.11e idempotency table,
 *   written by WorkflowStatusFn. There is no dedicated runtime Lambda for
 *   it.
 * - The three Renderer branch invocations (REPORT / PUBLIC_ALERT /
 *   EXPLANATION) are Step Functions branches inside RendererFn, NOT three
 *   separate Lambdas.
 * - No ReportFn, PublicAlertFn, ExplanationFn, OrchestratorFn, or any other
 *   speculative runtime Lambda.
 *
 * ─── Deterministic-truth boundary (§14.5, §18) ─────────────────────────────
 *
 * - Deterministic numeric/boolean truth is produced ONLY by the deterministic
 *   domain code that DecisionFn calls. RendererFn and WhatIfFn use Bedrock
 *   for language only and NEVER mutate DecisionCore.
 * - `WhatIfFn` is its own dedicated runtime host. What-if never runs inside
 *   DecisionFn / RendererFn / ApiReadFn. This preserves write-isolation
 *   and single-responsibility for the Why-explainer.
 *
 * ─── Role-injection contract (TASK-067 → TASK-179 final binding) ───────────
 *
 * Every Lambda in this Construct requires an EXPLICIT `iam.IRole` injected
 * via props. The Construct NEVER auto-creates a runtime execution role and
 * NEVER sets `lambda.Function` without a role. CDK auto-generation of the
 * runtime execution role is explicitly forbidden; the FINAL binding and
 * exact cross-resource grants are completed and verified by TASK-179.
 *
 * Mapping (prop key → runtime Lambda):
 *   injectFnRole            → InjectFn
 *   workflowStatusFnRole    → WorkflowStatusFn
 *   recoveryGateFnRole      → RecoveryGateFn
 *   decisionFnRole          → DecisionFn
 *   rendererFnRole          → RendererFn
 *   publishFnRole           → PublishFn
 *   apiReadFnRole           → ApiReadFn
 *   wsConnFnRole            → WsPushFn, ConnFn     (shared — only allowed sharing)
 *
 * Forbidden injection (must NEVER be passed here as the role of a runtime
 * Lambda):
 *   - IngestionRole              (deployment-time only; TASK-083, TASK-178)
 *   - OrchestratorRole           (state-machine-only; TASK-083)
 *   - KnowledgeBaseServiceRole   (Bedrock service role; wired into the KB
 *                                  resource RoleArn, NOT a runtime Lambda)
 *   - CloudFormation deployment role (control plane; never runtime data plane)
 *
 * ─── Sizing contract (memory / timeout / reserved concurrency) ────────────
 *
 * All memory / timeout values are REQUIRED props per function. The Construct
 * does NOT impose magic numbers — only validation. DecisionFn has a
 * REQUIRED `decisionFnReservedConcurrency` and is the ONLY function with
 * `ReservedConcurrentExecutions` set; this protects the Fast Path.
 *
 *   memorySizeMb: integer in [128, 10240]
 *   timeoutSeconds: integer in [1, 900]     (Lambda hard cap; RendererFn
 *                                            and WhatIfFn MUST stay under 900s)
 *   decisionFnReservedConcurrency: positive integer (NO silent default)
 *
 * ─── Artifact / Handler injection contract ─────────────────────────────────
 *
 * Each function's `code`, `handler`, and `runtime` are injected via the
 * `definitions` map. The Construct NEVER uses `lambda.Code.fromInline` as
 * a production default; tests use `Code.fromInline` for isolated synth.
 *
 * Handler validation:
 *   - non-empty after trim
 *   - no control characters
 *   - one per function; exactly ten definitions required
 *   - WhatIfFn handler must differ from DecisionFn, RendererFn, ApiReadFn
 *   - no rewriting / lowercase coercion / fallback
 *
 * If a deployment artifact has not yet been published, the prop MAY be
 * omitted by the integration layer; this Construct will then NOT be wired
 * into the ComputeStack (it must report PENDING_OWNER_IMPLEMENTATION and
 * raise a runtime error at instantiation if the artifacts are missing).
 *
 * ─── Environment wiring (function-scoped, no over-broadcast) ──────────────
 *
 * APP_ENV is auto-injected from `envContext.profile` and CANNOT be
 * overridden by props. The Construct blocks the following reserved names
 * to prevent leaks of AWS-managed state:
 *
 *   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_SESSION_TOKEN,
 *   AWS_REGION, AWS_DEFAULT_REGION
 *
 * Resource values (table names, bucket names, endpoints, model IDs, KB ID)
 * MUST be injected by props. No hard-coding.
 *
 * WhatIfFn environment MUST receive (per the spec):
 *   - the Bedrock model ID (props.bedrockModelId)
 *   - the Bedrock region (Stack.region token via envContext)
 *   - the Knowledge Base ID (props.knowledgeBaseId)
 *
 * RendererFn environment follows the same rule if the prop is supplied.
 * WhatIfFn receives NO write-permission concept (TASK-177 WhatIfFnRole
 * enforces the actual write-isolation at IAM level).
 *
 * ─── Out of scope (deferred to other tasks) ───────────────────────────────
 *
 * - Log groups / metrics / alarms / X-Ray (TASK-075)
 * - IAM grants / resource policies / event sources (TASK-179)
 * - API Gateway / WebSocket routes (TASK-069 / TASK-070)
 * - Step Functions state machine (TASK-068)
 * - Provisioned concurrency / alias / version
 * - DLQ / SNS / SQS / EventBridge
 * - Function URL / Lambda Layer / VPC / Secrets / SSM
 * - Log retention Custom Resource
 *
 * LOCAL_MOCK:
 *   - 0 AWS resources (zero AWS::Lambda::Function, zero AWS::IAM::*)
 *   - public readonly references stay `undefined`
 *   - prop validation still runs so every profile sees the same errors
 */

import { Construct } from 'constructs';
import { Duration, Stack } from 'aws-cdk-lib';
import { Code, Function, Runtime } from 'aws-cdk-lib/aws-lambda';
import type { IRole } from 'aws-cdk-lib/aws-iam';
import type { EnvironmentContext } from '../env_context.js';

// ─── Canonical names ────────────────────────────────────────────────────────

export const RUNTIME_LAMBDA_NAMES = [
  'InjectFn',
  'WorkflowStatusFn',
  'RecoveryGateFn',
  'DecisionFn',
  'RendererFn',
  'PublishFn',
  'ApiReadFn',
  'WsPushFn',
  'ConnFn',
  'WhatIfFn',
] as const;

export type RuntimeLambdaName = (typeof RUNTIME_LAMBDA_NAMES)[number];

/** Fixed count of application runtime Lambdas in this Construct. */
export const APPLICATION_RUNTIME_LAMBDA_COUNT: 10 = 10;

// ─── Stable function-name suffixes (compose with envContext.resourcePrefix) ─

const LAMBDA_NAME_SUFFIX: Record<RuntimeLambdaName, string> = {
  InjectFn: 'inject',
  WorkflowStatusFn: 'workflow-status',
  RecoveryGateFn: 'recovery-gate',
  DecisionFn: 'decision',
  RendererFn: 'renderer',
  PublishFn: 'publish',
  ApiReadFn: 'api-read',
  WsPushFn: 'ws-push',
  ConnFn: 'connection',
  WhatIfFn: 'what-if',
};

// ─── Environment key constants ─────────────────────────────────────────────

/** Auto-injected, immutable application profile key. */
export const LAMBDA_ENV_APP_ENV = 'APP_ENV';

/** Stable config provider contract key (when a config provider is wired). */
export const LAMBDA_ENV_CONFIG_PROVIDER = 'CONFIG_PROVIDER';

/** Stable config version / trace contract key. */
export const LAMBDA_ENV_CONFIG_VERSION = 'CONFIG_VERSION';

/** Bedrock region token (Region, not account). */
export const LAMBDA_ENV_BEDROCK_REGION = 'BEDROCK_REGION';

/** Embedding / generation model ID (no model ARN). */
export const LAMBDA_ENV_BEDROCK_MODEL_ID = 'BEDROCK_MODEL_ID';

/** Knowledge Base ID (Bedrock-managed resource). */
export const LAMBDA_ENV_KNOWLEDGE_BASE_ID = 'KNOWLEDGE_BASE_ID';

/** Forbidden AWS-reserved names — overrides are blocked at prop time. */
export const FORBIDDEN_AWS_RESERVED_ENV_KEYS = new Set<string>([
  'AWS_ACCESS_KEY_ID',
  'AWS_SECRET_ACCESS_KEY',
  'AWS_SESSION_TOKEN',
  'AWS_REGION',
  'AWS_DEFAULT_REGION',
]);

// ─── Validation ─────────────────────────────────────────────────────────────

const LAMBDA_NAME_RE = /^[A-Za-z0-9_-]+$/;
const HANDLER_RE = /^[^\x00-\x1F\x7F]+$/;

function validateMemory(memoryMb: number, fnName: RuntimeLambdaName): void {
  if (!Number.isInteger(memoryMb) || memoryMb < 128 || memoryMb > 10240) {
    throw new Error(
      `${fnName}.memorySizeMb must be an integer in [128, 10240], got: ${memoryMb}`,
    );
  }
}

function validateTimeout(timeoutSeconds: number, fnName: RuntimeLambdaName): void {
  if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < 1 || timeoutSeconds > 900) {
    throw new Error(
      `${fnName}.timeoutSeconds must be an integer in [1, 900], got: ${timeoutSeconds}`,
    );
  }
}

function validateReservedConcurrency(value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(
      `decisionFnReservedConcurrency must be a positive integer, got: ${value}`,
    );
  }
}

function validateHandler(handler: string, fnName: RuntimeLambdaName): void {
  if (!handler || typeof handler !== 'string' || handler.trim() === '') {
    throw new Error(`${fnName}.handler must be a non-empty string`);
  }
  if (handler !== handler.trim()) {
    throw new Error(`${fnName}.handler must not have leading or trailing whitespace`);
  }
  if (!HANDLER_RE.test(handler)) {
    throw new Error(`${fnName}.handler must not contain control characters`);
  }
}

function validateEnvironment(env: Record<string, string> | undefined, fnName: RuntimeLambdaName): void {
  if (env === undefined) return;
  if (env === null || typeof env !== 'object' || Array.isArray(env)) {
    throw new Error(`${fnName}.environment must be a plain object`);
  }
  if (Object.prototype.hasOwnProperty.call(env, LAMBDA_ENV_APP_ENV)) {
    throw new Error(
      `${fnName}.environment must not override the reserved ${LAMBDA_ENV_APP_ENV} key`,
    );
  }
  for (const [k, v] of Object.entries(env)) {
    if (FORBIDDEN_AWS_RESERVED_ENV_KEYS.has(k)) {
      throw new Error(
        `${fnName}.environment must not contain reserved AWS env var '${k}'`,
      );
    }
    if (!Number.isFinite(v.length)) {
      throw new Error(`${fnName}.environment.${k} must be a string`);
    }
    if (v.includes('\u0000')) {
      throw new Error(`${fnName}.environment.${k} must not contain a NUL byte`);
    }
    if (v !== v.trim()) {
      throw new Error(`${fnName}.environment.${k} must not have leading or trailing whitespace`);
    }
  }
}

function validateFunctionName(name: string, fnName: RuntimeLambdaName): void {
  if (!name || typeof name !== 'string' || name.length < 1 || name.length > 64) {
    throw new Error(`${fnName} produced invalid FunctionName: '${name}' (length must be 1-64)`);
  }
  if (!LAMBDA_NAME_RE.test(name)) {
    throw new Error(
      `${fnName} produced invalid FunctionName: '${name}' (allowed: A-Z a-z 0-9 _ -)`,
    );
  }
}

// ─── Props ──────────────────────────────────────────────────────────────────

/**
 * One per-function definition. All fields are required; nothing is
 * defaulted to a magic number or to a fake handler.
 */
export interface RuntimeLambdaDefinition {
  readonly code: Code;
  readonly handler: string;
  readonly role: IRole;
  readonly memorySizeMb: number;
  readonly timeoutSeconds: number;
  readonly environment?: Record<string, string>;
}

export type RuntimeLambdaDefinitions = Record<RuntimeLambdaName, RuntimeLambdaDefinition>;

export interface RuntimeLambdasProps {
  readonly envContext: EnvironmentContext;

  /** Lambda runtime — caller-supplied (no Construct-side guess). */
  readonly runtime: Runtime;

  /** Ten per-function definitions, keyed by RuntimeLambdaName. */
  readonly definitions: RuntimeLambdaDefinitions;

  /**
   * Optional per-function environment additions, keyed by function name.
   * Each map is merged on top of the per-function `environment` field.
   * Reserved keys (APP_ENV, AWS_*) are blocked.
   */
  readonly environmentOverrides?: Partial<Record<RuntimeLambdaName, Record<string, string>>>;

  /** DecisionFn-only Fast Path reserved concurrency (positive integer). */
  readonly decisionFnReservedConcurrency: number;

  /**
   * Bedrock region for BEDROCK_REGION env. If undefined, the Stack.region
   * token is used.
   */
  readonly bedrockRegion?: string;

  /** Bedrock model ID (short identifier, e.g. `amazon.titan-embed-text-v2:0`). */
  readonly bedrockModelId?: string;

  /** Knowledge Base ID (deployment-time OUTPUT). */
  readonly knowledgeBaseId?: string;
}

// ─── RuntimeLambdas Construct ───────────────────────────────────────────────

export class RuntimeLambdas extends Construct {
  public readonly injectFn?: Function;
  public readonly workflowStatusFn?: Function;
  public readonly recoveryGateFn?: Function;
  public readonly decisionFn?: Function;
  public readonly rendererFn?: Function;
  public readonly publishFn?: Function;
  public readonly apiReadFn?: Function;
  public readonly wsPushFn?: Function;
  public readonly connFn?: Function;
  public readonly whatIfFn?: Function;

  /** All ten function refs keyed by canonical name. */
  public readonly functionsByName?: Partial<Record<RuntimeLambdaName, Function>>;

  /** Fixed count = 10. */
  public readonly applicationRuntimeLambdaCount: 10 = APPLICATION_RUNTIME_LAMBDA_COUNT;

  public constructor(scope: Construct, id: string, props: RuntimeLambdasProps) {
    super(scope, id);

    const {
      envContext,
      runtime,
      definitions,
      environmentOverrides,
      decisionFnReservedConcurrency,
      bedrockRegion,
      bedrockModelId,
      knowledgeBaseId,
    } = props;

    // ─── Cross-cutting validation (run BEFORE LOCAL_MOCK bail-out so all
    //     profiles see the same errors). ──────────────────────────────────

    validateReservedConcurrency(decisionFnReservedConcurrency);

    // Must have exactly the 10 names, no extras, no missing.
    const provided = Object.keys(definitions);
    const expected = RUNTIME_LAMBDA_NAMES as readonly string[];
    if (provided.length !== expected.length) {
      throw new Error(
        `definitions must contain exactly ${expected.length} entries; got ${provided.length}`,
      );
    }
    for (const name of expected) {
      if (!provided.includes(name)) {
        throw new Error(`definitions is missing required function '${name}'`);
      }
    }
    for (const providedName of provided) {
      if (!(RUNTIME_LAMBDA_NAMES as readonly string[]).includes(providedName)) {
        throw new Error(`definitions contains unknown function '${providedName}'`);
      }
    }

    for (const name of RUNTIME_LAMBDA_NAMES) {
      const def = definitions[name];
      validateHandler(def.handler, name);
      validateMemory(def.memorySizeMb, name);
      validateTimeout(def.timeoutSeconds, name);
      validateEnvironment(def.environment, name);
      if (def.code === undefined || def.code === null) {
        throw new Error(`${name}.code is required`);
      }
      if (def.role === undefined || def.role === null) {
        throw new Error(`${name}.role is required`);
      }
      if (!environmentOverrides || !environmentOverrides[name]) continue;
      validateEnvironment(environmentOverrides[name], name);
    }

    // WhatIfFn handler must differ from DecisionFn / RendererFn / ApiReadFn.
    const wif = definitions.WhatIfFn.handler;
    if (
      wif === definitions.DecisionFn.handler ||
      wif === definitions.RendererFn.handler ||
      wif === definitions.ApiReadFn.handler
    ) {
      throw new Error(
        `WhatIfFn.handler must be independent and must not equal DecisionFn/RendererFn/ApiReadFn handler`,
      );
    }

    if (envContext.isLocalMock) {
      // Zero AWS resources. All public references stay `undefined`.
      return;
    }

    const stack = Stack.of(this);
    const resolvedRegion = bedrockRegion ?? stack.region;

    // Common BEDROCK_REGION / BEDROCK_MODEL_ID / KNOWNLEDGE_BASE_ID additions,
    // applied ONLY to functions whose per-function env actually opts in via
    // presence of the relevant key. We never broadcast these values to all
    // ten functions: callers control scope per-function.
    const commonBedrockEnv: Record<string, string> = {};
    if (bedrockModelId !== undefined) {
      commonBedrockEnv[LAMBDA_ENV_BEDROCK_MODEL_ID] = bedrockModelId;
    }
    if (knowledgeBaseId !== undefined) {
      commonBedrockEnv[LAMBDA_ENV_KNOWLEDGE_BASE_ID] = knowledgeBaseId;
    }
    commonBedrockEnv[LAMBDA_ENV_BEDROCK_REGION] = resolvedRegion;

    const created: Partial<Record<RuntimeLambdaName, Function>> = {};

    for (const name of RUNTIME_LAMBDA_NAMES) {
      const def = definitions[name];
      const fnName = `${envContext.resourcePrefix}-${LAMBDA_NAME_SUFFIX[name]}`;
      validateFunctionName(fnName, name);

      const overrides = environmentOverrides?.[name];
      const env: Record<string, string> = {
        [LAMBDA_ENV_APP_ENV]: envContext.profile,
        ...def.environment,
        ...overrides,
        ...(name === 'WhatIfFn' ? commonBedrockEnv : {}),
        ...(name === 'RendererFn' && (bedrockModelId !== undefined || knowledgeBaseId !== undefined)
          ? commonBedrockEnv
          : {}),
      };

      const reservedConcurrency =
        name === 'DecisionFn' ? decisionFnReservedConcurrency : undefined;

      const fn = new Function(this, name, {
        functionName: fnName,
        runtime,
        code: def.code,
        handler: def.handler,
        role: def.role,
        memorySize: def.memorySizeMb,
        timeout: Duration.seconds(def.timeoutSeconds),
        environment: env,
        ...(reservedConcurrency !== undefined
          ? { reservedConcurrentExecutions: reservedConcurrency }
          : {}),
      });

      created[name] = fn;
    }

    // Only allowed sharing: WsPushFn and ConnFn both use WsConnFnRole.
    // Validate that the two roles point to the same IRole instance.
    if (definitions.WsPushFn.role !== definitions.ConnFn.role) {
      throw new Error(
        'WsPushFn and ConnFn must share the WsConnFnRole (the only allowed role-sharing pair)',
      );
    }

    this.injectFn = created.InjectFn;
    this.workflowStatusFn = created.WorkflowStatusFn;
    this.recoveryGateFn = created.RecoveryGateFn;
    this.decisionFn = created.DecisionFn;
    this.rendererFn = created.RendererFn;
    this.publishFn = created.PublishFn;
    this.apiReadFn = created.ApiReadFn;
    this.wsPushFn = created.WsPushFn;
    this.connFn = created.ConnFn;
    this.whatIfFn = created.WhatIfFn;
    this.functionsByName = created;
  }
}