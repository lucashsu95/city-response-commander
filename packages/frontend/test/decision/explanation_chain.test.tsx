/**
 * Explanation chain panel tests (TASK-129, state matrix per TASK-135).
 *
 * Covers every UX state, the grading reasoning with data points, the non-empty
 * exclusion reason guarantee, the `triggered ∪ applied_formula` citation set
 * (art.1/2/7 with source locations), the optional §10.10 HG-001 blocks, the
 * §21.3 template fallback, and the rule that the panel never re-derives a level.
 */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { ExplanationChain } from '../../src/decision/explanation_chain.js';
import { evidenceViewOf } from '../../src/decision/use_evidence_view.js';
import type { EvidenceViewResult } from '../../src/decision/use_evidence_view.js';
import type { DecisionReadModelState } from '../../src/decision/use_decision_read_model.js';
import {
  coreView,
  decisionState,
  noop,
  wireCore,
  wireEvidence,
  wireNarrative,
} from './fixtures.js';

function evidenceOf(overrides: Record<string, unknown> = {}): EvidenceViewResult {
  return evidenceViewOf(coreView({ evidence: wireEvidence(overrides) }));
}

function stateWithEvidence(
  overrides: Partial<DecisionReadModelState> = {},
  evidenceOverrides: Record<string, unknown> = {},
  coreOverrides: Record<string, unknown> = {},
): { readonly decision: DecisionReadModelState; readonly evidence: EvidenceViewResult } {
  const core = wireCore({ ...coreOverrides, evidence: wireEvidence(evidenceOverrides) });
  const decision = decisionState(overrides, { core });
  return { decision, evidence: evidenceViewOf(decision.core) };
}

const EXPLANATION_PENDING_WIRE = {
  data_status: 'partial',
  narratives: [wireNarrative('REPORT', { type: 'REPORT', report_text: '建議書內文' })],
  missing_narrative_types: ['PUBLIC_ALERT', 'EXPLANATION'],
};

