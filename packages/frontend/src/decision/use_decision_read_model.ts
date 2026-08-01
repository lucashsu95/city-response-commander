/**
 * Decision Read Model Controller Hook
 * (§12 `GET /decisions/{decision_id}`, §13, §16, §10.11c)
 *
 * TASK-132. Owns the decision read-model state machine:
 *
 *   idle -> loading -> ready | partial | insufficient_data | error
 *
 * `idle` is the no-decision state: until a `decision_id` exists there is
 * nothing authoritative to show, and the panels render an explicit
 * "no decision yet" state rather than an empty report.
 *
 * Two refresh paths, both treating the WebSocket frame strictly as a
 * *notification* (§13):
 *
 * - `refresh()` — re-reads `GET /decisions/{decision_id}`. Used on mount, on a
 *   `decision_id` change, and whenever a decision-scoped event arrives that
 *   carries no authoritative body (`publish.status_changed`,
 *   `processing.failed`).
 * - `ingestDecisionPayload(body)` — accepts an already-fetched authoritative
 *   body. The TASK-123 dedup coordinator reconciles every `ready_event_id`
 *   notification (`decision.fast_path_ready`, `decision.enriched`,
 *   `report.ready`, `public_alert.ready`) by fetching `GET /decisions/{id}`
 *   itself; consuming that body avoids a second request for the same state,
 *   exactly as TASK-124's `ingestPolledTimeline` does for the polling loop.
 *   The body is still validated by {@link decodeDecisionReadModel} — an
 *   already-fetched payload is not a trusted payload.
 *
 * The route is requested through the injected TASK-121 client's
 * `getReadOnlyJson` seam rather than `getDecision()`, because that method is
 * typed against the stale `GetDecisionResponse` in
 * `@city-commander/shared-schemas` (see the drift list in
 * `decision_read_model.ts`). Decoding `unknown` keeps the panels honest about
 * the actual wire payload without editing the TASK-121-owned client.
 *
 * Concurrency guarantees match TASK-124/TASK-126:
 * - at most one in-flight request, with at most one coalesced follow-up
 * - a generation counter prevents a late response overwriting a newer one
 * - unmount aborts the in-flight request and stops all further state updates
 * - every transport call is caught locally: no unhandled rejection
 *
 * @module frontend/decision/use_decision_read_model
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { ApiResult, RequestOptions } from '../api/client.js';
import { decodeDecisionReadModel } from './decision_read_model.js';
import type {
  DecisionCoreView,
  DecisionDataStatus,
  DecisionDecodeErrorCode,
  DecisionReadModel,
  ExecutionSummaryView,
  ExplanationNarrativeView,
  PublicAlertNarrativeView,
  PublishRecordView,
  ReportNarrativeView,
} from './decision_read_model.js';

// ─── Transport Seam ─────────────────────────────────────────

/** Minimal transport contract this controller depends on. */
export interface DecisionTransport {
  getReadOnlyJson(path: string, options?: RequestOptions): Promise<ApiResult<unknown>>;
}

/** Builds the `decisions/{id}` route fragment with the id percent-encoded. */
export function decisionRoute(decisionId: string): string {
  return `decisions/${encodeURIComponent(decisionId)}`;
}

// ─── Public State Shape ─────────────────────────────────────

export type DecisionControllerStateName =
  'idle' | 'loading' | 'ready' | 'partial' | 'insufficient_data' | 'error';

export type DecisionControllerErrorCode = DecisionDecodeErrorCode | 'REQUEST_FAILED';

export interface DecisionControllerError {
  readonly code: DecisionControllerErrorCode;
  readonly message: string;
}

export interface DecisionReadModelState {
  readonly state: DecisionControllerStateName;
  /** The decision this state describes, or `null` while idle. */
  readonly decisionId: string | null;
  readonly dataStatus: DecisionDataStatus | null;
  readonly core: DecisionCoreView | null;
  readonly report: ReportNarrativeView | null;
  readonly alert: PublicAlertNarrativeView | null;
  readonly explanation: ExplanationNarrativeView | null;
  readonly missingNarrativeTypes: readonly string[];
  readonly publish: PublishRecordView | null;
  readonly execution: ExecutionSummaryView | null;
  readonly policyVersion: string | null;
  readonly provisional: boolean | null;
  readonly schemaVersion: string | null;
  readonly traceId: string | null;
  readonly sourceManifestHash: string | null;
  /** `refreshing` while a background re-read is in flight over existing data. */
  readonly refreshStatus: 'idle' | 'refreshing';
  /**
   * Last error. Alongside a success state it means a *background* refresh
   * failed and the previous content is preserved; alongside `error` it means no
   * successful read has ever been obtained for this decision.
   */
  readonly error: DecisionControllerError | null;
}

export interface DecisionReadModelController extends DecisionReadModelState {
  /** Requests one authoritative `GET /decisions/{decision_id}` re-read. */
  refresh(): void;
  /**
   * Applies an authoritative body already fetched by the TASK-123 dedup
   * reconciler. Validated before use; a malformed body is reported like any
   * other decode failure and never replaces good content with a blank panel.
   */
  ingestDecisionPayload(body: unknown): void;
}

function initialState(): DecisionReadModelState {
  return {
    state: 'idle',
    decisionId: null,
    dataStatus: null,
    core: null,
    report: null,
    alert: null,
    explanation: null,
    missingNarrativeTypes: [],
    publish: null,
    execution: null,
    policyVersion: null,
    provisional: null,
    schemaVersion: null,
    traceId: null,
    sourceManifestHash: null,
    refreshStatus: 'idle',
    error: null,
  };
}

