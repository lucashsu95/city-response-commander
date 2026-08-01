/**
 * ASL wiring — the seam between `infra/statemachine/workflow.asl.json` and the
 * guarded transitions (design §4.6, §6, §15.2, Figure 8; TASK-097).
 *
 * The state machine is a JSON file that member 3 owns (TASK-068) and the AWS
 * runtime interprets. Nothing in TypeScript can make a JSONPath reference
 * type-check. So the contract between the two is asserted here instead:
 *
 *  - {@link WORKFLOW_INPUT_JSONPATHS} enumerates every `$.x` the ASL reads from
 *    the execution INPUT, and a test asserts `buildExecutionPayload()` covers all
 *    of them. This is the regression guard for the failure mode that actually
 *    happened: `$.trace_id` was read by eight states and produced by none, which
 *    typechecked, passed every unit test, and would have failed 100% of injections
 *    at `RUN_DECISION` with a non-retryable `States.Runtime`.
 *  - {@link nextStateForRecoveryMode} and {@link nextStateForCoreWriteStatus}
 *    mirror the two `Choice` states in TypeScript, so a divergence between the ASL
 *    and this package is detectable by a test rather than by a failed demo.
 *  - {@link dispatchWorkflowStatusAction} maps each `action` the ASL sends to the
 *    guarded transition that implements it.
 *
 * ## Field naming
 *
 * The ASL is not internally consistent: `MARK_RUNNING` sends the execution ARN as
 * `workflow_execution_arn`, every other action sends it as `execution_id`. Both
 * carry `$$.Execution.Id`, which despite its name IS the execution ARN. The
 * dispatcher accepts either rather than requiring member 3 to re-cut the ASL, and
 * {@link resolveExecutionArn} is the single place that knows this.
 *
 * @module backend/workflow/wiring
 */

import { CoreWriteStatus, EvidenceSource, RecoveryMode } from '@city-commander/shared-schemas';
import { SKIPPED_INSUFFICIENT_DATA } from '../decision/decision_fn.js';
import type { CoreWriteGateValue } from '../decision/decision_fn.js';
import { markCompleted } from './mark_completed.js';
import { markCoreCommitted } from './mark_core_committed.js';
import { markProcessingFailed } from './mark_processing_failed.js';
import { markRunning } from './mark_running.js';
import { reconcileStaleRunning } from './reconcile_stale_running.js';
import type { ApplyOrConfirmOutcome, IdempotencyStateStore } from './apply_or_confirm.js';
import type { WorkflowStatusInput } from './status_context.js';

// ─── INPUT contract ────────────────────────────────────────

/**
 * Every JSONPath `workflow.asl.json` reads from the execution INPUT.
 *
 * Derived by reading the ASL, state by state. Kept as data so a test can assert
 * coverage; a comment would not have caught the missing `trace_id`.
 *
 * | Path | States that read it |
 * | --- | --- |
 * | `$.idempotency_key` | MARK_RUNNING, RUN_DECISION, RECOVERY_GATE, all PREPARE_*, all MARK_* |
 * | `$.decision_id` | as above, plus all PUBLISH_* |
 * | `$.attempt_count` | as above, plus ENRICHMENT_PARALLEL |
 * | `$.lease_owner` | MARK_RUNNING, RUN_DECISION |
 * | `$.recovery_mode` | MARK_RUNNING, SELECT_RECOVERY_MODE, RUN_DECISION, RECOVERY_GATE, ENRICHMENT_PARALLEL ×3 |
 * | `$.request_timestamp` | MARK_RUNNING |
 * | `$.trace_id` | RUN_DECISION, RECOVERY_GATE, PUBLISH_FAST_PATH_READY, PUBLISH_PROCESSING_FAILED, PUBLISH_ENRICHED, ENRICHMENT_PARALLEL ×3 |
 * | `$.missing_narrative_types` | RECOVERY_GATE |
 *
 * `$.last_error`, `$.retryable` and `$.recovery_stage` are deliberately absent:
 * the `PREPARE_*` Pass states produce them mid-execution, so they are not INPUT.
 */
export const WORKFLOW_INPUT_JSONPATHS: readonly string[] = [
  '$.idempotency_key',
  '$.decision_id',
  '$.attempt_count',
  '$.lease_owner',
  '$.recovery_mode',
  '$.request_timestamp',
  '$.trace_id',
  '$.missing_narrative_types',
];

/** Strip the `$.` prefix, giving the payload key a path refers to. */
export function jsonPathToField(jsonPath: string): string {
  return jsonPath.startsWith('$.') ? jsonPath.slice(2) : jsonPath;
}

