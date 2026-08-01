/**
 * Same-key re-request routing (design §12 status matrix, §15.2 step 4; TASK-088).
 *
 * A duplicate `POST /incidents/{id}/inject` is NORMAL — a retried fetch, a double
 * click, a client timeout. None of it is an error, and none of it may start a
 * second workflow. This module is the single place that decides what a same-key
 * request means:
 *
 * | Observed state                                        | Route |
 * | ----------------------------------------------------- | ----- |
 * | key absent                                            | first-lease acquisition (TASK-086) |
 * | `completed`                                           | `200 OK` + existing `decision_id` |
 * | `running`, `running_deadline_at >= now`               | `202` in-progress |
 * | `running`, `running_deadline_at < now` (stale)        | reconcile + staged recovery (TASK-092) |
 * | `starting`, lease unexpired                           | `202` in-progress |
 * | `starting`, lease expired                             | re-lease `starting → starting` (TASK-094) |
 * | `start_failed`                                        | re-lease `start_failed → starting` FULL_WORKFLOW |
 * | `processing_failed`, `retryable=true`                 | graded re-lease via RecoveryGate |
 * | `processing_failed`, `CORE_IDENTITY_CONFLICT`         | `409` terminal, never recovered |
 *
 * Two things design is emphatic about, and this module enforces structurally:
 *
 *  - **`completed` and `running` are different branches.** They must not be merged
 *    into one `202`: a finished decision answers `200` with its `decision_id`,
 *    while an in-flight one answers `202`. Collapsing them would make the
 *    Dashboard unable to tell "done" from "still working".
 *  - **A healthy in-flight execution is never disturbed.** Recovery only happens
 *    on a state that is provably not progressing — an expired lease, a past
 *    deadline, or a recorded failure. Every such transition is a guarded
 *    conditional update, so a losing racer gets `RACE_LOST` and answers `202`
 *    rather than stealing the lease.
 *
 * @module backend/inject/rerequest_router
 */

import { IdempotencyStatus, RecoveryMode } from '@city-commander/shared-schemas';
import type { IdempotencyRecord } from '@city-commander/shared-schemas';
import { CoreIdentityConflictError } from '../errors/domain_error.js';
import type { IdempotencyReader } from '../repository/idempotency_repository.js';
import type { IdempotencyRepository } from '../repository/idempotency_repository.js';
import { ProcessingFailure } from '../workflow/mark_processing_failed.js';
import type { InjectionClock } from './first_lease.js';
import {
  reacquireExpiredStartingLease,
  recoverFromProcessingFailed,
  recoverFromStartFailed,
} from './recovery_transitions.js';
import type { RecoveryLeaseOutcome } from './recovery_transitions.js';
import { orchestrateStaleRunning } from './stale_orchestration.js';
import type { StaleOrchestrationPorts } from './stale_orchestration.js';

/** Ports the router needs. Read + IdempotencyTable transitions only. */
export interface RerequestRouterPorts {
  readonly idempotency: IdempotencyReader;
  readonly repository: Pick<IdempotencyRepository, 'conditionalUpdateState'>;
  /** Read-only gate + reconcile invocations, for the stale and graded paths. */
  readonly staleOrchestration: StaleOrchestrationPorts;
}

/** Arguments for {@link routeSameKeyRequest}. */
export interface RerequestRouterInput {
  readonly idempotencyKey: string;
  /** New lease owner if a recovery lease is taken (API Gateway request id). */
  readonly leaseOwner: string;
  readonly clock: InjectionClock;
  readonly leaseTtlMs: number;
  readonly traceId: string;
}

/** Routing decision. HTTP statuses come from the §12 matrix, never ad hoc. */
export type RerequestRoute =
  | {
      /** No record: the caller performs first-lease acquisition (TASK-086). */
      readonly route: 'KEY_ABSENT';
    }
  | {
      /** `200 OK {decision_id, status:completed}`. A distinct branch from 202. */
      readonly route: 'RESPOND_COMPLETED';
      readonly httpStatus: 200;
      readonly decisionId: string;
      readonly record: IdempotencyRecord;
    }
  | {
      /** `202` in-progress. No StartExecution; the existing execution owns it. */
      readonly route: 'RESPOND_IN_PROGRESS';
      readonly httpStatus: 202;
      readonly decisionId: string;
      readonly status: IdempotencyStatus;
      readonly record: IdempotencyRecord;
    }
  | {
      /**
       * `409 Conflict`, terminal (FIX 1). Returned only to a LATER same-key POST;
       * the original request's `202` is never retroactively changed.
       */
      readonly route: 'RESPOND_TERMINAL_CONFLICT';
      readonly httpStatus: 409;
      readonly decisionId: string;
      readonly error: CoreIdentityConflictError;
      readonly record: IdempotencyRecord;
    }
  | {
      /** A recovery lease was taken; the caller retries StartExecution. */
      readonly route: 'RECOVERED_RETRY_START';
      readonly decisionId: string;
      readonly recoveryMode: RecoveryMode;
      readonly record: IdempotencyRecord;
    }
  | {
      /**
       * Another request won the recovery lease. Answer `202`: someone is on it,
       * and this request must not compete further.
       */
      readonly route: 'RACE_LOST';
      readonly httpStatus: 202;
      readonly decisionId: string;
    };

/** `true` when a `processing_failed` record is the terminal identity conflict. */
export function isTerminalConflict(record: IdempotencyRecord): boolean {
  return (
    record.status === IdempotencyStatus.processing_failed &&
    (record.last_error === ProcessingFailure.CORE_IDENTITY_CONFLICT || record.retryable === false)
  );
}

