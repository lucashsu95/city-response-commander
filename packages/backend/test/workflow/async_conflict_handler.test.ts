/**
 * TASK-096 — async CORE_IDENTITY_CONFLICT handling unit tests.
 *
 * Verifies the terminal block (retryable=false / recovery_stage=NONE), the
 * CRITICAL_SECURITY_ALERT, that no Fast Path event is ever announced, and that a
 * notification failure does not un-record the conflict (§15.2, FIX 1).
 */

import { describe, it, expect, vi } from 'vitest';
import {
  IdempotencyStatus,
  RecoveryStage,
  StatusActionResult,
} from '@city-commander/shared-schemas';
import {
  handleCoreIdentityConflict,
  SecurityAlerting,
  StructuredLogger,
  IdempotencyConditionFailedError,
  IdempotencyRepositoryError,
  ProcessingFailure,
  PROCESSING_FAILED_EVENT,
} from '../../src/index.js';
import type {
  AsyncConflictPorts,
  ConditionalUpdateStateInput,
  LogLevel,
  LogSink,
  ProcessingFailedEvent,
  StructuredLogRecord,
} from '../../src/index.js';
import {
  createStore,
  record,
  statusContext,
  statusInput,
  KEY,
  OTHER_EXEC,
} from './status_fixtures.js';

const TRACE = 'trace-abc-123';

const mismatches = [{ field: 'core_hash' as const, expected: 'sha256:A', actual: 'sha256:B' }];

interface CapturingSink extends LogSink {
  readonly lines: { level: LogLevel; record: StructuredLogRecord }[];
}

function createSink(): CapturingSink {
  const lines: { level: LogLevel; record: StructuredLogRecord }[] = [];
  return {
    lines,
    write: vi.fn((level: LogLevel, r: StructuredLogRecord) => {
      lines.push({ level, record: r });
    }),
  };
}

function createPorts(options?: {
  statusResult?: StatusActionResult;
  withPublisher?: boolean;
  publishFails?: boolean;
}): {
  ports: AsyncConflictPorts;
  store: ReturnType<typeof createStore>;
  sink: CapturingSink;
  publish: ReturnType<typeof vi.fn>;
} {
  const store = createStore();
  const conflicted = record({
    status: IdempotencyStatus.processing_failed,
    last_error: ProcessingFailure.CORE_IDENTITY_CONFLICT,
    retryable: false,
    recovery_stage: RecoveryStage.NONE,
  });

  if (options?.statusResult === StatusActionResult.FENCED_STALE_EXECUTION) {
    store.conditionalUpdateState.mockRejectedValue(
      new IdempotencyConditionFailedError('guard', 'conditionalUpdateState', KEY),
    );
    store.getConsistent.mockResolvedValue(record({ workflow_execution_arn: OTHER_EXEC }));
  } else {
    store.conditionalUpdateState.mockResolvedValue(conflicted);
  }

  const sink = createSink();
  const securityAlerting = new SecurityAlerting(
    new StructuredLogger({
      correlation: { trace_id: TRACE },
      now: () => 1_800_000_000_000,
      sink,
    }),
  );

  const publish = vi.fn();
  if (options?.publishFails === true) publish.mockRejectedValue(new Error('websocket down'));
  else publish.mockResolvedValue(undefined);

  return {
    store,
    sink,
    publish,
    ports: {
      statusStore: store,
      securityAlerting,
      ...(options?.withPublisher === false
        ? {}
        : { publisher: { publishProcessingFailed: publish } }),
    },
  };
}

const conflictInput = {
  workflowInput: statusInput,
  context: statusContext,
  traceId: TRACE,
  mismatches,
  storedCoreHash: 'sha256:B',
  computedCoreHash: 'sha256:A',
};

function updateOf(store: ReturnType<typeof createStore>): ConditionalUpdateStateInput {
  return store.conditionalUpdateState.mock.calls[0][0] as ConditionalUpdateStateInput;
}

describe('terminal state', () => {
  it('records CORE_IDENTITY_CONFLICT as processing_failed', async () => {
    const { ports, store } = createPorts();

    await handleCoreIdentityConflict(ports, conflictInput);

    expect(updateOf(store).mutation.set).toMatchObject({
      status: IdempotencyStatus.processing_failed,
      last_error: ProcessingFailure.CORE_IDENTITY_CONFLICT,
    });
  });

  it('sets retryable=false and recovery_stage=NONE (terminal, unrecoverable)', async () => {
    const { ports, store } = createPorts();

    await handleCoreIdentityConflict(ports, conflictInput);

    expect(updateOf(store).mutation.set).toMatchObject({
      retryable: false,
      recovery_stage: RecoveryStage.NONE,
    });
  });

  it('reports the result as terminal', async () => {
    const { ports } = createPorts();

    const result = await handleCoreIdentityConflict(ports, conflictInput);

    expect(result.terminal).toBe(true);
    expect(result.statusAction.result).toBe(StatusActionResult.APPLIED);
  });

  it('stays fenced on the current execution ARN and attempt', async () => {
    const { ports, store } = createPorts();

    await handleCoreIdentityConflict(ports, conflictInput);

    expect(updateOf(store).guard).toMatchObject({
      status: IdempotencyStatus.running,
      workflow_execution_arn: statusContext.executionArn,
      attempt_count: statusInput.attemptCount,
    });
  });
});

