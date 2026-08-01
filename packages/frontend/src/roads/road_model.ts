/**
 * Road Read Model — Frontend Structural Decoder (§12 GET /roads, §16, §22.1 P7)
 *
 * `GetRoadsResponse` (canonical, `@city-commander/shared-schemas`) declares the
 * required shape returned by `GET /roads`:
 * `{ schema_version, trace_id, segments:[{segment_id, road_name,
 * saturation_score, level, lane_status}], timestamp, provisional }`.
 *
 * The API client (`api/client.ts`) parses the HTTP body with a bare
 * `JSON.parse` type assertion (`as T`) — the canonical interface is a
 * compile-time shape only, never a runtime guarantee. This module re-verifies
 * the actual JSON structurally before any field is trusted, so a malformed
 * body fails closed through a typed decode error instead of silently
 * rendering a fabricated "ready"/"empty" state (design principle also used by
 * `timeline/timeline_model.ts` for the same reason).
 *
 * HG-001 amendment (tasks.md TASK-125): "Show selected snapshot provenance and
 * stale/insufficient-data states on traffic panels." No canonical contract
 * field for this exists yet in `GetRoadsResponse` (cross-owner gap — see the
 * TASK-125 report). This module therefore reads a small set of *independently
 * optional* evidence fields, verbatim, only when the backend actually supplies
 * them — exactly the same pattern `timeline_model.ts` uses for HG-001 timing
 * evidence on `GET /timeline`. A field the backend omits is reported as
 * `null` ("unavailable"), never calculated, defaulted, or inferred from
 * `saturation_score` or `Date.now()`.
 *
 * This module computes nothing: no threshold comparison, no A/B
 * classification, no staleness calculation. `level` and `data_status` (when
 * present) are read exactly as the backend supplies them.
 *
 * @module frontend/roads/road_model
 */

// ─── Read Model ──────────────────────────────────────────────

/**
 * One road segment, exactly as returned by `GET /roads`, plus independently
 * optional HG-001 evidence fields read verbatim when supplied.
 */
export interface RoadSegmentView {
  /** `segment_id` — canonical identifier. */
  readonly segmentId: string;
  /** `road_name` — canonical display name. */
  readonly roadName: string;
  /** `saturation_score` — canonical value, display-only (never thresholded here). */
  readonly saturationScore: number;
  /** `level` — canonical backend-provided classification (`'A'` | `'B'` | other | null). */
  readonly level: string | null;
  /** `lane_status` — canonical value. */
  readonly laneStatus: string;
  /** Optional per-segment observation timestamp, read verbatim when supplied. */
  readonly observationTimestamp: string | null;
  /** Optional per-segment backend-computed staleness, read verbatim when supplied. */
  readonly stalenessMinutes: number | null;
  /** Optional per-segment `data_status`, read verbatim when supplied. */
  readonly dataStatus: string | null;
}

/** Validated `GET /roads` read model. */
export interface RoadReadModel {
  readonly schemaVersion: string;
  readonly traceId: string;
  /** Segments in server-provided order, never reordered or fabricated. */
  readonly segments: readonly RoadSegmentView[];
  /** `timestamp` — canonical snapshot timestamp for this response. */
  readonly timestamp: string;
  readonly provisional: boolean;
  /**
   * Response-level `data_status` (e.g. `'insufficient_data'`), read verbatim
   * when the backend supplies it. `null` when absent — never inferred from an
   * empty `segments` array.
   */
  readonly dataStatus: string | null;
}

// ─── Decode Errors ───────────────────────────────────────────

export type RoadDecodeErrorCode =
  | 'NOT_AN_OBJECT'
  | 'MISSING_SCHEMA_VERSION'
  | 'INVALID_SCHEMA_VERSION'
  | 'MISSING_TRACE_ID'
  | 'INVALID_TRACE_ID'
  | 'MISSING_SEGMENTS'
  | 'INVALID_SEGMENT'
  | 'MISSING_TIMESTAMP'
  | 'INVALID_TIMESTAMP'
  | 'MISSING_PROVISIONAL'
  | 'INVALID_PROVISIONAL'
  | 'MALFORMED_OPTIONAL_FIELD';

export interface RoadDecodeError {
  readonly code: RoadDecodeErrorCode;
  readonly message: string;
}

export type RoadDecodeResult =
  | { readonly ok: true; readonly model: RoadReadModel }
  | { readonly ok: false; readonly error: RoadDecodeError };

