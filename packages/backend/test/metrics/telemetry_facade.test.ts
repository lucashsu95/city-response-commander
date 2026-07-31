/**
 * TASK-158 ??Telemetry facade and outcome mapping tests.
 *
 * Three things are pinned:
 *
 *  1. **The facade cannot throw.** Every method returns `void` and swallows sink
 *     failures, because a caller that must wrap instrumentation in `try` will
 *     eventually forget to, and a metric failure would then fail a decision that
 *     is already committed.
 *  2. **Success emits nothing.** `APPLIED`, `ALREADY_APPLIED` and `COMMITTED` are
 *     silent. A counter that fires on the happy path buries its own signal.
 *  3. **The two fencing vocabularies map correctly.** `DIFFERENT_EXECUTION` and
 *     `DIFFERENT_ATTEMPT` collapse to one metric reason; `TARGET_NOT_REACHED` and
 *     `RECORD_MISSING` must not, because they indicate a defect rather than a race.
 */

import { describe, it, expect, vi } from 'vitest';
import { CoreWriteStatus, StatusActionResult } from '@city-commander/shared-schemas';
import type { IdempotencyRecord } from '@city-commander/shared-schemas';
import {
  EmfTelemetry,
  LatencyTrace,
  NoopTelemetry,
  observeCoreWriteOutcome,
  observeIfThrottled,
  observeInFlightRerequest,
  observeStatusOutcome,
  toFencedMetricReason,
  type ApplyOrConfirmOutcome,
  type PersistCoreOutcome,
  type EmfLogLine,
  type EmfSink,
  type FencedReason,
  type Telemetry,
} from '../../src/index.js';

const DECISION = 'DEC_TPE_2026_ACC_001_abcdef123456';
const TRACE = 'trace-abc-123';
const KEY = 'TPE_2026_ACC_001|2026-05-20 22:10|prov-2026a';
const T0 = 1_800_000_000_000;
const EMIT_AT = 1_800_000_009_999;

function recordingSink(): { sink: EmfSink; lines: EmfLogLine[] } {
  const lines: EmfLogLine[] = [];
  return { sink: { write: (line) => void lines.push(line) }, lines };
}

function newTelemetry(sink: EmfSink, onEmitError?: (error: unknown) => void): EmfTelemetry {
  return new EmfTelemetry({
    dimensions: { Environment: 'COMPETITION_AWS' },
    sink,
    now: () => EMIT_AT,
    ...(onEmitError === undefined ? {} : { onEmitError }),
  });
}

function throwingSink(error: Error = new Error('stdout closed')): EmfSink {
  return {
    write: () => {
      throw error;
    },
  };
}

/** Captures calls without any EMF plumbing, for mapping assertions. */
function spyTelemetry(): {
  telemetry: Telemetry;
  conflicts: unknown[][];
  fenced: unknown[][];
  fallbacks: unknown[][];
  throttles: unknown[][];
  latencies: unknown[][];
} {
  const conflicts: unknown[][] = [];
  const fenced: unknown[][] = [];
  const fallbacks: unknown[][] = [];
  const throttles: unknown[][] = [];
  const latencies: unknown[][] = [];
  return {
    conflicts,
    fenced,
    fallbacks,
    throttles,
    latencies,
    telemetry: {
      recordLatency: (...args: unknown[]) => void latencies.push(args),
      recordConflict: (...args: unknown[]) => void conflicts.push(args),
      recordFenced: (...args: unknown[]) => void fenced.push(args),
      recordFallback: (...args: unknown[]) => void fallbacks.push(args),
      recordThrottling: (...args: unknown[]) => void throttles.push(args),
    } as unknown as Telemetry,
  };
}

function record(overrides: Partial<IdempotencyRecord> = {}): IdempotencyRecord {
  return { attempt_count: 2, ...overrides } as unknown as IdempotencyRecord;
}

// ?�?�?� Facade surface ?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�

describe('EmfTelemetry ??shared transport', () => {
  it('emits latency through the same namespace and dimensions as counters', () => {
    const { sink, lines } = recordingSink();
    const telemetry = newTelemetry(sink);
    const trace = new LatencyTrace({ decisionId: DECISION, traceId: TRACE, startedAtMs: T0 });
    trace.markFastPathReady(T0 + 3_000);

    telemetry.recordLatency(trace);
    telemetry.recordConflict('CORE_IDENTITY_CONFLICT', { decisionId: DECISION });

    expect(lines).toHaveLength(2);
    const namespaces = lines.map((line) => line._aws.CloudWatchMetrics[0]?.Namespace);
    expect(new Set(namespaces).size).toBe(1);
    expect(lines.every((line) => line.Environment === 'COMPETITION_AWS')).toBe(true);
  });

  it('exposes each counter verb', () => {
    const { sink, lines } = recordingSink();
    const telemetry = newTelemetry(sink);

    telemetry.recordConflict('DUPLICATE_SAME_DECISION');
    telemetry.recordFenced('FENCED_STALE_EXECUTION', 'MARK_RUNNING');
    telemetry.recordFallback('NARRATIVE_UNAVAILABLE');
    telemetry.recordThrottling('DYNAMODB');

    expect(
      lines.flatMap((line) => line._aws.CloudWatchMetrics[0]?.Metrics.map((m) => m.Name) ?? []),
    ).toEqual([
      'IdempotencyConflictCount',
      'FencedExecutionCount',
      'FallbackTriggeredCount',
      'ThrottlingEventCount',
    ]);
  });

  it('omits an unmeasured latency budget rather than reporting zero', () => {
    const { sink, lines } = recordingSink();
    const trace = new LatencyTrace({ decisionId: DECISION, traceId: TRACE, startedAtMs: T0 });
    trace.markFastPathReady(T0 + 3_000);

    newTelemetry(sink).recordLatency(trace);

    expect(lines[0]).not.toHaveProperty('EndToEndLatencyMs');
    expect(lines[0]).not.toHaveProperty('OfficialSlaMet');
  });

  it('writes nothing for a trace with no measurement at all', () => {
    const { sink, lines } = recordingSink();

    newTelemetry(sink).recordLatency(
      new LatencyTrace({ decisionId: DECISION, traceId: TRACE, startedAtMs: T0 }),
    );

    expect(lines).toEqual([]);
  });

  it('aggregates dropped emissions onto one failure counter', () => {
    const telemetry = newTelemetry(throwingSink());

    telemetry.recordConflict('IN_FLIGHT_REQUEST');
    telemetry.recordFenced('RECORD_MISSING', 'MARK_RUNNING');
    telemetry.recordThrottling('BEDROCK');

    expect(telemetry.failureCount).toBe(3);
  });
});

describe('EmfTelemetry ??fail-safe', () => {
  it('never throws, whichever verb is called', () => {
    const telemetry = newTelemetry(throwingSink());
    const trace = new LatencyTrace({ decisionId: DECISION, traceId: TRACE, startedAtMs: T0 });
    trace.markFastPathReady(T0 + 3_000);

    expect(() => telemetry.recordLatency(trace)).not.toThrow();
    expect(() => telemetry.recordConflict('CORE_IDENTITY_CONFLICT')).not.toThrow();
    expect(() => telemetry.recordFenced('TARGET_NOT_REACHED', 'MARK_COMPLETED')).not.toThrow();
    expect(() => telemetry.recordFallback('ENRICHMENT_TIMEOUT')).not.toThrow();
    expect(() => telemetry.recordThrottling('API_GATEWAY')).not.toThrow();
  });

  it('reports the failure to onEmitError for structured logging', () => {
    const onEmitError = vi.fn();
    const cause = new Error('stdout closed');

    newTelemetry(throwingSink(cause), onEmitError).recordFallback('KB_LOOKUP_FAILED');

    expect(onEmitError).toHaveBeenCalledWith(cause);
  });

  it('returns void, so a metric cannot become part of control flow', () => {
    const { sink } = recordingSink();

    expect(newTelemetry(sink).recordConflict('IN_FLIGHT_REQUEST')).toBeUndefined();
  });
});

