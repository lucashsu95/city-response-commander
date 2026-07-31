/**
 * Stale-running orchestration (design §15.2 step E, PATCH 6, FIX 3; TASK-092).
 *
 * A crashed or timed-out Express execution leaves `status=running` with a
 * `running_deadline_at` in the past. Nobody inside that execution is alive to
 * clean it up, and Step Functions will not do it either — so without this path
 * the key would report `202 in-progress` forever and the event could never be
 * re-decided.
 *
 * Reconciliation is therefore driven from OUTSIDE, by the next same-key request:
 *
 *   detect stale (`running_deadline_at < now`)
 *     → `RecoveryGateFn` (read-only, strongly consistent) for the fencing terms
 *       and `effective_core_committed`
 *     → `WorkflowStatusFn(RECONCILE_STALE_RUNNING)` (external fencing, FIX 3)
 *     → staged recovery `processing_failed → starting` (TASK-094)
 *
 * `InjectFn` invokes the first two by exact function ARN — the only two
 * `lambda:InvokeFunction` targets its role allows (§18 / TASK-076).
 *
 * @module backend/inject/stale_orchestration
 */

import {
  IdempotencyStatus,
  RecoveryMode,
  StatusActionResult,
} from '@city-commander/shared-schemas';
import type { IdempotencyRecord } from '@city-commander/shared-schemas';
import type { IdempotencyRepository } from '../repository/idempotency_repository.js';
import type { RecoveryGateInput, RecoveryGateResult } from '../recovery/recovery_gate.js';
import type { ApplyOrConfirmOutcome } from '../workflow/apply_or_confirm.js';
import type { ReconcileStaleRunningInput } from '../workflow/reconcile_stale_running.js';
import { recoverFromProcessingFailed } from './recovery_transitions.js';
import type { RecoveryLeaseInput, RecoveryLeaseOutcome } from './recovery_transitions.js';

/**
 * The two Lambda invocations plus the repository this orchestration needs.
 *
 * Modelled as functions rather than clients so `InjectFn` can be unit-tested
 * without Lambda, and so the exact-ARN invoke boundary stays explicit.
 */
export interface StaleOrchestrationPorts {
  /** Invoke `RecoveryGateFn` (read-only, exact ARN). */
  readonly invokeRecoveryGate: (input: RecoveryGateInput) => Promise<RecoveryGateResult>;
  /** Invoke `WorkflowStatusFn(RECONCILE_STALE_RUNNING)` (exact ARN). */
  readonly invokeReconcileStaleRunning: (
    input: ReconcileStaleRunningInput,
  ) => Promise<ApplyOrConfirmOutcome>;
  /** Used only for the `processing_failed → starting` re-lease. */
  readonly repository: Pick<IdempotencyRepository, 'conditionalUpdateState'>;
}

/** Arguments for {@link orchestrateStaleRunning}. */
export interface StaleOrchestrationInput {
  /** The record just read by the same-key request router (TASK-088). */
  readonly record: IdempotencyRecord;
  /** Re-lease parameters for the recovery step. */
  readonly lease: Omit<RecoveryLeaseInput, 'currentAttemptCount' | 'previousLastError'>;
}

/** Result of the orchestration. */
export type StaleOrchestrationOutcome =
  | {
      /** The record is not a stale `running`; the caller routes it normally. */
      readonly outcome: 'NOT_STALE';
    }
  | {
      /**
       * The record lacks the fencing terms reconciliation needs (no execution
       * ARN or no deadline). Cannot be reconciled safely; surfaced rather than
       * guessed at.
       */
      readonly outcome: 'FENCING_TERMS_UNAVAILABLE';
      readonly gate: RecoveryGateResult;
    }
  | {
      /**
       * Reconciliation was fenced: the key already moved on (someone else
       * reconciled it, or it was re-leased to a newer attempt). The caller
       * re-reads and re-routes.
       */
      readonly outcome: 'RECONCILE_FENCED';
      readonly gate: RecoveryGateResult;
      readonly reconcile: ApplyOrConfirmOutcome;
    }
  | {
      /** Reconciled and re-leased; this request owns the next attempt. */
      readonly outcome: 'RECOVERED';
      readonly gate: RecoveryGateResult;
      readonly record: IdempotencyRecord;
      readonly recoveryMode: RecoveryMode;
    }
  | {
      /** Reconciled, but another request won the recovery lease. */
      readonly outcome: 'RACE_LOST';
      readonly gate: RecoveryGateResult;
    };

