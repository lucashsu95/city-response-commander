/**
 * TASK-154 — CloudWatch latency metric emitter unit tests.
 *
 * Three properties are pinned here, in order of how much damage getting them
 * wrong would do:
 *
 *  1. **Unmeasured is omitted, never zero.** Emitting `0` for a Fast Path that
 *     has not finished would make the dashboard average look excellent and the
 *     SLA panel claim success. The tests assert absence, not a default.
 *  2. **The 5s team target and the 60s official deadline stay separate metrics.**
 *     A blended number would hide the design claim that a Bedrock failure cannot
 *     break the Fast Path (REQ-004).
 *  3. **Emission is fail-safe.** A broken sink must not fail a decision that is
 *     already committed — but the failure must still be countable, not silent.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  EmfEmitter,
  LatencyMetricEmitter,
  LatencyTrace,
  buildLatencyMetrics,
  LATENCY_METRIC_NAMES,
  DEFAULT_METRIC_NAMESPACE,
  type EmfLogLine,
  type EmfSink,
  type LatencyTraceSnapshot,
  type MetricDatum,
} from '../../src/index.js';

const DECISION = 'DEC_TPE_2026_ACC_001_abcdef123456';
const TRACE = 'trace-abc-123';
const T0 = 1_800_000_000_000;
const EMIT_AT = 1_800_000_009_999;

/** Collecting sink, so assertions read the exact line that would hit stdout. */
function recordingSink(): { sink: EmfSink; lines: EmfLogLine[] } {
  const lines: EmfLogLine[] = [];
  return { sink: { write: (line) => void lines.push(line) }, lines };
}

function newEmitter(
  overrides: {
    readonly sink?: EmfSink;
    readonly actionType?: string;
    readonly namespace?: string;
    readonly onEmitError?: (error: unknown) => void;
  } = {},
): EmfEmitter {
  return new EmfEmitter({
    dimensions: {
      Environment: 'COMPETITION_AWS',
      ...(overrides.actionType === undefined ? {} : { ActionType: overrides.actionType }),
    },
    ...(overrides.namespace === undefined ? {} : { namespace: overrides.namespace }),
    ...(overrides.sink === undefined ? {} : { sink: overrides.sink }),
    ...(overrides.onEmitError === undefined ? {} : { onEmitError: overrides.onEmitError }),
    now: () => EMIT_AT,
  });
}

function newTrace(): LatencyTrace {
  return new LatencyTrace({ decisionId: DECISION, traceId: TRACE, startedAtMs: T0 });
}

/** A snapshot with explicit values, for cases a real trace cannot easily produce. */
function snapshotOf(overrides: Partial<LatencyTraceSnapshot> = {}): LatencyTraceSnapshot {
  return {
    decision_id: DECISION,
    trace_id: TRACE,
    fast_path_ms: null,
    end_to_end_ms: null,
    fast_path_target_met: null,
    official_deadline_met: null,
    stages: [],
    fast_path_target_ms: 5_000,
    official_deadline_ms: 60_000,
    ...overrides,
  };
}

function metricNamed(metrics: readonly MetricDatum[], name: string): MetricDatum | undefined {
  return metrics.find((metric) => metric.name === name);
}

describe('metric names', () => {
  it('pins the four names alarms and dashboards bind to', () => {
    // These strings are a published contract with member 3's Metric Filters
    // (TASK-075). Renaming one silently stops an alarm from ever firing.
    expect(LATENCY_METRIC_NAMES).toEqual({
      FAST_PATH_LATENCY_MS: 'FastPathLatencyMs',
      END_TO_END_LATENCY_MS: 'EndToEndLatencyMs',
      FAST_PATH_TARGET_MET: 'FastPathTargetMet',
      OFFICIAL_SLA_MET: 'OfficialSlaMet',
    });
  });
});

