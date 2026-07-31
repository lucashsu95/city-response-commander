/**
 * Timeline Playback Controller Hook (§12 GET /timeline, §13 timeline.updated, §16.1)
 *
 * Owns the authoritative timeline state machine for TASK-124:
 *
 *   idle -> loading -> ready | empty | error
 *
 * `GET /timeline` is the only source of authoritative playback truth.
 * WebSocket `timeline.updated` and the TASK-122 polling fallback are both
 * treated strictly as *refresh signals* — neither is ever committed as
 * timeline state directly (§13 architectural rule).
 *
 * Concurrency guarantees implemented here:
 * - at most one active `GET /timeline` request at a time
 * - any refresh signal that arrives while a request is in flight is coalesced
 *   into at most one queued follow-up refresh
 * - a generation counter ensures a late response can never overwrite a newer
 *   result (whether newer because of a later fetch or a direct poll ingestion)
 * - unmount aborts the in-flight request and stops all further state updates
 * - no unhandled promise rejection: every transport call is caught locally
 *
 * @module frontend/timeline/use_timeline_playback
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { RequestOptions, ApiResult } from '../api/client.js';
import {
  decodeTimelineResponse,
  type TimelineDecodeErrorCode,
  type TimelineReadModel,
  type TimelineTimingEvidence,
} from './timeline_model.js';

// ─── Transport Seam ─────────────────────────────────────────

/** Minimal transport contract this controller depends on. */
export interface TimelineTransport {
  getTimeline(options?: RequestOptions): Promise<ApiResult<unknown>>;
}

// ─── Public State Shape ─────────────────────────────────────

export type TimelineControllerStateName =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'empty'
  | 'error'
  | 'disposed';

export type TimelineControllerErrorCode = TimelineDecodeErrorCode | 'REQUEST_FAILED';

export interface TimelineControllerError {
  readonly code: TimelineControllerErrorCode;
  readonly message: string;
}

export interface TimelinePlaybackState {
  readonly state: TimelineControllerStateName;
  /** Server timestamp order, preserved exactly. Never reordered here. */
  readonly timestamps: readonly string[];
  /** Authoritative current playback position from the last successful read. */
  readonly currentTimestamp: string | null;
  /** Local presentation-only selection; always one of `timestamps` or null. */
  readonly selectedTimestamp: string | null;
  readonly selectedIndex: number | null;
  /** `refreshing` while a background refresh is in flight over existing data. */
  readonly refreshStatus: 'idle' | 'refreshing';
  readonly timing: TimelineTimingEvidence | null;
  readonly schemaVersion: string | null;
  readonly traceId: string | null;
  readonly provisional: boolean | null;
  /**
   * Last error. Present alongside `ready`/`empty` when a *background*
   * refresh failed (existing content is preserved); present alongside
   * `error` when no successful read has ever been obtained.
   */
  readonly error: TimelineControllerError | null;
}

function initialState(): TimelinePlaybackState {
  return {
    state: 'idle',
    timestamps: [],
    currentTimestamp: null,
    selectedTimestamp: null,
    selectedIndex: null,
    refreshStatus: 'idle',
    timing: null,
    schemaVersion: null,
    traceId: null,
    provisional: null,
    error: null,
  };
}

function selectedIndexOf(timestamps: readonly string[], selected: string | null): number | null {
  if (selected === null) {
    return null;
  }
  const index = timestamps.indexOf(selected);
  return index === -1 ? null : index;
}

/**
 * Resolves the presentation selection for a freshly loaded model.
 *
 * - keeps the previous selection when it is still present in the new
 *   timestamp list (selection is local presentation state, §Phase 4 rule 9)
 * - otherwise defaults to the authoritative `current` (guaranteed to be one
 *   of `timestamps` for a non-empty model by the decoder's own invariant)
 * - is `null` for an empty timeline
 */
function resolveSelection(model: TimelineReadModel, previousSelection: string | null): string | null {
  if (model.timestamps.length === 0) {
    return null;
  }
  if (previousSelection !== null && model.timestamps.includes(previousSelection)) {
    return previousSelection;
  }
  return model.current;
}

function applyModel(model: TimelineReadModel, previousSelection: string | null): TimelinePlaybackState {
  const selectedTimestamp = resolveSelection(model, previousSelection);
  return {
    state: model.timestamps.length === 0 ? 'empty' : 'ready',
    timestamps: model.timestamps,
    currentTimestamp: model.current,
    selectedTimestamp,
    selectedIndex: selectedIndexOf(model.timestamps, selectedTimestamp),
    refreshStatus: 'idle',
    timing: model.timing,
    schemaVersion: model.schemaVersion,
    traceId: model.traceId,
    provisional: model.provisional,
    error: null,
  };
}

