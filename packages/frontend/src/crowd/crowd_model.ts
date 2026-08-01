/**
 * Crowd Read Model — Frontend Runtime Boundary Decoder (§12 `GET /crowd`)
 *
 * TASK-126. `GET /crowd` has no canonical response contract in
 * `@city-commander/shared-schemas` yet (the wire shape is declared by the
 * backend's `CrowdResponse`/`CrowdStationView`, and `packages/frontend` must not
 * import `packages/backend` — both are Layer 2). This module is therefore a
 * transport adapter that validates `unknown` JSON into a typed read model, in
 * the same spirit as `timeline/timeline_model.ts` for `GET /timeline`.
 *
 * What this module deliberately does NOT do (§9, AGENTS.md「決定性 > AI」):
 *
 * - it never compares `roaming_pct_value` with 30%, `User_Count` with 25,000,
 *   or `Growth_Rate` with ±0.20/0.30 — SOP-3/4/6 triggers arrive as backend
 *   `flags` / `multilingual` truth and are only carried through
 * - it never derives `stale` from `staleness_minutes`, and never derives
 *   `staleness_minutes` from `observation_timestamp` vs the cutoff: the window
 *   that makes a row stale is `policy.time_alignment.max_staleness_minutes`
 *   (configuration, not a constant), so only the backend may decide it
 * - it never fabricates a value. A field the backend omits decodes to `null`
 *   ("unavailable"), and a field present with the wrong type fails the whole
 *   decode instead of being coerced or silently dropped
 *
 * Field names mirror the wire payload exactly (`BS_ID`, `User_Count`,
 * `Roaming_User_Pct`, `in_multilingual_scope`, …); nothing is renamed on the
 * assumption of a different backend spelling.
 *
 * @module frontend/crowd/crowd_model
 */

import { isValidTimelineTimestamp } from '../timeline/timeline_model.js';

// ─── Read Model ──────────────────────────────────────────────

/** Envelope/per-entity data status (§12, §21). Backend truth, never inferred. */
export type CrowdDataStatus = 'ready' | 'insufficient_data';

/**
 * One base station as rendered by the panel.
 *
 * The HG-001 provenance block (`observationTimestamp`, `exactMatch`,
 * `stalenessMinutes`, `stale`, `dataStatus`) is read verbatim from the
 * backend's per-station `SnapshotProvenance`.
 */
export interface CrowdStationRow {
  /** `BS_ID` — official base-station id. */
  readonly bsId: string;
  /** `Location_Name` — official label. `null` when no legal row exists. */
  readonly locationName: string | null;
  /** `User_Count` — official reading. `null` means "no reading", not zero. */
  readonly userCount: number | null;
  /** `Growth_Rate` — official reading. `null` means "no reading", not zero. */
  readonly growthRate: number | null;
  /** `roaming_pct_value` — normalized ratio supplied by the backend. */
  readonly roamingPctValue: number | null;
  /** `Roaming_User_Pct` — official raw percent string, displayed verbatim. */
  readonly roamingPctDisplay: string | null;
  /**
   * `flags` — SOP trigger truth from the domain evaluators. Carried through as
   * opaque codes; the panel maps codes to labels but never adds or removes one.
   */
  readonly flags: readonly string[];
  /** `in_multilingual_scope` — Strategy F admission (OQ-005). `null` if absent. */
  readonly inMultilingualScope: boolean | null;
  /** `observation_timestamp` — raw official instant of the SELECTED row. */
  readonly observationTimestamp: string | null;
  /** `exact_match` — whether the row sits exactly on the replay position. */
  readonly exactMatch: boolean | null;
  /** `staleness_minutes` — backend-computed; never derived here. */
  readonly stalenessMinutes: number | null;
  /** `stale` — backend staleness verdict; never derived from the minutes. */
  readonly stale: boolean | null;
  /** Per-station status. `insufficient_data` ⇒ every reading above is `null`. */
  readonly dataStatus: CrowdDataStatus | null;
}

/**
 * Scope-level SOP-6 result (`multilingual`).
 *
 * Present so the panel can show art.6 truth without recomputing the 30%
 * threshold anywhere in the client.
 */
export interface MultilingualScopeSummary {
  readonly triggered: boolean;
  readonly multilingualRequired: boolean;
  readonly triggeringStationIds: readonly string[];
  readonly dataStatus: CrowdDataStatus;
  /** Active Strategy F mode (OQ-005, station-set dimension still open). */
  readonly scopeMode: string;
  readonly stationsInScope: readonly string[];
}

/**
 * Display-only projection of the response's `policy` envelope (§10.6).
 *
 * Only the fields the panel shows are read, all as opaque strings/booleans:
 * this is not a second definition of `PolicyMetadata`, and no mode string is
 * interpreted or acted upon here.
 */
