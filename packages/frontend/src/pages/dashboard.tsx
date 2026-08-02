/**
 * Dashboard Page — DEMO vs Production routing
 *
 * Three-component split, each calling exactly the hooks it is allowed to call.
 * No data hook is mounted conditionally; the demo path never imports the
 * production realtime polling fallback, and the production path never imports
 * the demo-only adapter.
 *
 *  DashboardPage         — pure router; reads only `useAppConfig()`
 *  DemoDashboardPage     — single owner of `useDemoTimeseries`
 *  ProductionDashboardPage — preserves the original TASK-122 wiring
 *
 * The DEMO page never issues `GET /roads`, `GET /crowd`, or `GET /timeline`
 * because the demo backend does not serve them. All metrics are derived from
 * the single `/demo/timeseries` snapshot, indexed by the local timeline index.
 *
 * @module frontend/pages/dashboard
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AnomalyPopup } from '../alerts/anomaly_popup.js';
import { AnomalyDemoPopup } from '../alerts/anomaly_demo_popup.js';
import { useAnomalyPopup } from '../alerts/use_anomaly_popup.js';
import { useDemoAnomalyPopup } from '../alerts/use_anomaly_popup_demo.js';
import { createApiClient } from '../api/client.js';
import { createDemoApiClient } from '../api/demo_api_adapter.js';
import type { DemoApiClient, DemoDecisionView, DemoTimeseriesResponse } from '../api/demo_api_adapter.js';
import { AdminSessionControl } from '../auth/admin_session_control.js';
import type { AdminToken } from '../auth/admin_session.js';
import { useCrowdSnapshot } from '../crowd/use_crowd_snapshot.js';
import { AlertPanel } from '../decision/alert_panel.js';
import { EtePanel } from '../decision/ete_panel.js';
import { ExecutionStatusPanel } from '../decision/execution_status.js';
import { decodeProcessingFailed } from '../decision/execution_model.js';
import type { ProcessingFailedView } from '../decision/execution_model.js';
import { ExplanationChain } from '../decision/explanation_chain.js';
import { AiDecisionDrawerDemo } from '../decision/ai_decision_drawer_demo.js';
import { ControlCenterRecommendationPanel } from '../decision/control_center_recommendation_panel.js';
import { AiDecisionCardDemo } from '../decision/ai_decision_card_demo.js';
import { RouteAdviceCardDemo } from '../decision/route_advice_card_demo.js';
import { MultilingualCardDemo } from '../decision/multilingual_card_demo.js';
import { ReasoningChainPanel } from '../decision/reasoning_chain_panel.js';
import { ReportPanel } from '../decision/report_panel.js';
import { RoutePanel } from '../decision/route_panel.js';
import { useDecisionReadModel } from '../decision/use_decision_read_model.js';
import { useEteView } from '../decision/use_ete_view.js';
import { useEvidenceView } from '../decision/use_evidence_view.js';
import { useExecutionStatus } from '../decision/use_execution_status.js';
import { useRouteView } from '../decision/use_route_view.js';
import { DemoDecisionPanel } from '../demo/demo_decision_panel.js';
import { DemoTimeseriesPanel } from '../demo/demo_timeseries_panel.js';
import { useDemoTimeseries } from '../demo/use_demo_timeseries.js';
import { CommandCenterShell } from '../layout/command_center_shell.js';
import type { RoadMetricData, CrowdMetricData, RoamingMetricData } from '../layout/command_center_shell.js';
import { GeographicMap } from '../map/geographic_map.js';
import { useRealtimeConnection } from '../realtime/use_realtime.js';
import type { PollingCycleResult } from '../realtime/polling_fallback.js';
import type { ReadyEventCommit } from '../realtime/use_realtime.js';
import type { RealtimeEventEnvelope } from '../realtime/transport_events.js';
import { useAppConfig } from '../state/app_context.js';
import type { ConnectionMode } from '../state/app_state.js';
import { TimelinePanel } from '../timeline/timeline_panel.js';
import { useTimelinePlayback } from '../timeline/use_timeline_playback.js';
import { RoadPanel } from '../roads/road_panel.js';
import { useRoadTraffic } from '../roads/use_road_traffic.js';
import { CrowdPanel } from '../crowd/crowd_panel.js';
import { WhatIfDialog } from '../whatif/whatif_dialog.js';
import { DashboardShell } from '../layout/dashboard_shell.js';
import { InjectionPanel } from '../inject/injection_panel.js';

// ─── Dashboard Page Router ──────────────────────────────────────

/**
 * Routes between the DEMO and Production dashboards.
 *
 * `DashboardPage` itself calls no data hook — it only inspects the validated
 * runtime configuration and mounts one of the two child dashboards. Each
 * child is allowed to call exactly the data hooks its data flow needs.
 */
