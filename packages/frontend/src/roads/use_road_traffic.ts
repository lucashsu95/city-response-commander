/**
 * Road Traffic Controller Hook (§12 GET /roads, §16, §22.1 P7, TASK-125)
 *
 * Owns the road-segment read state machine:
 *
 *   idle -> loading -> ready | empty | insufficient | error
 *
 * `GET /roads` is the only source of authoritative road/traffic truth. The
 * TASK-124 authoritative timeline `currentTimestamp` is a *refresh signal*
 * only — advancing it triggers one road refresh, but its value is never sent
 * as a query parameter (design §12 defines no timestamp parameter for
 * `GET /roads`) and is never substituted for a missing observation timestamp.
 *
 * Concurrency guarantees implemented here, mirroring
 * `timeline/use_timeline_playback.ts`:
 * - at most one active `GET /roads` request at a time
 * - any refresh signal that arrives while a request is in flight is coalesced
 *   into at most one queued follow-up refresh
 * - a generation counter ensures a late response (fetch or direct polling
 *   ingestion) can never overwrite a newer result
 * - unmount aborts the in-flight request and stops all further state updates
 * - no unhandled promise rejection: every transport call is caught locally
 *
 * This controller computes nothing: no threshold comparison, no A/B
 * classification, no staleness calculation, no anomaly/route/ETE truth.
 *
 * @module frontend/roads/use_road_traffic
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { RequestOptions, ApiResult } from '../api/client.js';
import { decodeRoadsResponse, type RoadDecodeErrorCode, type RoadReadModel } from './road_model.js';

// ─── Transport Seam ─────────────────────────────────────────

/** Minimal transport contract this controller depends on. */
export interface RoadTransport {
  getRoads(options?: RequestOptions): Promise<ApiResult<unknown>>;
}

// ─── Public State Shape ─────────────────────────────────────

export type RoadControllerStateName =
  'idle' | 'loading' | 'ready' | 'empty' | 'insufficient' | 'error' | 'disposed';

export type RoadControllerErrorCode = RoadDecodeErrorCode | 'REQUEST_FAILED';

export interface RoadControllerError {
  readonly code: RoadControllerErrorCode;
  readonly message: string;
}

export interface RoadTrafficState {
  readonly state: RoadControllerStateName;
  readonly model: RoadReadModel | null;
  /** `refreshing` while a background refresh is in flight over existing data. */
  readonly refreshStatus: 'idle' | 'refreshing';
  /**
   * Last error. Present alongside `ready`/`empty`/`insufficient` when a
   * *background* refresh failed (existing content is preserved); present
   * alongside `error` when no successful read has ever been obtained.
   */
  readonly error: RoadControllerError | null;
}

function initialState(): RoadTrafficState {
  return {
    state: 'idle',
    model: null,
    refreshStatus: 'idle',
    error: null,
  };
}

/**
 * Resolves the state name for a freshly decoded model.
 *
 * - `insufficient` when the response-level `data_status` is explicitly
 *   `'insufficient_data'` (backend truth, never inferred from an empty array)
 * - `empty` when the backend returned zero segments
 * - `ready` otherwise
 */
function stateNameForModel(model: RoadReadModel): 'ready' | 'empty' | 'insufficient' {
  if (model.dataStatus === 'insufficient_data') {
    return 'insufficient';
  }
  if (model.segments.length === 0) {
    return 'empty';
  }
  return 'ready';
}

function applyModel(model: RoadReadModel): RoadTrafficState {
  return {
    state: stateNameForModel(model),
    model,
    refreshStatus: 'idle',
    error: null,
  };
}

// ─── Hook Options ───────────────────────────────────────────

export interface UseRoadTrafficOptions {
  /** Injected transport; production callers pass the TASK-121 API client. */
  readonly transport: RoadTransport;
}

