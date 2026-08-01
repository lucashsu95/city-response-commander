/**
 * ETE panel tests (TASK-131, state matrix per TASK-135).
 *
 * Covers every UX state (idle / loading / error / insufficient_data /
 * not-applicable / partial / ready / provisional / degraded refresh / malformed
 * block), the R12.8 rule that no ETE number may appear without a common exact
 * snapshot, the §9 rule that displayed operands are backend values rather than
 * recomputed ones, and the HG-001 provenance disclosure.
 */

import { describe, expect, it, vi } from 'vitest';
import { render, fireEvent, screen } from '@testing-library/react';
import { EtePanel } from '../../src/decision/ete_panel.js';
import { eteViewOf } from '../../src/decision/use_ete_view.js';
import { evidenceViewOf } from '../../src/decision/use_evidence_view.js';
import type { DecisionReadModelState } from '../../src/decision/use_decision_read_model.js';
import { decisionState, noop, wireCore, wireEte, wireEvidence } from './fixtures.js';

/** Renders the panel exactly as the dashboard page wires it. */
function renderPanel(
  state: DecisionReadModelState,
  onRetry: () => void = noop,
): ReturnType<typeof render> {
  const evidence = evidenceViewOf(state.core);
  return render(
    <EtePanel
      decision={state}
      ete={eteViewOf(state.core)}
      roleEvidence={evidence.kind === 'ok' ? evidence.evidence.affectedSetConstruction : null}
      onRetry={onRetry}
    />,
  );
}

const INSUFFICIENT_WIRE = {
  core: wireCore({
    ete: wireEte({
      calculation_status: 'insufficient_common_snapshot',
      ete_minutes: null,
      ete_lower_bound_minutes: 60,
      congestion_penalty: null,
      avg_saturation: null,
      manual_confirmation_required: true,
      lower_bound_only: true,
      snapshot_provenance: {
        selection_status: 'insufficient_common_snapshot',
        event_timestamp: '2026-05-20 22:10',
        common_snapshot_timestamp: null,
        readings: [],
      },
    }),
  }),
};

