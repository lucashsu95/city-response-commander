/**
 * Dashboard Page
 *
 * Main dashboard route component. Owns the realtime connection lifecycle
 * (§13, §16.4) and feeds its connection mode into the operational status bar.
 * Also owns the TASK-124 timeline playback controller and the TASK-125 road
 * traffic controller, wiring their refresh signals:
 *
 * - `timeline.updated` (WebSocket notification) → authoritative timeline refresh
 * - the TASK-122 polling fallback's `timeline`/`roads` targets → consumed
 *   directly when available, so no second `GET /timeline`/`GET /roads`
 *   request is issued
 * - the timeline controller's authoritative `currentTimestamp` advancing →
 *   one road refresh (§16, TASK-125); the mount-time initial `GET /roads`
 *   fetch is the road controller's own responsibility, not duplicated here
 * - `anomaly.detected` and the fallback's `roads`/`crowd` bodies → the
 *   TASK-127 anomaly popup controller, which reuses those already-fetched
 *   payloads and adds no request, timer, or socket of its own
 *
 * @module frontend/pages/dashboard
 */

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AnomalyPopup } from '../alerts/anomaly_popup.js';
import { useAnomalyPopup } from '../alerts/use_anomaly_popup.js';
import { createApiClient } from '../api/client.js';
import { createDemoApiClient } from '../api/demo_api_adapter.js';
import type { DemoApiClient, DemoDecisionView } from '../api/demo_api_adapter.js';
import { AdminSessionControl } from '../auth/admin_session_control.js';
import type { AdminToken } from '../auth/admin_session.js';
import { CrowdPanel } from '../crowd/crowd_panel.js';
import { useCrowdSnapshot } from '../crowd/use_crowd_snapshot.js';
import { AlertPanel } from '../decision/alert_panel.js';
import { EtePanel } from '../decision/ete_panel.js';
import { ExecutionStatusPanel } from '../decision/execution_status.js';
import { decodeProcessingFailed } from '../decision/execution_model.js';
import type { ProcessingFailedView } from '../decision/execution_model.js';
import { ExplanationChain } from '../decision/explanation_chain.js';
import { ReportPanel } from '../decision/report_panel.js';
import { RoutePanel } from '../decision/route_panel.js';
import { useDecisionReadModel } from '../decision/use_decision_read_model.js';
import { InjectionPanel } from '../inject/injection_panel.js';
import { WhatIfDialog } from '../whatif/whatif_dialog.js';
import { useEteView } from '../decision/use_ete_view.js';
import { useEvidenceView } from '../decision/use_evidence_view.js';
import { useExecutionStatus } from '../decision/use_execution_status.js';
import { useRouteView } from '../decision/use_route_view.js';
import { DashboardShell } from '../layout/dashboard_shell.js';
import { useRealtimeConnection } from '../realtime/use_realtime.js';
import type { PollingCycleResult } from '../realtime/polling_fallback.js';
import type { ReadyEventCommit } from '../realtime/use_realtime.js';
import type { RealtimeEventEnvelope } from '../realtime/transport_events.js';
import { useAppConfig } from '../state/app_context.js';
import { TimelinePanel } from '../timeline/timeline_panel.js';
import { useTimelinePlayback } from '../timeline/use_timeline_playback.js';
import { RoadPanel } from '../roads/road_panel.js';
import { useRoadTraffic } from '../roads/use_road_traffic.js';
import { DemoDecisionPanel } from '../demo/demo_decision_panel.js';
import { DemoTimeseriesPanel } from '../demo/demo_timeseries_panel.js';
import { useDemoTimeseries } from '../demo/use_demo_timeseries.js';

/**
 * Dashboard page component.
 *
 * `VITE_API_MODE=demo` selects the Demo API Compatibility Adapter; in demo
 * mode the dashboard skips every `useTimelinePlayback` / `useRoadTraffic` /
 * `useCrowdSnapshot` / `useDecisionReadModel` controller (those assume the
 * full production `/roads`, `/crowd`, `/timeline`, `/decisions/{id}` routes
 * that the demo stack does not deploy) and renders three independent panels
 * fed directly by the adapter. The production path below is the original
 * TASK-124 / TASK-125 / TASK-126 / TASK-132 wired layout.
 */
