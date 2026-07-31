/**
 * HTTP Polling Fallback (§13 fallback table, §16.4, §21 "WebSocket drop")
 *
 * While the WebSocket is unavailable the dashboard keeps reading authoritative
 * server state over HTTP. This module owns two things:
 *
 *   1. the §13 per-event fallback mapping (pure, exhaustive, testable)
 *   2. a single cancellable polling loop over the resolved targets
 *
 * Truth boundary: this module only *fetches* canonical read models. It never
 * compares thresholds, never classifies A/B, never infers anomalies, and never
 * derives ETE, routes, or policy truth. `anomaly.detected` degrades to reading
 * the backend-provided `/roads` and `/crowd` read models as-is.
 *
 * Endpoint boundary: only relative route fragments are produced here. The
 * deployed base endpoint is supplied by runtime configuration through the
 * injected transport, so no host, region, account, or key appears in this file.
 *
 * All §13 parameterized fallbacks are decision-scoped, so `decision_id` is the
 * only identifier the mapping requires. When it is absent the target is
 * reported as unresolved — never as a successful poll.
 *
 * @module frontend/realtime/polling_fallback
 */

import type {
  GetCrowdResponse,
  GetDecisionResponse,
  GetRoadsResponse,
} from '@city-commander/shared-schemas';
import type { ApiErrorCode, ApiError, ApiResult, RequestOptions } from '../api/client.js';
import type { RealtimeScheduler, TimerHandle } from './scheduler.js';
import { REALTIME_EVENT_TYPES } from './transport_events.js';
import type { RealtimeEventType } from './transport_events.js';

// ─── Interval ──────────────────────────────────────────────

/** Default fallback cadence required by §13/§16.4 (2 seconds). */
export const DEFAULT_POLLING_INTERVAL_MS = 2000;

// ─── Routes (§13) ──────────────────────────────────────────

/** §13 fallback routes, expressed as templates for display and evidence. */
export const POLLING_ROUTES = {
  timeline: '/timeline',
  roads: '/roads',
  crowd: '/crowd',
  incidents: '/incidents',
  decision: '/decisions/{id}',
  report: '/reports/{id}',
} as const;

// ─── Targets ───────────────────────────────────────────────

interface PollingTargetShape {
  /** §13 route template, for display and test evidence. */
  readonly route: string;
  /** Resolved relative route fragment with identifiers URL-encoded. */
  readonly path: string;
}

/** `GET /timeline` — no canonical response contract yet. */
export interface TimelinePollingTarget extends PollingTargetShape {
  readonly kind: 'timeline';
}

/** `GET /roads` — canonical `GetRoadsResponse`. */
export interface RoadsPollingTarget extends PollingTargetShape {
  readonly kind: 'roads';
}

/** `GET /crowd` — canonical `GetCrowdResponse`. */
export interface CrowdPollingTarget extends PollingTargetShape {
  readonly kind: 'crowd';
}

/** `GET /incidents` — no canonical response contract yet. */
export interface IncidentsPollingTarget extends PollingTargetShape {
  readonly kind: 'incidents';
}

/** `GET /decisions/{id}` — canonical `GetDecisionResponse`. */
export interface DecisionPollingTarget extends PollingTargetShape {
  readonly kind: 'decision';
  readonly decisionId: string;
  /**
   * §13 `decision.enriched`: keep polling until the canonical read model
   * reports the required enrichment set. Readiness is *read* from the canonical
   * narrative items, never derived.
   */
  readonly awaitEnrichmentSet: boolean;
}

/** `GET /reports/{id}` — no canonical response contract yet. */
export interface ReportPollingTarget extends PollingTargetShape {
  readonly kind: 'report';
  /** Decision-scoped report identifier taken from the event/read model. */
  readonly reportId: string;
}

/** One resolved §13 polling target. */
export type PollingTarget =
  | TimelinePollingTarget
  | RoadsPollingTarget
  | CrowdPollingTarget
  | IncidentsPollingTarget
  | DecisionPollingTarget
  | ReportPollingTarget;

function timelineTarget(): TimelinePollingTarget {
  return { kind: 'timeline', route: POLLING_ROUTES.timeline, path: 'timeline' };
}

function roadsTarget(): RoadsPollingTarget {
  return { kind: 'roads', route: POLLING_ROUTES.roads, path: 'roads' };
}

function crowdTarget(): CrowdPollingTarget {
  return { kind: 'crowd', route: POLLING_ROUTES.crowd, path: 'crowd' };
}

