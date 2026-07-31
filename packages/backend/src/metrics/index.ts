/**
 * Metrics — latency instrumentation.
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
