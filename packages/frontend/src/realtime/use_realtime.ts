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
import type { GetDecisionResponse } from '@city-commander/shared-schemas';
import { createApiClient } from '../api/client.js';
import type { ConnectionMode } from '../state/app_state.js';
import type { RealtimeScheduler } from './scheduler.js';
import type {
  PollingCycleResult,
  PollingTransport,
  RealtimeFallbackContext,
} from './polling_fallback.js';
import type { RealtimeEventEnvelope } from './transport_events.js';
import { isReadyEventIdBearingType, createReadyEventDedupCoordinator } from './dedup.js';
import type { ReadyEventOutcome } from './dedup.js';
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
  /**
   * Receives envelopes that carry no canonical `ready_event_id`
   * (`timeline.updated`, `anomaly.detected`, `incident.injected`,
   * `publish.status_changed`, `processing.failed`). These are forwarded as
   * received, repeats included — dedup does not apply to them.
   */
  readonly onEvent?: (envelope: RealtimeEventEnvelope) => void;
  /**
   * Receives one deduplicated commit per unique `ready_event_id`
   * (`decision.fast_path_ready`, `decision.enriched`, `public_alert.ready`,
   * `report.ready`; §13). Called at most once per id for the lifetime of the
   * mounted connection, only after the authoritative `GET /decisions/{id}`
   * read model was fetched successfully. A resent WebSocket event for an
   * already-committed or in-flight id never invokes this callback again.
   */
  readonly onReadyEvent?: (commit: ReadyEventCommit) => void;
  /**
   * Receives the resolved outcome of every `ready_event_id` notification
   * processed by the dedup coordinator, including duplicates, rejections,
   * failures, and disposal — plus the presentation-layer
   * `missing_presentation_handler` guard outcome (see
   * {@link ReadyEventPresentationOutcome}). This is the only way a hook
   * caller observes a dedup result; `processNotification` itself is never
   * awaited by this hook.
   */
  readonly onReadyEventOutcome?: (event: ReadyEventOutcomeEvent) => void;
  /** Receives every typed transport/polling error. */
  readonly onError?: (error: RealtimeError) => void;
  /** Receives every completed fallback polling cycle. */
  readonly onPollingCycle?: (result: PollingCycleResult) => void;
}

/**
 * One effectively-once presentation commit: the triggering envelope plus the
 * authoritative decision read model fetched during reconciliation.
 *
 * `decision` is the authoritative state (§13); `envelope` is only the push
 * notification that requested the refresh, never treated as domain truth.
 */
export interface ReadyEventCommit {
  readonly envelope: RealtimeEventEnvelope;
  readonly decision: GetDecisionResponse;
}

/**
 * Presentation-layer extension of the coordinator's {@link ReadyEventOutcome}.
 *
 * `missing_presentation_handler` is not a coordinator state: it is reported
 * by this hook *before* the coordinator is ever invoked, when no
 * `onReadyEvent` consumer is mounted. The `ready_event_id` in that case is
 * never reserved, never marked `in_flight`, and never marked `committed` — a
 * later redelivery (real or synthetic) can still be processed normally once a
 * handler is provided via rerender.
 */
export type ReadyEventPresentationOutcome = ReadyEventOutcome | 'missing_presentation_handler';

