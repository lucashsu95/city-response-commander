/**
 * Fast Path latency verification and SLA gate (design §19, §20; TASK-105).
 *
 * Consumes the EMF lines that {@link LatencyMetricEmitter} (TASK-154) writes and
 * decides whether a deployment met its latency budgets. Intended to run after a
 * deploy and in CI, where its exit code is the gate.
 *
 * ## The two budgets are judged differently, on purpose
 *
 * | Budget | Value | Judged on | Why |
 * | ------ | ----- | --------- | --- |
 * | Team Fast Path target | 5 000 ms | p95 | An internal goal. One slow cold start should not fail a release. |
 * | Official deadline | 60 000 ms | worst case | A per-decision hard requirement. A single decision over 60 s is a decision that missed it. |
 *
 * Averaging the official deadline across a run would let a genuinely late
 * decision disappear into a healthy-looking percentile, so every violation is
 * listed individually.
 *
 * ## Zero samples is a failure, not a pass
 *
 * The subtle way a gate like this goes wrong: an empty sample set trivially
 * satisfies "every sample is under 5 000 ms", so a script that only checks
 * thresholds reports PASS for a system that was never deployed, never invoked, or
 * whose Log Group name was mistyped. The verdict is therefore
 * `INSUFFICIENT_DATA` (a distinct, non-zero exit code) whenever there is nothing
 * to measure, and `minSamples` lets a caller demand a meaningful population
 * before believing a PASS.
 *
 * No values are ever defaulted or interpolated (§21): a sample missing
 * `fast_path_ms` is excluded from the Fast Path population rather than counted
 * as zero.
 *
 * @module backend/observability/latency_sla
 */

import { FAST_PATH_TARGET_MS, OFFICIAL_DEADLINE_MS } from '../metrics/latency_trace.js';
import { LATENCY_METRIC_NAMES } from '../metrics/latency_emitter.js';

export { FAST_PATH_TARGET_MS, OFFICIAL_DEADLINE_MS };

/** Percentile used for the team Fast Path target unless overridden. */
export const DEFAULT_TARGET_PERCENTILE = 95;

/** Verdict of an SLA evaluation. */
export type SlaVerdict =
  /** Both budgets met, with enough samples to mean it. */
  | 'PASS'
  /** At least one budget was missed. */
  | 'SLA_VIOLATION'
  /** Nothing to measure, or fewer samples than `minSamples`. Never a pass. */
  | 'INSUFFICIENT_DATA';

/** Exit codes, distinct so CI can tell a real regression from a bad query. */
export const EXIT_CODES: Readonly<Record<SlaVerdict, number>> = {
  PASS: 0,
  SLA_VIOLATION: 1,
  INSUFFICIENT_DATA: 2,
};

/** One measured decision. `null` means "not measured", never "zero". */
export interface LatencySample {
  readonly decisionId: string | null;
  readonly traceId: string | null;
  readonly fastPathMs: number | null;
  readonly endToEndMs: number | null;
}

/** Distribution of one latency population. All values in milliseconds. */
export interface LatencyStatistics {
  readonly count: number;
  readonly min: number;
  readonly p50: number;
  readonly p95: number;
  readonly p99: number;
  readonly max: number;
}

/** A decision that exceeded a budget. */
export interface SlaViolation {
  readonly decisionId: string | null;
  readonly traceId: string | null;
  readonly metric: string;
  readonly observedMs: number;
  readonly thresholdMs: number;
}

/** Machine-readable verification report. Serialised as the script's stdout. */
export interface LatencySlaReport {
  readonly verdict: SlaVerdict;
  readonly exit_code: number;
  readonly evaluated_at: string;
  readonly thresholds: {
    readonly fast_path_target_ms: number;
    readonly official_deadline_ms: number;
    readonly target_percentile: number;
    readonly min_samples: number;
  };
  readonly fast_path: {
    readonly metric: string;
    readonly statistics: LatencyStatistics | null;
    /** Percentile value compared against the target; `null` with no samples. */
    readonly evaluated_ms: number | null;
    readonly compliant: boolean | null;
  };
  readonly end_to_end: {
    readonly metric: string;
    readonly statistics: LatencyStatistics | null;
    /** Worst case compared against the official deadline. */
    readonly evaluated_ms: number | null;
    readonly compliant: boolean | null;
  };
  readonly violations: readonly SlaViolation[];
  /** Populated only for INSUFFICIENT_DATA, explaining what was missing. */
  readonly insufficient_data_reason: string | null;
  readonly sample_count: number;
}