describe('ExplanationChain — UX state matrix', () => {
  it('renders an explicit no-decision state when idle', () => {
    render(
      <ExplanationChain
        decision={decisionState({ state: 'idle', core: null })}
        evidence={{ kind: 'absent' }}
        onRetry={noop}
      />,
    );

    expect(screen.getByText(/尚未有決策可顯示推理過程/)).toBeInTheDocument();
  });

  it('renders the loading state', () => {
    render(
      <ExplanationChain
        decision={decisionState({ state: 'loading' })}
        evidence={{ kind: 'absent' }}
        onRetry={noop}
      />,
    );

    expect(screen.getByText('載入決策推理鏈中')).toBeInTheDocument();
  });

  it('renders the error state with a working retry control', () => {
    const onRetry = vi.fn();
    render(
      <ExplanationChain
        decision={decisionState({
          state: 'error',
          core: null,
          error: { code: 'REQUEST_FAILED', message: '連線中斷' },
        })}
        evidence={{ kind: 'absent' }}
        onRetry={onRetry}
      />,
    );

    expect(screen.getByText('推理鏈讀取失敗：連線中斷')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重試' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders insufficient_data as a STOP with no reasoning', () => {
    render(
      <ExplanationChain
        decision={decisionState(
          { state: 'insufficient_data' },
          {
            data_status: 'insufficient_data',
            core: null,
            narratives: [],
            missing_narrative_types: ['REPORT', 'PUBLIC_ALERT', 'EXPLANATION'],
          },
        )}
        evidence={{ kind: 'absent' }}
        onRetry={noop}
      />,
    );

    expect(screen.getByText(/無可揭露之推理過程/)).toBeInTheDocument();
    expect(screen.queryByText('分級判定推理')).toBeNull();
  });

  it('layers a background refresh failure over existing content', () => {
    const { decision, evidence } = stateWithEvidence({
      error: { code: 'REQUEST_FAILED', message: '暫時失敗' },
    });
    render(<ExplanationChain decision={decision} evidence={evidence} onRetry={noop} />);

    expect(screen.getByText(/背景更新失敗：暫時失敗/)).toBeInTheDocument();
    expect(screen.getByText('資料佐證')).toBeInTheDocument();
  });

  it('shows the provisional badge from the backend flag', () => {
    const { decision, evidence } = stateWithEvidence();
    render(<ExplanationChain decision={decision} evidence={evidence} onRetry={noop} />);

    expect(screen.getByText(/本推理鏈含暫定政策/)).toBeInTheDocument();
  });

  it('reports a malformed mandatory evidence block as a contract error', () => {
    const decision = decisionState({}, { core: wireCore({ evidence: null }) });
    render(
      <ExplanationChain
        decision={decision}
        evidence={evidenceViewOf(decision.core)}
        onRetry={noop}
      />,
    );

    expect(screen.getByText(/core.evidence 無法解析/)).toBeInTheDocument();
    expect(screen.queryByText('分級判定推理')).toBeNull();
  });
});

describe('ExplanationChain — grading reasoning (R15.1)', () => {
  it('renders value, threshold and conclusion together', () => {
    const { decision, evidence } = stateWithEvidence();
    render(<ExplanationChain decision={decision} evidence={evidence} onRetry={noop} />);

    expect(screen.getByTestId('reasoning-value-RD_TPE_002').textContent).toBe('1');
    expect(screen.getByText('>= 0.95')).toBeInTheDocument();
    expect(screen.getByTestId('reasoning-conclusion-RD_TPE_002').textContent).toBe('A');
  });

  it('never re-derives a level from the value', () => {
    // 0.97 would be A under SOP-1; the backend says B, so B must be shown.
    const { decision, evidence } = stateWithEvidence(
      {},
      {
        classification_reasoning: [
          { segment_id: 'RD_TPE_002', value: 0.97, threshold: '>= 0.95', conclusion: 'B' },
        ],
      },
    );
    render(<ExplanationChain decision={decision} evidence={evidence} onRetry={noop} />);

    expect(screen.getByTestId('reasoning-value-RD_TPE_002').textContent).toBe('0.97');
    expect(screen.getByTestId('reasoning-conclusion-RD_TPE_002').textContent).toBe('B');
  });

  it('shows an empty state instead of inventing reasoning', () => {
    const { decision, evidence } = stateWithEvidence({}, { classification_reasoning: [] });
    render(<ExplanationChain decision={decision} evidence={evidence} onRetry={noop} />);

    expect(screen.getByText('後端未提供分級判定推理')).toBeInTheDocument();
  });

  it('renders the supporting data points with their source and timestamp', () => {
    const { decision, evidence } = stateWithEvidence();
    render(<ExplanationChain decision={decision} evidence={evidence} onRetry={noop} />);

    expect(screen.getByText('city_traffic_flow.csv')).toBeInTheDocument();
    expect(screen.getByText('Saturation_Score')).toBeInTheDocument();
    expect(screen.getAllByText('2026-05-20 22:00').length).toBeGreaterThan(0);
  });
});

describe('ExplanationChain — exclusion reasons (R15.2 / R13.3)', () => {
  it('renders every excluded route with its reason', () => {
    const { decision, evidence } = stateWithEvidence();
    render(<ExplanationChain decision={decision} evidence={evidence} onRetry={noop} />);

    const excluded = document.querySelector('[data-excluded-segment="RD_TPE_008"]');
    expect(excluded?.textContent).toContain('capacity_vph 600 < 1000');
    expect(document.querySelector('[data-excluded-segment="RD_TPE_006"]')?.textContent).toContain(
      '非直接相交',
    );
  });

  it('surfaces a missing exclusion reason as a data-contract error', () => {
    const { decision, evidence } = stateWithEvidence(
      {},
      {
        excluded_routes: [{ segment_id: 'RD_TPE_008', reason: '' }],
      },
    );
    render(<ExplanationChain decision={decision} evidence={evidence} onRetry={noop} />);

    expect(screen.getByText(/缺少非空排除理由：RD_TPE_008/)).toBeInTheDocument();
    expect(screen.getByText(/違反 R13.3 非空理由保證/)).toBeInTheDocument();
  });

  it('states plainly when nothing was excluded', () => {
    const { decision, evidence } = stateWithEvidence({}, { excluded_routes: [] });
    render(<ExplanationChain decision={decision} evidence={evidence} onRetry={noop} />);

    expect(screen.getByText('本決策未排除任何替代道路')).toBeInTheDocument();
  });
});

describe('ExplanationChain — SOP citations (R15.3, §14.2)', () => {
  it('renders art.1/2/7 with their source locations and why each is cited', () => {
    const { decision, evidence } = stateWithEvidence();
    render(<ExplanationChain decision={decision} evidence={evidence} onRetry={noop} />);

    expect(document.querySelector('[data-article-no="1"]')?.textContent).toContain('觸發');
    expect(document.querySelector('[data-article-no="2"]')?.textContent).toContain('觸發');
    const article7 = document.querySelector('[data-article-no="7"]');
    expect(article7?.textContent).toContain('套用公式');
    expect(article7?.textContent).not.toContain('觸發');
    expect(
      screen.getByText('來源位置：s3://sop/emergency_traffic_sop.txt#article-7'),
    ).toBeInTheDocument();
  });

  it('reports an article in the citation set with no citation', () => {
    const { decision, evidence } = stateWithEvidence(
      {},
      {
        sop_citations: [
          {
            article_no: 1,
            source_location: 's3://sop#article-1',
            content: '第 1 條',
            score: 0.9,
          },
        ],
      },
    );
    render(<ExplanationChain decision={decision} evidence={evidence} onRetry={noop} />);

    expect(screen.getByText(/缺少引用段落之條款：第 2、7 條/)).toBeInTheDocument();
  });

  it('reports a citation outside the citation set', () => {
    const { decision, evidence } = stateWithEvidence(
      {},
      {
        sop_citations: [
          ...(wireEvidence()['sop_citations'] as unknown[]),
          { article_no: 4, source_location: 's3://sop#article-4', content: '第 4 條' },
        ],
      },
    );
    render(<ExplanationChain decision={decision} evidence={evidence} onRetry={noop} />);

    expect(screen.getByText(/超出引用集合之條款：第 4 條/)).toBeInTheDocument();
  });

  it('never infers an article from a threshold', () => {
    const { decision, evidence } = stateWithEvidence(
      {},
      { sop_citations: [] },
      { triggered_articles: [], applied_formula_articles: [] },
    );
    render(<ExplanationChain decision={decision} evidence={evidence} onRetry={noop} />);

    expect(screen.getByText(/未提供任何觸發或套用公式條款/)).toBeInTheDocument();
    expect(document.querySelector('[data-article-no]')).toBeNull();
  });
});

describe('ExplanationChain — §10.10 HG-001 blocks', () => {
  it('discloses each block the live contract does not supply', () => {
    const { decision, evidence } = stateWithEvidence();
    render(<ExplanationChain decision={decision} evidence={evidence} onRetry={noop} />);

    expect(screen.getByText(/未提供 evidence.observation_selection/)).toBeInTheDocument();
    expect(screen.getByText(/未提供 evidence.affected_set_construction/)).toBeInTheDocument();
    expect(screen.getByText(/未提供 evidence.formula_substitution/)).toBeInTheDocument();
    expect(screen.getByText(/未提供 evidence.policy_provenance/)).toBeInTheDocument();
  });

  it('renders the blocks verbatim when supplied', () => {
    const { decision, evidence } = stateWithEvidence(
      {},
      {
        observation_selection: [
          {
            entity_id: 'RD_TPE_002',
            cutoff: '2026-05-20 22:10',
            observation_timestamp: '2026-05-20 22:00',
            staleness: 10,
            exact_match: false,
            mode: 'GLOBAL_AS_OF_EVENT_CUTOFF_LATEST_PRIOR_PER_ENTITY',
          },
        ],
        affected_set_construction: [
          { segment_id: 'RD_TPE_002', role: 'INCIDENT', included: true, reason: '事故路段' },
        ],
        formula_substitution: {
          sum: 2.43,
          count: 3,
          average: 0.81,
          base: 60,
          penalty: 18.6,
          ETE: 78.6,
        },
        policy_provenance: {
          policy_mode: 'INCIDENT_PRIMARY_AND_SELECTED_SECONDARY',
          guidance_id: 'HG-001',
          configurable: true,
        },
      },
    );
    render(<ExplanationChain decision={decision} evidence={evidence} onRetry={noop} />);

    expect(
      screen.getAllByText('GLOBAL_AS_OF_EVENT_CUTOFF_LATEST_PRIOR_PER_ENTITY').length,
    ).toBeGreaterThan(0);
    expect(document.querySelector('[data-affected-segment="RD_TPE_002"]')?.textContent).toContain(
      'INCIDENT',
    );
    expect(screen.getByText('2.43')).toBeInTheDocument();
    expect(screen.getByText('18.6')).toBeInTheDocument();
    expect(screen.getAllByText('HG-001').length).toBeGreaterThan(0);
  });

  it('always discloses the policy modes from core.policy', () => {
    const { decision, evidence } = stateWithEvidence();
    render(<ExplanationChain decision={decision} evidence={evidence} onRetry={noop} />);

    expect(screen.getByText('INCIDENT_PRIMARY_AND_SELECTED_SECONDARY')).toBeInTheDocument();
    expect(screen.getByText('incident_anchor_from_location_text')).toBeInTheDocument();
  });
});

describe('ExplanationChain — §21.3 template fallback', () => {
  it('renders the committed AI explanation when it exists', () => {
    const { decision, evidence } = stateWithEvidence();
    render(<ExplanationChain decision={decision} evidence={evidence} onRetry={noop} />);

    expect(screen.getByTestId('explanation-narrative').textContent).toBe(
      '判定為 A 級並排除低容量候選。',
    );
    expect(screen.queryByText('系統模板')).toBeNull();
  });

  it('falls back to the labelled deterministic template when EXPLANATION is pending', () => {
    const decision = decisionState({ state: 'partial' }, EXPLANATION_PENDING_WIRE);
    render(
      <ExplanationChain
        decision={decision}
        evidence={evidenceViewOf(decision.core)}
        onRetry={noop}
      />,
    );

    expect(screen.getByText('系統模板')).toBeInTheDocument();
    const template = screen.getByTestId('explanation-narrative-template');
    expect(template.textContent).toContain('依 SOP 第 1、2 條判定');
    expect(template.textContent).toContain('RD_TPE_002 飽和度 1（門檻 >= 0.95）→ A');
    expect(template.textContent).toContain('引用條款第 1、2、7 條');
    expect(screen.getByText(/缺少：PUBLIC_ALERT、EXPLANATION/)).toBeInTheDocument();
  });

  it('never leaves the explanation slot blank', () => {
    const decision = decisionState({ state: 'partial' }, EXPLANATION_PENDING_WIRE);
    render(
      <ExplanationChain
        decision={decision}
        evidence={evidenceViewOf(decision.core)}
        onRetry={noop}
      />,
    );

    expect(
      screen.getByTestId('explanation-narrative-template').textContent?.length ?? 0,
    ).toBeGreaterThan(0);
  });

  it('states that the AI text may not alter any deterministic value', () => {
    const { decision, evidence } = stateWithEvidence();
    render(<ExplanationChain decision={decision} evidence={evidence} onRetry={noop} />);

    expect(screen.getByText(/不得改寫任何數值或布林真值/)).toBeInTheDocument();
  });
});
