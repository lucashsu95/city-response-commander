/**
 * Security alerting and anomaly signals (design §15.2, §19, §21.2; TASK-159).
 *
 * Two distinct severities, because conflating them would either drown the team in
 * noise or hide the one thing that actually matters:
 *
 *  - **`WARN`** — expected-but-watchable events. A single fenced execution or one
 *    lease collision is the concurrency control *working*. Only an abnormal RATE
 *    is interesting, which is why these emit a countable signal rather than an
 *    alarm.
 *  - **`CRITICAL_SECURITY_ALERT`** — `CORE_IDENTITY_CONFLICT`. A different
 *    decision is already committed under this idempotency key, which means either
 *    a key collision or an attempt to overwrite an immutable official decision.
 *    The system fails closed (§15.2) and this line is the human-facing signal.
 *
 * Every alert emits a stable `security_event` name and an `alert_metric`, so a
 * CloudWatch Metric Filter can route on the field instead of grepping prose:
 *
 * ```
 * { $.level = "CRITICAL_SECURITY_ALERT" }                     → alarm
 * { $.security_event = "fenced_execution_attempt" }           → rate metric
 * ```
 *
 * Nothing sensitive is emitted: every payload goes through the same redaction as
 * the structured logger (§17), and the `core_hash` values in a conflict report
 * are hashes, not source content.
 *
 * @module backend/security/security_alerting
 */

import { StructuredLogger } from '../logging/structured_logger.js';
import type { LogLevel, StructuredLogRecord } from '../logging/structured_logger.js';

/** Stable security event names for CloudWatch Metric Filters. */
export type SecurityEvent =
  /** An execution was fenced out of a guarded transition (TASK-095). */
  | 'fenced_execution_attempt'
  /** A stale `running` execution was reconciled (TASK-091). */
  | 'stale_running_reconciled'
  /** DecisionCore identity mismatch — terminal, fail-closed (TASK-101). */
  | 'core_identity_conflict'
  /** Two requests contended for the same lease (TASK-086 / TASK-094). */
  | 'idempotency_lease_collision'
  /** Downstream throttling / rate-limit threshold breached (§21.2). */
  | 'rate_limit_breached';

/** Metric name emitted alongside each alert, for metric-filter routing. */
export const SECURITY_ALERT_METRICS: Readonly<Record<SecurityEvent, string>> = {
  fenced_execution_attempt: 'FencedExecutionAttemptCount',
  stale_running_reconciled: 'StaleRunningReconciledCount',
  core_identity_conflict: 'CoreIdentityConflictCount',
  idempotency_lease_collision: 'IdempotencyLeaseCollisionCount',
  rate_limit_breached: 'RateLimitBreachedCount',
};

/** Severity per event. Only an identity conflict is treated as critical. */
export const SECURITY_ALERT_LEVELS: Readonly<Record<SecurityEvent, LogLevel>> = {
  fenced_execution_attempt: 'WARN',
  stale_running_reconciled: 'WARN',
  // Fail-closed and human-facing: a different decision exists under this key.
  core_identity_conflict: 'CRITICAL_SECURITY_ALERT',
  idempotency_lease_collision: 'WARN',
  rate_limit_breached: 'WARN',
};

/** Emitted alert record. */
export interface SecurityAlertRecord extends StructuredLogRecord {
  readonly security_event: SecurityEvent;
  readonly alert_metric: string;
}

/**
 * Emits security signals on top of a correlated {@link StructuredLogger}.
 *
 * It deliberately holds a logger rather than a raw sink, so alerts inherit the
 * same `trace_id`/`decision_id` correlation and the same redaction as every other
 * line — an alert that cannot be tied to its execution is not actionable.
 */
export class SecurityAlerting {
  constructor(private readonly logger: StructuredLogger) {}

  /** Derive an alerter with additional correlation fields. */
  withCorrelation(extra: Parameters<StructuredLogger['withCorrelation']>[0]): SecurityAlerting {
    return new SecurityAlerting(this.logger.withCorrelation(extra));
  }

