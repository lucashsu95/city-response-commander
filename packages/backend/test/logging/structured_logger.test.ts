/**
 * TASK-153 — structured logging unit tests.
 *
 * The two properties that matter: every line is correlatable (`trace_id`
 * mandatory, `decision_id`/`attempt_count` carried), and no credential-shaped
 * value ever reaches the sink (§19, §17).
 */

import { describe, it, expect, vi } from 'vitest';
import { StructuredLogger, REDACTED, redactSensitive } from '../../src/index.js';
import type { LogLevel, LogSink, StructuredLogRecord } from '../../src/index.js';

const TRACE = 'trace-abc-123';
const DECISION = 'DEC_TPE_2026_ACC_001_abcdef123456';
const KEY = 'TPE_2026_ACC_001|2026-05-20 22:10|prov-2026a';
const EXEC = 'arn:aws:states:::execution:city-commander:exec-1';
// 2026-05-20 14:10:30.123 UTC → 22:10:30.123 in Asia/Taipei.
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

function createLogger(sink: CapturingSink, correlation = {}): StructuredLogger {
  return new StructuredLogger({
    correlation: {
      trace_id: TRACE,
      decision_id: DECISION,
      idempotency_key: KEY,
      attempt_count: 2,
      ...correlation,
    },
    now: () => NOW_MS,
    sink,
  });
}

describe('correlation', () => {
  it('requires a trace_id', () => {
    expect(() => new StructuredLogger({ correlation: { trace_id: '' } })).toThrow(/trace_id/);
  });

  it('stamps every line with the correlation context', () => {
    const sink = createSink();
    createLogger(sink).info('diagnostic', 'hello');

    expect(sink.lines[0].record).toMatchObject({
      trace_id: TRACE,
      decision_id: DECISION,
      idempotency_key: KEY,
      attempt_count: 2,
    });
  });

  it('derives a logger with extra correlation once decision_id is known', () => {
    const sink = createSink();
    const base = new StructuredLogger({
      correlation: { trace_id: TRACE },
      now: () => NOW_MS,
      sink,
    });

    base.withCorrelation({ decision_id: DECISION, attempt_count: 1 }).info('diagnostic', 'x');

    expect(sink.lines[0].record).toMatchObject({ decision_id: DECISION, attempt_count: 1 });
  });

  it('does not mutate the parent logger when deriving', () => {
    const sink = createSink();
    const base = new StructuredLogger({
      correlation: { trace_id: TRACE },
      now: () => NOW_MS,
      sink,
    });

    base.withCorrelation({ decision_id: DECISION });
    base.info('diagnostic', 'x');

    expect(sink.lines[0].record.decision_id).toBeUndefined();
  });
});

describe('timestamp', () => {
  it('is ISO-8601 with an explicit +08:00 Asia/Taipei offset', () => {
    const sink = createSink();
    createLogger(sink).info('diagnostic', 'x');

    expect(sink.lines[0].record.timestamp).toBe('2026-05-20T22:10:30.123+08:00');
  });

  it('never emits a bare Z (host timezone must not be implied)', () => {
    const sink = createSink();
    createLogger(sink).info('diagnostic', 'x');

    expect(sink.lines[0].record.timestamp.endsWith('Z')).toBe(false);
  });
});

describe('levels and events', () => {
  it('routes level and stable event name to the sink', () => {
    const sink = createSink();
    const logger = createLogger(sink);

    logger.info('diagnostic', 'i');
    logger.warn('fencing.intercepted', 'w');
    logger.error('audit.decision_execution', 'e');

    expect(sink.lines.map((l) => l.level)).toEqual(['INFO', 'WARN', 'ERROR']);
    expect(sink.lines.map((l) => l.record.event)).toEqual([
      'diagnostic',
      'fencing.intercepted',
      'audit.decision_execution',
    ]);
  });

  it('produces JSON-serializable records', () => {
    const sink = createSink();
    createLogger(sink).info('diagnostic', 'x', { nested: { a: 1 } });

    expect(() => JSON.stringify(sink.lines[0].record)).not.toThrow();
  });
});

