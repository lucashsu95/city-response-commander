/**
 * Demo Timeseries Hook
 *
 * Drives `GET /demo/timeseries` through the Demo API Adapter. The raw projection
 * returned by the demo backend is consumed read-only — timeline rows, traffic
 * rows, and crowd rows are kept exactly as the backend sends them.
 *
 * Concurrency guarantee: at most one active `GET /demo/timeseries` request at
 * a time, matching the same "no parallel refreshes" rule the production
 * `useTimelinePlayback` enforces. A `refresh()` issued while a request is in
 * flight is coalesced into a single follow-up.
 *
 * Failure is preserved verbatim: a transport failure becomes a typed state —
 * the dashboard never shows fabricated rows.
 *
 * @module frontend/demo/use_demo_timeseries
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { DemoApiClient, DemoTimeseriesResponse } from '../api/demo_api_adapter.js';

export type DemoTimeseriesControllerState = 'idle' | 'loading' | 'ready' | 'error';

export interface DemoTimeseriesController {
  readonly state: DemoTimeseriesControllerState;
  readonly snapshot: DemoTimeseriesResponse | null;
  readonly errorMessage: string | null;
  readonly refreshStatus: 'idle' | 'refreshing';
  refresh(): void;
}

export function useDemoTimeseries(adapter: DemoApiClient): DemoTimeseriesController {
  const [state, setState] = useState<DemoTimeseriesControllerState>('idle');
  const [snapshot, setSnapshot] = useState<DemoTimeseriesResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [refreshStatus, setRefreshStatus] = useState<'idle' | 'refreshing'>('idle');

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
      setErrorMessage(null);
    } else {
      setRefreshStatus('refreshing');
    }
    try {
      const result = await adapterRef.current.getDemoTimeseries();
      if (generation !== generationRef.current) {
        return;
      }
      if (!result.ok) {
        setErrorMessage(result.error.message);
        setState((prev) => (everSucceededRef.current ? prev : 'error'));
        setRefreshStatus('idle');
        return;
      }
      setSnapshot(result.data);
      setErrorMessage(null);
      setState('ready');
      setRefreshStatus('idle');
      everSucceededRef.current = true;
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

  return {
    state,
    snapshot,
    errorMessage,
    refreshStatus,
    refresh,
  };
}
