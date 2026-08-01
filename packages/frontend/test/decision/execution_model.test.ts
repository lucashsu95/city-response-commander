/**
 * Execution status decoder tests (TASK-133).
 *
 * Covers the five `IdempotencyTable` statuses, the terminal / recoverable split
 * inside `processing_failed` (FIX 1), the §12 inject status matrix, and the §13
 * `processing.failed` frame.
 *
 * Validates: Requirements REQ-003, REQ-004 (R5); design §10.11c FIX 1, §10.11e,
 * §12, §13.
 */

import { describe, expect, it } from 'vitest';
import {
  EXECUTION_STATUSES,
  attemptCountText,
  classifyExecution,
  decodeInjectionResponse,
  decodeProcessingFailed,
  isCoreIdentityConflict,
  isExecutionStatus,
  isTerminalConflictPresentation,
  offersRetry,
} from '../../src/decision/execution_model.js';
import type { ExecutionSummaryView } from '../../src/decision/decision_read_model.js';
import { executionStatusOf } from '../../src/decision/use_execution_status.js';

function projection(overrides: Partial<ExecutionSummaryView> = {}): ExecutionSummaryView {
  return {
    status: 'running',
    lastError: null,
    retryable: false,
    attemptCount: 1,
    ...overrides,
  };
}

describe('IdempotencyTable status vocabulary (§10.11e)', () => {
  it('has exactly the five documented statuses and no `accepted`', () => {
    expect([...EXECUTION_STATUSES]).toEqual([
      'starting',
      'running',
      'completed',
      'start_failed',
      'processing_failed',
    ]);
    expect(isExecutionStatus('accepted')).toBe(false);
  });

  it('rejects a null or unknown status', () => {
    expect(isExecutionStatus(null)).toBe(false);
    expect(isExecutionStatus('queued')).toBe(false);
  });
});

describe('classifyExecution', () => {
  it('reports an absent projection without calling it a failure', () => {
    const result = classifyExecution(null);

    expect(result.kind).toBe('absent');
    expect(result.status).toBeNull();
    expect(result.retryable).toBeNull();
    expect(result.attemptCount).toBeNull();
  });

  it.each([
    ['starting', 'starting'],
    ['running', 'running'],
    ['completed', 'completed'],
    ['start_failed', 'start_failed'],
  ] as const)('maps %s to its own state', (status, kind) => {
    expect(classifyExecution(projection({ status })).kind).toBe(kind);
  });

  it('carries status, last_error, retryable and attempt_count through verbatim', () => {
    const result = classifyExecution(
      projection({
        status: 'processing_failed',
        lastError: 'STALE_RUNNING_EXECUTION',
        retryable: true,
        attemptCount: 3,
      }),
    );

    expect(result.status).toBe('processing_failed');
    expect(result.lastError).toBe('STALE_RUNNING_EXECUTION');
    expect(result.retryable).toBe(true);
    expect(result.attemptCount).toBe(3);
  });

  it('classifies CORE_IDENTITY_CONFLICT as terminal and non-recoverable (FIX 1)', () => {
    const result = classifyExecution(
      projection({
        status: 'processing_failed',
        lastError: 'CORE_IDENTITY_CONFLICT',
        retryable: false,
        attemptCount: 1,
      }),
    );

    expect(result.kind).toBe('terminal_identity_conflict');
    expect(result.recoverable).toBe(false);
    expect(result.severity).toBe('terminal');
    expect(isTerminalConflictPresentation(result)).toBe(true);
  });

  it('does not treat a retryable processing_failed as terminal', () => {
    const result = classifyExecution(
      projection({ status: 'processing_failed', lastError: 'BEDROCK_TIMEOUT', retryable: true }),
    );

    expect(result.kind).toBe('processing_failed_retryable');
    expect(result.recoverable).toBe(true);
    expect(isTerminalConflictPresentation(result)).toBe(false);
  });

  it('honours retryable=false for a non-conflict failure without claiming a conflict', () => {
    const result = classifyExecution(
      projection({ status: 'processing_failed', lastError: 'SOME_OTHER_STOP', retryable: false }),
    );

    expect(result.kind).toBe('processing_failed_terminal');
    expect(result.recoverable).toBe(false);
  });

  it('fails closed when processing_failed carries no retryable flag', () => {
    const result = classifyExecution(
      projection({ status: 'processing_failed', lastError: 'X', retryable: null }),
    );

    expect(result.kind).toBe('processing_failed_unknown_retryability');
    expect(result.recoverable).toBeNull();
  });

  it('surfaces an undocumented status verbatim rather than mapping it', () => {
    const result = classifyExecution(projection({ status: 'accepted' }));

    expect(result.kind).toBe('unrecognized');
    expect(result.status).toBe('accepted');
    expect(result.recoverable).toBeNull();
  });
});

