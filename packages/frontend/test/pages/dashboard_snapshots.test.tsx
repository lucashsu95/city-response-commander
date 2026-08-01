/**
 * Dashboard Acceptance Snapshots (TASK-135)
 *
 * High-value, stable-state snapshots requested by the TASK-135 acceptance
 * gate. Every snapshot below is preceded by semantic (testid/role/text)
 * assertions — the snapshot is a regression net on top of behavior already
 * proven, never a substitute for it.
 *
 * Determinism:
 * - every timestamp, id, and trace_id below is a fixed literal (no
 *   `Date.now()`, no random ids)
 * - `jsdom`'s default locale/timezone is used consistently across CI and
 *   local runs (no `Intl`/`toLocaleString` calls appear on these paths — the
 *   components under test render backend strings verbatim, per their own
 *   "no client-side formatting" contracts)
 * - components are rendered directly with hand-built controller state; no
 *   `fetch`/`WebSocket` is involved, so there is no network-timing variance
 *
 * Scope note (TASK-134): `packages/frontend` has no responsive-breakpoint CSS
 * and no ja/ko UI toggle (both are TASK-134, `BONUS_OPTIONAL`, not started —
 * confirmed via `.kiro/specs/impl1/tasks.md`, marked `[ ]`, and via
 * `alert_panel.tsx`/`narrative_fallback.ts` doc comments stating "no
 * client-side ja/ko template is produced (TASK-134 scope)"). "Dashboard
 * wide/narrow" below therefore snapshots the same `DashboardShell` markup at
 * two different `container` widths (a CSS-Grid layout that already reflows
 * via its own stylesheet, not a TASK-134 breakpoint), which is the only
 * wide/narrow distinction this codebase currently makes. No responsive or
 * ja/ko feature is added by this file. TASK134_OPTIONAL_NOT_PRESENT.
 */

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DashboardShell } from '../../src/layout/dashboard_shell.js';
import { TimelinePanel } from '../../src/timeline/timeline_panel.js';
import type { TimelinePlaybackState } from '../../src/timeline/use_timeline_playback.js';
import { RoadPanel } from '../../src/roads/road_panel.js';
import type { RoadTrafficState } from '../../src/roads/use_road_traffic.js';
import type { RoadReadModel, RoadSegmentView } from '../../src/roads/road_model.js';
import { CrowdPanel } from '../../src/crowd/crowd_panel.js';
import type { CrowdSnapshotState } from '../../src/crowd/use_crowd_snapshot.js';
import type { CrowdStationRow } from '../../src/crowd/crowd_model.js';
import { AnomalyPopup } from '../../src/alerts/anomaly_popup.js';
import type { AnomalyPresentation } from '../../src/alerts/anomaly_model.js';
import { ExecutionStatusPanel } from '../../src/decision/execution_status.js';
import { AlertPanel } from '../../src/decision/alert_panel.js';
import { decodeInjectionResponse } from '../../src/decision/execution_model.js';
import { executionStatusOf } from '../../src/decision/use_execution_status.js';
import { decisionState, noop, wireCore, wireNarrative } from '../decision/fixtures.js';

// ─── Fixed fixtures (no Date.now, no random ids) ────────────

const FIXED_TIMESTAMP_1 = '2026-05-20 22:00';
const FIXED_TIMESTAMP_2 = '2026-05-20 22:10';
const FIXED_TRACE_ID = 'tr-snapshot-fixed-001';

function timelineReadyState(): TimelinePlaybackState {
  return {
    state: 'ready',
    timestamps: [FIXED_TIMESTAMP_1, FIXED_TIMESTAMP_2],
    currentTimestamp: FIXED_TIMESTAMP_1,
    selectedTimestamp: FIXED_TIMESTAMP_1,
    selectedIndex: 0,
    refreshStatus: 'idle',
    timing: null,
    schemaVersion: '1.0',
    traceId: FIXED_TRACE_ID,
    provisional: true,
    error: null,
  };
}

