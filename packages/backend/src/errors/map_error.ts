/**
 * Boundary mapper — turns any thrown value into a {@link DomainError} (TASK-156).
 *
 * Repository and AWS SDK errors describe internal causes; `DomainError`
 * describes the external contract. Keeping them separate means the repository
 * layer never has to know about HTTP, and a handler never has to guess a status
 * code. This mapper is the one place the two meet.
 *
 * Fail-closed by default: anything unrecognised becomes `INTERNAL_ERROR`
 * (`500`, non-retryable) rather than something optimistic. A transient fault is
 * only reported as retryable when it is positively identified as throttling.
 *
 * @module backend/errors/map_error
 */

import {
  IdempotencyConditionFailedError,
  IdempotencyRepositoryError,
  IdempotencyUsageError,
} from '../repository/idempotency_repository.js';
import { DomainError, InternalError, ThrottledError, isDomainError } from './domain_error.js';

/**
 * AWS error names that mean "transient throttling, retry with backoff" (§21.2).
 * Matched by name so it works for both real SDK errors and test doubles.
 */
const THROTTLING_ERROR_NAMES: ReadonlySet<string> = new Set([
  'ThrottlingException',
  'ThrottledException',
  'ProvisionedThroughputExceededException',
  'RequestLimitExceeded',
  'TooManyRequestsException',
  'LimitExceededException',
]);

function nameOf(error: unknown): string {
  if (typeof error !== 'object' || error === null) return '';
  const name = (error as { name?: unknown }).name;
  return typeof name === 'string' ? name : '';
}

/** True when the error, or the cause it wraps, is AWS throttling. */
function isThrottling(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;

  if (THROTTLING_ERROR_NAMES.has(nameOf(error))) return true;

  // AWS SDK v3 marks retryable throttling on the error itself.
  const retryable = (error as { $retryable?: { throttling?: unknown } }).$retryable;
  if (retryable && retryable.throttling === true) return true;

  // Repository errors wrap the SDK error as `cause`.
  const cause = (error as { cause?: unknown }).cause;
  if (cause !== undefined && cause !== error) return isThrottling(cause);

  return false;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Map any thrown value to a {@link DomainError}.
 *
 * @param error the thrown value
 * @param options.traceId correlation id attached to the resulting error
 *
 * Mapping rules:
 * | Input | Result |
 * | --- | --- |
 * | already a `DomainError` | returned unchanged (never re-wrapped) |
 * | AWS throttling (by name or `$retryable.throttling`, incl. wrapped `cause`) | `ThrottledError` → `429`, retryable |
 * | `IdempotencyUsageError` | `InternalError` → `500` (programming error) |
 * | `IdempotencyConditionFailedError` | `InternalError` → `500` (see note) |
 * | `IdempotencyRepositoryError` | `InternalError` → `500` |
 * | anything else | `InternalError` → `500` |
 *
 * Note on `IdempotencyConditionFailedError`: a failed condition is expected
 * control flow, not an API error. Callers must classify it first — as a
 * duplicate (`200`/`202`), as apply-or-confirm (TASK-095), or as the terminal
 * `CORE_IDENTITY_CONFLICT` (`409`). Reaching this mapper with one means a
 * caller skipped that step, so it is surfaced as `500` rather than being
 * silently translated into a plausible-looking client response.
 */
export function mapToDomainError(error: unknown, options: { traceId?: string } = {}): DomainError {
  if (isDomainError(error)) return error;

  const { traceId } = options;

  if (isThrottling(error)) {
    return new ThrottledError(`Downstream throttling: ${messageOf(error)}`, {
      traceId,
      cause: error,
    });
  }

  if (error instanceof IdempotencyUsageError) {
    return new InternalError(`Invalid repository usage: ${error.message}`, {
      traceId,
      cause: error,
    });
  }

  if (error instanceof IdempotencyConditionFailedError) {
    return new InternalError(
      'Unclassified conditional-check failure reached the API boundary; ' +
        'the caller must resolve it as duplicate, apply-or-confirm, or identity conflict first.',
      { traceId, cause: error },
    );
  }

  if (error instanceof IdempotencyRepositoryError) {
    return new InternalError(`Repository failure: ${error.message}`, { traceId, cause: error });
  }

  return new InternalError(messageOf(error) || 'Internal error.', { traceId, cause: error });
}
