/**
 * Failure and fallback counter metrics (design §19, §20; TASK-155).
 *
 * Four counters, each answering a question that cannot be answered from latency
 * data alone:
 *
 * | Counter                    | Question it answers |
 * | -------------------------- | ------------------- |
 * | `IdempotencyConflictCount` | How often is the same `idempotency_key` re-submitted? |
 * | `FencedExecutionCount`     | How often does a stale execution get intercepted? |
 * | `FallbackTriggeredCount`   | How often did a degraded path serve the response? |
 * | `ThrottlingEventCount`     | Is DynamoDB/Bedrock capacity the real bottleneck? |
 *
 * ## None of these is an error metric
 *
 * This is the point that governs the design. A fenced execution means the fencing
 * logic worked; an idempotency conflict means a duplicate request was correctly
 * absorbed. Alarming on `> 0` would page the team for the system behaving
 * correctly. What matters is the RATE and the shape — which is why these are
 * counters carrying a low-cardinality `reason`/`ActionType` label rather than
 * logged errors, and why TASK-159 watches the rate rather than the event.
 *
 * `FallbackTriggeredCount` is the one to watch during the demo: a non-zero value
 * means the audience saw a degraded answer, even though the response was a 200.
 *
 * ## Cardinality
 *
 * `reason` values are closed unions, not free-form strings. CloudWatch bills per
 * unique dimension combination, so an unbounded reason (an error message, a
 * `decision_id`) would create one metric stream per occurrence. Ids go in the
 * properties; only the enumerated label goes in `ActionType`.
 *
 * Emission is fail-safe throughout: it delegates to {@link EmfEmitter}, which
 * catches everything and reports through `onEmitError` (wired to the TASK-153
 * structured logger at the handler edge).
 *
 * @module backend/metrics/counter_emitter
 */

import type { EmfEmitter, EmfLogLine, MetricDatum, MetricProperties } from './emf.js';

/** Counter names. Stable: alarms and dashboards bind to these strings. */
export const COUNTER_METRIC_NAMES = {
  IDEMPOTENCY_CONFLICT: 'IdempotencyConflictCount',
  FENCED_EXECUTION: 'FencedExecutionCount',
  FALLBACK_TRIGGERED: 'FallbackTriggeredCount',
  THROTTLING_EVENT: 'ThrottlingEventCount',
} as const;

/**
 * Why an idempotency conflict was recorded.
 *
 * `CORE_IDENTITY_CONFLICT` is the only one that is genuinely bad: same
 * `decision_id`, different `core_hash` (§10.11a). The other two are the
 * deduplication working as designed.
 */
export type IdempotencyConflictReason =
  /** Same key, same `core_hash` — a duplicate request, correctly absorbed. */
  | 'DUPLICATE_SAME_DECISION'
  /** Same key while an execution is still in flight — routed to 202. */
  | 'IN_FLIGHT_REQUEST'
  /** Same `decision_id`, DIFFERENT `core_hash` — immutability violation, 409. */
  | 'CORE_IDENTITY_CONFLICT';

/** Why an execution was fenced (mirrors the TASK-095 classification). */
export type FencedExecutionReason =
  /** The record belongs to a different execution attempt. */
  | 'FENCED_STALE_EXECUTION'
  /** The record is ours but the target state was not reached. */
  | 'TARGET_NOT_REACHED'
  /** The record was absent — fail closed rather than assume. */
  | 'RECORD_MISSING';

/**
 * Which degraded path served the response.
 *
 * Deliberately excludes "no data" cases: `insufficient_data` is not a fallback,
 * it is a refusal to fabricate (§21). A fallback means something WAS served from
 * a lesser source.
 */
export type FallbackReason =
  /** Bedrock narrative failed; the deterministic Fast Path core was served. */
  | 'NARRATIVE_UNAVAILABLE'
  /** Knowledge Base lookup failed; the template renderer was used. */
  | 'KB_LOOKUP_FAILED'
  /** A translation was missing; the zh-TW source text was served. */
  | 'TRANSLATION_MISSING'
  /** Enrichment timed out against the 60 s official deadline. */
  | 'ENRICHMENT_TIMEOUT';

