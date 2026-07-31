/**
 * TASK-156 — unified structured error model unit tests.
 *
 * Locks the design §12 contract: one `{error_code, message, trace_id, retryable}`
 * envelope, one status-code mapping table, and the hard rules that
 * `CORE_IDENTITY_CONFLICT` is always 409 (never 500), `WORKFLOW_START_FAILED` is
 * always 503, throttling is 429/retryable, and no error maps to 200.
 */

import { describe, it, expect } from 'vitest';
import {
  ALL_ERROR_CODES,
  CoreIdentityConflictError,
  DomainError,
  ErrorCode,
  ForbiddenError,
  HTTP_STATUS_BY_ERROR_CODE,
  IdempotencyConditionFailedError,
  IdempotencyRepositoryError,
  IdempotencyUsageError,
  InternalError,
  NotFoundError,
  RETRYABLE_BY_ERROR_CODE,
  ThrottledError,
  UnauthorizedError,
  ValidationError,
  WorkflowStartFailedError,
  isDomainError,
  mapToDomainError,
  redactClientMessage,
  toErrorResponse,
  toHttpErrorResult,
} from '../../src/index.js';
import type { ErrorResponseBody } from '../../src/index.js';

const TRACE = 'trace-abc-123';
const DECISION = 'DEC_ACC_001';
const KEY = 'TPE_2026_ACC_001|2026-05-20 22:10|policy-v1';

describe('error code mapping table', () => {
  it('assigns an HTTP status to every code', () => {
    for (const code of ALL_ERROR_CODES) {
      expect(HTTP_STATUS_BY_ERROR_CODE[code]).toBeTypeOf('number');
    }
  });

  it('assigns a retryability to every code', () => {
    for (const code of ALL_ERROR_CODES) {
      expect(RETRYABLE_BY_ERROR_CODE[code]).toBeTypeOf('boolean');
    }
  });

  it('never maps an error to 200 (insufficient data is not an error)', () => {
    for (const code of ALL_ERROR_CODES) {
      expect(HTTP_STATUS_BY_ERROR_CODE[code]).toBeGreaterThanOrEqual(400);
    }
  });

  it('keeps every status inside 4xx/5xx', () => {
    for (const code of ALL_ERROR_CODES) {
      expect(HTTP_STATUS_BY_ERROR_CODE[code]).toBeLessThan(600);
    }
  });

  it('maps CORE_IDENTITY_CONFLICT to 409, never 500 (§12 FIX 1)', () => {
    expect(HTTP_STATUS_BY_ERROR_CODE[ErrorCode.CORE_IDENTITY_CONFLICT]).toBe(409);
    expect(HTTP_STATUS_BY_ERROR_CODE[ErrorCode.CORE_IDENTITY_CONFLICT]).not.toBe(500);
  });

  it('marks CORE_IDENTITY_CONFLICT non-retryable (terminal)', () => {
    expect(RETRYABLE_BY_ERROR_CODE[ErrorCode.CORE_IDENTITY_CONFLICT]).toBe(false);
  });

  it('maps WORKFLOW_START_FAILED to 503 and retryable (§15.2)', () => {
    expect(HTTP_STATUS_BY_ERROR_CODE[ErrorCode.WORKFLOW_START_FAILED]).toBe(503);
    expect(RETRYABLE_BY_ERROR_CODE[ErrorCode.WORKFLOW_START_FAILED]).toBe(true);
  });

  it('maps THROTTLED to 429 and retryable (§21.2)', () => {
    expect(HTTP_STATUS_BY_ERROR_CODE[ErrorCode.THROTTLED]).toBe(429);
    expect(RETRYABLE_BY_ERROR_CODE[ErrorCode.THROTTLED]).toBe(true);
  });

  it('maps auth and validation failures to non-retryable 4xx', () => {
    expect(HTTP_STATUS_BY_ERROR_CODE[ErrorCode.VALIDATION_FAILED]).toBe(400);
    expect(HTTP_STATUS_BY_ERROR_CODE[ErrorCode.UNAUTHORIZED]).toBe(401);
    expect(HTTP_STATUS_BY_ERROR_CODE[ErrorCode.FORBIDDEN]).toBe(403);
    expect(HTTP_STATUS_BY_ERROR_CODE[ErrorCode.NOT_FOUND]).toBe(404);
    for (const code of [
      ErrorCode.VALIDATION_FAILED,
      ErrorCode.UNAUTHORIZED,
      ErrorCode.FORBIDDEN,
      ErrorCode.NOT_FOUND,
    ]) {
      expect(RETRYABLE_BY_ERROR_CODE[code]).toBe(false);
    }
  });
});