export function DashboardPage(): ReactNode {
  const config = useAppConfig();
  const isDemoMode = config.apiMode === 'demo' || config.environment === 'DEMO';

  if (isDemoMode) {
    return <DemoDashboardPage />;
  }
  return <ProductionDashboardPage />;
}

// ─── Demo Dashboard Page ────────────────────────────────────────

/**
 * Single polling owner: `useDemoTimeseries`.
 *
 * Never calls `useTimelinePlayback`, `useRoadTraffic`, `useCrowdSnapshot`, or
 * `useRealtimeConnection`. Those would mount the §13 polling fallback and
 * issue `GET /roads` / `GET /crowd` / `GET /timeline`, which the demo backend
 * does not serve.
 *
 * Every metric shown to the operator is derived from the single
 * `GET /demo/timeseries` snapshot, indexed by the local timeline index.
 */
function DemoDashboardPage(): ReactNode {
  const config = useAppConfig();

  const adapter = useMemo<DemoApiClient>(
    () => createDemoApiClient({ baseEndpoint: config.apiEndpoint }),
    [config.apiEndpoint],
  );

  // SINGLE polling owner for DEMO mode. Everything below reads from this.
  const demoTimeseries = useDemoTimeseries(adapter);

  const anomalyDemo = useDemoAnomalyPopup();

  const [adminToken, setAdminToken] = useState<AdminToken>(null);
  const [injectedEventId, setInjectedEventId] = useState<string | null>(null);
  const [lastDecision, setLastDecision] = useState<DemoDecisionView | null>(null);
  const [timelineIndex, setTimelineIndex] = useState<number | null>(null);
  const [timelinePlaying, setTimelinePlaying] = useState(false);
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(null);

  const playbackRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Ingest each new timeseries snapshot into the anomaly auto-popup hook
  useEffect(() => {
    if (demoTimeseries.snapshot !== null) {
      anomalyDemo.ingestSnapshot(demoTimeseries.snapshot);
    }
  }, [demoTimeseries.snapshot, anomalyDemo]);

  const handleDecisionInjected = useCallback((view: DemoDecisionView) => {
    setInjectedEventId(view.eventId);
    setLastDecision(view);
  }, []);

  // ── Timeline state: snapshots + index (drives activeSnapshot below) ─────────
  const timestamps = demoTimeseries.timeline;
  const snapshots = demoTimeseries.snapshots;
  const isLoading = demoTimeseries.state === 'loading';

  // activeSnapshot is the ONE source of truth for every visible metric.
  const activeSnapshot =
    timelineIndex !== null && timelineIndex >= 0 && timelineIndex < snapshots.length
      ? snapshots[timelineIndex]
      : snapshots.length > 0
        ? snapshots[snapshots.length - 1]
        : null;

  // ── Timeline controls ────────────────────────────────────────────────────────
  const handleTimelineSelect = useCallback(
    (ts: string) => {
      const idx = timestamps.indexOf(ts);
      if (idx >= 0) setTimelineIndex(idx);
    },
    [timestamps],
  );

  const handleTimelinePrevious = useCallback(() => {
    setTimelineIndex((prev) => {
      if (prev === null || prev <= 0) return prev;
      return prev - 1;
    });
  }, []);

  const handleTimelineNext = useCallback(() => {
    setTimelineIndex((prev) => {
      if (prev === null || prev >= timestamps.length - 1) return prev;
      return prev + 1;
    });
  }, [timestamps.length]);

  const handleTimelinePlay = useCallback(() => {
    if (timestamps.length === 0) return;
    if (timelineIndex === null || timelineIndex >= timestamps.length - 1) {
      setTimelineIndex(0);
    }
    setTimelinePlaying(true);
  }, [timestamps.length, timelineIndex]);

  const handleTimelinePause = useCallback(() => {
    setTimelinePlaying(false);
  }, []);

  // ── Auto-advance timer (StrictMode-safe, single interval) ───────────────────
  useEffect(() => {
    if (!timelinePlaying) {
      if (playbackRef.current !== null) {
        clearInterval(playbackRef.current);
        playbackRef.current = null;
      }
      return;
    }
    playbackRef.current = setInterval(() => {
      setTimelineIndex((prev) => {
        if (prev === null) return 0;
        if (prev >= timestamps.length - 1) {
          setTimelinePlaying(false);
          return prev;
        }
        return prev + 1;
      });
    }, 1000);
    return () => {
      if (playbackRef.current !== null) {
        clearInterval(playbackRef.current);
        playbackRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timelinePlaying, timestamps.length]);

  // ── Metrics derived from activeSnapshot ───────────────────────────────────────

  const roadMetrics = useMemo<readonly RoadMetricData[]>(() => {
    const traffic = activeSnapshot?.traffic ?? [];
    return traffic.map((t) => {
      const sat = t.Saturation_Score;
      const level = sat >= 0.85 ? 'blocked' : sat >= 0.60 ? 'caution' : 'clear';
      return {
        roadName: t.Road_Name,
        avgSpeed: t.Avg_Speed,
        saturation: sat,
        status: level as 'clear' | 'caution' | 'blocked' | 'unknown',
      };
    });
  }, [activeSnapshot]);

  const crowdMetrics = useMemo<readonly CrowdMetricData[]>(() => {
    return (activeSnapshot?.crowd ?? []).map((c) => ({
      stationId: c.BS_ID,
      locationName: c.Location_Name,
      userCount: c.User_Count,
      roamingPct: c.roaming_pct_value,
    }));
  }, [activeSnapshot]);

  const roamingMetrics = useMemo<readonly RoamingMetricData[]>(() => {
    return (activeSnapshot?.crowd ?? [])
      .filter((c) => c.roaming_pct_value > 0)
      .map((c) => ({
        stationId: c.BS_ID,
        roamingPct: c.roaming_pct_value,
      }))
      .sort((a, b) => (b.roamingPct ?? 0) - (a.roamingPct ?? 0));
  }, [activeSnapshot]);

  // GeographicMap needs the full response object; reuse the cached snapshot
  // and overlay the active traffic/crowd slice. No additional fetch.
  const mapSnapshot = demoTimeseries.snapshot
    ? ({
        ...demoTimeseries.snapshot,
        traffic: activeSnapshot?.traffic ?? [],
        crowd: activeSnapshot?.crowd ?? [],
      } as unknown as DemoTimeseriesResponse)
    : null;

  const aiDecisionContent = <AiDecisionCardDemo decision={lastDecision} />;
  const routeAdviceContent = <RouteAdviceCardDemo decision={lastDecision} />;
  const recommendationContent = lastDecision?.recommendation
    ? <ControlCenterRecommendationPanel recommendation={lastDecision.recommendation} />
    : null;
  const reasoningContent = <ReasoningChainPanel decision={lastDecision} />;
  const multilingualContent = (
    <MultilingualCardDemo decision={lastDecision} adapter={adapter} />
  );

  const whatifContent = useMemo(() => <WhatIfDialog client={adapter} />, [adapter]);

  const injectionContent = useMemo(
    () => (
      <>
        <AdminSessionControl adminToken={adminToken} onAdminTokenChange={setAdminToken} />
        <DemoDecisionPanel
          adapter={adapter}
          injectedEventId={injectedEventId}
          adminToken={adminToken}
          onDecisionInjected={handleDecisionInjected}
        />
        {lastDecision !== null && (
          <p className="injection-modal__last">
            最近注入：<code>{lastDecision.decisionId}</code>（{lastDecision.severity}）
          </p>
        )}
      </>
    ),
    [adminToken, adapter, injectedEventId, lastDecision, handleDecisionInjected],
  );

  // ── Header status: from the single polling owner only ───────────────────────
  // DEMO mode has no WebSocket and no §13 polling fallback, so the connection
  // mode is reported as "polling" — it is the only existing label that lets
  // `PollingDegradationNotice` render the success count and the error message
  // (the notice hides entirely for `disconnected`). The error string is
  // scoped to `GET /demo/timeseries`; `/roads`, `/crowd`, and `/timeline`
  // are never referenced.
  const connectionMode: ConnectionMode = 'polling';
  const demoPollingErrorMessage =
    demoTimeseries.error !== null ? `GET /demo/timeseries 更新失敗：${demoTimeseries.error}` : null;
  const demoPollingUpdateCount = demoTimeseries.pollingCount;

  return (
    <CommandCenterShell
      connectionMode={connectionMode}
      pollingErrorMessage={demoPollingErrorMessage}
      pollingUpdateCount={demoPollingUpdateCount}
      timelineTimestamps={timestamps}
      timelineIndex={timelineIndex}
      timelinePlaying={timelinePlaying}
      timelineLoading={isLoading}
      onTimelineSelect={handleTimelineSelect}
      onTimelinePrevious={handleTimelinePrevious}
      onTimelineNext={handleTimelineNext}
      onTimelinePlay={handleTimelinePlay}
      onTimelinePause={handleTimelinePause}
      mapContent={
        <GeographicMap
          snapshot={mapSnapshot}
          decision={lastDecision}
          loading={isLoading}
          errorMessage={demoTimeseries.error}
          selectedSegmentId={selectedSegmentId}
          onSegmentClick={setSelectedSegmentId}
          currentTimestamp={currentTimestamp}
        />
      }
      roadMetrics={roadMetrics}
      crowdMetrics={crowdMetrics}
      roamingMetrics={roamingMetrics}
      aiDecisionContent={aiDecisionContent}
      routeAdviceContent={routeAdviceContent}
      recommendationContent={recommendationContent}
      reasoningContent={reasoningContent}
      multilingualContent={multilingualContent}
      whatifContent={whatifContent}
      injectionContent={injectionContent}
      overlayContent={
        <AnomalyDemoPopup
          anomaly={anomalyDemo.current}
          isOpen={anomalyDemo.isOpen}
          onDismiss={anomalyDemo.dismiss}
        />
      }
    />
  );
}

// ─── Production Dashboard Page (preserved verbatim from TASK-122) ────────────

/**
 * Production dashboard — calls only the production data hooks. The DEMO
 * path never instantiates this component.
 */
function ProductionDashboardPage(): ReactNode {
  const config = useAppConfig();
  const [adminToken, setAdminToken] = useState<AdminToken>(null);

  const transport = useMemo(
    () => createApiClient({ baseEndpoint: config.apiEndpoint }),
    [config.apiEndpoint],
  );

  const timeline = useTimelinePlayback({ transport });
  const roads = useRoadTraffic({ transport });
  const crowd = useCrowdSnapshot({ transport, replayPosition: timeline.currentTimestamp });

  const [decisionId, setDecisionId] = useState<string | null>(null);
  const decision = useDecisionReadModel({ transport, decisionId });
  const { refresh: refreshDecision, ingestDecisionPayload } = decision;
  const evidence = useEvidenceView(decision.core);
  const routes = useRouteView(decision.core);
  const ete = useEteView(decision.core);
  const eteRoleEvidence = evidence.kind === 'ok' ? evidence.evidence.affectedSetConstruction : null;

  const [lastFailureEvent, setLastFailureEvent] = useState<ProcessingFailedView | null>(null);
  const executionStatus = useExecutionStatus({
    execution: decision.execution,
    lastFailureEvent,
  });

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
      ingestAnomalyEvent(envelope);
      if (envelope.eventType === 'timeline.updated') {
        refreshTimeline();
        return;
      }
      if (envelope.eventType === 'processing.failed') {
        setLastFailureEvent(decodeProcessingFailed(envelope.payload));
      }
      if (envelope.decisionId === null) return;
      setDecisionId((previous) => (previous === envelope.decisionId ? previous : envelope.decisionId));
      refreshDecision();
    },
    [refreshDecision, refreshTimeline, ingestAnomalyEvent],
  );

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
          ingestPolledTimeline(outcome.result.value.data);
        } else if (outcome.target.kind === 'roads' && outcome.result.ok) {
          ingestPolledRoads(outcome.result.value.data);
          ingestAnomalyRoads(outcome.result.value.data);
        } else if (outcome.target.kind === 'crowd' && outcome.result.ok) {
          ingestAnomalyCrowd(outcome.result.value.data);
        }
      }
    },
    [ingestPolledTimeline, ingestPolledRoads, ingestAnomalyRoads, ingestAnomalyCrowd],
  );

  const lastRoadRefreshTimestampRef = useRef<string | null | undefined>(undefined);
  useEffect(() => {
    const previous = lastRoadRefreshTimestampRef.current;
    if (previous === timeline.currentTimestamp) return;
    const isGenuineAdvance = previous !== undefined && previous !== null;
    lastRoadRefreshTimestampRef.current = timeline.currentTimestamp;
    if (!isGenuineAdvance) return;
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
          <AdminSessionControl adminToken={adminToken} onAdminTokenChange={setAdminToken} />
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