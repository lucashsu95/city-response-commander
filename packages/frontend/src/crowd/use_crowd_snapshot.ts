/**
 * Crowd Snapshot Controller Hook (§12 `GET /crowd`, §16.1, R8/R9/R11)
 *
 * TASK-126. Owns the `GET /crowd` state machine:
 *
 *   idle -> loading -> ready | empty | insufficient_data | error
 *
 * `GET /crowd` is the only source of crowd truth. A timeline advance (a change
 * of the authoritative replay position, §16.1) is treated strictly as a
 * *refresh signal*: the panel re-reads the route instead of extrapolating the
 * previous snapshot forward.
 *
 * The route is requested through the injected TASK-121 client's
 * `getReadOnlyJson` seam and validated by `decodeCrowdResponse`. It is not
 * requested through `getCrowd()`, because that method is typed against the
 * older `GetCrowdResponse` shape in `@city-commander/shared-schemas`
 * (lowercase `bs_id`/`user_count`, no per-station provenance, no `flags`
 * vocabulary), which the live handler no longer emits. Decoding `unknown` keeps
 * the panel honest about the actual wire payload without editing the
 * TASK-121-owned client or inventing a second canonical contract here.
 *
 * Concurrency guarantees (same rules as TASK-124's timeline controller):
 * - at most one in-flight request, with at most one coalesced follow-up
 * - a generation counter prevents a late response from overwriting a newer one
 * - unmount aborts the in-flight request and stops all further state updates
 * - every transport call is caught locally: no unhandled rejection
 *
 * @module frontend/crowd/use_crowd_snapshot
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApiResult, RequestOptions } from '../api/client.js';
import { decodeCrowdResponse } from './crowd_model.js';
import type {
  CrowdDecodeErrorCode,
  CrowdPolicyView,
  CrowdReadModel,
  CrowdStationRow,
  MultilingualScopeSummary,
} from './crowd_model.js';

// ─── Transport Seam ─────────────────────────────────────────

/** The `crowd` route fragment, resolved against the injected API endpoint. */
const CROWD_ROUTE = 'crowd';

/** Minimal transport contract this controller depends on. */
export interface CrowdTransport {
  getReadOnlyJson(path: string, options?: RequestOptions): Promise<ApiResult<unknown>>;
}

// ─── Public State Shape ─────────────────────────────────────

export type CrowdControllerStateName =
  'idle' | 'loading' | 'ready' | 'empty' | 'insufficient_data' | 'error';

export type CrowdControllerErrorCode = CrowdDecodeErrorCode | 'REQUEST_FAILED';

export interface CrowdControllerError {
  readonly code: CrowdControllerErrorCode;
  readonly message: string;
}

export interface CrowdSnapshotState {
  readonly state: CrowdControllerStateName;
  /** Stations exactly as returned; never reordered, filtered, or padded. */
  readonly stations: readonly CrowdStationRow[];
  /** Scope-level SOP-6 truth. `null` when the backend supplied none. */
  readonly multilingual: MultilingualScopeSummary | null;
  /** Provisional-policy metadata projection (§10.6). `null` when absent. */
  readonly policy: CrowdPolicyView | null;
  /** Replay position the per-station staleness refers to. */
  readonly decisionCutoffTimestamp: string | null;
  /** Backend STOP reason, only meaningful with `insufficient_data`. */
  readonly stopReason: string | null;
  readonly provisional: boolean | null;
  readonly schemaVersion: string | null;
  readonly traceId: string | null;
  /** `refreshing` while a background re-read is in flight over existing data. */
  readonly refreshStatus: 'idle' | 'refreshing';
  /**
   * Last error. Alongside `ready`/`empty`/`insufficient_data` it means a
   * *background* refresh failed and the previous content is preserved;
   * alongside `error` it means no successful read has ever been obtained.
   */
  readonly error: CrowdControllerError | null;
}

export interface CrowdSnapshotController extends CrowdSnapshotState {
  /** Requests one authoritative `GET /crowd` re-read. */
  refresh(): void;
}

function initialState(): CrowdSnapshotState {
  return {
    state: 'idle',
    stations: [],
    multilingual: null,
    policy: null,
    decisionCutoffTimestamp: null,
    stopReason: null,
    provisional: null,
    schemaVersion: null,
    traceId: null,
    refreshStatus: 'idle',
    error: null,
  };
}

/**
 * Maps a decoded model onto the controller state.
 *
 * The three success states are distinguished by backend truth only:
 * - envelope `insufficient_data` → `insufficient_data` (a STOP, not an error)
 * - `ready` with no stations → `empty`
 * - `ready` with stations → `ready`
 */