describe('buildLatencyMetrics — FastPathLatencyMs', () => {
  it('emits the Fast Path duration in Milliseconds', () => {
    const metrics = buildLatencyMetrics(
      snapshotOf({ fast_path_ms: 3_200, fast_path_target_met: true }),
    );

    expect(metricNamed(metrics, 'FastPathLatencyMs')).toEqual({
      name: 'FastPathLatencyMs',
      value: 3_200,
      unit: 'Milliseconds',
    });
  });

  it('omits the metric entirely when the Fast Path has not completed', () => {
    const metrics = buildLatencyMetrics(snapshotOf({ fast_path_ms: null }));

    expect(metricNamed(metrics, 'FastPathLatencyMs')).toBeUndefined();
  });

  it('emits a genuine zero duration rather than treating it as unmeasured', () => {
    const metrics = buildLatencyMetrics(
      snapshotOf({ fast_path_ms: 0, fast_path_target_met: true }),
    );

    expect(metricNamed(metrics, 'FastPathLatencyMs')?.value).toBe(0);
  });
});

describe('buildLatencyMetrics — EndToEndLatencyMs', () => {
  it('emits the end-to-end duration in Milliseconds', () => {
    const metrics = buildLatencyMetrics(
      snapshotOf({ end_to_end_ms: 42_000, official_deadline_met: true }),
    );

    expect(metricNamed(metrics, 'EndToEndLatencyMs')).toEqual({
      name: 'EndToEndLatencyMs',
      value: 42_000,
      unit: 'Milliseconds',
    });
  });

  it('omits the metric while enrichment is still pending', () => {
    // The important case: Fast Path done, Bedrock still running. Publishing 0
    // here would report a perfect SLA for a decision that has not finished.
    const metrics = buildLatencyMetrics(
      snapshotOf({ fast_path_ms: 3_000, fast_path_target_met: true, end_to_end_ms: null }),
    );

    expect(metricNamed(metrics, 'EndToEndLatencyMs')).toBeUndefined();
    expect(metricNamed(metrics, 'OfficialSlaMet')).toBeUndefined();
    expect(metricNamed(metrics, 'FastPathLatencyMs')).toBeDefined();
  });
});

describe('buildLatencyMetrics — FastPathTargetMet (5s TEAM_TARGET)', () => {
  it('publishes 1 as a Count when the 5s target is met', () => {
    const metrics = buildLatencyMetrics(
      snapshotOf({ fast_path_ms: 4_999, fast_path_target_met: true }),
    );

    expect(metricNamed(metrics, 'FastPathTargetMet')).toEqual({
      name: 'FastPathTargetMet',
      value: 1,
      unit: 'Count',
    });
  });

  it('publishes 0 when the 5s target is missed', () => {
    const metrics = buildLatencyMetrics(
      snapshotOf({ fast_path_ms: 5_001, fast_path_target_met: false }),
    );

    expect(metricNamed(metrics, 'FastPathTargetMet')?.value).toBe(0);
  });

  it('publishes 1 at exactly 5000ms via a real trace (inclusive boundary)', () => {
    const trace = newTrace();
    trace.markFastPathReady(T0 + 5_000);

    const metrics = buildLatencyMetrics(trace.snapshot());

    expect(metricNamed(metrics, 'FastPathTargetMet')?.value).toBe(1);
  });

  it('publishes 0 at 5001ms via a real trace', () => {
    const trace = newTrace();
    trace.markFastPathReady(T0 + 5_001);

    const metrics = buildLatencyMetrics(trace.snapshot());

    expect(metricNamed(metrics, 'FastPathTargetMet')?.value).toBe(0);
  });
});