/**
 * `true` when a record is a `running` execution past its deadline.
 *
 * A record with no `running_deadline_at` is NOT stale: the deadline is written by
 * `MARK_RUNNING`, so its absence means registration has not completed and the
 * execution may still be starting normally.
 */
export function isStaleRunning(record: IdempotencyRecord, nowEpochMs: number): boolean {
  if (record.status !== IdempotencyStatus.running) return false;
  if (record.running_deadline_at === null || record.running_deadline_at === undefined) return false;
  return record.running_deadline_at < nowEpochMs;
}

/**
 * Detect, reconcile and recover a stale running execution.
 *
 * @throws IdempotencyRepositoryError / TableReadError on a read or write failure;
 *         a fault is never silently treated as "not stale"
 *
 * @example inside the same-key re-request router (TASK-088)
 * ```ts
 * if (isStaleRunning(record, now)) {
 *   const result = await orchestrateStaleRunning(ports, { record, lease });
 *   if (result.outcome === 'RECOVERED') return startExecutionAsLeaseHolder(result);
 *   return respondInProgress(); // fenced or race lost: someone else is on it
 * }
 * ```
 */
export async function orchestrateStaleRunning(
  ports: StaleOrchestrationPorts,
  input: StaleOrchestrationInput,
): Promise<StaleOrchestrationOutcome> {
  const { record, lease } = input;

  if (!isStaleRunning(record, lease.clock.nowEpochMs)) return { outcome: 'NOT_STALE' };

  // 1. Read-only judgement. Supplies the external fencing terms (FIX 3) and
  //    whether a core already exists, which grades the recovery.
  const gate = await ports.invokeRecoveryGate({
    idempotencyKey: record.idempotency_key,
    decisionId: record.decision_id,
  });

  if (
    gate.expected_stale_execution_arn === null ||
    gate.expected_attempt === null ||
    gate.observed_running_deadline_at === null
  ) {
    // The gate re-read and found the record no longer carries the terms the
    // conditional Update needs. Refuse rather than fence on invented values.
    return { outcome: 'FENCING_TERMS_UNAVAILABLE', gate };
  }

  // 2. Reconcile `running → processing_failed` under external fencing.
  const reconcile = await ports.invokeReconcileStaleRunning({
    idempotencyKey: record.idempotency_key,
    expectedStaleExecutionArn: gate.expected_stale_execution_arn,
    expectedAttempt: gate.expected_attempt,
    observedRunningDeadlineAt: gate.observed_running_deadline_at,
    effectiveCoreCommitted: gate.effective_core_committed,
    nowEpochMs: lease.clock.nowEpochMs,
    nowDisplay: lease.clock.nowDisplay,
  });

  if (reconcile.result === StatusActionResult.FENCED_STALE_EXECUTION) {
    return { outcome: 'RECONCILE_FENCED', gate, reconcile };
  }

  // 3. Staged recovery. `attempt_count` is unchanged by reconciliation, so the
  //    guard uses the attempt the gate observed.
  const recovered: RecoveryLeaseOutcome = await recoverFromProcessingFailed(ports.repository, {
    ...lease,
    currentAttemptCount: gate.expected_attempt,
    previousLastError: reconcile.record?.last_error ?? null,
    effectiveCoreCommitted: gate.effective_core_committed,
  });

  if (recovered.outcome === 'RACE_LOST') return { outcome: 'RACE_LOST', gate };

  return {
    outcome: 'RECOVERED',
    gate,
    record: recovered.record,
    recoveryMode: recovered.recoveryMode,
  };
}
