/**
 * Dashboard Shell Layout (§8, §16)
 *
 * Main application shell containing four semantic regions:
 * - Timeline
 * - Road traffic
 * - Crowd/base-station
 * - Decision command
 *
 * @module frontend/layout/dashboard_shell
 */

import type { ReactNode } from 'react';
import type { SelectedSnapshot, AffectedRoadContext } from '@city-commander/shared-schemas';
import { EmptyState } from '../components/system/async_state.js';
import { OperationalStatusBar } from '../components/system/operational_status.js';
import { SnapshotProvenance } from '../components/decision/snapshot_provenance.js';
import { AffectedRoadContextView } from '../components/decision/affected_road_context_view.js';
import { createDefaultOperationalStatus } from '../state/app_state.js';
import type { ConnectionMode, OperationalStatus } from '../state/app_state.js';

// ─── Region Components ─────────────────────────────────────

interface TimelineRegionProps {
  /**
   * TASK-124 timeline playback panel. `undefined` (the default) preserves the
   * pre-TASK-124 empty state so a `DashboardShell` rendered without a
   * `timelineContent` prop is unchanged.
   */
  readonly content?: ReactNode;
}

/**
 * Timeline region - displays time-axis data playback (§12 GET /timeline,
 * §16.1). Renders the injected TASK-124 `TimelinePanel` when supplied;
 * otherwise falls back to the pre-TASK-124 empty state.
 */
function TimelineRegion({ content }: TimelineRegionProps): ReactNode {
  return (
    <section
      className="dashboard-region dashboard-region--timeline"
      aria-labelledby="timeline-heading"
    >
      <h2 id="timeline-heading" className="dashboard-region__heading">
        時間軸
      </h2>
      <div className="dashboard-region__content dashboard-region__content--stacked">
        {content ?? <EmptyState message="尚無可顯示的時間軸資料" />}
      </div>
    </section>
  );
}

/**
 * Road traffic region - displays per-segment traffic with A/B levels.
 * Empty state until TASK-125 implementation.
 */
function RoadTrafficRegion(): ReactNode {
  return (
    <section
      className="dashboard-region dashboard-region--roads"
      aria-labelledby="roads-heading"
    >
      <h2 id="roads-heading" className="dashboard-region__heading">
        路段車流
      </h2>
      <div className="dashboard-region__content">
        <EmptyState message="尚無可顯示的路段資料" />
      </div>
    </section>
  );
}

interface CrowdRegionProps {
  /**
   * TASK-126 crowd/signaling panel. `undefined` (the default) preserves the
   * pre-TASK-126 empty state so a `DashboardShell` rendered without a
   * `crowdContent` prop is unchanged.
   */
  readonly content?: ReactNode;
}

/**
 * Crowd/base-station region - displays user counts and roaming data.
 * Renders the injected TASK-126 `CrowdPanel` when supplied; otherwise falls
 * back to the pre-TASK-126 empty state.
 */
function CrowdRegion({ content }: CrowdRegionProps): ReactNode {
  return (
    <section
      className="dashboard-region dashboard-region--crowd"
      aria-labelledby="crowd-heading"
    >
      <h2 id="crowd-heading" className="dashboard-region__heading">
        基地台人流
      </h2>
      <div className="dashboard-region__content dashboard-region__content--stacked">
        {content ?? <EmptyState message="尚無可顯示的基地台資料" />}
      </div>
    </section>
  );
}

interface DecisionRegionProps {
  /** Canonical backend-provided snapshot, or null when not supplied. */
  readonly selectedSnapshot: SelectedSnapshot | null;
  /** Canonical backend-provided affected-road context, or null when not supplied. */
  readonly affectedRoadContext: AffectedRoadContext | null;
}

/**
 * Decision command region - displays decision results and canonical context.
 *
 * Renders the canonical SelectedSnapshot and AffectedRoadContext presentation
 * panels. Both display backend-provided values only; the detailed decision
 * experience belongs to TASK-129/131/132.
 */
