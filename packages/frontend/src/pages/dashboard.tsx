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
 *
 * @module frontend/pages/dashboard
 */

import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { createApiClient } from '../api/client.js';
import { DashboardShell } from '../layout/dashboard_shell.js';
import { useRealtimeConnection } from '../realtime/use_realtime.js';
import type { PollingCycleResult } from '../realtime/polling_fallback.js';
import type { RealtimeEventEnvelope } from '../realtime/transport_events.js';
import { useAppConfig } from '../state/app_context.js';
import { TimelinePanel } from '../timeline/timeline_panel.js';
import { useTimelinePlayback } from '../timeline/use_timeline_playback.js';
import { RoadPanel } from '../roads/road_panel.js';
import { useRoadTraffic } from '../roads/use_road_traffic.js';

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
  const roads = useRoadTraffic({ transport });

  // FIX 4: `timeline` is a fresh object every render (its state is spread
  // into a new object alongside its stable methods each time), so depending
  // on `[timeline]` would recreate these callbacks — and therefore the
  // realtime connection's `onEvent`/`onPollingCycle` closures — on every
  // timeline state change. `refresh` and `ingestPolledTimeline` are each
  // individually stable (memoized with `useCallback`), so destructuring and
  // depending on just those two keeps these callbacks stable across ordinary
  // timeline rerenders.
  const { refresh: refreshTimeline, ingestPolledTimeline } = timeline;
  const { refresh: refreshRoads, ingestPolledRoads } = roads;

  const handleRealtimeEvent = useCallback(
    (envelope: RealtimeEventEnvelope) => {
      if (envelope.eventType === 'timeline.updated') {
        // §13 architectural rule: the WebSocket frame is a notification only.
        // It never seeds timeline state directly — it requests the
        // authoritative GET /timeline refresh.
        refreshTimeline();
      }
    },
    [refreshTimeline],
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
        }
      }
    },
    [ingestPolledTimeline, ingestPolledRoads],
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
    />
  );
}
