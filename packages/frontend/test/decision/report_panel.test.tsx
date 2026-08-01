/**
 * Command-centre report panel tests (TASK-132, state matrix per TASK-135).
 *
 * Covers every UX state (idle / loading / error / insufficient_data / partial /
 * ready / provisional / background-refresh failure), the P37 separation of
 * `cms_core_text` from `cms_explanation_text`, the §21.3 template fallback, and
 * the rule that the panel never recomputes a level or an ETE.
 */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ReportPanel } from '../../src/decision/report_panel.js';
import { decisionState, noop, wireCore, wireEte, wireNarrative } from './fixtures.js';

const PARTIAL_WIRE = {
  data_status: 'partial',
  narratives: [
    wireNarrative('PUBLIC_ALERT', {
      type: 'PUBLIC_ALERT',
      public_alert_text: { zh: '中文簡訊' },
    }),
  ],
  missing_narrative_types: ['REPORT', 'EXPLANATION'],
};

describe('ReportPanel — UX state matrix', () => {
  it('renders an explicit no-decision state when idle', () => {
    render(<ReportPanel decision={decisionState({ state: 'idle', core: null })} onRetry={noop} />);

    expect(screen.getByText(/尚未有決策可產出建議書/)).toBeInTheDocument();
    expect(screen.queryByText('交控中心建議書')).toBeNull();
  });

  it('renders the loading state', () => {
    render(<ReportPanel decision={decisionState({ state: 'loading' })} onRetry={noop} />);

    expect(screen.getByText('載入交控中心建議書中')).toBeInTheDocument();
  });

  it('renders the error state with a working retry control', () => {
    const onRetry = vi.fn();
    render(
      <ReportPanel
        decision={decisionState({
          state: 'error',
          core: null,
          error: { code: 'REQUEST_FAILED', message: '連線中斷' },
        })}
        onRetry={onRetry}
      />,
    );

    expect(screen.getByText('建議書讀取失敗：連線中斷')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重試' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders insufficient_data as a STOP with no report content', () => {
    render(
      <ReportPanel
        decision={decisionState(
          { state: 'insufficient_data' },
          {
            data_status: 'insufficient_data',
            core: null,
            narratives: [],
            missing_narrative_types: ['REPORT', 'PUBLIC_ALERT', 'EXPLANATION'],
          },
        )}
        onRetry={noop}
      />,
    );

    expect(screen.getByText(/尚無已提交的決策核心/)).toBeInTheDocument();
    expect(screen.queryByText('事件辨識')).toBeNull();
    expect(screen.queryByTestId('report-ete-minutes')).toBeNull();
  });

  it('renders a background refresh indicator over existing content', () => {
    render(
      <ReportPanel decision={decisionState({ refreshStatus: 'refreshing' })} onRetry={noop} />,
    );

    expect(screen.getByText('背景更新中…')).toBeInTheDocument();
    expect(screen.getByText('事件辨識')).toBeInTheDocument();
  });

  it('keeps content and surfaces a failed background refresh', () => {
    render(
      <ReportPanel
        decision={decisionState({ error: { code: 'REQUEST_FAILED', message: '暫時失敗' } })}
        onRetry={noop}
      />,
    );

    expect(screen.getByText(/背景更新失敗：暫時失敗/)).toBeInTheDocument();
    expect(screen.getByText('TPE_2026_ACC_001')).toBeInTheDocument();
  });

  it('shows the provisional-policy badge from the backend flag', () => {
    render(<ReportPanel decision={decisionState()} onRetry={noop} />);

    expect(screen.getByText(/本決策含暫定政策/)).toBeInTheDocument();
  });

  it('discloses a missing provisional flag rather than assuming false', () => {
    render(<ReportPanel decision={decisionState({}, { provisional: null })} onRetry={noop} />);

    expect(screen.getByText('後端未提供 provisional 狀態')).toBeInTheDocument();
  });
});

describe('ReportPanel — deterministic content (R13)', () => {
  it('renders event identification and the article sets verbatim', () => {
    render(<ReportPanel decision={decisionState()} onRetry={noop} />);

    expect(screen.getByText('TPE_2026_ACC_001')).toBeInTheDocument();
    expect(screen.getByText('光復南路與忠孝東路口南側')).toBeInTheDocument();
    expect(screen.getByText('第 1 條、第 2 條')).toBeInTheDocument();
    expect(screen.getByText('第 7 條')).toBeInTheDocument();
    expect(screen.getByText('article2_alternative_route_guidance')).toBeInTheDocument();
  });

  it('renders the backend classification level and never recomputes it', () => {
    // Saturation 0.97 would be A level if the client applied the SOP-1
    // threshold; the backend says B, so the panel must show B.
    render(
      <ReportPanel
        decision={decisionState(
          {},
          {
            core: wireCore({
              classifications: [{ segment_id: 'RD_TPE_002', level: 'B' }],
            }),
          },
        )}
        onRetry={noop}
      />,
    );

    const cell = document.querySelector('[data-segment-id="RD_TPE_002"] td');
    expect(cell?.textContent).toBe('B');
    expect(cell?.getAttribute('data-level')).toBe('B');
  });

  it('renders the primary and secondary evacuation routes', () => {
    render(<ReportPanel decision={decisionState()} onRetry={noop} />);

    expect(screen.getByTestId('report-primary-evacuation').textContent).toBe('RD_TPE_004');
    expect(screen.getByText('RD_TPE_005')).toBeInTheDocument();
  });

  it('shows an unresolved primary route as pending manual confirmation', () => {
    render(
      <ReportPanel
        decision={decisionState({}, { core: wireCore({ primary_evacuation: null }) })}
        onRetry={noop}
      />,
    );

    expect(screen.getByTestId('report-primary-evacuation').textContent).toBe(
      '尚未確定（需人工確認）',
    );
  });

  it('renders the ETE value exactly as supplied', () => {
    render(<ReportPanel decision={decisionState()} onRetry={noop} />);

    expect(screen.getByTestId('report-ete-minutes').textContent).toBe('78.6');
  });

  it('never renders an ETE number when no common snapshot exists', () => {
    render(
      <ReportPanel
        decision={decisionState(
          {},
          {
            core: wireCore({
              cms_core_text: 'RD_TPE_002 封閉，請改道 RD_TPE_004，預計至少延誤 60 分鐘',
              ete: wireEte({
                ete_minutes: null,
                ete_lower_bound_minutes: 60,
                congestion_penalty: null,
                avg_saturation: null,
                calculation_status: 'INSUFFICIENT_COMMON_SNAPSHOT',
                manual_confirmation_required: true,
                lower_bound_only: true,
              }),
            }),
          },
        )}
        onRetry={noop}
      />,
    );

    expect(screen.getByTestId('report-ete-minutes').textContent).toBe('未計算（無共同快照）');
    expect(screen.getByText(/僅呈現下限，不顯示虛構 ETE/)).toBeInTheDocument();
    expect(screen.getByText(/需人工確認/)).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('78.6');
  });

  it('discloses an absent ETE block instead of showing zero', () => {
    render(
      <ReportPanel
        decision={decisionState({}, { core: wireCore({ ete: null }) })}
        onRetry={noop}
      />,
    );

    expect(screen.getByText(/後端未提供 ETE 區塊/)).toBeInTheDocument();
    expect(screen.queryByTestId('report-ete-minutes')).toBeNull();
  });

  it('marks contextual affected_road as display-and-context-only', () => {
    render(<ReportPanel decision={decisionState()} onRetry={noop} />);

    expect(screen.getByText('DISPLAY_AND_CONTEXT_ONLY')).toBeInTheDocument();
    expect(screen.getByText(/不進入 ETE 集合、不觸發第 1\/2 條/)).toBeInTheDocument();
  });

  it('shows the decision cutoff as not supplied rather than reusing occurred_at', () => {
    render(<ReportPanel decision={decisionState()} onRetry={noop} />);

    expect(screen.getByText('後端未提供（前端不得代算）')).toBeInTheDocument();
  });
});

describe('ReportPanel — P37 CMS text separation', () => {
  it('renders the deterministic core text distinctly from the AI explanation', () => {
    render(<ReportPanel decision={decisionState()} onRetry={noop} />);

    const core = screen.getByTestId('cms-core-text');
    const explanation = screen.getByTestId('cms-explanation-text');

    expect(core.textContent).toBe('RD_TPE_002 封閉，請改道 RD_TPE_004，預計延誤 78.6 分鐘');
    expect(explanation.textContent).toBe('AI 補充：建議提前引導車流。');
    expect(core).not.toBe(explanation);
    expect(screen.getAllByText('決定性核心值（LLM 不可改寫）').length).toBeGreaterThan(0);
    expect(screen.getAllByText('AI 生成文字（不得取代核心數值）').length).toBeGreaterThan(0);
  });

  it('never lets AI explanation text occupy the core-text slot', () => {
    render(
      <ReportPanel
        decision={decisionState({}, { core: wireCore({ cms_core_text: null }) })}
        onRetry={noop}
      />,
    );

    expect(screen.getByTestId('cms-core-text').textContent).toBe(
      '後端未提供 cms_core_text；不以任何 AI 文字替代',
    );
    expect(screen.getByTestId('cms-explanation-text').textContent).toBe(
      'AI 補充：建議提前引導車流。',
    );
  });
});

describe('ReportPanel — §21.3 template fallback', () => {
  it('shows the committed AI narrative when it exists', () => {
    render(<ReportPanel decision={decisionState()} onRetry={noop} />);

    expect(screen.getByTestId('report-narrative').textContent).toBe(
      '交控中心建議書內文（AI 生成）',
    );
    expect(screen.queryByTestId('report-narrative-template')).toBeNull();
    expect(screen.queryByText('系統模板')).toBeNull();
  });

  it('falls back to the labelled deterministic template when REPORT is pending', () => {
    render(
      <ReportPanel decision={decisionState({ state: 'partial' }, PARTIAL_WIRE)} onRetry={noop} />,
    );

    expect(screen.getByText('系統模板')).toBeInTheDocument();
    const template = screen.getByTestId('report-narrative-template');
    expect(template.textContent).toContain('事件 TPE_2026_ACC_001');
    expect(template.textContent).toContain('建議改道 RD_TPE_004');
    expect(screen.getByText(/缺少：REPORT、EXPLANATION/)).toBeInTheDocument();
  });

  it('never leaves the narrative slot blank', () => {
    render(
      <ReportPanel decision={decisionState({ state: 'partial' }, PARTIAL_WIRE)} onRetry={noop} />,
    );

    expect(
      screen.getByTestId('report-narrative-template').textContent?.length ?? 0,
    ).toBeGreaterThan(0);
  });

  it('discloses the deterministic facts the template had to omit', () => {
    render(
      <ReportPanel
        decision={decisionState(
          { state: 'partial' },
          { ...PARTIAL_WIRE, core: wireCore({ primary_evacuation: null, ete: null }) },
        )}
        onRetry={noop}
      />,
    );

    const omitted = screen.getByTestId('report-template-omitted');
    expect(omitted.textContent).toContain('primary_evacuation');
    expect(omitted.textContent).toContain('ete.ete_minutes');
  });
});