export interface CrowdPolicyView {
  readonly classification: string | null;
  readonly status: string | null;
  readonly isOfficial: boolean | null;
  readonly guidanceId: string | null;
  /** `policy.multilingual_scope.mode` — OQ-005 station-scope policy. */
  readonly multilingualScopeMode: string | null;
}

/** Validated `GET /crowd` read model. */
export interface CrowdReadModel {
  readonly schemaVersion: string;
  readonly traceId: string;
  readonly dataStatus: CrowdDataStatus;
  /** Present only when the envelope reports `insufficient_data`. */
  readonly stopReason: string | null;
  /** Replay position every `stalenessMinutes` on this response refers to. */
  readonly decisionCutoffTimestamp: string | null;
  /** `true` while any policy on this response is provisional. `null` if absent. */
  readonly provisional: boolean | null;
  readonly policy: CrowdPolicyView | null;
  readonly multilingual: MultilingualScopeSummary | null;
  readonly stations: readonly CrowdStationRow[];
}

// ─── Decode Errors ───────────────────────────────────────────

export type CrowdDecodeErrorCode =
  | 'NOT_AN_OBJECT'
  | 'MISSING_SCHEMA_VERSION'
  | 'INVALID_SCHEMA_VERSION'
  | 'MISSING_TRACE_ID'
  | 'INVALID_TRACE_ID'
  | 'MISSING_DATA_STATUS'
  | 'INVALID_DATA_STATUS'
  | 'MISSING_STATIONS'
  | 'INVALID_STATION'
  | 'MISSING_STATION_ID'
  | 'MISSING_STATION_FLAGS'
  | 'INVALID_STATION_FIELD'
  | 'INVALID_MULTILINGUAL'
  | 'INVALID_POLICY'
  | 'MALFORMED_OPTIONAL_FIELD';

export interface CrowdDecodeError {
  readonly code: CrowdDecodeErrorCode;
  readonly message: string;
}

export type CrowdDecodeResult =
  | { readonly ok: true; readonly model: CrowdReadModel }
  | { readonly ok: false; readonly error: CrowdDecodeError };

function decodeError(code: CrowdDecodeErrorCode, message: string): CrowdDecodeResult {
  return { ok: false, error: { code, message } };
}

// ─── Structural Helpers ──────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * `null` when the key is absent or explicitly `null` (unavailable);
 * `undefined` when present with the wrong type (malformed — the caller must
 * fail the decode rather than drop the value).
 */
function optionalString(record: Record<string, unknown>, key: string): string | null | undefined {
  if (!(key in record)) return null;
  const value = record[key];
  if (value === null) return null;
  return typeof value === 'string' ? value : undefined;
}

/** Same contract as {@link optionalString} for finite numbers. */
function optionalFiniteNumber(
  record: Record<string, unknown>,
  key: string,
): number | null | undefined {
  if (!(key in record)) return null;
  const value = record[key];
  if (value === null) return null;
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

/** Same contract as {@link optionalString} for booleans. */
function optionalBoolean(record: Record<string, unknown>, key: string): boolean | null | undefined {
  if (!(key in record)) return null;
  const value = record[key];
  if (value === null) return null;
  return typeof value === 'boolean' ? value : undefined;
}

/**
 * Optional raw official timestamp, format-checked with the same
 * `YYYY-MM-DD HH:MM` rule the timeline uses (R11.5). A malformed present value
 * is malformed, never repaired or reformatted.
 */
function optionalTimestamp(
  record: Record<string, unknown>,
  key: string,
): string | null | undefined {
  const raw = optionalString(record, key);
  if (raw === null || raw === undefined) return raw;
  return isValidTimelineTimestamp(raw) ? raw : undefined;
}

/** Optional per-entity/envelope data status. */
function optionalDataStatus(
  record: Record<string, unknown>,
  key: string,
): CrowdDataStatus | null | undefined {
  const raw = optionalString(record, key);
  if (raw === null || raw === undefined) return raw;
  return raw === 'ready' || raw === 'insufficient_data' ? raw : undefined;
}

type RequiredStringLookup = { readonly kind: 'MISSING' } | { readonly kind: 'INVALID' } | string;

function requiredNonEmptyString(
  record: Record<string, unknown>,
  key: string,
): RequiredStringLookup {
  if (!(key in record) || record[key] === null) return { kind: 'MISSING' };
  const value = record[key];
  if (typeof value !== 'string' || value.trim() === '') return { kind: 'INVALID' };
  return value;
}

/** Reads an array of non-empty strings; `undefined` for any malformed element. */
function stringArray(value: unknown): readonly string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const items: string[] = [];
  for (const entry of value) {
    if (typeof entry !== 'string' || entry.trim() === '') return undefined;
    items.push(entry);
  }
  return items;
}

