/**
 * Realtime Connection Hook (§16.4)
 *
 * Binds the realtime client to the React component lifecycle:
 * one client per mount, never one per render, fully disposed on unmount.
 *
 * Runtime configuration arrives through props/context. This module never reads
 * `import.meta.env` or `process.env` — `config/runtime_config.ts` remains the
 * only environment reader in the frontend.
 *
 * @module frontend/realtime/use_realtime
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { createApiClient } from '../api/client.js';
import type { ConnectionMode } from '../state/app_state.js';
import type { RealtimeScheduler } from './scheduler.js';
import type {
  PollingCycleResult,
  PollingTransport,
  RealtimeFallbackContext,
} from './polling_fallback.js';
import type { RealtimeEventEnvelope } from './transport_events.js';
import { createRealtimeClient } from './ws_client.js';
import type {
  RealtimeConnectionState,
  RealtimeError,
  RealtimeOperationalMode,
  RealtimeSocketFactory,
  RealtimeStatus,
} from './ws_client.js';

export interface UseRealtimeConnectionOptions {
  /** HTTP API base endpoint from runtime configuration. */
  readonly apiEndpoint: string;
  /** WebSocket endpoint from runtime configuration. */
  readonly wsEndpoint: string;
  /** Polling cadence override; defaults to 2000 ms. */
  readonly pollingIntervalMs?: number;
  /** Reconnect delay override. */
  readonly reconnectDelayMs?: number;
  /** Active §13 fallback context. */
  readonly fallbackContext?: RealtimeFallbackContext;
  /** Socket injection for tests; production uses the native WebSocket. */
  readonly socketFactory?: RealtimeSocketFactory;
  /** Timer injection for tests; production uses browser timers. */
  readonly scheduler?: RealtimeScheduler;
  /** Transport injection for tests; production builds the TASK-121 API client. */
  readonly transport?: PollingTransport;
  /** Receives every delivered event envelope, repeats included (TASK-123 owns dedup). */
  readonly onEvent?: (envelope: RealtimeEventEnvelope) => void;
  /** Receives every typed transport/polling error. */
  readonly onError?: (error: RealtimeError) => void;
  /** Receives every completed fallback polling cycle. */
  readonly onPollingCycle?: (result: PollingCycleResult) => void;
}

/** Presentation-ready view of the realtime connection. */
export interface RealtimeConnectionView {
  readonly state: RealtimeConnectionState;
  /** Mapped onto the TASK-121 `ConnectionMode` used by the status bar. */
  readonly connectionMode: ConnectionMode;
  readonly operationalMode: RealtimeOperationalMode | null;
  readonly pollingActive: boolean;
  readonly pollingUpdateCount: number;
  /** Sanitized route-level polling failure text, or null when polling is clean. */
  readonly pollingErrorMessage: string | null;
}

const INITIAL_STATUS: RealtimeStatus = {
  state: 'idle',
  mode: null,
  pollingActive: false,
  reconnectScheduled: false,
  lastTransportError: null,
  lastPollingError: null,
  pollingUpdateCount: 0,
};

/** Maps internal transport state onto the TASK-121 status-bar mode. */
export function toConnectionMode(state: RealtimeConnectionState): ConnectionMode {
  switch (state) {
    case 'connected':
      return 'websocket';
    case 'polling':
      return 'polling';
    case 'idle':
    case 'connecting':
    case 'stopped':
      return 'disconnected';
  }
}

function toView(status: RealtimeStatus): RealtimeConnectionView {
  return {
    state: status.state,
    connectionMode: toConnectionMode(status.state),
    operationalMode: status.mode,
    pollingActive: status.pollingActive,
    pollingUpdateCount: status.pollingUpdateCount,
    pollingErrorMessage: status.lastPollingError?.message ?? null,
  };
}

/**
 * Starts one realtime client for the component lifetime and exposes its
 * connection mode for the operational status UI.
 *
 * The client is created inside an effect keyed by the configured endpoints and
 * cadences, so re-renders never open a new socket, and unmount always stops the
 * socket, the polling loop, and every timer.
 */
export function useRealtimeConnection(
  options: UseRealtimeConnectionOptions,
): RealtimeConnectionView {
  const {
    apiEndpoint,
    wsEndpoint,
    pollingIntervalMs,
    reconnectDelayMs,
    fallbackContext,
    socketFactory,
    scheduler,
    transport,
    onEvent,
    onError,
    onPollingCycle,
  } = options;

  const [status, setStatus] = useState<RealtimeStatus>(INITIAL_STATUS);

  // Callbacks and injected resources are read through refs so changing their
  // identity between renders never tears down the live connection.
  const callbacksRef = useRef({ onEvent, onError, onPollingCycle });
  const injectedRef = useRef({ fallbackContext, socketFactory, scheduler, transport });

  useEffect(() => {
    callbacksRef.current = { onEvent, onError, onPollingCycle };
  }, [onEvent, onError, onPollingCycle]);

  useEffect(() => {
    injectedRef.current = { fallbackContext, socketFactory, scheduler, transport };
  }, [fallbackContext, socketFactory, scheduler, transport]);

  useEffect(() => {
    const injected = injectedRef.current;
    const client = createRealtimeClient({
      wsEndpoint,
      transport: injected.transport ?? createApiClient({ baseEndpoint: apiEndpoint }),
      fallbackContext: injected.fallbackContext,
      pollingIntervalMs,
      reconnectDelayMs,
      socketFactory: injected.socketFactory,
      scheduler: injected.scheduler,
    });

    const unsubscribeStatus = client.subscribeStatus(setStatus);
    const unsubscribeMessage = client.subscribeMessage((envelope) => {
      callbacksRef.current.onEvent?.(envelope);
    });
    const unsubscribeError = client.subscribeError((error) => {
      callbacksRef.current.onError?.(error);
    });
    const unsubscribeCycle = client.subscribePollingCycle((result) => {
      callbacksRef.current.onPollingCycle?.(result);
    });

    client.start();

    return () => {
      // Unsubscribe before stopping so disposal can never schedule a React
      // state update on an unmounted component.
      unsubscribeCycle();
      unsubscribeError();
      unsubscribeMessage();
      unsubscribeStatus();
      client.stop();
    };
  }, [apiEndpoint, wsEndpoint, pollingIntervalMs, reconnectDelayMs]);

  return useMemo(() => toView(status), [status]);
}
