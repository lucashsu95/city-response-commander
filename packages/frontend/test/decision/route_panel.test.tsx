/**
 * Evacuation route panel tests (TASK-130, state matrix per TASK-135).
 *
 * Covers every UX state (idle / loading / error / insufficient_data / partial /
 * ready / provisional / degraded background refresh / malformed block), the
 * R13.3 exclusion-reason guarantee, the §11.5 unresolved-anchor rule, and the
 * §9 rule that the panel never re-ranks routes or re-derives the §11.7
 * congestion disposition.
 */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { RoutePanel } from '../../src/decision/route_panel.js';
import { routeViewOf } from '../../src/decision/use_route_view.js';
import type { DecisionReadModelState } from '../../src/decision/use_decision_read_model.js';
import {
  decisionState,
  noop,
  wireCore,
  wireIncidentAnchor,
  wireRouteCandidate,
} from './fixtures.js';

/** Renders the panel with routes decoded from the same state, as the page does. */
function renderPanel(
  state: DecisionReadModelState,
  onRetry: () => void = noop,
): ReturnType<typeof render> {
  return render(<RoutePanel decision={state} routes={routeViewOf(state.core)} onRetry={onRetry} />);
}

const ACC_001_ROUTES = {
  core: wireCore({
    incident_anchor: wireIncidentAnchor(),
    excluded_candidates: [
      wireRouteCandidate(),
      wireRouteCandidate({
        segment_id: 'RD_TPE_006',
        capacity_vph: 1800,
        passes_capacity: true,
        is_direct_intersection: false,
        saturation_at_snapshot: 0.41,
        exclusion_reason: '不在 RD_TPE_002 的 intersections（非直接相交）',
      }),
    ],
  }),
};

