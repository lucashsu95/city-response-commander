/**
 * Timeline Read Model — Frontend Runtime Boundary Decoder (§12 GET /timeline)
 *
 * No canonical `GetTimelineResponse` exists yet in `@city-commander/shared-schemas`
 * (cross-owner gap; recorded in the TASK-124 report). This module is a
 * transport/presentation adapter that validates `unknown` JSON from
 * `GET /timeline` into a typed read model. It is deliberately NOT a duplicated
 * backend/domain contract:
 *
 * - it defines no business rules, only structural shape checks
 * - it never computes decision_cutoff, observation, or staleness — it only
 *   reads them, verbatim, when the backend supplies them
 * - a malformed response produces a typed decode failure, never a partially
 *   guessed timeline and never a fabricated empty timeline
 *
 * Contract basis (design §12): `GET /timeline` → `{timestamps[], current}`.
 * All API responses additionally carry `schema_version`/`trace_id`/`provisional`
 * (§12 preamble); decision-only responses also carry `policy`, which does not
 * apply to this non-decision route and is therefore not decoded here.
 *
 * HG-001 amendment (tasks.md TASK-124): "Display event timestamp, decision
 * cutoff, selected observation timestamp, and staleness during timeline
 * playback." These fields are read using the same names as the canonical
 * `SelectedSnapshot` contract (§10.5) for naming consistency, but are decoded
 * here as independent optional evidence — this module does not import or
 * construct a `SelectedSnapshot`.
 *
 * @module frontend/timeline/timeline_model
 */

// ─── Timestamp Format ───────────────────────────────────────

/**
 * The one supported timestamp form, proven by every fixture across design.md
 * and the source-traceability evidence (e.g. `"2026-05-20 22:10"`): exactly
 * `YYYY-MM-DD HH:MM`, no timezone suffix.
 *
 * Validation only — this never reformats, reparses through `Date`, or shifts
 * the value. The authoritative string is preserved byte-for-byte.
 */
const TIMESTAMP_PATTERN = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/;

/** Pure leap-year rule (Gregorian). No `Date`, no timezone involvement. */
function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Deterministic days-in-month lookup, 1-indexed month. Pure, no `Date`. */
function daysInMonth(year: number, month: number): number {
  const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month === 2 && isLeapYear(year)) {
    return 29;
  }
  return DAYS[month - 1] ?? 0;
}

/**
 * Structurally validates a `YYYY-MM-DD HH:MM` timestamp without using `Date`
 * (which would apply an implicit timezone). Deterministic and pure.
 *
 * Beyond the regex shape, this also rejects calendar-impossible dates (e.g.
 * `2026-02-31`, `2026-04-31`, `2026-02-29` in a non-leap year) using a pure
 * days-in-month/leap-year calculation — never `Date`/`Date.parse`, which would
 * silently roll an invalid date into a different one.
 */
export function isValidTimelineTimestamp(value: string): boolean {
  const match = TIMESTAMP_PATTERN.exec(value);
  if (match === null) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  if (month < 1 || month > 12) {
    return false;
  }
  if (day < 1 || day > daysInMonth(year, month)) {
    return false;
  }
  if (hour > 23) {
    return false;
  }
  if (minute > 59) {
    return false;
  }
  return true;
}

/** Result of formatting one authoritative timestamp for display. */
export type TimelineTimestampDisplay =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false };

/**
 * Formats an authoritative `YYYY-MM-DD HH:MM` timestamp for display.
 *
 * Presentation-only: the underlying value is already in the required display
 * form (validated at decode time), so this is a pass-through validation, never
 * a timezone conversion, a `Date`-based reformat, or a repair of malformed
 * input. An unsupported/malformed value yields `{ ok: false }` — the caller
 * must render an explicit unavailable state, never the current clock.
 */
export function formatTimelineTimestamp(value: string | null): TimelineTimestampDisplay {
  if (value === null || !isValidTimelineTimestamp(value)) {
    return { ok: false };
  }
  return { ok: true, text: value };
}

// ─── Read Model ──────────────────────────────────────────────

/**
 * HG-001 timing/provenance evidence, read verbatim from the backend when
 * supplied. Every field is independently optional: a field the backend omits
 * is reported as `null` ("unavailable"), never calculated, defaulted, or
 * substituted with a UI-selected timestamp or `Date.now()`.
 */
export interface TimelineTimingEvidence {
  /** `event_timestamp` — the incident's event timestamp (HG-001). */
  readonly eventTimestamp: string | null;
  /** `decision_cutoff_timestamp` — the decision cutoff (HG-001). */
  readonly decisionCutoffTimestamp: string | null;
  /** `observation_timestamp` — the selected observation timestamp (HG-001). */
  readonly observationTimestamp: string | null;
  /** `staleness_minutes` — backend-computed staleness, never derived here. */
  readonly stalenessMinutes: number | null;
  /** `selection_mode` — Strategy A selection mode, display-only. */
  readonly selectionMode: string | null;
  /** `guidance_id` — always `"HG-001"` when the backend supplies evidence. */
  readonly guidanceId: string | null;
}

