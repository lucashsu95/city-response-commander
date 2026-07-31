/**
 * TASK-105 — Fast Path latency SLA gate tests.
 *
 * The most important behaviour under test is the one a naive implementation gets
 * wrong: **an empty sample set must not pass.** Every sample in an empty set is
 * under 5 000 ms, so a threshold-only check reports success for a system that was
 * never deployed or whose log query matched nothing. Several tests below exist
 * purely to keep that door shut.
 *
 * The second theme is that the two budgets are judged differently — the 5 s team
 * target on a percentile, the 60 s official deadline on the worst case — and that
 * a missing measurement is excluded rather than counted as zero (§21).
 */

import { describe, it, expect } from 'vitest';
import {
  EXIT_CODES,
  EXIT_CODE_BAD_INPUT,
  LatencySlaInputError,
  evaluateLatencySla,
  parseLatencySamples,
  parseLatencySamplesFromJson,
  percentile,
  summarize,
  verifyFastPathLatency,
  type CliDependencies,
  type LatencySample,
  type LatencySlaReport,
} from '../../src/index.js';

const AT = '2026-05-20T14:10:00.000Z';

function sample(overrides: Partial<LatencySample> = {}): LatencySample {
  return {
    decisionId: 'DEC_A',
    traceId: 'trace-a',
    fastPathMs: 3_000,
    endToEndMs: 30_000,
    ...overrides,
  };
}

function emfLine(fastPathMs: number | null, endToEndMs: number | null): Record<string, unknown> {
  return {
    _aws: { Timestamp: 1_800_000_000_000, CloudWatchMetrics: [] },
    decision_id: 'DEC_A',
    trace_id: 'trace-a',
    ...(fastPathMs === null ? {} : { FastPathLatencyMs: fastPathMs }),
    ...(endToEndMs === null ? {} : { EndToEndLatencyMs: endToEndMs }),
  };
}

function evaluate(
  samples: readonly LatencySample[],
  options: Parameters<typeof evaluateLatencySla>[1] = {},
): LatencySlaReport {
  return evaluateLatencySla(samples, { evaluatedAt: AT, ...options });
}

function cli(
  argv: readonly string[],
  text: string,
  env: Record<string, string | undefined> = {},
): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  const dependencies: CliDependencies = {
    readFile: async () => text,
    readStdin: async () => text,
    evaluatedAt: AT,
  };
  return verifyFastPathLatency(argv, env, dependencies);
}

// ─── Percentiles ───────────────────────────────────────────

describe('percentile', () => {
  it('returns a value that a real request actually experienced', () => {
    const ascending = [10, 20, 30, 40, 50];

    // Nearest-rank, not interpolated: reporting 35 for p70 would name a latency
    // no request ever saw.
    expect(percentile(ascending, 70)).toBe(40);
  });

  it('computes p50, p95 and p99 by nearest rank', () => {
    const ascending = Array.from({ length: 100 }, (_, index) => index + 1);

    expect(percentile(ascending, 50)).toBe(50);
    expect(percentile(ascending, 95)).toBe(95);
    expect(percentile(ascending, 99)).toBe(99);
  });

  it('returns the only sample for a single-element population', () => {
    expect(percentile([42], 50)).toBe(42);
    expect(percentile([42], 99)).toBe(42);
  });

  it('returns the maximum at p100', () => {
    expect(percentile([1, 2, 3], 100)).toBe(3);
  });

  it('rejects an empty population instead of returning zero', () => {
    expect(() => percentile([], 95)).toThrow(LatencySlaInputError);
  });

  it('rejects a percentile outside (0, 100]', () => {
    expect(() => percentile([1], 0)).toThrow(LatencySlaInputError);
    expect(() => percentile([1], 101)).toThrow(LatencySlaInputError);
  });
});

describe('summarize', () => {
  it('reports the full distribution', () => {
    expect(summarize([50, 10, 30, 20, 40])).toEqual({
      count: 5,
      min: 10,
      p50: 30,
      p95: 50,
      p99: 50,
      max: 50,
    });
  });

  it('returns null rather than a zeroed distribution when empty', () => {
    expect(summarize([])).toBeNull();
  });
});

// ─── Parsing ───────────────────────────────────────────────