describe('DomainError', () => {
  it('resolves status and retryability from the code', () => {
    const error = new DomainError(ErrorCode.THROTTLED, 'slow down');

    expect(error.errorCode).toBe(ErrorCode.THROTTLED);
    expect(error.httpStatus).toBe(429);
    expect(error.retryable).toBe(true);
  });

  it('is an Error with the subclass name', () => {
    const error = new ValidationError('bad event_id');

    expect(error).toBeInstanceOf(Error);
    expect(error).toBeInstanceOf(DomainError);
    expect(error.name).toBe('ValidationError');
    expect(error.message).toBe('bad event_id');
  });

  it('keeps the cause for logging', () => {
    const cause = new Error('root cause');
    const error = new InternalError('wrapped', { cause });

    expect(error.cause).toBe(cause);
  });

  it('carries traceId, decisionId and status when provided', () => {
    const error = new InternalError('boom', {
      traceId: TRACE,
      decisionId: DECISION,
      status: 'running',
    });

    expect(error.traceId).toBe(TRACE);
    expect(error.decisionId).toBe(DECISION);
    expect(error.status).toBe('running');
  });

  it('allows an explicit retryable override', () => {
    const error = new InternalError('transient infra blip', { retryable: true });

    expect(error.retryable).toBe(true);
  });

  it('narrows with isDomainError', () => {
    expect(isDomainError(new NotFoundError('missing'))).toBe(true);
    expect(isDomainError(new Error('plain'))).toBe(false);
    expect(isDomainError('not an error')).toBe(false);
    expect(isDomainError(null)).toBe(false);
  });
});

describe('concrete errors', () => {
  it('ValidationError → 400', () => {
    expect(new ValidationError('x').httpStatus).toBe(400);
  });

  it('UnauthorizedError → 401 with a default message', () => {
    const error = new UnauthorizedError();
    expect(error.httpStatus).toBe(401);
    expect(error.message).toBe('Authentication required.');
  });

  it('ForbiddenError → 403', () => {
    expect(new ForbiddenError().httpStatus).toBe(403);
  });

  it('NotFoundError → 404', () => {
    expect(new NotFoundError('no such decision').httpStatus).toBe(404);
  });

  it('ThrottledError → 429 retryable', () => {
    const error = new ThrottledError();
    expect(error.httpStatus).toBe(429);
    expect(error.retryable).toBe(true);
  });

  it('InternalError → 500 non-retryable', () => {
    const error = new InternalError();
    expect(error.httpStatus).toBe(500);
    expect(error.retryable).toBe(false);
  });

  describe('WorkflowStartFailedError', () => {
    it('produces the exact §12 503 shape', () => {
      const error = new WorkflowStartFailedError(DECISION, 'StartExecution threw', {
        traceId: TRACE,
      });

      expect(error.httpStatus).toBe(503);
      expect(error.errorCode).toBe(ErrorCode.WORKFLOW_START_FAILED);
      expect(error.retryable).toBe(true);
      expect(error.decisionId).toBe(DECISION);
      expect(error.status).toBe('start_failed');
    });

    it('is never a 202-equivalent success', () => {
      expect(new WorkflowStartFailedError(DECISION).httpStatus).not.toBe(202);
    });
  });

  describe('CoreIdentityConflictError', () => {
    it('produces the exact §12 409 shape', () => {
      const error = new CoreIdentityConflictError(DECISION, undefined, { traceId: TRACE });

      expect(error.httpStatus).toBe(409);
      expect(error.errorCode).toBe(ErrorCode.CORE_IDENTITY_CONFLICT);
      expect(error.retryable).toBe(false);
      expect(error.decisionId).toBe(DECISION);
      expect(error.status).toBe('processing_failed');
    });

    it('is never 500 (fail-closed but explicit)', () => {
      expect(new CoreIdentityConflictError(DECISION).httpStatus).not.toBe(500);
    });
  });
});