describe('observers survive a hostile Telemetry implementation', () => {
  /**
   * `Telemetry` is a public interface: members 4 and 5 may supply their own
   * implementation. The observers must uphold the fail-safe guarantee even when
   * the implementation does not, or a third-party telemetry bug would mask the
   * error a handler was reporting.
   */
  const hostile = new Proxy({} as Telemetry, {
    get: () => () => {
      throw new Error('metric pipeline down');
    },
  });

  it('survives a throwing recordFenced', () => {
    expect(() =>
      observeStatusOutcome(hostile, 'MARK_RUNNING', {
        result: StatusActionResult.FENCED_STALE_EXECUTION,
        record: record(),
        reason: 'DIFFERENT_EXECUTION',
        detail: 'arn mismatch',
      } as ApplyOrConfirmOutcome),
    ).not.toThrow();
  });

  it('survives a throwing recordConflict on either conflict kind', () => {
    expect(() =>
      observeCoreWriteOutcome(hostile, {
        status: CoreWriteStatus.CORE_IDENTITY_CONFLICT,
      } as PersistCoreOutcome),
    ).not.toThrow();
    expect(() => observeInFlightRerequest(hostile)).not.toThrow();
  });

  it('survives a throwing recordThrottling', () => {
    const error = Object.assign(new Error('Rate exceeded'), { name: 'ThrottlingException' });

    expect(() => observeIfThrottled(hostile, error, 'DYNAMODB')).not.toThrow();
  });
});

describe('NoopTelemetry', () => {
  it('satisfies Telemetry without any transport', () => {
    const telemetry: Telemetry = new NoopTelemetry();
    const trace = new LatencyTrace({ decisionId: DECISION, traceId: TRACE, startedAtMs: T0 });
    trace.markFastPathReady(T0 + 3_000);

    expect(() => {
      telemetry.recordLatency(trace);
      telemetry.recordConflict('CORE_IDENTITY_CONFLICT');
      telemetry.recordFenced('RECORD_MISSING', 'MARK_RUNNING');
      telemetry.recordFallback('TRANSLATION_MISSING');
      telemetry.recordThrottling('DYNAMODB');
    }).not.toThrow();
  });
});

// ?�?�?� Fencing reason mapping ?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�

describe('toFencedMetricReason', () => {
  it('collapses both stale-execution reasons onto one metric label', () => {
    // Splitting them would halve the population of an alarm that should watch
    // fencing as a whole.
    expect(toFencedMetricReason('DIFFERENT_EXECUTION')).toBe('FENCED_STALE_EXECUTION');
    expect(toFencedMetricReason('DIFFERENT_ATTEMPT')).toBe('FENCED_STALE_EXECUTION');
  });

  it('keeps TARGET_NOT_REACHED distinct', () => {
    // The record is ours yet the guard failed: a possible defect, not a race.
    expect(toFencedMetricReason('TARGET_NOT_REACHED')).toBe('TARGET_NOT_REACHED');
  });

  it('keeps RECORD_MISSING distinct', () => {
    expect(toFencedMetricReason('RECORD_MISSING')).toBe('RECORD_MISSING');
  });

  it('maps every FencedReason to a legal metric reason', () => {
    const all: readonly FencedReason[] = [
      'RECORD_MISSING',
      'DIFFERENT_EXECUTION',
      'DIFFERENT_ATTEMPT',
      'TARGET_NOT_REACHED',
    ];

    for (const reason of all) {
      expect(['FENCED_STALE_EXECUTION', 'TARGET_NOT_REACHED', 'RECORD_MISSING']).toContain(
        toFencedMetricReason(reason),
      );
    }
  });
});

// ?�?�?� Status outcome mapping ?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�

