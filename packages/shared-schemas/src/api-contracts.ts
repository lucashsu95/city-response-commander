/**
 * API Contracts (§12)
 *
 * Defines request/response types for the HTTP API routes.
 * All responses carry schema_version, trace_id, policy, provisional.
 *
 * @module shared-schemas/api-contracts
 */

import type { DecisionCore } from './decision_core.js';
import type { DecisionNarrative } from './decision_narrative.js';
import type { PublishRecord } from './publish_record.js';
import type { Language } from './enums.js';
import type { PolicyMetadata } from './policy_metadata.js';

// ─── 事件注入 POST /incidents/{id}/inject ──────────────────

/** POST /incidents/{event_id}/inject — 請求體 */
export interface InjectIncidentRequest {
  /** 事件 ID (from live_incidents.json) */
  readonly event_id: string;
}

/** POST /incidents/{event_id}/inject — 回應體 */
export interface InjectIncidentResponse {
  /** 決策 ID */
  readonly decision_id: string;
  /** Trace ID for observability */
  readonly trace_id: string;
  /** Status indication */
  readonly status: string;
  /** Error code (when applicable) */
  readonly error_code?: string;
  /** Whether error is retryable */
  readonly retryable?: boolean;
}

// ─── 決策查詢 GET /decisions/{id} ──────────────────────────

/**
 * GET /decisions/{id} — DecisionReadModel (§10.11c)
 * Merges: Core + Narrative + Publish + execution summary
 */
export interface GetDecisionResponse {
  readonly schema_version: string;
  readonly trace_id: string;
  /** Immutable decision core (authoritative numbers) */
  readonly core: DecisionCore;
  /** All narrative items (REPORT/PUBLIC_ALERT/EXPLANATION) */
  readonly narratives: readonly DecisionNarrative[];
  /** Publish record (may be null if not published) */
  readonly publish?: PublishRecord;
  /** Read-only execution summary from IdempotencyTable (FIX 1) */
  readonly execution: {
    readonly status: string;
    readonly last_error: string | null;
    readonly retryable: boolean;
    readonly attempt_count: number;
  };
  readonly policy_version: string;
  readonly provisional: boolean;
}

// ─── 路段查詢 GET /roads ───────────────────────────────────

/**
 * Wire vocabulary for `data_status` on `GET /roads` (TASK-125).
 *
 * Lowercase on the wire, matching the domain layer's `IngestionResult.data_status`
 * and Strategy A (`'ready' | 'insufficient_data'`). The backend maps at the
 * serialization boundary via `toRoadsDataStatus`, preserving a single place to
 * adjust if the published vocabulary diverges again.
 *
 * Staleness is NOT a `data_status` value. Use {@link RoadSegmentDTO.is_stale},
 * which is the backend's staleness verdict and is `true` alongside `'ready'` for
 * a usable-but-older row.
 */
export type RoadsDataStatus = 'ready' | 'insufficient_data';

/** Every legal {@link RoadsDataStatus}, for exhaustiveness checks and validation. */
export const ROADS_DATA_STATUSES: readonly RoadsDataStatus[] = Object.freeze([
  'ready',
  'insufficient_data',
]);

/**
 * Snapshot timing evidence (HG-001).
 *
 * `stale` is the backend's verdict, not a hint. The window that makes a row too
 * old is `policy.max_staleness_minutes` — configuration, not a constant — so a
 * client comparing `staleness_minutes` against a literal would silently disagree
 * with the engine the moment that key changes. §9 forbids that second
 * implementation.
 */
export interface RoadsProvenance {
  /** Whether the selected row sits exactly on the replay position. */
  readonly exact_match: boolean;
  /** Minutes between the selected row and the cutoff. `null` when no row exists. */
  readonly staleness_minutes: number | null;
  /** Backend staleness truth: usable, but older than the replay position. */
  readonly stale: boolean;
  readonly data_status: RoadsDataStatus;
}

/**
 * Active policy, with the staleness window hoisted for convenience.
 *
 * Intersected with the full `PolicyMetadata` rather than replacing it: the
 * provisional badge (§10.6) needs `classification`, `guidance_id` and
 * `is_official`, and every §12 response is required to carry them.
 */