function roadSegment(overrides: Partial<RoadSegmentView> = {}): RoadSegmentView {
  return {
    segmentId: 'RD_TPE_002',
    roadName: '光復南路',
    saturationScore: 1,
    level: 'A',
    laneStatus: 'Closed',
    observationTimestamp: FIXED_TIMESTAMP_1,
    stalenessMinutes: 0,
    dataStatus: 'ready',
    ...overrides,
  };
}

function roadReadyState(): RoadTrafficState {
  const model: RoadReadModel = {
    schemaVersion: '1.0',
    traceId: FIXED_TRACE_ID,
    segments: [roadSegment()],
    timestamp: FIXED_TIMESTAMP_1,
    provisional: true,
    dataStatus: 'ready',
  };
  return { state: 'ready', model, refreshStatus: 'idle', error: null };
}

function crowdStation(overrides: Partial<CrowdStationRow> = {}): CrowdStationRow {
  return {
    bsId: 'BS_MRT_BL17',
    locationName: '捷運 BL17 站',
    userCount: 31000,
    growthRate: 0.42,
    roamingPctValue: 0.45,
    roamingPctDisplay: '45%',
    flags: ['SOP3_MRT_SHUTTLE'],
    inMultilingualScope: true,
    observationTimestamp: FIXED_TIMESTAMP_1,
    exactMatch: false,
    stalenessMinutes: 5,
    stale: false,
    dataStatus: 'ready',
    ...overrides,
  };
}

function crowdReadyState(overrides: Partial<CrowdSnapshotState> = {}): CrowdSnapshotState {
  return {
    state: 'ready',
    stations: [crowdStation()],
    multilingual: {
      triggered: true,
      multilingualRequired: true,
      triggeringStationIds: ['BS_MRT_BL17'],
      dataStatus: 'ready',
      scopeMode: 'current_snapshot_all_available_stations',
      stationsInScope: ['BS_MRT_BL17'],
    },
    policy: {
      classification: 'PROVISIONAL_TEAM_POLICY',
      status: 'AWAITING_HOST_REPLY',
      isOfficial: false,
      guidanceId: 'HG-001',
      multilingualScopeMode: 'current_snapshot_all_available_stations',
    },
    decisionCutoffTimestamp: FIXED_TIMESTAMP_2,
    stopReason: null,
    provisional: true,
    schemaVersion: '1.0',
    traceId: FIXED_TRACE_ID,
    refreshStatus: 'idle',
    error: null,
    ...overrides,
  };
}

function noopFn(): void {
  // intentionally empty
}

// ─── 1/2. Dashboard wide / narrow layout ────────────────────

describe('Dashboard wide/narrow layout snapshots', () => {
  function renderPopulatedDashboard(): ReturnType<typeof render> {
    return render(
      <DashboardShell
        connectionMode="websocket"
        timelineContent={
          <TimelinePanel
            playback={timelineReadyState()}
            onRetry={noopFn}
            onSelect={noopFn}
            onPrevious={noopFn}
            onNext={noopFn}
          />
        }
        roadsContent={<RoadPanel traffic={roadReadyState()} onRetry={noopFn} />}
        crowdContent={<CrowdPanel snapshot={crowdReadyState()} onRetry={noopFn} />}
      />,
    );
  }

  it('renders the populated dashboard with all four regions mounted (semantic check)', () => {
    renderPopulatedDashboard();

    // Semantic assertions before any snapshot: the real content is present,
    // not a placeholder.
    expect(screen.getByText('城市交通應變 AI 指揮台')).toBeInTheDocument();
    expect(document.querySelector('.timeline-panel__current-value')?.textContent).toBe(
      FIXED_TIMESTAMP_1,
    );
    expect(document.querySelector('[data-segment-id="RD_TPE_002"]')).not.toBeNull();
    expect(document.querySelector('[data-station-id="BS_MRT_BL17"]')).not.toBeNull();
    expect(screen.getByText('即時連線（WebSocket）')).toBeInTheDocument();
  });

  it('matches the wide-layout snapshot (container width 1440px)', () => {
    const view = renderPopulatedDashboard();
    document.documentElement.style.width = '1440px';

    expect(view.container.innerHTML).toMatchSnapshot();
  });

  it('matches the narrow-layout snapshot (container width 375px)', () => {
    const view = renderPopulatedDashboard();
    document.documentElement.style.width = '375px';

    expect(view.container.innerHTML).toMatchSnapshot('dashboard-narrow-layout');
  });
});