// ─── Choice translation ────────────────────────────────────

/** State names in `workflow.asl.json`, as the ASL spells them. */
export const AslState = {
  MARK_RUNNING: 'MARK_RUNNING',
  SELECT_RECOVERY_MODE: 'SELECT_RECOVERY_MODE',
  RUN_DECISION: 'RUN_DECISION',
  RECOVERY_GATE: 'RECOVERY_GATE',
  DECISION_CORE_WRITE_GATE: 'DECISION_CORE_WRITE_GATE',
  MARK_CORE_COMMITTED_DECISION: 'MARK_CORE_COMMITTED_DECISION',
  PREPARE_CORE_IDENTITY_CONFLICT: 'PREPARE_CORE_IDENTITY_CONFLICT',
  PREPARE_UNKNOWN_CORE_WRITE_STATUS: 'PREPARE_UNKNOWN_CORE_WRITE_STATUS',
  PREPARE_INVALID_RECOVERY_MODE: 'PREPARE_INVALID_RECOVERY_MODE',
  MARK_PROCESSING_FAILED_TERMINAL: 'MARK_PROCESSING_FAILED_TERMINAL',
  PUBLISH_PROCESSING_FAILED: 'PUBLISH_PROCESSING_FAILED',
  FAIL_CORE_IDENTITY_CONFLICT: 'FAIL_CORE_IDENTITY_CONFLICT',
} as const;

/** A state name in the ASL. */
export type AslStateName = (typeof AslState)[keyof typeof AslState];

/**
 * `SELECT_RECOVERY_MODE` translated (branch 2 and 3 of the routing contract).
 *
 * `NORMAL` and `FULL_WORKFLOW` both re-run `DecisionFn`; `ENRICHMENT_ONLY` must
 * NOT, because a core is already committed and re-running would attempt to
 * overwrite an immutable record. Anything else is a malformed INPUT and is routed
 * to a terminal failure rather than being guessed at.
 */
export function nextStateForRecoveryMode(recoveryMode: string): AslStateName {
  switch (recoveryMode) {
    case RecoveryMode.NORMAL:
    case RecoveryMode.FULL_WORKFLOW:
      return AslState.RUN_DECISION;
    case RecoveryMode.ENRICHMENT_ONLY:
      return AslState.RECOVERY_GATE;
    default:
      return AslState.PREPARE_INVALID_RECOVERY_MODE;
  }
}

/**
 * `DECISION_CORE_WRITE_GATE` translated (branch 4 of the routing contract).
 *
 * `COMMITTED` and `ALREADY_COMMITTED_SAME_DECISION` are both success — the second
 * is an at-least-once retry landing on its own write — so both proceed to the
 * checkpoint. `CORE_IDENTITY_CONFLICT` goes to the terminal publish path and
 * never reaches enrichment or `MARK_COMPLETED`.
 *
 * ⚠️ `SKIPPED_INSUFFICIENT_DATA` currently has NO matching `Choices` entry in
 * `workflow.asl.json`, so at runtime it still falls into the ASL `Default` and is
 * recorded as `UNKNOWN_CORE_WRITE_STATUS` with `retryable: false`. This function
 * returns the state the ASL WILL take, not the one it should — see
 * {@link ASL_GAP_INSUFFICIENT_DATA_BRANCH}.
 */
export function nextStateForCoreWriteStatus(status: CoreWriteGateValue): AslStateName {
  switch (status) {
    case CoreWriteStatus.COMMITTED:
    case CoreWriteStatus.ALREADY_COMMITTED_SAME_DECISION:
      return AslState.MARK_CORE_COMMITTED_DECISION;
    case CoreWriteStatus.CORE_IDENTITY_CONFLICT:
      return AslState.PREPARE_CORE_IDENTITY_CONFLICT;
    default:
      // Includes SKIPPED_INSUFFICIENT_DATA until the ASL gains its branch.
      return AslState.PREPARE_UNKNOWN_CORE_WRITE_STATUS;
  }
}

/**
 * The ASL change still required for a disclosed data gap to be routed correctly.
 *
 * Exported so a test pins it: the day member 3 adds the branch, that test fails
 * and this constant gets deleted, rather than the gap being forgotten.
 */
export const ASL_GAP_INSUFFICIENT_DATA_BRANCH = {
  state: AslState.DECISION_CORE_WRITE_GATE,
  missingChoiceValue: SKIPPED_INSUFFICIENT_DATA,
  currentBehaviour: AslState.PREPARE_UNKNOWN_CORE_WRITE_STATUS,
  consequence:
    'A disclosed data gap is recorded as UNKNOWN_CORE_WRITE_STATUS with retryable=false, ' +
    'so it can never be retried even after the official data is corrected (§21).',
} as const;

