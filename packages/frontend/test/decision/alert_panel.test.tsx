/**
 * Multilingual public-alert panel tests (TASK-132, state matrix per TASK-135).
 *
 * Covers every UX state, the article-6 verdict rendered from backend truth only,
 * the §14.4 language floor applied to that verdict, the §21.3 template fallback
 * per language, the never-fabricate-an-ETE rule for public output, and the
 * publish-confirmation flow.
 */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { AlertPanel } from '../../src/decision/alert_panel.js';
import { decisionState, noop, wireCore, wireEte, wireNarrative } from './fixtures.js';

/** `PUBLIC_ALERT` still pending; REPORT/EXPLANATION committed. */
const ALERT_PENDING_WIRE = {
  data_status: 'partial',
  narratives: [
    wireNarrative('REPORT', { type: 'REPORT', report_text: '建議書內文' }),
    wireNarrative('EXPLANATION', { type: 'EXPLANATION', explanation_text: '解釋' }),
  ],
  missing_narrative_types: ['PUBLIC_ALERT'],
};

function messageFor(language: string): HTMLElement | null {
  return document.querySelector(`[data-language="${language}"]`);
}

describe('AlertPanel — UX state matrix', () => {
  it('renders an explicit no-decision state when idle', () => {
    render(<AlertPanel decision={decisionState({ state: 'idle', core: null })} onRetry={noop} />);

    expect(screen.getByText(/尚未有決策可產出民眾簡訊/)).toBeInTheDocument();
  });

  it('renders the loading state', () => {
    render(<AlertPanel decision={decisionState({ state: 'loading' })} onRetry={noop} />);

    expect(screen.getByText('載入多語民眾簡訊中')).toBeInTheDocument();
  });

  it('renders the error state with a working retry control', () => {
    const onRetry = vi.fn();
    render(
      <AlertPanel
        decision={decisionState({
          state: 'error',
          core: null,
          error: { code: 'REQUEST_FAILED', message: '連線中斷' },
        })}
        onRetry={onRetry}
      />,
    );

    expect(screen.getByText('民眾簡訊讀取失敗：連線中斷')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重試' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('publishes nothing when there is no committed core', () => {
    render(
      <AlertPanel
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

    expect(screen.getByText(/不對外產出任何民眾簡訊/)).toBeInTheDocument();
    expect(document.querySelector('.alert-panel__messages')).toBeNull();
  });

  it('layers a background refresh failure over existing content', () => {
    render(
      <AlertPanel
        decision={decisionState({ error: { code: 'REQUEST_FAILED', message: '暫時失敗' } })}
        onRetry={noop}
      />,
    );

    expect(screen.getByText(/背景更新失敗：暫時失敗/)).toBeInTheDocument();
    expect(messageFor('zh')).not.toBeNull();
  });
});

describe('AlertPanel — article 6 verdict is backend truth (R14.1)', () => {
  it('renders multilingual_required verbatim', () => {
    render(<AlertPanel decision={decisionState()} onRetry={noop} />);

    expect(screen.getByTestId('alert-multilingual-required').textContent).toBe('是');
  });

  it('does not infer a verdict when the backend omitted it', () => {
    render(
      <AlertPanel
        decision={decisionState({}, { core: wireCore({ multilingual_required: null }) })}
        onRetry={noop}
      />,
    );

    expect(screen.getByTestId('alert-multilingual-required').textContent).toBe('尚無資料');
    expect(screen.getByText(/不推定觸發與否/)).toBeInTheDocument();
  });

  it('renders the backend verdict even when the roaming data would suggest otherwise', () => {
    // A client that applied the 30% threshold itself would report "triggered";
    // the backend says false, so the panel must show false and only zh.
    render(
      <AlertPanel
        decision={decisionState(
          {},
          {
            core: wireCore({ multilingual_required: false }),
            narratives: [
              wireNarrative('REPORT', { type: 'REPORT', report_text: '建議書內文' }),
              wireNarrative('EXPLANATION', { type: 'EXPLANATION', explanation_text: '解釋' }),
            ],
            missing_narrative_types: ['PUBLIC_ALERT'],
            data_status: 'partial',
          },
        )}
        onRetry={noop}
      />,
    );

    expect(screen.getByTestId('alert-multilingual-required').textContent).toBe('否');
    expect(messageFor('zh')).not.toBeNull();
    expect(messageFor('en')).toBeNull();
  });
});

describe('AlertPanel — languages and §21.3 fallback', () => {
  it('renders every language the backend supplied, marked as AI text', () => {
    render(<AlertPanel decision={decisionState()} onRetry={noop} />);

    expect(messageFor('zh')?.getAttribute('data-source')).toBe('backend');
    expect(messageFor('en')?.getAttribute('data-source')).toBe('backend');
    expect(messageFor('zh')?.textContent).toContain('光復南路封閉，請改道 RD_TPE_004。');
    expect(screen.queryByText('系統模板')).toBeNull();
  });

  it('renders bonus ja/ko text when the backend supplies it', () => {
    render(
      <AlertPanel
        decision={decisionState(
          {},
          {
            narratives: [
              wireNarrative('REPORT', { type: 'REPORT', report_text: '建議書內文' }),
              wireNarrative('PUBLIC_ALERT', {
                type: 'PUBLIC_ALERT',
                public_alert_text: { zh: '中文', en: 'English', ja: '日本語', ko: '한국어' },
              }),
              wireNarrative('EXPLANATION', { type: 'EXPLANATION', explanation_text: '解釋' }),
            ],
          },
        )}
        onRetry={noop}
      />,
    );

    expect(messageFor('ja')?.textContent).toContain('日本語');
    expect(messageFor('ko')?.textContent).toContain('한국어');
  });

  it('applies the zh+en floor with labelled templates when PUBLIC_ALERT is pending', () => {
    render(
      <AlertPanel
        decision={decisionState({ state: 'partial' }, ALERT_PENDING_WIRE)}
        onRetry={noop}
      />,
    );

    expect(messageFor('zh')?.getAttribute('data-source')).toBe('template');
    expect(messageFor('en')?.getAttribute('data-source')).toBe('template');
    expect(screen.getAllByText('系統模板')).toHaveLength(2);
    expect(messageFor('zh')?.textContent).toContain('建議改道 RD_TPE_004');
    expect(messageFor('en')?.textContent).toContain('Detour via RD_TPE_004');
  });

  it('never produces a client-side ja/ko template', () => {
    render(
      <AlertPanel
        decision={decisionState({ state: 'partial' }, ALERT_PENDING_WIRE)}
        onRetry={noop}
      />,
    );

    expect(messageFor('ja')).toBeNull();
    expect(messageFor('ko')).toBeNull();
  });

  it('prefers backend text and only templates the missing floor language', () => {
    render(
      <AlertPanel
        decision={decisionState(
          { state: 'partial' },
          {
            data_status: 'partial',
            narratives: [
              wireNarrative('PUBLIC_ALERT', {
                type: 'PUBLIC_ALERT',
                public_alert_text: { zh: '後端中文簡訊' },
              }),
            ],
            missing_narrative_types: ['REPORT', 'EXPLANATION'],
          },
        )}
        onRetry={noop}
      />,
    );

    expect(messageFor('zh')?.getAttribute('data-source')).toBe('backend');
    expect(messageFor('zh')?.textContent).toContain('後端中文簡訊');
    expect(messageFor('en')?.getAttribute('data-source')).toBe('template');
  });

  it('never fabricates an ETE in public-facing output', () => {
    render(
      <AlertPanel
        decision={decisionState(
          { state: 'partial' },
          {
            ...ALERT_PENDING_WIRE,
            core: wireCore({
              cms_core_text: 'RD_TPE_002 封閉，請改道 RD_TPE_004',
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

    expect(screen.getByTestId('alert-ete-minutes').textContent).toBe('未計算；僅能揭露已知下限');
    expect(messageFor('zh')?.textContent).toContain('預計至少延誤 60 分鐘');
    expect(document.body.textContent).not.toContain('78.6');
  });

  it('discloses the facts a template had to omit', () => {
    render(
      <AlertPanel
        decision={decisionState(
          { state: 'partial' },
          { ...ALERT_PENDING_WIRE, core: wireCore({ primary_evacuation: null }) },
        )}
        onRetry={noop}
      />,
    );

    expect(messageFor('zh')?.textContent).toContain('primary_evacuation');
    expect(messageFor('zh')?.textContent).toContain('主疏散路徑尚未確定，需人工確認');
  });

  it('never presents contextual affected_road as a route', () => {
    render(
      <AlertPanel
        decision={decisionState(
          { state: 'partial' },
          {
            ...ALERT_PENDING_WIRE,
            core: wireCore({
              primary_evacuation: null,
              event_facts: {
                type: 'Crowd_Surge_Injury',
                location: '捷運站出口',
                affected_segment: 'BS_MRT_BL17',
                affected_road: 'RD_TPE_009',
                status: 'Caution',
                severity: 'High',
                description: '人群擁擠',
                timestamp: '2026-05-20 22:10',
              },
            }),
          },
        )}
        onRetry={noop}
      />,
    );

    expect(messageFor('zh')?.textContent).not.toContain('RD_TPE_009');
  });
});

describe('AlertPanel — publish confirmation (R11.6)', () => {
  it('renders the backend publish state and audit trail', () => {
    render(<AlertPanel decision={decisionState()} onRetry={noop} />);

    expect(screen.getByTestId('publish-state').textContent).toBe('draft');
    expect(screen.getByText(/create_draft/)).toBeInTheDocument();
  });

  it('shows an explicit empty state when no publish record exists', () => {
    render(<AlertPanel decision={decisionState({ publish: null })} onRetry={noop} />);

    expect(screen.getByText(/尚未進入發布流程/)).toBeInTheDocument();
  });

  it('requires an explicit confirmation step before publishing', () => {
    const onConfirmPublish = vi.fn();
    render(
      <AlertPanel decision={decisionState()} onRetry={noop} onConfirmPublish={onConfirmPublish} />,
    );

    fireEvent.click(screen.getByRole('button', { name: '發布民眾簡訊…' }));
    expect(onConfirmPublish).not.toHaveBeenCalled();
    expect(screen.getByText(/確認發布上列民眾簡訊/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '確認發布' }));
    expect(onConfirmPublish).toHaveBeenCalledTimes(1);
  });

  it('cancels without publishing', () => {
    const onConfirmPublish = vi.fn();
    render(
      <AlertPanel decision={decisionState()} onRetry={noop} onConfirmPublish={onConfirmPublish} />,
    );

    fireEvent.click(screen.getByRole('button', { name: '發布民眾簡訊…' }));
    fireEvent.click(screen.getByRole('button', { name: '取消' }));

    expect(onConfirmPublish).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: '發布民眾簡訊…' })).toBeInTheDocument();
  });

  it('states why the control is unavailable when no publish action is wired', () => {
    render(<AlertPanel decision={decisionState()} onRetry={noop} />);

    expect(screen.getByText(/發布動作未接線/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '發布民眾簡訊…' })).toBeNull();
  });
});