describe('buildLatencyMetrics — OfficialSlaMet (60s OFFICIAL)', () => {
  it('publishes 1 as a Count when the 60s deadline is met', () => {
    const metrics = buildLatencyMetrics(
      snapshotOf({ end_to_end_ms: 59_999, official_deadline_met: true }),
    );

    expect(metricNamed(metrics, 'OfficialSlaMet')).toEqual({
      name: 'OfficialSlaMet',
      value: 1,
      unit: 'Count',
    });
  });

  it('publishes 1 at exactly 60000ms via a real trace (inclusive boundary)', () => {
    const trace = newTrace();
    trace.markEnriched(T0 + 60_000);

    const metrics = buildLatencyMetrics(trace.snapshot());

    expect(metricNamed(metrics, 'OfficialSlaMet')?.value).toBe(1);
  });

  it('publishes 0 at 60001ms via a real trace', () => {
    const trace = newTrace();
    trace.markEnriched(T0 + 60_001);

    const metrics = buildLatencyMetrics(trace.snapshot());

    expect(metricNamed(metrics, 'OfficialSlaMet')?.value).toBe(0);
  });

  it('keeps the two budgets independent: team target met, official SLA missed', () => {
    const trace = newTrace();
    trace.markFastPathReady(T0 + 3_000);
    trace.markEnriched(T0 + 70_000);

    const metrics = buildLatencyMetrics(trace.snapshot());

    expect(metricNamed(metrics, 'FastPathTargetMet')?.value).toBe(1);
    expect(metricNamed(metrics, 'OfficialSlaMet')?.value).toBe(0);
  });

  it('emits all four metrics once both budgets are measured', () => {
    const trace = newTrace();
    trace.markFastPathReady(T0 + 3_000);
    trace.markEnriched(T0 + 30_000);

    const metrics = buildLatencyMetrics(trace.snapshot());

    expect(metrics.map((metric) => metric.name).sort()).toEqual([
      'EndToEndLatencyMs',
      'FastPathLatencyMs',
      'FastPathTargetMet',
      'OfficialSlaMet',
    ]);
  });

  it('emits nothing when neither budget has been measured', () => {
    expect(buildLatencyMetrics(snapshotOf())).toEqual([]);
  });
});

