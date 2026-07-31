/**
 * Step Functions launcher — InjectFn's hand-off to the decision workflow
 * (design §10.11e, §12, §15.2; TASK-087).
 *
 * Runs immediately after `acquireFirstLease` (TASK-086) or a staged recovery
 * re-lease (TASK-094) has put the record in `starting`. Its whole job is to get
 * one workflow execution running for the current attempt, or to record that it
 * could not.
 *
 * ## Three design points that are easy to get wrong
 *
 * **1. The execution name is not the deduplication mechanism.** §15.2 states
 * `workflow_execution_name` is traceability only; deduplication belongs to the
 * conditional `Put` on `idempotency_key` (TASK-086), which has already happened
 * by the time we get here. So the name is derived deterministically for
 * *debuggability* — you can compute it from a key and find the execution — and
 * `ExecutionAlreadyExistsException` is treated as success rather than as a
 * conflict. Relying on the name for dedup would be a second, weaker source of
 * truth for something already decided.
 *
 * **2. The name must include `attempt_count`.** A name derived from
 * `idempotency_key` alone would collide on every recovery attempt: attempt 2
 * would raise `ExecutionAlreadyExistsException` forever and the record could
 * never leave `starting`. Recovery would be permanently broken.
 *
 * **3. The payload carries `lease_owner` and `recovery_mode`, not a token.** This
 * design has no fencing token. MARK_RUNNING's guard (TASK-089) is
 * `status` + `lease_owner` + `attempt_count` + `recovery_mode`, and the workflow
 * can only supply those if they arrive as INPUT. The execution ARN — the other
 * half of the fencing pair — is stamped by MARK_RUNNING itself from
 * `$$.Execution.Id`, never passed in. Omitting `lease_owner` or `recovery_mode`
 * here would leave MARK_RUNNING unable to fence anything.
 *
 * ## Failure handling
 *
 * Any genuine start failure moves `starting → start_failed` (§15.2) so
 * `recoverFromStartFailed` (TASK-094) can re-lease immediately, rather than
 * leaving the record to sit in `starting` until its lease TTL expires. The
 * caller always receives {@link WorkflowStartFailedError} (503, retryable) — the
 * status write is best-effort and never replaces the original cause.
 *
 * @module backend/inject/sfn_launcher
 */

import { createHash } from 'node:crypto';
import { ExecutionAlreadyExists, SFNClient, StartExecutionCommand } from '@aws-sdk/client-sfn';
import { IdempotencyStatus, RecoveryMode, RecoveryStage } from '@city-commander/shared-schemas';
import { WorkflowStartFailedError } from '../errors/domain_error.js';
import { isTransientError } from '../errors/transient.js';
import { NoopTelemetry } from '../metrics/telemetry_facade.js';
import { observeIfThrottled, observeInFlightRerequest } from '../metrics/telemetry_observers.js';
import type { Telemetry } from '../metrics/telemetry_facade.js';
import type { IdempotencyRepository } from '../repository/idempotency_repository.js';

/** Config key holding the workflow ARN, supplied by CDK output (TASK-066). */
export const STATE_MACHINE_ARN_KEY = 'orchestration.state_machine_arn';

/** AWS limit: `StartExecution` names are at most 80 characters. */
export const MAX_EXECUTION_NAME_LENGTH = 80;

/** Characters AWS accepts in an execution name, after our own sanitisation. */
const EXECUTION_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,80}$/;

/** Hex digits of the identity digest kept in the name. */
const DIGEST_LENGTH = 16;

const NAME_PREFIX = 'dec-';

/**
 * Minimal structural view of `ConfigProvider`.
 *
 * Declared here rather than importing `@city-commander/config` so the launcher
 * stays decoupled from the config package's construction path; any
 * `ConfigProvider` satisfies it.
 */
export interface ConfigReader {
  get(key: string): string | number | boolean | readonly string[];
}