describe('RoutePanel — UX state matrix', () => {
  it('renders an explicit no-decision state when idle', () => {
    renderPanel(decisionState({ state: 'idle', core: null }));

    expect(screen.getByText(/尚未有決策可顯示疏散路徑/)).toBeInTheDocument();
    expect(screen.queryByTestId('route-primary')).toBeNull();
  });

  it('renders the loading state', () => {
    renderPanel(decisionState({ state: 'loading' }));

    expect(screen.getByText('載入疏散路徑決策中')).toBeInTheDocument();
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

    expect(screen.getByText('疏散路徑讀取失敗：連線中斷')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '重試' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders insufficient_data as a STOP with no route content', () => {
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
    expect(screen.queryByTestId('route-primary')).toBeNull();
    expect(screen.queryByTestId('route-excluded-table')).toBeNull();
  });

  it('renders the deterministic route decision in the partial state', () => {
    renderPanel(decisionState({ state: 'partial' }, ACC_001_ROUTES));

    expect(screen.getByTestId('route-primary')).toHaveTextContent('RD_TPE_004');
    expect(screen.getByTestId('route-secondary')).toHaveTextContent('RD_TPE_005');
  });

  it('shows a refreshing notice over existing content', () => {
    renderPanel(decisionState({ refreshStatus: 'refreshing' }, ACC_001_ROUTES));

    expect(screen.getByText('背景更新中…')).toBeInTheDocument();
    expect(screen.getByTestId('route-primary')).toHaveTextContent('RD_TPE_004');
  });

  it('shows a degraded/stale notice when a background refresh failed, keeping content', () => {
    renderPanel(
      decisionState(
        { error: { code: 'REQUEST_FAILED', message: '逾時' }, refreshStatus: 'idle' },
        ACC_001_ROUTES,
      ),
    );

    expect(screen.getByText(/資料可能過時/)).toBeInTheDocument();
    expect(screen.getByTestId('route-primary')).toHaveTextContent('RD_TPE_004');
  });

  it('labels provisional route facts', () => {
    renderPanel(decisionState({}, ACC_001_ROUTES));

    expect(screen.getByText(/路徑事實依賴暫定政策/)).toBeInTheDocument();
  });

  it('reports a malformed route block instead of an empty candidate list', () => {
    renderPanel(
      decisionState({}, { core: wireCore({ incident_anchor: { anchor_index: 'first' } }) }),
    );

    expect(screen.getByText(/core 路徑區塊無法解析/)).toBeInTheDocument();
    expect(screen.queryByTestId('route-excluded-table')).toBeNull();
  });
});

describe('RoutePanel — exclusion reasons (R13.3)', () => {
  it('renders every excluded candidate with its non-empty reason', () => {
    renderPanel(decisionState({}, ACC_001_ROUTES));

    expect(screen.getByTestId('route-exclusion-reason-RD_TPE_008')).toHaveTextContent(
      'capacity_vph 600 < 1000',
    );
    expect(screen.getByTestId('route-exclusion-reason-RD_TPE_006')).toHaveTextContent(
      '不在 RD_TPE_002 的 intersections（非直接相交）',
    );
    expect(screen.queryByText(/資料合約異常/)).toBeNull();
  });

  it('surfaces a blank reason as a contract breach rather than hiding the row', () => {
    renderPanel(
      decisionState(
        {},
        {
          core: wireCore({
            excluded_candidates: [wireRouteCandidate({ exclusion_reason: '' })],
          }),
        },
      ),
    );

    expect(screen.getByTestId('route-exclusion-reason-RD_TPE_008')).toHaveTextContent(/違反 R13.3/);
    expect(screen.getByText(/缺少非空 exclusion_reason：RD_TPE_008/)).toBeInTheDocument();
  });

  it('renders an explicit empty state when nothing was excluded', () => {
    renderPanel(decisionState({}, { core: wireCore({ excluded_candidates: [] }) }));

    expect(screen.getByText('後端未提供任何被排除之候選路段')).toBeInTheDocument();
  });
});

describe('RoutePanel — deterministic truth only (§9)', () => {
  it('does not promote an excluded candidate that has a lower saturation than the primary', () => {
    // RD_TPE_006 is the least saturated segment on screen, yet the backend
    // excluded it for failing the direct-intersection condition. Re-ranking by
    // saturation would be a client-side decision.
    renderPanel(
      decisionState(
        {},
        {
          core: wireCore({
            primary_evacuation: 'RD_TPE_004',
            incident_anchor: wireIncidentAnchor(),
            excluded_candidates: [
              wireRouteCandidate({
                segment_id: 'RD_TPE_006',
                capacity_vph: 2000,
                passes_capacity: true,
                is_direct_intersection: false,
                saturation_at_snapshot: 0.02,
                exclusion_reason: '非直接相交',
              }),
            ],
          }),
        },
      ),
    );

    expect(screen.getByTestId('route-primary')).toHaveTextContent('RD_TPE_004');
    expect(screen.getByTestId('route-saturation-RD_TPE_006')).toHaveTextContent('0.02');
    expect(screen.getByTestId('route-exclusion-reason-RD_TPE_006')).toHaveTextContent('非直接相交');
  });

  it('keeps excluded candidates in wire order', () => {
    renderPanel(
      decisionState(
        {},
        {
          core: wireCore({
            excluded_candidates: [
              wireRouteCandidate({ segment_id: 'RD_TPE_008', saturation_at_snapshot: 0.91 }),
              wireRouteCandidate({ segment_id: 'RD_TPE_006', saturation_at_snapshot: 0.12 }),
            ],
          }),
        },
      ),
    );

    const rendered = screen
      .getAllByRole('row')
      .map((row) => row.getAttribute('data-excluded-candidate'))
      .filter((value): value is string => value !== null);
    expect(rendered).toEqual(['RD_TPE_008', 'RD_TPE_006']);
  });

  it('discloses the congestion disposition as not supplied instead of inferring it', () => {
    // A congested primary is the ACC_001 shape once RD_TPE_004 crosses 0.85,
    // but the live core carries no disposition fields — so nothing is claimed.
    renderPanel(
      decisionState(
        {},
        {
          core: wireCore({
            excluded_candidates: [wireRouteCandidate({ saturation_at_snapshot: 0.97 })],
          }),
        },
      ),
    );

    expect(screen.getByText(/前端不得以 Saturation ≥ 0.85 自行判定/)).toBeInTheDocument();
    expect(screen.queryByTestId('route-long-green')).toBeNull();
    expect(screen.queryByTestId('route-public-transit')).toBeNull();
  });

  it('renders the maintain + long-green + public-transit disposition as backend truth', () => {
    renderPanel(
      decisionState(
        {},
        {
          core: wireCore({
            incident_anchor: wireIncidentAnchor(),
            primary_congested: true,
            long_green_timing_for_primary: true,
            public_transit_recommended: true,
            congestion_note: '主疏散路段已壅塞，建議併行大眾運輸',
          }),
        },
      ),
    );

    expect(screen.getByTestId('route-primary-congested')).toHaveTextContent('是');
    expect(screen.getByTestId('route-maintain-primary')).toHaveTextContent('維持（壅塞不改道');
    expect(screen.getByTestId('route-long-green')).toHaveTextContent('是');
    expect(screen.getByTestId('route-public-transit')).toHaveTextContent('是');
    expect(screen.getByText('主疏散路段已壅塞，建議併行大眾運輸')).toBeInTheDocument();
    // The primary is still the selected route: congestion never discards it.
    expect(screen.getByTestId('route-primary')).toHaveTextContent('RD_TPE_004');
  });
});

describe('RoutePanel — unresolved anchor (§11.5, P30)', () => {
  const UNRESOLVED = {
    core: wireCore({
      primary_evacuation: null,
      secondary_evacuation: [],
      incident_anchor: wireIncidentAnchor({
        manual_confirmation_required: true,
        anchor_intersection: null,
        anchor_index: null,
        position_relative_to_intersection: null,
        resolution_confidence: 'low',
        unranked_direct_intersections: ['RD_TPE_004', 'RD_TPE_005'],
      }),
      excluded_candidates: [],
    }),
  };

  it('shows manual confirmation and no primary evacuation', () => {
    renderPanel(decisionState({}, UNRESOLVED));

    expect(screen.getByTestId('route-anchor-manual-confirmation')).toHaveTextContent('是');
    expect(screen.getByText(/依 §11.5 不選定主疏散/)).toBeInTheDocument();
    expect(screen.getByTestId('route-primary')).toHaveTextContent('未選定');
    expect(screen.getByTestId('route-primary').textContent).not.toMatch(/RD_TPE_/);
  });

  it('lists the unranked direct intersections without implying an order', () => {
    renderPanel(decisionState({}, UNRESOLVED));

    const items = screen
      .getByTestId('route-unranked-list')
      .querySelectorAll('[data-unranked-segment]');
    expect([...items].map((item) => item.getAttribute('data-unranked-segment'))).toEqual([
      'RD_TPE_004',
      'RD_TPE_005',
    ]);
    expect(screen.getByText(/呈現順序不代表優先序/)).toBeInTheDocument();
  });

  it('flags a payload that reports an unresolved anchor together with a primary', () => {
    renderPanel(
      decisionState(
        {},
        {
          core: wireCore({
            primary_evacuation: 'RD_TPE_004',
            incident_anchor: wireIncidentAnchor({ manual_confirmation_required: true }),
          }),
        },
      ),
    );

    expect(screen.getByText(/§11.5 規定二者互斥/)).toBeInTheDocument();
  });

  it('discloses an absent anchor block instead of inferring a direction', () => {
    renderPanel(decisionState({}, { core: wireCore({ incident_anchor: null }) }));

    expect(screen.getByText(/後端未提供 core.incident_anchor/)).toBeInTheDocument();
  });

  it('renders the backend no-candidate note when no primary qualified', () => {
    renderPanel(
      decisionState(
        {},
        {
          core: wireCore({
            primary_evacuation: null,
            incident_anchor: wireIncidentAnchor(),
            no_candidate_note: '查無合規替代路段',
          }),
        },
      ),
    );

    expect(screen.getByTestId('route-no-candidate-note')).toHaveTextContent('查無合規替代路段');
  });
});