describe('observeStatusOutcome', () => {
  it('emits nothing for APPLIED', () => {
    const spy = spyTelemetry();

    observeStatusOutcome(spy.telemetry, 'MARK_RUNNING', {
      result: StatusActionResult.APPLIED,
      record: record(),
    } as ApplyOrConfirmOutcome);

    // The happy path must stay silent.
    expect(spy.fenced).toEqual([]);
    expect(spy.conflicts).toEqual([]);
  });

  it('emits nothing for ALREADY_APPLIED', () => {
    const spy = spyTelemetry();

    observeStatusOutcome(spy.telemetry, 'MARK_RUNNING', {
      result: StatusActionResult.ALREADY_APPLIED,
      record: record(),
    } as ApplyOrConfirmOutcome);

    // An at-least-once retry is success, not a fencing event.
    expect(spy.fenced).toEqual([]);
  });

  it('records a fenced transition with the collapsed reason and the action', () => {
    const spy = spyTelemetry();

    observeStatusOutcome(
      spy.telemetry,
      'MARK_CORE_COMMITTED',
      {
        result: StatusActionResult.FENCED_STALE_EXECUTION,
        record: record({ attempt_count: 3 }),
        reason: 'DIFFERENT_EXECUTION',
        detail: 'arn mismatch',
      } as ApplyOrConfirmOutcome,
      { decisionId: DECISION, traceId: TRACE },
    );

    expect(spy.fenced).toEqual([
      [
        'FENCED_STALE_EXECUTION',
        'MARK_CORE_COMMITTED',
        { decisionId: DECISION, traceId: TRACE, attemptCount: 3 },
      ],
    ]);
  });

  it('omits attemptCount when the record no longer exists', () => {
    const spy = spyTelemetry();

    observeStatusOutcome(spy.telemetry, 'MARK_COMPLETED', {
      result: StatusActionResult.FENCED_STALE_EXECUTION,
      record: null,
      reason: 'RECORD_MISSING',
      detail: 'gone',
    } as ApplyOrConfirmOutcome);

    // No record means no attempt to report; inventing 0 would be fabrication.
    expect(spy.fenced[0]?.[2]).toEqual({});
  });
});

// ?�?�?� Core write mapping ?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�

describe('observeCoreWriteOutcome', () => {
  it('emits nothing when the core was freshly committed', () => {
    const spy = spyTelemetry();

    observeCoreWriteOutcome(spy.telemetry, {
      status: CoreWriteStatus.COMMITTED,
    } as PersistCoreOutcome);

    expect(spy.conflicts).toEqual([]);
  });

  it('labels an absorbed duplicate as DUPLICATE_SAME_DECISION', () => {
    const spy = spyTelemetry();

    observeCoreWriteOutcome(
      spy.telemetry,
      { status: CoreWriteStatus.ALREADY_COMMITTED_SAME_DECISION } as PersistCoreOutcome,
      { decisionId: DECISION, idempotencyKey: KEY },
    );

    expect(spy.conflicts).toEqual([
      ['DUPLICATE_SAME_DECISION', { decisionId: DECISION, idempotencyKey: KEY }],
    ]);
  });

  it('labels an immutability violation as CORE_IDENTITY_CONFLICT', () => {
    const spy = spyTelemetry();

    observeCoreWriteOutcome(spy.telemetry, {
      status: CoreWriteStatus.CORE_IDENTITY_CONFLICT,
    } as PersistCoreOutcome);

    // The one an alarm should page on.
    expect(spy.conflicts[0]?.[0]).toBe('CORE_IDENTITY_CONFLICT');
  });

  it('keeps the two conflict kinds on separate labels', () => {
    const spy = spyTelemetry();

    observeCoreWriteOutcome(spy.telemetry, {
      status: CoreWriteStatus.ALREADY_COMMITTED_SAME_DECISION,
    } as PersistCoreOutcome);
    observeCoreWriteOutcome(spy.telemetry, {
      status: CoreWriteStatus.CORE_IDENTITY_CONFLICT,
    } as PersistCoreOutcome);

    expect(spy.conflicts.map((call) => call[0])).toEqual([
      'DUPLICATE_SAME_DECISION',
      'CORE_IDENTITY_CONFLICT',
    ]);
  });
});

// ?�?�?� Re-request and throttling ?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�

describe('observeInFlightRerequest', () => {
  it('labels the 202 path as IN_FLIGHT_REQUEST', () => {
    const spy = spyTelemetry();

    observeInFlightRerequest(spy.telemetry, { decisionId: DECISION });

    expect(spy.conflicts).toEqual([['IN_FLIGHT_REQUEST', { decisionId: DECISION }]]);
  });
});

