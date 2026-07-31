/**
 * Observability — CloudWatch Log Groups, custom metric contracts, alarms, and optional X-Ray toggle
 *
 * §4.11, §19, §10.16, §17, §23, §26, TASK-075
 *
 * Provides per-function CloudWatch Log Groups, metric contract definitions,
 * latency/failure alarms, and an X-Ray tracing toggle for the ten application
 * runtime Lambdas. No IAM grants, no Lambda creation, no SSM, no KMS.
 *
 * IAM execution permissions for logs:PutLogEvents and xray:PutTraceSegments
 * are owned by TASK-076..083 and TASK-177..179.
 *
 * ─── Security boundaries (precise) ─────────────────────────────────────
 *
 * This construct creates:
 *   - 10 × AWS::Logs::LogGroup    (PERSONAL_AWS_DEV / COMPETITION_AWS only)
 *   -  2 × AWS::CloudWatch::Alarm (PERSONAL_AWS_DEV / COMPETITION_AWS only)
 *
 * This construct NEVER creates:
 *   - AWS::Lambda::Function
 *   - AWS::IAM::Role / ManagedPolicy
 *   - AWS::SNS::Topic / Subscription
 *   - AWS::Events::Rule
 *   - AWS::XRay::*
 *   - AWS::KMS::Key
 *   - AWS::CloudWatch::Dashboard
 *   - Any credentials or secret material
 *
 * LOCAL_MOCK: zero AWS resources (zero LogGroup, zero Alarm, zero X-Ray).
 *
 * ─── Metric contract (read-only infrastructure metadata) ─────────────────
 *
 * TASK-075 defines the contract infrastructure only:
 *   metricNamespace + metric names + units + periods.
 *
 * Actual metric emission (datapoints) is owned by:
 *   TASK-104, TASK-153, TASK-154, TASK-155.
 *
 * ─── Removal policy (per profile, §26) ────────────────────────────────
 *
 *   PERSONAL_AWS_DEV  → DeletionPolicy = Delete   (clean teardown)
 *   COMPETITION_AWS  → DeletionPolicy = Retain   (organizer-gated)
 *   LOCAL_MOCK       → 0 resources
 */

