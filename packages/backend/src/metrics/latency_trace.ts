/**
 * LatencyTrace — per-decision latency instrumentation (design §10.16, §19, §20;
 * TASK-104).
 *
 * Two thresholds, and they are NOT the same kind of thing:
 *
 *  - **5 000 ms Fast Path — `TEAM_TARGET`, not an official indicator.** Detection
 *    to initial public warning. Missing it is a quality signal, not a competition
 *    failure. It must be labelled as a team target wherever it is displayed, so
 *    the demo never implies the organizer set it.
 *  - **60 000 ms end-to-end — the OFFICIAL hard deadline** (REQ-004). This is the
 *    one that is graded and the one CloudWatch alarms on.
 *
 * The Fast Path is measured to the `decision.fast_path_ready` push, which happens
 * before any Bedrock call; end-to-end runs to `decision.enriched`. Keeping them
 * separate is what proves the design claim that a Bedrock failure cannot break
 * the Fast Path — a single blended number would hide exactly that.
 *
 * Time is injected. Instrumentation that calls `Date.now()` internally cannot be
 * asserted on, and a latency test that sleeps in real time is a flaky test.
 *
 * @module backend/metrics/latency_trace
 */

/** Fast Path target. TEAM_TARGET — deliberately not an official indicator. */
export const FAST_PATH_TARGET_MS = 5_000;

/** End-to-end deadline. OFFICIAL hard indicator (REQ-004). */
export const OFFICIAL_DEADLINE_MS = 60_000;

/**
 * Named pipeline stages (§20 latency budget).
 *
 * A closed set rather than free-form strings, so CloudWatch Insights queries and
 * the latency panel cannot drift apart from the emitter.
 */
export type LatencyStage =
  /** InjectFn: key derivation + lease + StartExecution. */
  | 'inject'
  /** MARK_RUNNING registration. */
  | 'mark_running'
  /** Official source hash verification (§10.0 STOP gate). */
  | 'source_verification'
  /** DataIngestionService load + snapshot selection. */
  | 'ingestion'
  /** Deterministic rule engine + ETE + evidence. */
  | 'rule_engine'
  /** DecisionCore conditional Put + identity classification. */
  | 'core_persistence'
  /** MARK_CORE_COMMITTED checkpoint. */
  | 'mark_core_committed'
  /** decision.fast_path_ready push. */
  | 'fast_path_push'
  /** Bedrock/KB enrichment (all three narrative branches). */
  | 'enrichment'
  /** decision.enriched push. */
  | 'enriched_push';

/** One completed stage measurement. */
export interface StageMeasurement {
  readonly stage: LatencyStage;
  readonly started_at: number;
  readonly ended_at: number;
  readonly duration_ms: number;
}

/** The emitted trace (§10.16). */
export interface LatencyTraceSnapshot {
  readonly decision_id: string;
  readonly trace_id: string;
  /** Detection → `fast_path_ready`. `null` until the Fast Path completes. */
  readonly fast_path_ms: number | null;
  /** Detection → `enriched`. `null` until enrichment completes. */
  readonly end_to_end_ms: number | null;
  /** `fast_path_ms <= 5000`. `null` while unmeasured. Team target, not official. */
  readonly fast_path_target_met: boolean | null;
  /** `end_to_end_ms <= 60000`. `null` while unmeasured. OFFICIAL indicator. */
  readonly official_deadline_met: boolean | null;
  readonly stages: readonly StageMeasurement[];
  readonly fast_path_target_ms: number;
  readonly official_deadline_ms: number;
  /**
   * Measurement problems (double-open, unmatched close, bad clock).
   *
   * Surfaced rather than thrown, so a broken measurement cannot fail a decision
   * yet also cannot hide: a non-empty list means the durations are suspect.
   */
  readonly measurement_anomalies: readonly string[];
}

/** Structured log line for CloudWatch Insights (§19). */
export interface LatencyLogRecord extends LatencyTraceSnapshot {
  readonly log_type: 'latency_trace';
  /** Per-stage durations, flattened for `stats avg(...) by` style queries. */
  readonly stage_durations_ms: Readonly<Record<string, number>>;
}

/** A stage was ended without being started, or started twice. */
export class LatencyTraceUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LatencyTraceUsageError';
  }
}

/**
 * Collects stage timings for one decision.
 *
 * @example
 * ```ts
 * const trace = new LatencyTrace({ decisionId, traceId, startedAtMs: detectedAt });
 * trace.begin('rule_engine', now());
 * // ...
 * trace.end('rule_engine', now());
 * trace.markFastPathReady(now());
 * logger.info(trace.toLogRecord());
 * ```
 */
export class LatencyTrace {
  private readonly decisionId: string;
  private readonly traceId: string;
  /** Detection time — the origin both deadlines are measured from. */
  private readonly startedAtMs: number;
  private readonly open = new Map<LatencyStage, number>();
  private readonly measurements: StageMeasurement[] = [];
  private fastPathReadyAtMs: number | null = null;
  private enrichedAtMs: number | null = null;
  private readonly anomalies: string[] = [];

  constructor(input: {
    readonly decisionId: string;
    readonly traceId: string;
    /** Detection timestamp, epoch ms. Both budgets are measured from here. */
    readonly startedAtMs: number;
  }) {
    if (!Number.isFinite(input.startedAtMs)) {
      throw new LatencyTraceUsageError('LatencyTrace requires a finite "startedAtMs".');
    }
    this.decisionId = input.decisionId;
    this.traceId = input.traceId;
    this.startedAtMs = input.startedAtMs;
  }