describe('toErrorResponse', () => {
  it('emits the unified envelope', () => {
    const body = toErrorResponse(new ValidationError('bad request'), TRACE);

    expect(body).toEqual<ErrorResponseBody>({
      error_code: 'VALIDATION_FAILED',
      message: 'bad request',
      trace_id: TRACE,
      retryable: false,
    });
  });

  it('omits decision_id and status when absent', () => {
    const body = toErrorResponse(new ThrottledError('slow down'), TRACE);

    expect(Object.keys(body).sort()).toEqual(['error_code', 'message', 'retryable', 'trace_id']);
  });

  it('emits the §12 503 payload for WORKFLOW_START_FAILED', () => {
    const body = toErrorResponse(new WorkflowStartFailedError(DECISION, 'boom'), TRACE);

    expect(body).toEqual<ErrorResponseBody>({
      error_code: 'WORKFLOW_START_FAILED',
      message: 'boom',
      trace_id: TRACE,
      retryable: true,
      decision_id: DECISION,
      status: 'start_failed',
    });
  });

  it('emits the §12 409 payload for CORE_IDENTITY_CONFLICT', () => {
    const body = toErrorResponse(new CoreIdentityConflictError(DECISION, 'conflict'), TRACE);

    expect(body).toEqual<ErrorResponseBody>({
      error_code: 'CORE_IDENTITY_CONFLICT',
      message: 'conflict',
      trace_id: TRACE,
      retryable: false,
      decision_id: DECISION,
      status: 'processing_failed',
    });
  });

  it('prefers the trace id carried on the error', () => {
    const body = toErrorResponse(new InternalError('boom', { traceId: 'from-error' }), TRACE);

    expect(body.trace_id).toBe('from-error');
  });

  it('falls back to the supplied trace id', () => {
    const body = toErrorResponse(new InternalError('boom'), TRACE);

    expect(body.trace_id).toBe(TRACE);
  });

  it('never leaks the cause chain to the client', () => {
    const cause = new Error('SECRET internal detail');
    const body = toErrorResponse(new InternalError('Internal error.', { cause }), TRACE);

    expect(JSON.stringify(body)).not.toContain('SECRET internal detail');
    expect(body).not.toHaveProperty('cause');
    expect(body).not.toHaveProperty('stack');
  });
});

describe('toHttpErrorResult', () => {
  it('uses the error status and serializes the envelope', () => {
    const result = toHttpErrorResult(new CoreIdentityConflictError(DECISION), TRACE);

    expect(result.statusCode).toBe(409);
    expect(result.headers['content-type']).toBe('application/json');
    expect(JSON.parse(result.body)).toMatchObject({
      error_code: 'CORE_IDENTITY_CONFLICT',
      retryable: false,
      status: 'processing_failed',
    });
  });

  it('uses 503 for a start failure', () => {
    const result = toHttpErrorResult(new WorkflowStartFailedError(DECISION), TRACE);

    expect(result.statusCode).toBe(503);
  });

  it('produces JSON-parseable output for every code', () => {
    for (const code of ALL_ERROR_CODES) {
      const result = toHttpErrorResult(new DomainError(code, `failure ${code}`), TRACE);
      const parsed = JSON.parse(result.body) as ErrorResponseBody;

      expect(result.statusCode).toBe(HTTP_STATUS_BY_ERROR_CODE[code]);
      expect(parsed.error_code).toBe(code);
      expect(parsed.trace_id).toBe(TRACE);
      expect(parsed.retryable).toBe(RETRYABLE_BY_ERROR_CODE[code]);
    }
  });
});