describe('parseLatencySamples', () => {
  it('reads an array of EMF lines from the TASK-154 emitter', () => {
    const samples = parseLatencySamples([emfLine(3_000, 30_000), emfLine(4_000, 40_000)]);

    expect(samples).toEqual([
      { decisionId: 'DEC_A', traceId: 'trace-a', fastPathMs: 3_000, endToEndMs: 30_000 },
      { decisionId: 'DEC_A', traceId: 'trace-a', fastPathMs: 4_000, endToEndMs: 40_000 },
    ]);
  });

  it('skips lines carrying neither latency metric', () => {
    // A real log stream also contains counters and structured logs; they are
    // ignored rather than parsed as zero-latency decisions.
    const samples = parseLatencySamples([
      { IdempotencyConflictCount: 1, decision_id: 'DEC_B' },
      emfLine(3_000, null),
    ]);

    expect(samples).toHaveLength(1);
    expect(samples[0]?.fastPathMs).toBe(3_000);
  });

  it('keeps a partially measured decision as null, not zero', () => {
    const samples = parseLatencySamples([emfLine(3_000, null)]);

    // Enrichment still pending. Recording 0 would claim a perfect official SLA.
    expect(samples[0]?.endToEndMs).toBeNull();
  });

  it('rejects a negative or non-finite latency as unmeasured', () => {
    expect(parseLatencySamples([emfLine(-1, Number.NaN)])).toEqual([]);
  });

  it('accepts a samples wrapper', () => {
    expect(parseLatencySamples({ samples: [emfLine(1_000, 2_000)] })).toHaveLength(1);
  });

  it('accepts a Records wrapper', () => {
    expect(parseLatencySamples({ Records: [emfLine(1_000, 2_000)] })).toHaveLength(1);
  });

  it('accepts a single EMF line', () => {
    expect(parseLatencySamples(emfLine(1_000, 2_000))).toHaveLength(1);
  });

  it('accepts CloudWatch Logs Insights results and coerces numeric strings', () => {
    const samples = parseLatencySamples({
      results: [
        [
          { field: 'decision_id', value: 'DEC_C' },
          { field: 'FastPathLatencyMs', value: '4200' },
          { field: 'EndToEndLatencyMs', value: '41000' },
        ],
      ],
    });

    expect(samples[0]).toEqual({
      decisionId: 'DEC_C',
      traceId: null,
      fastPathMs: 4_200,
      endToEndMs: 41_000,
    });
  });

  it('rejects an unrecognised shape instead of reporting no samples', () => {
    // Silently returning [] would turn a wrong query into INSUFFICIENT_DATA,
    // hiding the fact that the input was never understood.
    expect(() => parseLatencySamples('not json' as unknown)).toThrow(LatencySlaInputError);
  });

  it('reports invalid JSON explicitly', () => {
    expect(() => parseLatencySamplesFromJson('{oops')).toThrow(LatencySlaInputError);
  });

  it('tolerates a UTF-8 BOM, which Windows and AWS CLI exports add', () => {
    const withBom = `\uFEFF${JSON.stringify([emfLine(3_000, 30_000)])}`;

    // Otherwise a BOM reads as malformed JSON and an operator goes looking for a
    // query bug that is not there.
    expect(parseLatencySamplesFromJson(withBom)).toHaveLength(1);
  });
});

// ─── Zero data is never a pass ─────────────────────────────

describe('an empty or unusable population never passes', () => {
  it('returns INSUFFICIENT_DATA for zero samples', () => {
    const report = evaluate([]);

    // The trap: every sample in an empty set is under 5000ms.
    expect(report.verdict).toBe('INSUFFICIENT_DATA');
    expect(report.exit_code).toBe(EXIT_CODES.INSUFFICIENT_DATA);
    expect(report.exit_code).not.toBe(0);
  });

  it('explains why it could not verify', () => {
    expect(evaluate([]).insufficient_data_reason).toContain('No latency samples');
  });

  it('reports null statistics rather than zeroes', () => {
    const report = evaluate([]);

    expect(report.fast_path.statistics).toBeNull();
    expect(report.fast_path.evaluated_ms).toBeNull();
    expect(report.fast_path.compliant).toBeNull();
  });

  it('returns INSUFFICIENT_DATA when samples exist but none measured the Fast Path', () => {
    const report = evaluate([sample({ fastPathMs: null, endToEndMs: 30_000 })]);

    expect(report.verdict).toBe('INSUFFICIENT_DATA');
    expect(report.insufficient_data_reason).toContain('FastPathLatencyMs');
  });

  it('honours minSamples so one lucky invocation cannot certify a deploy', () => {
    const report = evaluate([sample()], { minSamples: 10 });

    expect(report.verdict).toBe('INSUFFICIENT_DATA');
    expect(report.insufficient_data_reason).toContain('minSamples=10');
  });

  it('passes once minSamples is satisfied', () => {
    const report = evaluate(
      Array.from({ length: 10 }, () => sample()),
      { minSamples: 10 },
    );

    expect(report.verdict).toBe('PASS');
  });

  it('still lists violations found in an under-sized population', () => {
    const report = evaluate([sample({ fastPathMs: 9_000 })], { minSamples: 5 });

    // The verdict is INSUFFICIENT_DATA, but the evidence is not discarded.
    expect(report.verdict).toBe('INSUFFICIENT_DATA');
    expect(report.violations).toHaveLength(1);
  });
});

