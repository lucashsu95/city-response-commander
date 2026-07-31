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
import type { OperationalStatus } from '../state/app_state.js';

// ─── Region Components ─────────────────────────────────────

/**
 * Timeline region - displays time-axis data playback.
 * Empty state until TASK-124 implementation.
 */
function TimelineRegion(): ReactNode {
  return (
    <section
      className="dashboard-region dashboard-region--timeline"
      aria-labelledby="timeline-heading"
    >
      <h2 id="timeline-heading" className="dashboard-region__heading">
        時間軸
      </h2>
      <div className="dashboard-region__content">
        <EmptyState message="尚無可顯示的時間軸資料" />
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

/**
 * Crowd/base-station region - displays user counts and roaming data.
 * Empty state until TASK-126 implementation.
 */
function CrowdRegion(): ReactNode {
  return (
    <section
      className="dashboard-region dashboard-region--crowd"
      aria-labelledby="crowd-heading"
    >
      <h2 id="crowd-heading" className="dashboard-region__heading">
        基地台人流
      </h2>
      <div className="dashboard-region__content">
        <EmptyState message="尚無可顯示的基地台資料" />
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
}

/**
 * Resolves the operational status shown in the header.
 *
 * When a canonical snapshot is present, `manual_confirmation_required` is
 * taken from it verbatim so the status bar can never contradict canonical
 * backend truth. This is a pass-through of a backend value, not a
 * calculation: no timestamp comparison or policy defaulting occurs here.
 */
function resolveOperationalStatus(snapshot: SelectedSnapshot | null): OperationalStatus {
  const base = createDefaultOperationalStatus();

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
}: DashboardShellProps = {}): ReactNode {
  const operationalStatus = resolveOperationalStatus(selectedSnapshot);

  return (
    <div className="dashboard-shell">
      <header className="dashboard-header" role="banner">
        <h1 className="dashboard-header__title">城市交通應變 AI 指揮台</h1>
        <OperationalStatusBar status={operationalStatus} />
      </header>

      <main className="dashboard-main" role="main">
        <div className="dashboard-grid">
          <TimelineRegion />
          <RoadTrafficRegion />
          <CrowdRegion />
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