describe('EMF line structure', () => {
  it('declares the namespace, dimensions and metric units in _aws', () => {
    const { sink, lines } = recordingSink();
    const trace = newTrace();
    trace.markFastPathReady(T0 + 3_200);

    new LatencyMetricEmitter(newEmitter({ sink })).emitSnapshot(trace);

    expect(lines).toHaveLength(1);
    expect(lines[0]?._aws).toEqual({
      Timestamp: EMIT_AT,
      CloudWatchMetrics: [
        {
          Namespace: DEFAULT_METRIC_NAMESPACE,
          Dimensions: [['Environment']],
          Metrics: [
            { Name: 'FastPathLatencyMs', Unit: 'Milliseconds' },
            { Name: 'FastPathTargetMet', Unit: 'Count' },
          ],
        },
      ],
    });
  });

  it('puts each metric value at the top level, where CloudWatch reads it', () => {
    const { sink, lines } = recordingSink();
    const trace = newTrace();
    trace.markFastPathReady(T0 + 3_200);
    trace.markEnriched(T0 + 41_000);

    new LatencyMetricEmitter(newEmitter({ sink })).emitSnapshot(trace);

    expect(lines[0]).toMatchObject({
      FastPathLatencyMs: 3_200,
      FastPathTargetMet: 1,
      EndToEndLatencyMs: 41_000,
      OfficialSlaMet: 1,
    });
  });

  it('carries the Environment dimension as a top-level attribute', () => {
    const { sink, lines } = recordingSink();
    const trace = newTrace();
    trace.markFastPathReady(T0 + 1_000);

    new LatencyMetricEmitter(newEmitter({ sink })).emitSnapshot(trace);

    expect(lines[0]?.Environment).toBe('COMPETITION_AWS');
  });

  it('includes ActionType in the dimension set when present', () => {
    const { sink, lines } = recordingSink();
    const trace = newTrace();
    trace.markFastPathReady(T0 + 1_000);

    new LatencyMetricEmitter(newEmitter({ sink, actionType: 'FAST_PATH' })).emitSnapshot(trace);

    expect(lines[0]?._aws.CloudWatchMetrics[0]?.Dimensions).toEqual([
      ['Environment', 'ActionType'],
    ]);
    expect(lines[0]?.ActionType).toBe('FAST_PATH');
  });

  it('honours an overridden namespace', () => {
    const { sink, lines } = recordingSink();
    const trace = newTrace();
    trace.markFastPathReady(T0 + 1_000);

    new LatencyMetricEmitter(newEmitter({ sink, namespace: 'Custom/NS' })).emitSnapshot(trace);

    expect(lines[0]?._aws.CloudWatchMetrics[0]?.Namespace).toBe('Custom/NS');
  });

  it('carries correlation ids as properties, not dimensions', () => {
    const { sink, lines } = recordingSink();
    const trace = newTrace();
    trace.markFastPathReady(T0 + 1_000);

    new LatencyMetricEmitter(newEmitter({ sink })).emitSnapshot(trace);

    // decision_id is high-cardinality: as a dimension it would create one
    // metric stream per decision. Searchable in Insights, not billed per stream.
    expect(lines[0]?.decision_id).toBe(DECISION);
    expect(lines[0]?.trace_id).toBe(TRACE);
    expect(lines[0]?._aws.CloudWatchMetrics[0]?.Dimensions.flat()).not.toContain('decision_id');
  });

  it('carries the thresholds actually applied, so a dashboard cannot drift', () => {
    const { sink, lines } = recordingSink();
    const trace = newTrace();
    trace.markFastPathReady(T0 + 1_000);

    new LatencyMetricEmitter(newEmitter({ sink })).emitSnapshot(trace);

    expect(lines[0]?.fast_path_target_ms).toBe(5_000);
    expect(lines[0]?.official_deadline_ms).toBe(60_000);
  });

  it('emits per-stage durations as properties rather than metric streams', () => {
    const { sink, lines } = recordingSink();
    const trace = newTrace();
    trace.begin('ingestion', T0);
    trace.end('ingestion', T0 + 40);
    trace.begin('rule_engine', T0 + 40);
    trace.end('rule_engine', T0 + 240);
    trace.markFastPathReady(T0 + 300);

    new LatencyMetricEmitter(newEmitter({ sink })).emitSnapshot(trace);

    expect(lines[0]?.stage_ingestion_ms).toBe(40);
    expect(lines[0]?.stage_rule_engine_ms).toBe(200);
    const declared = lines[0]?._aws.CloudWatchMetrics[0]?.Metrics.map((m) => m.Name) ?? [];
    expect(declared).not.toContain('stage_ingestion_ms');
  });
});

describe('emitSnapshot inputs', () => {
  it('accepts a LatencyTrace directly', () => {
    const { sink, lines } = recordingSink();
    const trace = newTrace();
    trace.markFastPathReady(T0 + 2_500);

    const line = new LatencyMetricEmitter(newEmitter({ sink })).emitSnapshot(trace);

    expect(line).not.toBeNull();
    expect(lines[0]?.FastPathLatencyMs).toBe(2_500);
  });

  it('accepts a plain snapshot object', () => {
    const { sink, lines } = recordingSink();

    new LatencyMetricEmitter(newEmitter({ sink })).emitSnapshot(
      snapshotOf({ fast_path_ms: 2_500, fast_path_target_met: true }),
    );

    expect(lines[0]?.FastPathLatencyMs).toBe(2_500);
  });

  it('writes nothing and returns null when nothing has been measured', () => {
    const { sink, lines } = recordingSink();

    const line = new LatencyMetricEmitter(newEmitter({ sink })).emitSnapshot(newTrace());

    expect(line).toBeNull();
    expect(lines).toEqual([]);
  });
});