/** `true` when a `starting` lease has expired and may be re-taken. */
export function isStartingLeaseExpired(record: IdempotencyRecord, nowEpochMs: number): boolean {
  if (record.status !== IdempotencyStatus.starting) return false;
  if (record.lease_expires_at === null || record.lease_expires_at === undefined) return false;
  return record.lease_expires_at < nowEpochMs;
}

function toRoute(outcome: RecoveryLeaseOutcome, decisionId: string): RerequestRoute {
  if (outcome.outcome === 'RACE_LOST') {
    return { route: 'RACE_LOST', httpStatus: 202, decisionId };
  }
  return {
    route: 'RECOVERED_RETRY_START',
    decisionId,
    recoveryMode: outcome.recoveryMode,
    record: outcome.record,
  };
}

/**
 * Route a same-key injection request.
 *
 * @throws IdempotencyRepositoryError / TableReadError on a read or write fault —
 *         a transient failure is never turned into a routing decision
 *
 * @example
 * ```ts
 * const route = await routeSameKeyRequest(ports, input);
 * switch (route.route) {
 *   case 'KEY_ABSENT':               return acquireFirstLease(...);
 *   case 'RESPOND_COMPLETED':        return ok({ decision_id: route.decisionId, status: 'completed' });
 *   case 'RESPOND_IN_PROGRESS':
 *   case 'RACE_LOST':                return accepted({ decision_id: route.decisionId });
 *   case 'RESPOND_TERMINAL_CONFLICT':return toHttpErrorResult(route.error, traceId);
 *   case 'RECOVERED_RETRY_START':    return startExecutionAsLeaseHolder(route.record);
 * }
 * ```
 */
export async function routeSameKeyRequest(
  ports: RerequestRouterPorts,
  input: RerequestRouterInput,
): Promise<RerequestRoute> {
  const record = await ports.idempotency.getConsistent(input.idempotencyKey);

  if (record === null) return { route: 'KEY_ABSENT' };

  const decisionId = record.decision_id;
  const nowEpochMs = input.clock.nowEpochMs;

  const lease = {
    idempotencyKey: input.idempotencyKey,
    newLeaseOwner: input.leaseOwner,
    clock: input.clock,
    leaseTtlMs: input.leaseTtlMs,
  };

  switch (record.status) {
    // ── completed: its own branch, NOT merged into 202 ──
    case IdempotencyStatus.completed:
      return { route: 'RESPOND_COMPLETED', httpStatus: 200, decisionId, record };

    // ── running: healthy in-flight vs stale ──
    case IdempotencyStatus.running: {
      const deadline = record.running_deadline_at;
      // No deadline yet means MARK_RUNNING is mid-flight, not stale.
      const isStale = deadline !== null && deadline !== undefined && deadline < nowEpochMs;

      if (!isStale) {
        return {
          route: 'RESPOND_IN_PROGRESS',
          httpStatus: 202,
          decisionId,
          status: record.status,
          record,
        };
      }

      // Stale: RecoveryGate → RECONCILE_STALE_RUNNING → staged recovery (TASK-092).
      const staleResult = await orchestrateStaleRunning(ports.staleOrchestration, {
        record,
        lease,
      });

      if (staleResult.outcome === 'RECOVERED') {
        return {
          route: 'RECOVERED_RETRY_START',
          decisionId,
          recoveryMode: staleResult.recoveryMode,
          record: staleResult.record,
        };
      }

      // RACE_LOST / RECONCILE_FENCED / FENCING_TERMS_UNAVAILABLE / NOT_STALE:
      // the key moved on under us, or cannot be reconciled safely. Someone else
      // owns it now, so report in-progress rather than competing for it.
      return { route: 'RACE_LOST', httpStatus: 202, decisionId };
    }

    // ── starting: live lease vs expired lease ──
    case IdempotencyStatus.starting: {
      if (!isStartingLeaseExpired(record, nowEpochMs)) {
        return {
          route: 'RESPOND_IN_PROGRESS',
          httpStatus: 202,
          decisionId,
          status: record.status,
          record,
        };
      }

      const outcome = await reacquireExpiredStartingLease(ports.repository, {
        ...lease,
        currentAttemptCount: record.attempt_count,
        previousLastError: record.last_error,
      });
      return toRoute(outcome, decisionId);
    }

    // ── start_failed: workflow never started, so no core can exist ──
    case IdempotencyStatus.start_failed: {
      const outcome = await recoverFromStartFailed(ports.repository, {
        ...lease,
        currentAttemptCount: record.attempt_count,
        previousLastError: record.last_error,
      });
      return toRoute(outcome, decisionId);
    }

    // ── processing_failed: terminal conflict vs graded recovery ──
    case IdempotencyStatus.processing_failed: {
      if (isTerminalConflict(record)) {
        // Terminal and non-recoverable. Always 409, never 500, never recovered.
        return {
          route: 'RESPOND_TERMINAL_CONFLICT',
          httpStatus: 409,
          decisionId,
          error: new CoreIdentityConflictError(decisionId, undefined, { traceId: input.traceId }),
          record,
        };
      }

      // Grade the recovery from strongly-consistent evidence, not from the
      // failed record alone: the core may have been committed before the failure.
      const gate = await ports.staleOrchestration.invokeRecoveryGate({
        idempotencyKey: input.idempotencyKey,
        decisionId,
      });

      const outcome = await recoverFromProcessingFailed(ports.repository, {
        ...lease,
        currentAttemptCount: record.attempt_count,
        previousLastError: record.last_error,
        effectiveCoreCommitted: gate.effective_core_committed,
      });
      return toRoute(outcome, decisionId);
    }
  }
}