// ─── Payloads, verbatim from the ASL ───────────────────────

/** Fields every `WorkflowStatusFn` payload carries. */
interface AslStatusPayloadBase {
  readonly idempotency_key: string;
  readonly decision_id: string;
  readonly attempt_count: number;
  /** `MARK_RUNNING` spells the execution ARN this way. */
  readonly workflow_execution_arn?: string;
  /** Every other action spells it this way. Same `$$.Execution.Id` value. */
  readonly execution_id?: string;
}

/** `MARK_RUNNING` payload. */
export interface AslMarkRunningPayload extends AslStatusPayloadBase {
  readonly action: 'MARK_RUNNING';
  readonly lease_owner: string;
  readonly recovery_mode: string;
  readonly request_timestamp?: string;
}

/** `MARK_CORE_COMMITTED` payload, from either the decision or recovery branch. */
export interface AslMarkCoreCommittedPayload extends AslStatusPayloadBase {
  readonly action: 'MARK_CORE_COMMITTED';
  readonly evidence_source: string;
}

/** `MARK_COMPLETED` payload. */
export interface AslMarkCompletedPayload extends AslStatusPayloadBase {
  readonly action: 'MARK_COMPLETED';
}

/** `MARK_PROCESSING_FAILED` payload, from any `PREPARE_*` state. */
export interface AslMarkProcessingFailedPayload extends AslStatusPayloadBase {
  readonly action: 'MARK_PROCESSING_FAILED';
  readonly last_error: string;
  readonly terminal?: boolean;
  readonly retryable?: boolean;
  /** `NONE` | `FULL_WORKFLOW` | `ENRICHMENT_ONLY`, decided by the PREPARE state. */
  readonly recovery_stage?: string;
}

/**
 * `RECONCILE_STALE_RUNNING` payload.
 *
 * Not reachable from `workflow.asl.json`, and that is correct: reconciliation is
 * driven by a NEW request discovering a stale `running` record (TASK-092), from
 * outside the crashed execution. Included because it is a `WorkflowStatusFn`
 * action (§10.11e) and the function must handle it.
 */
export interface AslReconcileStaleRunningPayload {
  readonly action: 'RECONCILE_STALE_RUNNING';
  readonly idempotency_key: string;
  readonly expected_stale_execution_arn: string;
  readonly expected_attempt: number;
  readonly observed_running_deadline_at: number;
  readonly effective_core_committed: boolean;
}

/** Any payload `WorkflowStatusFn` may receive. */
export type AslWorkflowStatusPayload =
  | AslMarkRunningPayload
  | AslMarkCoreCommittedPayload
  | AslMarkCompletedPayload
  | AslMarkProcessingFailedPayload
  | AslReconcileStaleRunningPayload;

/** Raised for a payload the state machine should never produce. */
export class AslPayloadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AslPayloadError';
  }
}

/**
 * Resolve the execution ARN from either spelling.
 *
 * @throws AslPayloadError when neither is present — fencing is impossible without
 *   it, and defaulting would make every guard match by accident
 */
export function resolveExecutionArn(payload: AslStatusPayloadBase): string {
  const arn = payload.workflow_execution_arn ?? payload.execution_id;
  if (arn === undefined || arn.length === 0) {
    throw new AslPayloadError(
      'WorkflowStatusFn payload carries neither "workflow_execution_arn" nor "execution_id"; ' +
        'the execution cannot be fenced.',
    );
  }
  return arn;
}

/** Clock and configuration the ASL does not carry in its payloads. */
export interface WiringContext {
  readonly nowEpochMs: number;
  /** `YYYY-MM-DD HH:MM`, Asia/Taipei. */
  readonly nowDisplay: string;
  /** Staleness budget stamped by MARK_RUNNING. From config, not from the ASL. */
  readonly executionDeadlineMs: number;
}

function statusInputFrom(
  payload: AslStatusPayloadBase & {
    readonly lease_owner?: string;
    readonly recovery_mode?: string;
  },
): WorkflowStatusInput {
  return {
    idempotencyKey: payload.idempotency_key,
    decisionId: payload.decision_id,
    attemptCount: payload.attempt_count,
    // Only MARK_RUNNING guards on these; the later actions fence on
    // (execution ARN, attempt) alone, so the ASL correctly omits them and the
    // empty string is never read.
    leaseOwner: payload.lease_owner ?? '',
    recoveryMode: (payload.recovery_mode ?? RecoveryMode.NORMAL) as RecoveryMode,
  };
}

