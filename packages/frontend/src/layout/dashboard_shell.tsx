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
import { LanguageSwitcher, useI18n } from '../i18n/index.js';

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
  const { t } = useI18n();
  return (
    <section
      className="dashboard-region dashboard-region--timeline"
      aria-labelledby="timeline-heading"
    >
      <h2 id="timeline-heading" className="dashboard-region__heading">
        {t('region.timeline.heading')}
      </h2>
      <div className="dashboard-region__content dashboard-region__content--stacked">
        {content ?? <EmptyState message={t('region.timeline.empty')} />}
      </div>
    </section>
  );
}

interface RoadTrafficRegionProps {
  /**
   * TASK-125 road traffic panel. `undefined` (the default) preserves the
   * pre-TASK-125 empty state so a `DashboardShell` rendered without a
   * `roadsContent` prop is unchanged.
   */
  readonly content?: ReactNode;
}

/**
 * Road traffic region - displays per-segment traffic with A/B levels
 * (§12 GET /roads, §16, §22.1 P7). Renders the injected TASK-125 `RoadPanel`
 * when supplied; otherwise falls back to the pre-TASK-125 empty state.
 */
function RoadTrafficRegion({ content }: RoadTrafficRegionProps): ReactNode {
  const { t } = useI18n();
  return (
    <section
      className="dashboard-region dashboard-region--roads"
      aria-labelledby="roads-heading"
    >
      <h2 id="roads-heading" className="dashboard-region__heading">
        {t('region.roads.heading')}
      </h2>
      <div className="dashboard-region__content dashboard-region__content--stacked">
        {content ?? <EmptyState message={t('region.roads.empty')} />}
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
  const { t } = useI18n();
  return (
    <section
      className="dashboard-region dashboard-region--crowd"
      aria-labelledby="crowd-heading"
    >
      <h2 id="crowd-heading" className="dashboard-region__heading">
        {t('region.crowd.heading')}
      </h2>
      <div className="dashboard-region__content dashboard-region__content--stacked">
        {content ?? <EmptyState message={t('region.crowd.empty')} />}
      </div>
    </section>
  );
}

interface DecisionRegionProps {
  /** Canonical backend-provided snapshot, or null when not supplied. */
  readonly selectedSnapshot: SelectedSnapshot | null;
  /** Canonical backend-provided affected-road context, or null when not supplied. */
  readonly affectedRoadContext: AffectedRoadContext | null;
  /**
   * TASK-132 decision panels (report + public alert). `undefined` (the default)
   * preserves the pre-TASK-132 empty state so a `DashboardShell` rendered
   * without a `decisionContent` prop is unchanged.
   */
  readonly content?: ReactNode;
}

interface WhatIfRegionProps {
  /**
   * TASK-141 What-if dialog. `undefined` (the default) preserves the
   * pre-TASK-141 empty state.
   */
  readonly content?: ReactNode;
}

interface MapRegionProps {
  /**
   * Dashboard Operations Map (schematic SVG). `undefined` (the default)
   * preserves an empty state so a `DashboardShell` rendered without a
   * `mapContent` prop is unchanged. This region is layout-only: no fetch,
   * classification, or map-rendering logic lives here — that stays inside
   * `map/operations_map.tsx`, which is injected by the Dashboard page.
   */
  readonly content?: ReactNode;
}

interface InjectionRegionProps {
  /**
   * TASK-128 admin session control + incident injection panel. `undefined`
   * (the default) preserves an empty state so a `DashboardShell` rendered
   * without an `injectionContent` prop is unchanged.
   */
  readonly content?: ReactNode;
}

/**
 * Decision command region - displays decision results and canonical context.
 *
 * Renders the canonical SelectedSnapshot and AffectedRoadContext presentation
 * panels. Both display backend-provided values only. The TASK-132 report and
 * public-alert panels are injected as `content`; the remaining decision detail
 * belongs to TASK-129/130/131.
 */
function DecisionRegion({
  selectedSnapshot,
  affectedRoadContext,
  content,
}: DecisionRegionProps): ReactNode {
  const { t } = useI18n();
  return (
    <section
      className="dashboard-region dashboard-region--decision"
      aria-labelledby="decision-heading"
    >
      <h2 id="decision-heading" className="dashboard-region__heading">
        {t('region.decision.heading')}
      </h2>
      <div className="dashboard-region__content dashboard-region__content--stacked">
        {content ?? <EmptyState message={t('region.decision.empty')} />}
        <SnapshotProvenance snapshot={selectedSnapshot} />
        <AffectedRoadContextView context={affectedRoadContext} />
      </div>
    </section>
  );
}

/**
 * What-if dialog region (§14.5, TASK-141).
 *
 * Renders the injected What-if dialog when supplied; otherwise falls back
 * to an empty state. The dialog allows operators to submit hypothetical
 * questions without mutating any persistent state.
 */
function WhatIfRegion({ content }: WhatIfRegionProps): ReactNode {
  const { t } = useI18n();
  return (
    <section
      className="dashboard-region dashboard-region--whatif"
      aria-labelledby="whatif-heading"
    >
      <h2 id="whatif-heading" className="dashboard-region__heading">
        {t('region.whatif.heading')}
      </h2>
      <div className="dashboard-region__content dashboard-region__content--stacked">
        {content ?? <EmptyState message={t('region.whatif.empty')} />}
      </div>
    </section>
  );
}

/**
 * Dashboard Operations Map region.
 *
 * Renders the injected schematic SVG map (`map/operations_map.tsx`) when
 * supplied; otherwise falls back to the shared empty state. Placed as its
 * own top-level region so it never displaces Timeline/Roads/Crowd/Decision/
 * What-if/Injection.
 */
function MapRegion({ content }: MapRegionProps): ReactNode {
  const { t } = useI18n();
  return (
    <section
      className="dashboard-region dashboard-region--map"
      aria-labelledby="map-heading"
    >
      <h2 id="map-heading" className="dashboard-region__heading">
        {t('region.map.heading')}
      </h2>
      <div className="dashboard-region__content dashboard-region__content--stacked">
        {content ?? <EmptyState message={t('region.map.empty')} />}
      </div>
    </section>
  );
}

/**
 * Incident injection region (§12, §17, TASK-128).
 *
 * Renders the injected admin-session control + `InjectionPanel` content when
 * supplied; otherwise falls back to the shared empty state. This region is
 * layout-only: no API, auth, or classification logic lives here — that stays
 * in the Dashboard page and inside `InjectionPanel`/`AdminSessionControl`
 * themselves.
 */
function InjectionRegion({ content }: InjectionRegionProps): ReactNode {
  const { t } = useI18n();
  return (
    <section
      className="dashboard-region dashboard-region--injection"
      aria-labelledby="injection-heading"
    >
      <h2 id="injection-heading" className="dashboard-region__heading">
        {t('region.injection.heading')}
      </h2>
      <div className="dashboard-region__content dashboard-region__content--stacked">
        {content ?? <EmptyState message={t('region.injection.empty')} />}
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
   * TASK-125 road traffic panel content. Same injection pattern as
   * `timelineContent`: `dashboard_shell.tsx` never fetches or classifies road
   * data itself.
   */
  readonly roadsContent?: ReactNode;
  /**
   * TASK-126 crowd/signaling panel content. Injected by the Dashboard page for
   * the same reason as `timelineContent`.
   */
  readonly crowdContent?: ReactNode;
  /**
   * TASK-132 decision panel content (report + public alert). Injected by the
   * Dashboard page for the same reason as `timelineContent`.
   */
  readonly decisionContent?: ReactNode;
  /**
   * TASK-141 What-if dialog content. Injected by the Dashboard page.
   */
  readonly whatifContent?: ReactNode;
  /**
   * Dashboard Operations Map content (schematic SVG). Injected by the
   * Dashboard page for the same reason as `timelineContent`: the shell stays
   * a layout-only component with no map-rendering logic of its own.
   */
  readonly mapContent?: ReactNode;
  /**
   * TASK-128 admin session control + incident injection panel content.
   * Injected by the Dashboard page for the same reason as `timelineContent`:
   * the shell stays a layout-only component with no fetch, auth, or
   * classification logic of its own.
   */
  readonly injectionContent?: ReactNode;
  /**
   * TASK-127 overlay content (the anomaly auto-popup), rendered above the
   * regions as the last child of the shell. Injected for the same reason as
   * the panel slots: the shell stays layout-only and owns no alert state.
   * `undefined` renders nothing, so a `DashboardShell` without this prop is
   * unchanged.
   */
  readonly overlayContent?: ReactNode;
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
 * Main dashboard shell with header, status bar, and five regions.
 */
export function DashboardShell({
  selectedSnapshot = null,
  affectedRoadContext = null,
  connectionMode = 'disconnected',
  pollingErrorMessage = null,
  pollingUpdateCount = 0,
  timelineContent,
  roadsContent,
  crowdContent,
  decisionContent,
  whatifContent,
  mapContent,
  injectionContent,
  overlayContent,
}: DashboardShellProps = {}): ReactNode {
  const { t } = useI18n();
  const operationalStatus = resolveOperationalStatus(selectedSnapshot, connectionMode);

  return (
    <div className="dashboard-shell">
      <header className="dashboard-header" role="banner">
        <div className="dashboard-header__identity">
          <h1 className="dashboard-header__title">{t('shell.title')}</h1>
          <LanguageSwitcher />
        </div>
        <OperationalStatusBar
          status={operationalStatus}
          pollingErrorMessage={pollingErrorMessage}
          pollingUpdateCount={pollingUpdateCount}
        />
      </header>

      <main className="dashboard-main" role="main">
        <div className="dashboard-grid">
          <TimelineRegion content={timelineContent} />
          <RoadTrafficRegion content={roadsContent} />
          <CrowdRegion content={crowdContent} />
          <DecisionRegion
            selectedSnapshot={selectedSnapshot}
            affectedRoadContext={affectedRoadContext}
            content={decisionContent}
          />
          <WhatIfRegion content={whatifContent} />
          <MapRegion content={mapContent} />
          <InjectionRegion content={injectionContent} />
        </div>
      </main>

      <footer className="dashboard-footer" role="contentinfo">
        <p className="dashboard-footer__text">{t('shell.footer')}</p>
      </footer>

      {overlayContent}
    </div>
  );
}
