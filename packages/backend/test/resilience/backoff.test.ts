/**
 * TASK-157 — throttling / exponential backoff unit tests.
 *
 * Time is injected, so nothing here waits in real time. The properties under
 * test: retries are bounded (attempts AND wall clock), only transient failures
 * are retried, a failed conditional check is never retried, and delays grow
 * exponentially under a cap with jitter (design §21.2, §4.3, §27).
 */

import { describe, it, expect, vi } from 'vitest';
import {
  computeDelayMs,
  withRetry,
  DEFAULT_RETRY_POLICY,
  FAST_PATH_RETRY_POLICY,
  isNonRetryableFailure,
  isThrottlingError,
  isTransientError,
  IdempotencyConditionFailedError,
  IdempotencyRepositoryError,
  IdempotencyUsageError,
  ReaderUsageError,
  ThrottledError,
  InternalError,
  IdempotencyKeyError,
} from '../../src/index.js';
import type { RetryPolicy } from '../../src/index.js';

const KEY = 'TPE_2026_ACC_001|2026-05-20 22:10|policy-v1';

/** Deterministic harness: no real sleeping, controllable clock and RNG. */
function harness(options?: { random?: number; startAt?: number }) {
  const sleeps: number[] = [];
  let clock = options?.startAt ?? 1_800_000_000_000;

  return {
    sleeps,
    sleep: async (delayMs: number): Promise<void> => {
      sleeps.push(delayMs);
      clock += delayMs;
    },
    random: () => options?.random ?? 1,
    now: () => clock,
    advance: (ms: number) => {
      clock += ms;
    },
  };
}

function throttling(): Error {
  return Object.assign(new Error('Rate exceeded'), { name: 'ThrottlingException' });
}

function conditionalFailure(): IdempotencyConditionFailedError {
  return new IdempotencyConditionFailedError('guard failed', 'conditionalUpdateState', KEY);
}

const NO_JITTER: RetryPolicy = {
  maxAttempts: 4,
  baseDelayMs: 100,
  maxDelayMs: 10_000,
  totalTimeBudgetMs: 60_000,
  jitter: 'none',
};

// ─── Classification ────────────────────────────────────────

describe('isThrottlingError', () => {
  it('detects throttling by AWS error name', () => {
    expect(isThrottlingError(throttling())).toBe(true);
    expect(
      isThrottlingError(
        Object.assign(new Error('x'), { name: 'ProvisionedThroughputExceededException' }),
      ),
    ).toBe(true);
  });

  it('detects HTTP 429 metadata', () => {
    expect(
      isThrottlingError(
        Object.assign(new Error('too many'), { $metadata: { httpStatusCode: 429 } }),
      ),
    ).toBe(true);
  });

  it('detects the SDK $retryable.throttling marker', () => {
    expect(
      isThrottlingError(Object.assign(new Error('x'), { $retryable: { throttling: true } })),
    ).toBe(true);
  });

  it('unwraps a repository error cause', () => {
    const wrapped = new IdempotencyRepositoryError('failed', 'conditionalPutNew', KEY, {
      cause: throttling(),
    });

    expect(isThrottlingError(wrapped)).toBe(true);
  });

  it('is false for a plain error', () => {
    expect(isThrottlingError(new Error('nope'))).toBe(false);
    expect(isThrottlingError('string')).toBe(false);
    expect(isThrottlingError(null)).toBe(false);
  });
});

describe('isNonRetryableFailure', () => {
  it('never retries a failed conditional check', () => {
    expect(isNonRetryableFailure(conditionalFailure())).toBe(true);
  });

  it('never retries a usage error', () => {
    expect(isNonRetryableFailure(new IdempotencyUsageError('empty guard'))).toBe(true);
    expect(isNonRetryableFailure(new ReaderUsageError('empty key'))).toBe(true);
  });

  it('never retries validation, access denied or not found', () => {
    for (const name of [
      'ValidationException',
      'AccessDeniedException',
      'ResourceNotFoundException',
      'UnrecognizedClientException',
    ]) {
      expect(isNonRetryableFailure(Object.assign(new Error('x'), { name }))).toBe(true);
    }
  });

  it('never retries a key derivation error', () => {
    expect(isNonRetryableFailure(new IdempotencyKeyError('bad', 'eventId', ''))).toBe(true);
  });

  it('sees through a wrapped cause', () => {
    const wrapped = new IdempotencyRepositoryError('failed', 'conditionalPutNew', KEY, {
      cause: Object.assign(new Error('denied'), { name: 'AccessDeniedException' }),
    });

    expect(isNonRetryableFailure(wrapped)).toBe(true);
  });
});