export function DashboardPage(): ReactNode {
  const config = useAppConfig();
  const isDemoMode = config.apiMode === 'demo';

  // TASK-128 repair: the admin JWT lives only in this page's React state. No
  // frontend module persists it (no localStorage/sessionStorage/cookie/URL/env),
  // and no frontend module inspects or trusts its payload — the Backend/Cognito
  // authorizer remains the sole source of authorization truth. A page refresh
  // clears this state naturally.
  const [adminToken, setAdminToken] = useState<AdminToken>(null);

  if (isDemoMode) {
    return (
      <DemoDashboardPage
        config={config}
        adminToken={adminToken}
        onAdminTokenChange={setAdminToken}
      />
    );
  }

  return (
    <ProductionDashboardPage
      config={config}
      adminToken={adminToken}
      onAdminTokenChange={setAdminToken}
    />
  );
}

// ─── Demo Mode Entry Point ────────────────────────────────────

interface DemoDashboardProps {
  readonly config: ReturnType<typeof useAppConfig>;
  readonly adminToken: AdminToken;
  readonly onAdminTokenChange: (token: AdminToken) => void;
}

/**
 * Demo-mode dashboard. Bypasses every controller that issues production
 * `GET /timeline`, `GET /roads`, `GET /crowd`, or `GET /decisions/{id}`
 * requests — those routes are not yet deployed — and renders three
 * independent panels driven directly by the Demo API Adapter.
 *
 * The WebSocket is intentionally never connected in demo mode (no demo-side
 * WebSocket route exists); the realtime hook's socket endpoint is empty, so
 * the hook immediately settles on `polling` and the dashboard's connection
 * bar reports the documented fallback mode.
 */
function DemoDashboardPage({
  config,
  adminToken,
  onAdminTokenChange,
}: DemoDashboardProps): ReactNode {
  const adapter = useMemo<DemoApiClient>(
    () => createDemoApiClient({ baseEndpoint: config.apiEndpoint }),
    [config.apiEndpoint],
  );
  const demoTimeseries = useDemoTimeseries(adapter);

  const [injectedEventId, setInjectedEventId] = useState<string | null>(null);
  const [lastDecision, setLastDecision] = useState<DemoDecisionView | null>(null);

  const handleDecisionInjected = useCallback((view: DemoDecisionView) => {
    setInjectedEventId(view.eventId);
    setLastDecision(view);
  }, []);

  // Demo-mode realtime transport: the demo API adapter satisfies the
  // §13 polling-fallback transport shape (`getRoads`/`getCrowd`/`getDecision`/
  // `getReadOnlyJson`) and routes every fallback target back to the cached
  // `/demo/timeseries` snapshot. Without this injection `useRealtimeConnection`
  // would build its own production client and every 2-second poll would issue
  // `GET /timeline`, `GET /roads`, `GET /crowd` against routes the demo
  // stack does not deploy, producing continuous 404 noise in the console.
  const realtime = useRealtimeConnection({
    apiEndpoint: config.apiEndpoint,
    wsEndpoint: config.wsEndpoint,
    transport: adapter,
  });

  return (
    <DashboardShell
      connectionMode={realtime.connectionMode}
      pollingErrorMessage={realtime.pollingErrorMessage}
      pollingUpdateCount={realtime.pollingUpdateCount}
      timelineContent={
        <DemoTimeseriesPanel
          snapshot={demoTimeseries.snapshot}
          errorMessage={demoTimeseries.errorMessage}
          loading={demoTimeseries.state === 'loading'}
          onRetry={demoTimeseries.refresh}
        />
      }
      roadsContent={
        <DemoTimeseriesPanel
          snapshot={demoTimeseries.snapshot}
          errorMessage={demoTimeseries.errorMessage}
          loading={demoTimeseries.state === 'loading'}
          onRetry={demoTimeseries.refresh}
        />
      }
      crowdContent={
        <DemoTimeseriesPanel
          snapshot={demoTimeseries.snapshot}
          errorMessage={demoTimeseries.errorMessage}
          loading={demoTimeseries.state === 'loading'}
          onRetry={demoTimeseries.refresh}
        />
      }
      decisionContent={
        <DemoDecisionPanel
          adapter={adapter}
          injectedEventId={injectedEventId}
          adminToken={adminToken}
          onDecisionInjected={handleDecisionInjected}
        />
      }
      whatifContent={<WhatIfDialog client={adapter} />}
      injectionContent={
        <>
          <AdminSessionControl adminToken={adminToken} onAdminTokenChange={onAdminTokenChange} />
          <DemoDecisionPanel
            adapter={adapter}
            injectedEventId={injectedEventId}
            adminToken={adminToken}
            onDecisionInjected={handleDecisionInjected}
          />
          {lastDecision !== null ? (
            <p className="dashboard-footer__text" aria-live="polite">
              最近一次 demo 注入：<code>{lastDecision.decisionId}</code>（{lastDecision.severity}）
            </p>
          ) : null}
        </>
      }
    />
  );
}

