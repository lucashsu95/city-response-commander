/**
 * Incident Injection Panel Tests (§12, §16.3, §17, R5; TASK-128, gap coverage
 * per TASK-135)
 *
 * `injection_panel.tsx` had no dedicated test file before this task — only its
 * *rendered outcome* sub-components were covered indirectly through
 * `execution_status.test.tsx`. This file covers what only the panel itself
 * owns: the admin gate on `adminToken`, the event_id form, the mandatory
 * confirm/cancel step before any request is sent, and that a submitted
 * request carries the admin Authorization header built by
 * `auth/admin_session.ts`.
 */

import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { InjectionPanel } from '../../src/inject/injection_panel.js';
import type { ApiClient, ApiResult } from '../../src/api/client.js';

type PostInjectResult = ApiResult<{ readonly httpStatus: number; readonly body: unknown }>;

function createFakeClient(overrides: Partial<ApiClient> = {}): ApiClient {
  return {
    getDecision: vi.fn(),
    getRoads: vi.fn(),
    getCrowd: vi.fn(),
    getTimeline: vi.fn(),
    postInject: vi.fn(),
    postWhatIf: vi.fn(),
    getReadOnlyJson: vi.fn(),
    ...overrides,
  } as unknown as ApiClient;
}

function okResult(httpStatus: number, body: unknown): PostInjectResult {
  return { ok: true, data: { httpStatus, body } };
}

describe('InjectionPanel — admin gate (§17)', () => {
  it('renders a disabled notice and no form when adminToken is null', () => {
    render(<InjectionPanel client={createFakeClient()} adminToken={null} />);

    expect(screen.getByText(/尚未偵測到管理員憑證/)).toBeInTheDocument();
    expect(screen.queryByTestId('injection-event-id-input')).toBeNull();
    expect(screen.queryByRole('form', { name: '事件注入表單' })).toBeNull();
  });

  it('renders a disabled notice for a whitespace-only adminToken (fail closed)', () => {
    render(<InjectionPanel client={createFakeClient()} adminToken="   " />);

    expect(screen.getByText(/尚未偵測到管理員憑證/)).toBeInTheDocument();
    expect(screen.queryByTestId('injection-event-id-input')).toBeNull();
  });

  it('renders the usable form once adminToken is present', () => {
    render(<InjectionPanel client={createFakeClient()} adminToken="valid.jwt.token" />);

    expect(screen.getByTestId('injection-event-id-input')).toBeInTheDocument();
    expect(screen.queryByText(/尚未偵測到管理員憑證/)).toBeNull();
  });
});

describe('InjectionPanel — event_id form', () => {
  it('disables submit until a non-blank event_id is entered', () => {
    render(<InjectionPanel client={createFakeClient()} adminToken="tok" />);

    expect(screen.getByTestId('injection-submit-button')).toBeDisabled();

    fireEvent.change(screen.getByTestId('injection-event-id-input'), {
      target: { value: 'TPE_2026_ACC_001' },
    });
    expect(screen.getByTestId('injection-submit-button')).not.toBeDisabled();
  });

  it('keeps submit disabled for a whitespace-only event_id', () => {
    render(<InjectionPanel client={createFakeClient()} adminToken="tok" />);

    fireEvent.change(screen.getByTestId('injection-event-id-input'), {
      target: { value: '   ' },
    });
    expect(screen.getByTestId('injection-submit-button')).toBeDisabled();
  });

  it('moves to confirmation without sending any request yet', () => {
    const postInject = vi.fn();
    render(
      <InjectionPanel client={createFakeClient({ postInject })} adminToken="tok" />,
    );

    fireEvent.change(screen.getByTestId('injection-event-id-input'), {
      target: { value: 'TPE_2026_ACC_001' },
    });
    fireEvent.click(screen.getByTestId('injection-submit-button'));

    expect(screen.getByTestId('injection-confirm-group')).toBeInTheDocument();
    expect(screen.getByTestId('injection-confirm-question').textContent).toContain(
      'TPE_2026_ACC_001',
    );
    expect(postInject).not.toHaveBeenCalled();
  });
});