// ─── Hook Options ───────────────────────────────────────────

export interface UseTimelinePlaybackOptions {
  /** Injected transport; production callers pass the TASK-121 API client. */
  readonly transport: TimelineTransport;
}

export interface TimelinePlaybackController extends TimelinePlaybackState {
  /**
   * Requests one authoritative `GET /timeline` refresh. Multiple calls that
   * arrive while a request is already in flight are coalesced into at most
   * one queued follow-up (concurrency rule: never more than one active
   * request, never more than one queued follow-up).
   */
  refresh(): void;
  /**
   * Consumes an already-fetched, not-yet-validated `GET /timeline` payload
   * obtained by the TASK-122 polling fallback's `timeline` target
   * (`PollingCycleResult` outcome with `kind: 'timeline'`). This is the
   * preferred polling integration path: it avoids issuing a second
   * `GET /timeline` request for data the fallback loop already retrieved.
   */
  ingestPolledTimeline(raw: unknown): void;
  /** Selects one timestamp. Ignored (no-op) if it is not in `timestamps`. */
  selectTimestamp(timestamp: string): void;
  /** Moves the selection one step earlier. No-op at the first timestamp. */
  selectPrevious(): void;
  /** Moves the selection one step later. No-op at the last timestamp. */
  selectNext(): void;
}

/**
 * Timeline playback controller (§12/§13/§16.1, TASK-124).
 *
 * One controller instance per mount. Rerenders and callback-identity churn in
 * the caller never recreate it or reset its state; only unmount tears it
 * down (aborting any in-flight request).
 */
