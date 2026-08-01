/**
 * Dashboard Page
 *
 * Main dashboard route component. Owns the realtime connection lifecycle
 * (§13, §16.4) and feeds its connection mode into the operational status bar.
 * Also owns the TASK-124 timeline playback controller and wires its two
 * refresh signals:
 *
 * - `timeline.updated` (WebSocket notification) → authoritative refresh
 * - the TASK-122 polling fallback's `timeline` target → consumed directly
 *   when available, so no second `GET /timeline` request is issued
 *
 * @module frontend/pages/dashboard
 */

import { useCallback, useMemo, useState, type ReactNode } from 'react';
import { createApiClient } from '../api/client.js';
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

/**
 * Dashboard page component.
 * Renders at the root route '/'.
 *
 * The realtime client starts once for the page lifetime using the validated
 * runtime configuration and is disposed on unmount.
 */
export function DashboardPage(): ReactNode {
  const config = useAppConfig();

  // Same-lifetime API client shared by the timeline controller's direct
  // `GET /timeline` fetches. Realtime's own transport (used for the §13
  // polling fallback) is constructed independently inside `useRealtimeConnection`.
  const transport = useMemo(
    () => createApiClient({ baseEndpoint: config.apiEndpoint }),
    [config.apiEndpoint],
  );

  const timeline = useTimelinePlayback({ transport });

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
  const { refresh: refreshTimeline, ingestPolledTimeline } = timeline;

  const handleRealtimeEvent = useCallback(
    (envelope: RealtimeEventEnvelope) => {
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
    [refreshDecision, refreshTimeline],
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
        }
      }
    },
    [ingestPolledTimeline],
  );

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
    />
  );
}