import { Construct } from 'constructs';
import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import {
  Alarm,
  ComparisonOperator,
  Metric,
  Statistic,
  TreatMissingData,
  Unit,
} from 'aws-cdk-lib/aws-cloudwatch';
import { ILogGroup, LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { CfnFunction, IFunction } from 'aws-cdk-lib/aws-lambda';
import type { EnvironmentContext } from '../env_context.js';
import { RUNTIME_LAMBDA_NAMES, type RuntimeLambdaName } from './lambdas.js';

// ─── Metric name constants ───────────────────────────────────────────────────

/** Fast-path latency metric — monitored against the 5 s TEAM_TARGET. */
export const METRIC_FAST_PATH_LATENCY_MS = 'FastPathLatencyMs';

/** End-to-end latency metric — monitored against the 60 s OFFICIAL deadline. */
export const METRIC_END_TO_END_LATENCY_MS = 'EndToEndLatencyMs';

/** Bedrock service failure count per evaluation period. */
export const METRIC_BEDROCK_FAILURE_COUNT = 'BedrockFailureCount';

/** Knowledge Base fallback trigger count. */
export const METRIC_KB_FALLBACK_COUNT = 'KbFallbackCount';

/** Schema validation rejection count. */
export const METRIC_SCHEMA_VALIDATION_REJECT_COUNT = 'SchemaValidationRejectCount';

/** WebSocket → polling fallback trigger count. */
export const METRIC_WS_TO_POLLING_FALLBACK_COUNT = 'WsToPollingFallbackCount';

/** Insufficient-data count (HTTP 200 with data_status=insufficient_data). */
export const METRIC_INSUFFICIENT_DATA_COUNT = 'InsufficientDataCount';

/** All metric names in canonical order. */
export const METRIC_NAMES: readonly string[] = Object.freeze([
  METRIC_FAST_PATH_LATENCY_MS,
  METRIC_END_TO_END_LATENCY_MS,
  METRIC_BEDROCK_FAILURE_COUNT,
  METRIC_KB_FALLBACK_COUNT,
  METRIC_SCHEMA_VALIDATION_REJECT_COUNT,
  METRIC_WS_TO_POLLING_FALLBACK_COUNT,
  METRIC_INSUFFICIENT_DATA_COUNT,
]);

/**
 * TEAM_TARGET for the Fast Path — 5 000 ms.
 *
 * This is a team-optimization target, NOT the official compliance threshold.
 * It is documented here so downstream runtime wiring (TASK-104) can emit it
 * correctly.
 */
export const TEAM_FAST_PATH_TARGET_MS = 5_000;

/**
 * OFFICIAL end-to-end hard deadline — 60 000 ms.
 *
 * Defined in §20 and REQ-004: event injection → complete Dashboard update
 * must complete within 60 seconds. This value is FIXED and cannot be overridden.
 */
export const OFFICIAL_END_TO_END_DEADLINE_MS = 60_000;

// ─── Valid log retention days ────────────────────────────────────────────────

/** CloudWatch log retention day values accepted by the construct. */
const VALID_RETENTION_DAYS: readonly RetentionDays[] = [
  RetentionDays.ONE_DAY,
  RetentionDays.THREE_DAYS,
  RetentionDays.FIVE_DAYS,
  RetentionDays.ONE_WEEK,
  RetentionDays.TWO_WEEKS,
  RetentionDays.ONE_MONTH,
  RetentionDays.TWO_MONTHS,
  RetentionDays.THREE_MONTHS,
  RetentionDays.FOUR_MONTHS,
  RetentionDays.FIVE_MONTHS,
  RetentionDays.SIX_MONTHS,
  RetentionDays.ONE_YEAR,
  RetentionDays.THIRTEEN_MONTHS,
  RetentionDays.EIGHTEEN_MONTHS,
  RetentionDays.TWO_YEARS,
  RetentionDays.THREE_YEARS,
  RetentionDays.FIVE_YEARS,
  RetentionDays.SEVEN_YEARS,
  RetentionDays.TEN_YEARS,
] as const;

// ─── Props ──────────────────────────────────────────────────────────────────

export interface ObservabilityConstructProps {
  /** TASK-059 typed environment context */
  readonly envContext: EnvironmentContext;

  /**
   * Map of runtime Lambda function name → concrete IFunction handle.
   *
   * Must contain exactly the ten canonical application runtime Lambdas
   * (InjectFn, WorkflowStatusFn, RecoveryGateFn, DecisionFn, RendererFn,
   *  PublishFn, ApiReadFn, WsPushFn, ConnFn, WhatIfFn).
   *
   * The construct obtains each function's CfnFunction default child and sets
   * LoggingConfig and TracingConfig on it. Imported functions (without a
   * concrete CfnFunction) will fail fast.
   *
   * No IngestionFn, no extra keys.
   */
  readonly runtimeFunctions: Readonly<Record<RuntimeLambdaName, IFunction>>;

  /**
   * CloudWatch metric namespace for all custom metrics.
   * Must be non-empty and contain no wildcard characters.
   */
  readonly metricNamespace: string;

  /**
   * Log group name prefix.
   *
   * The construct appends `/<function-name>` for each Lambda.
   * Must NOT start with `aws/` or `/aws/`.
   * Must NOT contain account IDs, region literals, or credential-like substrings.
   */
  readonly logGroupNamePrefix: string;

  /**
   * CloudWatch Logs retention period for all log groups.
   * Must be a valid `RetentionDays` value.
   */
  readonly logRetentionDays: RetentionDays;

  /**
   * Enable AWS X-Ray active tracing on all ten runtime Lambdas.
   * When `true`: TracingConfig.Mode = Active.
   * When `false`: TracingConfig.Mode = PassThrough.
   *
   * IAM permissions for xray:PutTraceSegments are owned by TASK-076..083.
   */
  readonly xrayEnabled: boolean;

  /**
   * Alarm name prefix. The construct appends a descriptive suffix.
   * Must be non-empty.
   */
  readonly alarmNamePrefix: string;

  /**
   * Bedrock failure count alarm threshold — fires when sum of failures
   * per evaluation period meets or exceeds this value.
   * Must be a non-negative number.
   */
  readonly bedrockFailureThreshold: number;

  /**
   * CloudWatch alarm evaluation period in seconds.
   * Must be one of: 10, 30, 60, 120, 180, 360, 720, 1440.
   */
  readonly alarmPeriodSeconds: number;

  /**
   * Number of consecutive periods that must breach before the alarm fires.
   * Must be a positive integer.
   */
  readonly evaluationPeriods: number;

  /**
   * Number of datapoints within `evaluationPeriods` that must breach
   * to trigger the alarm. Must be a positive integer and ≤ evaluationPeriods.
   */
  readonly datapointsToAlarm: number;
}

// ─── Validation ─────────────────────────────────────────────────────────────

function validateLogGroupNamePrefix(prefix: string): void {
  if (!prefix || typeof prefix !== 'string' || prefix.trim() === '') {
    throw new Error('ObservabilityConstruct: logGroupNamePrefix must be a non-empty string');
  }
  if (prefix.startsWith('aws/') || prefix.startsWith('/aws/')) {
    throw new Error(
      `ObservabilityConstruct: logGroupNamePrefix "${prefix}" must not start with "aws/" or "/aws/"`,
    );
  }
}

function validateMetricNamespace(ns: string): void {
  if (!ns || typeof ns !== 'string' || ns.trim() === '') {
    throw new Error('ObservabilityConstruct: metricNamespace must be a non-empty string');
  }
  if (ns.includes('*')) {
    throw new Error(`ObservabilityConstruct: metricNamespace must not contain wildcard characters`);
  }
}

function validateRuntimeFunctions(funcs: Readonly<Record<RuntimeLambdaName, IFunction>>): void {
  const providedKeys = new Set(Object.keys(funcs) as RuntimeLambdaName[]);
  for (const name of RUNTIME_LAMBDA_NAMES) {
    if (!providedKeys.has(name)) {
      throw new Error(
        `ObservabilityConstruct: missing required runtime Lambda "${name}" in runtimeFunctions`,
      );
    }
  }
  for (const name of Object.keys(funcs) as RuntimeLambdaName[]) {
    if (!RUNTIME_LAMBDA_NAMES.includes(name)) {
      throw new Error(
        `ObservabilityConstruct: unexpected runtime Lambda "${name}" in runtimeFunctions — only the ten canonical application Lambdas are allowed`,
      );
    }
  }
}

function validateRetention(days: RetentionDays): void {
  if (!VALID_RETENTION_DAYS.includes(days)) {
    throw new Error(
      `ObservabilityConstruct: logRetentionDays "${String(days)}" is not a valid CloudWatch Logs retention value`,
    );
  }
}

function validatePositiveInt(value: number, name: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`ObservabilityConstruct: ${name} must be a positive integer, got ${value}`);
  }
}