/** Which dependency throttled. */
export type ThrottlingSource =
  'DYNAMODB' | 'BEDROCK' | 'STEP_FUNCTIONS' | 'API_GATEWAY' | 'CLOUDWATCH';

/** Extra, high-cardinality context. Searchable in Insights, never a dimension. */
export interface CounterContext {
  readonly decisionId?: string;
  readonly traceId?: string;
  readonly idempotencyKey?: string;
  readonly attemptCount?: number;
}

function toProperties(context: CounterContext, extra: MetricProperties = {}): MetricProperties {
  return {
    decision_id: context.decisionId ?? null,
    trace_id: context.traceId ?? null,
    idempotency_key: context.idempotencyKey ?? null,
    attempt_count: context.attemptCount ?? null,
    ...extra,
  };
}

function countOf(name: string, value: number): readonly MetricDatum[] {
  return [{ name, value, unit: 'Count' }];
}

/**
 * Publishes failure and fallback counters.
 *
 * Shares the EMF transport and the `Environment` dimension with
 * {@link LatencyMetricEmitter} (TASK-154), so latency and failure data land in
 * the same namespace and can be correlated in one Insights query.
 *
 * @example
 * ```ts
 * const counters = new CounterMetricEmitter(emfEmitter);
 * counters.recordFencedExecution('FENCED_STALE_EXECUTION', 'MARK_RUNNING', {
 *   decisionId,
 *   traceId,
 * });
 * ```
 */
export class CounterMetricEmitter {
  constructor(private readonly emitter: EmfEmitter) {}

  /**
   * Record an idempotency conflict.
   *
   * The `reason` distinguishes an absorbed duplicate (expected, healthy) from a
   * `CORE_IDENTITY_CONFLICT` (a real immutability violation), so one alarm can
   * watch the latter without firing on the former.
   */
  recordIdempotencyConflict(
    reason: IdempotencyConflictReason,
    context: CounterContext = {},
  ): EmfLogLine | null {
    return this.emitter
      .withActionType(reason)
      .emit(
        countOf(COUNTER_METRIC_NAMES.IDEMPOTENCY_CONFLICT, 1),
        toProperties(context, { conflict_reason: reason }),
      );
  }

  /**
   * Record a fenced execution (TASK-095).
   *
   * `action` is the guarded transition that was rejected (`MARK_RUNNING`,
   * `MARK_CORE_COMMITTED`, ...) — a closed set, safe as a dimension.
   */
  recordFencedExecution(
    reason: FencedExecutionReason,
    action: string,
    context: CounterContext = {},
  ): EmfLogLine | null {
    return this.emitter
      .withActionType(action)
      .emit(
        countOf(COUNTER_METRIC_NAMES.FENCED_EXECUTION, 1),
        toProperties(context, { fenced_reason: reason, action }),
      );
  }

  /**
   * Record that a degraded path served the response.
   *
   * The counter to watch during the demo: a non-zero value means the audience
   * saw a lesser answer even though the HTTP status was 200.
   */
  recordFallbackTriggered(reason: FallbackReason, context: CounterContext = {}): EmfLogLine | null {
    return this.emitter
      .withActionType(reason)
      .emit(
        countOf(COUNTER_METRIC_NAMES.FALLBACK_TRIGGERED, 1),
        toProperties(context, { fallback_reason: reason }),
      );
  }

  /**
   * Record a throttling event from a dependency.
   *
   * `attemptNumber` is a property, not a dimension: retry depth is unbounded in
   * principle and would multiply metric streams.
   */
  recordThrottlingEvent(
    source: ThrottlingSource,
    context: CounterContext & { readonly attemptNumber?: number } = {},
  ): EmfLogLine | null {
    return this.emitter.withActionType(source).emit(
      countOf(COUNTER_METRIC_NAMES.THROTTLING_EVENT, 1),
      toProperties(context, {
        throttling_source: source,
        attempt_number: context.attemptNumber ?? null,
      }),
    );
  }
}