function incidentsTarget(): IncidentsPollingTarget {
  return { kind: 'incidents', route: POLLING_ROUTES.incidents, path: 'incidents' };
}

function decisionTarget(decisionId: string, awaitEnrichmentSet: boolean): DecisionPollingTarget {
  return {
    kind: 'decision',
    decisionId,
    awaitEnrichmentSet,
    route: POLLING_ROUTES.decision,
    path: `decisions/${encodeURIComponent(decisionId)}`,
  };
}

function reportTarget(reportId: string): ReportPollingTarget {
  return {
    kind: 'report',
    reportId,
    route: POLLING_ROUTES.report,
    path: `reports/${encodeURIComponent(reportId)}`,
  };
}

// ─── §13 Mapping ───────────────────────────────────────────

/** Identifier context available to the fallback mapping. */
export interface PollingIdentifierContext {
  /** Active decision id from the event envelope or canonical read model. */
  readonly decisionId: string | null;
}

/** A §13 fallback target that cannot be polled yet. */
export interface UnresolvedPollingTarget {
  readonly eventType: RealtimeEventType;
  readonly route: string;
  readonly requiredParameter: 'decision_id';
  readonly message: string;
}

/** Result of mapping one §13 event to its fallback target(s). */
export type PollingTargetResolution =
  | { readonly ok: true; readonly targets: readonly PollingTarget[] }
  | { readonly ok: false; readonly unresolved: UnresolvedPollingTarget };

function unresolvedDecisionTarget(
  eventType: RealtimeEventType,
  route: string,
): PollingTargetResolution {
  return {
    ok: false,
    unresolved: {
      eventType,
      route,
      requiredParameter: 'decision_id',
      message: `${eventType} 的輪詢目標 GET ${route} 需要 decision_id，目前尚無可用識別碼`,
    },
  };
}

function withDecisionId(
  eventType: RealtimeEventType,
  route: string,
  context: PollingIdentifierContext,
  build: (decisionId: string) => readonly PollingTarget[],
): PollingTargetResolution {
  const decisionId = context.decisionId;
  if (decisionId === null || decisionId === '') {
    return unresolvedDecisionTarget(eventType, route);
  }
  return { ok: true, targets: build(decisionId) };
}

/**
 * Maps one §13 WebSocket event to its HTTP polling fallback target(s).
 *
 * | event | fallback |
 * | --- | --- |
 * | `timeline.updated` | `GET /timeline` |
 * | `anomaly.detected` | `GET /roads` + `GET /crowd` |
 * | `incident.injected` | `GET /incidents` |
 * | `decision.fast_path_ready` | `GET /decisions/{id}` |
 * | `decision.enriched` | `GET /decisions/{id}` until the canonical read model reports the enrichment set |
 * | `public_alert.ready` | `GET /reports/{id}` |
 * | `report.ready` | `GET /reports/{id}` |
 * | `publish.status_changed` | `GET /decisions/{id}` |
 * | `processing.failed` | `GET /decisions/{id}` (event error information is preserved by the caller's envelope) |
 */
export function resolvePollingTargetsForEvent(
  eventType: RealtimeEventType,
  context: PollingIdentifierContext,
): PollingTargetResolution {
  switch (eventType) {
    case 'timeline.updated':
      return { ok: true, targets: [timelineTarget()] };
    case 'anomaly.detected':
      return { ok: true, targets: [roadsTarget(), crowdTarget()] };
    case 'incident.injected':
      return { ok: true, targets: [incidentsTarget()] };
    case 'decision.fast_path_ready':
      return withDecisionId(eventType, POLLING_ROUTES.decision, context, (id) => [
        decisionTarget(id, false),
      ]);
    case 'decision.enriched':
      return withDecisionId(eventType, POLLING_ROUTES.decision, context, (id) => [
        decisionTarget(id, true),
      ]);
    case 'public_alert.ready':
    case 'report.ready':
      return withDecisionId(eventType, POLLING_ROUTES.report, context, (id) => [reportTarget(id)]);
    case 'publish.status_changed':
      return withDecisionId(eventType, POLLING_ROUTES.decision, context, (id) => [
        decisionTarget(id, false),
      ]);
    case 'processing.failed':
      return withDecisionId(eventType, POLLING_ROUTES.decision, context, (id) => [
        decisionTarget(id, false),
      ]);
  }
}

// ─── Fallback Plan ─────────────────────────────────────────