function validateAlarmPeriod(period: number): void {
  validatePositiveInt(period, 'alarmPeriodSeconds');
  const VALID_PERIODS = [10, 30, 60, 120, 180, 360, 720, 1440];
  if (!VALID_PERIODS.includes(period)) {
    throw new Error(
      `ObservabilityConstruct: alarmPeriodSeconds must be one of ${VALID_PERIODS.join(', ')}, got ${period}`,
    );
  }
}

function validateAlarmNamePrefix(prefix: string): void {
  if (!prefix || typeof prefix !== 'string' || prefix.trim() === '') {
    throw new Error('ObservabilityConstruct: alarmNamePrefix must be a non-empty string');
  }
}

function validateBedrockThreshold(threshold: number): void {
  if (!Number.isFinite(threshold) || threshold < 0) {
    throw new Error(
      `ObservabilityConstruct: bedrockFailureThreshold must be a non-negative number, got ${threshold}`,
    );
  }
}

function validateDatapoints(datapoints: number, periods: number): void {
  validatePositiveInt(datapoints, 'datapointsToAlarm');
  if (datapoints > periods) {
    throw new Error(
      `ObservabilityConstruct: datapointsToAlarm (${datapoints}) must be ≤ evaluationPeriods (${periods})`,
    );
  }
}

/**
 * Get the concrete CfnFunction default child from a Lambda IFunction.
 * Throws if the function does not have a CfnFunction child (e.g., imported).
 */