function parseEvidenceSource(value: string): EvidenceSource {
  if (value === EvidenceSource.DECISIONFN_COMMITTED) return EvidenceSource.DECISIONFN_COMMITTED;
  if (value === EvidenceSource.RECOVERY_GATE_CORE_EXISTS) {
    return EvidenceSource.RECOVERY_GATE_CORE_EXISTS;
  }
  // The flag is only trustworthy with its evidence (§10.11e), so an unrecognised
  // source is refused rather than silently recorded as the common case.
  throw new AslPayloadError(`Unrecognised evidence_source "${value}".`);
}

/**
 * Dispatch one `WorkflowStatusFn` invocation to its guarded transition.
 *
 * @throws AslPayloadError for a malformed payload; every other outcome is a
 *   {@link ApplyOrConfirmOutcome}, including `FENCED_STALE_EXECUTION`, which is a
 *   result rather than an error
 *
 * @example
 * ```ts
 * export const handler = async (payload: AslWorkflowStatusPayload) =>
 *   dispatchWorkflowStatusAction(store, payload, {
 *     nowEpochMs: Date.now(),
 *     nowDisplay: formatTaipeiDisplay(Date.now()),
 *     executionDeadlineMs: Number(config.get('workflow.execution_deadline_ms')),
 *   });
 * ```
 */
export async function dispatchWorkflowStatusAction(
  store: IdempotencyStateStore,
  payload: AslWorkflowStatusPayload,
  context: WiringContext,
): Promise<ApplyOrConfirmOutcome> {
  switch (payload.action) {
    case 'MARK_RUNNING':
      return markRunning(store, statusInputFrom(payload), {
        executionArn: resolveExecutionArn(payload),
        nowEpochMs: context.nowEpochMs,
        nowDisplay: context.nowDisplay,
        executionDeadlineMs: context.executionDeadlineMs,
      });

    case 'MARK_CORE_COMMITTED':
      return markCoreCommitted(store, statusInputFrom(payload), {
        executionArn: resolveExecutionArn(payload),
        nowEpochMs: context.nowEpochMs,
        nowDisplay: context.nowDisplay,
        evidenceSource: parseEvidenceSource(payload.evidence_source),
      });

    case 'MARK_COMPLETED':
      return markCompleted(store, statusInputFrom(payload), {
        executionArn: resolveExecutionArn(payload),
        nowEpochMs: context.nowEpochMs,
        nowDisplay: context.nowDisplay,
      });

    case 'MARK_PROCESSING_FAILED':
      return markProcessingFailed(store, statusInputFrom(payload), {
        executionArn: resolveExecutionArn(payload),
        nowEpochMs: context.nowEpochMs,
        nowDisplay: context.nowDisplay,
        lastError: payload.last_error,
        // `markProcessingFailed` derives `recovery_stage` from this rather than
        // trusting the ASL's own value, so the two must agree.
        effectiveCoreCommitted: payload.recovery_stage === 'ENRICHMENT_ONLY',
        // D3 resolved: the ASL's assertion is now authoritative in the narrowing
        // direction only. `PREPARE_INVALID_RECOVERY_MODE` and
        // `PREPARE_UNKNOWN_CORE_WRITE_STATUS` send `retryable: false` and the record
        // is written terminal; an explicit `true` still cannot widen
        // CORE_IDENTITY_CONFLICT (FIX 1).
        ...(payload.retryable === undefined ? {} : { retryableOverride: payload.retryable }),
      });

    case 'RECONCILE_STALE_RUNNING':
      return reconcileStaleRunning(store, {
        idempotencyKey: payload.idempotency_key,
        expectedStaleExecutionArn: payload.expected_stale_execution_arn,
        expectedAttempt: payload.expected_attempt,
        observedRunningDeadlineAt: payload.observed_running_deadline_at,
        effectiveCoreCommitted: payload.effective_core_committed,
        nowEpochMs: context.nowEpochMs,
        nowDisplay: context.nowDisplay,
      });
  }
}

/**
 * The `retryable` dual-source problem, and how it was closed (review item D3).
 *
 * The `PREPARE_*` states assert `retryable` explicitly, but `markProcessingFailed`
 * ALSO derived it from `lastError` — so for `INVALID_RECOVERY_MODE` and
 * `UNKNOWN_CORE_WRITE_STATUS` the ASL said `false` and the Lambda wrote `true`,
 * and the record ended up claiming a malformed INPUT was worth retrying.
 *
 * Resolved by making the ASL authoritative in the NARROWING direction only:
 * {@link dispatchWorkflowStatusAction} forwards `payload.retryable` as
 * `retryableOverride`, an explicit `false` writes a terminal record, and an
 * explicit `true` is ignored so no caller can make `CORE_IDENTITY_CONFLICT`
 * retryable. Kept as an exported record so the reasoning survives the diff.
 */