describe('InjectionPanel — explicit confirmation gate (§12)', () => {
  function toConfirming(client: ApiClient, adminToken: string | null = 'tok') {
    render(<InjectionPanel client={client} adminToken={adminToken} />);
    fireEvent.change(screen.getByTestId('injection-event-id-input'), {
      target: { value: 'TPE_2026_ACC_001' },
    });
    fireEvent.click(screen.getByTestId('injection-submit-button'));
  }

  it('cancel returns to the form without ever calling postInject', () => {
    const postInject = vi.fn();
    toConfirming(createFakeClient({ postInject }));

    fireEvent.click(screen.getByTestId('injection-cancel-button'));

    expect(postInject).not.toHaveBeenCalled();
    expect(screen.getByTestId('injection-event-id-input')).toBeInTheDocument();
    expect(screen.queryByTestId('injection-confirm-group')).toBeNull();
  });

  it('confirm sends exactly one postInject call with the admin Authorization header', async () => {
    const postInject = vi.fn(() => Promise.resolve(okResult(202, { decision_id: 'DEC_1' })));
    toConfirming(createFakeClient({ postInject }), 'admin.jwt.value');

    await act(async () => {
      fireEvent.click(screen.getByTestId('injection-confirm-button'));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(postInject).toHaveBeenCalledTimes(1);
    expect(postInject).toHaveBeenCalledWith('TPE_2026_ACC_001', {
      authorizationHeader: 'Bearer admin.jwt.value',
    });
  });

  it('fails closed by hiding the confirm control entirely if the admin token becomes unusable between form and confirm', () => {
    const postInject = vi.fn();
    const client = createFakeClient({ postInject });
    const view = render(<InjectionPanel client={client} adminToken="tok" />);

    fireEvent.change(screen.getByTestId('injection-event-id-input'), {
      target: { value: 'TPE_2026_ACC_001' },
    });
    fireEvent.click(screen.getByTestId('injection-submit-button'));
    expect(screen.getByTestId('injection-confirm-group')).toBeInTheDocument();

    // Token revoked while the confirm step is on screen (e.g. session cleared
    // in another tab/component). The whole admin-gated form — including the
    // confirm control — disappears behind the disabled notice; there is no
    // control left that could issue the request.
    view.rerender(<InjectionPanel client={client} adminToken={null} />);

    expect(screen.queryByTestId('injection-confirm-button')).toBeNull();
    expect(screen.queryByTestId('injection-confirm-group')).toBeNull();
    expect(screen.getByText(/尚未偵測到管理員憑證/)).toBeInTheDocument();
    expect(postInject).not.toHaveBeenCalled();
  });
});

describe('InjectionPanel — §12 outcomes rendered end-to-end from the panel', () => {
  async function submitAndConfirm(client: ApiClient): Promise<void> {
    render(<InjectionPanel client={client} adminToken="tok" />);
    fireEvent.change(screen.getByTestId('injection-event-id-input'), {
      target: { value: 'TPE_2026_ACC_001' },
    });
    fireEvent.click(screen.getByTestId('injection-submit-button'));
    await act(async () => {
      fireEvent.click(screen.getByTestId('injection-confirm-button'));
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  it('202 renders the accepted outcome via the reused TASK-133 section', async () => {
    const postInject = vi.fn(() =>
      Promise.resolve(okResult(202, { decision_id: 'DEC_1', trace_id: 'tr-1' })),
    );
    await submitAndConfirm(createFakeClient({ postInject }));

    expect(screen.getByTestId('injection-accepted')).toBeInTheDocument();
    expect(screen.getByTestId('injection-decision-id')).toHaveTextContent('DEC_1');
  });

  it('200 renders the completed outcome, distinct from 202', async () => {
    const postInject = vi.fn(() =>
      Promise.resolve(okResult(200, { decision_id: 'DEC_1', status: 'completed' })),
    );
    await submitAndConfirm(createFakeClient({ postInject }));

    expect(screen.getByTestId('injection-completed')).toBeInTheDocument();
    expect(screen.queryByTestId('injection-accepted')).toBeNull();
  });

  it('503 WORKFLOW_START_FAILED renders with a retry path', async () => {
    const postInject = vi.fn(() =>
      Promise.resolve(
        okResult(503, {
          decision_id: 'DEC_1',
          status: 'start_failed',
          retryable: true,
          error_code: 'WORKFLOW_START_FAILED',
        }),
      ),
    );
    await submitAndConfirm(createFakeClient({ postInject }));

    expect(screen.getByTestId('injection-start-failed')).toBeInTheDocument();
    expect(screen.getByTestId('injection-retry-button')).toBeInTheDocument();
  });

  it('409 CORE_IDENTITY_CONFLICT renders as terminal with no retry affordance', async () => {
    const postInject = vi.fn(() =>
      Promise.resolve(
        okResult(409, {
          decision_id: 'DEC_1',
          status: 'processing_failed',
          error_code: 'CORE_IDENTITY_CONFLICT',
          retryable: false,
        }),
      ),
    );
    await submitAndConfirm(createFakeClient({ postInject }));

    expect(screen.getByTestId('injection-terminal-conflict')).toBeInTheDocument();
    expect(screen.queryByTestId('injection-retry-button')).toBeNull();
    expect(screen.queryByTestId('injection-retry-guidance')).toBeNull();
  });

  it('a 409 retry click re-issues with the same event_id, not a new one', async () => {
    const postInject = vi
      .fn()
      .mockResolvedValueOnce(
        okResult(503, {
          decision_id: 'DEC_1',
          status: 'start_failed',
          retryable: true,
          error_code: 'WORKFLOW_START_FAILED',
        }),
      )
      .mockResolvedValueOnce(okResult(202, { decision_id: 'DEC_1', trace_id: 'tr-2' }));
    const client = createFakeClient({ postInject });
    await submitAndConfirm(client);

    fireEvent.click(screen.getByTestId('injection-retry-button'));
    // Re-issuing goes through the confirm gate again — same event_id shown.
    expect(screen.getByTestId('injection-confirm-question').textContent).toContain(
      'TPE_2026_ACC_001',
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId('injection-confirm-button'));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(postInject).toHaveBeenCalledTimes(2);
    expect(postInject).toHaveBeenNthCalledWith(2, 'TPE_2026_ACC_001', expect.anything());
  });

  it('a network failure renders a transport error distinct from any §12 outcome', async () => {
    const postInject = vi.fn(() =>
      Promise.resolve({
        ok: false,
        error: { code: 'NETWORK_ERROR', message: 'connection reset' },
      } as PostInjectResult),
    );
    await submitAndConfirm(createFakeClient({ postInject }));

    expect(screen.getByTestId('injection-transport-error')).toBeInTheDocument();
    expect(screen.queryByTestId('injection-outcome')).toBeNull();
  });

  it('"注入其他事件" resets the panel back to the empty form', async () => {
    const postInject = vi.fn(() => Promise.resolve(okResult(202, { decision_id: 'DEC_1' })));
    await submitAndConfirm(createFakeClient({ postInject }));

    fireEvent.click(screen.getByTestId('injection-reset-button'));

    expect(screen.getByTestId('injection-event-id-input')).toBeInTheDocument();
    expect((screen.getByTestId('injection-event-id-input') as HTMLInputElement).value).toBe('');
    expect(screen.queryByTestId('injection-outcome')).toBeNull();
  });
});
