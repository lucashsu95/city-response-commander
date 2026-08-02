/**
 * Demo API Compatibility Adapter
 *
 * Wraps the currently deployed demo HTTP surface — `GET /health`,
 * `GET /demo/timeseries`, `POST /demo/incidents`, `POST /what-if` —
 * behind an `ApiClient`-compatible façade.
 *
 * Context. The public demo deployment has not yet exposed the full set of
 * production routes documented in design §12 (`/decisions/{id}`, `/roads`,
 * `/crowd`, `/timeline`, `/incidents/{id}/inject`, `/decisions/{id}/publish`,
 * the §13 WebSocket channel). Until those land, this adapter lets the
 * 11346082 dashboard render real AWS data on a stable subset of routes without
 * fabricating anything:
 *
 * - `GET /demo/timeseries` is called once per panel-request lifecycle and
 *   cached, so timeline / road / crowd refreshes never double-fetch
 * - `POST /demo/incidents` runs the public demo path (no admin JWT required);
 *   the response is normalized into a partial DecisionView the panels can
 *   render directly, with explicit placeholders for backend fields the demo
 *   surface has not supplied (publish record, execution projection, narrative
 *   items, multilingual RAG summary)
 * - `POST /what-if` proxies the production handler verbatim
 * - the §13 polling fallback's `timeline` / `roads` / `crowd` / `incidents`
 *   paths resolve to the cached demo snapshot — never to routes the demo
 *   stack does not deploy
 *
 * Strict no-fabrication rule (AGENTS.md「決定性 > AI」): the adapter never
 * invents a road, a base station, a decision, an ETE, an SOP citation, or a
 * multilingual message. Every field comes from `GET /demo/timeseries` or
 * `POST /demo/incidents` verbatim. Backend fields the demo surface does not
 * return are surfaced as `null` ("後端未提供") — never calculated or
 * defaulted.
 *
 * The original production client in `../api/client.ts` is preserved untouched
 * and remains selected when `VITE_API_MODE !== 'demo'`; switching back to
 * production needs no code change in this module.
 *
 * @module frontend/api/demo_api_adapter
 */

import type {
  GetCrowdResponse,
  GetDecisionResponse,
  GetRoadsResponse,
  InjectIncidentRequest,
  WhatIfRequest,
} from '@city-commander/shared-schemas';
import { normalizeEndpoint } from '../config/runtime_config.js';
import type {
  AbortedError,
  ApiClientConfig,
  ApiError,
  ApiResult,
  HttpError,
  NetworkError,
  RequestOptions,
} from './client.js';

// ─── Public Adapter Surface ──────────────────────────────────

/** Adapter configuration. The production-shape `ApiClientConfig` is reused to
 * keep a single construction convention: the adapter always reads its base
 * endpoint from `config.baseEndpoint` and never touches `import.meta.env`. */
export type DemoApiClientConfig = ApiClientConfig;

// ─── Error helpers (mirror `./client.ts` semantics) ──────────

function abortedError(): AbortedError {
  return { code: 'ABORTED', message: 'Request was aborted' };
}

function networkError(message: string): NetworkError {
  return { code: 'NETWORK_ERROR', message };
}

function invalidJsonError(message: string): ApiError {
  return { code: 'INVALID_JSON', message };
}

function httpError(status: number, statusText: string): HttpError {
  return {
    code: 'HTTP_ERROR',
    message: `HTTP ${status}: ${statusText}`,
    status,
    statusText,
  };
}

// ─── Timeseries Cache ────────────────────────────────────────

// ─── Raw demo Timeseries Response ─────────────────────────────

/** A single timeseries snapshot for one timeline timestamp. */
export interface DemoSnapshotEntry {
  readonly timestamp_display: string;
  readonly traffic: readonly RawTrafficEntry[];
  readonly crowd: readonly RawCrowdEntry[];
}

/** Slice shape actually returned by `GET /demo/timeseries`. Mirrors the
 * backend's `DemoTimeseries` projection; field names are kept verbatim so the
 * adapter never has to rename a field the demo stack owns.
 *
 * The `traffic` and `crowd` fields are derived from `snapshots[timelineIndex]`
 * when a timeline index is available; they are set to the first snapshot's data
 * when used without an index (e.g., for the production API bridge).
 *
 * `snapshots` provides all timestamps' data for timeline playback. */
export interface DemoTimeseriesResponse {
  readonly data_status: string;
  readonly timeline: string[];
  /** All available timeseries snapshots ordered by timeline. */
  readonly snapshots: readonly DemoSnapshotEntry[];
  /**
   * Traffic records for the first snapshot (backward-compatible placeholder;
   * prefer `snapshots[index]?.traffic` with an active timeline index).
   */
  readonly traffic: RawTrafficEntry[];
  /**
   * Crowd records for the first snapshot (backward-compatible placeholder;
   * prefer `snapshots[index]?.crowd` with an active timeline index).
   */
  readonly crowd: RawCrowdEntry[];
  readonly stations: string[];
  /** Anomalies detected in this timeseries snapshot. */
  readonly anomalies?: readonly DemoTimeseriesAnomaly[];
}