describe('redaction (§17)', () => {
  it.each([
    'password',
    'secret',
    'awsSecretAccessKey',
    'sessionToken',
    'authorization',
    'apiKey',
    'api_key',
    'privateKey',
    'Cookie',
  ])('redacts a "%s" field', (key) => {
    const sink = createSink();
    createLogger(sink).info('diagnostic', 'x', { [key]: 'super-sensitive' });

    expect(JSON.stringify(sink.lines[0].record)).not.toContain('super-sensitive');
    expect((sink.lines[0].record as Record<string, unknown>)[key]).toBe(REDACTED);
  });

  it('redacts nested credential fields', () => {
    const sink = createSink();
    createLogger(sink).info('diagnostic', 'x', {
      config: { region: 'us-east-1', credentials: { accessKeyId: 'AKIA-LEAK' } },
    });

    expect(JSON.stringify(sink.lines[0].record)).not.toContain('AKIA-LEAK');
  });

  it('keeps non-sensitive values intact', () => {
    const sink = createSink();
    createLogger(sink).info('diagnostic', 'x', { segment_id: 'RD_TPE_002', saturation: 0.95 });

    expect(sink.lines[0].record.segment_id).toBe('RD_TPE_002');
    expect(sink.lines[0].record.saturation).toBe(0.95);
  });

  it('tolerates a circular reference (AWS errors self-reference)', () => {
    const circular: Record<string, unknown> = { name: 'ThrottlingException' };
    circular.self = circular;

    expect(redactSensitive(circular)).toMatchObject({ self: '[CIRCULAR]' });
  });

  it('bounds recursion depth', () => {
    let deep: Record<string, unknown> = { value: 'bottom' };
    for (let i = 0; i < 12; i += 1) deep = { nested: deep };

    expect(JSON.stringify(redactSensitive(deep))).toContain('[TRUNCATED]');
  });

  it('redacts inside arrays', () => {
    const sink = createSink();
    createLogger(sink).info('diagnostic', 'x', { items: [{ token: 'leak-me' }] });

    expect(JSON.stringify(sink.lines[0].record)).not.toContain('leak-me');
  });
});

describe('domain helpers', () => {
  it('logs a fencing interception as WARN (fencing working is correct behaviour)', () => {
    const sink = createSink();

    const record = createLogger(sink).fencingIntercepted({
      action: 'MARK_CORE_COMMITTED',
      reason: 'DIFFERENT_EXECUTION',
      detail: 'owned by another execution',
      observedExecutionArn: EXEC,
      observedAttemptCount: 3,
    });

    expect(sink.lines[0].level).toBe('WARN');
    expect(record).toMatchObject({
      event: 'fencing.intercepted',
      action: 'MARK_CORE_COMMITTED',
      fenced_reason: 'DIFFERENT_EXECUTION',
      observed_execution_arn: EXEC,
      observed_attempt_count: 3,
    });
  });

  it('normalizes absent fencing observations to null, not undefined', () => {
    const sink = createSink();

    const record = createLogger(sink).fencingIntercepted({
      action: 'MARK_RUNNING',
      reason: 'RECORD_MISSING',
      detail: 'record gone',
    });

    expect(record.observed_execution_arn).toBeNull();
    expect(record.observed_attempt_count).toBeNull();
  });

  it('logs a staged recovery transition', () => {
    const sink = createSink();

    const record = createLogger(sink).recoveryTransition({
      fromStatus: 'processing_failed',
      toStatus: 'starting',
      recoveryMode: 'ENRICHMENT_ONLY',
      recoveryStage: 'ENRICHMENT_ONLY',
      previousLastError: 'STALE_RUNNING_EXECUTION',
    });

    expect(record).toMatchObject({
      event: 'recovery.transition',
      from_status: 'processing_failed',
      to_status: 'starting',
      recovery_mode: 'ENRICHMENT_ONLY',
      previous_last_error: 'STALE_RUNNING_EXECUTION',
    });
  });

  it('logs the recovery mode selection with its evidence', () => {
    const sink = createSink();

    const record = createLogger(sink).recoveryModeSelected({
      recommendedRecoveryMode: 'ENRICHMENT_ONLY',
      effectiveCoreCommitted: true,
      coreExists: true,
      missingNarrativeTypes: ['PUBLIC_ALERT'],
    });

    expect(record).toMatchObject({
      event: 'recovery.mode_selected',
      effective_core_committed: true,
      core_exists: true,
      missing_narrative_types: ['PUBLIC_ALERT'],
    });
  });

  it('logs lease acquisition and release', () => {
    const sink = createSink();
    const logger = createLogger(sink);

    logger.leaseAcquired({
      leaseOwner: 'req-bbb',
      leaseExpiresAt: NOW_MS + 30_000,
      recoveryMode: 'FULL_WORKFLOW',
      isRecovery: true,
    });
    logger.leaseReleased({ reason: 'completed', status: 'completed' });

    expect(sink.lines[0].record).toMatchObject({
      event: 'lease.acquired',
      lease_owner: 'req-bbb',
      is_recovery: true,
    });
    expect(sink.lines[1].record).toMatchObject({
      event: 'lease.released',
      release_reason: 'completed',
    });
  });

  it('logs the decision execution audit trail', () => {
    const sink = createSink();

    const record = createLogger(sink).decisionExecutionAudit({
      status: 'completed',
      coreWriteStatus: 'COMMITTED',
      workflowExecutionName: 'exec-name-1',
      sourceManifestHash: 'sha256:AAAA',
      coreHash: 'sha256:CORE-1',
    });

    expect(record).toMatchObject({
      event: 'audit.decision_execution',
      status: 'completed',
      core_write_status: 'COMMITTED',
      workflow_execution_name: 'exec-name-1',
      source_manifest_hash: 'sha256:AAAA',
    });
    // Correlation is still present on the audit line.
    expect(record.trace_id).toBe(TRACE);
    expect(record.decision_id).toBe(DECISION);
  });
});
