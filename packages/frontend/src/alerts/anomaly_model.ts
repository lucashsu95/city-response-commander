/**
 * Anomaly Presentation Model — Pure Decode + Server-Signal Reading (TASK-127)
 *
 * TASK-127 requires the dashboard to auto-open a popup when the backend
 * reports an anomaly, over two official channels:
 *
 *   1. the §13 WebSocket event `anomaly.detected`
 *   2. while the socket is unavailable, the §13 polling fallback's already
 *      issued `GET /roads` and `GET /crowd` reads
 *
 * This module is the whole truth boundary for that feature. It contains no
 * React, no transport, no timer, and no threshold arithmetic. Every decision it
 * makes is a *read* of a value the backend already committed:
 *
 * - realtime: the canonical `AnomalyDetectedEvent` (`shared-schemas/events.ts`)
 *   already means "SOP threshold crossed". Its presence is the signal; the
 *   client only validates the envelope structurally and renders the fields.
 * - roads: `GetRoadsResponse.segments[].level` is the backend's own congestion
 *   classification (`CongestionLevel`, `shared-schemas/enums.ts`). `'A'`/`'B'`
 *   are the backend's active verdicts. `saturation_score` is never read here.
 * - crowd: the wire payload's per-station `flags` are documented in
 *   `crowd/crowd_model.ts` as "SOP trigger truth from the domain evaluators".
 *   A non-empty `flags` array is the backend's active verdict. `User_Count`,
 *   `Growth_Rate`, and the roaming percentage are never read here.
 *
 * Deliberately absent capabilities, because no canonical field supports them:
 *
 * - `GetRoadsResponse` and `GetCrowdResponse` carry no natural-language anomaly
 *   text, so a polling-derived anomaly has `summary === null` and the component
 *   falls back to fixed UI framing. No cause, SOP conclusion, route, ETE, or
 *   severity is ever generated client-side.
 * - `GetRoadsResponse` carries no per-segment `stale` verdict (only the
 *   optional `staleness_minutes` that `road_model.ts` reads verbatim). Deriving
 *   `stale` from those minutes is exactly what `crowd_model.ts` forbids, so a
 *   roads-derived anomaly reports `stale === null` ("backend did not say")
 *   rather than a fabricated boolean. The crowd payload does carry a `stale`
 *   verdict and it is passed through untouched.
 *
 * @module frontend/alerts/anomaly_model
 */

import { decodeCrowdResponse } from '../crowd/crowd_model.js';
import type { CrowdReadModel, CrowdStationRow } from '../crowd/crowd_model.js';
import { decodeRoadsResponse } from '../roads/road_model.js';
import type { RoadReadModel, RoadSegmentView } from '../roads/road_model.js';
import type { RealtimeEventEnvelope } from '../realtime/transport_events.js';

// ─── Constants ───────────────────────────────────────────────

/** Canonical §13 discriminant for the auto-popup event. */
export const ANOMALY_EVENT_TYPE = 'anomaly.detected';

/**
 * Backend envelope/entity status meaning "not enough official data".
 *
 * Mirrors `CrowdDataStatus` and the `data_status` value `road_model.ts` reads
 * verbatim. Used only to decide that the client must *not* claim a channel is
 * inactive; it never turns into an active verdict.
 */
const INSUFFICIENT_DATA_STATUS = 'insufficient_data';

/**
 * The backend's congestion classification vocabulary for `GetRoadsResponse`
 * `segments[].level`.
 *
 * These are the canonical codes: they mirror `CongestionLevel` in
 * `shared-schemas/src/enums.ts`, and §12 documents `level` as
 * `'A' | 'B' | null`. `'A'`/`'B'` are the backend's active verdicts and
 * `'NONE'` is its explicit "not congested" verdict.
 *
 * They are declared as literals rather than imported from
 * `@city-commander/shared-schemas` because the frontend build resolves that
 * package to its compiled `dist`, whose current published surface does not
 * include the `CongestionLevel` *value* (the production bundle fails on the
 * import even though `tsc` resolves it). Pinning the codes here keeps this
 * feature independent of another package's build artifact. No code is invented,
 * and no threshold is reproduced — only the classification labels.
 */