export type RoadsPolicyView = PolicyMetadata & {
  /** Hoisted from `time_alignment.max_staleness_minutes`. `null` when unset. */
  readonly max_staleness_minutes: number | null;
};

/**
 * One segment of `GET /roads` (TASK-125 canonical contract).
 *
 * Field names are lowercase snake_case, mapped from the official PascalCase
 * columns: `Segment_ID`→`segment_id`, `Road_Name`→`road_name`,
 * `Saturation_Score`→`saturation_score`, `Lane_Status`→`lane_status`.
 *
 * ## Why the value fields are nullable
 *
 * A segment with no legal row at the replay position reports `null`, never a
 * substituted value. This is §21 (no fabrication) and it is deliberate: a
 * `saturation_score` of `0` renders as free-flowing traffic, which is the exact
 * opposite of "unknown", and an operator could route traffic onto a road on that
 * basis. A gap is shown as a gap. `data_status: 'insufficient_data'` on the row
 * means every value field on it is `null`.
 */
export interface RoadSegmentDTO {
  /** Official `Segment_ID`. Always present — it is the row's identity. */
  readonly segment_id: string;
  /** Official `Road_Name`. `null` when no legal row exists. */
  readonly road_name: string | null;
  /** Official `Saturation_Score`. `null` when no legal row exists — never `0`. */
  readonly saturation_score: number | null;
  /** Official `Lane_Status`. `null` when no legal row exists. */
  readonly lane_status: string | null;
  /**
   * A/B grading from the domain engine. `null` means "no level", NOT "normal".
   *
   * Retained from the §12 shape: the Dashboard renders this directly and
   * re-deriving it from `saturation_score` would put a second, unvalidated copy
   * of the official boundary in the client (§9).
   */
  readonly level: string | null;
  /** Raw official timestamp of the SELECTED row, verbatim (§10.1). */
  readonly observation_timestamp: string | null;
  /** ISO-8601 form of the same instant, for machine consumption. */
  readonly observation_timestamp_iso: string | null;
  /** Minutes between this row and the cutoff. `null` when unmeasurable. */
  readonly staleness_minutes: number | null;
  /** Backend staleness verdict. May be `true` while `data_status` is `'ready'`. */
  readonly is_stale: boolean;
  /** Whether this row sits exactly on the replay position. */
  readonly exact_match: boolean;
  readonly data_status: RoadsDataStatus;
}

/**
 * `GET /roads` — canonical response (TASK-125).
 *
 * ## Timestamps carry two spellings
 *
 * `*_timestamp` is the raw official string, preserved verbatim because §10.1
 * requires it and because the Dashboard uses these as opaque replay keys that
 * must match `GET /timeline` byte-for-byte. `*_timestamp_iso` is the same instant
 * in ISO-8601 for machine consumption. Both are emitted; neither is derived
 * client-side.
 *
 * ## The top-level staleness fields are an aggregate
 *
 * `observation_timestamp`, `staleness_minutes` and `is_stale` at the envelope
 * level summarise the whole segment set: newest observation, WORST (maximum)
 * staleness, and `true` if ANY usable segment is stale. Per-segment truth lives
 * on each {@link RoadSegmentDTO}. The aggregate is worst-case on purpose — a
 * response summarised as fresh while containing a stale segment would understate
 * the risk the operator is deciding against.
 */
export interface GetRoadsResponse {
  readonly schema_version: string;
  readonly trace_id: string;
  readonly data_status: RoadsDataStatus;
  /** `true` exactly when `data_status === 'insufficient_data'`. */
  readonly insufficient_data: boolean;
  /** Present only when the source-hash STOP gate failed (§10.0, §21). */
  readonly stop_reason?: string | null;
  /** Replay position, raw official format. `null` when there is nothing to replay. */
  readonly decision_cutoff_timestamp: string | null;
  /** Replay position, ISO-8601. `null` when there is nothing to replay. */
  readonly decision_cutoff_timestamp_iso: string | null;
  /** Newest selected observation across all segments, raw official format. */
  readonly observation_timestamp: string | null;
  /** Newest selected observation across all segments, ISO-8601. */
  readonly observation_timestamp_iso: string | null;
  /** WORST staleness across usable segments. `null` when none is measurable. */
  readonly staleness_minutes: number | null;
  /** `true` when ANY usable segment is stale. May be `true` with `'ready'`. */
  readonly is_stale: boolean;
  readonly policy: RoadsPolicyView;
  /** `true` while any policy on this response is provisional (§10.6). */
  readonly provisional: boolean;
  /** Response-level snapshot evidence, aggregated as described above. */
  readonly provenance: RoadsProvenance;
  readonly segments: readonly RoadSegmentDTO[];
}