describe('isTransientError', () => {
  it('retries throttling', () => {
    expect(isTransientError(throttling())).toBe(true);
  });

  it('retries transient service and network faults', () => {
    for (const name of [
      'InternalServerError',
      'ServiceUnavailable',
      'RequestTimeout',
      'TimeoutError',
      'ECONNRESET',
      'ETIMEDOUT',
    ]) {
      expect(isTransientError(Object.assign(new Error('x'), { name }))).toBe(true);
    }
  });

  it('retries an HTTP 5xx', () => {
    expect(
      isTransientError(Object.assign(new Error('x'), { $metadata: { httpStatusCode: 503 } })),
    ).toBe(true);
  });

  it('does NOT retry a failed conditional check even though it is a DynamoDB error', () => {
    expect(isTransientError(conditionalFailure())).toBe(false);
  });

  it('defers to a DomainError retryable flag', () => {
    expect(isTransientError(new ThrottledError('slow down'))).toBe(true);
    expect(isTransientError(new InternalError('boom'))).toBe(false);
  });

  it('does not retry an unknown failure (no guessing)', () => {
    expect(isTransientError(new Error('mystery'))).toBe(false);
    expect(isTransientError('string')).toBe(false);
    expect(isTransientError(undefined)).toBe(false);
    expect(isTransientError({})).toBe(false);
  });

  it('never retries a non-retryable failure wrapped in a transient-looking one', () => {
    const wrapped = new IdempotencyRepositoryError('failed', 'conditionalUpdateState', KEY, {
      cause: conditionalFailure(),
    });

    expect(isTransientError(wrapped)).toBe(false);
  });
});

// ─── Delay computation ─────────────────────────────────────

describe('computeDelayMs', () => {
  it('doubles the delay per attempt without jitter', () => {
    expect(computeDelayMs(NO_JITTER, 1)).toBe(100);
    expect(computeDelayMs(NO_JITTER, 2)).toBe(200);
    expect(computeDelayMs(NO_JITTER, 3)).toBe(400);
    expect(computeDelayMs(NO_JITTER, 4)).toBe(800);
  });

  it('caps the delay at maxDelayMs', () => {
    const capped: RetryPolicy = { ...NO_JITTER, maxDelayMs: 300 };

    expect(computeDelayMs(capped, 3)).toBe(300);
    expect(computeDelayMs(capped, 10)).toBe(300);
  });

  it('applies full jitter as a uniform fraction of the capped delay', () => {
    const policy: RetryPolicy = { ...NO_JITTER, jitter: 'full' };

    expect(computeDelayMs(policy, 2, () => 0)).toBe(0);
    expect(computeDelayMs(policy, 2, () => 0.5)).toBe(100);
    expect(computeDelayMs(policy, 2, () => 0.999)).toBe(199);
  });

  it('keeps a jittered delay within [0, capped]', () => {
    const policy: RetryPolicy = { ...NO_JITTER, jitter: 'full' };

    for (const r of [0, 0.1, 0.37, 0.5, 0.9, 0.999]) {
      const delay = computeDelayMs(policy, 3, () => r);
      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThanOrEqual(400);
    }
  });
});

// ─── withRetry ─────────────────────────────────────────────