const ROAD_LEVEL_A = 'A';
const ROAD_LEVEL_B = 'B';
const ROAD_LEVEL_NONE = 'NONE';

// ─── Presentation ────────────────────────────────────────────

/** Which official channel produced the anomaly currently on screen. */
export type AnomalySource = 'realtime' | 'roads' | 'crowd';

/** The two polling channels that carry a server-owned anomaly verdict. */
export type AnomalyChannel = 'roads' | 'crowd';

/**
 * Tri-state reading of one channel's server-owned signal.
 *
 * `unknown` is the fail-closed value: it means the client could not obtain a
 * verdict (malformed payload, unrecognized classification vocabulary, or
 * `insufficient_data` without an explicit active signal) and must therefore
 * preserve whatever it previously knew. It is never treated as `inactive`.
 */
export type ServerSignalState = 'active' | 'inactive' | 'unknown';

/**
 * One anomaly, ready to render. Every field is either copied verbatim from the
 * backend or `null` when the backend supplied nothing.
 */
export interface AnomalyPresentation {
  /**
   * Channel-agnostic stable identity: backend entity id plus the backend's own
   * observation instant. Deliberately excludes the source so the same anomaly
   * arriving over both the WebSocket and the polling fallback deduplicates to
   * one popup.
   */
  readonly identity: string;
  readonly source: AnomalySource;
  /** Backend classification code (`anomaly_type`, `level`, or first flag). */
  readonly category: string | null;
  /** Backend entity id (`segment_or_station_id`, `segment_id`, or `BS_ID`). */
  readonly entityId: string | null;
  /** Backend natural-language text, verbatim. `null` when none was supplied. */
  readonly summary: string | null;
  /** Backend instant this anomaly refers to. Never `Date.now()`. */
  readonly observedAt: string | null;
  /** Backend staleness verdict. `null` means the backend did not say. */
  readonly stale: boolean | null;
  /** Backend provisional-policy marker. `null` means the backend did not say. */
  readonly provisional: boolean | null;
  /** Backend `data_status`, verbatim. `null` when absent. */
  readonly dataStatus: string | null;
  /** Backend signal codes, verbatim, for display and evidence. */
  readonly serverSignals: readonly string[];
  /** `AnomalyDetectedEvent.threshold`, display-only, never compared. */
  readonly thresholdLabel: string | null;
  /** `AnomalyDetectedEvent.value`, display-only, never compared. */
  readonly valueLabel: string | null;
}

/**
 * Builds the cross-channel identity.
 *
 * A backend that supplies no instant for an otherwise valid active signal still
 * gets a usable identity, but one that cannot be confused with a real instant.
 */
function buildIdentity(entityId: string, observedAt: string | null): string {
  return `${entityId}@${observedAt ?? 'no-observation-instant'}`;
}

// ─── Decode Errors ───────────────────────────────────────────

export type AnomalyDecodeErrorCode =
  | 'NOT_AN_OBJECT'
  | 'EVENT_TYPE_MISMATCH'
  | 'MISSING_SCHEMA_VERSION'
  | 'MISSING_TRACE_ID'
  | 'MISSING_POLICY_VERSION'
  | 'MISSING_OCCURRED_AT'
  | 'MISSING_ANOMALY_TYPE'
  | 'MISSING_ENTITY_ID'
  | 'MISSING_SUMMARY'
  | 'MISSING_THRESHOLD'
  | 'MISSING_VALUE'
  | 'MISSING_PROVISIONAL'
  | 'MALFORMED_ROADS_PAYLOAD'
  | 'MALFORMED_CROWD_PAYLOAD';

export interface AnomalyDecodeError {
  readonly code: AnomalyDecodeErrorCode;
  readonly message: string;
}

function decodeError(code: AnomalyDecodeErrorCode, message: string): AnomalyDecodeError {
  return { code, message };
}

// ─── Structural Helpers ──────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Reads a required non-empty string, or `null` when missing/wrong-typed. */
function requiredNonEmptyString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

// ─── Realtime Channel ────────────────────────────────────────

