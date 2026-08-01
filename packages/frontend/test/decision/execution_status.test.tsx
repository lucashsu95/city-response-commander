/**
 * Execution status panel tests (TASK-133, state matrix per TASK-135).
 *
 * Covers every UX state (idle / loading / error / insufficient_data / ready /
 * partial / refreshing / stale-degraded), the five `IdempotencyTable` statuses,
 * and the two rules that must hold structurally:
 *
 * - a `409 CORE_IDENTITY_CONFLICT` renders **no** retry control, is not phrased
 *   as a generic error, and shows `409` rather than `500`
 * - a `503 WORKFLOW_START_FAILED` **does** offer a retry path
 *
 * Validates: Requirements REQ-003, REQ-004 (R5); design §10.11c FIX 1, §12, §13.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { ExecutionStatusPanel } from '../../src/decision/execution_status.js';
import {
  decodeInjectionResponse,
  decodeProcessingFailed,
} from '../../src/decision/execution_model.js';
import type { InjectionOutcome } from '../../src/decision/execution_model.js';
import type { ProcessingFailedView } from '../../src/decision/execution_model.js';
import { executionStatusOf } from '../../src/decision/use_execution_status.js';
import type { DecisionReadModelState } from '../../src/decision/use_decision_read_model.js';
import { decisionState, noop, wireDecision } from './fixtures.js';

interface RenderOptions {
  readonly injection?: InjectionOutcome | null;
  readonly failureEvent?: ProcessingFailedView | null;
  readonly onRetry?: () => void;
  readonly onRetryInjection?: () => void;
}

function renderPanel(
  state: DecisionReadModelState,
  options: RenderOptions = {},
): ReturnType<typeof render> {
  return render(
    <ExecutionStatusPanel
      decision={state}
      execution={executionStatusOf({
        execution: state.execution,
        lastFailureEvent: options.failureEvent ?? null,
        injection: options.injection ?? null,
      })}
      onRetry={options.onRetry ?? noop}
      onRetryInjection={options.onRetryInjection}
    />,
  );
}

/** A wire `execution` block; `wireDecision` is otherwise reused as-is. */
function withExecution(execution: unknown, extra: Record<string, unknown> = {}) {
  return { execution, ...extra };
}

const TERMINAL_CONFLICT_WIRE = withExecution(
  {
    status: 'processing_failed',
    last_error: 'CORE_IDENTITY_CONFLICT',
    retryable: false,
    attempt_count: 1,
  },
  // A conflict means no core was committed, so the read model legitimately
  // arrives as insufficient_data alongside the failed execution.
  {
    data_status: 'insufficient_data',
    core: null,
    narratives: [],
    missing_narrative_types: ['REPORT', 'PUBLIC_ALERT', 'EXPLANATION'],
    publish: null,
  },
);

