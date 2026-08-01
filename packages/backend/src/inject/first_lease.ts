/**
 * First lease acquisition — `new → starting` (design §15.2 step 1; TASK-086).
 *
 * `POST /incidents/{id}/inject` derives the idempotency key, then attempts ONE
 * conditional Put with `attribute_not_exists(idempotency_key)`. Exactly one
 * concurrent request wins and becomes the lease holder; every other request is
 * routed to same-key re-request handling (TASK-088).
 *
 * Two boundaries this module holds:
 *
 *  1. **It never writes `running`.** `starting → running` belongs exclusively to
 *     the Step Functions first state `WorkflowStatusFn(MARK_RUNNING)`, which
 *     stamps `$$.Execution.Id` (PATCH 2). Writing `running` here would reopen the
 *     registration race the design eliminated: Express can begin executing before
 *     `InjectFn`'s own write lands.
 *  2. **It does not call StartExecution.** Only the lease holder may, and that is
 *     TASK-087. Acquiring the lease and starting the workflow are separate steps
 *     so a start failure can be recorded against a lease that already exists
 *     (`starting → start_failed`, §15.2).
 *
 * @module backend/inject/first_lease
 */

import { IdempotencyStatus } from '@city-commander/shared-schemas';
import type { IdempotencyRecord } from '@city-commander/shared-schemas';
import {
  IdempotencyConditionFailedError,
  IdempotencyUsageError,
} from '../repository/idempotency_repository.js';
import type { IdempotencyRepository } from '../repository/idempotency_repository.js';
import { deriveInjectionIdentity } from './idempotency_key.js';
import type { IdempotencyKeyParts } from './idempotency_key.js';

/**
 * Caller-supplied time. Injected rather than read from `Date.now()` so lease
 * arithmetic is deterministic and unit-testable.
 *
 * `nowDisplay` is supplied by the caller rather than computed here because the
 * design fixes the FORMAT (`YYYY-MM-DD HH:MM`, SOP art.6) but not the timezone;
 * that choice belongs in one place at the handler edge, not buried per-module.
 */
export interface InjectionClock {
  /** Current time, epoch milliseconds. */
  readonly nowEpochMs: number;
  /** Current time as `YYYY-MM-DD HH:MM`. */
  readonly nowDisplay: string;
}

/** Lease and record lifetimes, all resolved from `ConfigProvider`. */
export interface LeaseDurations {
  /** How long the start lease is held before another request may take it over. */
  readonly leaseTtlMs: number;
  /** How long the IdempotencyTable record itself is retained (DynamoDB TTL). */
  readonly recordTtlMs: number;
}

/** Arguments for {@link acquireFirstLease}. */
export interface AcquireFirstLeaseInput {
  /** The three key parts (§10.11e). */
  readonly keyParts: IdempotencyKeyParts;
  /** Lease holder id — normally the API Gateway request id. */
  readonly leaseOwner: string;
  readonly clock: InjectionClock;
  readonly durations: LeaseDurations;
  /**
   * Initial `recovery_mode`.
   *
   * Design §15.2 specifies `NORMAL` for a first injection, but the shared
   * `RecoveryMode` enum currently exposes a different member set
   * (`FIRST_RUN` / `STALE_RECOVERY` / `START_FAILED_RETRY`). The value is a
   * required parameter so this module does not hard-code a placeholder; once the
   * shared enum is corrected (TASK-003) callers pass `NORMAL`.
   */
  readonly recoveryMode: IdempotencyRecord['recovery_mode'];
  /** Initial `recovery_stage`. Design specifies `NONE`; see `recoveryMode`. */
  readonly recoveryStage: IdempotencyRecord['recovery_stage'];
}

/** Outcome of the first-lease attempt. */
export type AcquireFirstLeaseOutcome =
  | {
      /** This request won the lease and may call StartExecution (TASK-087). */
      readonly outcome: 'LEASE_ACQUIRED';
      readonly idempotencyKey: string;
      readonly decisionId: string;
      readonly record: IdempotencyRecord;
    }
  | {
      /**
       * The key already exists. NOT an error: same-key requests are normal and
       * resolve to `200` / `202` / staged recovery / `409` in TASK-088.
       */
      readonly outcome: 'KEY_ALREADY_EXISTS';
      readonly idempotencyKey: string;
      readonly decisionId: string;
    };

/**
 * Build the initial `starting` record.
 *
 * Exported for TASK-087/088 tests and for the golden shape of a fresh lease.
 */