describe('mapToDomainError', () => {
  it('returns an existing DomainError unchanged', () => {
    const original = new CoreIdentityConflictError(DECISION);

    expect(mapToDomainError(original, { traceId: TRACE })).toBe(original);
  });

  it('maps AWS throttling by name to 429 retryable', () => {
    const throttling = Object.assign(new Error('Rate exceeded'), {
      name: 'ThrottlingException',
    });

    const mapped = mapToDomainError(throttling, { traceId: TRACE });

    expect(mapped).toBeInstanceOf(ThrottledError);
    expect(mapped.httpStatus).toBe(429);
    expect(mapped.retryable).toBe(true);
    expect(mapped.traceId).toBe(TRACE);
  });

  it('maps DynamoDB provisioned-throughput errors to 429', () => {
    const throttling = Object.assign(new Error('Throughput exceeded'), {
      name: 'ProvisionedThroughputExceededException',
    });

    expect(mapToDomainError(throttling).httpStatus).toBe(429);
  });

  it('detects throttling via the SDK $retryable marker', () => {
    const throttling = Object.assign(new Error('slow down'), {
      name: 'SomeUnknownException',
      $retryable: { throttling: true },
    });

    expect(mapToDomainError(throttling).httpStatus).toBe(429);
  });

  it('detects throttling wrapped as a repository error cause', () => {
    const cause = Object.assign(new Error('Rate exceeded'), { name: 'ThrottlingException' });
    const wrapped = new IdempotencyRepositoryError(
      'conditionalUpdateState failed',
      'conditionalUpdateState',
      KEY,
      { cause },
    );

    const mapped = mapToDomainError(wrapped, { traceId: TRACE });

    expect(mapped).toBeInstanceOf(ThrottledError);
    expect(mapped.retryable).toBe(true);
  });

  it('maps a repository failure to 500 non-retryable', () => {
    const failure = new IdempotencyRepositoryError('table unavailable', 'getConsistent', KEY);

    const mapped = mapToDomainError(failure, { traceId: TRACE });

    expect(mapped).toBeInstanceOf(InternalError);
    expect(mapped.httpStatus).toBe(500);
    expect(mapped.retryable).toBe(false);
    expect(mapped.cause).toBe(failure);
  });

  it('maps a usage error to 500 (programming error)', () => {
    const mapped = mapToDomainError(new IdempotencyUsageError('empty guard'));

    expect(mapped.httpStatus).toBe(500);
    expect(mapped.message).toContain('Invalid repository usage');
  });

  it('maps an unclassified conditional failure to 500, not a plausible 4xx', () => {
    const failure = new IdempotencyConditionFailedError('guard failed', 'conditionalPutNew', KEY);

    const mapped = mapToDomainError(failure, { traceId: TRACE });

    expect(mapped.httpStatus).toBe(500);
    expect(mapped.httpStatus).not.toBe(409);
    expect(mapped.httpStatus).not.toBe(202);
    expect(mapped.message).toContain('caller must resolve it');
  });

  it('maps an unknown error to 500 and keeps the cause', () => {
    const failure = new Error('socket hang up');

    const mapped = mapToDomainError(failure, { traceId: TRACE });

    expect(mapped).toBeInstanceOf(InternalError);
    expect(mapped.httpStatus).toBe(500);
    expect(mapped.cause).toBe(failure);
  });

  it('maps a non-Error thrown value to 500', () => {
    const mapped = mapToDomainError('something odd', { traceId: TRACE });

    expect(mapped.httpStatus).toBe(500);
    expect(mapped.message).toBe('something odd');
  });

  it('never produces a retryable result for an unidentified failure', () => {
    for (const thrown of [new Error('x'), 'y', 42, null, undefined, {}]) {
      expect(mapToDomainError(thrown).retryable).toBe(false);
    }
  });
});

describe('scope boundary (design §12 / §21)', () => {
  it('has no error code for insufficient data (it is a 200 + data_status)', () => {
    const codes = ALL_ERROR_CODES.map((code) => String(code));

    expect(codes).not.toContain('INSUFFICIENT_DATA');
    expect(codes).not.toContain('MANUAL_CONFIRMATION_REQUIRED');
  });

  it('has no error code for a duplicate injection (it is a 200/202)', () => {
    const codes = ALL_ERROR_CODES.map((code) => String(code));

    expect(codes).not.toContain('DUPLICATE_REQUEST');
    expect(codes).not.toContain('IDEMPOTENCY_CONFLICT');
  });

  it('has no error code for fencing (it is a StatusActionResult, not HTTP)', () => {
    const codes = ALL_ERROR_CODES.map((code) => String(code));

    expect(codes).not.toContain('FENCED_STALE_EXECUTION');
    expect(codes).not.toContain('ALREADY_APPLIED');
  });
});

// ─── Client message redaction (audit fix 3b) ───────────────