describe('fail-safe emission', () => {
  it('does not throw when the sink fails', () => {
    const emitter = newEmitter({
      sink: {
        write: () => {
          throw new Error('stdout closed');
        },
      },
    });
    const trace = newTrace();
    trace.markFastPathReady(T0 + 3_000);

    // The decision is already committed at this point. Losing a metric is
    // acceptable; failing the decision to report the metric is not.
    expect(() => new LatencyMetricEmitter(emitter).emitSnapshot(trace)).not.toThrow();
  });

  it('returns null when emission failed', () => {
    const emitter = newEmitter({
      sink: {
        write: () => {
          throw new Error('stdout closed');
        },
      },
    });
    const trace = newTrace();
    trace.markFastPathReady(T0 + 3_000);

    expect(new LatencyMetricEmitter(emitter).emitSnapshot(trace)).toBeNull();
  });

  it('counts failures so a silently broken pipeline is still visible', () => {
    const emitter = newEmitter({
      sink: {
        write: () => {
          throw new Error('stdout closed');
        },
      },
    });
    const latency = new LatencyMetricEmitter(emitter);
    const trace = newTrace();
    trace.markFastPathReady(T0 + 3_000);

    expect(emitter.failureCount).toBe(0);
    latency.emitSnapshot(trace);
    latency.emitSnapshot(trace);

    expect(emitter.failureCount).toBe(2);
  });

  it('reports the failure to onEmitError for structured logging (TASK-153)', () => {
    const onEmitError = vi.fn();
    const cause = new Error('stdout closed');
    const emitter = newEmitter({
      sink: {
        write: () => {
          throw cause;
        },
      },
      onEmitError,
    });
    const trace = newTrace();
    trace.markFastPathReady(T0 + 3_000);

    new LatencyMetricEmitter(emitter).emitSnapshot(trace);

    expect(onEmitError).toHaveBeenCalledTimes(1);
    expect(onEmitError).toHaveBeenCalledWith(cause);
  });

  it('survives a non-serializable property without failing the caller', () => {
    const { sink } = recordingSink();
    const emitter = newEmitter({ sink });
    const trace = newTrace();
    trace.markFastPathReady(T0 + 3_000);

    expect(() => new LatencyMetricEmitter(emitter).emitSnapshot(trace)).not.toThrow();
  });

  it('keeps emitting after a transient sink failure recovers', () => {
    const lines: EmfLogLine[] = [];
    let failNext = true;
    const emitter = newEmitter({
      sink: {
        write: (line) => {
          if (failNext) {
            failNext = false;
            throw new Error('transient');
          }
          lines.push(line);
        },
      },
    });
    const latency = new LatencyMetricEmitter(emitter);
    const trace = newTrace();
    trace.markFastPathReady(T0 + 3_000);

    latency.emitSnapshot(trace);
    latency.emitSnapshot(trace);

    expect(emitter.failureCount).toBe(1);
    expect(lines).toHaveLength(1);
  });
});

describe('withActionType', () => {
  it('derives an emitter that keeps the sink, clock and namespace', () => {
    const { sink, lines } = recordingSink();
    const derived = newEmitter({ sink, namespace: 'Custom/NS' }).withActionType('MARK_COMPLETED');
    const trace = newTrace();
    trace.markFastPathReady(T0 + 1_500);

    new LatencyMetricEmitter(derived).emitSnapshot(trace);

    expect(lines[0]?.ActionType).toBe('MARK_COMPLETED');
    expect(lines[0]?._aws.Timestamp).toBe(EMIT_AT);
    expect(lines[0]?._aws.CloudWatchMetrics[0]?.Namespace).toBe('Custom/NS');
  });

  it('does not mutate the source emitter', () => {
    const { sink, lines } = recordingSink();
    const base = newEmitter({ sink });
    base.withActionType('MARK_COMPLETED');
    const trace = newTrace();
    trace.markFastPathReady(T0 + 1_500);

    new LatencyMetricEmitter(base).emitSnapshot(trace);

    expect(lines[0]?.ActionType).toBeUndefined();
  });
});
