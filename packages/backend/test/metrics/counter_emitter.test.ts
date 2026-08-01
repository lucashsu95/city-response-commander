/**
 * TASK-155 — failure and fallback counter emitter unit tests.
 *
 * What these tests defend:
 *
 *  1. **Reasons are labels, not errors.** A fenced execution or an absorbed
 *     duplicate is the system working. The tests assert the reason reaches
 *     `ActionType` so one alarm can isolate `CORE_IDENTITY_CONFLICT` without
 *     firing on healthy deduplication.
 *  2. **Cardinality stays bounded.** `decision_id`, `idempotency_key` and retry
 *     depth must appear as properties, never as dimensions — otherwise CloudWatch
 *     bills one metric stream per decision.
 *  3. **Emission never interrupts execution.** A broken metric pipeline must not
 *     turn a committed decision into a failed one, but must remain countable.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  CounterMetricEmitter,
  EmfEmitter,
  COUNTER_METRIC_NAMES,
  DEFAULT_METRIC_NAMESPACE,
  StructuredLogger,
  type EmfLogLine,
  type EmfSink,
  type LogSink,
  type StructuredLogRecord,
} from '../../src/index.js';

const DECISION = 'DEC_TPE_2026_ACC_001_abcdef123456';
const TRACE = 'trace-abc-123';
const KEY = 'idem-key-0001';
const EMIT_AT = 1_800_000_009_999;

function recordingSink(): { sink: EmfSink; lines: EmfLogLine[] } {
  const lines: EmfLogLine[] = [];
  return { sink: { write: (line) => void lines.push(line) }, lines };
}

function throwingSink(error: Error = new Error('stdout closed')): EmfSink {
  return {
    write: () => {
      throw error;
    },
  };
}

function newEmitter(
  overrides: { readonly sink?: EmfSink; readonly onEmitError?: (error: unknown) => void } = {},
): EmfEmitter {
  return new EmfEmitter({
    dimensions: { Environment: 'COMPETITION_AWS' },
    ...(overrides.sink === undefined ? {} : { sink: overrides.sink }),
    ...(overrides.onEmitError === undefined ? {} : { onEmitError: overrides.onEmitError }),
    now: () => EMIT_AT,
  });
}

function newCounters(sink: EmfSink): CounterMetricEmitter {
  return new CounterMetricEmitter(newEmitter({ sink }));
}

const CONTEXT = { decisionId: DECISION, traceId: TRACE, idempotencyKey: KEY } as const;

function metricNames(line: EmfLogLine | undefined): readonly string[] {
  return line?._aws.CloudWatchMetrics[0]?.Metrics.map((metric) => metric.Name) ?? [];
}

function dimensionKeys(line: EmfLogLine | undefined): readonly string[] {
  return line?._aws.CloudWatchMetrics[0]?.Dimensions.flat() ?? [];
}

describe('counter names', () => {
  it('pins the four names alarms and dashboards bind to', () => {
    // A published contract with member 3's Metric Filters (TASK-075). Renaming
    // one here silently stops an alarm from ever firing.
    expect(COUNTER_METRIC_NAMES).toEqual({
      IDEMPOTENCY_CONFLICT: 'IdempotencyConflictCount',
      FENCED_EXECUTION: 'FencedExecutionCount',
      FALLBACK_TRIGGERED: 'FallbackTriggeredCount',
      THROTTLING_EVENT: 'ThrottlingEventCount',
    });
  });
});

describe('IdempotencyConflictCount', () => {
  it('emits a Count of 1 in the shared namespace', () => {
    const { sink, lines } = recordingSink();

    newCounters(sink).recordIdempotencyConflict('CORE_IDENTITY_CONFLICT', CONTEXT);

    expect(lines).toHaveLength(1);
    expect(lines[0]?.IdempotencyConflictCount).toBe(1);
    expect(lines[0]?._aws.CloudWatchMetrics[0]).toMatchObject({
      Namespace: DEFAULT_METRIC_NAMESPACE,
      Metrics: [{ Name: 'IdempotencyConflictCount', Unit: 'Count' }],
    });
  });

  it('separates a genuine identity conflict from an absorbed duplicate', () => {
    const { sink, lines } = recordingSink();
    const counters = newCounters(sink);

    counters.recordIdempotencyConflict('DUPLICATE_SAME_DECISION', CONTEXT);
    counters.recordIdempotencyConflict('CORE_IDENTITY_CONFLICT', CONTEXT);

    // Both are the same metric; only ActionType tells them apart. That is what
    // lets an alarm watch the immutability violation without paging on healthy
    // deduplication.
    expect(lines.map((line) => line.ActionType)).toEqual([
      'DUPLICATE_SAME_DECISION',
      'CORE_IDENTITY_CONFLICT',
    ]);
  });

  it('labels an in-flight re-request (the 202 path)', () => {
    const { sink, lines } = recordingSink();

    newCounters(sink).recordIdempotencyConflict('IN_FLIGHT_REQUEST', CONTEXT);

    expect(lines[0]?.ActionType).toBe('IN_FLIGHT_REQUEST');
    expect(lines[0]?.conflict_reason).toBe('IN_FLIGHT_REQUEST');
  });
});

describe('FencedExecutionCount', () => {
  it('emits a Count of 1 carrying the rejected action as the dimension', () => {
    const { sink, lines } = recordingSink();

    newCounters(sink).recordFencedExecution('FENCED_STALE_EXECUTION', 'MARK_RUNNING', CONTEXT);

    expect(lines[0]?.FencedExecutionCount).toBe(1);
    expect(lines[0]?.ActionType).toBe('MARK_RUNNING');
    expect(lines[0]?.fenced_reason).toBe('FENCED_STALE_EXECUTION');
    expect(lines[0]?.action).toBe('MARK_RUNNING');
  });

  it('covers all three TASK-095 fencing classifications', () => {
    const { sink, lines } = recordingSink();
    const counters = newCounters(sink);

    counters.recordFencedExecution('FENCED_STALE_EXECUTION', 'MARK_RUNNING', CONTEXT);
    counters.recordFencedExecution('TARGET_NOT_REACHED', 'MARK_CORE_COMMITTED', CONTEXT);
    counters.recordFencedExecution('RECORD_MISSING', 'MARK_COMPLETED', CONTEXT);

    expect(lines.map((line) => line.fenced_reason)).toEqual([
      'FENCED_STALE_EXECUTION',
      'TARGET_NOT_REACHED',
      'RECORD_MISSING',
    ]);
  });

  it('carries the attempt count as a property, not a dimension', () => {
    const { sink, lines } = recordingSink();

    newCounters(sink).recordFencedExecution('FENCED_STALE_EXECUTION', 'MARK_RUNNING', {
      ...CONTEXT,
      attemptCount: 3,
    });

    expect(lines[0]?.attempt_count).toBe(3);
    expect(dimensionKeys(lines[0])).toEqual(['Environment', 'ActionType']);
  });
});

describe('FallbackTriggeredCount', () => {
  it('emits a Count of 1 when a degraded path served the response', () => {
    const { sink, lines } = recordingSink();

    newCounters(sink).recordFallbackTriggered('NARRATIVE_UNAVAILABLE', CONTEXT);

    expect(lines[0]?.FallbackTriggeredCount).toBe(1);
    expect(lines[0]?.fallback_reason).toBe('NARRATIVE_UNAVAILABLE');
    expect(lines[0]?.ActionType).toBe('NARRATIVE_UNAVAILABLE');
  });

  it('covers the four degraded paths', () => {
    const { sink, lines } = recordingSink();
    const counters = newCounters(sink);

    counters.recordFallbackTriggered('NARRATIVE_UNAVAILABLE', CONTEXT);
    counters.recordFallbackTriggered('KB_LOOKUP_FAILED', CONTEXT);
    counters.recordFallbackTriggered('TRANSLATION_MISSING', CONTEXT);
    counters.recordFallbackTriggered('ENRICHMENT_TIMEOUT', CONTEXT);

    expect(lines.map((line) => line.fallback_reason)).toEqual([
      'NARRATIVE_UNAVAILABLE',
      'KB_LOOKUP_FAILED',
      'TRANSLATION_MISSING',
      'ENRICHMENT_TIMEOUT',
    ]);
    expect(lines.every((line) => line.FallbackTriggeredCount === 1)).toBe(true);
  });

  it('is emittable without any context (a fallback with no decision id yet)', () => {
    const { sink, lines } = recordingSink();

    newCounters(sink).recordFallbackTriggered('KB_LOOKUP_FAILED');

    expect(lines[0]?.FallbackTriggeredCount).toBe(1);
    expect(lines[0]?.decision_id).toBeNull();
  });
});

describe('ThrottlingEventCount', () => {
  it('emits a Count of 1 labelled with the throttling dependency', () => {
    const { sink, lines } = recordingSink();

    newCounters(sink).recordThrottlingEvent('DYNAMODB', CONTEXT);

    expect(lines[0]?.ThrottlingEventCount).toBe(1);
    expect(lines[0]?.ActionType).toBe('DYNAMODB');
    expect(lines[0]?.throttling_source).toBe('DYNAMODB');
  });

  it('covers each throttling source', () => {
    const { sink, lines } = recordingSink();
    const counters = newCounters(sink);

    counters.recordThrottlingEvent('DYNAMODB');
    counters.recordThrottlingEvent('BEDROCK');
    counters.recordThrottlingEvent('STEP_FUNCTIONS');
    counters.recordThrottlingEvent('API_GATEWAY');
    counters.recordThrottlingEvent('CLOUDWATCH');

    expect(lines.map((line) => line.ActionType)).toEqual([
      'DYNAMODB',
      'BEDROCK',
      'STEP_FUNCTIONS',
      'API_GATEWAY',
      'CLOUDWATCH',
    ]);
  });

  it('records retry depth as a property so streams do not multiply per attempt', () => {
    const { sink, lines } = recordingSink();

    newCounters(sink).recordThrottlingEvent('DYNAMODB', { ...CONTEXT, attemptNumber: 4 });

    expect(lines[0]?.attempt_number).toBe(4);
    expect(dimensionKeys(lines[0])).not.toContain('attempt_number');
  });

  it('defaults attempt_number to null rather than 0 when unknown', () => {
    const { sink, lines } = recordingSink();

    newCounters(sink).recordThrottlingEvent('BEDROCK', CONTEXT);

    // 0 would read as "attempt zero"; null reads as "not recorded".
    expect(lines[0]?.attempt_number).toBeNull();
  });
});

describe('consistent dimensions', () => {
  it('applies Environment and ActionType to every counter', () => {
    const { sink, lines } = recordingSink();
    const counters = newCounters(sink);

    counters.recordIdempotencyConflict('CORE_IDENTITY_CONFLICT', CONTEXT);
    counters.recordFencedExecution('FENCED_STALE_EXECUTION', 'MARK_RUNNING', CONTEXT);
    counters.recordFallbackTriggered('NARRATIVE_UNAVAILABLE', CONTEXT);
    counters.recordThrottlingEvent('DYNAMODB', CONTEXT);

    expect(lines).toHaveLength(4);
    for (const line of lines) {
      expect(dimensionKeys(line)).toEqual(['Environment', 'ActionType']);
      expect(line.Environment).toBe('COMPETITION_AWS');
      expect(typeof line.ActionType).toBe('string');
    }
  });

  it('never promotes a high-cardinality id into a dimension', () => {
    const { sink, lines } = recordingSink();
    const counters = newCounters(sink);

    counters.recordIdempotencyConflict('CORE_IDENTITY_CONFLICT', CONTEXT);
    counters.recordFencedExecution('RECORD_MISSING', 'MARK_COMPLETED', CONTEXT);
    counters.recordFallbackTriggered('ENRICHMENT_TIMEOUT', CONTEXT);
    counters.recordThrottlingEvent('BEDROCK', CONTEXT);

    for (const line of lines) {
      const keys = dimensionKeys(line);
      expect(keys).not.toContain('decision_id');
      expect(keys).not.toContain('trace_id');
      expect(keys).not.toContain('idempotency_key');
    }
  });

  it('carries the correlation ids as searchable properties', () => {
    const { sink, lines } = recordingSink();

    newCounters(sink).recordFencedExecution('FENCED_STALE_EXECUTION', 'MARK_RUNNING', {
      ...CONTEXT,
      attemptCount: 2,
    });

    expect(lines[0]).toMatchObject({
      decision_id: DECISION,
      trace_id: TRACE,
      idempotency_key: KEY,
      attempt_count: 2,
    });
  });

  it('emits exactly one metric per line, so a counter cannot be double-counted', () => {
    const { sink, lines } = recordingSink();
    const counters = newCounters(sink);

    counters.recordIdempotencyConflict('IN_FLIGHT_REQUEST', CONTEXT);
    counters.recordThrottlingEvent('DYNAMODB', CONTEXT);

    expect(metricNames(lines[0])).toEqual(['IdempotencyConflictCount']);
    expect(metricNames(lines[1])).toEqual(['ThrottlingEventCount']);
  });

  it('shares the injected clock across all counters', () => {
    const { sink, lines } = recordingSink();

    newCounters(sink).recordFallbackTriggered('KB_LOOKUP_FAILED', CONTEXT);

    expect(lines[0]?._aws.Timestamp).toBe(EMIT_AT);
  });
});

describe('fail-safe emission', () => {
  it('does not throw when the sink fails', () => {
    const counters = new CounterMetricEmitter(newEmitter({ sink: throwingSink() }));

    // Metric emission is observability. It must never convert a committed
    // decision into a failed one.
    expect(() =>
      counters.recordFencedExecution('RECORD_MISSING', 'MARK_RUNNING', CONTEXT),
    ).not.toThrow();
    expect(() =>
      counters.recordIdempotencyConflict('CORE_IDENTITY_CONFLICT', CONTEXT),
    ).not.toThrow();
    expect(() => counters.recordFallbackTriggered('KB_LOOKUP_FAILED', CONTEXT)).not.toThrow();
    expect(() => counters.recordThrottlingEvent('DYNAMODB', CONTEXT)).not.toThrow();
  });

  it('returns null on every counter when emission failed', () => {
    const counters = new CounterMetricEmitter(newEmitter({ sink: throwingSink() }));

    expect(counters.recordIdempotencyConflict('IN_FLIGHT_REQUEST', CONTEXT)).toBeNull();
    expect(
      counters.recordFencedExecution('TARGET_NOT_REACHED', 'MARK_RUNNING', CONTEXT),
    ).toBeNull();
    expect(counters.recordFallbackTriggered('TRANSLATION_MISSING', CONTEXT)).toBeNull();
    expect(counters.recordThrottlingEvent('API_GATEWAY', CONTEXT)).toBeNull();
  });

  it('counts failures on the shared emitter so a dead pipeline stays visible', () => {
    const emitter = newEmitter({ sink: throwingSink() });
    const counters = new CounterMetricEmitter(emitter);

    expect(emitter.failureCount).toBe(0);
    counters.recordIdempotencyConflict('IN_FLIGHT_REQUEST', CONTEXT);
    counters.recordThrottlingEvent('DYNAMODB', CONTEXT);
    counters.recordFallbackTriggered('KB_LOOKUP_FAILED', CONTEXT);

    // Every counter derives a per-ActionType emitter via withActionType(). The
    // failures must still aggregate onto the instance the caller holds —
    // otherwise a totally dead pipeline reports zero losses.
    expect(emitter.failureCount).toBe(3);
  });

  it('routes the failure to the TASK-153 structured logger without throwing', () => {
    const written: StructuredLogRecord[] = [];
    const logSink: LogSink = { write: (_level, record) => void written.push(record) };
    const logger = new StructuredLogger({
      correlation: { trace_id: TRACE, decision_id: DECISION },
      now: () => EMIT_AT,
      sink: logSink,
    });
    const cause = new Error('stdout closed');
    const counters = new CounterMetricEmitter(
      newEmitter({
        sink: throwingSink(cause),
        onEmitError: (error: unknown) =>
          void logger.warn('diagnostic', 'metric emission failed', {
            reason: error instanceof Error ? error.message : String(error),
          }),
      }),
    );

    counters.recordFallbackTriggered('NARRATIVE_UNAVAILABLE', CONTEXT);

    expect(written).toHaveLength(1);
    expect(written[0]).toMatchObject({
      level: 'WARN',
      event: 'diagnostic',
      trace_id: TRACE,
      decision_id: DECISION,
      reason: 'stdout closed',
    });
  });

  it('reports the original error object to onEmitError', () => {
    const onEmitError = vi.fn();
    const cause = new Error('stdout closed');
    const counters = new CounterMetricEmitter(
      newEmitter({ sink: throwingSink(cause), onEmitError }),
    );

    counters.recordThrottlingEvent('CLOUDWATCH', CONTEXT);

    expect(onEmitError).toHaveBeenCalledWith(cause);
  });

  it('keeps recording after a transient sink failure recovers', () => {
    const lines: EmfLogLine[] = [];
    let failNext = true;
    const counters = new CounterMetricEmitter(
      newEmitter({
        sink: {
          write: (line) => {
            if (failNext) {
              failNext = false;
              throw new Error('transient');
            }
            lines.push(line);
          },
        },
      }),
    );

    counters.recordFallbackTriggered('KB_LOOKUP_FAILED', CONTEXT);
    counters.recordFallbackTriggered('KB_LOOKUP_FAILED', CONTEXT);

    expect(lines).toHaveLength(1);
  });
});