/**
 * Validated `GET /timeline` read model (§12), the authoritative playback state.
 *
 * `schemaVersion`/`traceId`/`provisional` are the standard read envelope
 * fields every API response carries per design §12's preamble ("所有回應皆含
 * `schema_version`、`trace_id`...與 `provisional`"), so they are required here,
 * not optional. Only the HG-001 `timing` evidence remains independently
 * optional (no canonical backend contract exists for it yet).
 */
export interface TimelineReadModel {
  /** Server timestamp order, preserved exactly as received. Never reordered. */
  readonly timestamps: readonly string[];
  /** Authoritative current playback position, or `null` for an empty timeline. */
  readonly current: string | null;
  readonly schemaVersion: string;
  readonly traceId: string;
  readonly provisional: boolean;
  readonly timing: TimelineTimingEvidence;
}

// ─── Decode Errors ───────────────────────────────────────────

export type TimelineDecodeErrorCode =
  | 'NOT_AN_OBJECT'
  | 'MISSING_TIMESTAMPS'
  | 'INVALID_TIMESTAMPS'
  | 'INVALID_TIMESTAMP_FORMAT'
  | 'MISSING_CURRENT'
  | 'INVALID_CURRENT'
  | 'CURRENT_NOT_IN_TIMESTAMPS'
  | 'MISSING_SCHEMA_VERSION'
  | 'INVALID_SCHEMA_VERSION'
  | 'MISSING_TRACE_ID'
  | 'INVALID_TRACE_ID'
  | 'MISSING_PROVISIONAL'
  | 'INVALID_PROVISIONAL'
  | 'MALFORMED_OPTIONAL_FIELD';

export interface TimelineDecodeError {
  readonly code: TimelineDecodeErrorCode;
  readonly message: string;
}

export type TimelineDecodeResult =
  | { readonly ok: true; readonly model: TimelineReadModel }
  | { readonly ok: false; readonly error: TimelineDecodeError };