// ─── Nested Decoders ─────────────────────────────────────────

/**
 * Decodes one station row.
 *
 * `BS_ID` and `flags` are required: a row without an id cannot be attributed,
 * and a row without `flags` would leave the panel unable to distinguish "no SOP
 * triggered" from "the backend did not say". Fail closed instead of rendering a
 * silent empty flag list.
 */
function decodeStation(
  raw: unknown,
):
  | { readonly ok: true; readonly row: CrowdStationRow }
  | { readonly ok: false; readonly error: CrowdDecodeError } {
  if (!isRecord(raw)) {
    return {
      ok: false,
      error: { code: 'INVALID_STATION', message: 'stations 陣列包含非物件元素' },
    };
  }

  const idLookup = requiredNonEmptyString(raw, 'BS_ID');
  if (typeof idLookup === 'object') {
    return {
      ok: false,
      error: { code: 'MISSING_STATION_ID', message: 'stations 元素缺少有效的 BS_ID' },
    };
  }

  if (!('flags' in raw)) {
    return {
      ok: false,
      error: {
        code: 'MISSING_STATION_FLAGS',
        message: `基地台 ${idLookup} 缺少 flags；前端不得自行判定 SOP 觸發`,
      },
    };
  }
  const flags = stringArray(raw['flags']);
  if (flags === undefined) {
    return {
      ok: false,
      error: {
        code: 'INVALID_STATION_FIELD',
        message: `基地台 ${idLookup} 的 flags 必須是非空字串陣列`,
      },
    };
  }

  const locationName = optionalString(raw, 'Location_Name');
  const userCount = optionalFiniteNumber(raw, 'User_Count');
  const growthRate = optionalFiniteNumber(raw, 'Growth_Rate');
  const roamingPctValue = optionalFiniteNumber(raw, 'roaming_pct_value');
  const roamingPctDisplay = optionalString(raw, 'Roaming_User_Pct');
  const inMultilingualScope = optionalBoolean(raw, 'in_multilingual_scope');
  const observationTimestamp = optionalTimestamp(raw, 'observation_timestamp');
  const exactMatch = optionalBoolean(raw, 'exact_match');
  const stalenessMinutes = optionalFiniteNumber(raw, 'staleness_minutes');
  const stale = optionalBoolean(raw, 'stale');
  const dataStatus = optionalDataStatus(raw, 'data_status');

  if (
    locationName === undefined ||
    userCount === undefined ||
    growthRate === undefined ||
    roamingPctValue === undefined ||
    roamingPctDisplay === undefined ||
    inMultilingualScope === undefined ||
    observationTimestamp === undefined ||
    exactMatch === undefined ||
    stalenessMinutes === undefined ||
    stale === undefined ||
    dataStatus === undefined
  ) {
    return {
      ok: false,
      error: {
        code: 'INVALID_STATION_FIELD',
        message: `基地台 ${idLookup} 的欄位型別不正確`,
      },
    };
  }

  return {
    ok: true,
    row: {
      bsId: idLookup,
      locationName,
      userCount,
      growthRate,
      roamingPctValue,
      roamingPctDisplay,
      flags,
      inMultilingualScope,
      observationTimestamp,
      exactMatch,
      stalenessMinutes,
      stale,
      dataStatus,
    },
  };
}

/** Decodes the scope-level `multilingual` block. Absent ⇒ `null`. */
function decodeMultilingual(raw: unknown): MultilingualScopeSummary | null | 'MALFORMED' {
  if (raw === undefined || raw === null) return null;
  if (!isRecord(raw)) return 'MALFORMED';

  const triggered = optionalBoolean(raw, 'triggered');
  const multilingualRequired = optionalBoolean(raw, 'multilingual_required');
  const dataStatus = optionalDataStatus(raw, 'data_status');
  const scopeMode = optionalString(raw, 'scope_mode');
  const triggeringStationIds =
    'triggering_station_ids' in raw ? stringArray(raw['triggering_station_ids']) : [];
  const stationsInScope = 'stations_in_scope' in raw ? stringArray(raw['stations_in_scope']) : [];

  if (
    triggered === undefined ||
    triggered === null ||
    multilingualRequired === undefined ||
    multilingualRequired === null ||
    dataStatus === undefined ||
    dataStatus === null ||
    scopeMode === undefined ||
    scopeMode === null ||
    triggeringStationIds === undefined ||
    stationsInScope === undefined
  ) {
    return 'MALFORMED';
  }

  return {
    triggered,
    multilingualRequired,
    triggeringStationIds,
    dataStatus,
    scopeMode,
    stationsInScope,
  };
}

