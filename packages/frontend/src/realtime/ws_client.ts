/**
 * Realtime WebSocket Client + Connection State Machine (§13, §16.4, §21)
 *
 * Required lifecycle:
 *
 *   connected → (onerror | unexpected close) → polling
 *             → (reconnect opens) → connected, polling stopped
 *
 * Internal states are `idle | connecting | connected | polling | stopped`.
 * The user-facing operational modes stay exactly `connected` and `polling`
 * (see {@link toOperationalMode}).
 *
 * Truth boundary: this client is transport only. Received frames are forwarded
 * verbatim after safe envelope parsing, and HTTP fallback merely re-reads
 * authoritative server state. Nothing here classifies, thresholds, ranks,
 * calculates, or overrides backend/domain truth.
 *
 * TASK-123 boundary: every delivered frame is forwarded, including repeats.
 * No `ready_event_id` set is tracked and no duplicate suppression exists here.
 *
 * @module frontend/realtime/ws_client
 */

import { createBrowserScheduler } from './scheduler.js';
import type { RealtimeScheduler, TimerHandle } from './scheduler.js';
import {
  createDefaultFallbackContext,
  createPollingFallback,
  firstCycleError,
  resolveFallbackPlan,
} from './polling_fallback.js';
import type {
  PollingCycleResult,
  PollingError,
  PollingTransport,
  RealtimeFallbackContext,
} from './polling_fallback.js';
import { parseRealtimeEvent } from './transport_events.js';
import type { RealtimeEventEnvelope, RealtimeTransportError } from './transport_events.js';

// ─── Reconnect Policy ──────────────────────────────────────

/**
 * Reconnect delay default.
 *
 * The authoritative specification fixes the polling cadence (2s, §13/§16.4) but
 * states no reconnect schedule. This is therefore a *frontend transport
 * setting*, not policy truth: a fixed, configurable delay aligned with the
 * required 2-second fallback cadence, so a dropped WebSocket recovers promptly
 * during the live demo. No unbounded exponential backoff.
 */
export const DEFAULT_RECONNECT_DELAY_MS = 2000;

// ─── State ─────────────────────────────────────────────────

/** Internal connection state. */
export type RealtimeConnectionState = 'idle' | 'connecting' | 'connected' | 'polling' | 'stopped';

/** User-facing operational mode (§16.4). */
export type RealtimeOperationalMode = 'connected' | 'polling';

/**
 * Maps internal state to the user-facing operational mode.
 * `null` means no mode has been established yet (before first open, or stopped).
 */
export function toOperationalMode(state: RealtimeConnectionState): RealtimeOperationalMode | null {
  switch (state) {
    case 'connected':
      return 'connected';
    case 'polling':
      return 'polling';
    case 'idle':
    case 'connecting':
    case 'stopped':
      return null;
  }
}

/** Observable client status. */
export interface RealtimeStatus {
  readonly state: RealtimeConnectionState;
  readonly mode: RealtimeOperationalMode | null;
  readonly pollingActive: boolean;
  readonly reconnectScheduled: boolean;
  readonly lastTransportError: RealtimeTransportError | null;
  readonly lastPollingError: PollingError | null;
  /** Cycles that refreshed at least one canonical read target while degraded. */
  readonly pollingUpdateCount: number;
}

/** Typed error surface covering both transport and fallback failures. */
export type RealtimeError =
  | { readonly source: 'transport'; readonly error: RealtimeTransportError }
  | { readonly source: 'polling'; readonly error: PollingError };

// ─── Socket Injection ──────────────────────────────────────

/**
 * Browser-shaped socket surface used by the client. Deliberately a `Pick` of
 * the DOM `WebSocket` so the production path is the native WebSocket and test
 * doubles must match the real handler signatures.
 */
export type RealtimeSocketLike = Pick<
  WebSocket,
  'onopen' | 'onclose' | 'onerror' | 'onmessage' | 'close'
>;

/** Factory for a socket instance. */
export type RealtimeSocketFactory = (url: string) => RealtimeSocketLike;

/** Production factory: the native browser WebSocket. */
export function createBrowserSocket(url: string): RealtimeSocketLike {
  return new WebSocket(url);
}

// ─── Options ───────────────────────────────────────────────

export interface RealtimeClientOptions {
  /** WebSocket endpoint from runtime configuration (ws:/wss:, no credentials). */
  readonly wsEndpoint: string;
  /** Read-only HTTP transport used by the §13 fallback. */
  readonly transport: PollingTransport;
  /** Active fallback context; defaults to the unparameterized live-read set. */
  readonly fallbackContext?: RealtimeFallbackContext;
  /** Polling cadence; defaults to 2000 ms. */
  readonly pollingIntervalMs?: number;
  /** Reconnect delay; defaults to {@link DEFAULT_RECONNECT_DELAY_MS}. */
  readonly reconnectDelayMs?: number;
  /** Socket factory injection point; defaults to the native WebSocket. */
  readonly socketFactory?: RealtimeSocketFactory;
  /** Timer injection point; defaults to the browser scheduler. */
  readonly scheduler?: RealtimeScheduler;
}