// ─── 人群查詢 GET /crowd ───────────────────────────────────

/** GET /crowd — 回應體 */
export interface GetCrowdResponse {
  readonly schema_version: string;
  readonly trace_id: string;
  readonly stations: readonly {
    readonly bs_id: string;
    readonly location_name: string;
    readonly user_count: number;
    readonly growth_rate: number;
    readonly roaming_pct_value: number;
    readonly roaming_pct_display: string;
    readonly flags: readonly string[];
  }[];
  readonly timestamp: string;
  readonly provisional: boolean;
}

// ─── What-if POST /what-if ──────────────────────────────────

/** POST /what-if — 請求體 (§14.5) */
export interface WhatIfRequest {
  /** raw_question is UNTRUSTED_USER_INPUT */
  readonly query: string;
}

/** POST /what-if — 回應體 (WhatIfResult §10.15) */
export interface WhatIfResponse {
  readonly schema_version: string;
  readonly trace_id: string;
  readonly request_id: string;
  readonly status: 'answered' | 'clarification_required';
  /** Triggered articles from stage 3 (LLM-prohibited) */
  readonly triggered_articles: readonly number[];
  /** Applied formula articles (LLM-prohibited) */
  readonly applied_formula_articles: readonly number[];
  /** Expected actions (LLM-prohibited) */
  readonly expected_actions: readonly string[];
  /** ETE preview if applicable */
  readonly ete_preview?: { readonly ete_minutes: number };
  /** SOP citations */
  readonly sop_citations: readonly { readonly article_no: number; readonly content: string }[];
  /** Stage 4 Bedrock explanation (LLM-writable) */
  readonly explanation_text?: string;
  /** Clarification prompt when status=clarification_required */
  readonly clarification_prompt?: string;
  /** What-if never mutates state */
  readonly does_not_mutate_state: true;
  readonly provisional: boolean;
}

// ─── 多語警示 ──────────────────────────────────────────────

/** Multilingual alert content */
export interface MultilingualAlert {
  /** Triggered SOP article */
  readonly triggered_sop: number;
  /** Languages included (determined by deterministic trigger) */
  readonly languages: readonly Language[];
  /** Message text per language */
  readonly messages: Partial<Record<Language, string>>;
}

// ─── GET /roads runtime validation (TASK-125) ──────────────

/**
 * Runtime schemas for the `GET /roads` contract.
 *
 * ## Why this is hand-written rather than Zod
 *
 * `@city-commander/shared-schemas` is the Layer 0 leaf: `config`, `domain`,
 * `ai-generator`, `rag`, `backend`, `frontend` and `infra` all depend on it, so a
 * runtime dependency added here lands in every Lambda bundle. The package
 * currently has zero runtime dependencies and the repo contains no Zod usage at
 * all — `validateConfig` in `packages/config/src/config_schema.ts` is likewise
 * hand-written. Keeping that property is worth more than the terser declaration.
 *
 * The exported surface is deliberately Zod-shaped (`parse` / `safeParse`,
 * `{success, data} | {success, error}`), so swapping to real Zod later is a
 * change inside this file and not at any call site.
 */

/** A validation failure, with the path to the offending field. */
export interface SchemaIssue {
  /** Dotted path, e.g. `segments.0.saturation_score`. */
  readonly path: string;
  readonly message: string;
}

/** Zod-compatible result of a non-throwing parse. */
export type SafeParseResult<T> =
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly error: SchemaValidationError };

/** Raised by `parse`. Carries every issue, not just the first. */
export class SchemaValidationError extends Error {
  public readonly issues: readonly SchemaIssue[];

