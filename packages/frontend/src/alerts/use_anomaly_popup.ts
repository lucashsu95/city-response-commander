/**
 * Anomaly Popup Controller (TASK-127)
 *
 * The single presentation controller for the anomaly auto-popup. It owns only
 * presentation state; it owns no transport of any kind.
 *
 * Explicitly absent, by design (§9 「決定性 > AI」, TASK-127 scope):
 * `fetch`, `setInterval`, `new WebSocket`, `Date.now`, threshold arithmetic,
 * Bedrock, route/ETE derivation, multilingual generation, incident injection,
 * publish, and execution flow. The dashboard hands this controller data that
 * the TASK-122 realtime connection and its polling fallback already obtained,
 * so enabling the popup adds zero HTTP requests and zero sockets.
 *
 * Two independent gates decide whether a popup opens, matching the TASK-127
 * transition and dedup rules:
 *
 * 1. **Signal transition** (polling channels only). A popup fires on
 *    `none|inactive -> active` and never on `active -> active`. `active ->
 *    inactive` re-arms the channel. An `unknown` reading — a malformed payload,
 *    an unrecognized classification, or `insufficient_data` with no explicit
 *    active verdict — preserves the previous state and is never read as
 *    `inactive`. A failed request never reaches this controller at all, so it
 *    also preserves state.
 *
 * 2. **Identity dedup** (all channels). A presented identity is remembered, so
 *    a resent WebSocket frame, a repeated polling sample, the same anomaly
 *    arriving over both channels, or an ordinary React rerender cannot reopen
 *    it. Dismissing keeps the identity remembered. Re-arming a channel forgets
 *    the identity that channel presented, so a genuine recurrence can open
 *    again.
 *
 * @module frontend/alerts/use_anomaly_popup
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { RealtimeEventEnvelope } from '../realtime/transport_events.js';
import {
  decodePolledCrowdAnomaly,
  decodePolledRoadsAnomaly,
  decodeRealtimeAnomaly,
} from './anomaly_model.js';
import type {
  AnomalyChannel,
  AnomalyPresentation,
  PolledAnomalyDecodeResult,
  ServerSignalState,
} from './anomaly_model.js';

// ─── Public Surface ──────────────────────────────────────────

export interface AnomalyPopupState {
  /** Anomaly currently presented, or the last one after dismissal. */
  readonly current: AnomalyPresentation | null;
  /** `true` while the popup should be on screen. */
  readonly isOpen: boolean;
}

export interface AnomalyPopupController extends AnomalyPopupState {
  /**
   * Consumes one realtime envelope. Non-anomaly event types are ignored, so
   * the dashboard can forward every envelope unconditionally.
   */
  ingestRealtimeEvent(envelope: RealtimeEventEnvelope): void;
  /** Consumes an already-fetched `GET /roads` body. Issues no request. */
  ingestPolledRoads(raw: unknown): void;
  /** Consumes an already-fetched `GET /crowd` body. Issues no request. */
  ingestPolledCrowd(raw: unknown): void;
  /** Closes the popup without forgetting the identity that opened it. */
  dismiss(): void;
}

interface ChannelTracking {
  readonly signal: ServerSignalState;
  /** Identity this channel most recently presented, for re-arm bookkeeping. */
  readonly lastIdentity: string | null;
}

function initialChannelTracking(): Record<AnomalyChannel, ChannelTracking> {
  return {
    roads: { signal: 'unknown', lastIdentity: null },
    crowd: { signal: 'unknown', lastIdentity: null },
  };
}

const CLOSED_STATE: AnomalyPopupState = { current: null, isOpen: false };

// ─── Hook ────────────────────────────────────────────────────

/**
 * Creates the anomaly popup controller for one mount.
 *
 * Every ingest function and `dismiss` is referentially stable for the lifetime
 * of the mount, so passing them into the realtime connection's callbacks never
 * changes those callbacks' identity and therefore never tears down the socket
 * or restarts the polling loop.
 */