export interface RealtimeClient {
  /** Opens exactly one socket. Only effective from the `idle` state. */
  start(): void;
  /** Idempotent teardown of socket, polling loop, timers, and listeners. */
  stop(): void;
  getStatus(): RealtimeStatus;
  subscribeStatus(listener: (status: RealtimeStatus) => void): () => void;
  subscribeMessage(listener: (envelope: RealtimeEventEnvelope) => void): () => void;
  subscribeError(listener: (error: RealtimeError) => void): () => void;
  subscribePollingCycle(listener: (result: PollingCycleResult) => void): () => void;
}

// ─── Endpoint Validation ───────────────────────────────────

function validateWsEndpoint(endpoint: string): RealtimeTransportError | null {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return { code: 'INVALID_ENDPOINT', message: 'WebSocket 端點不是有效的 URL' };
  }
  if (url.protocol !== 'ws:' && url.protocol !== 'wss:') {
    return { code: 'INVALID_ENDPOINT', message: 'WebSocket 端點必須使用 ws: 或 wss: 協定' };
  }
  if (url.username !== '' || url.password !== '') {
    return { code: 'INVALID_ENDPOINT', message: 'WebSocket 端點不得內嵌憑證' };
  }
  return null;
}

// ─── Client ────────────────────────────────────────────────

/**
 * Creates the realtime client.
 *
 * Guarantees:
 * - one socket per connection attempt, never one per render
 * - a socket-generation guard so callbacks from a replaced socket are ignored
 * - polling starts exactly once per degradation period
 * - at most one reconnect timer at a time; reconnect never stops polling
 * - `stop()` is idempotent and leaves no timer, request, socket, or listener
 */