/** Decodes the display-only `policy` projection. Absent ⇒ `null`. */
function decodePolicy(raw: unknown): CrowdPolicyView | null | 'MALFORMED' {
  if (raw === undefined || raw === null) return null;
  if (!isRecord(raw)) return 'MALFORMED';

  const classification = optionalString(raw, 'classification');
  const status = optionalString(raw, 'status');
  const isOfficial = optionalBoolean(raw, 'is_official');
  const guidanceId = optionalString(raw, 'guidance_id');

  const scopeRaw = raw['multilingual_scope'];
  let multilingualScopeMode: string | null = null;
  if (scopeRaw !== undefined && scopeRaw !== null) {
    if (!isRecord(scopeRaw)) return 'MALFORMED';
    const mode = optionalString(scopeRaw, 'mode');
    if (mode === undefined) return 'MALFORMED';
    multilingualScopeMode = mode;
  }

  if (
    classification === undefined ||
    status === undefined ||
    isOfficial === undefined ||
    guidanceId === undefined
  ) {
    return 'MALFORMED';
  }

  return { classification, status, isOfficial, guidanceId, multilingualScopeMode };
}

// ─── Entry Point ─────────────────────────────────────────────

/**
 * Decodes an unvalidated `GET /crowd` JSON body into {@link CrowdReadModel}.
 *
 * Fail-closed by construction:
 * - `schema_version`, `trace_id`, `data_status` and `stations` are required
 * - a station without `BS_ID` or `flags` fails the decode; the client is not
 *   allowed to guess either one
 * - present-but-wrong-typed fields fail the decode instead of being coerced
 * - absent optional evidence (`policy`, `multilingual`, `provisional`,
 *   `decision_cutoff_timestamp`) decodes to `null` so the panel can render an
 *   explicit "not supplied" state rather than an invented one
 */
export function decodeCrowdResponse(raw: unknown): CrowdDecodeResult {
  if (!isRecord(raw)) {
    return decodeError('NOT_AN_OBJECT', 'GET /crowd 回應不是有效的物件結構');
  }

  const schemaVersionLookup = requiredNonEmptyString(raw, 'schema_version');
  if (typeof schemaVersionLookup === 'object') {
    return schemaVersionLookup.kind === 'MISSING'
      ? decodeError('MISSING_SCHEMA_VERSION', 'GET /crowd 回應缺少 schema_version')
      : decodeError('INVALID_SCHEMA_VERSION', 'schema_version 必須是非空字串');
  }

  const traceIdLookup = requiredNonEmptyString(raw, 'trace_id');
  if (typeof traceIdLookup === 'object') {
    return traceIdLookup.kind === 'MISSING'
      ? decodeError('MISSING_TRACE_ID', 'GET /crowd 回應缺少 trace_id')
      : decodeError('INVALID_TRACE_ID', 'trace_id 必須是非空字串');
  }

  if (!('data_status' in raw) || raw['data_status'] === null) {
    return decodeError('MISSING_DATA_STATUS', 'GET /crowd 回應缺少 data_status');
  }
  const dataStatus = optionalDataStatus(raw, 'data_status');
  if (dataStatus === undefined || dataStatus === null) {
    return decodeError('INVALID_DATA_STATUS', "data_status 必須是 'ready' 或 'insufficient_data'");
  }

  const rawStations = raw['stations'];
  if (!Array.isArray(rawStations)) {
    return decodeError('MISSING_STATIONS', 'GET /crowd 回應缺少 stations 陣列');
  }

  const stations: CrowdStationRow[] = [];
  for (const entry of rawStations) {
    const decoded = decodeStation(entry);
    if (!decoded.ok) {
      return { ok: false, error: decoded.error };
    }
    stations.push(decoded.row);
  }

  const stopReason = optionalString(raw, 'stop_reason');
  const decisionCutoffTimestamp = optionalTimestamp(raw, 'decision_cutoff_timestamp');
  const provisional = optionalBoolean(raw, 'provisional');
  if (
    stopReason === undefined ||
    decisionCutoffTimestamp === undefined ||
    provisional === undefined
  ) {
    return decodeError('MALFORMED_OPTIONAL_FIELD', 'GET /crowd 回應的信封欄位型別不正確');
  }

  const multilingual = decodeMultilingual(raw['multilingual']);
  if (multilingual === 'MALFORMED') {
    return decodeError('INVALID_MULTILINGUAL', 'multilingual 區塊型別不正確');
  }

  const policy = decodePolicy(raw['policy']);
  if (policy === 'MALFORMED') {
    return decodeError('INVALID_POLICY', 'policy 區塊型別不正確');
  }

  return {
    ok: true,
    model: {
      schemaVersion: schemaVersionLookup,
      traceId: traceIdLookup,
      dataStatus,
      stopReason,
      decisionCutoffTimestamp,
      provisional,
      policy,
      multilingual,
      stations,
    },
  };
}
