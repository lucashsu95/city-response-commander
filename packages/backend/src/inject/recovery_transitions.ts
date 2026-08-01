/**
 * Staged recovery lease transitions (design §15.2 steps A–D, PATCH 3/4;
 * TASK-094).
 *
 * Three rules hold across all of them:
 *
 *  1. **`status` always goes back to `starting` first.** Design is explicit:
 *     recovery must not merely "take a new lease" while leaving the old status in
 *     place. `MARK_RUNNING` guards on `status=starting`, so a recovery that
 *     skipped this would leave the key unable to register its next execution.
 *  2. **Staged, not blind.** `recovery_mode` carries how much may re-run:
 *     `FULL_WORKFLOW` when no core is committed, `ENRICHMENT_ONLY` when one is.
 *     `ENRICHMENT_ONLY` must never re-run `DecisionFn` — the core is immutable.
 *  3. **Single owner.** Every transition is one atomic conditional Update
 *     guarded on the CURRENT `attempt_count`, so two concurrent recovery
 *     requests cannot both take the lease; the loser gets `RACE_LOST` and
 *     re-routes.
 *
 * Each transition increments `attempt_count` and REMOVEs the stale
 * `workflow_execution_arn`, so the previous execution's fencing terms can never
 * match again.
 *
 * @module backend/inject/recovery_transitions
 */

import { IdempotencyStatus, RecoveryMode, RecoveryStage } from '@city-commander/shared-schemas';
import type { IdempotencyRecord } from '@city-commander/shared-schemas';
import {
  IdempotencyConditionFailedError,
  IdempotencyUsageError,
} from '../repository/idempotency_repository.js';
import type {
  IdempotencyGuard,
  IdempotencyRepository,
} from '../repository/idempotency_repository.js';
import type { InjectionClock } from './first_lease.js';

/** Common input for every recovery transition. */
export interface RecoveryLeaseInput {
  readonly idempotencyKey: string;
  /** New lease holder — normally the API Gateway request id of this request. */
  readonly newLeaseOwner: string;
  /** `attempt_count` observed on the record; guards the transition. */
  readonly currentAttemptCount: number;
  /**
   * `last_error` observed on the record, preserved into `previous_last_error`
   * for audit before `last_error` is cleared.
   */
  readonly previousLastError: string | null;
  readonly clock: InjectionClock;
  /** Lease lifetime for the new attempt. */
  readonly leaseTtlMs: number;
}

/** Outcome of a recovery transition. */
export type RecoveryLeaseOutcome =
  | {
      /** This request owns the new lease and may call StartExecution. */
      readonly outcome: 'LEASE_ACQUIRED';
      readonly record: IdempotencyRecord;
      /** Mode written to the record; becomes the workflow INPUT. */
      readonly recoveryMode: RecoveryMode;
    }
  | {
      /**
       * The guard did not match: the key changed under us — another request
       * recovered it, or it is no longer in the expected status. Not an error;
       * the caller re-reads and re-routes (TASK-088).
       */
      readonly outcome: 'RACE_LOST';
    };

function assertInput(input: RecoveryLeaseInput): void {
  if (!input.idempotencyKey) {
    throw new IdempotencyUsageError('Recovery transition requires a non-empty "idempotencyKey".');
  }
  if (!input.newLeaseOwner) {
    throw new IdempotencyUsageError('Recovery transition requires a non-empty "newLeaseOwner".');
  }
  if (!Number.isInteger(input.currentAttemptCount) || input.currentAttemptCount < 1) {
    throw new IdempotencyUsageError(
      `Recovery transition requires an integer "currentAttemptCount" >= 1, got ${String(
        input.currentAttemptCount,
      )}.`,
    );
  }
  if (!(input.leaseTtlMs > 0)) {
    throw new IdempotencyUsageError('Recovery transition requires "leaseTtlMs" > 0.');
  }
}