/** Everything the workflow needs as INPUT (§10.11e). */
export interface WorkflowLaunchInput {
  readonly idempotencyKey: string;
  readonly decisionId: string;
  /** Current attempt; 1 for the first lease, incremented by recovery. */
  readonly attemptCount: number;
  /** Lease holder (request id). MARK_RUNNING fences on this. */
  readonly leaseOwner: string;
  /** Decides whether DecisionFn re-runs. MARK_RUNNING fences on this. */
  readonly recoveryMode: RecoveryMode;
  /** Request receipt time, for latency attribution. */
  readonly requestTimestamp: string;
  /**
   * Correlation id, read by EIGHT states in `workflow.asl.json`.
   *
   * Omitting it does not degrade anything — under JSONPath, `"trace_id.$":
   * "$.trace_id"` raises a non-retryable `States.Runtime` the moment
   * `RUN_DECISION` is entered, so every injection fails while looking like a
   * DecisionFn fault.
   */
  readonly traceId: string;
  /**
   * Narrative types already known to be missing, for `RECOVERY_GATE`.
   *
   * Defaults to `[]`. `RecoveryGateFn` computes this itself by querying the
   * narrative table, so the value is advisory; the field exists because the ASL
   * reads `$.missing_narrative_types` unconditionally on the `ENRICHMENT_ONLY`
   * path and a missing path is a hard failure.
   */
  readonly missingNarrativeTypes?: readonly string[];
}

/** The JSON payload handed to Step Functions. Snake_case to match the ASL. */
export interface WorkflowExecutionPayload {
  readonly idempotency_key: string;
  readonly decision_id: string;
  readonly attempt_count: number;
  readonly lease_owner: string;
  readonly recovery_mode: RecoveryMode;
  readonly request_timestamp: string;
  readonly trace_id: string;
  readonly missing_narrative_types: readonly string[];
}

/** Result of a launch attempt. Failures throw instead of returning. */
export type SfnLaunchResult =
  | {
      readonly outcome: 'STARTED';
      readonly executionName: string;
      /** ARN reported by AWS. MARK_RUNNING stamps the authoritative one. */
      readonly executionArn: string;
    }
  | {
      readonly outcome: 'ALREADY_STARTED';
      readonly executionName: string;
      /**
       * AWS does not return an ARN for this case, and the launcher must not
       * invent one. MARK_RUNNING records the real ARN from `$$.Execution.Id`.
       */
      readonly executionArn: null;
    };

/** Clock and status-write dependencies. */
export interface SfnLauncherOptions {
  readonly config: ConfigReader;
  readonly sfnClient: SFNClient;
  /** Used only to record `start_failed`; the launcher never reads the record. */
  readonly repository: IdempotencyRepository;
  /** `updated_at` display value (UTC+8, `YYYY-MM-DD HH:MM`). */
  readonly nowDisplay: string;
  readonly nowEpochMs: number;
  /** Reported when the `start_failed` write itself fails. Never throws. */
  readonly onStatusWriteError?: (error: unknown) => void;
  /**
   * Telemetry sink (TASK-158). Defaults to {@link NoopTelemetry}, so tests and
   * `LOCAL_MOCK` need no EMF plumbing and the call sites below stay unconditional.
   */
  readonly telemetry?: Telemetry;
}

/** Thrown for programming errors, never for AWS or configuration faults. */
export class SfnLauncherUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SfnLauncherUsageError';
  }
}

/** Replace every character AWS forbids, then collapse the runs. */
function sanitizeSegment(value: string): string {
  return value
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^_+|_+$/g, '');
}

/**
 * Derive a deterministic, AWS-legal execution name.
 *
 * Shape: `dec-{readable}-a{attempt}-{sha256(key#attempt)[0:16]}`
 *
 * The readable segment is a sanitised, truncated `idempotency_key` so a human
 * can recognise the execution in the console. Truncation cannot cause a
 * collision because the digest is taken over the FULL key plus the attempt, and
 * the attempt appears literally so recovery always gets a fresh name.
 *
 * @example
 * ```ts
 * deriveExecutionName('TPE_2026_ACC_001|2026-05-20 22:10|prov-2026a', 1);
 * // 'dec-TPE_2026_ACC_001_2026-05-20_22_10_prov-2026a-a1-3f2c...'
 * ```
 */
