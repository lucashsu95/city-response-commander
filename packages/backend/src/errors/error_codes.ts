/**
 * Error codes and their HTTP / retryability mapping (design §12; TASK-156).
 *
 * The mapping lives in one table so no handler can invent a status code, and so
 * the design's hard rules are checkable by a test rather than by review:
 *
 *  - `CORE_IDENTITY_CONFLICT` is ALWAYS `409`, never `500` (§12, FIX 1), and is
 *    always `retryable: false` — it is terminal and non-recoverable.
 *  - `WORKFLOW_START_FAILED` is ALWAYS `503` with `retryable: true`; a
 *    StartExecution failure must never be reported as `202` (§15.2).
 *  - Throttling is `429` with `retryable: true` (§21.2).
 *  - No error code maps to `200`. Insufficient data is NOT an error: it is a
 *    `200` response carrying `data_status=insufficient_data` /
 *    `manual_confirmation_required` (§12, §21). Modelling it as an error would
 *    push the system toward fabricating a result instead of disclosing a gap.
 *
 * @module backend/errors/error_codes
 */

/** Canonical `error_code` values carried in every error response. */
export const ErrorCode = {
  /** Malformed request / failed input validation. */
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  /** Missing or invalid credentials (Cognito). Write paths fail closed (§17). */
  UNAUTHORIZED: 'UNAUTHORIZED',
  /** Authenticated but lacking the required group/scope. */
  FORBIDDEN: 'FORBIDDEN',
  /** Requested resource does not exist. */
  NOT_FOUND: 'NOT_FOUND',
  /**
   * DecisionCore identity mismatch on a duplicate key (§15.2, FIX 1).
   * Terminal: returned only to a LATER same-key POST; the original `202` is
   * never retroactively changed.
   */
  CORE_IDENTITY_CONFLICT: 'CORE_IDENTITY_CONFLICT',
  /** Downstream throttling (API Gateway / DynamoDB). Transient. */
  THROTTLED: 'THROTTLED',
  /** Step Functions StartExecution failed; the workflow never started (§15.2). */
  WORKFLOW_START_FAILED: 'WORKFLOW_START_FAILED',
  /** Unexpected server-side failure. Fail-closed, never a silent downgrade. */
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

/** Union of the canonical `error_code` values. */
export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/**
 * HTTP status per error code.
 *
 * `Record<ErrorCode, number>` makes a missing entry a compile error, so adding a
 * code forces an explicit status decision.
 */
export const HTTP_STATUS_BY_ERROR_CODE: Record<ErrorCode, number> = {
  [ErrorCode.VALIDATION_FAILED]: 400,
  [ErrorCode.UNAUTHORIZED]: 401,
  [ErrorCode.FORBIDDEN]: 403,
  [ErrorCode.NOT_FOUND]: 404,
  [ErrorCode.CORE_IDENTITY_CONFLICT]: 409,
  [ErrorCode.THROTTLED]: 429,
  [ErrorCode.INTERNAL_ERROR]: 500,
  [ErrorCode.WORKFLOW_START_FAILED]: 503,
};

/**
 * Default retryability per error code.
 *
 * Only transient conditions are retryable. `CORE_IDENTITY_CONFLICT` is
 * deliberately `false`: retrying it would attempt to overwrite an immutable
 * DecisionCore.
 */
export const RETRYABLE_BY_ERROR_CODE: Record<ErrorCode, boolean> = {
  [ErrorCode.VALIDATION_FAILED]: false,
  [ErrorCode.UNAUTHORIZED]: false,
  [ErrorCode.FORBIDDEN]: false,
  [ErrorCode.NOT_FOUND]: false,
  [ErrorCode.CORE_IDENTITY_CONFLICT]: false,
  [ErrorCode.THROTTLED]: true,
  [ErrorCode.INTERNAL_ERROR]: false,
  [ErrorCode.WORKFLOW_START_FAILED]: true,
};

/** All canonical error codes, for exhaustiveness checks in tests. */
export const ALL_ERROR_CODES: readonly ErrorCode[] = Object.values(ErrorCode);