/**
 * Result of inspecting one realtime envelope.
 *
 * `ignored` keeps every other §13 event type flowing through the dashboard
 * untouched; `malformed` is the fail-closed outcome that must never mutate
 * popup state.
 */
export type RealtimeAnomalyDecodeResult =
  | { readonly kind: 'ignored' }
  | { readonly kind: 'malformed'; readonly error: AnomalyDecodeError }
  | { readonly kind: 'anomaly'; readonly presentation: AnomalyPresentation };

/**
 * Decodes a realtime envelope into an {@link AnomalyPresentation}.
 *
 * The transport layer (`realtime/transport_events.ts`) only guarantees the
 * event-type discriminant; `envelope.payload` is deliberately `unknown`. Every
 * field required by the canonical `AnomalyDetectedEvent` is therefore
 * re-verified here before it is trusted, and a frame that does not match fails
 * closed instead of rendering a partially-invented anomaly.
 *
 * `summary` is required by the contract but may legitimately be an empty
 * string; that decodes to `null` so the component can fall back to fixed UI
 * framing rather than showing a blank alert.
 */
export function decodeRealtimeAnomaly(
  envelope: RealtimeEventEnvelope,
): RealtimeAnomalyDecodeResult {
  if (envelope.eventType !== ANOMALY_EVENT_TYPE) {
    return { kind: 'ignored' };
  }

  const payload = envelope.payload;
  if (!isRecord(payload)) {
    return {
      kind: 'malformed',
      error: decodeError('NOT_AN_OBJECT', 'anomaly.detected 事件內容不是有效的物件結構'),
    };
  }

  if (payload['event_type'] !== ANOMALY_EVENT_TYPE) {
    return {
      kind: 'malformed',
      error: decodeError('EVENT_TYPE_MISMATCH', 'anomaly.detected 事件內容的 event_type 不一致'),
    };
  }

  const schemaVersion = requiredNonEmptyString(payload, 'schema_version');
  if (schemaVersion === null) {
    return {
      kind: 'malformed',
      error: decodeError('MISSING_SCHEMA_VERSION', 'anomaly.detected 缺少 schema_version'),
    };
  }

  const traceId = requiredNonEmptyString(payload, 'trace_id');
  if (traceId === null) {
    return {
      kind: 'malformed',
      error: decodeError('MISSING_TRACE_ID', 'anomaly.detected 缺少 trace_id'),
    };
  }

  const policyVersion = requiredNonEmptyString(payload, 'policy_version');
  if (policyVersion === null) {
    return {
      kind: 'malformed',
      error: decodeError('MISSING_POLICY_VERSION', 'anomaly.detected 缺少 policy_version'),
    };
  }

  const occurredAt = requiredNonEmptyString(payload, 'occurred_at');
  if (occurredAt === null) {
    return {
      kind: 'malformed',
      error: decodeError('MISSING_OCCURRED_AT', 'anomaly.detected 缺少 occurred_at'),
    };
  }

  const anomalyType = requiredNonEmptyString(payload, 'anomaly_type');
  if (anomalyType === null) {
    return {
      kind: 'malformed',
      error: decodeError('MISSING_ANOMALY_TYPE', 'anomaly.detected 缺少 anomaly_type'),
    };
  }

  const entityId = requiredNonEmptyString(payload, 'segment_or_station_id');
  if (entityId === null) {
    return {
      kind: 'malformed',
      error: decodeError('MISSING_ENTITY_ID', 'anomaly.detected 缺少 segment_or_station_id'),
    };
  }

  const summaryRaw = payload['summary'];
  if (typeof summaryRaw !== 'string') {
    return {
      kind: 'malformed',
      error: decodeError('MISSING_SUMMARY', 'anomaly.detected 的 summary 必須是字串'),
    };
  }

  const thresholdRaw = payload['threshold'];
  if (typeof thresholdRaw !== 'string') {
    return {
      kind: 'malformed',
      error: decodeError('MISSING_THRESHOLD', 'anomaly.detected 的 threshold 必須是字串'),
    };
  }

  const valueRaw = payload['value'];
  if (typeof valueRaw !== 'number' || !Number.isFinite(valueRaw)) {
    return {
      kind: 'malformed',
      error: decodeError('MISSING_VALUE', 'anomaly.detected 的 value 必須是有限數值'),
    };
  }

  const provisionalRaw = payload['provisional'];
  if (typeof provisionalRaw !== 'boolean') {
    return {
      kind: 'malformed',
      error: decodeError('MISSING_PROVISIONAL', 'anomaly.detected 的 provisional 必須是布林值'),
    };
  }

  return {
    kind: 'anomaly',
    presentation: {
      identity: buildIdentity(entityId, occurredAt),
      source: 'realtime',
      category: anomalyType,
      entityId,
      summary: summaryRaw.trim() === '' ? null : summaryRaw,
      observedAt: occurredAt,
      // `AnomalyDetectedEvent` has no staleness verdict; never invented.
      stale: null,
      provisional: provisionalRaw,
      // `AnomalyDetectedEvent` has no data_status field.
      dataStatus: null,
      serverSignals: [anomalyType],
      thresholdLabel: thresholdRaw.trim() === '' ? null : thresholdRaw,
      valueLabel: String(valueRaw),
    },
  };
}