function DecisionRegion({
  selectedSnapshot,
  affectedRoadContext,
}: DecisionRegionProps): ReactNode {
  return (
    <section
      className="dashboard-region dashboard-region--decision"
      aria-labelledby="decision-heading"
    >
      <h2 id="decision-heading" className="dashboard-region__heading">
        決策指令
      </h2>
      <div className="dashboard-region__content dashboard-region__content--stacked">
        <EmptyState message="目前尚無可顯示的決策結果" />
        <SnapshotProvenance snapshot={selectedSnapshot} />
        <AffectedRoadContextView context={affectedRoadContext} />
      </div>
    </section>
  );
}

// ─── Dashboard Shell ───────────────────────────────────────

export interface DashboardShellProps {
  /**
   * Canonical backend-provided snapshot. Optional so the shell is
   * structurally ready for backend data without inventing fixtures.
   */
  readonly selectedSnapshot?: SelectedSnapshot | null;
  /**
   * Canonical backend-provided affected-road context. Optional for the same
   * reason.
   */
  readonly affectedRoadContext?: AffectedRoadContext | null;
  /**
   * Realtime connection mode reported by the realtime transport (§16.4).
   * Defaults to `disconnected` before a connection is attempted.
   */
  readonly connectionMode?: ConnectionMode;
  /** Current polling failure text while degraded, if any. */
  readonly pollingErrorMessage?: string | null;
  /** Polling cycles that refreshed at least one canonical read target. */
  readonly pollingUpdateCount?: number;
  /**
   * TASK-124 timeline playback panel content. Injected by the Dashboard page
   * so `dashboard_shell.tsx` stays a layout-only component with no fetch or
   * controller logic of its own.
   */
  readonly timelineContent?: ReactNode;
  /**
   * TASK-126 crowd/signaling panel content. Injected by the Dashboard page for
   * the same reason as `timelineContent`.
   */
  readonly crowdContent?: ReactNode;
}

/**
 * Resolves the operational status shown in the header.
 *
 * When a canonical snapshot is present, `manual_confirmation_required` is
 * taken from it verbatim so the status bar can never contradict canonical
 * backend truth. This is a pass-through of a backend value, not a
 * calculation: no timestamp comparison or policy defaulting occurs here.
 */
function resolveOperationalStatus(
  snapshot: SelectedSnapshot | null,
  connectionMode: ConnectionMode,
): OperationalStatus {
  const base: OperationalStatus = { ...createDefaultOperationalStatus(), connectionMode };

  if (snapshot === null) {
    return base;
  }

  return {
    ...base,
    manualConfirmationRequired: snapshot.manual_confirmation_required,
  };
}

/**
 * Main dashboard shell with header, status bar, and four regions.
 */
export function DashboardShell({
  selectedSnapshot = null,
  affectedRoadContext = null,
  connectionMode = 'disconnected',
  pollingErrorMessage = null,
  pollingUpdateCount = 0,
  timelineContent,
  crowdContent,
}: DashboardShellProps = {}): ReactNode {
  const operationalStatus = resolveOperationalStatus(selectedSnapshot, connectionMode);

  return (
    <div className="dashboard-shell">
      <header className="dashboard-header" role="banner">
        <h1 className="dashboard-header__title">城市交通應變 AI 指揮台</h1>
        <OperationalStatusBar
          status={operationalStatus}
          pollingErrorMessage={pollingErrorMessage}
          pollingUpdateCount={pollingUpdateCount}
        />
      </header>

      <main className="dashboard-main" role="main">
        <div className="dashboard-grid">
          <TimelineRegion content={timelineContent} />
          <RoadTrafficRegion />
          <CrowdRegion content={crowdContent} />
          <DecisionRegion
            selectedSnapshot={selectedSnapshot}
            affectedRoadContext={affectedRoadContext}
          />
        </div>
      </main>

      <footer className="dashboard-footer" role="contentinfo">
        <p className="dashboard-footer__text">City Response Commander</p>
      </footer>
    </div>
  );
}