  constructor(subject: string, issues: readonly SchemaIssue[]) {
    super(
      `${subject} failed validation:\n` +
        issues.map((issue) => `  - ${issue.path}: ${issue.message}`).join('\n'),
    );
    this.name = 'SchemaValidationError';
    this.issues = Object.freeze([...issues]);
  }
}

/** Minimal Zod-shaped schema object. */
export interface RuntimeSchema<T> {
  /** @throws SchemaValidationError */
  parse(input: unknown): T;
  safeParse(input: unknown): SafeParseResult<T>;
}

// ── Field-level checks ──

type Collector = (path: string, message: string) => void;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function checkString(value: unknown, path: string, fail: Collector): void {
  if (typeof value !== 'string') fail(path, `expected string, got ${typeOf(value)}`);
}

function checkNullableString(value: unknown, path: string, fail: Collector): void {
  if (value !== null && typeof value !== 'string') {
    fail(path, `expected string or null, got ${typeOf(value)}`);
  }
}

/**
 * Rejects `NaN` and `Infinity` as well as non-numbers.
 *
 * Strategy A yields `Infinity` when no legal row exists, and `JSON.stringify`
 * turns that into `null` silently. A schema that accepted `Infinity` would let
 * that coercion through unnoticed, so the backend must map it explicitly.
 */
function checkNullableFiniteNumber(value: unknown, path: string, fail: Collector): void {
  if (value === null) return;
  if (typeof value !== 'number') {
    fail(path, `expected number or null, got ${typeOf(value)}`);
    return;
  }
  if (!Number.isFinite(value)) {
    fail(path, `expected a finite number, got ${String(value)}`);
  }
}

function checkBoolean(value: unknown, path: string, fail: Collector): void {
  if (typeof value !== 'boolean') fail(path, `expected boolean, got ${typeOf(value)}`);
}

function checkDataStatus(value: unknown, path: string, fail: Collector): void {
  if (typeof value !== 'string' || !ROADS_DATA_STATUSES.includes(value as RoadsDataStatus)) {
    fail(path, `expected one of ${ROADS_DATA_STATUSES.join(' | ')}, got ${JSON.stringify(value)}`);
  }
}

function typeOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

// ── Segment ──

function validateSegment(input: unknown, basePath: string, fail: Collector): void {
  if (!isRecord(input)) {
    fail(basePath, `expected object, got ${typeOf(input)}`);
    return;
  }

  checkString(input.segment_id, `${basePath}.segment_id`, fail);
  if (input.segment_id === '') fail(`${basePath}.segment_id`, 'must not be empty');

  checkNullableString(input.road_name, `${basePath}.road_name`, fail);
  checkNullableFiniteNumber(input.saturation_score, `${basePath}.saturation_score`, fail);
  checkNullableString(input.lane_status, `${basePath}.lane_status`, fail);
  checkNullableString(input.level, `${basePath}.level`, fail);
  checkNullableString(input.observation_timestamp, `${basePath}.observation_timestamp`, fail);
  checkNullableString(
    input.observation_timestamp_iso,
    `${basePath}.observation_timestamp_iso`,
    fail,
  );
  checkNullableFiniteNumber(input.staleness_minutes, `${basePath}.staleness_minutes`, fail);
  checkBoolean(input.is_stale, `${basePath}.is_stale`, fail);
  checkBoolean(input.exact_match, `${basePath}.exact_match`, fail);
  checkDataStatus(input.data_status, `${basePath}.data_status`, fail);

  // The no-fabrication invariant, enforced rather than documented: a row with no
  // usable observation must not carry a value that renders as a real reading.
  if (input.data_status === 'insufficient_data') {
    for (const field of ['saturation_score', 'road_name', 'lane_status', 'level'] as const) {
      if (input[field] !== null) {
        fail(
          `${basePath}.${field}`,
          `must be null when data_status is insufficient_data (§21 no fabrication), got ${JSON.stringify(input[field])}`,
        );
      }
    }
  }
}

