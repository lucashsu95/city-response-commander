/**
 * TASK-159 — security alerting unit tests.
 *
 * The severity split is the point: only `CORE_IDENTITY_CONFLICT` is
 * `CRITICAL_SECURITY_ALERT`. Fencing and lease collisions are `WARN` because they
 * are the concurrency control working; only their RATE is interesting.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  SecurityAlerting,
  StructuredLogger,
  SECURITY_ALERT_LEVELS,
  SECURITY_ALERT_METRICS,
  REDACTED,
} from '../../src/index.js';
import type { LogLevel, LogSink, StructuredLogRecord } from '../../src/index.js';

const TRACE = 'trace-abc-123';
const DECISION = 'DEC_TPE_2026_ACC_001_abcdef123456';
const EXEC = 'arn:aws:states:::execution:city-commander:exec-1';
const OTHER_EXEC = 'arn:aws:states:::execution:city-commander:exec-2';
const NOW_MS = Date.UTC(2026, 4, 20, 14, 10, 30, 123);

interface CapturingSink extends LogSink {
  readonly lines: { level: LogLevel; record: StructuredLogRecord }[];
}

function createSink(): CapturingSink {
  const lines: { level: LogLevel; record: StructuredLogRecord }[] = [];
  return {
    lines,
    write: vi.fn((level: LogLevel, record: StructuredLogRecord) => {
      lines.push({ level, record });
    }),
  };
}

function createAlerting(sink: CapturingSink): SecurityAlerting {
  return new SecurityAlerting(
    new StructuredLogger({
      correlation: { trace_id: TRACE, decision_id: DECISION, attempt_count: 2 },
      now: () => NOW_MS,
      sink,
    }),
  );
}

describe('severity policy', () => {
  it('treats only a core identity conflict as critical', () => {
    expect(SECURITY_ALERT_LEVELS.core_identity_conflict).toBe('CRITICAL_SECURITY_ALERT');
  });

  it('treats fencing and lease collisions as WARN (they are correct behaviour)', () => {
    expect(SECURITY_ALERT_LEVELS.fenced_execution_attempt).toBe('WARN');
    expect(SECURITY_ALERT_LEVELS.idempotency_lease_collision).toBe('WARN');
    expect(SECURITY_ALERT_LEVELS.stale_running_reconciled).toBe('WARN');
    expect(SECURITY_ALERT_LEVELS.rate_limit_breached).toBe('WARN');
  });

  it('assigns a distinct metric name to every event', () => {
    const metrics = Object.values(SECURITY_ALERT_METRICS);

    expect(new Set(metrics).size).toBe(metrics.length);
    expect(Object.keys(SECURITY_ALERT_METRICS).sort()).toEqual(
      Object.keys(SECURITY_ALERT_LEVELS).sort(),
    );
  });
});

describe('fencedExecutionAttempt', () => {
  it('emits WARN with both the expected and observed fencing terms', () => {
    const sink = createSink();

    const record = createAlerting(sink).fencedExecutionAttempt({
      action: 'MARK_CORE_COMMITTED',
      reason: 'DIFFERENT_EXECUTION',
      detail: 'owned by another execution',
      expectedExecutionArn: EXEC,
      observedExecutionArn: OTHER_EXEC,
      expectedAttempt: 1,
      observedAttempt: 2,
    });

    expect(sink.lines[0].level).toBe('WARN');
    expect(record).toMatchObject({
      security_event: 'fenced_execution_attempt',
      alert_metric: 'FencedExecutionAttemptCount',
      expected_execution_arn: EXEC,
      observed_execution_arn: OTHER_EXEC,
      expected_attempt: 1,
      observed_attempt: 2,
    });
  });

  it('normalizes absent observations to null', () => {
    const sink = createSink();

    const record = createAlerting(sink).fencedExecutionAttempt({
      action: 'MARK_RUNNING',
      reason: 'RECORD_MISSING',
      detail: 'record gone',
      expectedExecutionArn: EXEC,
      expectedAttempt: 1,
    });

    expect(record.observed_execution_arn).toBeNull();
    expect(record.observed_attempt).toBeNull();
  });
});

describe('staleRunningReconciled', () => {
  it('emits WARN with how overdue the execution was', () => {
    const sink = createSink();

    const record = createAlerting(sink).staleRunningReconciled({
      staleExecutionArn: EXEC,
      staleAttempt: 2,
      observedRunningDeadlineAt: NOW_MS - 5_000,
      overdueByMs: 5_000,
      recoveryStage: 'FULL_WORKFLOW',
    });

    expect(sink.lines[0].level).toBe('WARN');
    expect(record).toMatchObject({
      security_event: 'stale_running_reconciled',
      alert_metric: 'StaleRunningReconciledCount',
      stale_execution_arn: EXEC,
      overdue_by_ms: 5_000,
      recovery_stage: 'FULL_WORKFLOW',
    });
  });
});

describe('coreIdentityConflict', () => {
  it('emits CRITICAL_SECURITY_ALERT', () => {
    const sink = createSink();

    createAlerting(sink).coreIdentityConflict({
      mismatches: [{ field: 'core_hash', expected: 'sha256:A', actual: 'sha256:B' }],
      storedCoreHash: 'sha256:B',
      computedCoreHash: 'sha256:A',
    });

    expect(sink.lines[0].level).toBe('CRITICAL_SECURITY_ALERT');
  });

  it('names the diverged fields so the cause is diagnosable', () => {
    const sink = createSink();

    const record = createAlerting(sink).coreIdentityConflict({
      mismatches: [
        { field: 'core_hash', expected: 'sha256:A', actual: 'sha256:B' },
        { field: 'source_manifest_hash', expected: 'sha256:M1', actual: 'sha256:M2' },
      ],
      storedCoreHash: 'sha256:B',
      computedCoreHash: 'sha256:A',
    });

    expect(record.mismatched_fields).toEqual(['core_hash', 'source_manifest_hash']);
  });

  it('records that the system failed closed and will not retry', () => {
    const sink = createSink();

    const record = createAlerting(sink).coreIdentityConflict({
      mismatches: [{ field: 'core_hash', expected: 'a', actual: 'b' }],
      storedCoreHash: 'b',
      computedCoreHash: 'a',
    });

    expect(record).toMatchObject({ retryable: false, fail_closed: true });
    expect(record.message).toContain('without overwriting the immutable core');
  });

  it('carries the correlation context so the alert is actionable', () => {
    const sink = createSink();

    const record = createAlerting(sink).coreIdentityConflict({
      mismatches: [],
      storedCoreHash: null,
      computedCoreHash: null,
    });

    expect(record.trace_id).toBe(TRACE);
    expect(record.decision_id).toBe(DECISION);
    expect(record.attempt_count).toBe(2);
    expect(record.timestamp).toBe('2026-05-20T22:10:30.123+08:00');
  });
});

describe('idempotencyLeaseCollision', () => {
  it('emits WARN with the contended transition', () => {
    const sink = createSink();

    const record = createAlerting(sink).idempotencyLeaseCollision({
      attemptedLeaseOwner: 'req-bbb',
      transition: 'processing_failed -> starting',
      observedStatus: 'starting',
    });

    expect(sink.lines[0].level).toBe('WARN');
    expect(record).toMatchObject({
      security_event: 'idempotency_lease_collision',
      alert_metric: 'IdempotencyLeaseCollisionCount',
      attempted_lease_owner: 'req-bbb',
      transition: 'processing_failed -> starting',
    });
  });
});

describe('rateLimitBreached', () => {
  it('emits WARN with attempts and limit', () => {
    const sink = createSink();

    const record = createAlerting(sink).rateLimitBreached({
      operation: 'conditionalUpdateState',
      attempts: 3,
      limit: 3,
      retryable: true,
    });

    expect(sink.lines[0].level).toBe('WARN');
    expect(record).toMatchObject({
      security_event: 'rate_limit_breached',
      alert_metric: 'RateLimitBreachedCount',
      operation: 'conditionalUpdateState',
      attempts: 3,
      limit: 3,
    });
  });
});

describe('no credential leakage (§17)', () => {
  it('redacts credential-shaped context through the shared logger', () => {
    const sink = createSink();
    const logger = new StructuredLogger({
      correlation: { trace_id: TRACE },
      now: () => NOW_MS,
      sink,
    });

    // Alerts go through the same redaction path as every other log line.
    logger.log('CRITICAL_SECURITY_ALERT', 'audit.decision_execution', 'x', {
      sessionToken: 'leak-me',
      nested: { awsSecretAccessKey: 'also-leak' },
    });

    const serialized = JSON.stringify(sink.lines[0].record);
    expect(serialized).not.toContain('leak-me');
    expect(serialized).not.toContain('also-leak');
    expect(sink.lines[0].record.sessionToken).toBe(REDACTED);
  });

  it('emits hashes and ids only, never official source content', () => {
    const sink = createSink();

    const record = createAlerting(sink).coreIdentityConflict({
      mismatches: [{ field: 'core_hash', expected: 'sha256:A', actual: 'sha256:B' }],
      storedCoreHash: 'sha256:B',
      computedCoreHash: 'sha256:A',
    });

    const serialized = JSON.stringify(record);
    expect(serialized).toContain('sha256:');
    // Nothing resembling a raw official record is present.
    expect(serialized).not.toContain('Saturation_Score');
    expect(serialized).not.toContain('Roaming_User_Pct');
  });
});

describe('withCorrelation', () => {
  it('derives an alerter carrying extra correlation', () => {
    const sink = createSink();

    createAlerting(sink)
      .withCorrelation({ workflow_execution_arn: EXEC })
      .rateLimitBreached({ operation: 'x', attempts: 1, limit: 1, retryable: false });

    expect(sink.lines[0].record.workflow_execution_arn).toBe(EXEC);
  });
});