function decodeError(code: RoadDecodeErrorCode, message: string): RoadDecodeResult {
  return { ok: false, error: { code, message } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

type RequiredStringLookup = { readonly kind: 'MISSING' } | { readonly kind: 'INVALID' } | string;

function requiredNonEmptyString(
  record: Record<string, unknown>,
  key: string,
): RequiredStringLookup {
  if (!(key in record) || record[key] === null) {
    return { kind: 'MISSING' };
  }
  const value = record[key];
  if (typeof value !== 'string' || value.trim() === '') {
    return { kind: 'INVALID' };
  }
  return value;
}

type RequiredBooleanLookup = { readonly kind: 'MISSING' } | { readonly kind: 'INVALID' } | boolean;

function requiredBoolean(record: Record<string, unknown>, key: string): RequiredBooleanLookup {
  if (!(key in record) || record[key] === null) {
    return { kind: 'MISSING' };
  }
  const value = record[key];
  return typeof value === 'boolean' ? value : { kind: 'INVALID' };
}

/** Optional string field: `null` when absent, `undefined` when present-but-wrong-typed. */
function optionalString(
  record: Record<string, unknown>,
  key: string,
): string | null | undefined {
  if (!(key in record)) {
    return null;
  }
  const value = record[key];
  if (value === null) {
    return null;
  }
  return typeof value === 'string' ? value : undefined;
}

/** Optional finite-number field: same missing/malformed distinction as above. */
function optionalFiniteNumber(
  record: Record<string, unknown>,
  key: string,
): number | null | undefined {
  if (!(key in record)) {
    return null;
  }
  const value = record[key];
  if (value === null) {
    return null;
  }
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/**
 * Decodes one segment entry. `level` is read as a string-or-null exactly as
 * supplied — this never restricts it to `'A'`/`'B'`, since the backend is
 * documented (§12) to be able to supply another value or `null`, and the
 * frontend must render a neutral state for that case rather than rejecting
 * the whole response.
 */
function decodeSegment(raw: unknown): RoadSegmentView | 'MALFORMED' {
  if (!isRecord(raw)) {
    return 'MALFORMED';
  }

  const segmentIdLookup = requiredNonEmptyString(raw, 'segment_id');
  if (typeof segmentIdLookup === 'object') {
    return 'MALFORMED';
  }
  const roadNameLookup = requiredNonEmptyString(raw, 'road_name');
  if (typeof roadNameLookup === 'object') {
    return 'MALFORMED';
  }

  const saturationScoreRaw = raw['saturation_score'];
  if (typeof saturationScoreRaw !== 'number' || !Number.isFinite(saturationScoreRaw)) {
    return 'MALFORMED';
  }

  if (!('level' in raw)) {
    return 'MALFORMED';
  }
  const levelRaw = raw['level'];
  if (levelRaw !== null && typeof levelRaw !== 'string') {
    return 'MALFORMED';
  }
  const level = levelRaw;

  const laneStatusLookup = requiredNonEmptyString(raw, 'lane_status');
  if (typeof laneStatusLookup === 'object') {
    return 'MALFORMED';
  }

  const observationTimestamp = optionalString(raw, 'observation_timestamp');
  const stalenessMinutes = optionalFiniteNumber(raw, 'staleness_minutes');
  const dataStatus = optionalString(raw, 'data_status');

  if (
    observationTimestamp === undefined ||
    stalenessMinutes === undefined ||
    dataStatus === undefined
  ) {
    return 'MALFORMED';
  }

  return {
    segmentId: segmentIdLookup,
    roadName: roadNameLookup,
    saturationScore: saturationScoreRaw,
    level,
    laneStatus: laneStatusLookup,
    observationTimestamp,
    stalenessMinutes,
    dataStatus,
  };
}

/**
 * Decodes an unvalidated `GET /roads` JSON body into the authoritative
 * {@link RoadReadModel}.
 *
 * Fail-closed by construction: any required field that is missing or
 * wrong-typed, or any segment entry that does not match the canonical shape,
 * produces a typed decode error rather than a partially-guessed or fabricated
 * model. Segment order is preserved exactly as received; this function never
 * sorts or reorders, and never fabricates missing segments.
 */
export function decodeRoadsResponse(raw: unknown): RoadDecodeResult {
  if (!isRecord(raw)) {
    return decodeError('NOT_AN_OBJECT', 'GET /roads 回應不是有效的物件結構');
  }

  const schemaVersionLookup = requiredNonEmptyString(raw, 'schema_version');
  if (typeof schemaVersionLookup === 'object') {
    return schemaVersionLookup.kind === 'MISSING'
      ? decodeError('MISSING_SCHEMA_VERSION', 'GET /roads 回應缺少 schema_version')
      : decodeError('INVALID_SCHEMA_VERSION', 'schema_version 必須是非空字串');
  }
  const schemaVersion = schemaVersionLookup;

  const traceIdLookup = requiredNonEmptyString(raw, 'trace_id');
  if (typeof traceIdLookup === 'object') {
    return traceIdLookup.kind === 'MISSING'
      ? decodeError('MISSING_TRACE_ID', 'GET /roads 回應缺少 trace_id')
      : decodeError('INVALID_TRACE_ID', 'trace_id 必須是非空字串');
  }
  const traceId = traceIdLookup;

  const rawSegments = raw['segments'];
  if (!Array.isArray(rawSegments)) {
    return decodeError('MISSING_SEGMENTS', 'GET /roads 回應缺少 segments 陣列');
  }
  const segments: RoadSegmentView[] = [];
  for (const entry of rawSegments) {
    const decoded = decodeSegment(entry);
    if (decoded === 'MALFORMED') {
      return decodeError('INVALID_SEGMENT', 'segments 陣列包含結構不符的元素');
    }
    segments.push(decoded);
  }

  const timestampLookup = requiredNonEmptyString(raw, 'timestamp');
  if (typeof timestampLookup === 'object') {
    return timestampLookup.kind === 'MISSING'
      ? decodeError('MISSING_TIMESTAMP', 'GET /roads 回應缺少 timestamp')
      : decodeError('INVALID_TIMESTAMP', 'timestamp 必須是非空字串');
  }
  const timestamp = timestampLookup;

  const provisionalLookup = requiredBoolean(raw, 'provisional');
  if (typeof provisionalLookup === 'object') {
    return provisionalLookup.kind === 'MISSING'
      ? decodeError('MISSING_PROVISIONAL', 'GET /roads 回應缺少 provisional')
      : decodeError('INVALID_PROVISIONAL', 'provisional 必須是布林值');
  }
  const provisional = provisionalLookup;

  const dataStatus = optionalString(raw, 'data_status');
  if (dataStatus === undefined) {
    return decodeError('MALFORMED_OPTIONAL_FIELD', 'data_status 型別不正確');
  }

  return {
    ok: true,
    model: {
      schemaVersion,
      traceId,
      segments,
      timestamp,
      provisional,
      dataStatus,
    },
  };
}