// ─── Polling Channels ────────────────────────────────────────

/** One channel's server-owned verdict plus the anomaly to show when active. */
export interface ChannelSignalReading {
  readonly signal: ServerSignalState;
  /** Non-null only when `signal === 'active'`. */
  readonly presentation: AnomalyPresentation | null;
}

/** Result of decoding one polled payload for this feature. */
export type PolledAnomalyDecodeResult =
  | { readonly kind: 'malformed'; readonly error: AnomalyDecodeError }
  | { readonly kind: 'reading'; readonly reading: ChannelSignalReading };

function reading(
  signal: ServerSignalState,
  presentation: AnomalyPresentation | null = null,
): PolledAnomalyDecodeResult {
  return { kind: 'reading', reading: { signal, presentation } };
}

/**
 * Classifies one backend-supplied road `level` string.
 *
 * This is a vocabulary lookup, not a threshold test: the backend already
 * decided A/B/NONE and this function only reads its label. An unrecognized
 * non-empty value is reported as `unrecognized` so the caller can fail closed
 * instead of silently treating a future classification as "no anomaly".
 */
function classifyRoadLevel(level: string | null): 'active' | 'inactive' | 'unrecognized' {
  if (level === null) {
    // §12 documents `level: null` as "no classification supplied".
    return 'inactive';
  }
  if (level === ROAD_LEVEL_A || level === ROAD_LEVEL_B) {
    return 'active';
  }
  if (level === ROAD_LEVEL_NONE) {
    return 'inactive';
  }
  return 'unrecognized';
}

function roadPresentation(
  segment: RoadSegmentView,
  model: RoadReadModel,
): AnomalyPresentation {
  const observedAt = segment.observationTimestamp ?? model.timestamp;
  return {
    identity: buildIdentity(segment.segmentId, observedAt),
    source: 'roads',
    // The backend's own classification code, verbatim.
    category: segment.level,
    entityId: segment.segmentId,
    // `GET /roads` carries no anomaly narrative; the component supplies fixed
    // framing instead of inventing one.
    summary: null,
    observedAt,
    // No per-segment `stale` verdict exists in this contract.
    stale: null,
    provisional: model.provisional,
    dataStatus: segment.dataStatus ?? model.dataStatus,
    serverSignals: segment.level === null ? [] : [segment.level],
    thresholdLabel: null,
    valueLabel: null,
  };
}

/**
 * Reads the roads channel's server-owned anomaly verdict.
 *
 * Precedence, strictest first:
 * 1. an explicit active classification anywhere wins, even alongside
 *    `insufficient_data` or a stale row — an explicit backend verdict is never
 *    suppressed by envelope metadata
 * 2. an unrecognized classification with no explicit active verdict is
 *    `unknown` (fail closed)
 * 3. `insufficient_data` with no explicit active verdict is `unknown`, never
 *    `inactive`
 * 4. otherwise `inactive`
 *
 * Segment order is the backend's; the first active segment is the one shown.
 */