function decodeError(code: TimelineDecodeErrorCode, message: string): TimelineDecodeResult {
  return { ok: false, error: { code, message } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Reads one optional string field. Returns `null` when absent (unavailable),
 * and `undefined` when present with the wrong type (malformed — caller must
 * fail the whole decode; a wrong-typed present value is never silently
 * dropped or coerced).
 */
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

/**
 * Required non-empty-string envelope field lookup.
 *
 * Distinguishes three outcomes so the caller can report a precise error
 * without fabricating a default:
 * - `'MISSING'` — key absent or explicitly `null`
 * - `'INVALID'` — present but not a string, or an empty/whitespace-only string
 * - the string itself when present and non-empty
 */
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

/** Required boolean envelope field lookup; same missing/invalid distinction as above. */
type RequiredBooleanLookup = { readonly kind: 'MISSING' } | { readonly kind: 'INVALID' } | boolean;

function requiredBoolean(record: Record<string, unknown>, key: string): RequiredBooleanLookup {
  if (!(key in record) || record[key] === null) {
    return { kind: 'MISSING' };
  }
  const value = record[key];
  return typeof value === 'boolean' ? value : { kind: 'INVALID' };
}

/**
 * Reads one optional finite-number field. Structural validation only: this
 * never re-derives staleness from timestamps, it only checks the shape of a
 * backend-supplied number.
 */
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
 * Reads one optional HG-001 timestamp field, applying the same format check as
 * the primary timeline timestamps. Wrong type or malformed format both count
 * as malformed-present (never silently dropped).
 */
function optionalTimestampField(
  record: Record<string, unknown>,
  key: string,
): string | null | undefined {
  const raw = optionalString(record, key);
  if (raw === null || raw === undefined) {
    return raw;
  }
  return isValidTimelineTimestamp(raw) ? raw : undefined;
}

function decodeTimingEvidence(
  record: Record<string, unknown>,
): TimelineTimingEvidence | 'MALFORMED' {
  const eventTimestamp = optionalTimestampField(record, 'event_timestamp');
  const decisionCutoffTimestamp = optionalTimestampField(record, 'decision_cutoff_timestamp');
  const observationTimestamp = optionalTimestampField(record, 'observation_timestamp');
  const stalenessMinutes = optionalFiniteNumber(record, 'staleness_minutes');
  const selectionMode = optionalString(record, 'selection_mode');
  const guidanceId = optionalString(record, 'guidance_id');

  if (
    eventTimestamp === undefined ||
    decisionCutoffTimestamp === undefined ||
    observationTimestamp === undefined ||
    stalenessMinutes === undefined ||
    selectionMode === undefined ||
    guidanceId === undefined
  ) {
    return 'MALFORMED';
  }

  return {
    eventTimestamp,
    decisionCutoffTimestamp,
    observationTimestamp,
    stalenessMinutes,
    selectionMode,
    guidanceId,
  };
}

/**
 * Decodes an unvalidated `GET /timeline` JSON body into the authoritative
 * {@link TimelineReadModel}.
 *
 * Fail-closed by construction:
 * - missing/non-array `timestamps` → typed error, never a fabricated empty timeline
 * - any element that is not a valid `YYYY-MM-DD HH:MM` string → typed error
 * - `current` must be present; a non-empty timeline requires `current` to be
 *   one of the supplied timestamps (never fabricated, never inferred)
 * - an empty `timestamps` array accepts `current: null` as the only valid
 *   "no authoritative position yet" representation
 * - any present-but-wrong-typed optional/envelope/HG-001 field fails the whole
 *   decode rather than being silently ignored or coerced
 *
 * Timestamp order is preserved exactly as received; this function never sorts
 * or reorders.
 */
export function decodeTimelineResponse(raw: unknown): TimelineDecodeResult {
  if (!isRecord(raw)) {
    return decodeError('NOT_AN_OBJECT', 'GET /timeline 回應不是有效的物件結構');
  }

  const rawTimestamps = raw['timestamps'];
  if (!Array.isArray(rawTimestamps)) {
    return decodeError('MISSING_TIMESTAMPS', 'GET /timeline 回應缺少 timestamps 陣列');
  }

  const timestamps: string[] = [];
  for (const entry of rawTimestamps) {
    if (typeof entry !== 'string') {
      return decodeError('INVALID_TIMESTAMPS', 'timestamps 陣列包含非字串元素');
    }
    if (!isValidTimelineTimestamp(entry)) {
      return decodeError(
        'INVALID_TIMESTAMP_FORMAT',
        `timestamps 包含不符合 YYYY-MM-DD HH:MM 格式的值`,
      );
    }
    timestamps.push(entry);
  }

  if (!('current' in raw)) {
    return decodeError('MISSING_CURRENT', 'GET /timeline 回應缺少 current 欄位');
  }
  const rawCurrent = raw['current'];

  let current: string | null;
  if (rawCurrent === null) {
    if (timestamps.length > 0) {
      // A non-empty timeline must carry an authoritative current position.
      // The frontend never infers one from the first/last timestamp.
      return decodeError(
        'INVALID_CURRENT',
        'timestamps 非空時，current 不得為 null（前端不得推斷目前位置）',
      );
    }
    current = null;
  } else if (typeof rawCurrent === 'string') {
    if (!isValidTimelineTimestamp(rawCurrent)) {
      return decodeError('INVALID_CURRENT', 'current 不符合 YYYY-MM-DD HH:MM 格式');
    }
    if (!timestamps.includes(rawCurrent)) {
      return decodeError(
        'CURRENT_NOT_IN_TIMESTAMPS',
        'current 必須是 timestamps 其中之一（前端不得捏造目前位置）',
      );
    }
    current = rawCurrent;
  } else {
    return decodeError('INVALID_CURRENT', 'current 型別不正確');
  }

  // FIX 3: schema_version/trace_id/provisional are the standard read
  // envelope fields design §12 states every API response carries, so they
  // are required — never defaulted, never left null.
  const schemaVersionLookup = requiredNonEmptyString(raw, 'schema_version');
  if (typeof schemaVersionLookup === 'object') {
    return schemaVersionLookup.kind === 'MISSING'
      ? decodeError('MISSING_SCHEMA_VERSION', 'GET /timeline 回應缺少 schema_version')
      : decodeError('INVALID_SCHEMA_VERSION', 'schema_version 必須是非空字串');
  }
  const schemaVersion = schemaVersionLookup;

  const traceIdLookup = requiredNonEmptyString(raw, 'trace_id');
  if (typeof traceIdLookup === 'object') {
    return traceIdLookup.kind === 'MISSING'
      ? decodeError('MISSING_TRACE_ID', 'GET /timeline 回應缺少 trace_id')
      : decodeError('INVALID_TRACE_ID', 'trace_id 必須是非空字串');
  }
  const traceId = traceIdLookup;

  const provisionalLookup = requiredBoolean(raw, 'provisional');
  if (typeof provisionalLookup === 'object') {
    return provisionalLookup.kind === 'MISSING'
      ? decodeError('MISSING_PROVISIONAL', 'GET /timeline 回應缺少 provisional')
      : decodeError('INVALID_PROVISIONAL', 'provisional 必須是布林值');
  }
  const provisional = provisionalLookup;

  const timing = decodeTimingEvidence(raw);
  if (timing === 'MALFORMED') {
    return decodeError(
      'MALFORMED_OPTIONAL_FIELD',
      'HG-001 timing 證據欄位型別不正確',
    );
  }

  return {
    ok: true,
    model: {
      timestamps,
      current,
      schemaVersion,
      traceId,
      provisional,
      timing,
    },
  };
}