/** Runs the shared re-lease mutation under a caller-supplied guard. */
async function reacquireLease(
  repository: Pick<IdempotencyRepository, 'conditionalUpdateState'>,
  input: RecoveryLeaseInput,
  guard: IdempotencyGuard,
  recoveryMode: RecoveryMode,
  recoveryStage: RecoveryStage,
): Promise<RecoveryLeaseOutcome> {
  assertInput(input);
  const { clock } = input;

  try {
    const record = await repository.conditionalUpdateState({
      idempotencyKey: input.idempotencyKey,
      guard,
      mutation: {
        set: {
          // Rule 1: status always returns to `starting`.
          status: IdempotencyStatus.starting,
          lease_owner: input.newLeaseOwner,
          lease_expires_at: clock.nowEpochMs + input.leaseTtlMs,
          recovery_mode: recoveryMode,
          recovery_stage: recoveryStage,
          // Keep the cause for audit, then clear the active error.
          previous_last_error: input.previousLastError,
          last_error: null,
          retryable: true,
          updated_at: clock.nowDisplay,
        },
        // The next execution registers itself via MARK_RUNNING; the old
        // execution's ARN must not survive to satisfy a fencing guard.
        remove: ['workflow_execution_arn', 'running_started_at', 'running_deadline_at'],
        incrementAttemptCount: 1,
      },
    });

    return { outcome: 'LEASE_ACQUIRED', record, recoveryMode };
  } catch (error: unknown) {
    if (error instanceof IdempotencyConditionFailedError) return { outcome: 'RACE_LOST' };
    throw error;
  }
}

/**
 * Step A — `start_failed → starting` (§15.2).
 *
 * StartExecution failed, so the workflow never ran and no core exists. Always
 * `FULL_WORKFLOW`; no RecoveryGate read is needed to know that.
 */
export function recoverFromStartFailed(
  repository: Pick<IdempotencyRepository, 'conditionalUpdateState'>,
  input: RecoveryLeaseInput,
): Promise<RecoveryLeaseOutcome> {
  return reacquireLease(
    repository,
    input,
    {
      status: IdempotencyStatus.start_failed,
      attempt_count: input.currentAttemptCount,
    },
    RecoveryMode.FULL_WORKFLOW,
    RecoveryStage.FULL_WORKFLOW,
  );
}

/**
 * Steps B/C — `processing_failed → starting`, graded (§15.2).
 *
 * Guarded on `retryable=true`, which is what makes the terminal
 * `CORE_IDENTITY_CONFLICT` (`retryable=false`) unrecoverable: this transition
 * simply cannot match it, so the conflict can never be retried into overwriting
 * a committed core.
 *
 * @param effectiveCoreCommitted from `RecoveryGateFn`; `true` ⇒ ENRICHMENT_ONLY
 */
export function recoverFromProcessingFailed(
  repository: Pick<IdempotencyRepository, 'conditionalUpdateState'>,
  input: RecoveryLeaseInput & { readonly effectiveCoreCommitted: boolean },
): Promise<RecoveryLeaseOutcome> {
  const mode = input.effectiveCoreCommitted
    ? RecoveryMode.ENRICHMENT_ONLY
    : RecoveryMode.FULL_WORKFLOW;
  const stage = input.effectiveCoreCommitted
    ? RecoveryStage.ENRICHMENT_ONLY
    : RecoveryStage.FULL_WORKFLOW;

  return reacquireLease(
    repository,
    input,
    {
      status: IdempotencyStatus.processing_failed,
      // Terminal conflicts carry retryable=false and are excluded here.
      retryable: true,
      attempt_count: input.currentAttemptCount,
    },
    mode,
    stage,
  );
}

/**
 * Step D — expired `starting → starting` (§15.2).
 *
 * The previous holder took the lease and then vanished before StartExecution
 * succeeded. Guarded on `lease_expires_at < now`, so a live lease is never stolen.
 */
export function reacquireExpiredStartingLease(
  repository: Pick<IdempotencyRepository, 'conditionalUpdateState'>,
  input: RecoveryLeaseInput,
): Promise<RecoveryLeaseOutcome> {
  return reacquireLease(
    repository,
    input,
    {
      status: IdempotencyStatus.starting,
      attempt_count: input.currentAttemptCount,
      lease_expires_at_lt: input.clock.nowEpochMs,
    },
    RecoveryMode.FULL_WORKFLOW,
    RecoveryStage.FULL_WORKFLOW,
  );
}