export function useTimelinePlayback(options: UseTimelinePlaybackOptions): TimelinePlaybackController {
  const [state, setState] = useState<TimelinePlaybackState>(initialState);

  // Mutable concurrency bookkeeping. Refs, not state: they must never trigger
  // a render on their own and must survive across renders without resetting.
  const transportRef = useRef(options.transport);
  transportRef.current = options.transport;

  const disposedRef = useRef(false);
  const generationRef = useRef(0);
  const inFlightRef = useRef(false);
  const queuedFollowUpRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const everSucceededRef = useRef(false);
  const selectionRef = useRef<string | null>(null);

  const applySafely = useCallback((updater: (previous: TimelinePlaybackState) => TimelinePlaybackState) => {
    if (disposedRef.current) {
      return;
    }
    setState((previous) => {
      const next = updater(previous);
      selectionRef.current = next.selectedTimestamp;
      return next;
    });
  }, []);

  const runFetch = useCallback(() => {
    if (disposedRef.current) {
      return;
    }
    if (inFlightRef.current) {
      // Coalesce: at most one queued follow-up regardless of how many
      // refresh signals arrive during the in-flight request.
      queuedFollowUpRef.current = true;
      return;
    }

    inFlightRef.current = true;
    generationRef.current += 1;
    const generation = generationRef.current;

    const controller = new AbortController();
    abortControllerRef.current = controller;

    const isFirstLoad = !everSucceededRef.current;
    applySafely((previous) =>
      isFirstLoad
        ? { ...previous, state: 'loading', error: null }
        : { ...previous, refreshStatus: 'refreshing' },
    );

    void transportRef.current
      .getTimeline({ signal: controller.signal })
      .then((result) => {
        // A newer refresh (fetch or direct ingestion) has already started or
        // completed: this response is stale and must never overwrite it.
        if (disposedRef.current || generation !== generationRef.current) {
          return;
        }

        if (!result.ok) {
          if (result.error.code === 'ABORTED') {
            // Cancelled by unmount or superseded generation; no state change.
            return;
          }
          const error: TimelineControllerError = {
            code: 'REQUEST_FAILED',
            message: result.error.message,
          };
          applySafely((previous) =>
            everSucceededRef.current
              ? { ...previous, refreshStatus: 'idle', error }
              : { ...previous, state: 'error', refreshStatus: 'idle', error, timestamps: [], currentTimestamp: null, selectedTimestamp: null, selectedIndex: null, timing: null, schemaVersion: null, traceId: null, provisional: null }
          );
          return;
        }

        const decoded = decodeTimelineResponse(result.data);
        if (!decoded.ok) {
          const error: TimelineControllerError = {
            code: decoded.error.code,
            message: decoded.error.message,
          };
          applySafely((previous) =>
            everSucceededRef.current
              ? { ...previous, refreshStatus: 'idle', error }
              : { ...previous, state: 'error', refreshStatus: 'idle', error, timestamps: [], currentTimestamp: null, selectedTimestamp: null, selectedIndex: null, timing: null, schemaVersion: null, traceId: null, provisional: null }
          );
          return;
        }

        everSucceededRef.current = true;
        applySafely((previous) => applyModel(decoded.model, selectionRef.current ?? previous.selectedTimestamp));
      })
      .catch(() => {
        // Defensive backstop: a transport that throws instead of returning a
        // typed ApiResult must never produce an unhandled rejection.
        if (disposedRef.current || generation !== generationRef.current) {
          return;
        }
        const error: TimelineControllerError = {
          code: 'REQUEST_FAILED',
          message: 'GET /timeline 請求發生未預期錯誤',
        };
        applySafely((previous) =>
          everSucceededRef.current
            ? { ...previous, refreshStatus: 'idle', error }
            : { ...previous, state: 'error', refreshStatus: 'idle', error }
        );
      })
      .finally(() => {
        inFlightRef.current = false;
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
        if (disposedRef.current) {
          return;
        }
        if (queuedFollowUpRef.current) {
          queuedFollowUpRef.current = false;
          runFetch();
        }
      });
  }, [applySafely]);

  const refresh = useCallback(() => {
    runFetch();
  }, [runFetch]);

  const ingestPolledTimeline = useCallback(
    (raw: unknown) => {
      if (disposedRef.current) {
        return;
      }
      // A direct ingestion is itself authoritative-fresh data: advance the
      // generation so any in-flight fetch response that resolves afterward is
      // recognized as stale and discarded (never overwrites newer state).
      generationRef.current += 1;

      const decoded = decodeTimelineResponse(raw);
      if (!decoded.ok) {
        const error: TimelineControllerError = {
          code: decoded.error.code,
          message: decoded.error.message,
        };
        applySafely((previous) =>
          everSucceededRef.current
            ? { ...previous, error }
            : { ...previous, state: 'error', error },
        );
        return;
      }

      everSucceededRef.current = true;
      applySafely((previous) => applyModel(decoded.model, selectionRef.current ?? previous.selectedTimestamp));
    },
    [applySafely],
  );

  const selectTimestamp = useCallback(
    (timestamp: string) => {
      applySafely((previous) => {
        if (!previous.timestamps.includes(timestamp)) {
          // Selection must be one of the server-provided timestamps; an
          // unknown value is a no-op, never fabricated or force-accepted.
          return previous;
        }
        return {
          ...previous,
          selectedTimestamp: timestamp,
          selectedIndex: selectedIndexOf(previous.timestamps, timestamp),
        };
      });
    },
    [applySafely],
  );

  const selectPrevious = useCallback(() => {
    applySafely((previous) => {
      if (previous.selectedIndex === null || previous.selectedIndex <= 0) {
        return previous;
      }
      const nextIndex = previous.selectedIndex - 1;
      const nextTimestamp = previous.timestamps[nextIndex] ?? null;
      return { ...previous, selectedTimestamp: nextTimestamp, selectedIndex: nextIndex };
    });
  }, [applySafely]);

  const selectNext = useCallback(() => {
    applySafely((previous) => {
      if (previous.selectedIndex === null || previous.selectedIndex >= previous.timestamps.length - 1) {
        return previous;
      }
      const nextIndex = previous.selectedIndex + 1;
      const nextTimestamp = previous.timestamps[nextIndex] ?? null;
      return { ...previous, selectedTimestamp: nextTimestamp, selectedIndex: nextIndex };
    });
  }, [applySafely]);

  // Mount: exactly one initial fetch. Unmount: abort in-flight work and stop
  // all further state updates (StrictMode-safe: a mount/cleanup/remount cycle
  // creates its own fresh refs per effect invocation).
  useEffect(() => {
    disposedRef.current = false;
    runFetch();

    return () => {
      disposedRef.current = true;
      generationRef.current += 1;
      queuedFollowUpRef.current = false;
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
    };
    // `runFetch` is stable across renders (its own dependency, `applySafely`,
    // has an empty dependency array), so this intentionally mirrors a
    // mount-only effect without needing to defeat the lint rule.
  }, [runFetch]);

  return {
    ...state,
    refresh,
    ingestPolledTimeline,
    selectTimestamp,
    selectPrevious,
    selectNext,
  };
}

/** Re-exported for consumers that need the decoded read model shape. */
export type { TimelineReadModel };