export function deriveExecutionName(idempotencyKey: string, attemptCount: number): string {
  if (!idempotencyKey) {
    throw new SfnLauncherUsageError('deriveExecutionName requires a non-empty "idempotencyKey".');
  }
  if (!Number.isInteger(attemptCount) || attemptCount < 1) {
    throw new SfnLauncherUsageError(
      `deriveExecutionName requires a positive integer "attemptCount"; received ${String(
        attemptCount,
      )}.`,
    );
  }

  const digest = createHash('sha256')
    .update(`${idempotencyKey}#${attemptCount}`)
    .digest('hex')
    .slice(0, DIGEST_LENGTH);
  const suffix = `-a${attemptCount}-${digest}`;
  const budget = MAX_EXECUTION_NAME_LENGTH - NAME_PREFIX.length - suffix.length;
  const readable = budget > 0 ? sanitizeSegment(idempotencyKey).slice(0, budget) : '';
  const name = `${NAME_PREFIX}${readable}${suffix}`;

  if (!EXECUTION_NAME_PATTERN.test(name)) {
    // Unreachable by construction. Failing loudly beats letting AWS reject a
    // name we believed was legal.
    throw new SfnLauncherUsageError(`Derived execution name is not AWS-legal: "${name}".`);
  }
  return name;
}

/**
 * Assemble the workflow INPUT.
 *
 * Every field here is read by at least one state in `workflow.asl.json`.
 * `WORKFLOW_INPUT_JSONPATHS` (TASK-097) enumerates those paths and a test asserts
 * this function covers all of them — a missing field is a runtime failure in
 * Step Functions, not a type error, so the coverage has to be pinned by a test.
 */
export function buildExecutionPayload(input: WorkflowLaunchInput): WorkflowExecutionPayload {
  return {
    idempotency_key: input.idempotencyKey,
    decision_id: input.decisionId,
    attempt_count: input.attemptCount,
    lease_owner: input.leaseOwner,
    recovery_mode: input.recoveryMode,
    request_timestamp: input.requestTimestamp,
    trace_id: input.traceId,
    missing_narrative_types: input.missingNarrativeTypes ?? [],
  };
}

/**
 * Read the state machine ARN from config.
 *
 * @returns the trimmed ARN, or `null` when unset, blank or not a string.
 *   Absent config is a deployment condition, not an exception — the caller
 *   decides how to surface it.
 */
