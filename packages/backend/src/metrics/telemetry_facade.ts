/**
 * Telemetry facade — one injectable surface for latency and failure metrics
 * (design §19, §20; TASK-158).
 *
 * Wraps {@link LatencyMetricEmitter} (TASK-154) and {@link CounterMetricEmitter}
 * (TASK-155) behind {@link Telemetry}, so a call site depends on one narrow
 * interface instead of two concrete classes plus an EMF transport.
 *
 * ## Why a facade rather than passing the emitters around
 *
 * Two reasons, both about keeping instrumentation from leaking into logic:
 *
 * 1. **A no-op implementation becomes trivial.** {@link NoopTelemetry} satisfies
 *    the same interface, so unit tests of guarded writes and recovery
 *    transitions do not need an EMF sink, a clock, or dimension plumbing. Making
 *    telemetry optional at every call site would instead scatter `?.` through the
 *    logic.
 * 2. **Outcome-to-metric mapping lives in one place.** Deciding that
 *    `FENCED_STALE_EXECUTION` is a `FencedExecutionCount` and not an error is a
 *    policy decision. Duplicating it across InjectFn, WorkflowStatusFn and
 *    DecisionFn is how two handlers end up disagreeing about whether a fenced
 *    execution is a failure.
 *
 * ## Fail-safe is a property of the interface, not of the caller
 *
 * Every method returns `void` and cannot throw. Errors are swallowed by the
 * underlying {@link EmfEmitter} and reported through its `onEmitError` hook,
 * which the composition root wires to the TASK-153 structured logger. A caller
 * therefore never needs a `try` around instrumentation — which is the only way to
 * guarantee that a metric failure cannot fail a decision that is already
 * committed.
 *
 * ## Ownership note
 *
 * `recordLatency`, `recordConflict`, `recordFenced`, `recordFallback` and
 * `recordThrottling` are the whole contract. Member 4 (TASK-109/112/117) and
 * member 5 (TASK-122) can depend on {@link Telemetry} today; the metric names
 * they will appear under are fixed in `LATENCY_METRIC_NAMES` and
 * `COUNTER_METRIC_NAMES` and must stay aligned with member 3's Metric Filters
 * (TASK-075).
 *
 * @module backend/metrics/telemetry_facade
 */

import { CounterMetricEmitter } from './counter_emitter.js';
import { EmfEmitter, stdoutEmfSink } from './emf.js';
import { LatencyMetricEmitter } from './latency_emitter.js';
import type { EmfSink, MetricDimensions } from './emf.js';
import type {
  CounterContext,
  FallbackReason,
  FencedExecutionReason,
  IdempotencyConflictReason,
  ThrottlingSource,
} from './counter_emitter.js';
import type { LatencyTrace, LatencyTraceSnapshot } from './latency_trace.js';

/**
 * The telemetry contract every handler depends on.
 *
 * Deliberately small: five verbs covering the four counters plus latency. No
 * method throws, and none returns a value — instrumentation must never become
 * part of a control-flow decision.
 */
export interface Telemetry {
  /**
   * Publish the latency budget outcome for one decision.
   *
   * Safe to call with a partially measured trace: unmeasured budgets are omitted
   * rather than reported as zero.
   */
  recordLatency(source: LatencyTrace | LatencyTraceSnapshot): void;

  /** An `idempotency_key` was re-submitted. Mostly healthy deduplication. */
  recordConflict(reason: IdempotencyConflictReason, context?: CounterContext): void;

  /** A guarded transition rejected a stale execution. Fencing working. */
  recordFenced(reason: FencedExecutionReason, action: string, context?: CounterContext): void;

  /** A degraded path served the response. The counter to watch during the demo. */
  recordFallback(reason: FallbackReason, context?: CounterContext): void;

  /** A dependency throttled. */
  recordThrottling(
    source: ThrottlingSource,
    context?: CounterContext & { readonly attemptNumber?: number },
  ): void;
}

/**
 * Telemetry that records nothing.
 *
 * For unit tests and for `LOCAL_MOCK`, where there is no CloudWatch to write to.
 * Prefer this over an optional `Telemetry | undefined` parameter: the call site
 * stays identical in both cases.
 */
export class NoopTelemetry implements Telemetry {
  recordLatency(): void {
    /* intentionally empty */
  }
  recordConflict(): void {
    /* intentionally empty */
  }
  recordFenced(): void {
    /* intentionally empty */
  }
  recordFallback(): void {
    /* intentionally empty */
  }
  recordThrottling(): void {
    /* intentionally empty */
  }
}

/** Construction options for {@link EmfTelemetry}. */
export interface EmfTelemetryOptions {
  /** Dimensions shared by every metric. `Environment` is expected. */
  readonly dimensions: MetricDimensions;
  readonly namespace?: string;
  /** Defaults to stdout, which is what EMF requires inside Lambda. */
  readonly sink?: EmfSink;
  readonly now?: () => number;
  /** Wire to the TASK-153 structured logger at the composition root. */
  readonly onEmitError?: (error: unknown) => void;
}

/**
 * EMF-backed {@link Telemetry}.
 *
 * One shared {@link EmfEmitter} underneath, so latency and counter data land in
 * the same namespace with the same dimensions and a single failure counter.
 *
 * @example
 * ```ts
 * const telemetry = new EmfTelemetry({
 *   dimensions: { Environment: config.get('env') as string },
 *   onEmitError: (error) => logger.warn('diagnostic', 'metric emission failed', {
 *     reason: error instanceof Error ? error.message : String(error),
 *   }),
 * });
 * telemetry.recordFenced('FENCED_STALE_EXECUTION', 'MARK_RUNNING', { decisionId });
 * ```
 */
export class EmfTelemetry implements Telemetry {
  private readonly emitter: EmfEmitter;
  private readonly latency: LatencyMetricEmitter;
  private readonly counters: CounterMetricEmitter;

  constructor(options: EmfTelemetryOptions) {
    this.emitter = new EmfEmitter({
      dimensions: options.dimensions,
      ...(options.namespace === undefined ? {} : { namespace: options.namespace }),
      sink: options.sink ?? stdoutEmfSink,
      ...(options.now === undefined ? {} : { now: options.now }),
      ...(options.onEmitError === undefined ? {} : { onEmitError: options.onEmitError }),
    });
    this.latency = new LatencyMetricEmitter(this.emitter);
    this.counters = new CounterMetricEmitter(this.emitter);
  }

  /**
   * Emissions lost so far. Non-zero means metrics are being dropped; the
   * workflow is unaffected.
   */
  get failureCount(): number {
    return this.emitter.failureCount;
  }

  recordLatency(source: LatencyTrace | LatencyTraceSnapshot): void {
    this.latency.emitSnapshot(source);
  }

  recordConflict(reason: IdempotencyConflictReason, context: CounterContext = {}): void {
    this.counters.recordIdempotencyConflict(reason, context);
  }

  recordFenced(reason: FencedExecutionReason, action: string, context: CounterContext = {}): void {
    this.counters.recordFencedExecution(reason, action, context);
  }

  recordFallback(reason: FallbackReason, context: CounterContext = {}): void {
    this.counters.recordFallbackTriggered(reason, context);
  }

  recordThrottling(
    source: ThrottlingSource,
    context: CounterContext & { readonly attemptNumber?: number } = {},
  ): void {
    this.counters.recordThrottlingEvent(source, context);
  }
}