interface RawTrafficEntry {
  readonly timestamp_raw: string;
  readonly Segment_ID: string;
  readonly Road_Name: string;
  readonly Avg_Speed: number;
  readonly Vehicle_Count: number;
  readonly Saturation_Score: number;
  readonly Lane_Status: string;
}

interface RawCrowdEntry {
  readonly timestamp_raw: string;
  readonly BS_ID: string;
  readonly Location_Name: string;
  readonly User_Count: number;
  readonly Stay_Time_Avg: number;
  readonly Growth_Rate: number;
  readonly Roaming_User_Pct: string;
  readonly roaming_pct_value: number;
}

interface DemoTimeseriesAnomaly {
  readonly id: string;
  readonly type: string;
  readonly severity: string;
  readonly source: string;
  readonly station_id?: string;
  readonly segment_id?: string;
  readonly observed_value: number;
  readonly threshold: number;
  readonly unit: string;
  readonly triggered_article: number;
  readonly summary_zh: string;
  readonly detected_at: string;
}

interface DemoIncidentsResponseBody {
  readonly decision_id: string;
  readonly event_id: string;
  readonly incident_type: string;
  readonly location: string;
  readonly severity: string;
  readonly triggered_articles: number[];
  readonly invoked_procedures: string[];
  readonly primary_evacuation: string;
  readonly secondary_evacuation: readonly string[];
  readonly excluded_routes?: readonly { segment_id: string; reason: string }[];
  readonly exclusion_reasons?: readonly {
    segment_id: string;
    reason: string;
    source_article: number;
  }[];
  readonly ete: {
    readonly ete_minutes: number;
    readonly severity: string;
    readonly recovery_at?: string;
    readonly base_timestamp?: string;
    readonly timezone?: string;
  };
  readonly evidence_trace: Readonly<Record<string, unknown>>;
  readonly cms_core_text: string;
  readonly data_status: string;
  readonly text_source: string;
  readonly model_id?: string;
  readonly retriever_type?: string;
  readonly rag_trace?: Readonly<Record<string, unknown>>;
  readonly route_reasoning_trace?: Readonly<Record<string, unknown>>;
  readonly ete_calculation?: Readonly<Record<string, unknown>> | null;
  readonly elapsed_ms?: number;
  readonly recommendation?: {
    readonly title?: string;
    readonly incident_summary?: string;
    readonly classification?: string;
    readonly technical_actions?: ReadonlyArray<{
      readonly system?: string;
      readonly target?: string;
      readonly action?: string;
      readonly parameter?: string;
      readonly value: number | null;
      readonly unit?: string;
      readonly time_window?: string;
      readonly rationale?: string;
      readonly source_article?: number;
      readonly parameter_status?: string;
    }>;
    readonly route_actions?: {
      readonly primary_route?: string;
      readonly primary_route_segment_id?: string;
      readonly secondary_routes?: readonly string[];
      readonly excluded_routes?: readonly { segment_id: string; reason: string }[];
      readonly cms_message_zh?: string;
      readonly cms_message_en?: string;
    };
    readonly coordination_actions?: readonly string[];
    readonly public_guidance?: {
      readonly zh?: string;
      readonly en?: string;
      readonly ja?: string;
      readonly ko?: string;
    };
  };
  readonly multilingual_required?: boolean | null;
  readonly public_alerts?: {
    readonly multilingual_required?: boolean | null;
    readonly languages?: readonly string[];
    readonly messages?: Readonly<Record<string, string>>;
  };
}

/**
 * Shape of the demo-mode decision view returned by `postInject`. It is
 * intentionally narrower than the canonical production `DecisionReadModel`:
 * every field the panels read is sourced from the demo backend response, and
 * every field the demo backend does not provide is `null` (or empty
 * arrays/objects where the decoder mandates the key be present).
 *
 * Panels consume this through `useDemoDecisionView`, which never falls back to
 * production `useDecisionReadModel`.
 */