describe('no Fast Path announcement', () => {
  it('never reports a Fast Path push', async () => {
    const { ports } = createPorts();

    const result = await handleCoreIdentityConflict(ports, conflictInput);

    expect(result.fastPathPushed).toBe(false);
  });

  it('has no access to a core writer or fast-path publisher', () => {
    const { ports } = createPorts();

    expect(Object.keys(ports).sort()).toEqual(['publisher', 'securityAlerting', 'statusStore']);
  });
});

describe('CRITICAL_SECURITY_ALERT', () => {
  it('emits a critical alert', async () => {
    const { ports, sink } = createPorts();

    await handleCoreIdentityConflict(ports, conflictInput);

    const alert = sink.lines.find((line) => line.level === 'CRITICAL_SECURITY_ALERT');
    expect(alert).toBeDefined();
    expect(alert?.record.security_event).toBe('core_identity_conflict');
  });

  it('names the diverged identity fields', async () => {
    const { ports, sink } = createPorts();

    await handleCoreIdentityConflict(ports, conflictInput);

    const alert = sink.lines.find((line) => line.level === 'CRITICAL_SECURITY_ALERT');
    expect(alert?.record.mismatched_fields).toEqual(['core_hash']);
    expect(alert?.record.stored_core_hash).toBe('sha256:B');
    expect(alert?.record.computed_core_hash).toBe('sha256:A');
  });

  it('carries the correlation context so the alert is actionable', async () => {
    const { ports, sink } = createPorts();

    await handleCoreIdentityConflict(ports, conflictInput);

    const alert = sink.lines.find((line) => line.level === 'CRITICAL_SECURITY_ALERT');
    expect(alert?.record).toMatchObject({
      trace_id: TRACE,
      decision_id: statusInput.decisionId,
      idempotency_key: statusInput.idempotencyKey,
      attempt_count: statusInput.attemptCount,
      workflow_execution_arn: statusContext.executionArn,
    });
  });

  it('records that the system failed closed', async () => {
    const { ports, sink } = createPorts();

    await handleCoreIdentityConflict(ports, conflictInput);

    const alert = sink.lines.find((line) => line.level === 'CRITICAL_SECURITY_ALERT');
    expect(alert?.record).toMatchObject({ fail_closed: true, retryable: false });
  });
});

describe('processing.failed notification', () => {
  it('pushes processing.failed with retryable=false', async () => {
    const { ports, publish } = createPorts();

    const result = await handleCoreIdentityConflict(ports, conflictInput);

    expect(result.processingFailedPushed).toBe(true);
    const event = publish.mock.calls[0][0] as ProcessingFailedEvent;
    expect(event).toMatchObject({
      type: PROCESSING_FAILED_EVENT,
      decision_id: statusInput.decisionId,
      error_code: ProcessingFailure.CORE_IDENTITY_CONFLICT,
      retryable: false,
      attempt_count: statusInput.attemptCount,
    });
  });

  it('records the state before notifying (order matters)', async () => {
    const { ports, store, publish } = createPorts();

    await handleCoreIdentityConflict(ports, conflictInput);

    expect(store.conditionalUpdateState.mock.invocationCallOrder[0]).toBeLessThan(
      publish.mock.invocationCallOrder[0],
    );
  });

  it('does not un-record the conflict when the push fails', async () => {
    const { ports, store } = createPorts({ publishFails: true });

    const result = await handleCoreIdentityConflict(ports, conflictInput);

    expect(result.terminal).toBe(true);
    expect(result.processingFailedPushed).toBe(false);
    expect(result.publishError).toContain('websocket down');
    // The terminal transition still happened; polling will surface it.
    expect(store.conditionalUpdateState).toHaveBeenCalledTimes(1);
  });

  it('works without a publisher (polling remains the fallback)', async () => {
    const { ports } = createPorts({ withPublisher: false });

    const result = await handleCoreIdentityConflict(ports, conflictInput);

    expect(result.terminal).toBe(true);
    expect(result.processingFailedPushed).toBe(false);
  });
});

describe('fenced execution', () => {
  it('does not alert or notify when the execution has been fenced out', async () => {
    const { ports, sink, publish } = createPorts({
      statusResult: StatusActionResult.FENCED_STALE_EXECUTION,
    });

    const result = await handleCoreIdentityConflict(ports, conflictInput);

    expect(result.statusAction.result).toBe(StatusActionResult.FENCED_STALE_EXECUTION);
    expect(result.fastPathPushed).toBe(false);
    // A newer attempt owns the key and will reach its own conclusion.
    expect(sink.lines.some((line) => line.level === 'CRITICAL_SECURITY_ALERT')).toBe(false);
    expect(publish).not.toHaveBeenCalled();
  });
});

describe('faults', () => {
  it('surfaces a DynamoDB fault rather than losing the conflict', async () => {
    const { ports, store } = createPorts();
    const failure = new IdempotencyRepositoryError('throttled', 'conditionalUpdateState', KEY);
    store.conditionalUpdateState.mockRejectedValue(failure);

    await expect(handleCoreIdentityConflict(ports, conflictInput)).rejects.toBe(failure);
  });
});
