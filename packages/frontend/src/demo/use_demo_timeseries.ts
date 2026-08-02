/**
 * Demo Timeseries Hook — single source of truth for the DEMO dashboard.
 *
 * Drives exactly one HTTP endpoint — `GET /demo/timeseries` — through the Demo
 * API Adapter. Every panel under `DemoDashboardPage` reads from the returned
 * controller (`snapshots`, `timeline`, `anomalies`, `pollingStatus`,
 * `pollingCount`, `error`) and never issues its own production fetch.
 *
 * Concurrency guarantee: at most one active `GET /demo/timeseries` request at
 * a time, mirroring the same "no parallel refreshes" rule the production
 * `useTimelinePlayback` enforces. A `refresh()` issued while a request is in
 * flight is coalesced into a single follow-up.
 *
 * Failure is preserved verbatim: a transport failure becomes a typed state —
 * the dashboard never shows fabricated rows.
 *
 * @module frontend/demo/use_demo_timeseries
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DemoApiClient, DemoTimeseriesResponse } from '../api/demo_api_adapter.js';

export type DemoTimeseriesControllerState = 'idle' | 'loading' | 'ready' | 'error';

export type DemoPollingStatus = 'idle' | 'refreshing';

/**
 * Single polling-owner controller exposed to `DemoDashboardPage`.
 *
 * No member of this controller ever points at `/roads`, `/crowd`, or
 * `/timeline`. The demo backend does not serve those routes; the dashboard
 * therefore does not ask for them.
 */
export interface DemoTimeseriesController {
  readonly state: DemoTimeseriesControllerState;
  /** Raw timeseries snapshot, or `null` while still loading / after error. */
  readonly snapshot: DemoTimeseriesResponse | null;
  /** Convenience: ordered timestamps from the snapshot. Empty while loading. */
  readonly timeline: readonly string[];
  /** Convenience: snapshot array — empty while loading. */
  readonly snapshots: readonly DemoTimeseriesResponse['snapshots'][number][];
  /** Convenience: anomalies surfaced by the demo backend, when present. */
  readonly anomalies: readonly NonNullable<DemoTimeseriesResponse['anomalies']>[number][];
  /** Last transport error message, or `null` when no error has occurred. */
  readonly error: string | null;
  /** `refreshing` while a background refresh is in flight, `idle` otherwise. */
  readonly pollingStatus: DemoPollingStatus;
  /** Number of times the controller has successfully refreshed since mount. */
  readonly pollingCount: number;
  /** Trigger one manual refresh; coalesced if a request is already in flight. */
  refresh(): void;
}

export function useDemoTimeseries(adapter: DemoApiClient): DemoTimeseriesController {
  const [state, setState] = useState<DemoTimeseriesControllerState>('idle');
  const [snapshot, setSnapshot] = useState<DemoTimeseriesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pollingStatus, setPollingStatus] = useState<DemoPollingStatus>('idle');
  const [pollingCount, setPollingCount] = useState(0);

  const adapterRef = useRef(adapter);
  adapterRef.current = adapter;

  const generationRef = useRef(0);
  const inFlightRef = useRef(false);
  const queuedFollowUpRef = useRef(false);
  const everSucceededRef = useRef(false);

  const runFetch = useCallback(async () => {
    if (inFlightRef.current) {
      queuedFollowUpRef.current = true;
      return;
    }
    inFlightRef.current = true;
    generationRef.current += 1;
    const generation = generationRef.current;
    const isFirstLoad = !everSucceededRef.current;
    if (isFirstLoad) {
      setState('loading');
      setError(null);
    } else {
      setPollingStatus('refreshing');
    }
    try {
      const result = await adapterRef.current.getDemoTimeseries();
      if (generation !== generationRef.current) {
        return;
      }
      if (!result.ok) {
        setError(result.error.message);
        setState((prev) => (everSucceededRef.current ? prev : 'error'));
        setPollingStatus('idle');
        return;
      }
      setSnapshot(result.data);
      setError(null);
      setState('ready');
      setPollingStatus('idle');
      everSucceededRef.current = true;
      setPollingCount((prev) => prev + 1);
    } finally {
      inFlightRef.current = false;
      if (queuedFollowUpRef.current) {
        queuedFollowUpRef.current = false;
        void runFetch();
      }
    }
  }, []);

  useEffect(() => {
    void runFetch();
  }, [runFetch]);

  const refresh = useCallback(() => {
    void runFetch();
  }, [runFetch]);

  const timeline = useMemo<readonly string[]>(() => snapshot?.timeline ?? [], [snapshot]);
  const snapshots = useMemo<DemoTimeseriesResponse['snapshots'][number][]>(
    () => (snapshot?.snapshots === undefined ? [] : [...snapshot.snapshots]),
    [snapshot],
  );
  const anomalies = useMemo<DemoTimeseriesController['anomalies']>(
    () => (snapshot?.anomalies === undefined ? [] : [...snapshot.anomalies]),
    [snapshot],
  );

  return {
    state,
    snapshot,
    timeline,
    snapshots,
    anomalies,
    error,
    pollingStatus,
    pollingCount,
    refresh,
  };
}