export const ASL_DIVERGENCE_PROCESSING_FAILED_RETRYABLE = {
  reviewItem: 'D3',
  status: 'RESOLVED',
  affectedStates: [
    AslState.PREPARE_INVALID_RECOVERY_MODE,
    AslState.PREPARE_UNKNOWN_CORE_WRITE_STATUS,
  ],
  aslAsserts: { retryable: false },
  lambdaWrites: { retryable: false },
  resolution:
    'dispatchWorkflowStatusAction forwards payload.retryable as retryableOverride; ' +
    'markProcessingFailed treats an explicit false as terminal (recovery_stage=NONE) and ' +
    'ignores an explicit true, so the override can only narrow, never widen (FIX 1 preserved).',
} as const;

// ─── Open ASL gaps (review items D1, D2) ───────────────────
//
// Both live in `infra/statemachine/workflow.asl.json`, which Matrix 8 assigns to
// TASK-068 (member 3) as owner with TASK-097 as integration task — an ownership
// overlap that has to be settled before either is edited. Recorded as exported
// constants rather than TODO comments so a test can pin them and the fix deletes
// the constant instead of hoping someone greps for it.
//
//   D1 → ASL_GAP_INSUFFICIENT_DATA_BRANCH   (declared above, near the Choice map)
//   D2 → ASL_GAP_PASS_STATE_DROPS_TRACE_ID  (below)
//
// Neither is reachable in the demo path: ADR-015 locks the official CSV bytes, so
// ingestion cannot report `insufficient_data` (D1's trigger) and DecisionFn cannot
// hit an identity conflict against a freshly-provisioned table (D2's trigger).
// They are correctness gaps for the recovery paths, not demo blockers.

/**
 * D2 — the `PREPARE_*` Pass states silently drop `trace_id` from the state data.
 *
 * A `Pass` state with `Parameters` and no `ResultPath` REPLACES its input with the
 * `Parameters` object. None of the three `PREPARE_*` states lists `trace_id.$`, so
 * from that point on `$.trace_id` no longer exists in the execution data.
 *
 * `MARK_PROCESSING_FAILED` does not read it, so the status write is unaffected and
 * the IdempotencyTable still records the terminal state correctly — which is why
 * async 409 semantics (FIX 1) keep working. But `PUBLISH_PROCESSING_FAILED` DOES
 * read `$.trace_id`, and it has `Retry` without `Catch`, so on the
 * CORE_IDENTITY_CONFLICT path the execution ends with an unmapped
 * `States.Runtime` and the `processing.failed` WebSocket event is never pushed.
 * Degraded observability, not data loss.
 *
 * Fix is one line per state: add `"trace_id.$": "$.trace_id"` to the `Parameters`
 * of `PREPARE_CORE_IDENTITY_CONFLICT`, `PREPARE_INVALID_RECOVERY_MODE` and
 * `PREPARE_UNKNOWN_CORE_WRITE_STATUS`. Nothing in this package can work around it:
 * the field is gone before the Lambda is invoked.
 */
export const ASL_GAP_PASS_STATE_DROPS_TRACE_ID = {
  reviewItem: 'D2',
  status: 'OPEN',
  file: 'infra/statemachine/workflow.asl.json',
  affectedStates: [
    AslState.PREPARE_CORE_IDENTITY_CONFLICT,
    AslState.PREPARE_INVALID_RECOVERY_MODE,
    AslState.PREPARE_UNKNOWN_CORE_WRITE_STATUS,
  ],
  cause:
    'A Pass state with Parameters and no ResultPath replaces the state input; none of the ' +
    'PREPARE_* states re-emits trace_id.$, so $.trace_id is absent downstream.',
  firstFailingConsumer: AslState.PUBLISH_PROCESSING_FAILED,
  consequence:
    'PUBLISH_PROCESSING_FAILED reads $.trace_id and has Retry but no Catch, so the ' +
    'CORE_IDENTITY_CONFLICT path terminates on States.Runtime and processing.failed is never ' +
    'pushed. The IdempotencyTable write already happened, so async 409 (FIX 1) still holds.',
  fix: 'Add "trace_id.$": "$.trace_id" to the Parameters of all three PREPARE_* states.',
  workaroundInThisPackage: null,
} as const;
