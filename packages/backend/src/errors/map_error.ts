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
 * ## Messages are redacted here
 *
 * `toErrorResponse` copies `DomainError.message` verbatim into the HTTP body, so
 * this mapper is the last point at which internal detail can be removed. Every
 * message derived from a caught error passes through
 * {@link redactClientMessage}; the unredacted original stays on the `cause` chain,
 * which the wire format drops but the structured log keeps.
 *
 * @module backend/errors/map_error
 */

import {
  IdempotencyConditionFailedError,
  IdempotencyRepositoryError,
  IdempotencyUsageError,
} from '../repository/idempotency_repository.js';
import { DomainError, InternalError, ThrottledError, isDomainError } from './domain_error.js';
import { isThrottlingError } from './transient.js';

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Longest message allowed on the wire. Anything longer is a stack or a dump. */
const MAX_CLIENT_MESSAGE_LENGTH = 200;

/**
 * Patterns that must never reach a client.
 *
 * `toErrorResponse` copies `DomainError.message` straight into the HTTP body, so
 * anything a repository or the AWS SDK put in a message is externally visible.
 * That is how a 500 ends up disclosing the DynamoDB table name and the
 * `idempotency_key` — which itself contains `event_id`, the official event
 * timestamp and the policy version.
 *
 * Redaction happens here rather than at serialization so the unredacted text is
 * still available on the `cause` chain for the structured log (TASK-153), which is
 * where operators should be reading it.
 */
const REDACTIONS: readonly { readonly pattern: RegExp; readonly replacement: string }[] = [
  // ARNs carry account id, region and resource name.
  { pattern: /arn:aws[a-z-]*:[^\s"',)]+/gi, replacement: '<arn>' },
  // DynamoDB table names as they appear in our own repository messages.
  { pattern: /\b[A-Za-z0-9_-]*Table[A-Za-z0-9_-]*\b/g, replacement: '<table>' },
  // A quoted idempotency_key: "event_id|event_timestamp|policy_version".
  { pattern: /"[^"\n]*\|[^"\n]*"/g, replacement: '"<redacted-key>"' },
  // Bare keys that escaped quoting.
  { pattern: /\b[A-Z]{2,5}_\d{4}_[A-Z]{3}_\d{3}\|[^\s"',)]+/g, replacement: '<redacted-key>' },
  // AWS SDK internals and request ids.
  {
    pattern: /\b(?:RequestId|x-amzn-RequestId|extendedRequestId)\s*[:=]\s*[^\s,;]+/gi,
    replacement: '<request-id>',
  },
  { pattern: /\bat\s+\S+\s+\([^)]*node_modules[^)]*\)/g, replacement: '<stack>' },
];

/**
 * Strip internal identifiers from a message destined for an HTTP body.
 *
 * Deliberately conservative: it removes identifiers rather than trying to decide
 * which are harmless, and truncates whatever is left. A slightly less helpful
 * message is a better trade than leaking a table name.
 */
export function redactClientMessage(message: string): string {
  let redacted = message;
  for (const { pattern, replacement } of REDACTIONS) {
    redacted = redacted.replace(pattern, replacement);
  }
  redacted = redacted.replace(/\s+/g, ' ').trim();
  return redacted.length > MAX_CLIENT_MESSAGE_LENGTH
    ? `${redacted.slice(0, MAX_CLIENT_MESSAGE_LENGTH - 1)}\u2026`
    : redacted;
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

  if (isThrottlingError(error)) {
    return new ThrottledError(`Downstream throttling: ${redactClientMessage(messageOf(error))}`, {
      traceId,
      cause: error,
    });
  }

  if (error instanceof IdempotencyUsageError) {
    return new InternalError(`Invalid repository usage: ${redactClientMessage(error.message)}`, {
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
    // A fixed message, not a redacted one. This error's text always embeds the
    // table name, the operation and the idempotency_key, so there is nothing left
    // worth showing a client after redaction. The full detail stays on `cause`
    // for the structured log, and `operation` is safe to name.
    return new InternalError(`Repository failure during ${error.operation}.`, {
      traceId,
      cause: error,
    });
  }

  return new InternalError(redactClientMessage(messageOf(error)) || 'Internal error.', {
    traceId,
    cause: error,
  });
}