describe('ExecutionStatusPanel — UX state matrix', () => {
  it('renders an explicit no-decision state when idle', () => {
    renderPanel(decisionState({ state: 'idle', core: null, execution: null }));

    expect(screen.getByText(/尚未有決策或注入請求/)).toBeInTheDocument();
    expect(screen.queryByTestId('execution-status')).toBeNull();
  });

  it('renders the loading state', () => {
    renderPanel(decisionState({ state: 'loading' }));

    expect(screen.getByText('載入執行狀態中')).toBeInTheDocument();
  });

  it('separates a read failure from a workflow failure and retries the read', () => {
    const onRetry = vi.fn();
    renderPanel(
      decisionState({
        state: 'error',
        core: null,
        execution: null,
        error: { code: 'REQUEST_FAILED', message: '連線中斷' },
      }),
      { onRetry },
    );

    expect(screen.getByText(/並非工作流本身失敗/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重試' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('still renders the execution projection under insufficient_data', () => {
    renderPanel(decisionState({ state: 'insufficient_data', core: null }, TERMINAL_CONFLICT_WIRE));

    expect(screen.getByTestId('execution-status')).toHaveTextContent('processing_failed');
    expect(screen.getByTestId('execution-last-error')).toHaveTextContent('CORE_IDENTITY_CONFLICT');
  });

  it('renders the projection in the partial state', () => {
    renderPanel(
      decisionState(
        { state: 'partial' },
        withExecution({
          status: 'running',
          last_error: null,
          retryable: false,
          attempt_count: 1,
        }),
      ),
    );

    expect(screen.getByTestId('execution-status-label')).toHaveTextContent('執行中（running）');
  });

  it('shows a refreshing notice over existing content', () => {
    renderPanel(decisionState({ refreshStatus: 'refreshing' }));

    expect(screen.getByText('背景更新中…')).toBeInTheDocument();
    expect(screen.getByTestId('execution-status')).toBeInTheDocument();
  });

  it('shows a stale/degraded notice when a background refresh failed', () => {
    renderPanel(decisionState({ error: { code: 'REQUEST_FAILED', message: '輪詢逾時' } }));

    expect(screen.getByText(/執行狀態可能過時/)).toBeInTheDocument();
    expect(screen.getByTestId('execution-status')).toBeInTheDocument();
  });

  it('reports an absent execution block as not-a-failure', () => {
    renderPanel(decisionState({}, withExecution(null)));

    expect(screen.getByText(/後端未提供 execution 區塊/)).toBeInTheDocument();
    expect(screen.queryByTestId('execution-status')).toBeNull();
  });

  it('shows the read-only nature of the projection and does not conflate it with the core', () => {
    renderPanel(decisionState());

    const note = screen.getByTestId('execution-readonly-note');
    expect(note).toHaveTextContent('唯讀投影');
    expect(note).toHaveTextContent('immutable_after_commit');
    // No control anywhere in the panel could change the projection.
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });
});

describe('ExecutionStatusPanel — execution states (§10.11e)', () => {
  it.each([
    ['starting', '啟動中（starting）'],
    ['running', '執行中（running）'],
    ['completed', '已完成（completed）'],
    ['start_failed', '啟動失敗（start_failed）'],
  ])('renders %s distinctly', (status, label) => {
    renderPanel(
      decisionState(
        {},
        withExecution({
          status,
          last_error: null,
          retryable: false,
          attempt_count: 1,
        }),
      ),
    );

    expect(screen.getByTestId('execution-status-label')).toHaveTextContent(label);
  });

  it('offers a lease-recovery route for a retryable processing_failed', () => {
    renderPanel(
      decisionState(
        {},
        withExecution({
          status: 'processing_failed',
          last_error: 'STALE_RUNNING_EXECUTION',
          retryable: true,
          attempt_count: 2,
        }),
      ),
    );

    expect(screen.getByTestId('execution-recoverable-notice')).toHaveTextContent('租約復原');
    expect(screen.getByTestId('execution-attempt-count')).toHaveTextContent('2');
    expect(screen.queryByTestId('execution-terminal-notice')).toBeNull();
  });

  it('renders a terminal conflict as non-recoverable with no retry affordance', () => {
    renderPanel(decisionState({ state: 'insufficient_data', core: null }, TERMINAL_CONFLICT_WIRE), {
      onRetryInjection: vi.fn(),
    });

    const terminal = screen.getByTestId('execution-terminal-notice');
    expect(terminal).toHaveTextContent('CORE_IDENTITY_CONFLICT');
    expect(terminal).toHaveTextContent('無法復原');
    expect(screen.getByTestId('execution-retryable')).toHaveTextContent('否');
    expect(screen.queryByTestId('injection-retry-button')).toBeNull();
    expect(screen.queryByTestId('injection-retry-guidance')).toBeNull();
    expect(screen.getByText(/必須由人工核對/)).toBeInTheDocument();
  });

  it('fails closed when processing_failed omits retryable', () => {
    renderPanel(
      decisionState(
        {},
        withExecution({
          status: 'processing_failed',
          last_error: 'UNKNOWN_STAGE',
          retryable: null,
          attempt_count: 1,
        }),
      ),
      { onRetryInjection: vi.fn() },
    );

    expect(screen.getByTestId('execution-retryable')).toHaveTextContent('後端未提供');
    expect(screen.getByText(/為 fail-closed/)).toBeInTheDocument();
    expect(screen.queryByTestId('injection-retry-button')).toBeNull();
  });

  it('surfaces an undocumented status as a contract breach, not a known state', () => {
    renderPanel(
      decisionState(
        {},
        withExecution({
          status: 'accepted',
          last_error: null,
          retryable: false,
          attempt_count: 1,
        }),
      ),
    );

    expect(screen.getByTestId('execution-status')).toHaveTextContent('accepted');
    expect(screen.getByText(/不在 §10.11e 的五種狀態/)).toBeInTheDocument();
  });
});

describe('ExecutionStatusPanel — inject HTTP outcomes (§12)', () => {
  it('renders 202 as accepted / in progress, not as a result', () => {
    renderPanel(decisionState(), {
      injection: decodeInjectionResponse(202, { decision_id: 'DEC_1', trace_id: 'tr-1' }),
    });

    expect(screen.getByTestId('injection-outcome')).toHaveAttribute(
      'data-outcome-kind',
      'accepted',
    );
    expect(screen.getByTestId('injection-accepted')).toHaveTextContent('202 Accepted');
    expect(screen.getByTestId('injection-decision-id')).toHaveTextContent('DEC_1');
    expect(screen.getByTestId('injection-trace-id')).toHaveTextContent('tr-1');
    expect(screen.queryByTestId('injection-completed')).toBeNull();
  });

  it('renders 200 completed as its own branch, never merged with 202', () => {
    renderPanel(decisionState(), {
      injection: decodeInjectionResponse(200, { decision_id: 'DEC_1', status: 'completed' }),
    });

    expect(screen.getByTestId('injection-completed')).toHaveTextContent('200 OK');
    expect(screen.queryByTestId('injection-accepted')).toBeNull();
    expect(screen.getByTestId('injection-body-status')).toHaveTextContent('completed');
  });

  it('offers a retry path for 503 WORKFLOW_START_FAILED', () => {
    const onRetryInjection = vi.fn();
    renderPanel(decisionState(), {
      injection: decodeInjectionResponse(503, {
        decision_id: 'DEC_1',
        status: 'start_failed',
        retryable: true,
        trace_id: 'tr-1',
        error_code: 'WORKFLOW_START_FAILED',
      }),
      onRetryInjection,
    });

    expect(screen.getByTestId('injection-start-failed')).toHaveTextContent('WORKFLOW_START_FAILED');
    expect(screen.getByTestId('injection-http-status')).toHaveTextContent('503');
    expect(screen.getByTestId('injection-retry-guidance')).toBeInTheDocument();

    const retry = screen.getByTestId('injection-retry-button');
    fireEvent.click(retry);
    expect(onRetryInjection).toHaveBeenCalledTimes(1);
  });

  it('renders 409 CORE_IDENTITY_CONFLICT as terminal with no retry control', () => {
    renderPanel(decisionState(), {
      injection: decodeInjectionResponse(409, {
        decision_id: 'DEC_1',
        status: 'processing_failed',
        error_code: 'CORE_IDENTITY_CONFLICT',
        retryable: false,
        trace_id: 'tr-1',
      }),
      onRetryInjection: vi.fn(),
    });

    const conflict = screen.getByTestId('injection-terminal-conflict');
    expect(conflict).toHaveTextContent('409 Conflict');
    expect(conflict).toHaveTextContent('CORE_IDENTITY_CONFLICT');
    expect(conflict).toHaveTextContent('終端、非可復原');
    // Not a generic error, and not a 500.
    expect(conflict).toHaveTextContent(/不是.*一般錯誤/);
    expect(screen.getByTestId('injection-http-status')).toHaveTextContent('409');
    expect(screen.queryByTestId('injection-http-status')).not.toHaveTextContent('500');
    expect(screen.queryByTestId('injection-other-error')).toBeNull();
    // The point of the test: no retry affordance of any kind.
    expect(screen.queryByTestId('injection-retry-button')).toBeNull();
    expect(screen.queryByTestId('injection-retry-guidance')).toBeNull();
  });

  it('keeps an authorization failure apart from the four documented outcomes', () => {
    renderPanel(decisionState(), {
      injection: decodeInjectionResponse(403, {
        error_code: 'FORBIDDEN',
        message: '缺少 admin 群組',
        retryable: false,
      }),
    });

    expect(screen.getByTestId('injection-other-error')).toHaveTextContent('FORBIDDEN');
    expect(screen.queryByTestId('injection-terminal-conflict')).toBeNull();
    expect(screen.queryByTestId('injection-start-failed')).toBeNull();
    expect(screen.queryByTestId('injection-retry-button')).toBeNull();
  });

  it('marks absent identifiers as not supplied instead of inventing them', () => {
    renderPanel(decisionState(), { injection: decodeInjectionResponse(202, {}) });

    expect(screen.getByTestId('injection-decision-id')).toHaveTextContent('後端未提供');
    expect(screen.getByTestId('injection-trace-id')).toHaveTextContent('後端未提供');
  });

  it('withholds the retry control when a 503 body omitted retryable', () => {
    renderPanel(decisionState(), {
      injection: decodeInjectionResponse(503, { error_code: 'WORKFLOW_START_FAILED' }),
      onRetryInjection: vi.fn(),
    });

    expect(screen.getByTestId('injection-start-failed')).toBeInTheDocument();
    expect(screen.getByTestId('injection-retryable')).toHaveTextContent('後端未提供');
    expect(screen.queryByTestId('injection-retry-button')).toBeNull();
  });

  it('reports an empty outcome region before any injection is attempted', () => {
    renderPanel(decisionState());

    expect(screen.getByText(/尚未由此介面發出注入請求/)).toBeInTheDocument();
  });
});

describe('ExecutionStatusPanel — processing.failed event (§13)', () => {
  it('renders error_code and retryable from the frame', () => {
    renderPanel(decisionState(), {
      failureEvent: decodeProcessingFailed({
        event_type: 'processing.failed',
        decision_id: 'DEC_1',
        error_code: 'BEDROCK_TIMEOUT',
        retryable: true,
        trace_id: 'tr-9',
        occurred_at: '2026-05-20 22:12',
      }),
    });

    expect(screen.getByTestId('failure-event-error-code')).toHaveTextContent('BEDROCK_TIMEOUT');
    expect(screen.getByTestId('failure-event-retryable')).toHaveTextContent('是');
    expect(screen.getByTestId('failure-event-trace-id')).toHaveTextContent('tr-9');
  });

  it('renders the terminal conflict variant of the event distinctly', () => {
    renderPanel(decisionState({ state: 'insufficient_data', core: null }, TERMINAL_CONFLICT_WIRE), {
      failureEvent: decodeProcessingFailed({
        error_code: 'CORE_IDENTITY_CONFLICT',
        retryable: false,
      }),
      onRetryInjection: vi.fn(),
    });

    const notices = screen.getAllByTestId('execution-terminal-notice');
    expect(notices.length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByTestId('injection-retry-button')).toBeNull();
  });

  it('reports a malformed frame rather than guessing', () => {
    renderPanel(decisionState(), { failureEvent: decodeProcessingFailed(42) });

    expect(screen.getByText(/不是有效的物件結構/)).toBeInTheDocument();
    expect(screen.queryByTestId('failure-event-error-code')).toBeNull();
  });

  it('discloses a retryable disagreement between the event and the projection', () => {
    renderPanel(
      decisionState(
        {},
        withExecution({
          status: 'processing_failed',
          last_error: 'SOME_STOP',
          retryable: false,
          attempt_count: 1,
        }),
      ),
      { failureEvent: decodeProcessingFailed({ error_code: 'SOME_STOP', retryable: true }) },
    );

    expect(screen.getByText(/不一致/)).toBeInTheDocument();
  });

  it('reports an empty event region before any failure arrives', () => {
    renderPanel(decisionState());

    expect(screen.getByText('尚未收到 processing.failed 事件')).toBeInTheDocument();
  });
});

describe('ExecutionStatusPanel — manual confirmation', () => {
  it('surfaces manual_confirmation_required from the decision core', () => {
    const wire = wireDecision();
    expect(wire).toHaveProperty('core');

    renderPanel(
      decisionState(
        {},
        {
          core: {
            ...(wire['core'] as Record<string, unknown>),
            ete: {
              ...((wire['core'] as Record<string, unknown>)['ete'] as Record<string, unknown>),
              manual_confirmation_required: true,
            },
          },
        },
      ),
    );

    expect(screen.getByText(/manual_confirmation_required/)).toBeInTheDocument();
  });
});