export function buildFirstLeaseRecord(input: AcquireFirstLeaseInput): IdempotencyRecord {
  const { keyParts, leaseOwner, clock, durations, recoveryMode, recoveryStage } = input;

  if (!leaseOwner) {
    throw new IdempotencyUsageError('acquireFirstLease requires a non-empty "leaseOwner".');
  }
  if (!Number.isFinite(clock.nowEpochMs)) {
    throw new IdempotencyUsageError('acquireFirstLease requires a finite "clock.nowEpochMs".');
  }
  if (!clock.nowDisplay) {
    throw new IdempotencyUsageError('acquireFirstLease requires a non-empty "clock.nowDisplay".');
  }
  if (!(durations.leaseTtlMs > 0)) {
    throw new IdempotencyUsageError('acquireFirstLease requires "durations.leaseTtlMs" > 0.');
  }
  if (!(durations.recordTtlMs > 0)) {
    throw new IdempotencyUsageError('acquireFirstLease requires "durations.recordTtlMs" > 0.');
  }

  const { idempotencyKey, decisionId } = deriveInjectionIdentity(keyParts);

  return {
    idempotency_key: idempotencyKey,
    decision_id: decisionId,
    // starting, never running: MARK_RUNNING owns that transition (PATCH 2).
    status: IdempotencyStatus.starting,
    // First lease is attempt 1; recovery increments it (TASK-094).
    attempt_count: 1,
    lease_owner: leaseOwner,
    lease_expires_at: clock.nowEpochMs + durations.leaseTtlMs,
    last_error: null,
    // Meaningful only once last_error is set; a fresh lease is not yet terminal.
    retryable: true,
    // Written by MARK_RUNNING from $$.Execution.Id — never by InjectFn.
    workflow_execution_arn: null,
    running_started_at: null,
    running_deadline_at: null,
    completed_execution_arn: null,
    completed_attempt_count: null,
    last_transition_execution_arn: null,
    last_transition_attempt_count: null,
    evidence_source: null,
    // Written only by MARK_CORE_COMMITTED (FIX 2). DecisionFn cannot write it.
    core_committed: false,
    recovery_stage: recoveryStage,
    recovery_mode: recoveryMode,
    previous_last_error: null,
    created_at: clock.nowDisplay,
    updated_at: clock.nowDisplay,
    // DynamoDB TTL is epoch SECONDS. Emitting milliseconds here would push
    // expiry ~50,000 years out and the table would never self-clean.
    expires_at: Math.floor((clock.nowEpochMs + durations.recordTtlMs) / 1000),
  };
}

/**
 * Derive the key and attempt the first conditional Put.
 *
 * @returns `LEASE_ACQUIRED` when this request won, `KEY_ALREADY_EXISTS` otherwise
 * @throws IdempotencyKeyError when a key part is invalid
 * @throws IdempotencyUsageError when the lease inputs cannot be correct
 * @throws IdempotencyRepositoryError on a non-conditional DynamoDB failure
 *
 * @example
 * ```ts
 * const result = await acquireFirstLease(repo, {
 *   keyParts: { eventId, eventTimestamp, policyVersion },
 *   leaseOwner: event.requestContext.requestId,
 *   clock, durations, recoveryMode, recoveryStage,
 * });
 *
 * if (result.outcome === 'KEY_ALREADY_EXISTS') return routeSameKeyRequest(result.idempotencyKey);
 * return startExecutionAsLeaseHolder(result.record);
 * ```
 */
export async function acquireFirstLease(
  repository: Pick<IdempotencyRepository, 'conditionalPutNew'>,
  input: AcquireFirstLeaseInput,
): Promise<AcquireFirstLeaseOutcome> {
  const record = buildFirstLeaseRecord(input);

  try {
    const written = await repository.conditionalPutNew(record);
    return {
      outcome: 'LEASE_ACQUIRED',
      idempotencyKey: written.idempotency_key,
      decisionId: written.decision_id,
      record: written,
    };
  } catch (error: unknown) {
    if (error instanceof IdempotencyConditionFailedError) {
      // Expected: a duplicate injection. The caller reads the existing record and
      // routes it (TASK-088); this is never surfaced as an HTTP error.
      return {
        outcome: 'KEY_ALREADY_EXISTS',
        idempotencyKey: record.idempotency_key,
        decisionId: record.decision_id,
      };
    }
    throw error;
  }
}