describe('withRetry', () => {
  it('returns the result without sleeping when the first attempt succeeds', async () => {
    const h = harness();
    const operation = vi.fn().mockResolvedValue('ok');

    const result = await withRetry(operation, { policy: NO_JITTER, ...h });

    expect(result).toBe('ok');
    expect(operation).toHaveBeenCalledTimes(1);
    expect(h.sleeps).toEqual([]);
  });

  it('retries a throttled call and returns the eventual success', async () => {
    const h = harness();
    const operation = vi
      .fn()
      .mockRejectedValueOnce(throttling())
      .mockRejectedValueOnce(throttling())
      .mockResolvedValue('ok');

    const result = await withRetry(operation, { policy: NO_JITTER, ...h });

    expect(result).toBe('ok');
    expect(operation).toHaveBeenCalledTimes(3);
    expect(h.sleeps).toEqual([100, 200]);
  });

  it('stops at maxAttempts and rethrows the last failure', async () => {
    const h = harness();
    const failure = throttling();
    const operation = vi.fn().mockRejectedValue(failure);

    await expect(
      withRetry(operation, { policy: { ...NO_JITTER, maxAttempts: 3 }, ...h }),
    ).rejects.toBe(failure);

    expect(operation).toHaveBeenCalledTimes(3);
    expect(h.sleeps).toHaveLength(2);
  });

  it('never retries when maxAttempts is 1', async () => {
    const h = harness();
    const operation = vi.fn().mockRejectedValue(throttling());

    await expect(
      withRetry(operation, { policy: { ...NO_JITTER, maxAttempts: 1 }, ...h }),
    ).rejects.toThrow();

    expect(operation).toHaveBeenCalledTimes(1);
    expect(h.sleeps).toEqual([]);
  });

  it('does not retry a failed conditional check', async () => {
    const h = harness();
    const failure = conditionalFailure();
    const operation = vi.fn().mockRejectedValue(failure);

    await expect(withRetry(operation, { policy: NO_JITTER, ...h })).rejects.toBe(failure);

    expect(operation).toHaveBeenCalledTimes(1);
    expect(h.sleeps).toEqual([]);
  });

  it('does not retry a non-transient failure', async () => {
    const h = harness();
    const failure = Object.assign(new Error('denied'), { name: 'AccessDeniedException' });
    const operation = vi.fn().mockRejectedValue(failure);

    await expect(withRetry(operation, { policy: NO_JITTER, ...h })).rejects.toBe(failure);

    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('stops when the next delay would exceed the time budget', async () => {
    const h = harness();
    const failure = throttling();
    const operation = vi.fn().mockRejectedValue(failure);

    // Budget 250ms: sleep 100 (total 100), sleep 200 would reach 300 → stop.
    await expect(
      withRetry(operation, {
        policy: { ...NO_JITTER, maxAttempts: 10, totalTimeBudgetMs: 250 },
        ...h,
      }),
    ).rejects.toBe(failure);

    expect(h.sleeps).toEqual([100]);
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('accounts for time spent inside the operation, not just sleeping', async () => {
    const h = harness();
    const operation = vi.fn().mockImplementation(async () => {
      h.advance(400); // a slow call burns the budget on its own
      throw throttling();
    });

    await expect(
      withRetry(operation, {
        policy: { ...NO_JITTER, maxAttempts: 10, totalTimeBudgetMs: 300 },
        ...h,
      }),
    ).rejects.toThrow();

    expect(h.sleeps).toEqual([]);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it('reports every retry to onRetry', async () => {
    const h = harness();
    const onRetry = vi.fn();
    const operation = vi.fn().mockRejectedValueOnce(throttling()).mockResolvedValue('ok');

    await withRetry(operation, {
      policy: NO_JITTER,
      operationName: 'MARK_RUNNING',
      onRetry,
      ...h,
    });

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry.mock.calls[0][0]).toMatchObject({
      attempt: 1,
      delayMs: 100,
      operationName: 'MARK_RUNNING',
    });
  });

  it('does not fire onRetry when the call succeeds first time', async () => {
    const h = harness();
    const onRetry = vi.fn();

    await withRetry(vi.fn().mockResolvedValue('ok'), { policy: NO_JITTER, onRetry, ...h });

    expect(onRetry).not.toHaveBeenCalled();
  });

  it('honours a custom retryability predicate', async () => {
    const h = harness();
    const operation = vi.fn().mockRejectedValueOnce(new Error('custom')).mockResolvedValue('ok');

    const result = await withRetry(operation, {
      policy: NO_JITTER,
      isRetryable: (error) => (error as Error).message === 'custom',
      ...h,
    });

    expect(result).toBe('ok');
    expect(operation).toHaveBeenCalledTimes(2);
  });

  it('rejects an invalid maxAttempts', async () => {
    await expect(
      withRetry(vi.fn().mockResolvedValue('ok'), { policy: { ...NO_JITTER, maxAttempts: 0 } }),
    ).rejects.toBeInstanceOf(RangeError);
  });

  it('applies jitter through the injected RNG', async () => {
    const h = harness({ random: 0.5 });
    const operation = vi.fn().mockRejectedValueOnce(throttling()).mockResolvedValue('ok');

    await withRetry(operation, { policy: { ...NO_JITTER, jitter: 'full' }, ...h });

    expect(h.sleeps).toEqual([50]);
  });
});

// ─── Policies ──────────────────────────────────────────────

describe('retry policies', () => {
  it('keeps the Fast Path policy inside the 5s TEAM_TARGET', () => {
    expect(FAST_PATH_RETRY_POLICY.totalTimeBudgetMs).toBeLessThan(5_000);
    expect(FAST_PATH_RETRY_POLICY.maxAttempts).toBeGreaterThan(1);
  });

  it('keeps the default policy inside the 60s official deadline', () => {
    expect(DEFAULT_RETRY_POLICY.totalTimeBudgetMs).toBeLessThan(60_000);
  });

  it('bounds every shipped policy', () => {
    for (const policy of [FAST_PATH_RETRY_POLICY, DEFAULT_RETRY_POLICY]) {
      expect(Number.isInteger(policy.maxAttempts)).toBe(true);
      expect(policy.maxAttempts).toBeGreaterThanOrEqual(1);
      expect(policy.maxDelayMs).toBeGreaterThan(0);
      expect(policy.totalTimeBudgetMs).toBeGreaterThan(0);
      expect(policy.jitter).toBe('full');
    }
  });

  it('caps the worst-case Fast Path sleeping well under the target', () => {
    const noJitter: RetryPolicy = { ...FAST_PATH_RETRY_POLICY, jitter: 'none' };
    let total = 0;
    for (let attempt = 1; attempt < FAST_PATH_RETRY_POLICY.maxAttempts; attempt += 1) {
      total += computeDelayMs(noJitter, attempt);
    }

    expect(total).toBeLessThan(FAST_PATH_RETRY_POLICY.totalTimeBudgetMs);
  });
});
