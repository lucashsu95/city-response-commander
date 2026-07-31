/**
 * Async CORE_IDENTITY_CONFLICT handling (design §15.2 step 6, FIX 1; TASK-096).
 *
 * `DecisionFn` discovers the conflict INSIDE the workflow, long after the original
 * `POST /inject` returned `202` — StartExecution is asynchronous. That timing is
 * the whole subtlety:
 *
 *  - The original `202` is **never retroactively changed**. It was a correct
 *    answer at the time it was given.
 *  - `409 Conflict` is returned only to a LATER same-key POST, which reads the
 *    terminal state this handler records (TASK-088).
 *
 * The handler's job is to make the state terminal and to fail closed:
 *
 *  1. `MARK_PROCESSING_FAILED` with `last_error=CORE_IDENTITY_CONFLICT`, which
 *     writes `retryable=false` and `recovery_stage=NONE`. `retryable=false` is
 *     what makes it unrecoverable — the `processing_failed → starting` transition
 *     guards on `retryable=true`, so it cannot match. The block is enforced by the
 *     DynamoDB condition, not by an application-level `if`.
 *  2. Emit a `CRITICAL_SECURITY_ALERT` naming the diverged identity fields
 *     (TASK-159). A different decision under the same key means a key collision or
 *     an attempt to overwrite an immutable official decision.
 *  3. Push `processing.failed` so the Dashboard shows a non-retryable terminal
 *     error rather than spinning forever.
 *
 * What it must NOT do: push `decision.fast_path_ready`, start enrichment, or
 * overwrite the committed core. The core is already committed — by a DIFFERENT
 * decision — and it is immutable. This module therefore has no access to the core
 * writer or the fast-path publisher at all.
 *
 * @module backend/workflow/async_conflict_handler
 */

import { StatusActionResult } from '@city-commander/shared-schemas';
import { markProcessingFailed, ProcessingFailure } from './mark_processing_failed.js';
import type { ApplyOrConfirmOutcome, IdempotencyStateStore } from './apply_or_confirm.js';
import type { StatusActionContext, WorkflowStatusInput } from './status_context.js';
import type { CoreIdentityMismatch } from '../decision/identity_classifier.js';
import type { SecurityAlerting } from '../security/security_alerting.js';

/** `processing.failed` WebSocket event name (§13). */
export const PROCESSING_FAILED_EVENT = 'processing.failed' as const;

/** `processing.failed` payload. */
export interface ProcessingFailedEvent {
  readonly type: typeof PROCESSING_FAILED_EVENT;
  readonly decision_id: string;
  readonly trace_id: string;
  readonly error_code: typeof ProcessingFailure.CORE_IDENTITY_CONFLICT;
  /** Always `false`: the state is terminal. */
  readonly retryable: false;
  readonly attempt_count: number;
}

/** Realtime push port. Failure to notify never changes the terminal state. */
export interface ProcessingFailedPublisherPort {
  publishProcessingFailed(event: ProcessingFailedEvent): Promise<void>;
}

/** Ports the handler needs. Deliberately no core writer and no fast-path publisher. */
export interface AsyncConflictPorts {
  readonly statusStore: IdempotencyStateStore;
  readonly securityAlerting: SecurityAlerting;
  /** Optional: when absent, no `processing.failed` is pushed (polling still works). */
  readonly publisher?: ProcessingFailedPublisherPort;
}

/** Arguments for {@link handleCoreIdentityConflict}. */
export interface AsyncConflictInput {
  readonly workflowInput: WorkflowStatusInput;
  readonly context: StatusActionContext;
  readonly traceId: string;
  /** Identity fields that diverged, from TASK-101. */
  readonly mismatches: readonly CoreIdentityMismatch[];
  readonly storedCoreHash: string | null;
  readonly computedCoreHash: string | null;
}

/** Result of terminal conflict handling. */
export interface AsyncConflictResult {
  /** Outcome of the fenced `MARK_PROCESSING_FAILED`. */
  readonly statusAction: ApplyOrConfirmOutcome;
  /** Always `false` — nothing here may announce a decision. */
  readonly fastPathPushed: false;
  /** Always `true` — the state cannot be recovered. */
  readonly terminal: true;
  /** Whether `processing.failed` reached a client. */
  readonly processingFailedPushed: boolean;
  /** Set when the push failed; never propagated as a handler failure. */
  readonly publishError?: string;
}

/**
 * Record the terminal conflict, alert, and notify — in that order.
 *
 * Ordering is deliberate: the state transition happens FIRST, so the terminal
 * record exists before anything else can observe it. An alert about a state that
 * was never written would be misleading, and a client told "failed" before the
 * table says so could poll and see `running`.
 *
 * @returns the terminal result; `fastPathPushed` is structurally `false`
 * @throws IdempotencyRepositoryError on a DynamoDB fault — the conflict must be
 *         recorded, so a write failure is surfaced rather than swallowed
 */
export async function handleCoreIdentityConflict(
  ports: AsyncConflictPorts,
  input: AsyncConflictInput,
): Promise<AsyncConflictResult> {
  const { workflowInput, context, traceId, mismatches, storedCoreHash, computedCoreHash } = input;

  // 1. Terminal state. The variant writes retryable=false + recovery_stage=NONE,
  //    which is what blocks `processing_failed → starting` at the guard level.
  const statusAction = await markProcessingFailed(ports.statusStore, workflowInput, {
    ...context,
    lastError: ProcessingFailure.CORE_IDENTITY_CONFLICT,
    // Irrelevant for this variant — it is forced to NONE — but passed explicitly
    // so no reader assumes the value was simply forgotten.
    effectiveCoreCommitted: true,
  });

  // A fenced execution has no authority to record anything: a newer attempt owns
  // the key and will reach its own conclusion.
  if (statusAction.result === StatusActionResult.FENCED_STALE_EXECUTION) {
    return {
      statusAction,
      fastPathPushed: false,
      terminal: true,
      processingFailedPushed: false,
    };
  }

  // 2. CRITICAL_SECURITY_ALERT naming exactly which identity fields diverged.
  ports.securityAlerting
    .withCorrelation({
      trace_id: traceId,
      decision_id: workflowInput.decisionId,
      idempotency_key: workflowInput.idempotencyKey,
      attempt_count: workflowInput.attemptCount,
      workflow_execution_arn: context.executionArn,
    })
    .coreIdentityConflict({ mismatches, storedCoreHash, computedCoreHash });

  // 3. Notify the Dashboard. A push failure does not un-record the conflict, so it
  //    is reported rather than thrown — polling `GET /decisions/{id}` still shows
  //    the terminal state via the read-only `execution` projection (FIX 1).
  if (ports.publisher === undefined) {
    return { statusAction, fastPathPushed: false, terminal: true, processingFailedPushed: false };
  }

  try {
    await ports.publisher.publishProcessingFailed({
      type: PROCESSING_FAILED_EVENT,
      decision_id: workflowInput.decisionId,
      trace_id: traceId,
      error_code: ProcessingFailure.CORE_IDENTITY_CONFLICT,
      retryable: false,
      attempt_count: workflowInput.attemptCount,
    });
    return { statusAction, fastPathPushed: false, terminal: true, processingFailedPushed: true };
  } catch (error: unknown) {
    return {
      statusAction,
      fastPathPushed: false,
      terminal: true,
      processingFailedPushed: false,
      publishError: error instanceof Error ? error.message : String(error),
    };
  }
}