// ─── Compliance ────────────────────────────────────────────

describe('compliant runs', () => {
  it('passes when both budgets are met', () => {
    const report = evaluate([sample({ fastPathMs: 3_000, endToEndMs: 30_000 })]);

    expect(report.verdict).toBe('PASS');
    expect(report.exit_code).toBe(0);
    expect(report.violations).toEqual([]);
  });

  it('passes at exactly 5000ms and 60000ms (inclusive budgets)', () => {
    const report = evaluate([sample({ fastPathMs: 5_000, endToEndMs: 60_000 })]);

    expect(report.verdict).toBe('PASS');
    expect(report.fast_path.compliant).toBe(true);
    expect(report.end_to_end.compliant).toBe(true);
  });

  it('reports P50, P95 and P99 for both budgets', () => {
    const report = evaluate(
      Array.from({ length: 100 }, (_, index) =>
        sample({ fastPathMs: index + 1, endToEndMs: (index + 1) * 10 }),
      ),
    );

    expect(report.fast_path.statistics).toMatchObject({ p50: 50, p95: 95, p99: 99, max: 100 });
    expect(report.end_to_end.statistics).toMatchObject({ p50: 500, p95: 950, p99: 990 });
  });

  it('echoes the thresholds actually applied', () => {
    expect(evaluate([sample()]).thresholds).toEqual({
      fast_path_target_ms: 5_000,
      official_deadline_ms: 60_000,
      target_percentile: 95,
      min_samples: 1,
    });
  });

  it('counts only measured values in each population', () => {
    const report = evaluate([
      sample({ fastPathMs: 3_000, endToEndMs: null }),
      sample({ fastPathMs: 3_500, endToEndMs: 40_000 }),
    ]);

    expect(report.fast_path.statistics?.count).toBe(2);
    expect(report.end_to_end.statistics?.count).toBe(1);
    expect(report.sample_count).toBe(2);
  });
});

// ─── Violations ────────────────────────────────────────────

describe('the team 5s target is judged on a percentile', () => {
  it('fails when p95 exceeds the target', () => {
    const report = evaluate(
      Array.from({ length: 20 }, () => sample({ fastPathMs: 6_000, endToEndMs: 30_000 })),
    );

    expect(report.verdict).toBe('SLA_VIOLATION');
    expect(report.exit_code).toBe(1);
  });

  it('tolerates a single cold-start outlier in a healthy population', () => {
    const samples = [
      ...Array.from({ length: 99 }, () => sample({ fastPathMs: 2_000, endToEndMs: 20_000 })),
      sample({ fastPathMs: 9_000, endToEndMs: 20_000 }),
    ];

    const report = evaluate(samples);

    // The 5s figure is a team goal, so one slow invocation should not fail a
    // release — but the outlier is still recorded.
    expect(report.verdict).toBe('PASS');
    expect(report.violations).toHaveLength(1);
    expect(report.fast_path.statistics?.max).toBe(9_000);
  });

  it('honours a stricter percentile', () => {
    const samples = [
      ...Array.from({ length: 99 }, () => sample({ fastPathMs: 2_000, endToEndMs: 20_000 })),
      sample({ fastPathMs: 9_000, endToEndMs: 20_000 }),
    ];

    expect(evaluate(samples, { targetPercentile: 100 }).verdict).toBe('SLA_VIOLATION');
  });

  it('reports which percentile value was compared', () => {
    const report = evaluate(
      Array.from({ length: 100 }, (_, index) => sample({ fastPathMs: index + 1 })),
    );

    expect(report.fast_path.evaluated_ms).toBe(95);
  });
});