// ─── 3. Stale / degraded state ───────────────────────────────

describe('Dashboard stale/degraded state snapshot', () => {
  it('renders the degraded status bar with stale and polling indicators (semantic check)', () => {
    render(
      <DashboardShell
        connectionMode="polling"
        pollingErrorMessage="GET /roads 逾時"
        pollingUpdateCount={3}
        selectedSnapshot={null}
      />,
    );

    expect(screen.getByText('即時連線降級為輪詢')).toBeInTheDocument();
    expect(screen.getByText(/輪詢更新失敗：GET \/roads 逾時/)).toBeInTheDocument();
  });

  it('matches the stale/degraded snapshot', () => {
    const view = render(
      <DashboardShell
        connectionMode="polling"
        pollingErrorMessage="GET /roads 逾時"
        pollingUpdateCount={3}
        roadsContent={
          <RoadPanel
            traffic={{
              ...roadReadyState(),
              refreshStatus: 'idle',
              error: { code: 'REQUEST_FAILED', message: '輪詢逾時' },
            }}
            onRetry={noopFn}
          />
        }
      />,
    );

    expect(view.container.innerHTML).toMatchSnapshot('dashboard-stale-degraded');
  });
});

// ─── 4. Anomaly popup ─────────────────────────────────────────

describe('Anomaly popup snapshot', () => {
  function fixedAnomaly(): AnomalyPresentation {
    return {
      identity: `RD_TPE_0007@${FIXED_TIMESTAMP_2}`,
      source: 'realtime',
      category: 'ROAD_SATURATION',
      entityId: 'RD_TPE_0007',
      summary: '中山北路南下車道已達癱瘓等級，請立即啟動替代動線。',
      observedAt: FIXED_TIMESTAMP_2,
      stale: null,
      provisional: true,
      dataStatus: null,
      serverSignals: ['ROAD_SATURATION'],
      thresholdLabel: 'SOP-1 A 級',
      valueLabel: '0.97',
    };
  }

  it('renders the open alertdialog with the backend summary (semantic check)', () => {
    render(<AnomalyPopup anomaly={fixedAnomaly()} isOpen onDismiss={noopFn} />);

    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByTestId('anomaly-popup-description').textContent).toBe(
      '中山北路南下車道已達癱瘓等級，請立即啟動替代動線。',
    );
    expect(screen.getByTestId('anomaly-popup-observed-at').textContent).toBe(FIXED_TIMESTAMP_2);
  });

  it('matches the anomaly popup snapshot', () => {
    const view = render(<AnomalyPopup anomaly={fixedAnomaly()} isOpen onDismiss={noopFn} />);

    expect(view.container.innerHTML).toMatchSnapshot('anomaly-popup-open');
  });
});

// ─── 5. Injection terminal CORE_IDENTITY_CONFLICT ────────────

