/**
 * CloudWatch Embedded Metric Format (EMF) emission (design §19; TASK-154/155).
 *
 * ## Why EMF instead of `PutMetricData`
 *
 * `PutMetricData` is a synchronous API call. On the Fast Path — which has a 5 s
 * budget and is the thing we are measuring — adding a network round trip to
 * measure latency would distort the very number being recorded, and a throttled
 * CloudWatch call would add retry delay to a decision. EMF instead writes one JSON
 * line to stdout; the Lambda log pipeline extracts the metrics asynchronously.
 *
 * Two further consequences, both of which matter for this project:
 *  - **No extra IAM.** EMF needs only the CloudWatch Logs permission every Lambda
 *    role already has (§18). `PutMetricData` would require widening several roles.
 *  - **Metric and context travel together.** The same line carries `trace_id` and
 *    `decision_id`, so a latency outlier can be joined to its execution in Logs
 *    Insights without a second lookup.
 *
 * ## Fail-safe by construction
 *
 * Metrics are observability, never correctness. `emit` catches everything: a
 * serialization failure or a broken stdout must not fail a decision that has
 * already been committed. Emission problems are counted and exposed via
 * {@link EmfEmitter.failureCount} so a silent stop is still visible.
 *
 * @module backend/metrics/emf
 */

/** CloudWatch standard units used by this project. */
export type MetricUnit = 'Milliseconds' | 'Count' | 'None';

/** One metric value in an EMF line. */
export interface MetricDatum {
  readonly name: string;
  readonly value: number;
  readonly unit: MetricUnit;
}

/** Default metric namespace. Overridable via `ConfigProvider`. */
export const DEFAULT_METRIC_NAMESPACE = 'CityResponseCommander' as const;

/**
 * Dimensions applied to every metric.
 *
 * Kept deliberately small: CloudWatch charges per unique dimension combination,
 * and a high-cardinality dimension such as `decision_id` would create one metric
 * stream per decision. Ids belong in the log properties, not the dimensions.
 */
export interface MetricDimensions {
  /** `LOCAL_MOCK` | `PERSONAL_AWS_DEV` | `COMPETITION_AWS`. */
  readonly Environment: string;
  /** Narrow, low-cardinality label, e.g. a status action or fallback name. */
  readonly ActionType?: string;
}

/** Non-dimension context, searchable in Logs Insights but not a metric stream. */
export type MetricProperties = Readonly<Record<string, string | number | boolean | null>>;

/** A serialized EMF line. */
export interface EmfLogLine {
  readonly _aws: {
    readonly Timestamp: number;
    readonly CloudWatchMetrics: readonly {
      readonly Namespace: string;
      readonly Dimensions: ReadonlyArray<readonly string[]>;
      readonly Metrics: readonly { readonly Name: string; readonly Unit: MetricUnit }[];
    }[];
  };
  readonly [key: string]: unknown;
}

/** Sink for EMF lines. Defaults to stdout via `console.log`. */
export interface EmfSink {
  write(line: EmfLogLine): void;
}

/** stdout sink — the Lambda log pipeline extracts metrics from it. */
export const stdoutEmfSink: EmfSink = {
  write(line) {
    console.log(JSON.stringify(line));
  },
};

/** Construction options. */
export interface EmfEmitterOptions {
  readonly dimensions: MetricDimensions;
  /** Metric namespace. Defaults to {@link DEFAULT_METRIC_NAMESPACE}. */
  readonly namespace?: string;
  /** Injected clock, so tests assert exact timestamps. */
  readonly now?: () => number;
  readonly sink?: EmfSink;
  /**
   * Optional observer for emission failures.
   *
   * Wired to the structured logger (TASK-153) at the handler edge so a broken
   * metric pipeline is visible rather than silently swallowed.
   */
  readonly onEmitError?: (error: unknown) => void;
}

/**
 * Emits EMF lines with a fixed dimension set.
 *
 * @example
 * ```ts
 * const emitter = new EmfEmitter({ dimensions: { Environment: 'COMPETITION_AWS' } });
 * emitter.emit([{ name: 'FastPathLatencyMs', value: 3200, unit: 'Milliseconds' }], {
 *   trace_id: traceId,
 *   decision_id: decisionId,
 * });
 * ```
 */
export class EmfEmitter {
  private readonly namespace: string;
  private readonly dimensions: MetricDimensions;
  private readonly now: () => number;
  private readonly sink: EmfSink;
  private readonly onEmitError?: (error: unknown) => void;
  private failures = 0;

  constructor(options: EmfEmitterOptions) {
    this.namespace = options.namespace ?? DEFAULT_METRIC_NAMESPACE;
    this.dimensions = options.dimensions;
    this.now = options.now ?? Date.now;
    this.sink = options.sink ?? stdoutEmfSink;
    this.onEmitError = options.onEmitError;
  }

  /** Number of emissions that failed. Non-zero means metrics are being lost. */
  get failureCount(): number {
    return this.failures;
  }

  /** Derive an emitter with a different `ActionType` dimension. */
  withActionType(actionType: string): EmfEmitter {
    return new EmfEmitter({
      dimensions: { ...this.dimensions, ActionType: actionType },
      namespace: this.namespace,
      now: this.now,
      sink: this.sink,
      ...(this.onEmitError === undefined ? {} : { onEmitError: this.onEmitError }),
    });
  }

  /**
   * Emit one EMF line.
   *
   * Never throws. A metric is not worth failing a committed decision for.
   *
   * @returns the line written, or `null` when emission failed or there was nothing
   *          to emit
   */
  emit(metrics: readonly MetricDatum[], properties: MetricProperties = {}): EmfLogLine | null {
    if (metrics.length === 0) return null;

    try {
      const dimensionKeys = Object.entries(this.dimensions)
        .filter(([, value]) => value !== undefined && value !== '')
        .map(([key]) => key);

      const line = {
        _aws: {
          Timestamp: this.now(),
          CloudWatchMetrics: [
            {
              Namespace: this.namespace,
              Dimensions: [dimensionKeys],
              Metrics: metrics.map((metric) => ({ Name: metric.name, Unit: metric.unit })),
            },
          ],
        },
        ...this.dimensions,
        ...properties,
        ...Object.fromEntries(metrics.map((metric) => [metric.name, metric.value])),
      } as unknown as EmfLogLine;

      this.sink.write(line);
      return line;
    } catch (error: unknown) {
      this.failures += 1;
      this.onEmitError?.(error);
      return null;
    }
  }
}