/**
 * Event types whose fallback needs no identifier. These keep the live read
 * views refreshing while the WebSocket is down. Decision-scoped fallbacks join
 * the plan as soon as a decision id is tracked.
 */
export const DEFAULT_FALLBACK_EVENT_TYPES: readonly RealtimeEventType[] = [
  'timeline.updated',
  'anomaly.detected',
  'incident.injected',
];

/** Active fallback context: which §13 events matter, and for which decision. */
export interface RealtimeFallbackContext extends PollingIdentifierContext {
  readonly eventTypes: readonly RealtimeEventType[];
}

/** Resolved plan for one degradation period. */
export interface FallbackPlan {
  readonly targets: readonly PollingTarget[];
  readonly unresolved: readonly UnresolvedPollingTarget[];
}

/** Default context: unparameterized live-read fallbacks, no tracked decision. */
export function createDefaultFallbackContext(): RealtimeFallbackContext {
  return { eventTypes: DEFAULT_FALLBACK_EVENT_TYPES, decisionId: null };
}

/** Context covering every §13 event for a tracked decision. */
export function createDecisionFallbackContext(decisionId: string): RealtimeFallbackContext {
  return { eventTypes: REALTIME_EVENT_TYPES, decisionId };
}

function mergeTarget(existing: PollingTarget, incoming: PollingTarget): PollingTarget {
  if (
    existing.kind === 'decision' &&
    incoming.kind === 'decision' &&
    incoming.awaitEnrichmentSet &&
    !existing.awaitEnrichmentSet
  ) {
    return incoming;
  }
  return existing;
}

/**
 * Resolves the active context into a deduplicated polling plan.
 *
 * Duplicate routes are collapsed so one degradation period issues one request
 * per distinct target per cycle.
 */
export function resolveFallbackPlan(context: RealtimeFallbackContext): FallbackPlan {
  const byKey = new Map<string, PollingTarget>();
  const unresolved: UnresolvedPollingTarget[] = [];

  for (const eventType of context.eventTypes) {
    const resolution = resolvePollingTargetsForEvent(eventType, context);
    if (!resolution.ok) {
      unresolved.push(resolution.unresolved);
      continue;
    }
    for (const target of resolution.targets) {
      const key = `${target.kind}:${target.path}`;
      const existing = byKey.get(key);
      byKey.set(key, existing === undefined ? target : mergeTarget(existing, target));
    }
  }

  return { targets: [...byKey.values()], unresolved };
}

// ─── Typed Polling Errors ──────────────────────────────────

/** Polling failure discriminator. */
export type PollingErrorCode =
  | 'MISSING_POLLING_CONTEXT'
  | 'TARGET_REQUEST_FAILED'
  | 'INVALID_POLLING_RESPONSE';

/**
 * Typed polling error. Carries the route and the transport error code only —
 * never a stack trace, request header, or credential.
 */
export interface PollingError {
  readonly code: PollingErrorCode;
  readonly route: string;
  readonly message: string;
  readonly apiErrorCode: ApiErrorCode | null;
}

// ─── Cycle Results ─────────────────────────────────────────

/**
 * Successful read for one target. Canonical response types are used where they
 * exist; routes without a canonical contract stay `unknown`.
 */
export type PollingTargetValue =
  | { readonly kind: 'roads'; readonly data: GetRoadsResponse }
  | { readonly kind: 'crowd'; readonly data: GetCrowdResponse }
  | {
      readonly kind: 'decision';
      readonly data: GetDecisionResponse;
      /** Read from canonical narrative items; not derived. */
      readonly enrichmentSetPresent: boolean;
    }
  | { readonly kind: 'timeline'; readonly data: unknown }
  | { readonly kind: 'incidents'; readonly data: unknown }
  | { readonly kind: 'report'; readonly data: unknown };

/** Outcome of one target within one cycle. */
export interface PollingTargetOutcome {
  readonly target: PollingTarget;
  readonly result:
    | { readonly ok: true; readonly value: PollingTargetValue }
    | { readonly ok: false; readonly error: PollingError };
}

/** Result of one completed polling cycle. */
export interface PollingCycleResult {
  /** 1-based cycle counter for the current degradation period. */
  readonly cycle: number;
  readonly outcomes: readonly PollingTargetOutcome[];
  readonly unresolved: readonly UnresolvedPollingTarget[];
  readonly succeededCount: number;
  readonly failedCount: number;
}

