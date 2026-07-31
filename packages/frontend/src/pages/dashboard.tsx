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

import { useCallback, useMemo, type ReactNode } from 'react';
import { createApiClient } from '../api/client.js';
import { DashboardShell } from '../layout/dashboard_shell.js';
import { useRealtimeConnection } from '../realtime/use_realtime.js';
import type { PollingCycleResult } from '../realtime/polling_fallback.js';
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
        }
      }
    },
    [ingestPolledTimeline],
  );

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
    />
  );
}