export function createRealtimeClient(options: RealtimeClientOptions): RealtimeClient {
  const scheduler = options.scheduler ?? createBrowserScheduler();
  const socketFactory = options.socketFactory ?? createBrowserSocket;
  const reconnectDelayMs = options.reconnectDelayMs ?? DEFAULT_RECONNECT_DELAY_MS;
  const fallbackContext = options.fallbackContext ?? createDefaultFallbackContext();

  const statusListeners = new Set<(status: RealtimeStatus) => void>();
  const messageListeners = new Set<(envelope: RealtimeEventEnvelope) => void>();
  const errorListeners = new Set<(error: RealtimeError) => void>();
  const cycleListeners = new Set<(result: PollingCycleResult) => void>();

  let state: RealtimeConnectionState = 'idle';
  /** Incremented on every socket creation and invalidation. */
  let socketGeneration = 0;
  let activeSocket: RealtimeSocketLike | null = null;
  let reconnectTimer: TimerHandle | null = null;
  let lastTransportError: RealtimeTransportError | null = null;
  let lastPollingError: PollingError | null = null;
  let pollingUpdateCount = 0;

  function buildStatus(): RealtimeStatus {
    return {
      state,
      mode: toOperationalMode(state),
      pollingActive: polling.isActive(),
      reconnectScheduled: reconnectTimer !== null,
      lastTransportError,
      lastPollingError,
      pollingUpdateCount,
    };
  }

  /**
   * Invokes one subscriber in isolation.
   *
   * A throwing subscriber must never block the remaining subscribers, abort the
   * state machine, prevent reconnect or cleanup, or surface as an unhandled
   * rejection. The thrown value is deliberately swallowed rather than logged,
   * because logging it could leak payloads or stack traces. Nothing is
   * re-emitted, so a throwing error subscriber cannot trigger recursion.
   */
  function notifySafely(notify: () => void): void {
    try {
      notify();
    } catch {
      // Subscriber fault is contained; the transport keeps running.
    }
  }

  function emitStatus(): void {
    const status = buildStatus();
    for (const listener of [...statusListeners]) {
      notifySafely(() => listener(status));
    }
  }

  function emitError(error: RealtimeError): void {
    for (const listener of [...errorListeners]) {
      notifySafely(() => listener(error));
    }
  }

  const polling = createPollingFallback({
    transport: options.transport,
    scheduler,
    intervalMs: options.pollingIntervalMs,
    onCycle: (result: PollingCycleResult) => {
      lastPollingError = firstCycleError(result);
      if (result.succeededCount > 0) {
        pollingUpdateCount += 1;
      }
      for (const listener of [...cycleListeners]) {
        notifySafely(() => listener(result));
      }
      emitStatus();
    },
    onError: (error: PollingError) => {
      emitError({ source: 'polling', error });
    },
  });

  function detachSocket(socket: RealtimeSocketLike): void {
    socket.onopen = null;
    socket.onclose = null;
    socket.onerror = null;
    socket.onmessage = null;
  }

  function cancelReconnect(): void {
    if (reconnectTimer !== null) {
      scheduler.clearTimer(reconnectTimer);
      reconnectTimer = null;
    }
  }

  function startPolling(): void {
    // `start` is a no-op when a loop is already running, so repeated
    // error/close events can never create a second poll loop.
    polling.start(resolveFallbackPlan(fallbackContext));
  }

  function scheduleReconnect(): void {
    if (state === 'stopped' || reconnectTimer !== null) {
      return;
    }
    reconnectTimer = scheduler.setTimer(() => {
      reconnectTimer = null;
      if (state === 'stopped') {
        return;
      }
      // Reconnect attempts run *while polling*: the state stays `polling`
      // until the replacement socket actually opens.
      openSocket();
    }, reconnectDelayMs);
  }

  function handleOpen(generation: number): void {
    if (generation !== socketGeneration || state === 'stopped') {
      return;
    }
    cancelReconnect();
    polling.stop();
    state = 'connected';
    lastTransportError = null;
    lastPollingError = null;
    emitStatus();
  }

  function handleFailure(
    generation: number,
    socket: RealtimeSocketLike,
    error: RealtimeTransportError,
  ): void {
    if (generation !== socketGeneration || state === 'stopped') {
      return;
    }
    // Invalidate this socket so its remaining onerror/onclose callbacks are
    // ignored: repeated events cannot start duplicate poll/reconnect loops.
    socketGeneration += 1;
    detachSocket(socket);
    if (activeSocket === socket) {
      activeSocket = null;
    }
    socket.close();

    lastTransportError = error;
    state = 'polling';
    startPolling();
    scheduleReconnect();
    emitError({ source: 'transport', error });
    emitStatus();
  }

  function handleMessage(generation: number, data: unknown): void {
    if (generation !== socketGeneration || state === 'stopped') {
      return;
    }
    const parsed = parseRealtimeEvent(data);
    if (!parsed.ok) {
      lastTransportError = parsed.error;
      emitError({ source: 'transport', error: parsed.error });
      emitStatus();
      return;
    }
    // TASK-122 forwards every delivery as received. Duplicate handling and
    // effectively-once presentation belong exclusively to TASK-123.
    for (const listener of [...messageListeners]) {
      notifySafely(() => listener(parsed.envelope));
    }
  }

  function openSocket(): void {
    if (state === 'stopped') {
      return;
    }
    const generation = socketGeneration + 1;
    socketGeneration = generation;

    let socket: RealtimeSocketLike;
    try {
      socket = socketFactory(options.wsEndpoint);
    } catch {
      const error: RealtimeTransportError = {
        code: 'SOCKET_ERROR',
        message: '無法建立 WebSocket 連線',
      };
      lastTransportError = error;
      state = 'polling';
      startPolling();
      scheduleReconnect();
      emitError({ source: 'transport', error });
      emitStatus();
      return;
    }

    activeSocket = socket;
    socket.onopen = () => {
      handleOpen(generation);
    };
    socket.onerror = () => {
      handleFailure(generation, socket, {
        code: 'SOCKET_ERROR',
        message: 'WebSocket 連線發生錯誤，已降級為輪詢',
      });
    };
    socket.onclose = (event: CloseEvent) => {
      handleFailure(generation, socket, {
        code: 'UNEXPECTED_CLOSE',
        message: `WebSocket 連線非預期關閉（close code ${event.code}），已降級為輪詢`,
      });
    };
    socket.onmessage = (event: MessageEvent) => {
      const data: unknown = event.data;
      handleMessage(generation, data);
    };
  }

  return {
    start(): void {
      if (state !== 'idle') {
        return;
      }
      const endpointError = validateWsEndpoint(options.wsEndpoint);
      if (endpointError !== null) {
        // Degrade to HTTP reads rather than crashing the SPA. No reconnect is
        // scheduled because the configured endpoint can never open.
        lastTransportError = endpointError;
        state = 'polling';
        startPolling();
        emitError({ source: 'transport', error: endpointError });
        emitStatus();
        return;
      }
      state = 'connecting';
      emitStatus();
      openSocket();
    },

    stop(): void {
      if (state === 'stopped') {
        return;
      }
      state = 'stopped';
      // Invalidate every outstanding socket callback: an intentional stop can
      // never be mistaken for an unexpected disconnect, and stale callbacks
      // cannot restart the client.
      socketGeneration += 1;
      cancelReconnect();
      polling.stop();
      const socket = activeSocket;
      activeSocket = null;
      if (socket !== null) {
        detachSocket(socket);
        socket.close();
      }
      emitStatus();
      statusListeners.clear();
      messageListeners.clear();
      errorListeners.clear();
      cycleListeners.clear();
    },

    getStatus(): RealtimeStatus {
      return buildStatus();
    },

    subscribeStatus(listener: (status: RealtimeStatus) => void): () => void {
      statusListeners.add(listener);
      return () => {
        statusListeners.delete(listener);
      };
    },

    subscribeMessage(listener: (envelope: RealtimeEventEnvelope) => void): () => void {
      messageListeners.add(listener);
      return () => {
        messageListeners.delete(listener);
      };
    },

    subscribeError(listener: (error: RealtimeError) => void): () => void {
      errorListeners.add(listener);
      return () => {
        errorListeners.delete(listener);
      };
    },

    subscribePollingCycle(listener: (result: PollingCycleResult) => void): () => void {
      cycleListeners.add(listener);
      return () => {
        cycleListeners.delete(listener);
      };
    },
  };
}
