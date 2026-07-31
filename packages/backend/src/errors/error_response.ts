/**
 * Error serialization — the wire format for every failure (§12; TASK-156).
 *
 * One envelope for all routes: `{error_code, message, trace_id, retryable}`,
 * plus `decision_id` / `status` on the inject route.
 *
 * `trace_id` is required, never optional: without it a failure cannot be
 * correlated to its CloudWatch log line (§19).
 *
 * @module backend/errors/error_response
 */

import { DomainError } from './domain_error.js';

/** Unified error response body (§12). */
export interface ErrorResponseBody {
  readonly error_code: string;
  readonly message: string;
  readonly trace_id: string;
  readonly retryable: boolean;
  /** Present on `POST /inject` failures. */
  readonly decision_id?: string;
  /** `IdempotencyTable.status` at the time of the failure, when relevant. */
  readonly status?: string;
}

/** API Gateway HTTP API (payload format 2.0) proxy result. */
export interface HttpErrorResult {
  readonly statusCode: number;
  readonly headers: Record<string, string>;
  /** JSON-serialized {@link ErrorResponseBody}. */
  readonly body: string;
}

/**
 * Serialize a {@link DomainError} to the §12 envelope.
 *
 * The `cause` chain is deliberately dropped: internal detail belongs in the
 * structured log (TASK-153), not in a client response.
 *
 * @param error the failure to serialize
 * @param traceId correlation id; `error.traceId` wins when both are present
 */
export function toErrorResponse(error: DomainError, traceId: string): ErrorResponseBody {
  const body: Record<string, unknown> = {
    error_code: error.errorCode,
    message: error.message,
    trace_id: error.traceId ?? traceId,
    retryable: error.retryable,
  };
  if (error.decisionId !== undefined) body.decision_id = error.decisionId;
  if (error.status !== undefined) body.status = error.status;
  return body as unknown as ErrorResponseBody;
}

/**
 * Serialize to an API Gateway proxy result, using the error's own HTTP status.
 *
 * Handlers never choose the status themselves — it always comes from the single
 * mapping table, which is how `CORE_IDENTITY_CONFLICT → 409` and
 * `WORKFLOW_START_FAILED → 503` stay guaranteed.
 */
export function toHttpErrorResult(error: DomainError, traceId: string): HttpErrorResult {
  return {
    statusCode: error.httpStatus,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(toErrorResponse(error, traceId)),
  };
}