function requireCfnFunction(fn: IFunction, name: string): CfnFunction {
  const child = fn.node.defaultChild;
  if (!(child instanceof CfnFunction)) {
    throw new Error(
      `ObservabilityConstruct: runtimeFunctions["${name}"] does not have a concrete ` +
        `CfnFunction default child. Imported or VpcFunction handles cannot be ` +
        `configured here. Please provide a concrete lambda.Function instance.`,
    );
  }
  return child;
}

// ─── Construct ───────────────────────────────────────────────────────────────

export class ObservabilityConstruct extends Construct {
  /** One LogGroup per runtime Lambda (empty in LOCAL_MOCK). */
  public readonly logGroups: Readonly<Record<RuntimeLambdaName, ILogGroup>>;

  /** Count of LogGroup resources created (0 in LOCAL_MOCK). */
  public readonly logGroupCount: number;

  /** Count of Alarm resources created (0 in LOCAL_MOCK). */
  public readonly alarmCount: number;

  /** Canonical metric namespace. */
  public readonly metricNamespace: string;

  /** All metric names (exposed for downstream wiring). */
  public readonly metricNames: readonly string[];

  /** TEAM_TARGET Fast Path latency in ms (5 000). */
  public readonly teamFastPathTargetMs: number;

  /** OFFICIAL end-to-end hard deadline in ms (60 000). */
  public readonly officialEndToEndDeadlineMs: number;

  /** Alarm names (exposed for downstream wiring). */
  public readonly alarmNames: readonly string[];

  /** Whether X-Ray is enabled (determines tracing mode on all Lambdas). */
  public readonly xrayEnabled: boolean;

