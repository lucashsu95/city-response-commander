/**
 * Observability — deployment verification and SLA gating.
 *
 * @module backend/observability
 */

export {
  evaluateLatencySla,
  parseLatencySamples,
  parseLatencySamplesFromJson,
  percentile,
  summarize,
  formatReport,
  LatencySlaInputError,
  EXIT_CODES,
  DEFAULT_TARGET_PERCENTILE,
  FAST_PATH_TARGET_MS,
  OFFICIAL_DEADLINE_MS,
} from './latency_sla.js';

export type {
  SlaVerdict,
  LatencySample,
  LatencyStatistics,
  SlaViolation,
  LatencySlaReport,
  LatencySlaOptions,
} from './latency_sla.js';

export { main as verifyFastPathLatency, EXIT_CODE_BAD_INPUT } from './verify_fastpath_latency.js';

export type { CliResult, CliDependencies } from './verify_fastpath_latency.js';
