/**
 * Resilience — bounded retry / backoff for transient downstream failures.
 *
 * @module backend/resilience
 */

export {
  withRetry,
  computeDelayMs,
  FAST_PATH_RETRY_POLICY,
  DEFAULT_RETRY_POLICY,
} from './backoff.js';

export type { RetryPolicy, WithRetryOptions, RetryAttemptInfo } from './backoff.js';