  public constructor(scope: Construct, id: string, props: ObservabilityConstructProps) {
    super(scope, id);

    const {
      envContext,
      runtimeFunctions,
      metricNamespace,
      logGroupNamePrefix,
      logRetentionDays,
      xrayEnabled,
      alarmNamePrefix,
      bedrockFailureThreshold,
      alarmPeriodSeconds,
      evaluationPeriods,
      datapointsToAlarm,
    } = props;

    // ── Validate all props before creating any resource ─────────────────────
    validateMetricNamespace(metricNamespace);
    validateLogGroupNamePrefix(logGroupNamePrefix);
    validateRetention(logRetentionDays);
    validateAlarmPeriod(alarmPeriodSeconds);
    validatePositiveInt(evaluationPeriods, 'evaluationPeriods');
    validateAlarmNamePrefix(alarmNamePrefix);
    validateBedrockThreshold(bedrockFailureThreshold);
    validateDatapoints(datapointsToAlarm, evaluationPeriods);

    this.metricNamespace = metricNamespace;
    this.metricNames = METRIC_NAMES as readonly string[];
    this.teamFastPathTargetMs = TEAM_FAST_PATH_TARGET_MS;
    this.officialEndToEndDeadlineMs = OFFICIAL_END_TO_END_DEADLINE_MS;
    this.xrayEnabled = xrayEnabled;

    // ── LOCAL_MOCK: zero resources ─────────────────────────────────────────
    if (envContext.isLocalMock) {
      this.logGroups = Object.freeze({}) as Readonly<Record<RuntimeLambdaName, ILogGroup>>;
      this.logGroupCount = 0;
      this.alarmCount = 0;
      this.alarmNames = Object.freeze([]);
      return;
    }

    // ── Validate runtimeFunctions for AWS profiles ──────────────────────────
    validateRuntimeFunctions(runtimeFunctions);

    // ── Removal policy ───────────────────────────────────────────────────
    const removalPolicy = envContext.isCompetition ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;

    // ── Build LogGroups ──────────────────────────────────────────────────
    const logGroupMap: Record<string, ILogGroup> = {};
    for (const fnName of RUNTIME_LAMBDA_NAMES) {
      const logGroupName = `${logGroupNamePrefix}/${fnName}`;
      const logGroup = new LogGroup(this, `LogGroup_${fnName}`, {
        logGroupName,
        retention: logRetentionDays,
        removalPolicy,
      });
      logGroupMap[fnName] = logGroup;
    }
    this.logGroups = Object.freeze({ ...logGroupMap }) as Readonly<
      Record<RuntimeLambdaName, ILogGroup>
    >;
    this.logGroupCount = Object.keys(logGroupMap).length;

    // ── Bind LogGroups and X-Ray to each Lambda's CfnFunction ──────────────
    // Run validation + binding after LogGroups are created so dependencies
    // can be established.
    for (const fnName of RUNTIME_LAMBDA_NAMES) {
      const fn = runtimeFunctions[fnName];
      const cfnFn = requireCfnFunction(fn, fnName);
      const logGroup = logGroupMap[fnName]!;

      // LoggingConfig: dedicated LogGroup, JSON format, INFO/WARN levels
      cfnFn.loggingConfig = {
        logGroup: logGroup.logGroupName,
        logFormat: 'JSON',
        applicationLogLevel: 'INFO',
        systemLogLevel: 'WARN',
      };

      // X-Ray toggle: Active or PassThrough
      cfnFn.tracingConfig = {
        mode: xrayEnabled ? 'Active' : 'PassThrough',
      };

      // Lambda must wait for its dedicated LogGroup to exist
      // to avoid the race condition where the function starts before
      // the log group is created.
      fn.node.addDependency(logGroup);
    }

    // ── Alarms ─────────────────────────────────────────────────────────

    const alarmPeriodDuration = Duration.seconds(alarmPeriodSeconds);

    // End-to-End latency alarm: fires when Maximum(EndToEndLatencyMs) > 60 000 ms
    // The OFFICIAL deadline threshold is FIXED at 60 000 ms and cannot be overridden.
    const endToEndMetric = new Metric({
      namespace: metricNamespace,
      metricName: METRIC_END_TO_END_LATENCY_MS,
      period: alarmPeriodDuration,
      statistic: Statistic.MAXIMUM,
      unit: Unit.MILLISECONDS,
    });

    const endToEndAlarm = new Alarm(this, 'EndToEndLatencyAlarm', {
      alarmName: `${alarmNamePrefix}-EndToEndLatencyMs-60s-OFFICIAL`,
      alarmDescription:
        'OFFICIAL 60-second end-to-end deadline breach. ' +
        'Events injected → Dashboard updated must complete within 60 s (REQ-004, §20). ' +
        'The 5-second Fast-Path target is for internal optimization only — ' +
        'this alarm enforces the OFFICIAL 60-second deadline.',
      metric: endToEndMetric,
      threshold: OFFICIAL_END_TO_END_DEADLINE_MS,
      comparisonOperator: ComparisonOperator.GREATER_THAN_THRESHOLD,
      treatMissingData: TreatMissingData.NOT_BREACHING,
      evaluationPeriods,
      datapointsToAlarm,
    });

    // Bedrock failure alarm: fires when Sum(BedrockFailureCount) >= threshold
    // per evaluation period. NOT a percentage rate.
    const bedrockMetric = new Metric({
      namespace: metricNamespace,
      metricName: METRIC_BEDROCK_FAILURE_COUNT,
      period: alarmPeriodDuration,
      statistic: Statistic.SUM,
    });

    const bedrockAlarm = new Alarm(this, 'BedrockFailureAlarm', {
      alarmName: `${alarmNamePrefix}-BedrockFailureCount-PerPeriod`,
      alarmDescription:
        'Bedrock service failure count meets or exceeds threshold per evaluation period. ' +
        'RendererFn and WhatIfFn invoke Bedrock. A high failure count warrants operator attention. ' +
        'Bedrock failures must not block the deterministic Fast Path. ' +
        'Actual fallback behavior is implemented in runtime (TASK-104, TASK-155).',
      metric: bedrockMetric,
      threshold: bedrockFailureThreshold,
      comparisonOperator: ComparisonOperator.GREATER_THAN_OR_EQUAL_TO_THRESHOLD,
      treatMissingData: TreatMissingData.NOT_BREACHING,
      evaluationPeriods,
      datapointsToAlarm,
    });

    this.alarmCount = 2;
    this.alarmNames = Object.freeze([endToEndAlarm.alarmName, bedrockAlarm.alarmName]);
  }
}