describe('EtePanel — UX state matrix', () => {
  it('renders an explicit no-decision state when idle', () => {
    renderPanel(decisionState({ state: 'idle', core: null }));

    expect(screen.getByText(/尚未有決策可顯示 ETE/)).toBeInTheDocument();
    expect(screen.queryByTestId('ete-value')).toBeNull();
  });

  it('renders the loading state', () => {
    renderPanel(decisionState({ state: 'loading' }));

    expect(screen.getByText('載入 ETE 計算依據中')).toBeInTheDocument();
  });

  it('renders the error state with a working retry control', () => {
    const onRetry = vi.fn();
    renderPanel(
      decisionState({
        state: 'error',
        core: null,
        error: { code: 'REQUEST_FAILED', message: '連線中斷' },
      }),
      onRetry,
    );

    expect(screen.getByText('ETE 讀取失敗：連線中斷')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重試' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders insufficient_data as a STOP with no ETE content', () => {
    renderPanel(
      decisionState(
        { state: 'insufficient_data' },
        {
          data_status: 'insufficient_data',
          core: null,
          narratives: [],
          missing_narrative_types: ['REPORT', 'PUBLIC_ALERT', 'EXPLANATION'],
        },
      ),
    );

    expect(screen.getByText(/尚無已提交的決策核心/)).toBeInTheDocument();
    expect(screen.queryByTestId('ete-value')).toBeNull();
  });

  it('renders a core without an ete block as not applicable, never as zero', () => {
    renderPanel(decisionState({}, { core: wireCore({ ete: null }) }));

    expect(screen.getByText(/未帶 core.ete/)).toBeInTheDocument();
    expect(screen.queryByTestId('ete-value')).toBeNull();
    expect(screen.queryByTestId('ete-formula-substitution')).toBeNull();
  });

  it('renders the full basis in the partial state', () => {
    renderPanel(decisionState({ state: 'partial' }));

    expect(screen.getByTestId('ete-value')).toHaveTextContent('78.6');
    expect(screen.getByTestId('ete-formula-substitution')).toBeInTheDocument();
  });

  it('shows a refreshing notice over existing content', () => {
    renderPanel(decisionState({ refreshStatus: 'refreshing' }));

    expect(screen.getByText('背景更新中…')).toBeInTheDocument();
    expect(screen.getByTestId('ete-value')).toHaveTextContent('78.6');
  });

  it('shows a degraded/stale notice when a background refresh failed', () => {
    renderPanel(
      decisionState({ error: { code: 'REQUEST_FAILED', message: '逾時' }, refreshStatus: 'idle' }),
    );

    expect(screen.getByText(/資料可能過時/)).toBeInTheDocument();
    expect(screen.getByTestId('ete-value')).toHaveTextContent('78.6');
  });

  it('labels the ETE as provisional-policy dependent', () => {
    renderPanel(decisionState({}));

    expect(screen.getByText(/ETE 依賴暫定政策/)).toBeInTheDocument();
  });

  it('reports a malformed ete block instead of a blank basis', () => {
    renderPanel(
      decisionState({}, { core: wireCore({ ete: wireEte({ affected_set: [{ role: 'X' }] }) }) }),
    );

    expect(screen.getByText(/core.ete 無法解析/)).toBeInTheDocument();
    expect(screen.queryByTestId('ete-formula-substitution')).toBeNull();
  });
});

describe('EtePanel — full calculation basis (R12.9, R13.8)', () => {
  it('renders the ETE value and its calculation status', () => {
    renderPanel(decisionState({}));

    expect(screen.getByTestId('ete-value')).toHaveTextContent('78.6');
    expect(screen.getByTestId('ete-calculation-status')).toHaveTextContent('computed');
  });

  it('renders the event timestamp, decision cutoff and common snapshot timestamp', () => {
    renderPanel(
      decisionState({}, { core: wireCore({ decision_cutoff_timestamp: '2026-05-20 22:10' }) }),
    );

    expect(screen.getByTestId('ete-event-timestamp')).toHaveTextContent('2026-05-20 22:10');
    expect(screen.getByTestId('ete-decision-cutoff')).toHaveTextContent('2026-05-20 22:10');
    expect(screen.getByTestId('ete-snapshot-timestamp')).toHaveTextContent('2026-05-20 22:00');
  });

  it('discloses an absent decision cutoff instead of reusing the event time', () => {
    renderPanel(decisionState({}));

    expect(screen.getByTestId('ete-decision-cutoff')).toHaveTextContent('後端未提供');
  });

  it('renders each affected road with its role and role source', () => {
    renderPanel(
      decisionState(
        {},
        {
          core: wireCore({
            ete: wireEte({
              affected_set: [
                { segment_id: 'RD_TPE_002', role: 'INCIDENT' },
                { segment_id: 'RD_TPE_004', role: 'PRIMARY' },
                { segment_id: 'RD_TPE_005', role: 'SECONDARY' },
              ],
            }),
          }),
        },
      ),
    );

    expect(screen.getByTestId('ete-role-RD_TPE_002')).toHaveTextContent('INCIDENT');
    expect(screen.getByTestId('ete-role-RD_TPE_004')).toHaveTextContent('PRIMARY');
    expect(screen.getByTestId('ete-role-RD_TPE_005')).toHaveTextContent('SECONDARY');
    expect(screen.getAllByText('core.ete.affected_set')).toHaveLength(3);
  });

  it('takes the roles from the evidence block when the ETE block has none', () => {
    renderPanel(
      decisionState(
        {},
        {
          core: wireCore({
            evidence: wireEvidence({
              affected_set_construction: [
                {
                  segment_id: 'RD_TPE_002',
                  role: 'INCIDENT',
                  included: true,
                  reason: 'incident road',
                },
              ],
            }),
          }),
        },
      ),
    );

    expect(screen.getByTestId('ete-role-RD_TPE_002')).toHaveTextContent('INCIDENT');
    expect(screen.getByText('core.evidence.affected_set_construction')).toBeInTheDocument();
    // The other two roads have no role in either block: disclosed, not guessed.
    expect(screen.getByTestId('ete-role-RD_TPE_004')).toHaveTextContent('尚無資料');
    expect(screen.getByText(/語意順序不作為角色證據/)).toBeInTheDocument();
  });

  it('renders every per-road Saturation_Score with its observation timestamp', () => {
    renderPanel(decisionState({}));

    expect(screen.getByTestId('ete-saturation-RD_TPE_002')).toHaveTextContent('1');
    expect(screen.getByTestId('ete-saturation-RD_TPE_004')).toHaveTextContent('0.78');
    expect(screen.getByTestId('ete-saturation-RD_TPE_005')).toHaveTextContent('0.65');
    expect(screen.getAllByText('2026-05-20 22:00').length).toBeGreaterThanOrEqual(3);
  });

  it('renders the substituted art.7 formulas with the backend operands', () => {
    renderPanel(
      decisionState(
        {},
        { core: wireCore({ ete: wireEte({ saturation_sum: 2.43, road_count: 3 }) }) },
      ),
    );

    expect(screen.getByTestId('ete-substitution-average')).toHaveTextContent('2.43 / 3 = 0.81');
    expect(screen.getByTestId('ete-substitution-penalty')).toHaveTextContent(
      'max(0, (0.81 - 0.5) * 60) = 18.6',
    );
    expect(screen.getByTestId('ete-substitution-ete')).toHaveTextContent('60 + 18.6 = 78.6');
  });

  it('discloses the missing sum and count instead of deriving them', () => {
    renderPanel(decisionState({}));

    expect(screen.getByTestId('ete-sum')).toHaveTextContent('尚無資料');
    expect(screen.getByTestId('ete-road-count')).toHaveTextContent('尚無資料');
    expect(screen.getByText(/前端不得以各路段讀值自行加總或相除/)).toBeInTheDocument();
    expect(screen.getByText(/不得以 affected_set 長度代算/)).toBeInTheDocument();
  });
});

describe('EtePanel — deterministic truth only (§9)', () => {
  it("displays the backend's avg_saturation even when the readings would average differently", () => {
    // Readings 1.00 / 0.78 / 0.65 average to 0.81, but the payload says 0.42.
    // Recomputing here would silently overrule the authoritative value.
    renderPanel(decisionState({}, { core: wireCore({ ete: wireEte({ avg_saturation: 0.42 }) }) }));

    expect(screen.getByTestId('ete-average')).toHaveTextContent('0.42');
    expect(screen.getByTestId('ete-average').textContent).not.toContain('0.81');
    expect(screen.getByTestId('ete-substitution-penalty')).toHaveTextContent(
      'max(0, (0.42 - 0.5) * 60)',
    );
    expect(screen.queryByText('0.81')).toBeNull();
  });

  it('displays a penalty and ETE that do not follow from the formula, unchanged', () => {
    renderPanel(
      decisionState(
        {},
        { core: wireCore({ ete: wireEte({ congestion_penalty: 5, ete_minutes: 12 }) }) },
      ),
    );

    expect(screen.getByTestId('ete-penalty')).toHaveTextContent('5');
    expect(screen.getByTestId('ete-value')).toHaveTextContent('12');
    // 60 + 5 = 65 is never rendered: the panel does not add the operands.
    expect(screen.getByTestId('ete-substitution-ete')).toHaveTextContent('60 + 5 = 12');
    expect(screen.queryByText('65')).toBeNull();
  });
});

describe('EtePanel — INSUFFICIENT_COMMON_SNAPSHOT (R12.8, R13.9)', () => {
  it('renders no ETE number anywhere', () => {
    const { container } = renderPanel(decisionState({}, INSUFFICIENT_WIRE));

    const value = screen.getByTestId('ete-value');
    expect(value).toHaveTextContent(/未計算（無共同 exact 快照/);
    expect(value.textContent).not.toMatch(/\d/);
    expect(screen.queryByTestId('ete-formula-substitution')).toBeNull();
    expect(screen.getByTestId('ete-average')).toHaveTextContent('尚無資料');
    expect(screen.getByTestId('ete-penalty')).toHaveTextContent('尚無資料');
    // No stale computed value survives anywhere in the panel.
    expect(container.textContent ?? '').not.toContain('78.6');
    expect(container.textContent ?? '').not.toContain('18.6');
  });

  it('renders the lower bound explicitly as a lower bound, not as the ETE', () => {
    renderPanel(decisionState({}, INSUFFICIENT_WIRE));

    expect(screen.getByTestId('ete-lower-bound')).toHaveTextContent('60');
    expect(screen.getByText(/已知下限（分鐘，等於 base_clearance，非 ETE）/)).toBeInTheDocument();
    expect(screen.getByTestId('ete-lower-bound-note')).toHaveTextContent(/不得.*當作 ETE 使用/);
    expect(screen.getByTestId('ete-value').textContent).not.toContain('60');
  });

  it('renders manual_confirmation_required and the missing common snapshot', () => {
    renderPanel(decisionState({}, INSUFFICIENT_WIRE));

    expect(screen.getByTestId('ete-manual-confirmation')).toHaveTextContent('是');
    expect(screen.getByText(/需人工確認：ETE 未完整計算/)).toBeInTheDocument();
    expect(screen.getByTestId('ete-snapshot-timestamp')).toHaveTextContent('無共同 exact 快照');
    expect(screen.getByTestId('ete-calculation-status')).toHaveTextContent(
      'insufficient_common_snapshot',
    );
    expect(screen.getByText(/禁止 partial-set average/)).toBeInTheDocument();
  });

  it('renders an explicit not-supplied state for the per-road inputs', () => {
    renderPanel(decisionState({}, INSUFFICIENT_WIRE));

    expect(screen.getByText('後端提供了空的 Saturation_Score 輸入清單')).toBeInTheDocument();
  });
});

describe('EtePanel — HG-001 provenance', () => {
  it('classifies the selected policy without claiming an official unique answer', () => {
    renderPanel(decisionState({}));

    const classes = screen.getByTestId('ete-policy-classes');
    expect(classes).toHaveTextContent('ORGANIZER_GUIDED_TEAM_POLICY');
    expect(classes).toHaveTextContent('NON_UNIQUE');
    expect(classes).toHaveTextContent('CONFIGURABLE');
    expect(classes).toHaveTextContent('DETERMINISTIC_AND_REPRODUCIBLE');

    const disclaimer = screen.getByTestId('ete-not-official-answer');
    expect(disclaimer).toHaveTextContent(/主辦方.*未.*指定唯一 ETE 演算法/);
    expect(disclaimer).toHaveTextContent(/任何 ETE 結果/);
    expect(disclaimer).toHaveTextContent(/不是.*官方指定之唯一標準答案/);
  });

  it('discloses the HG-001 authority record and the backend guidance id', () => {
    renderPanel(decisionState({}));

    expect(screen.getByText('ORGANIZER_WRITTEN_GUIDANCE')).toBeInTheDocument();
    expect(screen.getByText('authority_class')).toBeInTheDocument();
    expect(screen.getByText('official_sop_amendment')).toBeInTheDocument();
    expect(screen.getByText('指引依據 guidance_id（core.policy）')).toBeInTheDocument();
    expect(screen.getAllByText('HG-001').length).toBeGreaterThanOrEqual(2);
  });

  it('falls back to core.policy for the modes the ete block omits', () => {
    renderPanel(decisionState({}));

    expect(screen.getByTestId('ete-policy-mode')).toHaveTextContent(
      'INCIDENT_PRIMARY_AND_SELECTED_SECONDARY',
    );
  });

  it('reports official_unique_rule as not supplied when the wire omits it', () => {
    renderPanel(decisionState({}));

    expect(screen.getByText('是否官方唯一規則 official_unique_rule')).toBeInTheDocument();
    expect(screen.getAllByText('後端未提供（前端不得代算）').length).toBeGreaterThanOrEqual(1);
  });
});