/** First error of a cycle, unresolved context included. Null when fully clean. */
export function firstCycleError(result: PollingCycleResult): PollingError | null {
  for (const outcome of result.outcomes) {
    if (!outcome.result.ok) {
      return outcome.result.error;
    }
  }
  const unresolved = result.unresolved[0];
  return unresolved === undefined ? null : missingContextError(unresolved);
}

function missingContextError(unresolved: UnresolvedPollingTarget): PollingError {
  return {
    code: 'MISSING_POLLING_CONTEXT',
    route: unresolved.route,
    message: unresolved.message,
    apiErrorCode: null,
  };
}

function targetRequestError(target: PollingTarget, error: ApiError): PollingError {
  return {
    code: 'TARGET_REQUEST_FAILED',
    route: target.route,
    message: `GET ${target.route} 輪詢失敗（${error.code}）`,
    apiErrorCode: error.code,
  };
}

function invalidResponseError(target: PollingTarget): PollingError {
  return {
    code: 'INVALID_POLLING_RESPONSE',
    route: target.route,
    message: `GET ${target.route} 回應結構不符合預期，已略過本次判讀`,
    apiErrorCode: null,
  };
}

// ─── Enrichment Readiness (read-only) ──────────────────────

/**
 * Required enrichment set of §13 `decision.enriched`, keyed by the canonical
 * narrative payload discriminant.
 */
const REQUIRED_ENRICHMENT_PAYLOAD_TYPES = ['REPORT', 'PUBLIC_ALERT', 'EXPLANATION'] as const;

type RequiredEnrichmentPayloadType = (typeof REQUIRED_ENRICHMENT_PAYLOAD_TYPES)[number];

function isUnknownRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Outcome of inspecting a decision read model for the §13 enrichment set.
 *
 * `malformed` means the runtime response did not match the canonical shape, so
 * no readiness claim can be made either way.
 */
export type EnrichmentSetInspection =
  | { readonly ok: true; readonly present: boolean }
  | { readonly ok: false; readonly reason: 'MALFORMED_RESPONSE' };

/**
 * Inspects the canonical read model for the required narrative items.
 *
 * The API client returns unvalidated runtime JSON, so the declared
 * `GetDecisionResponse` type is not a runtime guarantee. Every level is
 * therefore checked before it is read: `narratives` must be an array, each item
 * an object, each `payload` an object, and each `payload.type` a string.
 *
 * This remains a pure presence check over canonical narrative types exactly as
 * §13 prescribes. It never inspects generated content, quality, or policy
 * truth, and it never fabricates readiness for a malformed response.
 */
export function inspectEnrichmentSet(decision: GetDecisionResponse): EnrichmentSetInspection {
  const candidate: unknown = decision;
  if (!isUnknownRecord(candidate)) {
    return { ok: false, reason: 'MALFORMED_RESPONSE' };
  }

  const narratives: unknown = candidate['narratives'];
  if (!Array.isArray(narratives)) {
    return { ok: false, reason: 'MALFORMED_RESPONSE' };
  }

  const present = new Set<RequiredEnrichmentPayloadType>();
  for (const narrative of narratives) {
    if (!isUnknownRecord(narrative)) {
      return { ok: false, reason: 'MALFORMED_RESPONSE' };
    }
    const payload: unknown = narrative['payload'];
    if (!isUnknownRecord(payload)) {
      return { ok: false, reason: 'MALFORMED_RESPONSE' };
    }
    const payloadType: unknown = payload['type'];
    if (typeof payloadType !== 'string') {
      return { ok: false, reason: 'MALFORMED_RESPONSE' };
    }
    for (const required of REQUIRED_ENRICHMENT_PAYLOAD_TYPES) {
      if (payloadType === required) {
        present.add(required);
      }
    }
  }

  return {
    ok: true,
    present: REQUIRED_ENRICHMENT_PAYLOAD_TYPES.every((type) => present.has(type)),
  };
}

/**
 * Convenience presence check over the canonical read model.
 *
 * Returns `false` for a malformed response: readiness is never assumed from
 * data that could not be safely inspected.
 */
export function isEnrichmentSetPresent(decision: GetDecisionResponse): boolean {
  const inspection = inspectEnrichmentSet(decision);
  return inspection.ok && inspection.present;
}

// ─── Transport ─────────────────────────────────────────────

/**
 * Read-only transport required by the fallback loop.
 *
 * Structurally satisfied by the TASK-121 API client, so every request goes
 * through the injected `VITE_API_ENDPOINT` and the client's typed error model.
 */
