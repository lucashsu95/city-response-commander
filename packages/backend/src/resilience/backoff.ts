/**
 * Bounded exponential backoff with full jitter (design §21.2, §4.3, §27;
 * TASK-157).
 *
 * Applies to transient DynamoDB / API Gateway failures — `429`, throttling,
 * 5xx, network faults. Three properties matter more than the retry itself:
 *
 *  1. **Bounded.** Both an attempt cap and a wall-clock budget. An unbounded
 *     retry loop inside a Lambda would burn the whole invocation and, on the
 *     Fast Path, blow the 5s TEAM_TARGET and then the 60s official deadline.
 *  2. **Selective.** Only {@link isTransientError} failures are retried. A
 *     `ConditionalCheckFailedException` is a decision, not a fault; retrying it
 *     would re-attempt a transition whose guard has already been resolved.
 *  3. **Jittered.** Full jitter, because every Lambda in a fan-out that throttles
 *     at the same moment would otherwise retry at the same moment and reproduce
 *     the throttle.
 *
 * Time is injected (`sleep`, `random`, `now`), so tests are deterministic and no
 * test has to wait in real time.
 *
 * @module backend/resilience/backoff
 */

import { isTransientError } from '../errors/transient.js';

/** Retry shape: attempts, delay growth, and the wall-clock ceiling. */
export interface RetryPolicy {
  /** Total attempts INCLUDING the first. `1` disables retrying. */
  readonly maxAttempts: number;
  /** Delay before the first retry, doubled each subsequent attempt. */
  readonly baseDelayMs: number;
  /** Upper bound on a single delay, before jitter. */
  readonly maxDelayMs: number;
  /**
   * Wall-clock ceiling across all attempts. When the next delay would exceed it,
   * retrying stops and the last failure is rethrown.
   */
  readonly totalTimeBudgetMs: number;
  /** `full` (default) spreads retries across the window; `none` is fixed backoff. */
  readonly jitter?: 'full' | 'none';
}

/**
 * Fast Path policy — tight enough to stay inside the 5s TEAM_TARGET.
 *
 * Worst case without jitter: 25 + 50 = 75 ms of sleeping, capped at a 750 ms
 * budget. Used by `InjectFn` / `DecisionFn`, where a slow retry is worse than a
 * fast failure the caller can retry itself.
 */
export const FAST_PATH_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 25,
  maxDelayMs: 200,
  totalTimeBudgetMs: 750,
  jitter: 'full',
};

/**
 * Default policy for the enrichment / read paths, which sit inside the 60s
 * end-to-end budget and can afford to wait out a throttle.
 */
export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 5,
  baseDelayMs: 50,
  maxDelayMs: 2_000,
  totalTimeBudgetMs: 10_000,
  jitter: 'full',
};

/** Context handed to {@link WithRetryOptions.onRetry}. */
export interface RetryAttemptInfo {
  /** Attempt that just failed, 1-based. */
  readonly attempt: number;
  /** Delay about to be awaited, after jitter. */
  readonly delayMs: number;
  /** The failure being retried. */
  readonly error: unknown;
  /** Operation label, for metrics and logs. */
  readonly operationName: string;
}

/** Options for {@link withRetry}. */
export interface WithRetryOptions {
  readonly policy?: RetryPolicy;
  /** Label used in `onRetry` and in the exhaustion message. */
  readonly operationName?: string;
  /** Overrides the retryability predicate. Defaults to {@link isTransientError}. */
  readonly isRetryable?: (error: unknown) => boolean;
  /**
   * Observer fired before each sleep. Feeds the retry/throttle counters in
   * TASK-155. Never affects control flow, and a throw here is not swallowed.
   */
  readonly onRetry?: (info: RetryAttemptInfo) => void;
  /** Injected sleep. Defaults to `setTimeout`. */
  readonly sleep?: (delayMs: number) => Promise<void>;
  /** Injected RNG in `[0,1)`. Defaults to `Math.random`. */
  readonly random?: () => number;
  /** Injected clock in epoch ms. Defaults to `Date.now`. */
  readonly now?: () => number;
}

function defaultSleep(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

/**
 * Delay for a given attempt: `min(maxDelayMs, baseDelayMs * 2^(attempt-1))`,
 * multiplied by `random()` under full jitter.
 *
 * Exported for the policy tests, which assert growth and the cap directly.
 */
export function computeDelayMs(
  policy: RetryPolicy,
  attempt: number,
  random: () => number = Math.random,
): number {
  const exponential = policy.baseDelayMs * 2 ** (attempt - 1);
  const capped = Math.min(policy.maxDelayMs, exponential);
  if (policy.jitter === 'none') return capped;
  // Full jitter: uniform over [0, capped]. Spreads a synchronized fan-out.
  return Math.floor(capped * random());
}

/**
 * Run an operation with bounded, jittered exponential backoff.
 *
 * The last failure is rethrown unchanged once attempts or the time budget are
 * exhausted, so the caller still sees the real cause (and `mapToDomainError`
 * can turn it into a `429` or `500` at the boundary).
 *
 * @example guarded write on the Fast Path
 * ```ts
 * await withRetry(() => repo.conditionalUpdateState(input), {
 *   policy: FAST_PATH_RETRY_POLICY,
 *   operationName: 'MARK_RUNNING',
 *   onRetry: ({ attempt }) => metrics.incrementRetry('MARK_RUNNING', attempt),
 * });
 * // A failed guard is NOT retried: it is returned to apply-or-confirm.
 * ```
 */
export async function withRetry<T>(
  operation: () => Promise<T>,
  options: WithRetryOptions = {},
): Promise<T> {
  const policy = options.policy ?? DEFAULT_RETRY_POLICY;
  const operationName = options.operationName ?? 'operation';
  const isRetryable = options.isRetryable ?? isTransientError;
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;
  const now = options.now ?? Date.now;

  if (!Number.isInteger(policy.maxAttempts) || policy.maxAttempts < 1) {
    throw new RangeError(
      `RetryPolicy.maxAttempts must be an integer >= 1, got ${policy.maxAttempts}.`,
    );
  }

  const startedAt = now();
  let attempt = 0;

  for (;;) {
    attempt += 1;
    try {
      return await operation();
    } catch (error: unknown) {
      // Attempt cap reached, or the failure is not something a retry can fix.
      if (attempt >= policy.maxAttempts || !isRetryable(error)) throw error;

      const delayMs = computeDelayMs(policy, attempt, random);

      // Wall-clock ceiling: never sleep past the budget. Checked before sleeping
      // so the caller fails fast instead of overrunning its latency target.
      if (now() - startedAt + delayMs > policy.totalTimeBudgetMs) throw error;

      options.onRetry?.({ attempt, delayMs, error, operationName });
      await sleep(delayMs);
    }
  }
}
