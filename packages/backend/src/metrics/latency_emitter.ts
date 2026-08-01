/**
 * Latency metric emission (design §19, §20; TASK-154).
 *
 * Publishes the four values the latency panel and the 60 s alarm read:
 *
 * | Metric                 | Unit         | Meaning |
 * | ---------------------- | ------------ | ------- |
 * | `FastPathLatencyMs`    | Milliseconds | detection → `fast_path_ready` |
 * | `EndToEndLatencyMs`    | Milliseconds | detection → `enriched` |
 * | `FastPathTargetMet`    | Count (1/0)  | `<= 5 000 ms` — TEAM_TARGET, not official |
 * | `OfficialSlaMet`       | Count (1/0)  | `<= 60 000 ms` — OFFICIAL hard deadline |
 *
 * Two design points carried through from `LatencyTrace`:
 *
 *  - **Unmeasured is not zero.** A decision whose enrichment has not finished has
 *    `end_to_end_ms === null`. Emitting `0` would make the dashboard average look
 *    excellent and the SLA look met. Null metrics are simply omitted.
 *  - **The two budgets stay separate.** `FastPathTargetMet` is a team target;
 *    `OfficialSlaMet` is the graded indicator (REQ-004). They are distinct metrics
 *    so an alarm can watch the official one without firing on the internal one.
 *
 * Per-stage durations are emitted as log properties rather than metrics: one
 * metric stream per stage would multiply cost for data that Logs Insights can
 * already aggregate.
 *
 * @module backend/metrics/latency_emitter
 */

import type { EmfEmitter, EmfLogLine, MetricDatum } from './emf.js';
import type { LatencyTrace, LatencyTraceSnapshot } from './latency_trace.js';

/** Metric names. Stable: alarms and dashboards bind to these strings. */
export const LATENCY_METRIC_NAMES = {
  FAST_PATH_LATENCY_MS: 'FastPathLatencyMs',
  END_TO_END_LATENCY_MS: 'EndToEndLatencyMs',
  FAST_PATH_TARGET_MET: 'FastPathTargetMet',
  OFFICIAL_SLA_MET: 'OfficialSlaMet',
} as const;

/** Build the metric data for a snapshot. Unmeasured values are omitted. */
export function buildLatencyMetrics(snapshot: LatencyTraceSnapshot): readonly MetricDatum[] {
  const metrics: MetricDatum[] = [];

  if (snapshot.fast_path_ms !== null) {
    metrics.push({
      name: LATENCY_METRIC_NAMES.FAST_PATH_LATENCY_MS,
      value: snapshot.fast_path_ms,
      unit: 'Milliseconds',
    });
  }
  if (snapshot.fast_path_target_met !== null) {
    metrics.push({
      name: LATENCY_METRIC_NAMES.FAST_PATH_TARGET_MET,
      value: snapshot.fast_path_target_met ? 1 : 0,
      unit: 'Count',
    });
  }
  if (snapshot.end_to_end_ms !== null) {
    metrics.push({
      name: LATENCY_METRIC_NAMES.END_TO_END_LATENCY_MS,
      value: snapshot.end_to_end_ms,
      unit: 'Milliseconds',
    });
  }
  if (snapshot.official_deadline_met !== null) {
    metrics.push({
      name: LATENCY_METRIC_NAMES.OFFICIAL_SLA_MET,
      value: snapshot.official_deadline_met ? 1 : 0,
      unit: 'Count',
    });
  }

  return metrics;
}

/** Latency metric publisher. */
export class LatencyMetricEmitter {
  constructor(private readonly emitter: EmfEmitter) {}

  /**
   * Publish the latency metrics for one decision.
   *
   * Never throws (the underlying EMF emitter is fail-safe), and returns `null`
   * when nothing was measured yet.
   *
   * @example
   * ```ts
   * trace.markFastPathReady(now());
   * latencyMetrics.emitSnapshot(trace);   // safe even if enrichment is pending
   * ```
   */
  emitSnapshot(source: LatencyTrace | LatencyTraceSnapshot): EmfLogLine | null {
    const snapshot = 'snapshot' in source ? source.snapshot() : source;
    const metrics = buildLatencyMetrics(snapshot);

    if (metrics.length === 0) return null;

    const stageDurations = Object.fromEntries(
      snapshot.stages.map((stage) => [`stage_${stage.stage}_ms`, stage.duration_ms]),
    );

    return this.emitter.emit(metrics, {
      trace_id: snapshot.trace_id,
      decision_id: snapshot.decision_id,
      // Thresholds travel with the datapoint so a dashboard cannot drift from the
      // values the code actually applied.
      fast_path_target_ms: snapshot.fast_path_target_ms,
      official_deadline_ms: snapshot.official_deadline_ms,
      ...stageDurations,
    });
  }
}