export interface RoadTrafficController extends RoadTrafficState {
  /**
   * Requests one authoritative `GET /roads` refresh. Multiple calls that
   * arrive while a request is already in flight are coalesced into at most
   * one queued follow-up.
   */
  refresh(): void;
  /**
   * Consumes an already-fetched, not-yet-validated `GET /roads` payload
   * obtained by the TASK-122 polling fallback's `roads` target
   * (`PollingCycleResult` outcome with `kind: 'roads'`). Preferred polling
   * integration path: avoids a second `GET /roads` request for data the
   * fallback loop already retrieved.
   */
  ingestPolledRoads(raw: unknown): void;
}

/**
 * Road traffic controller (§12/§16/§22.1 P7, TASK-125).
 *
 * One controller instance per mount. Rerenders and callback-identity churn in
 * the caller never recreate it or reset its state; only unmount tears it
 * down (aborting any in-flight request).
 */
export function useRoadTraffic(options: UseRoadTrafficOptions): RoadTrafficController {
  const [state, setState] = useState<RoadTrafficState>(initialState);

  const transportRef = useRef(options.transport);
  transportRef.current = options.transport;

  const disposedRef = useRef(false);
  const generationRef = useRef(0);
  const inFlightRef = useRef(false);
  const queuedFollowUpRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const everSucceededRef = useRef(false);

  const applySafely = useCallback((updater: (previous: RoadTrafficState) => RoadTrafficState) => {
    if (disposedRef.current) {
      return;
    }
    setState(updater);
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
      .getRoads({ signal: controller.signal })
      .then((result) => {
        // A newer refresh (fetch or direct ingestion) has already started or
        // completed: this response is stale and must never overwrite it.
        if (disposedRef.current || generation !== generationRef.current) {
          return;
        }

        if (!result.ok) {
          if (result.error.code === 'ABORTED') {
            return;
          }
          const error: RoadControllerError = {
            code: 'REQUEST_FAILED',
            message: result.error.message,
          };
          applySafely((previous) =>
            everSucceededRef.current
              ? { ...previous, refreshStatus: 'idle', error }
              : { state: 'error', model: null, refreshStatus: 'idle', error },
          );
          return;
        }

        const decoded = decodeRoadsResponse(result.data);
        if (!decoded.ok) {
          const error: RoadControllerError = {
            code: decoded.error.code,
            message: decoded.error.message,
          };
          applySafely((previous) =>
            everSucceededRef.current
              ? { ...previous, refreshStatus: 'idle', error }
              : { state: 'error', model: null, refreshStatus: 'idle', error },
          );
          return;
        }

        everSucceededRef.current = true;
        applySafely(() => applyModel(decoded.model));
      })
      .catch(() => {
        // Defensive backstop: a transport that throws instead of returning a
        // typed ApiResult must never produce an unhandled rejection.
        if (disposedRef.current || generation !== generationRef.current) {
          return;
        }
        const error: RoadControllerError = {
          code: 'REQUEST_FAILED',
          message: 'GET /roads 請求發生未預期錯誤',
        };
        applySafely((previous) =>
          everSucceededRef.current
            ? { ...previous, refreshStatus: 'idle', error }
            : { state: 'error', model: null, refreshStatus: 'idle', error },
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

  const ingestPolledRoads = useCallback(
    (raw: unknown) => {
      if (disposedRef.current) {
        return;
      }
      // A direct ingestion is itself authoritative-fresh data: advance the
      // generation so any in-flight fetch response that resolves afterward is
      // recognized as stale and discarded (never overwrites newer state).
      generationRef.current += 1;

      const decoded = decodeRoadsResponse(raw);
      if (!decoded.ok) {
        const error: RoadControllerError = {
          code: decoded.error.code,
          message: decoded.error.message,
        };
        applySafely((previous) =>
          everSucceededRef.current
            ? { ...previous, error }
            : { state: 'error', model: null, refreshStatus: 'idle', error },
        );
        return;
      }

      everSucceededRef.current = true;
      applySafely(() => applyModel(decoded.model));
    },
    [applySafely],
  );

  // Mount: exactly one initial fetch. Unmount: abort in-flight work and stop
  // all further state updates.
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
  }, [runFetch]);

  return {
    ...state,
    refresh,
    ingestPolledRoads,
  };
}