export function readRoadsAnomalySignal(model: RoadReadModel): ChannelSignalReading {
  let sawUnrecognized = false;

  for (const segment of model.segments) {
    const classification = classifyRoadLevel(segment.level);
    if (classification === 'active') {
      return { signal: 'active', presentation: roadPresentation(segment, model) };
    }
    if (classification === 'unrecognized') {
      sawUnrecognized = true;
    }
  }

  if (sawUnrecognized) {
    return { signal: 'unknown', presentation: null };
  }
  if (model.dataStatus === INSUFFICIENT_DATA_STATUS) {
    return { signal: 'unknown', presentation: null };
  }
  return { signal: 'inactive', presentation: null };
}

function crowdPresentation(
  station: CrowdStationRow,
  model: CrowdReadModel,
): AnomalyPresentation {
  const observedAt = station.observationTimestamp ?? model.decisionCutoffTimestamp;
  return {
    identity: buildIdentity(station.bsId, observedAt),
    source: 'crowd',
    // First backend flag code, verbatim; the full set is in `serverSignals`.
    category: station.flags[0] ?? null,
    entityId: station.bsId,
    // `GET /crowd` carries no anomaly narrative either.
    summary: null,
    observedAt,
    // The crowd payload *does* carry a backend staleness verdict.
    stale: station.stale,
    provisional: model.provisional,
    dataStatus: station.dataStatus ?? model.dataStatus,
    serverSignals: station.flags,
    thresholdLabel: null,
    valueLabel: null,
  };
}

/**
 * Reads the crowd channel's server-owned anomaly verdict.
 *
 * A non-empty per-station `flags` array is the backend's SOP trigger truth and
 * is the only active signal used here. The scope-level `multilingual` block is
 * intentionally *not* treated as an anomaly trigger: it is SOP-6 language-scope
 * truth, owned by the public-alert work, and reusing it here would put a second
 * meaning on it.
 *
 * Same precedence as the roads channel: an explicit flag wins over
 * `insufficient_data`, and `insufficient_data` without any flag is `unknown`
 * rather than `inactive`.
 */
export function readCrowdAnomalySignal(model: CrowdReadModel): ChannelSignalReading {
  for (const station of model.stations) {
    if (station.flags.length > 0) {
      return { signal: 'active', presentation: crowdPresentation(station, model) };
    }
  }

  if (model.dataStatus === INSUFFICIENT_DATA_STATUS) {
    return { signal: 'unknown', presentation: null };
  }
  return { signal: 'inactive', presentation: null };
}

/**
 * Decodes an already-fetched `GET /roads` body for this feature.
 *
 * Reuses the TASK-125 decoder rather than re-validating the route a second
 * way, so there is exactly one definition of a well-formed roads payload in
 * the client. Issues no request of its own.
 */
export function decodePolledRoadsAnomaly(raw: unknown): PolledAnomalyDecodeResult {
  const decoded = decodeRoadsResponse(raw);
  if (!decoded.ok) {
    return {
      kind: 'malformed',
      error: decodeError(
        'MALFORMED_ROADS_PAYLOAD',
        `GET /roads 回應結構不符（${decoded.error.code}），異常判讀維持前次狀態`,
      ),
    };
  }
  const result = readRoadsAnomalySignal(decoded.model);
  return reading(result.signal, result.presentation);
}

/**
 * Decodes an already-fetched `GET /crowd` body for this feature.
 *
 * Reuses the TASK-126 decoder for the same reason as
 * {@link decodePolledRoadsAnomaly}. Issues no request of its own.
 */
export function decodePolledCrowdAnomaly(raw: unknown): PolledAnomalyDecodeResult {
  const decoded = decodeCrowdResponse(raw);
  if (!decoded.ok) {
    return {
      kind: 'malformed',
      error: decodeError(
        'MALFORMED_CROWD_PAYLOAD',
        `GET /crowd 回應結構不符（${decoded.error.code}），異常判讀維持前次狀態`,
      ),
    };
  }
  const result = readCrowdAnomalySignal(decoded.model);
  return reading(result.signal, result.presentation);
}