export interface PollingTransport {
  getRoads(options?: RequestOptions): Promise<ApiResult<GetRoadsResponse>>;
  getCrowd(options?: RequestOptions): Promise<ApiResult<GetCrowdResponse>>;
  getDecision(id: string, options?: RequestOptions): Promise<ApiResult<GetDecisionResponse>>;
  getReadOnlyJson(path: string, options?: RequestOptions): Promise<ApiResult<unknown>>;
}

// ─── Polling Service ───────────────────────────────────────

export interface PollingFallbackOptions {
  readonly transport: PollingTransport;
  readonly scheduler: RealtimeScheduler;
  /** Configurable cadence; defaults to {@link DEFAULT_POLLING_INTERVAL_MS}. */
  readonly intervalMs?: number;
  /** Called once per completed cycle that was not cancelled. */
  readonly onCycle?: (result: PollingCycleResult) => void;
  /** Called for every typed failure, including missing polling context. */
  readonly onError?: (error: PollingError) => void;
}

export interface PollingFallback {
  /**
   * Starts the loop. The first cycle runs immediately; every later cycle is
   * scheduled `intervalMs` after the previous cycle finished, so cycles can
   * never overlap. Calling `start` on an already-running loop is a no-op.
   */
  start(plan: FallbackPlan): void;
  /** Cancels the timer and the in-flight cycle; late results are discarded. */
  stop(): void;
  isActive(): boolean;
  /** Effective cadence in milliseconds. */
  readonly intervalMs: number;
}

/**
 * Creates the polling fallback loop.
 *
 * Guarantees:
 * - exactly one active loop and at most one in-flight cycle
 * - a failed target never terminates the loop
 * - cancellation (`stop`) aborts in-flight requests and drops late results
 * - no fabricated success: every outcome comes from the transport verbatim
 */
