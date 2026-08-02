/**
 * What-if Dialog Tests (§14.5, §16, R16; TASK-141, gap coverage per TASK-135)
 *
 * `whatif_dialog.tsx` had no test file at all before this task. Covers the
 * mount, the does-not-mutate-state disclosure, the confirm-then-submit flow
 * (mirrors the injection panel's gate), the `answered` / `clarification_required`
 * / transport-error branches, and that the dialog never fabricates an ETE when
 * the backend supplied none.
 */

import { describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { WhatIfDialog } from '../../src/whatif/whatif_dialog.js';
import type { ApiClient, ApiResult } from '../../src/api/client.js';

type PostWhatIfResult = ApiResult<{ readonly httpStatus: number; readonly body: unknown }>;

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

function okResult(httpStatus: number, body: unknown): PostWhatIfResult {
  return { ok: true, data: { httpStatus, body } };
}

async function submitQuery(
  client: ApiClient,
  query = '若 BS_MRT_BL17 人數增至 40000',
): Promise<void> {
  render(<WhatIfDialog client={client} />);
  fireEvent.change(screen.getByTestId('whatif-query-input'), { target: { value: query } });
  fireEvent.click(screen.getByTestId('whatif-submit-button'));
}

async function confirmSubmission(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByTestId('whatif-confirm-button'));
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('WhatIfDialog — mount and disclosure', () => {
  it('mounts with the input form and the state-mutation notice', () => {
    render(<WhatIfDialog client={createFakeClient()} />);

    expect(screen.getByTestId('whatif-query-input')).toBeInTheDocument();
    expect(screen.getByTestId('whatif-mutate-state-notice').textContent).toContain(
      'does_not_mutate_state',
    );
  });

  it('disables submit until a non-blank query is entered', () => {
    render(<WhatIfDialog client={createFakeClient()} />);

    expect(screen.getByTestId('whatif-submit-button')).toBeDisabled();

    fireEvent.change(screen.getByTestId('whatif-query-input'), { target: { value: 'x' } });
    expect(screen.getByTestId('whatif-submit-button')).not.toBeDisabled();
  });

  it('keeps submit disabled for a whitespace-only query', () => {
    render(<WhatIfDialog client={createFakeClient()} />);

    fireEvent.change(screen.getByTestId('whatif-query-input'), { target: { value: '   ' } });
    expect(screen.getByTestId('whatif-submit-button')).toBeDisabled();
  });
});

describe('WhatIfDialog — explicit confirmation gate', () => {
  it('moves to confirmation without sending any request', async () => {
    const postWhatIf = vi.fn();
    await submitQuery(createFakeClient({ postWhatIf }));

    expect(screen.getByTestId('whatif-confirm-group')).toBeInTheDocument();
    expect(screen.getByTestId('whatif-confirm-query').textContent).toContain('40000');
    expect(postWhatIf).not.toHaveBeenCalled();
  });

  it('cancel returns to the input form without ever calling postWhatIf', async () => {
    const postWhatIf = vi.fn();
    await submitQuery(createFakeClient({ postWhatIf }));

    fireEvent.click(screen.getByTestId('whatif-cancel-button'));

    expect(postWhatIf).not.toHaveBeenCalled();
    expect(screen.getByTestId('whatif-query-input')).toBeInTheDocument();
    expect(screen.queryByTestId('whatif-confirm-group')).toBeNull();
  });

  it('confirm sends exactly one postWhatIf call with the entered query', async () => {
    const postWhatIf = vi.fn(() =>
      Promise.resolve(
        okResult(200, {
          schema_version: '1.0',
          trace_id: 'tr-1',
          request_id: 'req-1',
          status: 'answered',
          triggered_articles: [],
          applied_formula_articles: [],
          expected_actions: [],
          sop_citations: [],
        }),
      ),
    );
    await submitQuery(createFakeClient({ postWhatIf }), '若 BL17 人數增至 40000');
    await confirmSubmission();

    expect(postWhatIf).toHaveBeenCalledTimes(1);
    expect(postWhatIf).toHaveBeenCalledWith('若 BL17 人數增至 40000');
  });
});

describe('WhatIfDialog — answered outcome', () => {
  it('renders the detailed AI explanation section last, leading with the concise summary then the triggered SOP articles', async () => {
    const postWhatIf = vi.fn(() =>
      Promise.resolve(
        okResult(200, {
          schema_version: '1.0',
          trace_id: 'tr-1',
          request_id: 'req-1',
          status: 'answered',
          triggered_articles: [3],
          applied_formula_articles: [],
          expected_actions: ['啟動接駁分流'],
          sop_citations: [],
          summary_text: '觸發 SOP 第 3 條；首要動作：啟動接駁分流。',
          explanation_text: '這是較長的完整理由與依據。',
        }),
      ),
    );
    await submitQuery(createFakeClient({ postWhatIf }));
    await confirmSubmission();

    const headings = Array.from(
      screen.getByTestId('whatif-answered').querySelectorAll('h4'),
      (heading) => heading.textContent,
    );
    expect(headings.at(-1)).toBe('詳細 AI 解釋');

    // Within the detailed-explanation section, the short summary comes
    // first, then the triggered SOP articles, then the full explanation —
    // compare actual DOM element order, not substring offsets (the summary
    // text itself legitimately contains "第 3 條").
    const summaryEl = screen.getByTestId('whatif-summary');
    const triggeredEl = screen.getByTestId('whatif-triggered-articles');
    const explanationEl = screen.getByTestId('whatif-explanation');
    const summaryPosition = summaryEl.compareDocumentPosition(triggeredEl);
    const triggeredPosition = triggeredEl.compareDocumentPosition(explanationEl);
    // eslint-disable-next-line no-bitwise -- DOM Node.compareDocumentPosition bitmask check
    expect(summaryPosition & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // eslint-disable-next-line no-bitwise -- DOM Node.compareDocumentPosition bitmask check
    expect(triggeredPosition & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    expect(screen.getByTestId('whatif-summary').textContent).toContain('首要動作');
    expect(screen.getByTestId('whatif-explanation').textContent).toContain('完整理由');
  });

  it('renders triggered articles, applied formula articles, and expected actions verbatim', async () => {
    const postWhatIf = vi.fn(() =>
      Promise.resolve(
        okResult(200, {
          schema_version: '1.0',
          trace_id: 'tr-1',
          request_id: 'req-1',
          status: 'answered',
          triggered_articles: [1, 2],
          applied_formula_articles: [7],
          expected_actions: ['啟動接駁分流'],
          sop_citations: [],
        }),
      ),
    );
    await submitQuery(createFakeClient({ postWhatIf }));
    await confirmSubmission();

    expect(screen.getByTestId('whatif-answered')).toBeInTheDocument();
    expect(screen.getByTestId('whatif-triggered-articles').textContent).toContain('第 1 條');
    expect(screen.getByTestId('whatif-triggered-articles').textContent).toContain('第 2 條');
    expect(screen.getByTestId('whatif-applied-articles').textContent).toContain('第 7 條');
    expect(screen.getByTestId('whatif-expected-actions').textContent).toContain('啟動接駁分流');
  });

  it('renders an ETE preview only when the backend supplied one', async () => {
    const postWhatIf = vi.fn(() =>
      Promise.resolve(
        okResult(200, {
          schema_version: '1.0',
          trace_id: 'tr-1',
          request_id: 'req-1',
          status: 'answered',
          triggered_articles: [],
          applied_formula_articles: [],
          expected_actions: [],
          sop_citations: [],
          ete_preview: { ete_minutes: 42 },
        }),
      ),
    );
    await submitQuery(createFakeClient({ postWhatIf }));
    await confirmSubmission();

    expect(screen.getByTestId('whatif-ete-preview').textContent).toContain('42');
  });

  it('never fabricates an ETE preview when the backend omitted it', async () => {
    const postWhatIf = vi.fn(() =>
      Promise.resolve(
        okResult(200, {
          schema_version: '1.0',
          trace_id: 'tr-1',
          request_id: 'req-1',
          status: 'answered',
          triggered_articles: [],
          applied_formula_articles: [],
          expected_actions: [],
          sop_citations: [],
        }),
      ),
    );
    await submitQuery(createFakeClient({ postWhatIf }));
    await confirmSubmission();

    expect(screen.queryByTestId('whatif-ete-preview')).toBeNull();
  });

  it('renders sop_citations and the trace/request identifiers', async () => {
    const postWhatIf = vi.fn(() =>
      Promise.resolve(
        okResult(200, {
          schema_version: '1.0',
          trace_id: 'tr-abc',
          request_id: 'req-xyz',
          status: 'answered',
          triggered_articles: [],
          applied_formula_articles: [],
          expected_actions: [],
          sop_citations: [{ article_no: 3, content: '第 3 條內容' }],
        }),
      ),
    );
    await submitQuery(createFakeClient({ postWhatIf }));
    await confirmSubmission();

    expect(screen.getByTestId('whatif-sop-citations').textContent).toContain('第 3 條內容');
    expect(screen.getByTestId('whatif-trace-id').textContent).toBe('tr-abc');
    expect(screen.getByTestId('whatif-request-id').textContent).toBe('req-xyz');
  });

  it('marks does_not_mutate_state as true in the answered result', async () => {
    const postWhatIf = vi.fn(() =>
      Promise.resolve(
        okResult(200, {
          schema_version: '1.0',
          trace_id: 'tr-1',
          request_id: 'req-1',
          status: 'answered',
          triggered_articles: [],
          applied_formula_articles: [],
          expected_actions: [],
          sop_citations: [],
        }),
      ),
    );
    await submitQuery(createFakeClient({ postWhatIf }));
    await confirmSubmission();

    expect(screen.getByTestId('whatif-no-mutate').textContent).toBe('true');
  });

  it('"啟動新的假設情境" resets the dialog back to the empty form', async () => {
    const postWhatIf = vi.fn(() =>
      Promise.resolve(
        okResult(200, {
          schema_version: '1.0',
          trace_id: 'tr-1',
          request_id: 'req-1',
          status: 'answered',
          triggered_articles: [],
          applied_formula_articles: [],
          expected_actions: [],
          sop_citations: [],
        }),
      ),
    );
    await submitQuery(createFakeClient({ postWhatIf }));
    await confirmSubmission();

    fireEvent.click(screen.getByTestId('whatif-reset-button'));

    expect(screen.getByTestId('whatif-query-input')).toBeInTheDocument();
    expect((screen.getByTestId('whatif-query-input') as HTMLTextAreaElement).value).toBe('');
    expect(screen.queryByTestId('whatif-answered')).toBeNull();
  });
});

describe('WhatIfDialog — clarification_required outcome', () => {
  it('renders the clarification prompt distinctly from an answered result', async () => {
    const postWhatIf = vi.fn(() =>
      Promise.resolve(
        okResult(200, {
          schema_version: '1.0',
          trace_id: 'tr-1',
          request_id: 'req-1',
          status: 'clarification_required',
          clarification_prompt: '請提供事故發生的具體路段名稱。',
          triggered_articles: [],
          applied_formula_articles: [],
          expected_actions: [],
          sop_citations: [],
        }),
      ),
    );
    await submitQuery(createFakeClient({ postWhatIf }));
    await confirmSubmission();

    expect(screen.getByTestId('whatif-clarification')).toBeInTheDocument();
    expect(screen.getByTestId('whatif-clarification-prompt').textContent).toBe(
      '請提供事故發生的具體路段名稱。',
    );
    expect(screen.queryByTestId('whatif-answered')).toBeNull();
  });
});

describe('WhatIfDialog — transport and HTTP failures', () => {
  it('renders a transport error distinctly and offers a reset', async () => {
    const postWhatIf = vi.fn(() =>
      Promise.resolve({
        ok: false,
        error: { code: 'NETWORK_ERROR', message: 'connection reset' },
      } as PostWhatIfResult),
    );
    await submitQuery(createFakeClient({ postWhatIf }));
    await confirmSubmission();

    expect(screen.getByTestId('whatif-error')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('whatif-reset-button'));
    expect(screen.getByTestId('whatif-query-input')).toBeInTheDocument();
  });

  it('renders a non-200 HTTP status as an error rather than a result', async () => {
    const postWhatIf = vi.fn(() => Promise.resolve(okResult(503, { error_code: 'SERVICE_DOWN' })));
    await submitQuery(createFakeClient({ postWhatIf }));
    await confirmSubmission();

    expect(screen.getByTestId('whatif-error')).toBeInTheDocument();
    expect(screen.queryByTestId('whatif-answered')).toBeNull();
    expect(screen.queryByTestId('whatif-clarification')).toBeNull();
  });
});