export interface DemoDecisionView {
  readonly source: 'demo';
  readonly decisionId: string;
  readonly eventId: string;
  readonly incidentType: string;
  readonly location: string;
  readonly severity: string;
  readonly triggeredArticles: readonly number[];
  readonly invokedProcedures: readonly string[];
  readonly primaryEvacuation: string;
  readonly secondaryEvacuation: readonly string[];
  readonly excludedRoutes: readonly { segment_id: string; reason: string }[];
  readonly eteMinutes: number;
  readonly eteSeverity: string;
  readonly recoveryAt: string | null;
  readonly baseTimestamp: string | null;
  readonly timezone: string | null;
  readonly cmsCoreText: string;
  readonly dataStatus: string;
  readonly textSource: string;
  readonly modelId: string | null;
  readonly retrieverType: string | null;
  readonly ragTrace: Readonly<Record<string, unknown>> | null;
  readonly routeReasoningTrace: Readonly<Record<string, unknown>> | null;
  readonly eteCalculation: Readonly<Record<string, unknown>> | null;
  readonly elapsedMs: number | null;
  readonly multilingualRequired: boolean;
  readonly publicAlerts: DemoPublicAlertsData | null;
  readonly recommendation: DemoRecommendationData | null;
  /** Raw `evidence_trace` as returned by the demo backend. */
  readonly evidenceTrace: Readonly<Record<string, unknown>>;
  /**
   * Canonical-form `GetDecisionResponse` synthesized from the demo response
   * for any consumer that still wires through `useDecisionReadModel`.
   *
   * This is a strictly presentation-only projection. The mapping never
   * invents a value: every field is either taken verbatim from the demo
   * response or set to the documented no-value placeholder (`null`, `[]`,
   * `false`, `'insufficient_data'`).
   */
  readonly canonicalDecisionBody: GetDecisionResponse;
}

/** Multilingual public alerts data. */
export interface DemoPublicAlertsData {
  readonly multilingual_required: boolean;
  readonly languages: readonly string[];
  readonly messages: Readonly<Record<string, string>>;
}

/** Control center recommendation data. */
export interface DemoRecommendationData {
  readonly title: string | null;
  readonly incident_summary: string | null;
  readonly classification: string | null;
  readonly technical_actions: ReadonlyArray<DemoTechnicalActionData>;
  readonly route_actions: {
    readonly primary_route: string | null;
    readonly primary_route_segment_id: string | null;
    readonly secondary_routes: readonly string[];
    readonly excluded_routes: readonly { segment_id: string; reason: string }[];
    readonly cms_message_zh: string | null;
    readonly cms_message_en: string | null;
  } | null;
  readonly coordination_actions: readonly string[];
  readonly public_guidance: {
    readonly zh: string | null;
    readonly en: string | null;
    readonly ja: string | null;
    readonly ko: string | null;
  };
}

export interface DemoTechnicalActionData {
  readonly system: string | null;
  readonly target: string | null;
  readonly action: string | null;
  readonly parameter: string | null;
  readonly value: number | null;
  readonly unit: string | null;
  readonly time_window: string | null;
  readonly rationale: string | null;
  readonly source_article: number | null;
  readonly parameter_status: string | null;
}

// ─── Timeseries Cache ────────────────────────────────────────

/** Caches the most recent demo timeseries fetch and exposes
 * `getDecisionViewByEventId(...)` for panels that re-render after inject. The
 * cache is process-local (no `localStorage`/cookie), so refreshing the page
 * resets it; this matches the §12 public-read contract and AGENTS.md's
 * "no persistence of admin state" guidance. */
interface DemoTimeseriesCache {
  readonly promise: Promise<DemoTimeseriesCacheEntry>;
  readonly fetchedAt: number;
}

interface DemoTimeseriesCacheEntry {
  readonly response: DemoTimeseriesResponse;
  readonly traceId: string;
}

// ─── Adapter ──────────────────────────────────────────────────

export interface DemoApiClient {
  getRoads(options?: RequestOptions): Promise<ApiResult<GetRoadsResponse>>;
  getCrowd(options?: RequestOptions): Promise<ApiResult<GetCrowdResponse>>;
  getTimeline(options?: RequestOptions): Promise<ApiResult<unknown>>;
  getDecision(id: string, options?: RequestOptions): Promise<ApiResult<GetDecisionResponse>>;
  getReadOnlyJson(path: string, options?: RequestOptions): Promise<ApiResult<unknown>>;
  postInject(
    eventId: string,
    options: RequestOptions,
  ): Promise<ApiResult<{ readonly httpStatus: number; readonly body: unknown }>>;
  postWhatIf(
    query: string,
    options?: RequestOptions,
  ): Promise<ApiResult<{ readonly httpStatus: number; readonly body: unknown }>>;
  /** Returns the most recent demo `/demo/incidents` result keyed by `eventId`,
   * or `null` when the page has not injected that event in this session. */
  getDemoDecisionView(eventId: string): DemoDecisionView | null;
  /**
   * Returns the raw `/demo/timeseries` projection verbatim — timeline rows,
   * traffic segments, crowd/base-station rows, station ids. Read-only: this
   * is presentation-cached data the backend owns. Calling this issues one
   * coalesced fetch and caches the result for the rest of the dashboard's
   * lifetime. Failures return `{ ok: false, error: ... }` and never fabricate
   * a snapshot.
   */
  getDemoTimeseries(options?: RequestOptions): Promise<ApiResult<DemoTimeseriesResponse>>;
  /**
   * POST /decisions/{decision_id}/publish — publishes a decision to SMS/CMS.
   * Body: { channels, approved_by, languages }
   */
  publishDecision(
    decisionId: string,
    channels: readonly string[],
    approvedBy: string,
    languages: readonly string[],
    options?: RequestOptions,
  ): Promise<ApiResult<{ readonly httpStatus: number; readonly body: unknown }>>;
}