describe('redactClientMessage', () => {
  /**
   * `toErrorResponse` copies `DomainError.message` straight into the HTTP body, so
   * whatever a repository or the AWS SDK wrote into a message is externally
   * visible. These tests pin what must never get out.
   */

  it('removes an ARN', () => {
    const redacted = redactClientMessage(
      'StartExecution failed for arn:aws:states:ap-northeast-1:123456789012:stateMachine:Wf',
    );

    expect(redacted).not.toContain('123456789012');
    expect(redacted).not.toContain('arn:aws');
    expect(redacted).toContain('<arn>');
  });

  it('removes a DynamoDB table name', () => {
    const redacted = redactClientMessage('IdempotencyTable UpdateItem failed');

    expect(redacted).not.toContain('IdempotencyTable');
    expect(redacted).toContain('<table>');
  });

  it('removes a quoted idempotency_key', () => {
    const redacted = redactClientMessage(
      'Conditional check failed for "TPE_2026_ACC_001|2026-05-20 22:10|prov-2026a"',
    );

    // The key embeds event_id, the official event timestamp and the policy version.
    expect(redacted).not.toContain('TPE_2026_ACC_001');
    expect(redacted).not.toContain('prov-2026a');
  });

  it('removes an unquoted idempotency_key', () => {
    const redacted = redactClientMessage(
      'lease lost: TPE_2026_ACC_001|2026-05-20T22:10|prov-2026a rejected',
    );

    expect(redacted).not.toContain('prov-2026a');
  });

  it('removes an AWS request id', () => {
    expect(redactClientMessage('failed, RequestId: 8QF1V2ABCDEF3GHI')).not.toContain(
      '8QF1V2ABCDEF3GHI',
    );
  });

  it('removes node_modules stack frames', () => {
    const redacted = redactClientMessage(
      'boom at Object.send (/var/task/node_modules/@aws-sdk/client-dynamodb/index.js:1:1)',
    );

    expect(redacted).not.toContain('node_modules');
  });

  it('truncates a message long enough to be a dump', () => {
    expect(redactClientMessage('x'.repeat(5_000)).length).toBeLessThanOrEqual(200);
  });

  it('leaves a clean message intact', () => {
    expect(redactClientMessage('Authentication required.')).toBe('Authentication required.');
  });
});

describe('mapToDomainError redaction', () => {
  it('does not leak the table name or key from a repository failure', () => {
    const cause = new IdempotencyRepositoryError(
      'IdempotencyTable UpdateItem failed for "TPE_2026_ACC_001|2026-05-20 22:10|prov-2026a": boom',
      'conditionalUpdateState',
      'TPE_2026_ACC_001|2026-05-20 22:10|prov-2026a',
    );

    const mapped = mapToDomainError(cause, { traceId: 'trace-1' });

    expect(mapped.httpStatus).toBe(500);
    expect(mapped.message).not.toContain('IdempotencyTable');
    expect(mapped.message).not.toContain('TPE_2026_ACC_001');
    // The operation name is safe and useful.
    expect(mapped.message).toContain('conditionalUpdateState');
  });

  it('keeps the unredacted cause for the structured log', () => {
    const cause = new IdempotencyRepositoryError(
      'IdempotencyTable UpdateItem failed',
      'conditionalUpdateState',
      'key-1',
    );

    const mapped = mapToDomainError(cause);

    // Operators still need the real text; it just belongs in the log, not the body.
    expect((mapped as { cause?: unknown }).cause).toBe(cause);
  });

  it('does not leak an ARN through the HTTP body', () => {
    const mapped = mapToDomainError(
      new Error('failed at arn:aws:states:ap-northeast-1:123456789012:stateMachine:Wf'),
    );

    const body = JSON.parse(toHttpErrorResult(mapped, 'trace-1').body) as { message: string };

    expect(body.message).not.toContain('123456789012');
  });

  it('redacts a throttling message too', () => {
    const throttle = Object.assign(new Error('Throughput exceeded for IdempotencyTable'), {
      name: 'ProvisionedThroughputExceededException',
    });

    const mapped = mapToDomainError(throttle);

    expect(mapped.httpStatus).toBe(429);
    expect(mapped.message).not.toContain('IdempotencyTable');
  });
});