describe('observeIfThrottled', () => {
  it('records a throttling event for a throttling error', () => {
    const spy = spyTelemetry();
    const error = Object.assign(new Error('Rate exceeded'), { name: 'ThrottlingException' });

    expect(observeIfThrottled(spy.telemetry, error, 'STEP_FUNCTIONS', { attemptNumber: 2 })).toBe(
      true,
    );
    expect(spy.throttles).toEqual([['STEP_FUNCTIONS', { attemptNumber: 2 }]]);
  });

  it('ignores a non-throttling failure', () => {
    const spy = spyTelemetry();

    // Counting every failure as throttling would make it impossible to tell a
    // capacity problem from a bug.
    expect(observeIfThrottled(spy.telemetry, new Error('InvalidArn'), 'STEP_FUNCTIONS')).toBe(
      false,
    );
    expect(spy.throttles).toEqual([]);
  });

  it('still reports true when a throwing implementation swallows the emission', () => {
    const hostile = {
      ...new NoopTelemetry(),
      recordThrottling: () => {
        throw new Error('metric pipeline down');
      },
    } as unknown as Telemetry;
    const error = Object.assign(new Error('Rate exceeded'), { name: 'ThrottlingException' });

    expect(observeIfThrottled(hostile, error, 'DYNAMODB')).toBe(true);
  });

  it('ignores a ConditionalCheckFailedException, which is control flow', () => {
    const spy = spyTelemetry();
    const error = Object.assign(new Error('conditional request failed'), {
      name: 'ConditionalCheckFailedException',
    });

    expect(observeIfThrottled(spy.telemetry, error, 'DYNAMODB')).toBe(false);
  });
});

// ─── Production latency wiring (audit fix 1) ───────────────

describe('production latency emission', () => {
  /**
   * The gap this covers: `LatencyTrace` was tested but nothing on the production
   * path ever called it, so `FastPathLatencyMs` was never produced by a real
   * execution. These tests assert the two call sites that close it.
   */

  it('emits FastPathLatencyMs once DecisionFn marks the Fast Path complete', async () => {
    const { sink, lines } = recordingSink();
    const telemetry = newTelemetry(sink);
    const trace = new LatencyTrace({ decisionId: DECISION, traceId: TRACE, startedAtMs: T0 });

    // What runDecisionFn does after persistDecisionCore succeeds.
    trace.markFastPathReady(T0 + 3_400);
    telemetry.recordLatency(trace.snapshot());

    expect(lines).toHaveLength(1);
    expect(lines[0]?.FastPathLatencyMs).toBe(3_400);
    expect(lines[0]?.FastPathTargetMet).toBe(1);
  });

  it('lets the publisher overwrite an earlier mark with the accurate value', () => {
    const { sink, lines } = recordingSink();
    const telemetry = newTelemetry(sink);
    const trace = new LatencyTrace({ decisionId: DECISION, traceId: TRACE, startedAtMs: T0 });

    // DecisionFn marks at core-committed; the publisher marks again at the push.
    trace.markFastPathReady(T0 + 3_400);
    trace.markFastPathReady(T0 + 4_100);
    telemetry.recordLatency(trace.snapshot());

    // The budget runs to the push, so the later value is the correct one.
    expect(lines[0]?.FastPathLatencyMs).toBe(4_100);
  });

  it('carries the stage durations DecisionFn measured', () => {
    const { sink, lines } = recordingSink();
    const telemetry = newTelemetry(sink);
    const trace = new LatencyTrace({ decisionId: DECISION, traceId: TRACE, startedAtMs: T0 });

    trace.begin('rule_engine', T0 + 100);
    trace.end('rule_engine', T0 + 900);
    trace.begin('core_persistence', T0 + 900);
    trace.end('core_persistence', T0 + 1_200);
    trace.markFastPathReady(T0 + 1_300);
    telemetry.recordLatency(trace.snapshot());

    expect(lines[0]?.stage_rule_engine_ms).toBe(800);
    expect(lines[0]?.stage_core_persistence_ms).toBe(300);
  });
});