describe('decodeInjectionResponse (§12 status matrix)', () => {
  it('maps 202 to accepted (in progress), never to completed', () => {
    const outcome = decodeInjectionResponse(202, {
      decision_id: 'DEC_TPE_2026_ACC_001_ab12cd34ef56',
      trace_id: 'tr-abc123',
    });

    expect(outcome.kind).toBe('accepted');
    expect(outcome.decisionId).toBe('DEC_TPE_2026_ACC_001_ab12cd34ef56');
    expect(outcome.traceId).toBe('tr-abc123');
    expect(offersRetry(outcome)).toBe(false);
  });

  it('keeps 200 completed in its own branch, separate from 202', () => {
    const outcome = decodeInjectionResponse(200, {
      decision_id: 'DEC_1',
      status: 'completed',
    });

    expect(outcome.kind).toBe('completed');
    expect(outcome.status).toBe('completed');
  });

  it('maps 503 WORKFLOW_START_FAILED to a retryable start failure', () => {
    const outcome = decodeInjectionResponse(503, {
      decision_id: 'DEC_1',
      status: 'start_failed',
      retryable: true,
      trace_id: 'tr-1',
      error_code: 'WORKFLOW_START_FAILED',
    });

    expect(outcome.kind).toBe('start_failed');
    expect(outcome.errorCode).toBe('WORKFLOW_START_FAILED');
    expect(outcome.retryable).toBe(true);
    expect(offersRetry(outcome)).toBe(true);
  });

  it('maps 409 CORE_IDENTITY_CONFLICT to a terminal, non-retryable conflict', () => {
    const outcome = decodeInjectionResponse(409, {
      decision_id: 'DEC_1',
      status: 'processing_failed',
      error_code: 'CORE_IDENTITY_CONFLICT',
      retryable: false,
      trace_id: 'tr-1',
    });

    expect(outcome.kind).toBe('terminal_conflict');
    expect(outcome.httpStatus).toBe(409);
    expect(outcome.retryable).toBe(false);
    expect(offersRetry(outcome)).toBe(false);
    expect(isCoreIdentityConflict(outcome.errorCode)).toBe(true);
  });

  it('never lets a 409 body claim retryability', () => {
    const outcome = decodeInjectionResponse(409, {
      error_code: 'CORE_IDENTITY_CONFLICT',
      retryable: true,
    });

    expect(outcome.retryable).toBe(false);
    expect(offersRetry(outcome)).toBe(false);
  });

  it('does not fold other statuses into the four documented outcomes', () => {
    for (const status of [400, 401, 403, 429, 500]) {
      const outcome = decodeInjectionResponse(status, { error_code: 'X' });
      expect(outcome.kind).toBe('other_error');
      expect(outcome.httpStatus).toBe(status);
    }
  });

  it('withholds a retry when a 503 body did not supply retryable', () => {
    const outcome = decodeInjectionResponse(503, { error_code: 'WORKFLOW_START_FAILED' });

    expect(outcome.retryable).toBeNull();
    expect(offersRetry(outcome)).toBe(false);
  });

  it('reports missing identifiers as absent rather than inventing them', () => {
    const outcome = decodeInjectionResponse(202, {});

    expect(outcome.decisionId).toBeNull();
    expect(outcome.traceId).toBeNull();
    expect(outcome.bodyMalformed).toBe(false);
  });

  it('keeps the status branch when the body is not an object', () => {
    const outcome = decodeInjectionResponse(409, 'not json');

    expect(outcome.kind).toBe('terminal_conflict');
    expect(outcome.bodyMalformed).toBe(true);
    expect(outcome.decisionId).toBeNull();
  });
});

describe('decodeProcessingFailed (§13)', () => {
  it('reads error_code and retryable verbatim', () => {
    const view = decodeProcessingFailed({
      event_type: 'processing.failed',
      decision_id: 'DEC_1',
      event_id: 'TPE_2026_ACC_001',
      error_code: 'CORE_IDENTITY_CONFLICT',
      retryable: false,
      trace_id: 'tr-1',
      occurred_at: '2026-05-20 22:10',
      policy_version: 'prov-2026a',
    });

    expect(view.errorCode).toBe('CORE_IDENTITY_CONFLICT');
    expect(view.retryable).toBe(false);
    expect(view.traceId).toBe('tr-1');
    expect(view.malformed).toBe(false);
  });

  it('reports absent fields as null', () => {
    const view = decodeProcessingFailed({ event_type: 'processing.failed' });

    expect(view.errorCode).toBeNull();
    expect(view.retryable).toBeNull();
    expect(view.decisionId).toBeNull();
  });

  it('flags a non-object frame instead of guessing its contents', () => {
    const view = decodeProcessingFailed(null);

    expect(view.malformed).toBe(true);
    expect(view.errorCode).toBeNull();
  });
});

describe('executionStatusOf', () => {
  it('discloses a retryability disagreement without reconciling it', () => {
    const view = executionStatusOf({
      execution: projection({ status: 'processing_failed', lastError: 'X', retryable: false }),
      lastFailureEvent: decodeProcessingFailed({ error_code: 'X', retryable: true }),
    });

    expect(view.retryabilityDisagreement).toBe(true);
    expect(view.presentation.retryable).toBe(false);
    expect(view.lastFailureEvent?.retryable).toBe(true);
  });

  it('reports no disagreement when the event supplied no retryable flag', () => {
    const view = executionStatusOf({
      execution: projection({ status: 'processing_failed', lastError: 'X', retryable: false }),
      lastFailureEvent: decodeProcessingFailed({ error_code: 'X' }),
    });

    expect(view.retryabilityDisagreement).toBe(false);
  });
});

describe('attemptCountText', () => {
  it('renders an absent count as the supplied marker', () => {
    expect(attemptCountText(null, '未提供')).toBe('未提供');
  });

  it('renders an integer count verbatim', () => {
    expect(attemptCountText(2, '未提供')).toBe('2');
  });

  it('flags a non-integer count rather than rounding it', () => {
    expect(attemptCountText(1.5, '未提供')).toContain('非預期值');
  });
});