/**
 * Maps a decoded model onto the controller state.
 *
 * The success state is backend truth only: `partial` (deterministic core
 * present, some AI text pending) is a first-class state, never smoothed into
 * `ready`, so the panels can label their template fallbacks honestly.
 */
function applyModel(model: DecisionReadModel): DecisionReadModelState {
  const state: DecisionControllerStateName =
    model.dataStatus === 'insufficient_data'
      ? 'insufficient_data'
      : model.dataStatus === 'partial'
        ? 'partial'
        : 'ready';

  return {
    state,
    decisionId: model.decisionId,
    dataStatus: model.dataStatus,
    core: model.core,
    report: model.report,
    alert: model.alert,
    explanation: model.explanation,
    missingNarrativeTypes: model.missingNarrativeTypes,
    publish: model.publish,
    execution: model.execution,
    policyVersion: model.policyVersion,
    provisional: model.provisional,
    schemaVersion: model.schemaVersion,
    traceId: model.traceId,
    sourceManifestHash: model.sourceManifestHash,
    refreshStatus: 'idle',
    error: null,
  };
}

// ─── Hook ────────────────────────────────────────────────────

export interface UseDecisionReadModelOptions {
  /** Injected transport; production callers pass the TASK-121 API client. */
  readonly transport: DecisionTransport;
  /**
   * The decision to read. `null` until an injection or a realtime event has
   * identified one; the controller then stays `idle` and issues no request.
   */
  readonly decisionId: string | null;
}

/**
 * Decision read-model controller (TASK-132).
 *
 * One controller instance per mount. A `decisionId` change resets the view to
 * `loading` for the new decision instead of showing the previous decision's
 * core under the new id.
 */
export function useDecisionReadModel(
  options: UseDecisionReadModelOptions,
): DecisionReadModelController {
  const [state, setState] = useState<DecisionReadModelState>(initialState);

  const transportRef = useRef(options.transport);
  transportRef.current = options.transport;

  const decisionIdRef = useRef(options.decisionId);
  decisionIdRef.current = options.decisionId;

  const disposedRef = useRef(false);
  const generationRef = useRef(0);
  const inFlightRef = useRef(false);
  const queuedFollowUpRef = useRef(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  /** Reset per decision: a new decision has no successful read of its own. */
  const everSucceededRef = useRef(false);

  const applySafely = useCallback(
    (updater: (previous: DecisionReadModelState) => DecisionReadModelState) => {
      if (disposedRef.current) return;
      setState(updater);
    },
    [],
  );

  const failureState = useCallback(
    (previous: DecisionReadModelState, error: DecisionControllerError): DecisionReadModelState =>
      everSucceededRef.current
        ? // Background failure: keep the last successful read model on screen
          // and surface the failure beside it, so the commander never loses
          // the deterministic facts already displayed.
          { ...previous, refreshStatus: 'idle', error }
        : {
            ...initialState(),
            state: 'error',
            decisionId: decisionIdRef.current,
            error,
          },
    [],
  );

  const applyDecodedBody = useCallback(
    (body: unknown) => {
      const decoded = decodeDecisionReadModel(body);
      if (!decoded.ok) {
        const error: DecisionControllerError = {
          code: decoded.error.code,
          message: decoded.error.message,
        };
        applySafely((previous) => failureState(previous, error));
        return;
      }
      everSucceededRef.current = true;
      applySafely(() => applyModel(decoded.model));
    },
    [applySafely, failureState],
  );

  const runFetch = useCallback(() => {
    if (disposedRef.current) return;
    const decisionId = decisionIdRef.current;
    if (decisionId === null || decisionId === '') return;

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
        ? { ...previous, state: 'loading', decisionId, error: null }
        : { ...previous, refreshStatus: 'refreshing' },
    );

    void transportRef.current
      .getReadOnlyJson(decisionRoute(decisionId), { signal: controller.signal })
      .then((result) => {
        if (disposedRef.current || generation !== generationRef.current) return;

        if (!result.ok) {
          if (result.error.code === 'ABORTED') return;
          applySafely((previous) =>
            failureState(previous, { code: 'REQUEST_FAILED', message: result.error.message }),
          );
          return;
        }

        applyDecodedBody(result.data);
      })
      .catch(() => {
        // Defensive backstop: a transport that throws instead of returning a
        // typed ApiResult must never produce an unhandled rejection.
        if (disposedRef.current || generation !== generationRef.current) return;
        applySafely((previous) =>
          failureState(previous, {
            code: 'REQUEST_FAILED',
            message: 'GET /decisions 請求發生未預期錯誤',
          }),
        );
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
  }, [applyDecodedBody, applySafely, failureState]);

  const refresh = useCallback(() => {
    runFetch();
  }, [runFetch]);

  const ingestDecisionPayload = useCallback(
    (body: unknown) => {
      if (disposedRef.current) return;
      // A newer generation invalidates any in-flight fetch, so a pushed body
      // cannot be overwritten by an older response that lands afterwards.
      generationRef.current += 1;
      applyDecodedBody(body);
    },
    [applyDecodedBody],
  );

  // Lifecycle only: reset on mount, abort and freeze on unmount. Kept separate
  // from the fetch effect so a `decisionId` change never disposes the
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

  // One read per identified decision. A change of decision drops the previous
  // decision's content instead of relabelling it under the new id.
  useEffect(() => {
    generationRef.current += 1;
    everSucceededRef.current = false;
    queuedFollowUpRef.current = false;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;

    if (options.decisionId === null || options.decisionId === '') {
      setState(initialState());
      return;
    }
    setState({ ...initialState(), state: 'loading', decisionId: options.decisionId });
    runFetch();
  }, [runFetch, options.decisionId]);

  return { ...state, refresh, ingestDecisionPayload };
}
