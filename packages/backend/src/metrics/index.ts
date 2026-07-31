/**
 * Metrics — latency instrumentation and CloudWatch EMF emission.
 *
 * @module backend/metrics
 */

export {
  LatencyTrace,
  LatencyTraceUsageError,
  FAST_PATH_TARGET_MS,
  OFFICIAL_DEADLINE_MS,
} from './latency_trace.js';

export type {
  LatencyStage,
  StageMeasurement,
  LatencyTraceSnapshot,
  LatencyLogRecord,
} from './latency_trace.js';

export { EmfEmitter, stdoutEmfSink, DEFAULT_METRIC_NAMESPACE } from './emf.js';

export type {
  MetricUnit,
  MetricDatum,
  MetricDimensions,
  MetricProperties,
  EmfLogLine,
  EmfSink,
  EmfEmitterOptions,
} from './emf.js';

export {
  LatencyMetricEmitter,
  buildLatencyMetrics,
  LATENCY_METRIC_NAMES,
} from './latency_emitter.js';

export { CounterMetricEmitter, COUNTER_METRIC_NAMES } from './counter_emitter.js';

export { EmfTelemetry, NoopTelemetry } from './telemetry_facade.js';

export type { Telemetry, EmfTelemetryOptions } from './telemetry_facade.js';

export {
  observeStatusOutcome,
  observeCoreWriteOutcome,
  observeInFlightRerequest,
  observeIfThrottled,
  toFencedMetricReason,
} from './telemetry_observers.js';

export type {
  IdempotencyConflictReason,
  FencedExecutionReason,
  FallbackReason,
  ThrottlingSource,
  CounterContext,
} from './counter_emitter.js';
