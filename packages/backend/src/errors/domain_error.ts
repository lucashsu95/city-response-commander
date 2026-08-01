/**
 * DomainError — the single error type crossing the API boundary (§12; TASK-156).
 *
 * Every `DomainError` carries an `error_code`, an HTTP status, and a
 * `retryable` flag, so an HTTP handler never decides a status code ad hoc and
 * two routes can never disagree about the same failure.
 *
 * Scope boundary — three things are deliberately NOT DomainErrors:
 *
 *  1. **Insufficient data.** `data_status=insufficient_data` /
 *     `manual_confirmation_required` is a `200` response (§12, §21). Treating a
 *     data gap as an error invites fabrication instead of disclosure.
 *  2. **A duplicate injection.** A same-key re-request is normal: `200` when
 *     `completed`, `202` when in progress (§12 status matrix). Only the terminal
 *     `CORE_IDENTITY_CONFLICT` case is an error.
 *  3. **`FENCED_STALE_EXECUTION`.** Fencing is a `StatusActionResult` inside the
 *     workflow (TASK-095), not an HTTP outcome. A fenced execution terminates
 *     silently with no side effects; raising an error would imply a client-facing
 *     status and could surface a 5xx for expected behaviour.
 *
 * @module backend/errors/domain_error
 */

import { ErrorCode, HTTP_STATUS_BY_ERROR_CODE, RETRYABLE_BY_ERROR_CODE } from './error_codes.js';

/** Optional per-route fields merged into the error payload (§12). */
export interface DomainErrorContext {
  /** Present on `POST /inject` errors. */
  readonly decisionId?: string;
  /** `IdempotencyTable.status` at the time of the error, when relevant. */
  readonly status?: string;
}

/** Options accepted by every {@link DomainError}. */
export interface DomainErrorOptions extends DomainErrorContext {
  /** Observability correlation id. May also be supplied at serialization time. */
  readonly traceId?: string;
  /** Underlying cause, kept for logging. Never serialized to the client. */
  readonly cause?: unknown;
  /** Overrides the default retryability. Use sparingly and document why. */
  readonly retryable?: boolean;
}

/**
 * Base class for every client-facing failure.
 *
 * @example
 * ```ts
 * throw new ThrottledError('DynamoDB throttled the conditional write.');
 * ```
 */
export class DomainError extends Error {
  /** Canonical `error_code` in the response body. */
  public readonly errorCode: ErrorCode;
  /** HTTP status, resolved from the single mapping table. */
  public readonly httpStatus: number;
  /** Whether the caller may safely retry. */
  public readonly retryable: boolean;
  public readonly traceId?: string;
  public readonly decisionId?: string;
  public readonly status?: string;

  constructor(errorCode: ErrorCode, message: string, options: DomainErrorOptions = {}) {
    super(message, options.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = new.target.name;
    this.errorCode = errorCode;
    this.httpStatus = HTTP_STATUS_BY_ERROR_CODE[errorCode];
    this.retryable = options.retryable ?? RETRYABLE_BY_ERROR_CODE[errorCode];
    this.traceId = options.traceId;
    this.decisionId = options.decisionId;
    this.status = options.status;
  }
}

/** Narrowing guard usable across module boundaries and bundling seams. */
export function isDomainError(error: unknown): error is DomainError {
  return error instanceof DomainError;
}

// ─── Concrete errors ───────────────────────────────────────

/** `400` — malformed request or failed input validation. */
export class ValidationError extends DomainError {
  constructor(message: string, options: DomainErrorOptions = {}) {
    super(ErrorCode.VALIDATION_FAILED, message, options);
  }
}

/** `401` — missing/invalid Cognito token. Write paths fail closed (§17). */
export class UnauthorizedError extends DomainError {
  constructor(message = 'Authentication required.', options: DomainErrorOptions = {}) {
    super(ErrorCode.UNAUTHORIZED, message, options);
  }
}

/** `403` — authenticated but lacking the required group (admin/operator/commander). */
export class ForbiddenError extends DomainError {
  constructor(message = 'Insufficient permissions.', options: DomainErrorOptions = {}) {
    super(ErrorCode.FORBIDDEN, message, options);
  }
}

/** `404` — the requested resource does not exist. */
export class NotFoundError extends DomainError {
  constructor(message: string, options: DomainErrorOptions = {}) {
    super(ErrorCode.NOT_FOUND, message, options);
  }
}

/** `429` — transient downstream throttling (§21.2). Always retryable. */
export class ThrottledError extends DomainError {
  constructor(
    message = 'Request throttled; retry with backoff.',
    options: DomainErrorOptions = {},
  ) {
    super(ErrorCode.THROTTLED, message, options);
  }
}

/** `500` — unexpected server-side failure. Fail-closed. */
export class InternalError extends DomainError {
  constructor(message = 'Internal error.', options: DomainErrorOptions = {}) {
    super(ErrorCode.INTERNAL_ERROR, message, options);
  }
}

/**
 * `503 WORKFLOW_START_FAILED` — StartExecution failed, the workflow never
 * started, and the lease was moved `starting → start_failed` (§15.2).
 *
 * The API must return this, never `202`. The same key can recover immediately
 * via `start_failed → starting` (TASK-094), so `retryable` is `true`.
 *
 * Emits `{decision_id, status:'start_failed', retryable:true, trace_id,
 * error_code:'WORKFLOW_START_FAILED'}` exactly as §12 specifies.
 */
export class WorkflowStartFailedError extends DomainError {
  constructor(
    decisionId: string,
    message = 'Failed to start the decision workflow.',
    options: Omit<DomainErrorOptions, 'decisionId' | 'status' | 'retryable'> = {},
  ) {
    super(ErrorCode.WORKFLOW_START_FAILED, message, {
      ...options,
      decisionId,
      status: 'start_failed',
    });
  }
}

/**
 * `409 CORE_IDENTITY_CONFLICT` — terminal, non-recoverable (§15.2, FIX 1).
 *
 * Returned ONLY to a later same-key POST that reads
 * `status=processing_failed AND last_error=CORE_IDENTITY_CONFLICT`. The original
 * request already received `202` when StartExecution succeeded and is never
 * retroactively re-judged.
 *
 * Always `409`, never `500`, and never `retryable`.
 *
 * Emits `{decision_id, status:'processing_failed',
 * error_code:'CORE_IDENTITY_CONFLICT', retryable:false, trace_id}`.
 */
export class CoreIdentityConflictError extends DomainError {
  constructor(
    decisionId: string,
    message = 'A different decision is already committed for this idempotency key.',
    options: Omit<DomainErrorOptions, 'decisionId' | 'status' | 'retryable'> = {},
  ) {
    super(ErrorCode.CORE_IDENTITY_CONFLICT, message, {
      ...options,
      decisionId,
      status: 'processing_failed',
    });
  }
}