// ─── Production Mode Entry Point ──────────────────────────────

interface ProductionDashboardProps {
  readonly config: ReturnType<typeof useAppConfig>;
  readonly adminToken: AdminToken;
  readonly onAdminTokenChange: (token: AdminToken) => void;
}

/**
 * Production-mode dashboard — the original TASK-124/125/126/132 wired layout.
 * Kept verbatim so the demo integration does not perturb the production
 * controllers in any way.
 */
function ProductionDashboardPage({
  config,
  adminToken,
  onAdminTokenChange,
}: ProductionDashboardProps): ReactNode {
  // Same-lifetime API client shared by the timeline controller's direct
  // `GET /timeline` fetches. Realtime's own transport (used for the §13
  // polling fallback) is constructed independently inside `useRealtimeConnection`.
  const transport = useMemo(
    () => createApiClient({ baseEndpoint: config.apiEndpoint }),
    [config.apiEndpoint],
  );

  const timeline = useTimelinePlayback({ transport });
  const roads = useRoadTraffic({ transport });

  // TASK-126: the crowd snapshot re-reads `GET /crowd` whenever the
  // authoritative replay position advances (§16.1). The timeline's `current` is
  // the only trigger — the crowd panel never extrapolates a previous snapshot.
  const crowd = useCrowdSnapshot({ transport, replayPosition: timeline.currentTimestamp });

  // TASK-132: the decision panels read `GET /decisions/{decision_id}`. The id is
  // only known once a realtime event names one (§13: every decision-scoped event
  // carries `decision_id`); until then the panels stay in their explicit
  // "no decision yet" state rather than showing a fabricated report.
  const [decisionId, setDecisionId] = useState<string | null>(null);
  const decision = useDecisionReadModel({ transport, decisionId });
  const { refresh: refreshDecision, ingestDecisionPayload } = decision;

  // TASK-129: `core.evidence` is decoded once per core, not once per render.
  const evidence = useEvidenceView(decision.core);

  // TASK-130: the route blocks (`excluded_candidates`, `incident_anchor`) are
  // decoded once per core as well.
  const routes = useRouteView(decision.core);

  // TASK-131: `core.ete` carries the authoritative ETE operands (the live
  // EvidenceTrace has no `formula_substitution` block), decoded once per core.
  const ete = useEteView(decision.core);
  // Second authoritative source of an affected road's ETE role (§10.10), when
  // the backend supplies it. Reused from the TASK-129 decode rather than
  // re-decoding the evidence block.
  const eteRoleEvidence = evidence.kind === 'ok' ? evidence.evidence.affectedSetConstruction : null;

  // TASK-133: the latest `processing.failed` frame (§13). Kept as the decoded
  // notification it is — the authoritative failure record stays the read-only
  // `execution` projection re-read from `GET /decisions/{decision_id}`.
  const [lastFailureEvent, setLastFailureEvent] = useState<ProcessingFailedView | null>(null);
  const executionStatus = useExecutionStatus({
    execution: decision.execution,
    lastFailureEvent,
  });

  // FIX 4: `timeline` is a fresh object every render (its state is spread
  // into a new object alongside its stable methods each time), so depending
  // on `[timeline]` would recreate these callbacks — and therefore the
  // realtime connection's `onEvent`/`onPollingCycle` closures — on every
  // timeline state change. `refresh` and `ingestPolledTimeline` are each
  // individually stable (memoized with `useCallback`), so destructuring and
  // depending on just those two keeps these callbacks stable across ordinary
  // timeline rerenders.
  // TASK-127: the anomaly popup is a pure presentation controller. It owns no
  // transport, so it is fed from the realtime/polling data the connection below
  // already produced. All four members are referentially stable for the mount,
  // so including them here never changes the realtime callbacks' identity.
  const anomaly = useAnomalyPopup();
  const {
    ingestRealtimeEvent: ingestAnomalyEvent,
    ingestPolledRoads: ingestAnomalyRoads,
    ingestPolledCrowd: ingestAnomalyCrowd,
    dismiss: dismissAnomaly,
  } = anomaly;

  const { refresh: refreshTimeline, ingestPolledTimeline } = timeline;
  const { refresh: refreshRoads, ingestPolledRoads } = roads;

  const handleRealtimeEvent = useCallback(
    (envelope: RealtimeEventEnvelope) => {
      // TASK-127: `anomaly.detected` auto-opens the popup with no operator
      // action and no follow-up query. Dispatched first and unconditionally —
      // the controller ignores every other §13 event type — so this stays a
      // single dispatch point, and the early returns below can never starve it
      // of a frame.
      ingestAnomalyEvent(envelope);

      if (envelope.eventType === 'timeline.updated') {
        // §13 architectural rule: the WebSocket frame is a notification only.
        // It never seeds timeline state directly — it requests the
        // authoritative GET /timeline refresh.
        refreshTimeline();
        return;
      }

      // TASK-132: `publish.status_changed`, `processing.failed` and
      // `incident.injected` carry no `ready_event_id`, so they arrive here
      // rather than through the dedup coordinator. They are still only
      // notifications: they name the decision and request an authoritative
      // re-read, and never supply decision state themselves.
      if (envelope.eventType === 'processing.failed') {
        // TASK-133: the frame's own `error_code` / `retryable` are displayed
        // beside the authoritative projection (§13 fallback column), so the
        // decoded notification is kept as well as triggering the re-read.
        setLastFailureEvent(decodeProcessingFailed(envelope.payload));
      }

      if (envelope.decisionId === null) return;
      setDecisionId((previous) => (previous === envelope.decisionId ? previous : envelope.decisionId));
      refreshDecision();
    },
    [refreshDecision, refreshTimeline, ingestAnomalyEvent],
  );

  // TASK-132: `decision.fast_path_ready` / `decision.enriched` / `report.ready` /
  // `public_alert.ready` are deduplicated by the TASK-123 coordinator, which
  // already fetched the authoritative `GET /decisions/{id}` body during
  // reconciliation. Consume that body instead of issuing a second request; it is
  // re-validated by the decision decoder before anything is rendered.
  const handleReadyEvent = useCallback(
    (commit: ReadyEventCommit) => {
      const committedId = commit.envelope.decisionId;
      if (committedId !== null) {
        setDecisionId((previous) => (previous === committedId ? previous : committedId));
      }
      ingestDecisionPayload(commit.decision);
    },
    [ingestDecisionPayload],
  );

  const handlePollingCycle = useCallback(
    (result: PollingCycleResult) => {
      for (const outcome of result.outcomes) {
        if (outcome.target.kind === 'timeline' && outcome.result.ok) {
          // The TASK-122 fallback loop already issued this GET /timeline
          // request; consume its (still unvalidated) body directly instead of
          // issuing a second one.
          ingestPolledTimeline(outcome.result.value.data);
        } else if (outcome.target.kind === 'roads' && outcome.result.ok) {
          // Same preferred-ingestion path for TASK-125: the fallback loop
          // already issued this GET /roads request. A failed roads outcome
          // is ignored here (not looped over) — it never becomes a ready
          // state.
          ingestPolledRoads(outcome.result.value.data);
          // TASK-127 reads the *same* body for its anomaly verdict. No second
          // GET /roads, no new timer, no separate fallback loop.
          ingestAnomalyRoads(outcome.result.value.data);
        } else if (outcome.target.kind === 'crowd' && outcome.result.ok) {
          // §13 maps `anomaly.detected` to GET /roads + GET /crowd, so the
          // fallback loop already fetched this body too. Only TASK-127 consumes
          // it here: the TASK-126 crowd controller exposes no polled-ingest
          // seam (it re-reads on an authoritative timeline advance instead), and
          // adding one would mean editing `crowd/**`, which is outside this
          // task. A failed crowd outcome is ignored for the same reason as
          // roads above.
          ingestAnomalyCrowd(outcome.result.value.data);
        }
      }
    },
    [ingestPolledTimeline, ingestPolledRoads, ingestAnomalyRoads, ingestAnomalyCrowd],
  );

  // TASK-125: refresh road data when the authoritative timeline playback
  // position advances. `currentTimestamp` is read-tracked in a ref so this
  // effect only fires a road refresh when it actually *changes* value
  // (mount's initial `null` -> first value included), never on every
  // ordinary timeline rerender that leaves it unchanged. This mirrors the
  // "same timeline current value does not trigger duplicate requests" rule.
  const lastRoadRefreshTimestampRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const previous = lastRoadRefreshTimestampRef.current;
    if (previous === timeline.currentTimestamp) {
      return;
    }
    // Skip both the very first effect run (previous is `undefined`) and the
    // transition from "no authoritative position yet" to the first real one
    // (previous is `null`): both represent the timeline's own initial load
    // completing, not a playback advance, and the road controller already
    // issues its own mount-time initial `GET /roads` fetch. Only a change
    // between two already-authoritative timestamps is a genuine advance.
    const isGenuineAdvance = previous !== undefined && previous !== null;
    lastRoadRefreshTimestampRef.current = timeline.currentTimestamp;
    if (!isGenuineAdvance) {
      return;
    }
    refreshRoads();
  }, [timeline.currentTimestamp, refreshRoads]);

  const realtime = useRealtimeConnection({
    apiEndpoint: config.apiEndpoint,
    wsEndpoint: config.wsEndpoint,
    onEvent: handleRealtimeEvent,
    onReadyEvent: handleReadyEvent,
    onPollingCycle: handlePollingCycle,
  });

  return (
    <DashboardShell
      connectionMode={realtime.connectionMode}
      pollingErrorMessage={realtime.pollingErrorMessage}
      pollingUpdateCount={realtime.pollingUpdateCount}
      timelineContent={
        <TimelinePanel
          playback={timeline}
          onRetry={timeline.refresh}
          onSelect={timeline.selectTimestamp}
          onPrevious={timeline.selectPrevious}
          onNext={timeline.selectNext}
        />
      }
      roadsContent={<RoadPanel traffic={roads} onRetry={roads.refresh} />}
      crowdContent={<CrowdPanel snapshot={crowd} onRetry={crowd.refresh} />}
      whatifContent={<WhatIfDialog client={transport} />}
      decisionContent={
        <>
          <ReportPanel decision={decision} onRetry={decision.refresh} />
          <AlertPanel decision={decision} onRetry={decision.refresh} />
          <RoutePanel decision={decision} routes={routes} onRetry={decision.refresh} />
          <EtePanel
            decision={decision}
            ete={ete}
            roleEvidence={eteRoleEvidence}
            onRetry={decision.refresh}
          />
          <ExplanationChain
            decision={decision}
            evidence={evidence}
            onRetry={decision.refresh}
          />
          <ExecutionStatusPanel
            decision={decision}
            execution={executionStatus}
            onRetry={decision.refresh}
          />
        </>
      }
      injectionContent={
        <>
          <AdminSessionControl adminToken={adminToken} onAdminTokenChange={onAdminTokenChange} />
          <InjectionPanel client={transport} adminToken={adminToken} />
        </>
      }
      overlayContent={
        <AnomalyPopup
          anomaly={anomaly.current}
          isOpen={anomaly.isOpen}
          onDismiss={dismissAnomaly}
        />
      }
    />
  );
}