function applyModel(model: CrowdReadModel): CrowdSnapshotState {
  const state: CrowdControllerStateName =
    model.dataStatus === 'insufficient_data'
      ? 'insufficient_data'
      : model.stations.length === 0
        ? 'empty'
        : 'ready';

  return {
    state,
    stations: model.stations,
    multilingual: model.multilingual,
    policy: model.policy,
    decisionCutoffTimestamp: model.decisionCutoffTimestamp,
    stopReason: model.stopReason,
    provisional: model.provisional,
    schemaVersion: model.schemaVersion,
    traceId: model.traceId,
    refreshStatus: 'idle',
    error: null,
  };
}

// ─── Hook ────────────────────────────────────────────────────

export interface UseCrowdSnapshotOptions {
  /** Injected transport; production callers pass the TASK-121 API client. */
  readonly transport: CrowdTransport;
  /**
   * Authoritative replay position from the timeline controller (§16.1). A
   * change triggers one refresh. Presentation-only here: it is never sent as a
   * query parameter the backend does not define, and never used to reinterpret
   * an already-loaded snapshot.
   */
  readonly replayPosition?: string | null;
}

/**
 * Crowd snapshot controller (TASK-126).
 *
 * One controller instance per mount: rerenders never reset it, only unmount
 * tears it down (aborting any in-flight request).
 */
export function useCrowdSnapshot(options: UseCrowdSnapshotOptions): CrowdSnapshotController {
  const [state, setState] = useState<CrowdSnapshotState>(initialState);

  const transportRef = useRef(options.transport);
  transportRef.current = options.transport;

  const disposedRef = useRef(false);
  const generationRef = useRef(0);
  const inFlightRef = useRef(false);
  const queuedFollowUpRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const everSucceededRef = useRef(false);

  const applySafely = useCallback(
    (updater: (previous: CrowdSnapshotState) => CrowdSnapshotState) => {
      if (disposedRef.current) return;
      setState(updater);
    },
    [],
  );

  const failureState = useCallback(
    (previous: CrowdSnapshotState, error: CrowdControllerError): CrowdSnapshotState =>
      everSucceededRef.current
        ? // Background failure: keep the last successful snapshot on screen and
          // surface the failure beside it, so the operator never loses context.
          { ...previous, refreshStatus: 'idle', error }
        : { ...initialState(), state: 'error', error },
    [],
  );

  const runFetch = useCallback(() => {
    if (disposedRef.current) return;
    if (inFlightRef.current) {
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
      .getReadOnlyJson(CROWD_ROUTE, { signal: controller.signal })
      .then((result) => {
        if (disposedRef.current || generation !== generationRef.current) return;

        if (!result.ok) {
          if (result.error.code === 'ABORTED') return;
          const error: CrowdControllerError = {
            code: 'REQUEST_FAILED',
            message: result.error.message,
          };
          applySafely((previous) => failureState(previous, error));
          return;
        }

        const decoded = decodeCrowdResponse(result.data);
        if (!decoded.ok) {
          const error: CrowdControllerError = {
            code: decoded.error.code,
            message: decoded.error.message,
          };
          applySafely((previous) => failureState(previous, error));
          return;
        }

        everSucceededRef.current = true;
        applySafely(() => applyModel(decoded.model));
      })
      .catch(() => {
        // Defensive backstop: a transport that throws instead of returning a
        // typed ApiResult must never produce an unhandled rejection.
        if (disposedRef.current || generation !== generationRef.current) return;
        const error: CrowdControllerError = {
          code: 'REQUEST_FAILED',
          message: 'GET /crowd 請求發生未預期錯誤',
        };
        applySafely((previous) => failureState(previous, error));
      })
      .finally(() => {
        inFlightRef.current = false;
        if (abortControllerRef.current === controller) {
          abortControllerRef.current = null;
        }
        if (disposedRef.current) return;
        if (queuedFollowUpRef.current) {
          queuedFollowUpRef.current = false;
          runFetch();
        }
      });
  }, [applySafely, failureState]);

  const refresh = useCallback(() => {
    runFetch();
  }, [runFetch]);

  // Lifecycle only: reset on mount, abort and freeze on unmount. Kept separate
  // from the fetch effect below so a replay-position change never disposes the
  // controller.
  useEffect(() => {
    disposedRef.current = false;
    return () => {
      disposedRef.current = true;
      generationRef.current += 1;
      queuedFollowUpRef.current = false;
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
    };
  }, []);

  // One read on mount, then one per timeline advance (§16.1).
  useEffect(() => {
    runFetch();
  }, [runFetch, options.replayPosition]);

  return { ...state, refresh };
}