/** One observed dedup/presentation result, delivered to `onReadyEventOutcome`. */
export interface ReadyEventOutcomeEvent {
  readonly outcome: ReadyEventPresentationOutcome;
  /**
   * The identity as reported by the coordinator, or — for
   * `missing_presentation_handler`, where the coordinator was never called —
   * the raw envelope value verbatim, unvalidated. `null` when no identity is
   * available at all.
   */
  readonly readyEventId: string | null;
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
    onReadyEvent,
    onReadyEventOutcome,
    onError,
    onPollingCycle,
  } = options;

  const [status, setStatus] = useState<RealtimeStatus>(INITIAL_STATUS);

  // Callbacks and injected resources are read through refs so changing their
  // identity between renders never tears down the live connection, never
  // recreates the dedup coordinator, and never clears already-seen
  // `ready_event_id`s.
  const callbacksRef = useRef({ onEvent, onReadyEvent, onReadyEventOutcome, onError, onPollingCycle });
  const injectedRef = useRef({ fallbackContext, socketFactory, scheduler, transport });

  useEffect(() => {
    callbacksRef.current = { onEvent, onReadyEvent, onReadyEventOutcome, onError, onPollingCycle };
  }, [onEvent, onReadyEvent, onReadyEventOutcome, onError, onPollingCycle]);

  useEffect(() => {
    injectedRef.current = { fallbackContext, socketFactory, scheduler, transport };
  }, [fallbackContext, socketFactory, scheduler, transport]);

  useEffect(() => {
    const injected = injectedRef.current;
    const resolvedTransport = injected.transport ?? createApiClient({ baseEndpoint: apiEndpoint });

    // One dedup coordinator per mounted realtime lifecycle (§16.4). Created
    // once here, disposed exactly once on unmount below. Reconnect and
    // connected↔polling transitions never touch it, so a `ready_event_id`
    // that already committed during this session stays deduped.
    const dedup = createReadyEventDedupCoordinator();

    // Set once in cleanup. Guards `onReadyEventOutcome` delivery for dedup
    // work that resolves after this effect has already torn down, so a stale
    // closure over `callbacksRef` can never fire once the hook is no longer
    // capable of receiving it.
    let tornDown = false;

    /**
     * Delivers one outcome to `onReadyEventOutcome`, isolated so a throwing
     * observer can never produce an unhandled rejection, corrupt coordinator
     * state, block cleanup, or recursively trigger another outcome (the
     * observer itself is the only thing invoked in this scope).
     */
    function notifyOutcomeSafely(event: ReadyEventOutcomeEvent): void {
      if (tornDown) {
        return;
      }
      try {
        callbacksRef.current.onReadyEventOutcome?.(event);
      } catch {
        // Observer fault is contained; it never re-enters the coordinator or
        // this hook.
      }
    }

    const client = createRealtimeClient({
      wsEndpoint,
      transport: resolvedTransport,
      fallbackContext: injected.fallbackContext,
      pollingIntervalMs,
      reconnectDelayMs,
      socketFactory: injected.socketFactory,
      scheduler: injected.scheduler,
    });

    const unsubscribeStatus = client.subscribeStatus(setStatus);
    const unsubscribeMessage = client.subscribeMessage((envelope) => {
      if (!isReadyEventIdBearingType(envelope.eventType)) {
        // No canonical `ready_event_id` for this event type: forward as
        // received. Dedup applies only to the event types listed in
        // `READY_EVENT_ID_EVENT_TYPES`.
        callbacksRef.current.onEvent?.(envelope);
        return;
      }

      // A ready-event-bearing envelope with no mounted presenter must never
      // reach the coordinator: reserving the id here would let the id commit
      // as a silent no-op (optional chaining swallows the missing handler),
      // permanently discarding a redelivery that a later-mounted handler
      // could otherwise have presented. Capturing the handler once, up
      // front, also fixes a handler that is unmounted *while* this specific
      // notification's reconciliation is still in flight: the captured
      // reference — not a fresh `callbacksRef` read — is what actually runs
      // the commit below.
      const presenter = callbacksRef.current.onReadyEvent;
      if (presenter === undefined) {
        notifyOutcomeSafely({
          outcome: 'missing_presentation_handler',
          readyEventId: envelope.readyEventId,
        });
        return;
      }

      // The coordinator's typed outcome is always observed through
      // `onReadyEventOutcome`; `processNotification` itself never rejects for
      // an expected duplicate, rejection, or failure, and the trailing
      // `.catch` below is a defensive backstop only, isolating this hook from
      // any unexpected coordinator fault rather than surfacing an unhandled
      // rejection.
      void dedup
        .processNotification(
          envelope,
          // Reconciliation reads the authoritative decision read model. The
          // envelope itself only requests the refresh; it is never presented
          // as domain truth.
          async (notified) => {
            if (notified.decisionId === null || notified.decisionId === '') {
              throw new Error('ready_event_id notification missing decision_id for reconciliation');
            }
            const result = await resolvedTransport.getDecision(notified.decisionId);
            if (!result.ok) {
              throw new Error(`authoritative reconciliation failed: ${result.error.code}`);
            }
            return result.data;
          },
          (decision, notified) => {
            presenter({ envelope: notified, decision });
          },
        )
        .then((result) => {
          notifyOutcomeSafely({ outcome: result.outcome, readyEventId: result.readyEventId });
        })
        .catch(() => {
          // Defensive backstop only; see comment above.
        });
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
      // state update on an unmounted component. Dispose the dedup coordinator
      // last so any reconciliation/commit still in flight at teardown can
      // never commit afterward, then mark this effect torn down so its
      // already-in-flight outcome deliveries stop reaching the hook caller.
      unsubscribeCycle();
      unsubscribeError();
      unsubscribeMessage();
      unsubscribeStatus();
      client.stop();
      dedup.dispose();
      tornDown = true;
    };
  }, [apiEndpoint, wsEndpoint, pollingIntervalMs, reconnectDelayMs]);

  return useMemo(() => toView(status), [status]);
}
