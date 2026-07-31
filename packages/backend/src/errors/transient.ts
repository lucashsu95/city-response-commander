/**
 * Transient-failure classification — the predicate that decides what may be
 * retried (design §21.2; TASK-156 / TASK-157).
 *
 * Getting this predicate wrong is worse than having no retries at all:
 *
 *  - Retrying a `ConditionalCheckFailedException` would re-attempt a guarded
 *    transition whose guard has already been decided. That is control flow, not
 *    a fault: it must be resolved by apply-or-confirm (TASK-095) or same-key
 *    routing (TASK-088), never by a retry loop.
 *  - Retrying an `AccessDeniedException` would mask an IAM misconfiguration that
 *    §21 requires to fail closed and alert.
 *  - Retrying an unknown error is a guess. The default is therefore "do not
 *    retry": everything the system genuinely needs to retry is positively
 *    identifiable.
 *
 * @module backend/errors/transient
 */

import {
  IdempotencyConditionFailedError,
  IdempotencyUsageError,
  ReaderUsageError,
} from '../repository/index.js';
import { isDomainError } from './domain_error.js';

/** AWS error names meaning "throttled, retry with backoff" (§21.2). */
const THROTTLING_ERROR_NAMES: ReadonlySet<string> = new Set([
  'ThrottlingException',
  'ThrottledException',
  'ProvisionedThroughputExceededException',
  'RequestLimitExceeded',
  'TooManyRequestsException',
  'LimitExceededException',
]);

/** Transient service/network faults that are safe to retry. */
const TRANSIENT_ERROR_NAMES: ReadonlySet<string> = new Set([
  'InternalServerError',
  'InternalFailure',
  'ServiceUnavailable',
  'ServiceUnavailableException',
  'RequestTimeout',
  'RequestTimeoutException',
  'TimeoutError',
  'NetworkingError',
  'ECONNRESET',
  'ECONNREFUSED',
  'EPIPE',
  'ETIMEDOUT',
  'TransactionInProgressException',
]);

/**
 * Failures that must NEVER be retried, checked before anything else.
 *
 * These are decisions or misconfigurations, not faults. Retrying them cannot
 * change the outcome and would hide the real problem.
 */
const NEVER_RETRY_ERROR_NAMES: ReadonlySet<string> = new Set([
  'ConditionalCheckFailedException',
  'ValidationException',
  'AccessDeniedException',
  'UnrecognizedClientException',
  'ResourceNotFoundException',
  'IdempotencyKeyError',
]);

function nameOf(error: unknown): string {
  if (typeof error !== 'object' || error === null) return '';
  const name = (error as { name?: unknown }).name;
  return typeof name === 'string' ? name : '';
}

function causeOf(error: unknown): unknown {
  if (typeof error !== 'object' || error === null) return undefined;
  const cause = (error as { cause?: unknown }).cause;
  return cause === error ? undefined : cause;
}

function httpStatusOf(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const metadata = (error as { $metadata?: { httpStatusCode?: unknown } }).$metadata;
  const status = metadata?.httpStatusCode;
  return typeof status === 'number' ? status : undefined;
}

/** `true` when the failure — or the cause it wraps — is AWS throttling. */
export function isThrottlingError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;

  if (THROTTLING_ERROR_NAMES.has(nameOf(error))) return true;
  if (httpStatusOf(error) === 429) return true;

  // AWS SDK v3 marks retryable throttling on the error itself.
  const retryable = (error as { $retryable?: { throttling?: unknown } }).$retryable;
  if (retryable && retryable.throttling === true) return true;

  const cause = causeOf(error);
  return cause !== undefined ? isThrottlingError(cause) : false;
}

/** `true` when the failure must never be retried, regardless of anything else. */
export function isNonRetryableFailure(error: unknown): boolean {
  if (
    error instanceof IdempotencyConditionFailedError ||
    error instanceof IdempotencyUsageError ||
    error instanceof ReaderUsageError
  ) {
    return true;
  }
  if (NEVER_RETRY_ERROR_NAMES.has(nameOf(error))) return true;

  const cause = causeOf(error);
  return cause !== undefined ? isNonRetryableFailure(cause) : false;
}

/**
 * `true` when the failure is transient and a bounded retry is appropriate.
 *
 * Decision order:
 *  1. never-retry list wins outright (including a wrapped `cause`);
 *  2. throttling → retry;
 *  3. transient service/network fault, or HTTP 5xx → retry;
 *  4. a `DomainError` defers to its own `retryable` flag;
 *  5. otherwise → do not retry.
 */
export function isTransientError(error: unknown): boolean {
  if (isNonRetryableFailure(error)) return false;
  if (isThrottlingError(error)) return true;

  if (TRANSIENT_ERROR_NAMES.has(nameOf(error))) return true;

  const status = httpStatusOf(error);
  if (status !== undefined && status >= 500) return true;

  const retryable = (error as { $retryable?: unknown } | null)?.$retryable;
  if (retryable !== undefined && retryable !== null) return true;

  if (isDomainError(error)) return error.retryable;

  const cause = causeOf(error);
  return cause !== undefined ? isTransientError(cause) : false;
}