describe('Injection terminal CORE_IDENTITY_CONFLICT snapshot', () => {
  const TERMINAL_CONFLICT_WIRE = {
    execution: {
      status: 'processing_failed',
      last_error: 'CORE_IDENTITY_CONFLICT',
      retryable: false,
      attempt_count: 1,
    },
    data_status: 'insufficient_data',
    core: null,
    narratives: [],
    missing_narrative_types: ['REPORT', 'PUBLIC_ALERT', 'EXPLANATION'],
    publish: null,
  };

  function renderTerminalConflictPanel(): ReturnType<typeof render> {
    const state = decisionState({ state: 'insufficient_data', core: null }, TERMINAL_CONFLICT_WIRE);
    const injection = decodeInjectionResponse(409, {
      decision_id: 'DEC_TPE_2026_ACC_001_fixed',
      status: 'processing_failed',
      error_code: 'CORE_IDENTITY_CONFLICT',
      retryable: false,
      trace_id: FIXED_TRACE_ID,
    });
    return render(
      <ExecutionStatusPanel
        decision={state}
        execution={executionStatusOf({ execution: state.execution, injection })}
        onRetry={noop}
      />,
    );
  }

  it('renders the terminal conflict with no retry control (semantic check)', () => {
    renderTerminalConflictPanel();

    const conflict = screen.getByTestId('injection-terminal-conflict');
    expect(conflict).toHaveTextContent('409 Conflict');
    expect(conflict).toHaveTextContent('CORE_IDENTITY_CONFLICT');
    expect(conflict).toHaveTextContent('終端、非可復原');
    expect(screen.getByTestId('injection-http-status')).toHaveTextContent('409');
    expect(screen.queryByTestId('injection-retry-button')).toBeNull();
    expect(screen.queryByTestId('injection-retry-guidance')).toBeNull();
  });

  it('matches the injection terminal conflict snapshot', () => {
    const view = renderTerminalConflictPanel();

    expect(view.container.innerHTML).toMatchSnapshot('injection-terminal-core-identity-conflict');
  });
});

// ─── 6. Publish confirmation (currently-real state) ──────────

describe('Publish confirmation state snapshot', () => {
  /**
   * `manual_confirmation_required` is surfaced on `core.ete` (see
   * `execution_status.test.tsx`'s "manual confirmation" describe block) and on
   * `SelectedSnapshot` (§16.4, `dashboard_shell.tsx`'s
   * `resolveOperationalStatus`). The publish *action* confirmation
   * (`alert_panel.tsx`'s two-step `確認發布`) is the state that is currently
   * real and wired end-to-end in this codebase (`alert_panel.test.tsx`
   * "publish confirmation (R11.6)"), so this snapshot captures that flow at
   * its `draft` publish state — the state that actually exists on the wire
   * fixture, rather than fabricating a fictitious publish record shape.
   */
  function draftPublishWire() {
    return {
      publish: {
        decision_id: 'dec-acc001',
        publish_state: 'draft',
        channels: ['CMS', 'SMS'],
        audit_trail: [
          {
            actor: 'commander-1',
            action: 'create_draft',
            from_state: null,
            to_state: 'draft',
            at: FIXED_TIMESTAMP_2,
          },
        ],
        version: 1,
        updated_at: FIXED_TIMESTAMP_2,
      },
      core: wireCore(),
      narratives: [
        wireNarrative('REPORT', { type: 'REPORT', report_text: '交控中心建議書內文（AI 生成）' }),
        wireNarrative('PUBLIC_ALERT', {
          type: 'PUBLIC_ALERT',
          public_alert_text: { zh: '光復南路封閉，請改道 RD_TPE_004。', en: 'Road closed. Detour via RD_TPE_004.' },
        }),
        wireNarrative('EXPLANATION', { type: 'EXPLANATION', explanation_text: '判定為 A 級並排除低容量候選。' }),
      ],
    };
  }

  it('renders the draft publish state and audit trail (semantic check)', () => {
    render(
      <AlertPanel
        decision={decisionState({}, draftPublishWire())}
        onRetry={noop}
        onConfirmPublish={noop}
      />,
    );

    expect(screen.getByTestId('publish-state').textContent).toBe('draft');
    expect(screen.getByText(/create_draft/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '發布民眾簡訊…' })).toBeInTheDocument();
  });

  it('matches the publish-confirmation (draft) snapshot', () => {
    const view = render(
      <AlertPanel
        decision={decisionState({}, draftPublishWire())}
        onRetry={noop}
        onConfirmPublish={noop}
      />,
    );

    expect(view.container.innerHTML).toMatchSnapshot('publish-confirmation-draft-state');
  });
});