/** Tunables. Every field has an explicit default drawn from the design. */
export interface LatencySlaOptions {
  readonly fastPathTargetMs?: number;
  readonly officialDeadlineMs?: number;
  readonly targetPercentile?: number;
  /** Minimum Fast Path samples required before a PASS is believable. */
  readonly minSamples?: number;
  /** Injected for deterministic reports. */
  readonly evaluatedAt?: string;
}

/** Raised for malformed input; never for an SLA violation. */
export class LatencySlaInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LatencySlaInputError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Accept a finite, non-negative number; anything else counts as unmeasured. */
function readLatency(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
}

function readId(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Nearest-rank percentile (inclusive) over an ascending array.
 *
 * Chosen over linear interpolation because a latency SLO should report a value
 * that an actual request experienced, not one synthesised between two samples.
 */
export function percentile(ascending: readonly number[], p: number): number {
  if (ascending.length === 0) {
    throw new LatencySlaInputError('percentile requires at least one sample.');
  }
  if (!Number.isFinite(p) || p <= 0 || p > 100) {
    throw new LatencySlaInputError(`percentile requires 0 < p <= 100; received ${String(p)}.`);
  }
  const rank = Math.ceil((p / 100) * ascending.length);
  const index = Math.min(Math.max(rank - 1, 0), ascending.length - 1);
  return ascending[index] as number;
}

/** Summarise a population. `null` when there is nothing to summarise. */
export function summarize(values: readonly number[]): LatencyStatistics | null {
  if (values.length === 0) return null;
  const ascending = [...values].sort((left, right) => left - right);
  return {
    count: ascending.length,
    min: ascending[0] as number,
    p50: percentile(ascending, 50),
    p95: percentile(ascending, 95),
    p99: percentile(ascending, 99),
    max: ascending[ascending.length - 1] as number,
  };
}

/**
 * Extract samples from whatever the log query produced.
 *
 * Accepts, in order of preference:
 *  - an array of EMF lines as written by `LatencyMetricEmitter`
 *  - `{ samples: [...] }` or `{ Records: [...] }` wrappers
 *  - CloudWatch Logs Insights `{ results: [[{ field, value }, ...], ...] }`
 *
 * Lines carrying neither latency metric are skipped rather than defaulted, so a
 * mixed log stream (counters, structured logs) can be piped in unfiltered.
 */
export function parseLatencySamples(input: unknown): readonly LatencySample[] {
  const rows = normalizeRows(input);
  const samples: LatencySample[] = [];

  for (const row of rows) {
    if (!isRecord(row)) continue;
    const fastPathMs = readLatency(row[LATENCY_METRIC_NAMES.FAST_PATH_LATENCY_MS]);
    const endToEndMs = readLatency(row[LATENCY_METRIC_NAMES.END_TO_END_LATENCY_MS]);
    if (fastPathMs === null && endToEndMs === null) continue;

    samples.push({
      decisionId: readId(row.decision_id),
      traceId: readId(row.trace_id),
      fastPathMs,
      endToEndMs,
    });
  }
  return samples;
}

function normalizeRows(input: unknown): readonly unknown[] {
  if (Array.isArray(input)) return input;

  if (isRecord(input)) {
    if (Array.isArray(input.samples)) return input.samples;
    if (Array.isArray(input.Records)) return input.Records;
    if (Array.isArray(input.results)) {
      // Insights returns rows of {field, value}; values arrive as strings.
      return input.results.map((row) => flattenInsightsRow(row));
    }
    // A single EMF line.
    return [input];
  }
  throw new LatencySlaInputError(
    'Unrecognised latency input: expected an array of EMF lines, or an object with "samples", "Records" or "results".',
  );
}

function flattenInsightsRow(row: unknown): Record<string, unknown> {
  const flattened: Record<string, unknown> = {};
  if (!Array.isArray(row)) return flattened;

  for (const cell of row) {
    if (!isRecord(cell)) continue;
    const field = cell.field;
    const value = cell.value;
    if (typeof field !== 'string') continue;
    if (typeof value === 'string') {
      const asNumber = Number(value);
      flattened[field] = value.length > 0 && Number.isFinite(asNumber) ? asNumber : value;
    } else {
      flattened[field] = value;
    }
  }
  return flattened;
}

/**
 * Parse a JSON document into samples.
 *
 * A leading UTF-8 BOM is stripped. Exports from Windows tooling and some AWS CLI
 * redirections carry one, and letting it surface as "malformed JSON" would send
 * an operator hunting for a query bug that does not exist.
 */
export function parseLatencySamplesFromJson(text: string): readonly LatencySample[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch (error: unknown) {
    throw new LatencySlaInputError(
      `Latency input is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  return parseLatencySamples(parsed);
}

/**
 * Evaluate both budgets and produce the report.
 *
 * @param samples measured decisions; an empty array yields `INSUFFICIENT_DATA`
 */
export function evaluateLatencySla(
  samples: readonly LatencySample[],
  options: LatencySlaOptions = {},
): LatencySlaReport {
  const fastPathTargetMs = options.fastPathTargetMs ?? FAST_PATH_TARGET_MS;
  const officialDeadlineMs = options.officialDeadlineMs ?? OFFICIAL_DEADLINE_MS;
  const targetPercentile = options.targetPercentile ?? DEFAULT_TARGET_PERCENTILE;
  const minSamples = options.minSamples ?? 1;
  const evaluatedAt = options.evaluatedAt ?? new Date().toISOString();

  const fastPathValues = samples
    .map((sample) => sample.fastPathMs)
    .filter((value): value is number => value !== null);
  const endToEndValues = samples
    .map((sample) => sample.endToEndMs)
    .filter((value): value is number => value !== null);

  const fastPathStats = summarize(fastPathValues);
  const endToEndStats = summarize(endToEndValues);

  // The team target is a goal, so it is judged on a percentile.
  const fastPathEvaluated =
    fastPathStats === null
      ? null
      : percentile(
          [...fastPathValues].sort((a, b) => a - b),
          targetPercentile,
        );
  // The official deadline is a per-decision requirement, so it is judged on the
  // worst case.
  const endToEndEvaluated = endToEndStats?.max ?? null;

  const violations: SlaViolation[] = [];
  for (const sample of samples) {
    if (sample.fastPathMs !== null && sample.fastPathMs > fastPathTargetMs) {
      violations.push({
        decisionId: sample.decisionId,
        traceId: sample.traceId,
        metric: LATENCY_METRIC_NAMES.FAST_PATH_LATENCY_MS,
        observedMs: sample.fastPathMs,
        thresholdMs: fastPathTargetMs,
      });
    }
    if (sample.endToEndMs !== null && sample.endToEndMs > officialDeadlineMs) {
      violations.push({
        decisionId: sample.decisionId,
        traceId: sample.traceId,
        metric: LATENCY_METRIC_NAMES.END_TO_END_LATENCY_MS,
        observedMs: sample.endToEndMs,
        thresholdMs: officialDeadlineMs,
      });
    }
  }

  const fastPathCompliant =
    fastPathEvaluated === null ? null : fastPathEvaluated <= fastPathTargetMs;
  const officialCompliant =
    endToEndEvaluated === null ? null : endToEndEvaluated <= officialDeadlineMs;

  const insufficientDataReason = describeInsufficientData(
    samples.length,
    fastPathValues.length,
    minSamples,
  );

  const verdict: SlaVerdict =
    insufficientDataReason !== null
      ? 'INSUFFICIENT_DATA'
      : fastPathCompliant === false || officialCompliant === false
        ? 'SLA_VIOLATION'
        : 'PASS';

  return {
    verdict,
    exit_code: EXIT_CODES[verdict],
    evaluated_at: evaluatedAt,
    thresholds: {
      fast_path_target_ms: fastPathTargetMs,
      official_deadline_ms: officialDeadlineMs,
      target_percentile: targetPercentile,
      min_samples: minSamples,
    },
    fast_path: {
      metric: LATENCY_METRIC_NAMES.FAST_PATH_LATENCY_MS,
      statistics: fastPathStats,
      evaluated_ms: fastPathEvaluated,
      compliant: fastPathCompliant,
    },
    end_to_end: {
      metric: LATENCY_METRIC_NAMES.END_TO_END_LATENCY_MS,
      statistics: endToEndStats,
      evaluated_ms: endToEndEvaluated,
      compliant: officialCompliant,
    },
    violations,
    insufficient_data_reason: insufficientDataReason,
    sample_count: samples.length,
  };
}

function describeInsufficientData(
  sampleCount: number,
  fastPathCount: number,
  minSamples: number,
): string | null {
  if (sampleCount === 0) {
    return 'No latency samples were found. An empty result set cannot demonstrate compliance.';
  }
  if (fastPathCount === 0) {
    return `Found ${String(sampleCount)} sample(s) but none carried ${LATENCY_METRIC_NAMES.FAST_PATH_LATENCY_MS}.`;
  }
  if (fastPathCount < minSamples) {
    return `Found ${String(fastPathCount)} Fast Path sample(s); minSamples=${String(minSamples)} required.`;
  }
  return null;
}

/** Serialise the report as the script's stdout payload. */
export function formatReport(report: LatencySlaReport): string {
  return JSON.stringify(report, null, 2);
}
