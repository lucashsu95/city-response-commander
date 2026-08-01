/**
 * Unified structured error model (design §12; TASK-156).
 *
 * @module backend/errors
 */

export {
  ErrorCode,
  HTTP_STATUS_BY_ERROR_CODE,
  RETRYABLE_BY_ERROR_CODE,
  ALL_ERROR_CODES,
} from './error_codes.js';

export {
  DomainError,
  isDomainError,
  ValidationError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ThrottledError,
  InternalError,
  WorkflowStartFailedError,
  CoreIdentityConflictError,
} from './domain_error.js';

export type { DomainErrorOptions, DomainErrorContext } from './domain_error.js';

export { toErrorResponse, toHttpErrorResult } from './error_response.js';

export type { ErrorResponseBody, HttpErrorResult } from './error_response.js';

export { mapToDomainError, redactClientMessage } from './map_error.js';

export { isThrottlingError, isTransientError, isNonRetryableFailure } from './transient.js';