describe('the official 60s deadline is judged on the worst case', () => {
  it('fails on a single breach even when the percentile is healthy', () => {
    const samples = [
      ...Array.from({ length: 99 }, () => sample({ fastPathMs: 2_000, endToEndMs: 20_000 })),
      sample({ decisionId: 'DEC_LATE', fastPathMs: 2_000, endToEndMs: 61_000 }),
    ];

    const report = evaluate(samples);

    // 60s is a per-decision official requirement, not an average. One decision
    // over the line is one decision that missed it.
    expect(report.verdict).toBe('SLA_VIOLATION');
    expect(report.end_to_end.evaluated_ms).toBe(61_000);
  });

  it('names the offending decision so it can be traced', () => {
    const report = evaluate([
      sample({ decisionId: 'DEC_LATE', traceId: 'trace-late', endToEndMs: 61_000 }),
    ]);

    expect(report.violations).toEqual([
      {
        decisionId: 'DEC_LATE',
        traceId: 'trace-late',
        metric: 'EndToEndLatencyMs',
        observedMs: 61_000,
        thresholdMs: 60_000,
      },
    ]);
  });

  it('lists both budgets when a decision breaches each', () => {
    const report = evaluate([sample({ fastPathMs: 7_000, endToEndMs: 70_000 })]);

    expect(report.violations.map((violation) => violation.metric)).toEqual([
      'FastPathLatencyMs',
      'EndToEndLatencyMs',
    ]);
  });

  it('honours an overridden deadline', () => {
    const report = evaluate([sample({ endToEndMs: 30_000 })], { officialDeadlineMs: 20_000 });

    expect(report.verdict).toBe('SLA_VIOLATION');
  });
});

// ─── CLI ───────────────────────────────────────────────────

describe('CLI', () => {
  it('exits 0 and prints the JSON report on a pass', async () => {
    const result = await cli(['--input', 'latency.json'], JSON.stringify([emfLine(3_000, 30_000)]));

    expect(result.exitCode).toBe(0);
    expect((JSON.parse(result.stdout) as LatencySlaReport).verdict).toBe('PASS');
    expect(result.stderr).toBe('');
  });

  it('exits 1 on an SLA violation', async () => {
    const result = await cli(['--input', 'latency.json'], JSON.stringify([emfLine(9_000, 70_000)]));

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('violated');
  });

  it('exits 2 when there is nothing to measure', async () => {
    const result = await cli(['--input', 'latency.json'], '[]');

    expect(result.exitCode).toBe(2);
    expect(result.stderr).toContain('could not be verified');
  });

  it('reads from stdin when no --input is given', async () => {
    const result = await cli([], JSON.stringify([emfLine(3_000, 30_000)]));

    expect(result.exitCode).toBe(0);
  });

  it('accepts thresholds as flags', async () => {
    const result = await cli(
      ['--fast-path-target-ms', '2000'],
      JSON.stringify([emfLine(3_000, 30_000)]),
    );

    expect(result.exitCode).toBe(1);
  });

  it('accepts thresholds from the environment', async () => {
    const result = await cli([], JSON.stringify([emfLine(3_000, 30_000)]), {
      FASTPATH_TARGET_MS: '2000',
    });

    expect(result.exitCode).toBe(1);
  });

  it('lets a flag win over the environment', async () => {
    const result = await cli(
      ['--fast-path-target-ms', '9000'],
      JSON.stringify([emfLine(3_000, 30_000)]),
      { FASTPATH_TARGET_MS: '1000' },
    );

    expect(result.exitCode).toBe(0);
  });

  it('accepts --min-samples and --percentile', async () => {
    const result = await cli(
      ['--min-samples', '5', '--percentile', '99'],
      JSON.stringify([emfLine(3_000, 30_000)]),
    );

    expect(result.exitCode).toBe(2);
    expect(JSON.parse(result.stdout).thresholds).toMatchObject({
      min_samples: 5,
      target_percentile: 99,
    });
  });

  it('exits 3 on a non-numeric threshold', async () => {
    const result = await cli(['--percentile', 'fast'], '[]');

    expect(result.exitCode).toBe(EXIT_CODE_BAD_INPUT);
    expect(result.stdout).toBe('');
  });

  it('exits 3 when --input has no value', async () => {
    const result = await cli(['--input'], '[]');

    expect(result.exitCode).toBe(EXIT_CODE_BAD_INPUT);
  });

  it('exits 3 rather than 0 when the input file cannot be read', async () => {
    const result = await verifyFastPathLatency(
      ['--input', 'missing.json'],
      {},
      {
        readFile: async () => {
          throw new Error('ENOENT: no such file');
        },
        readStdin: async () => '',
        evaluatedAt: AT,
      },
    );

    // A missing file must never read as "no violations found".
    expect(result.exitCode).toBe(EXIT_CODE_BAD_INPUT);
    expect(result.stderr).toContain('ENOENT');
  });

  it('exits 3 on malformed JSON', async () => {
    const result = await cli(['--input', 'latency.json'], '{oops');

    expect(result.exitCode).toBe(EXIT_CODE_BAD_INPUT);
  });

  it('never reports a zero exit code without a PASS verdict', async () => {
    for (const payload of ['[]', JSON.stringify([emfLine(9_000, 70_000)]), '{oops']) {
      const result = await cli(['--input', 'latency.json'], payload);
      expect(result.exitCode).not.toBe(0);
    }
  });
});