export function useAnomalyPopup(): AnomalyPopupController {
  const [state, setState] = useState<AnomalyPopupState>(CLOSED_STATE);

  /** Identities already shown at least once during this mount. */
  const presentedRef = useRef<Set<string>>(new Set<string>());
  const channelsRef = useRef<Record<AnomalyChannel, ChannelTracking>>(initialChannelTracking());
  const disposedRef = useRef(false);

  // Freeze the controller on unmount so a late polling cycle or socket frame
  // resolving after teardown can never schedule a state update.
  useEffect(() => {
    disposedRef.current = false;
    return () => {
      disposedRef.current = true;
    };
  }, []);

  /**
   * Opens the popup for a not-yet-presented identity.
   *
   * @returns `true` when this call actually opened the popup.
   */
  const presentIfNew = useCallback((presentation: AnomalyPresentation): boolean => {
    if (disposedRef.current) {
      return false;
    }
    if (presentedRef.current.has(presentation.identity)) {
      return false;
    }
    presentedRef.current.add(presentation.identity);
    setState({ current: presentation, isOpen: true });
    return true;
  }, []);

  /** Applies the §8 transition rules for one polling channel. */
  const ingestChannel = useCallback(
    (channel: AnomalyChannel, decoded: PolledAnomalyDecodeResult): void => {
      if (disposedRef.current) {
        return;
      }

      // Fail closed: a malformed payload is not evidence of anything, least of
      // all of "no anomaly". Leave every tracked value untouched.
      if (decoded.kind === 'malformed') {
        return;
      }

      const { signal, presentation } = decoded.reading;
      const tracked = channelsRef.current[channel];

      if (signal === 'unknown') {
        return;
      }

      if (signal === 'inactive') {
        if (tracked.signal === 'active' && tracked.lastIdentity !== null) {
          // Re-arm: the backend says this channel recovered, so a later
          // recurrence — even with the same identity — may open again.
          presentedRef.current.delete(tracked.lastIdentity);
        }
        channelsRef.current[channel] = { signal: 'inactive', lastIdentity: null };
        return;
      }

      // signal === 'active'
      if (tracked.signal === 'active') {
        // Sustained anomaly: the backend is repeating a verdict already shown.
        return;
      }

      channelsRef.current[channel] = {
        signal: 'active',
        lastIdentity: presentation?.identity ?? null,
      };

      if (presentation !== null) {
        presentIfNew(presentation);
      }
    },
    [presentIfNew],
  );

  const ingestRealtimeEvent = useCallback(
    (envelope: RealtimeEventEnvelope): void => {
      if (disposedRef.current) {
        return;
      }
      const decoded = decodeRealtimeAnomaly(envelope);
      // `ignored` (another §13 event type) and `malformed` (a frame that does
      // not match the canonical contract) both leave state untouched.
      if (decoded.kind !== 'anomaly') {
        return;
      }
      presentIfNew(decoded.presentation);
    },
    [presentIfNew],
  );

  const ingestPolledRoads = useCallback(
    (raw: unknown): void => {
      ingestChannel('roads', decodePolledRoadsAnomaly(raw));
    },
    [ingestChannel],
  );

  const ingestPolledCrowd = useCallback(
    (raw: unknown): void => {
      ingestChannel('crowd', decodePolledCrowdAnomaly(raw));
    },
    [ingestChannel],
  );

  const dismiss = useCallback((): void => {
    if (disposedRef.current) {
      return;
    }
    // The identity stays in `presentedRef`, so the same anomaly cannot bounce
    // straight back onto the screen.
    setState((previous) => (previous.isOpen ? { ...previous, isOpen: false } : previous));
  }, []);

  return {
    current: state.current,
    isOpen: state.isOpen,
    ingestRealtimeEvent,
    ingestPolledRoads,
    ingestPolledCrowd,
    dismiss,
  };
}