  /**
   * Open a stage.
   *
   * Misuse is recorded as an anomaly, never thrown. Instrumentation that can
   * abort a decision is worse than no instrumentation — and a thrown
   * `LatencyTraceUsageError` here would kill a decision that was otherwise fine.
   * The anomaly makes the misuse loud in tests and visible in CloudWatch without
   * being fatal in production.
   */
  begin(stage: LatencyStage, atMs: number): void {
    if (this.open.has(stage)) {
      // Keep the earlier start: it yields the longer, more conservative duration.
      this.anomalies.push(`Stage "${stage}" was opened twice; kept the first start time.`);
      return;
    }
    if (!Number.isFinite(atMs)) {
      this.anomalies.push(`Stage "${stage}" was opened with a non-finite timestamp.`);
      return;
    }
    this.open.set(stage, atMs);
  }

  /**
   * Close a stage and record its duration.
   *
   * @returns the measurement, or `null` when the stage was never opened (recorded
   *   as an anomaly rather than thrown, for the reason given on {@link begin})
   */
  end(stage: LatencyStage, atMs: number): StageMeasurement | null {
    const startedAt = this.open.get(stage);
    if (startedAt === undefined) {
      this.anomalies.push(`Stage "${stage}" was ended without being started.`);
      return null;
    }
    if (!Number.isFinite(atMs)) {
      this.anomalies.push(`Stage "${stage}" was ended with a non-finite timestamp.`);
      return null;
    }
    this.open.delete(stage);

    const measurement: StageMeasurement = {
      stage,
      started_at: startedAt,
      ended_at: atMs,
      duration_ms: atMs - startedAt,
    };
    this.measurements.push(measurement);
    return measurement;
  }

  /**
   * Time a block, recording the stage even if it throws.
   *
   * A failed stage still consumed latency budget, so it must still be measured.
   *
   * The `finally` is itself guarded: a `finally` block that throws REPLACES the
   * in-flight exception, so an instrumentation fault would surface instead of the
   * business error that actually caused the failure — and the real cause would be
   * lost. `end()` no longer throws, and the `catch` keeps that guarantee true even
   * if a future change reintroduces one.
   */
  async measure<T>(
    stage: LatencyStage,
    now: () => number,
    operation: () => Promise<T>,
  ): Promise<T> {
    this.safely(() => this.begin(stage, now()));
    try {
      return await operation();
    } finally {
      this.safely(() => this.end(stage, now()));
    }
  }

  /** Measurement anomalies. Non-empty means the timing data is suspect. */
  get anomalyMessages(): readonly string[] {
    return [...this.anomalies];
  }

  /**
   * Run an instrumentation step, absorbing anything it throws.
   *
   * Also covers a throwing injected `now()`, which no amount of care inside this
   * class could otherwise contain.
   */
  private safely(step: () => void): void {
    try {
      step();
    } catch (error: unknown) {
      this.anomalies.push(
        `Measurement step failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Record the `decision.fast_path_ready` push (TASK-103).
   *
   * Idempotent and last-write-wins. Both `DecisionFn` (which knows the core is
   * committed) and the publisher (which knows the push happened) may call it; the
   * publisher's later value is the accurate one and correctly overwrites.
   */
  markFastPathReady(atMs: number): void {
    if (!Number.isFinite(atMs)) {
      this.anomalies.push('markFastPathReady received a non-finite timestamp; ignored.');
      return;
    }
    this.fastPathReadyAtMs = atMs;
  }

  /** Record the `decision.enriched` push (TASK-119). */
  markEnriched(atMs: number): void {
    if (!Number.isFinite(atMs)) {
      this.anomalies.push('markEnriched received a non-finite timestamp; ignored.');
      return;
    }
    this.enrichedAtMs = atMs;
  }

  /** Stages opened but never closed. Surfaced rather than silently dropped. */
  get openStages(): readonly LatencyStage[] {
    return [...this.open.keys()];
  }

  /** Immutable view of the current measurements. */
  snapshot(): LatencyTraceSnapshot {
    const fastPathMs =
      this.fastPathReadyAtMs === null ? null : this.fastPathReadyAtMs - this.startedAtMs;
    const endToEndMs = this.enrichedAtMs === null ? null : this.enrichedAtMs - this.startedAtMs;

    return {
      decision_id: this.decisionId,
      trace_id: this.traceId,
      fast_path_ms: fastPathMs,
      end_to_end_ms: endToEndMs,
      fast_path_target_met: fastPathMs === null ? null : fastPathMs <= FAST_PATH_TARGET_MS,
      official_deadline_met: endToEndMs === null ? null : endToEndMs <= OFFICIAL_DEADLINE_MS,
      stages: [...this.measurements],
      fast_path_target_ms: FAST_PATH_TARGET_MS,
      official_deadline_ms: OFFICIAL_DEADLINE_MS,
      measurement_anomalies: [...this.anomalies],
    };
  }

  /**
   * Structured log record for CloudWatch Insights (§19).
   *
   * `log_type` and the flattened `stage_durations_ms` map exist so a query can
   * aggregate per stage without parsing an array.
   */
  toLogRecord(): LatencyLogRecord {
    const stageDurations: Record<string, number> = {};
    for (const measurement of this.measurements) {
      // Repeated stages sum rather than overwrite (e.g. a retried branch).
      stageDurations[measurement.stage] =
        (stageDurations[measurement.stage] ?? 0) + measurement.duration_ms;
    }

    return { log_type: 'latency_trace', ...this.snapshot(), stage_durations_ms: stageDurations };
  }
}