export function resolveStateMachineArn(config: ConfigReader): string | null {
  let raw: string | number | boolean | readonly string[];
  try {
    raw = config.get(STATE_MACHINE_ARN_KEY);
  } catch {
    // `orchestration.state_machine_arn` is optional in the schema, so a missing
    // key throws ConfigKeyMissingError. That is "unset", not a failure.
    return null;
  }
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Launches the decision workflow for the attempt currently holding the lease.
 *
 * @example
 * ```ts
 * const launcher = new SfnLauncher({ config, sfnClient, repository, ...clock });
 * const result = await launcher.launch({
 *   idempotencyKey,
 *   decisionId,
 *   attemptCount: 1,
 *   leaseOwner: requestId,
 *   recoveryMode: RecoveryMode.NORMAL,
 *   requestTimestamp: '2026-05-20 22:10',
 * });
 * ```
 */
export class SfnLauncher {
  private readonly telemetry: Telemetry;

  constructor(private readonly options: SfnLauncherOptions) {
    this.telemetry = options.telemetry ?? new NoopTelemetry();
  }

  /**
   * Start one execution for this attempt.
   *
   * @returns `STARTED`, or `ALREADY_STARTED` when this exact
   *   (`idempotency_key`, `attempt_count`) pair was already launched — the
   *   at-least-once safe outcome, which the caller maps to 202.
   * @throws WorkflowStartFailedError (503, retryable) on any real failure,
   *   including an unset ARN. The record is moved to `start_failed` first.
   */
  async launch(input: WorkflowLaunchInput): Promise<SfnLaunchResult> {
    this.assertUsable(input);

    const executionName = deriveExecutionName(input.idempotencyKey, input.attemptCount);
    const stateMachineArn = resolveStateMachineArn(this.options.config);

    if (stateMachineArn === null) {
      // Retrying cannot help until the deployment supplies the ARN, so the record
      // is marked non-retryable even though the HTTP error is a 503.
      await this.markStartFailed(input, 'STATE_MACHINE_ARN_NOT_CONFIGURED', false);
      throw new WorkflowStartFailedError(
        input.decisionId,
        `Cannot start the decision workflow: "${STATE_MACHINE_ARN_KEY}" is not configured.`,
      );
    }

    try {
      const response = await this.options.sfnClient.send(
        new StartExecutionCommand({
          stateMachineArn,
          name: executionName,
          input: JSON.stringify(buildExecutionPayload(input)),
        }),
      );

      if (response.executionArn === undefined) {
        // A success response without an ARN is not something to paper over with
        // a placeholder; treat it as a start failure.
        await this.markStartFailed(input, 'START_EXECUTION_MISSING_ARN', true);
        throw new WorkflowStartFailedError(
          input.decisionId,
          `StartExecution returned no executionArn for "${executionName}".`,
        );
      }

      return { outcome: 'STARTED', executionName, executionArn: response.executionArn };
    } catch (error: unknown) {
      if (error instanceof ExecutionAlreadyExists) {
        // Same key AND same attempt: a retried InjectFn invocation. The workflow
        // is already running, so this is success, not a conflict. Marking
        // start_failed here would sabotage a healthy execution.
        observeInFlightRerequest(this.telemetry, {
          decisionId: input.decisionId,
          idempotencyKey: input.idempotencyKey,
          attemptCount: input.attemptCount,
        });
        return { outcome: 'ALREADY_STARTED', executionName, executionArn: null };
      }
      if (error instanceof WorkflowStartFailedError) throw error;

      // Only genuine throttling increments ThrottlingEventCount; a bad ARN must
      // not read as a capacity problem.
      observeIfThrottled(this.telemetry, error, 'STEP_FUNCTIONS', {
        decisionId: input.decisionId,
        idempotencyKey: input.idempotencyKey,
        attemptNumber: input.attemptCount,
      });

      const retryable = isTransientError(error);
      await this.markStartFailed(input, describeStartFailure(error), retryable);
      throw new WorkflowStartFailedError(
        input.decisionId,
        `StartExecution failed for "${executionName}".`,
        { cause: error },
      );
    }
  }

  private assertUsable(input: WorkflowLaunchInput): void {
    if (!input.idempotencyKey) {
      throw new SfnLauncherUsageError('launch requires a non-empty "idempotencyKey".');
    }
    if (!input.decisionId) {
      throw new SfnLauncherUsageError('launch requires a non-empty "decisionId".');
    }
    if (!input.leaseOwner) {
      // Without it MARK_RUNNING cannot fence, so an empty value is a bug, not a
      // recoverable condition.
      throw new SfnLauncherUsageError('launch requires a non-empty "leaseOwner".');
    }
    if (!input.traceId) {
      // An empty string still satisfies `$.trace_id`, so this would not fail the
      // workflow — it would silently produce uncorrelatable logs for the entire
      // execution, which §19 exists to prevent.
      throw new SfnLauncherUsageError('launch requires a non-empty "traceId".');
    }
  }

  /**
   * Move `starting → start_failed` (§15.2).
   *
   * Best-effort: a failure here is reported through `onStatusWriteError` and
   * swallowed, so the caller still sees the original start failure. If the guard
   * rejects — another attempt already took the lease — there is nothing to do.
   */
  private async markStartFailed(
    input: WorkflowLaunchInput,
    lastError: string,
    retryable: boolean,
  ): Promise<void> {
    try {
      await this.options.repository.conditionalUpdateState({
        idempotencyKey: input.idempotencyKey,
        guard: {
          status: IdempotencyStatus.starting,
          lease_owner: input.leaseOwner,
          attempt_count: input.attemptCount,
        },
        mutation: {
          set: {
            status: IdempotencyStatus.start_failed,
            last_error: lastError,
            retryable,
            // The lease is released immediately so recovery need not wait for the
            // TTL to lapse.
            lease_expires_at: this.options.nowEpochMs,
            // The workflow never ran, so no core can exist.
            recovery_stage: RecoveryStage.FULL_WORKFLOW,
            updated_at: this.options.nowDisplay,
          },
        },
      });
    } catch (error: unknown) {
      this.options.onStatusWriteError?.(error);
    }
  }
}

/** Stable, low-cardinality description of a start failure for `last_error`. */
function describeStartFailure(error: unknown): string {
  if (error instanceof Error && error.name) return `START_EXECUTION_FAILED:${error.name}`;
  return 'START_EXECUTION_FAILED';
}