  private emit(
    event: SecurityEvent,
    message: string,
    context: Record<string, unknown>,
  ): SecurityAlertRecord {
    const record = this.logger.log(
      SECURITY_ALERT_LEVELS[event],
      // Fencing reuses the audit event name; the discriminator is `security_event`.
      event === 'fenced_execution_attempt' ? 'fencing.intercepted' : 'audit.decision_execution',
      message,
      {
        ...context,
        security_event: event,
        alert_metric: SECURITY_ALERT_METRICS[event],
      },
    );
    return record as SecurityAlertRecord;
  }

  /**
   * An execution was fenced out (TASK-095).
   *
   * `WARN`: one interception is correct behaviour under concurrency. The metric
   * exists so an abnormal rate — which would suggest duplicate injection or a
   * misconfigured deadline — becomes visible.
   */
  fencedExecutionAttempt(input: {
    readonly action: string;
    readonly reason: string;
    readonly detail: string;
    readonly expectedExecutionArn: string;
    readonly observedExecutionArn?: string | null;
    readonly expectedAttempt: number;
    readonly observedAttempt?: number | null;
  }): SecurityAlertRecord {
    return this.emit('fenced_execution_attempt', `Fenced ${input.action} (${input.reason})`, {
      action: input.action,
      fenced_reason: input.reason,
      fenced_detail: input.detail,
      expected_execution_arn: input.expectedExecutionArn,
      observed_execution_arn: input.observedExecutionArn ?? null,
      expected_attempt: input.expectedAttempt,
      observed_attempt: input.observedAttempt ?? null,
    });
  }

  /** A stale `running` execution was reconciled (TASK-091). */
  staleRunningReconciled(input: {
    readonly staleExecutionArn: string;
    readonly staleAttempt: number;
    readonly observedRunningDeadlineAt: number;
    readonly overdueByMs: number;
    readonly recoveryStage: string;
  }): SecurityAlertRecord {
    return this.emit(
      'stale_running_reconciled',
      `Reconciled stale running execution (overdue ${String(input.overdueByMs)}ms)`,
      {
        stale_execution_arn: input.staleExecutionArn,
        stale_attempt: input.staleAttempt,
        observed_running_deadline_at: input.observedRunningDeadlineAt,
        overdue_by_ms: input.overdueByMs,
        recovery_stage: input.recoveryStage,
      },
    );
  }

  /**
   * DecisionCore identity mismatch — the only `CRITICAL_SECURITY_ALERT`.
   *
   * Reports WHICH identity fields diverged so the cause is diagnosable. The values
   * are hashes and ids, never official source content.
   */
  coreIdentityConflict(input: {
    readonly mismatches: readonly { field: string; expected: string; actual: string }[];
    readonly storedCoreHash: string | null;
    readonly computedCoreHash: string | null;
  }): SecurityAlertRecord {
    return this.emit(
      'core_identity_conflict',
      'CORE_IDENTITY_CONFLICT: a different decision is already committed for this key; ' +
        'failing closed without overwriting the immutable core',
      {
        mismatched_fields: input.mismatches.map((mismatch) => mismatch.field),
        mismatches: input.mismatches,
        stored_core_hash: input.storedCoreHash,
        computed_core_hash: input.computedCoreHash,
        retryable: false,
        fail_closed: true,
      },
    );
  }

  /** Two requests contended for the same lease (TASK-086 / TASK-094). */
  idempotencyLeaseCollision(input: {
    readonly attemptedLeaseOwner: string;
    readonly transition: string;
    readonly observedStatus?: string | null;
  }): SecurityAlertRecord {
    return this.emit(
      'idempotency_lease_collision',
      `Lease collision on ${input.transition}; another request holds the lease`,
      {
        attempted_lease_owner: input.attemptedLeaseOwner,
        transition: input.transition,
        observed_status: input.observedStatus ?? null,
      },
    );
  }

  /** A throttling / rate-limit threshold was breached (§21.2). */
  rateLimitBreached(input: {
    readonly operation: string;
    readonly attempts: number;
    readonly limit: number;
    readonly retryable: boolean;
  }): SecurityAlertRecord {
    return this.emit(
      'rate_limit_breached',
      `Rate limit breached on ${input.operation} after ${String(input.attempts)} attempts`,
      {
        operation: input.operation,
        attempts: input.attempts,
        limit: input.limit,
        retryable: input.retryable,
      },
    );
  }
}
