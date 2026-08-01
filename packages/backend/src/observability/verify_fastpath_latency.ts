/**
 * CLI for the Fast Path latency SLA gate (TASK-105).
 *
 * Lives under `src/` rather than in a `scripts/` folder so it is covered by
 * `tsc --build` and `eslint`; `packages/backend/scripts/verify_fastpath_latency.ts`
 * is a thin `tsx` shim over {@link main}. A release gate that is not itself
 * typechecked is a poor release gate.
 *
 * ## Usage
 *
 * ```bash
 * # From a file produced by a Logs Insights query or `aws logs filter-log-events`
 * tsx packages/backend/scripts/verify_fastpath_latency.ts --input latency.json
 *
 * # From a pipe
 * aws logs filter-log-events ... | tsx packages/backend/scripts/verify_fastpath_latency.ts
 *
 * # Tighten the gate for a rehearsal run
 * tsx ... --input latency.json --min-samples 10 --percentile 99
 * ```
 *
 * Options may also be supplied as environment variables:
 * `FASTPATH_TARGET_MS`, `OFFICIAL_DEADLINE_MS`, `LATENCY_TARGET_PERCENTILE`,
 * `LATENCY_MIN_SAMPLES`, `LATENCY_INPUT`.
 *
 * Exit codes:
 * | Code | Verdict | Meaning |
 * | ---- | ------- | ------- |
 * | `0` | `PASS` | both budgets assessed and met |
 * | `0` | `TEAM_TARGET_MISSED` | 5 s team target missed, 60 s official deadline met — a warning, since 5 s is not an official indicator |
 * | `1` | `OFFICIAL_SLA_VIOLATION` | the graded 60 s deadline was breached |
 * | `2` | `INSUFFICIENT_DATA` | a budget could not be assessed |
 * | `3` | — | bad arguments or unreadable input |
 * | `4` | `TEAM_TARGET_MISSED` | only with `--fail-on-team-target` |
 *
 * @module backend/observability/verify_fastpath_latency
 */

import {
  LatencySlaInputError,
  evaluateLatencySla,
  formatReport,
  parseLatencySamplesFromJson,
  type LatencySlaOptions,
  type SlaVerdict,
} from './latency_sla.js';

/** Exit code for malformed arguments or input, distinct from any verdict. */
export const EXIT_CODE_BAD_INPUT = 3;

/** Result of a CLI run. Returned rather than printed, so it can be tested. */
export interface CliResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Injected so the CLI never touches the real filesystem or process in tests. */
export interface CliDependencies {
  readonly readFile: (path: string) => Promise<string>;
  readonly readStdin: () => Promise<string>;
  readonly evaluatedAt?: string;
}

interface ParsedArgs {
  readonly inputPath: string | null;
  readonly options: LatencySlaOptions;
}

function readNumericFlag(
  flag: string,
  argv: readonly string[],
  envValue: string | undefined,
): number | undefined {
  const index = argv.indexOf(flag);
  const raw = index >= 0 ? argv[index + 1] : envValue;
  if (raw === undefined || raw.length === 0) return undefined;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) {
    throw new LatencySlaInputError(`Option "${flag}" requires a number; received "${raw}".`);
  }
  return parsed;
}

function parseArgs(argv: readonly string[], env: Record<string, string | undefined>): ParsedArgs {
  const inputIndex = argv.indexOf('--input');
  const inputPath = inputIndex >= 0 ? (argv[inputIndex + 1] ?? null) : (env.LATENCY_INPUT ?? null);

  if (inputIndex >= 0 && (inputPath === null || inputPath.startsWith('--'))) {
    throw new LatencySlaInputError('Option "--input" requires a file path.');
  }

  const fastPathTargetMs = readNumericFlag('--fast-path-target-ms', argv, env.FASTPATH_TARGET_MS);
  const officialDeadlineMs = readNumericFlag(
    '--official-deadline-ms',
    argv,
    env.OFFICIAL_DEADLINE_MS,
  );
  const targetPercentile = readNumericFlag('--percentile', argv, env.LATENCY_TARGET_PERCENTILE);
  const minSamples = readNumericFlag('--min-samples', argv, env.LATENCY_MIN_SAMPLES);
  const failOnTeamTarget =
    argv.includes('--fail-on-team-target') || env.LATENCY_FAIL_ON_TEAM_TARGET === 'true';

  return {
    inputPath,
    options: {
      ...(fastPathTargetMs === undefined ? {} : { fastPathTargetMs }),
      ...(officialDeadlineMs === undefined ? {} : { officialDeadlineMs }),
      ...(targetPercentile === undefined ? {} : { targetPercentile }),
      ...(minSamples === undefined ? {} : { minSamples }),
      ...(failOnTeamTarget ? { failOnTeamTarget } : {}),
    },
  };
}

/**
 * Run the gate.
 *
 * @returns the exit code plus the JSON report; the caller does the printing.
 */
export async function main(
  argv: readonly string[],
  env: Record<string, string | undefined>,
  dependencies: CliDependencies,
): Promise<CliResult> {
  let parsed: ParsedArgs;
  try {
    parsed = parseArgs(argv, env);
  } catch (error: unknown) {
    return badInput(error);
  }

  let text: string;
  try {
    text =
      parsed.inputPath === null
        ? await dependencies.readStdin()
        : await dependencies.readFile(parsed.inputPath);
  } catch (error: unknown) {
    // A missing input file must not be mistaken for "no violations found".
    return badInput(error);
  }

  try {
    const samples = parseLatencySamplesFromJson(text);
    const report = evaluateLatencySla(samples, {
      ...parsed.options,
      ...(dependencies.evaluatedAt === undefined ? {} : { evaluatedAt: dependencies.evaluatedAt }),
    });
    return {
      // The report owns the exit code: it already accounts for failOnTeamTarget.
      exitCode: report.exit_code,
      stdout: formatReport(report),
      stderr: describeVerdict(report.verdict),
    };
  } catch (error: unknown) {
    return badInput(error);
  }
}

function describeVerdict(verdict: SlaVerdict): string {
  switch (verdict) {
    case 'PASS':
      return '';
    case 'TEAM_TARGET_MISSED':
      // Reported loudly but non-fatal by default: 5 000 ms is a team target, not
      // an official indicator, so it must not break a build on its own.
      return 'WARNING: the 5s Fast Path TEAM_TARGET was missed. The 60s OFFICIAL deadline was met. Pass --fail-on-team-target to make this fatal.';
    case 'OFFICIAL_SLA_VIOLATION':
      return 'FAILURE: the 60s OFFICIAL deadline was breached. See "violations" in the report.';
    case 'INSUFFICIENT_DATA':
      return 'FAILURE: the latency SLA could not be verified. See "insufficient_data_reason".';
  }
}

function badInput(error: unknown): CliResult {
  return {
    exitCode: EXIT_CODE_BAD_INPUT,
    stdout: '',
    stderr: error instanceof Error ? error.message : String(error),
  };
}