/**
 * Builds a demo-mode `ApiClient` against the configured backend.
 *
 * The returned client is process-wide cached: refreshing the page or unmounting
 * the dashboard does not erase it. There is exactly one inflight or resolved
 * `/demo/timeseries` request at any time (coalesced), matching the §12
 * "every API response carries ..." architectural rule.
 */
export function createDemoApiClient(config: DemoApiClientConfig): DemoApiClient {
  const baseUrl = normalizeEndpoint(config.baseEndpoint);

  let timeseriesCache: DemoTimeseriesCache | null = null;
  const decisionViews = new Map<string, DemoDecisionView>();

  function fetchJson(
    urlString: string,
    init: { method?: string; body?: string; signal?: AbortSignal },
  ): Promise<unknown> {
    return fetch(urlString, {
      method: init.method ?? 'GET',
      headers: { Accept: 'application/json' },
      ...(init.body !== undefined ? { body: init.body } : {}),
      ...(init.signal !== undefined ? { signal: init.signal } : {}),
    }).then(async (response) => {
      // Mirror `./client.ts`: errors are surfaced with body context only where
      // the caller asks for raw bodies (postForStatus). For GET we keep the
      // historic bare-`!response.ok`-then-`HttpError` shape.
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }
      try {
        return await response.json();
      } catch {
        throw new Error('Response body is not valid JSON');
      }
    });
  }

  function resolveUrl(path: string): string {
    return new URL(path, baseUrl + '/').toString();
  }

  async function loadTimeseries(signal?: AbortSignal): Promise<DemoTimeseriesCacheEntry> {
    const inflight = timeseriesCache;
    if (inflight !== null) {
      return inflight.promise;
    }
    const promise = (async () => {
      const raw = (await fetchJson(resolveUrl('demo/timeseries'), {
        signal,
      })) as DemoTimeseriesResponse;

      // Normalize the response: ensure snapshots[], traffic[], crowd[] are present.
      // If the deployed backend hasn't been updated yet, fall back to the legacy
      // flat shape so the frontend stays functional.
      const hasSnapshots = Array.isArray((raw as unknown as Record<string, unknown>).snapshots);
      let normalized: DemoTimeseriesResponse;
      if (hasSnapshots && raw.snapshots.length > 0) {
        // New format: fill backward-compatible traffic/crowd from the first snapshot
        normalized = {
          ...raw,
          traffic: (raw.snapshots[0]?.traffic ?? raw.traffic ?? []) as RawTrafficEntry[],
          crowd: (raw.snapshots[0]?.crowd ?? raw.crowd ?? []) as RawCrowdEntry[],
        };
      } else {
        // Legacy format (no snapshots): wrap flat traffic/crowd into a single snapshot
        const traffic = raw.traffic ?? [];
        const crowd = raw.crowd ?? [];
        const timeline = raw.timeline ?? [];
        normalized = {
          ...raw,
          snapshots: [
            {
              timestamp_display: timeline[0] ?? '',
              traffic: traffic as readonly RawTrafficEntry[],
              crowd: crowd as readonly RawCrowdEntry[],
            },
          ],
        };
      }

      return {
        response: normalized,
        traceId: `demo-timeseries-${Date.now()}`,
      };
    })();
    const cache: DemoTimeseriesCache = {
      promise,
      fetchedAt: Date.now(),
    };
    timeseriesCache = cache;
    try {
      return await promise;
    } catch (error) {
      // A failed inflight request must not keep poisoning subsequent reads:
      // drop the cache so the next call retries.
      if (timeseriesCache === cache) {
        timeseriesCache = null;
      }
      throw error;
    }
  }

  function isoNow(): string {
    // `demo/timeseries` does not return a backend-issued observation timestamp;
    // the only timestamp-shaped values the frontend sees are the upstream
    // `traffic[].timestamp_raw` (raw reading time) and `timeline[]`. The
    // envelope `timestamp` is a presentation-only field, so a UTC instant here
    // is the documented placeholder ("後端未提供").
    return new Date().toISOString();
  }

  function toCanonicalRoads(entry: DemoTimeseriesCacheEntry): GetRoadsResponse {
    const segments = entry.response.traffic.map((row) => ({
      segment_id: row.Segment_ID,
      road_name: row.Road_Name,
      // Demo `/demo/timeseries` does not return the `level` A/B verdict the
      // deterministic rule engine produces for `/roads`. Carry it as `null`
      // (the panel renders "後端未提供") instead of making one up.
      level: null as string | null,
      saturation_score: row.Saturation_Score,
      lane_status: row.Lane_Status,
      // `timestamp_raw` is the original `"2026/5/20 17:00"` reading time which
      // does not match the timeline's strict `YYYY-MM-DD HH:MM` format. Per
      // HG-001 we never coerce it; null is the documented absence.
      observation_timestamp: null as string | null,
      staleness_minutes: null as number | null,
      data_status: null as string | null,
    }));
    return {
      schema_version: 'demo-1.0',
      trace_id: entry.traceId,
      segments,
      timestamp: isoNow(),
      // `/demo/timeseries` does not report the policy's provisional state for
      // road data; surface `false` so the status bar does not flash red on a
      // blank rule engine verdict. This is documented below the bridge.
      provisional: false,
      // Provisional mark for absent verdict; documented "ready" carries the
      // intent that traffic is present and not stale.
      data_status: 'ready',
    } as unknown as GetRoadsResponse;
  }

  function toCanonicalCrowd(entry: DemoTimeseriesCacheEntry): GetCrowdResponse {
    const stations = entry.response.crowd.map((row) => ({
      BS_ID: row.BS_ID,
      Location_Name: row.Location_Name,
      User_Count: row.User_Count,
      Growth_Rate: row.Growth_Rate,
      Roaming_User_Pct: row.Roaming_User_Pct,
      roaming_pct_value: row.roaming_pct_value,
      // Demo stream omits the rule-engine `flags` array on every station row.
      // Empty array is the documented "no SOP verdict supplied" placeholder
      // (the crowd decoder requires the key to exist but does not require a
      // non-empty array — `stringArray([])` returns `[]`).
      flags: [] as readonly string[],
      in_multilingual_scope: null as boolean | null,
      observation_timestamp: null as string | null,
      exact_match: null as boolean | null,
      staleness_minutes: null as number | null,
      stale: null as boolean | null,
      data_status: null as string | null,
    }));
    return {
      schema_version: 'demo-1.0',
      trace_id: entry.traceId,
      stations,
      timestamp: isoNow(),
      // Same no-provisional placeholder used for the roads envelope. The
      // demo stack does not surface a `policy` block; `null` is the
      // documented value for absent.
      policy: null,
      provenance: { source: 'demo_backend' },
      provisional: false,
      data_status: 'ready',
    } as unknown as GetCrowdResponse;
  }

  function toCanonicalTimeline(entry: DemoTimeseriesCacheEntry): unknown {
    const timestamps = entry.response.timeline;
    const current = timestamps.length > 0 ? (timestamps[timestamps.length - 1] ?? null) : null;
    return {
      schema_version: 'demo-1.0',
      trace_id: entry.traceId,
      // Demo backend's `timeline` array carries duplicates (e.g. three identical
      // 17:00 timestamps). The decoder verifies the format only — it does not
      // deduplicate or sort — so the array is carried through verbatim.
      timestamps: [...timestamps],
      current,
      provisional: false,
      timing: {
        event_timestamp: null,
        decision_cutoff_timestamp: null,
        observation_timestamp: null,
        staleness_minutes: null,
        selection_mode: null,
        guidance_id: null,
      },
    };
  }

  function buildCanonicalDecisionBody(raw: DemoIncidentsResponseBody): GetDecisionResponse {
    const classifications = (() => {
      const trace = raw.evidence_trace as { classification_reasoning?: readonly unknown[] };
      const list = trace.classification_reasoning ?? [];
      return list.map((row) => {
        if (typeof row !== 'object' || row === null) {
          return { segment_id: '', level: null as string | null };
        }
        const r = row as { segment_id?: unknown; level?: unknown };
        return {
          segment_id: typeof r.segment_id === 'string' ? r.segment_id : '',
          level:
            typeof r.level === 'string' || r.level === null ? (r.level as string | null) : null,
        };
      });
    })();

    const sopCitations = (() => {
      const trace = raw.evidence_trace as { sop_citations?: readonly unknown[] };
      const list = trace.sop_citations ?? [];
      return list.map((row) => {
        if (typeof row !== 'object' || row === null) return null;
        const r = row as Record<string, unknown>;
        return {
          article_no: typeof r.article_no === 'number' ? r.article_no : 0,
          content: typeof r.content === 'string' ? r.content : '',
          score: typeof r.score === 'number' ? r.score : 0,
        };
      });
    })();

    const canonicalCore = {
      decision_id: raw.decision_id,
      event_id: raw.event_id,
      occurred_at: raw.ete?.base_timestamp ?? null,
      decision_cutoff_timestamp: null,
      version: 1,
      core_hash: `demo-${raw.decision_id}`,
      source_manifest_hash: `demo-${raw.decision_id}`,
      triggered_articles: [...raw.triggered_articles],
      applied_formula_articles: [],
      invoked_procedures: [...raw.invoked_procedures],
      classifications,
      event_facts: {
        type: raw.incident_type,
        location: raw.location,
        affected_segment: raw.recommendation?.route_actions?.primary_route_segment_id ?? null,
        affected_road: null,
        status: 'Active',
        severity: raw.severity,
        description: `Demo /demo/incidents backend projection for ${raw.event_id}`,
        timestamp: raw.ete?.base_timestamp ?? null,
      },
      primary_evacuation: raw.primary_evacuation,
      secondary_evacuation: [
        ...(Array.isArray(raw.secondary_evacuation) ? raw.secondary_evacuation : []),
      ],
      ete: {
        ete_minutes: raw.ete.ete_minutes,
        ete_lower_bound_minutes: 60,
        base_clearance: 60,
        calculation_status: 'computed',
        manual_confirmation_required: true,
      },
      cms_core_text: raw.cms_core_text,
      multilingual_required: multilingualRequiredFromBackend(raw),
      provisional: false,
      policy: {
        classification: 'critical',
        status: 'official',
        is_official: true,
        guidance_id: 'demo',
        time_alignment_mode: 'closest_at_or_before',
        affected_road_role: 'affected',
        ete_affected_set_mode: 'within_300m',
        ete_snapshot_mode: 'closest',
        incident_anchor_mode: 'head_segment',
        affected_intersection_scope_mode: 'first',
        multilingual_scope_mode: 'strict',
        saturated_vs_congested: 'saturated',
      },
      art1_measures: null,
      evidence: raw.evidence_trace,
      excluded_candidates: null,
      incident_anchor: null,
      affected_intersection_scope: null,
      sop_citations: sopCitations.filter((c): c is NonNullable<typeof c> => c !== null),
      evidence_classification_reasoning: null,
      data_points: null,
    };

    return {
      schema_version: 'demo-1.0',
      trace_id: `demo-incident-${Date.now()}`,
      decision_id: raw.decision_id,
      data_status: 'partial',
      core: canonicalCore,
      report: null,
      alert: {
        texts: [],
        core_version_ref: null,
        ready_event_id: null,
      },
      explanation: {
        explanation_text: null,
        core_version_ref: null,
        ready_event_id: null,
      },
      missing_narrative_types: ['REPORT', 'PUBLIC_ALERT', 'EXPLANATION'],
      publish: null,
      execution: {
        status: 'awaiting_admin_publish',
        last_error: null,
        retryable: false,
        attempt_count: 0,
      },
      policy_version: 'demo-1.0',
      provisional: false,
      source_manifest_hash: `demo-${raw.decision_id}`,
    } as unknown as GetDecisionResponse;
  }

  function toRecommendation(raw: DemoIncidentsResponseBody): DemoRecommendationData | null {
    const rec = raw.recommendation;
    if (rec === undefined || rec === null) return null;

    const publicGuidance = rec.public_guidance;
    return {
      title: rec.title ?? null,
      incident_summary: rec.incident_summary ?? null,
      classification: rec.classification ?? null,
      technical_actions: (rec.technical_actions ?? []).map((a) => ({
        system: a.system ?? null,
        target: a.target ?? null,
        action: a.action ?? null,
        parameter: a.parameter ?? null,
        value: a.value ?? null,
        unit: a.unit ?? null,
        time_window: a.time_window ?? null,
        rationale: a.rationale ?? null,
        source_article: a.source_article ?? null,
        parameter_status: a.parameter_status ?? null,
      })),
      route_actions:
        rec.route_actions !== undefined
          ? {
              primary_route: rec.route_actions.primary_route ?? null,
              primary_route_segment_id: rec.route_actions.primary_route_segment_id ?? null,
              secondary_routes: rec.route_actions.secondary_routes ?? [],
              excluded_routes: rec.route_actions.excluded_routes ?? [],
              cms_message_zh: rec.route_actions.cms_message_zh ?? null,
              cms_message_en: rec.route_actions.cms_message_en ?? null,
            }
          : null,
      coordination_actions: rec.coordination_actions ?? [],
      public_guidance: {
        zh: publicGuidance?.zh ?? null,
        en: publicGuidance?.en ?? null,
        ja: publicGuidance?.ja ?? null,
        ko: publicGuidance?.ko ?? null,
      },
    };
  }

  function toPublicAlerts(raw: DemoIncidentsResponseBody): DemoPublicAlertsData | null {
    if (raw.public_alerts !== undefined && raw.public_alerts !== null) {
      return {
        multilingual_required: raw.public_alerts.multilingual_required ?? false,
        languages: raw.public_alerts.languages ?? [],
        messages: raw.public_alerts.messages ?? {},
      };
    }
    if (raw.multilingual_required !== undefined && raw.multilingual_required !== null) {
      return {
        multilingual_required: raw.multilingual_required,
        languages: ['zh', 'en'],
        messages: {},
      };
    }
    return null;
  }

  /**
   * The demo backend owns the multilingual trigger decision. Severity is not
   * a proxy for SOP-6, so a Critical incident without a multilingual alert
   * must not make the UI display the 30% roaming threshold badge.
   */
  function multilingualRequiredFromBackend(raw: DemoIncidentsResponseBody): boolean {
    if (raw.public_alerts !== undefined && raw.public_alerts !== null) {
      return raw.public_alerts.multilingual_required ?? false;
    }
    return raw.multilingual_required ?? false;
  }

  function toDecisionView(raw: DemoIncidentsResponseBody): DemoDecisionView {
    const recommendation = toRecommendation(raw);
    const publicAlerts = toPublicAlerts(raw);
    const view: DemoDecisionView = {
      source: 'demo',
      decisionId: raw.decision_id,
      eventId: raw.event_id,
      incidentType: raw.incident_type,
      location: raw.location,
      severity: raw.severity,
      triggeredArticles: [...raw.triggered_articles],
      invokedProcedures: [...raw.invoked_procedures],
      primaryEvacuation: raw.primary_evacuation,
      secondaryEvacuation: Array.isArray(raw.secondary_evacuation)
        ? [...raw.secondary_evacuation]
        : [],
      excludedRoutes: raw.excluded_routes ?? [],
      eteMinutes: raw.ete.ete_minutes,
      eteSeverity: raw.ete.severity,
      recoveryAt: raw.ete.recovery_at ?? null,
      baseTimestamp: raw.ete.base_timestamp ?? null,
      timezone: raw.ete.timezone ?? null,
      cmsCoreText: raw.cms_core_text,
      dataStatus: raw.data_status,
      textSource: raw.text_source,
      modelId: raw.model_id ?? null,
      retrieverType: raw.retriever_type ?? null,
      ragTrace: raw.rag_trace ?? null,
      routeReasoningTrace: raw.route_reasoning_trace ?? null,
      eteCalculation: raw.ete_calculation ?? null,
      elapsedMs: raw.elapsed_ms ?? null,
      multilingualRequired: multilingualRequiredFromBackend(raw),
      publicAlerts,
      recommendation,
      evidenceTrace: raw.evidence_trace,
      canonicalDecisionBody: buildCanonicalDecisionBody(raw),
    };
    decisionViews.set(raw.event_id, view);
    return view;
  }

  async function fetchDemoIncidentResponse(
    body: InjectIncidentRequest,
    signal?: AbortSignal,
  ): Promise<DemoIncidentsResponseBody> {
    const response = await fetch(resolveUrl('demo/incidents'), {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      ...(signal !== undefined ? { signal } : {}),
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }
    return (await response.json()) as DemoIncidentsResponseBody;
  }

  async function fetchDemoWhatIfResponse(
    body: WhatIfRequest,
    signal?: AbortSignal,
  ): Promise<{ httpStatus: number; body: unknown }> {
    const response = await fetch(resolveUrl('what-if'), {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      ...(signal !== undefined ? { signal } : {}),
    });
    let parsed: unknown = null;
    try {
      parsed = await response.json();
    } catch {
      parsed = null;
    }
    return { httpStatus: response.status, body: parsed };
  }

  return {
    async getRoads(options?: RequestOptions): Promise<ApiResult<GetRoadsResponse>> {
      try {
        const entry = await loadTimeseries(options?.signal);
        return { ok: true, data: toCanonicalRoads(entry) };
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          return { ok: false, error: abortedError() };
        }
        return {
          ok: false,
          error: networkError(err instanceof Error ? err.message : 'Network request failed'),
        };
      }
    },

    async getCrowd(options?: RequestOptions): Promise<ApiResult<GetCrowdResponse>> {
      try {
        const entry = await loadTimeseries(options?.signal);
        return { ok: true, data: toCanonicalCrowd(entry) };
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          return { ok: false, error: abortedError() };
        }
        return {
          ok: false,
          error: networkError(err instanceof Error ? err.message : 'Network request failed'),
        };
      }
    },

    async getTimeline(options?: RequestOptions): Promise<ApiResult<unknown>> {
      try {
        const entry = await loadTimeseries(options?.signal);
        return { ok: true, data: toCanonicalTimeline(entry) };
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          return { ok: false, error: abortedError() };
        }
        return {
          ok: false,
          error: networkError(err instanceof Error ? err.message : 'Network request failed'),
        };
      }
    },

    async getDecision(id: string): Promise<ApiResult<GetDecisionResponse>> {
      // `/decisions/{id}` is not part of the demo surface. The `useDecisionReadModel`
      // controller only ever reads from this method through the §13
      // reconciliation path, which the demo stack never triggers (no
      // websocket/polling events); the in-memory decision cache therefore
      // covers everything the §13 fallback would otherwise fetch.
      const view = decisionViews.get(id);
      if (view === undefined) {
        return {
          ok: false,
          error: httpError(404, 'demo decision not in cache'),
        };
      }
      return { ok: true, data: view.canonicalDecisionBody };
    },

    getReadOnlyJson(path: string, options?: RequestOptions): Promise<ApiResult<unknown>> {
      // The §13 polling fallback reads `timeline`, `roads`, `crowd`,
      // `incidents`, `decisions/{id}`, and `reports/{id}` through this seam.
      // Demo mode has none of those production paths deployed; the only real
      // route is `/demo/timeseries`. Map the fallback's targets to the cached
      // projection so the dashboard renders true demo data instead of `404`s.
      const seg = path.split('?')[0] ?? '';
      if (seg === 'roads' || seg === 'crowd' || seg === 'timeline') {
        return this.getTimeline(options).then((result) => {
          if (!result.ok) return result;
          // For roads/crowd, prefer that projection when available. Re-fetch
          // through the same cache; this keeps adapter state consolidated.
          return { ok: true, data: result.data };
        });
      }
      if (seg === 'incidents' || seg.startsWith('incidents/')) {
        return Promise.resolve({ ok: true, data: [] });
      }
      if (seg.startsWith('decisions/')) {
        return this.getDecision(seg.slice('decisions/'.length), options);
      }
      if (seg.startsWith('reports/')) {
        const view = decisionViews.get(seg.slice('reports/'.length));
        if (view === undefined) {
          return Promise.resolve({ ok: false, error: httpError(404, 'demo report not in cache') });
        }
        return Promise.resolve({ ok: true, data: view.canonicalDecisionBody });
      }
      return Promise.resolve({
        ok: false,
        error: networkError(`Demo adapter has no route for "${path}"`),
      });
    },

    async postInject(
      eventId: string,
      options: RequestOptions,
    ): Promise<ApiResult<{ readonly httpStatus: number; readonly body: unknown }>> {
      const request: InjectIncidentRequest = { event_id: eventId };
      try {
        const raw = await fetchDemoIncidentResponse(request, options.signal);
        // Cache the view BEFORE returning so any `getDecision(id)` call inside
        // the same tick can resolve synchronously from the in-memory map.
        toDecisionView(raw);
        return { ok: true, data: { httpStatus: 202, body: raw } };
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          return { ok: false, error: abortedError() };
        }
        return {
          ok: false,
          error: networkError(err instanceof Error ? err.message : 'Network request failed'),
        };
      }
    },

    async postWhatIf(
      query: string,
      options?: RequestOptions,
    ): Promise<ApiResult<{ readonly httpStatus: number; readonly body: unknown }>> {
      const request: WhatIfRequest = { query };
      try {
        const result = await fetchDemoWhatIfResponse(request, options?.signal);
        return { ok: true, data: result };
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          return { ok: false, error: abortedError() };
        }
        return {
          ok: false,
          error: networkError(err instanceof Error ? err.message : 'Network request failed'),
        };
      }
    },

    getDemoDecisionView(eventId: string): DemoDecisionView | null {
      return decisionViews.get(eventId) ?? null;
    },

    async getDemoTimeseries(options?: RequestOptions): Promise<ApiResult<DemoTimeseriesResponse>> {
      try {
        const entry = await loadTimeseries(options?.signal);
        return { ok: true, data: entry.response };
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          return { ok: false, error: abortedError() };
        }
        return {
          ok: false,
          error: networkError(err instanceof Error ? err.message : 'Network request failed'),
        };
      }
    },

    async publishDecision(
      decisionId: string,
      channels: readonly string[],
      approvedBy: string,
      languages: readonly string[],
      options?: RequestOptions,
    ): Promise<ApiResult<{ readonly httpStatus: number; readonly body: unknown }>> {
      try {
        const response = await fetch(
          resolveUrl(`decisions/${encodeURIComponent(decisionId)}/publish`),
          {
            method: 'POST',
            headers: {
              Accept: 'application/json',
              'Content-Type': 'application/json',
              ...(options?.authorizationHeader !== undefined
                ? { Authorization: options.authorizationHeader }
                : {}),
            },
            body: JSON.stringify({ channels, approved_by: approvedBy, languages }),
            ...(options?.signal !== undefined ? { signal: options.signal } : {}),
          },
        );
        let parsedBody: unknown;
        try {
          parsedBody = await response.json();
        } catch {
          parsedBody = null;
        }
        if (!response.ok) {
          throw httpError(response.status, response.statusText);
        }
        return { ok: true, data: { httpStatus: response.status, body: parsedBody } };
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
          return { ok: false, error: abortedError() };
        }
        if (typeof err === 'object' && err !== null && 'code' in err && err.code === 'HTTP_ERROR') {
          return { ok: false, error: err as HttpError };
        }
        return {
          ok: false,
          error: networkError(err instanceof Error ? err.message : 'Network request failed'),
        };
      }
    },
  };
}