export function createPollingFallback(options: PollingFallbackOptions): PollingFallback {
  const intervalMs = options.intervalMs ?? DEFAULT_POLLING_INTERVAL_MS;

  let active = false;
  let runGeneration = 0;
  let inFlightGeneration: number | null = null;
  let timer: TimerHandle | null = null;
  let controller: AbortController | null = null;
  let cycleCount = 0;
  let activeTargets: readonly PollingTarget[] = [];
  let unresolvedTargets: readonly UnresolvedPollingTarget[] = [];

  function clearTimer(): void {
    if (timer !== null) {
      options.scheduler.clearTimer(timer);
      timer = null;
    }
  }

  function scheduleNext(generation: number): void {
    if (!active || generation !== runGeneration || timer !== null) {
      return;
    }
    timer = options.scheduler.setTimer(() => {
      timer = null;
      void runCycle(generation);
    }, intervalMs);
  }

  async function pollTarget(
    target: PollingTarget,
    signal: AbortSignal,
  ): Promise<PollingTargetOutcome> {
    const requestOptions: RequestOptions = { signal };

    switch (target.kind) {
      case 'roads': {
        const result = await options.transport.getRoads(requestOptions);
        return result.ok
          ? { target, result: { ok: true, value: { kind: 'roads', data: result.data } } }
          : { target, result: { ok: false, error: targetRequestError(target, result.error) } };
      }
      case 'crowd': {
        const result = await options.transport.getCrowd(requestOptions);
        return result.ok
          ? { target, result: { ok: true, value: { kind: 'crowd', data: result.data } } }
          : { target, result: { ok: false, error: targetRequestError(target, result.error) } };
      }
      case 'decision': {
        const result = await options.transport.getDecision(target.decisionId, requestOptions);
        if (!result.ok) {
          return { target, result: { ok: false, error: targetRequestError(target, result.error) } };
        }
        const inspection = inspectEnrichmentSet(result.data);
        if (!inspection.ok) {
          // Malformed runtime payload: report it, claim no readiness, and keep
          // the target so the next cycle can retry.
          return { target, result: { ok: false, error: invalidResponseError(target) } };
        }
        return {
          target,
          result: {
            ok: true,
            value: {
              kind: 'decision',
              data: result.data,
              enrichmentSetPresent: inspection.present,
            },
          },
        };
      }
      case 'timeline': {
        const result = await options.transport.getReadOnlyJson(target.path, requestOptions);
        return result.ok
          ? { target, result: { ok: true, value: { kind: 'timeline', data: result.data } } }
          : { target, result: { ok: false, error: targetRequestError(target, result.error) } };
      }
      case 'incidents': {
        const result = await options.transport.getReadOnlyJson(target.path, requestOptions);
        return result.ok
          ? { target, result: { ok: true, value: { kind: 'incidents', data: result.data } } }
          : { target, result: { ok: false, error: targetRequestError(target, result.error) } };
      }
      case 'report': {
        const result = await options.transport.getReadOnlyJson(target.path, requestOptions);
        return result.ok
          ? { target, result: { ok: true, value: { kind: 'report', data: result.data } } }
          : { target, result: { ok: false, error: targetRequestError(target, result.error) } };
      }
    }
  }

  function retireCompletedTargets(outcomes: readonly PollingTargetOutcome[]): void {
    const retired = new Set<PollingTarget>();
    for (const outcome of outcomes) {
      if (
        outcome.target.kind === 'decision' &&
        outcome.target.awaitEnrichmentSet &&
        outcome.result.ok &&
        outcome.result.value.kind === 'decision' &&
        outcome.result.value.enrichmentSetPresent
      ) {
        retired.add(outcome.target);
      }
    }
    if (retired.size > 0) {
      activeTargets = activeTargets.filter((target) => !retired.has(target));
    }
  }

  /**
   * Invokes one consumer callback in isolation.
   *
   * A throwing consumer must never abort the cycle, skip the remaining
   * consumers, or produce an unhandled rejection. The thrown value is
   * deliberately swallowed: logging it could leak payloads or stack traces.
   */
  function notifySafely(notify: () => void): void {
    try {
      notify();
    } catch {
      // Consumer fault is contained; the transport keeps running.
    }
  }

  async function runCycle(generation: number): Promise<void> {
    if (!active || generation !== runGeneration || inFlightGeneration === generation) {
      return;
    }
    inFlightGeneration = generation;

    const cycleController = new AbortController();
    controller = cycleController;
    cycleCount += 1;
    const cycle = cycleCount;
    const targets = activeTargets;

    try {
      let outcomes: readonly PollingTargetOutcome[];
      try {
        outcomes = await Promise.all(
          targets.map((target) => pollTarget(target, cycleController.signal)),
        );
      } finally {
        if (inFlightGeneration === generation) {
          inFlightGeneration = null;
        }
        if (controller === cycleController) {
          controller = null;
        }
      }

      // Cancelled while in flight: never publish late results.
      if (!active || generation !== runGeneration) {
        return;
      }

      retireCompletedTargets(outcomes);

      let failedCount = 0;
      for (const outcome of outcomes) {
        if (!outcome.result.ok) {
          failedCount += 1;
          const error = outcome.result.error;
          notifySafely(() => options.onError?.(error));
        }
      }
      for (const unresolved of unresolvedTargets) {
        const error = missingContextError(unresolved);
        notifySafely(() => options.onError?.(error));
      }

      const result: PollingCycleResult = {
        cycle,
        outcomes,
        unresolved: unresolvedTargets,
        succeededCount: outcomes.length - failedCount,
        failedCount,
      };
      notifySafely(() => options.onCycle?.(result));
    } catch {
      // An unexpected cycle-body fault (for example a transport that rejects
      // instead of returning a typed result) is contained here so `runCycle`
      // never produces an unhandled rejection. No cycle result is published,
      // because no successful read can be claimed.
    } finally {
      // Finally-safe rescheduling: neither a failed target, a malformed
      // response, nor an unexpected cycle-body fault may permanently stop the
      // loop. `scheduleNext` itself re-checks `active`, the generation, and the
      // existing timer, so a cancelled loop is never revived and no duplicate
      // timer is created. Rescheduling always waits the configured interval,
      // so this can never become a tight retry loop.
      scheduleNext(generation);
    }
  }

  return {
    intervalMs,

    start(plan: FallbackPlan): void {
      if (active) {
        return;
      }
      active = true;
      runGeneration += 1;
      cycleCount = 0;
      activeTargets = [...plan.targets];
      unresolvedTargets = [...plan.unresolved];
      void runCycle(runGeneration);
    },

    stop(): void {
      if (!active && timer === null && controller === null) {
        return;
      }
      active = false;
      runGeneration += 1;
      clearTimer();
      if (controller !== null) {
        controller.abort();
        controller = null;
      }
      activeTargets = [];
      unresolvedTargets = [];
    },

    isActive(): boolean {
      return active;
    },
  };
}