/** Runtime schema for one {@link RoadSegmentDTO}. */
export const RoadSegmentDTOSchema: RuntimeSchema<RoadSegmentDTO> = {
  safeParse(input: unknown): SafeParseResult<RoadSegmentDTO> {
    const issues: SchemaIssue[] = [];
    validateSegment(input, 'segment', (path, message) => issues.push({ path, message }));
    return issues.length === 0
      ? { success: true, data: input as RoadSegmentDTO }
      : { success: false, error: new SchemaValidationError('RoadSegmentDTO', issues) };
  },
  parse(input: unknown): RoadSegmentDTO {
    const result = this.safeParse(input);
    if (!result.success) throw result.error;
    return result.data;
  },
};

// ── Response ──

function validateRoadsResponse(input: unknown, fail: Collector): void {
  if (!isRecord(input)) {
    fail('$', `expected object, got ${typeOf(input)}`);
    return;
  }

  checkString(input.schema_version, 'schema_version', fail);
  checkString(input.trace_id, 'trace_id', fail);
  checkDataStatus(input.data_status, 'data_status', fail);
  checkBoolean(input.insufficient_data, 'insufficient_data', fail);
  checkNullableString(input.decision_cutoff_timestamp, 'decision_cutoff_timestamp', fail);
  checkNullableString(input.decision_cutoff_timestamp_iso, 'decision_cutoff_timestamp_iso', fail);
  checkNullableString(input.observation_timestamp, 'observation_timestamp', fail);
  checkNullableString(input.observation_timestamp_iso, 'observation_timestamp_iso', fail);
  checkNullableFiniteNumber(input.staleness_minutes, 'staleness_minutes', fail);
  checkBoolean(input.is_stale, 'is_stale', fail);
  checkBoolean(input.provisional, 'provisional', fail);

  // `insufficient_data` is a derived mirror of `data_status`. Letting the two
  // disagree would give a client two different answers to the same question.
  if (typeof input.insufficient_data === 'boolean' && typeof input.data_status === 'string') {
    const expected = input.data_status === 'insufficient_data';
    if (input.insufficient_data !== expected) {
      fail(
        'insufficient_data',
        `must equal (data_status === 'insufficient_data'); got ${String(input.insufficient_data)} with data_status=${String(input.data_status)}`,
      );
    }
  }

  if (!isRecord(input.policy)) {
    fail('policy', `expected object, got ${typeOf(input.policy)}`);
  } else {
    checkNullableFiniteNumber(
      input.policy.max_staleness_minutes,
      'policy.max_staleness_minutes',
      fail,
    );
  }

  if (!isRecord(input.provenance)) {
    fail('provenance', `expected object, got ${typeOf(input.provenance)}`);
  } else {
    checkBoolean(input.provenance.exact_match, 'provenance.exact_match', fail);
    checkNullableFiniteNumber(
      input.provenance.staleness_minutes,
      'provenance.staleness_minutes',
      fail,
    );
    checkBoolean(input.provenance.stale, 'provenance.stale', fail);
    checkDataStatus(input.provenance.data_status, 'provenance.data_status', fail);
  }

  if (!Array.isArray(input.segments)) {
    fail('segments', `expected array, got ${typeOf(input.segments)}`);
    return;
  }
  input.segments.forEach((segment, index) => {
    validateSegment(segment, `segments.${index}`, fail);
  });
}

/** Runtime schema for {@link GetRoadsResponse}. */
export const GetRoadsResponseSchema: RuntimeSchema<GetRoadsResponse> = {
  safeParse(input: unknown): SafeParseResult<GetRoadsResponse> {
    const issues: SchemaIssue[] = [];
    validateRoadsResponse(input, (path, message) => issues.push({ path, message }));
    return issues.length === 0
      ? { success: true, data: input as GetRoadsResponse }
      : { success: false, error: new SchemaValidationError('GetRoadsResponse', issues) };
  },
  parse(input: unknown): GetRoadsResponse {
    const result = this.safeParse(input);
    if (!result.success) throw result.error;
    return result.data;
  },
};

/**
 * Map the internal status onto the published wire vocabulary.
 *
 * Internal and published values are identical today. Stale-but-usable rows remain
 * `'ready'` with `is_stale: true`, which lets a client show the value AND its age.
 */
export function toRoadsDataStatus(internal: 'ready' | 'insufficient_data'): RoadsDataStatus {
  return internal;
}
