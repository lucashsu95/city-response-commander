/**
 * Decision Read Model — Frontend Runtime Boundary Decoder
 * (§12 `GET /decisions/{decision_id}`, §10.11c four-source merge)
 *
 * TASK-132. Validates the unvalidated `GET /decisions/{decision_id}` JSON body
 * into a typed read model for the report / public-alert / explanation / route /
 * ETE panels.
 *
 * Why this module exists instead of `GetDecisionResponse` from
 * `@city-commander/shared-schemas`:
 *
 * - that interface predates the live aggregator and no longer matches the wire.
 *   It has no `decision_id`, no `data_status`, no `missing_narrative_types` and
 *   no `source_manifest_hash`; it types `core` as non-nullable (the live
 *   aggregator returns `core: null` together with
 *   `data_status=insufficient_data`), `publish` as an optional property rather
 *   than a nullable one, `execution` as non-nullable, and `policy_version` as
 *   `string` rather than `string | null`. Trusting it would let the panel read
 *   `core.cms_core_text` off a `null` core.
 * - `shared-schemas` is not this task's ownership, so the drift is reported
 *   rather than edited, exactly as TASK-126 did for `GetCrowdResponse`.
 * - `packages/frontend` must not import `packages/backend` (both are Layer 2),
 *   so the backend's `DecisionReadModel` cannot be imported either. The wire
 *   shape is mirrored here with the wire's own field names.
 *
 * What this module deliberately does NOT do (§9):
 *
 * - it never classifies a segment, evaluates an SOP threshold, re-ranks a
 *   route, averages a saturation value, or recomputes an ETE. Every number and
 *   boolean is carried through verbatim.
 * - it never fabricates a value. An omitted field decodes to `null`
 *   ("unavailable") and a present field of the wrong type fails the whole
 *   decode.
 * - it never repairs the `data_status` / `core` invariant. §10.11c guarantees
 *   `core === null` **iff** `data_status === 'insufficient_data'`; a payload
 *   that breaks it is a contract breach, reported as such.
 *
 * The nested `evidence` / `ete` / `excluded_candidates` / `incident_anchor`
 * blocks are intentionally left as a structurally-validated record on
 * {@link DecisionCoreView.fields}: their own owners decode them
 * (TASK-129 evidence, TASK-130 routes, TASK-131 ETE). No consumer may read a
 * field out of `fields` without decoding it first.
 *
 * @module frontend/decision/decision_read_model
 */

import {
  isRecord,
  optionalBoolean,
  optionalFiniteNumber,
  optionalNonEmptyString,
  optionalNumberArray,
  optionalRecord,
  optionalRecordArray,
  optionalSegmentReference,
  optionalSegmentReferenceArray,
  optionalString,
  optionalStringArray,
  requiredNonEmptyString,
} from './decode_primitives.js';

// ─── Read Model ──────────────────────────────────────────────

/**
 * Readiness of the merged view (§10.11c). Backend truth, never inferred:
 * `partial` is the normal Fast Path state where deterministic core exists but
 * some LLM narrative is still pending.
 */
export type DecisionDataStatus = 'ready' | 'partial' | 'insufficient_data';

const DECISION_DATA_STATUSES: readonly DecisionDataStatus[] = [
  'ready',
  'partial',
  'insufficient_data',
];

/** One `classifications[]` entry (§10.11a). `level` is backend truth. */
export interface SegmentClassificationView {
  readonly segmentId: string;
  /** `'A' | 'B' | null` on the wire; kept opaque so an unknown code still shows. */
  readonly level: string | null;
}

/**
 * `event_facts` — immutable official incident fields (§10.11a
 * `ImmutableIncidentFacts`). Read verbatim; used for event identification
 * (R13.1) and for the §21.3 deterministic fallback templates.
 */
export interface IncidentFactsView {
  readonly type: string | null;
  readonly location: string | null;
  readonly affectedSegment: string | null;
  /**
   * `affected_road` — contextual only for BS_ events
   * (`DISPLAY_AND_CONTEXT_ONLY`, §10.9b). Never a route and never a trigger.
   */
  readonly affectedRoad: string | null;
  readonly status: string | null;
  readonly severity: string | null;
  readonly description: string | null;
  readonly timestamp: string | null;
}

/**
 * Display-only projection of `core.ete` used by the report/alert panels.
 *
 * Only the values the deterministic report text and the §21.3 fallback
 * templates must quote are read here. The full calculation basis (affected-set
 * roles, per-road readings, sum/count/average, formula substitution, policy
 * provenance) is TASK-131's decoder.
 */
export interface DecisionEteSummaryView {
  /** `ete_minutes` — `null` when no ETE was computed. Never substituted. */
  readonly eteMinutes: number | null;
  /** `ete_lower_bound_minutes` — known lower bound from severity alone. */
  readonly eteLowerBoundMinutes: number | null;
  /** `base_clearance` — 60/40/20 by severity, backend-derived. */
  readonly baseClearance: number | null;
  /** `calculation_status`, verbatim (`computed` / `insufficient_common_snapshot`). */
  readonly calculationStatus: string | null;
  readonly manualConfirmationRequired: boolean | null;
}

/**
 * Display-only projection of `core.policy` (§10.6).
 *
 * Every field is an opaque string/boolean: this is not a second definition of
 * `PolicyMetadata`, and no mode value is interpreted or acted upon.
 */
export interface DecisionPolicyView {
  readonly classification: string | null;
  readonly status: string | null;
  readonly isOfficial: boolean | null;
  /** `official_unique_rule` (design §12 example). Absent on the live wire. */
  readonly officialUniqueRule: boolean | null;
  readonly configurable: boolean | null;
  readonly guidanceId: string | null;
  readonly timeAlignmentMode: string | null;
  readonly affectedRoadRole: string | null;
  readonly eteAffectedSetMode: string | null;
  readonly eteSnapshotMode: string | null;
  readonly incidentAnchorMode: string | null;
  readonly affectedIntersectionScopeMode: string | null;
  readonly multilingualScopeMode: string | null;
  readonly saturatedVsCongested: string | null;
}

/** Authoritative, LLM-prohibited decision core (§10.11a). */
export interface DecisionCoreView {
  readonly decisionId: string | null;
  readonly eventId: string | null;
  /** `occurred_at` — the core's own event instant, verbatim. */
  readonly occurredAt: string | null;
  /**
   * `decision_cutoff_timestamp` — the Strategy A replay cutoff, when the
   * backend supplies it. `null` otherwise: the cutoff is never inferred from
   * `occurredAt`, even though §9.5 says the two coincide.
   */
  readonly decisionCutoffTimestamp: string | null;
  readonly version: number | null;
  readonly coreHash: string | null;
  readonly sourceManifestHash: string | null;
  readonly triggeredArticles: readonly number[];
  readonly appliedFormulaArticles: readonly number[];
  readonly invokedProcedures: readonly string[];
  readonly classifications: readonly SegmentClassificationView[];
  readonly eventFacts: IncidentFactsView | null;
  readonly primaryEvacuation: string | null;
  readonly secondaryEvacuation: readonly string[];
  readonly ete: DecisionEteSummaryView | null;
  /** `cms_core_text` — deterministic official CMS wording (§10.11a, P37). */
  readonly cmsCoreText: string | null;
  readonly multilingualRequired: boolean | null;
  readonly provisional: boolean | null;
  readonly policy: DecisionPolicyView | null;
  /**
   * The structurally-validated `core` object as received.
   *
   * Exposed so the per-concern decoders owned by TASK-129/130/131 can validate
   * their own blocks (`evidence`, `excluded_candidates`, `incident_anchor`,
   * `ete`, `art1_measures`, `affected_intersection_scope`) without this module
   * duplicating them. It is NOT a licence to read a field directly: everything
   * rendered must pass through a decoder first.
   */
  readonly fields: Readonly<Record<string, unknown>>;
}

/** `narratives[]` item shared metadata (§10.11b). */
interface NarrativeMetaView {
  readonly coreVersionRef: number | null;
  readonly readyEventId: string | null;
}

/** `REPORT` narrative payload (§10.11b). All text is LLM-written. */
export interface ReportNarrativeView extends NarrativeMetaView {
  readonly reportText: string | null;
  /** Supplementary AI wording. Must never displace `cms_core_text` (P37). */
  readonly cmsExplanationText: string | null;
  readonly citationsPresentation: string | null;
}

/** One language entry of the `PUBLIC_ALERT` payload, in wire order. */
export interface PublicAlertTextView {
  /** Language code exactly as keyed on the wire (`zh`, `en`, `ja`, `ko`, …). */
  readonly language: string;
  readonly text: string;
}

/** `PUBLIC_ALERT` narrative payload (§10.11b, §10.13). */
export interface PublicAlertNarrativeView extends NarrativeMetaView {
  readonly texts: readonly PublicAlertTextView[];
}

/** `EXPLANATION` narrative payload (§10.11b). Consumed by TASK-129. */
export interface ExplanationNarrativeView extends NarrativeMetaView {
  readonly explanationText: string | null;
}

/** One `publish.audit_trail[]` entry (§10.17). */
export interface PublishAuditEntryView {
  readonly actor: string | null;
  readonly action: string | null;
  readonly fromState: string | null;
  readonly toState: string | null;
  readonly at: string | null;
}

/** Mutable publish state, physically separate from the core (§10.11d). */
export interface PublishRecordView {
  readonly publishState: string | null;
  readonly channels: readonly string[];
  readonly approvedBy: string | null;
  readonly publishedBy: string | null;
  readonly failureReason: string | null;
  readonly version: number | null;
  readonly updatedAt: string | null;
  readonly auditTrail: readonly PublishAuditEntryView[];
}

/** Read-only `execution` projection from IdempotencyTable (FIX 1). */
export interface ExecutionSummaryView {
  readonly status: string | null;
  readonly lastError: string | null;
  readonly retryable: boolean | null;
  readonly attemptCount: number | null;
}

/** Validated `GET /decisions/{decision_id}` read model. */
export interface DecisionReadModel {
  readonly schemaVersion: string;
  readonly traceId: string;
  readonly decisionId: string;
  readonly dataStatus: DecisionDataStatus;
  /** `null` exactly when `dataStatus === 'insufficient_data'`. */
  readonly core: DecisionCoreView | null;
  readonly report: ReportNarrativeView | null;
  readonly alert: PublicAlertNarrativeView | null;
  readonly explanation: ExplanationNarrativeView | null;
  /** `missing_narrative_types`, verbatim. Empty iff `dataStatus === 'ready'`. */
  readonly missingNarrativeTypes: readonly string[];
  readonly publish: PublishRecordView | null;
  readonly execution: ExecutionSummaryView | null;
  readonly policyVersion: string | null;
  /** Envelope-level provisional flag (any active Strategy A–F). */
  readonly provisional: boolean | null;
  readonly sourceManifestHash: string | null;
}

// ─── Decode Errors ───────────────────────────────────────────

export type DecisionDecodeErrorCode =
  | 'NOT_AN_OBJECT'
  | 'MISSING_SCHEMA_VERSION'
  | 'INVALID_SCHEMA_VERSION'
  | 'MISSING_TRACE_ID'
  | 'INVALID_TRACE_ID'
  | 'MISSING_DECISION_ID'
  | 'INVALID_DECISION_ID'
  | 'MISSING_DATA_STATUS'
  | 'INVALID_DATA_STATUS'
  | 'MISSING_CORE_KEY'
  | 'INVALID_CORE'
  | 'CORE_STATUS_MISMATCH'
  | 'INVALID_CORE_FIELD'
  | 'INVALID_POLICY'
  | 'INVALID_ETE'
  | 'MISSING_NARRATIVES'
  | 'INVALID_NARRATIVE'
  | 'INVALID_PUBLISH'
  | 'INVALID_EXECUTION'
  | 'MALFORMED_ENVELOPE_FIELD';

export interface DecisionDecodeError {
  readonly code: DecisionDecodeErrorCode;
  readonly message: string;
}

export type DecisionDecodeResult =
  | { readonly ok: true; readonly model: DecisionReadModel }
  | { readonly ok: false; readonly error: DecisionDecodeError };

function decodeError(code: DecisionDecodeErrorCode, message: string): DecisionDecodeResult {
  return { ok: false, error: { code, message } };
}

/** Internal marker for a malformed nested block. */
const MALFORMED = 'MALFORMED' as const;
type MalformedBlock = typeof MALFORMED;

// ─── Nested Decoders ─────────────────────────────────────────

function decodeClassifications(
  raw: readonly Record<string, unknown>[],
): readonly SegmentClassificationView[] | MalformedBlock {
  const rows: SegmentClassificationView[] = [];
  for (const entry of raw) {
    const segmentId = optionalNonEmptyString(entry, 'segment_id');
    const level = optionalString(entry, 'level');
    if (segmentId === undefined || segmentId === null || level === undefined) return MALFORMED;
    rows.push({ segmentId, level });
  }
  return rows;
}

function decodeEventFacts(raw: unknown): IncidentFactsView | null | MalformedBlock {
  if (raw === undefined || raw === null) return null;
  if (!isRecord(raw)) return MALFORMED;

  const type = optionalNonEmptyString(raw, 'type');
  const location = optionalNonEmptyString(raw, 'location');
  const affectedSegment = optionalNonEmptyString(raw, 'affected_segment');
  const affectedRoad = optionalNonEmptyString(raw, 'affected_road');
  const status = optionalNonEmptyString(raw, 'status');
  const severity = optionalNonEmptyString(raw, 'severity');
  const description = optionalString(raw, 'description');
  const timestamp = optionalNonEmptyString(raw, 'timestamp');

  if (
    type === undefined ||
    location === undefined ||
    affectedSegment === undefined ||
    affectedRoad === undefined ||
    status === undefined ||
    severity === undefined ||
    description === undefined ||
    timestamp === undefined
  ) {
    return MALFORMED;
  }

  return {
    type,
    location,
    affectedSegment,
    affectedRoad,
    status,
    severity,
    description,
    timestamp,
  };
}

function decodeEteSummary(raw: unknown): DecisionEteSummaryView | null | MalformedBlock {
  if (raw === undefined || raw === null) return null;
  if (!isRecord(raw)) return MALFORMED;

  const eteMinutes = optionalFiniteNumber(raw, 'ete_minutes');
  const eteLowerBoundMinutes = optionalFiniteNumber(raw, 'ete_lower_bound_minutes');
  const baseClearance = optionalFiniteNumber(raw, 'base_clearance');
  const calculationStatus = optionalNonEmptyString(raw, 'calculation_status');
  const manualConfirmationRequired = optionalBoolean(raw, 'manual_confirmation_required');

  if (
    eteMinutes === undefined ||
    eteLowerBoundMinutes === undefined ||
    baseClearance === undefined ||
    calculationStatus === undefined ||
    manualConfirmationRequired === undefined
  ) {
    return MALFORMED;
  }

  return {
    eteMinutes,
    eteLowerBoundMinutes,
    baseClearance,
    calculationStatus,
    manualConfirmationRequired,
  };
}

/** Reads `policy.<group>.<key>` without asserting the group exists. */
function nestedMode(
  policy: Record<string, unknown>,
  group: string,
  key: string,
): string | null | MalformedBlock {
  const nested = optionalRecord(policy, group);
  if (nested === undefined) return MALFORMED;
  if (nested === null) return null;
  const value = optionalNonEmptyString(nested, key);
  return value === undefined ? MALFORMED : value;
}

function decodePolicy(raw: unknown): DecisionPolicyView | null | MalformedBlock {
  if (raw === undefined || raw === null) return null;
  if (!isRecord(raw)) return MALFORMED;

  const classification = optionalNonEmptyString(raw, 'classification');
  const status = optionalNonEmptyString(raw, 'status');
  const isOfficial = optionalBoolean(raw, 'is_official');
  const officialUniqueRule = optionalBoolean(raw, 'official_unique_rule');
  const configurable = optionalBoolean(raw, 'configurable');
  const guidanceId = optionalNonEmptyString(raw, 'guidance_id');
  const saturatedVsCongested = optionalNonEmptyString(raw, 'saturated_vs_congested');

  const timeAlignmentMode = nestedMode(raw, 'time_alignment', 'mode');
  const affectedRoadRole = nestedMode(raw, 'affected_road', 'role');
  const eteAffectedSetMode = nestedMode(raw, 'ete', 'affected_set');
  const eteSnapshotMode = nestedMode(raw, 'ete', 'snapshot_mode');
  const incidentAnchorMode = nestedMode(raw, 'incident_anchor', 'mode');
  const affectedIntersectionScopeMode = nestedMode(raw, 'affected_intersection_scope', 'mode');
  const multilingualScopeMode = nestedMode(raw, 'multilingual_scope', 'mode');

  if (
    classification === undefined ||
    status === undefined ||
    isOfficial === undefined ||
    officialUniqueRule === undefined ||
    configurable === undefined ||
    guidanceId === undefined ||
    saturatedVsCongested === undefined ||
    timeAlignmentMode === MALFORMED ||
    affectedRoadRole === MALFORMED ||
    eteAffectedSetMode === MALFORMED ||
    eteSnapshotMode === MALFORMED ||
    incidentAnchorMode === MALFORMED ||
    affectedIntersectionScopeMode === MALFORMED ||
    multilingualScopeMode === MALFORMED
  ) {
    return MALFORMED;
  }

  return {
    classification,
    status,
    isOfficial,
    officialUniqueRule,
    configurable,
    guidanceId,
    timeAlignmentMode,
    affectedRoadRole,
    eteAffectedSetMode,
    eteSnapshotMode,
    incidentAnchorMode,
    affectedIntersectionScopeMode,
    multilingualScopeMode,
    saturatedVsCongested,
  };
}

type CoreDecodeResult =
  | { readonly ok: true; readonly core: DecisionCoreView }
  | { readonly ok: false; readonly error: DecisionDecodeError };

function coreFieldError(message: string): CoreDecodeResult {
  return { ok: false, error: { code: 'INVALID_CORE_FIELD', message } };
}

function decodeCore(raw: Record<string, unknown>): CoreDecodeResult {
  const decisionId = optionalNonEmptyString(raw, 'decision_id');
  const eventId = optionalNonEmptyString(raw, 'event_id');
  const occurredAt = optionalNonEmptyString(raw, 'occurred_at');
  const decisionCutoffTimestamp = optionalNonEmptyString(raw, 'decision_cutoff_timestamp');
  const version = optionalFiniteNumber(raw, 'version');
  const coreHash = optionalNonEmptyString(raw, 'core_hash');
  const sourceManifestHash = optionalNonEmptyString(raw, 'source_manifest_hash');
  const triggeredArticles = optionalNumberArray(raw, 'triggered_articles');
  const appliedFormulaArticles = optionalNumberArray(raw, 'applied_formula_articles');
  const invokedProcedures = optionalStringArray(raw, 'invoked_procedures');
  const rawClassifications = optionalRecordArray(raw, 'classifications');
  const primaryEvacuation = optionalSegmentReference(raw, 'primary_evacuation');
  const secondaryEvacuation = optionalSegmentReferenceArray(raw, 'secondary_evacuation');
  const cmsCoreText = optionalString(raw, 'cms_core_text');
  const multilingualRequired = optionalBoolean(raw, 'multilingual_required');
  const provisional = optionalBoolean(raw, 'provisional');

  if (
    decisionId === undefined ||
    eventId === undefined ||
    occurredAt === undefined ||
    decisionCutoffTimestamp === undefined ||
    version === undefined ||
    coreHash === undefined ||
    sourceManifestHash === undefined ||
    triggeredArticles === undefined ||
    appliedFormulaArticles === undefined ||
    invokedProcedures === undefined ||
    rawClassifications === undefined ||
    primaryEvacuation === undefined ||
    secondaryEvacuation === undefined ||
    cmsCoreText === undefined ||
    multilingualRequired === undefined ||
    provisional === undefined
  ) {
    return coreFieldError('core 區塊的欄位型別不正確');
  }

  const classifications = decodeClassifications(rawClassifications);
  if (classifications === MALFORMED) {
    return coreFieldError('core.classifications 元素型別不正確');
  }

  const eventFacts = decodeEventFacts(raw['event_facts']);
  if (eventFacts === MALFORMED) {
    return coreFieldError('core.event_facts 區塊型別不正確');
  }

  const ete = decodeEteSummary(raw['ete']);
  if (ete === MALFORMED) {
    return { ok: false, error: { code: 'INVALID_ETE', message: 'core.ete 區塊型別不正確' } };
  }

  const policy = decodePolicy(raw['policy']);
  if (policy === MALFORMED) {
    return { ok: false, error: { code: 'INVALID_POLICY', message: 'core.policy 區塊型別不正確' } };
  }

  return {
    ok: true,
    core: {
      decisionId,
      eventId,
      occurredAt,
      decisionCutoffTimestamp,
      version,
      coreHash,
      sourceManifestHash,
      triggeredArticles,
      appliedFormulaArticles,
      invokedProcedures,
      classifications,
      eventFacts,
      primaryEvacuation,
      secondaryEvacuation,
      ete,
      cmsCoreText,
      multilingualRequired,
      provisional,
      policy,
      fields: raw,
    },
  };
}

interface NarrativeBundle {
  readonly report: ReportNarrativeView | null;
  readonly alert: PublicAlertNarrativeView | null;
  readonly explanation: ExplanationNarrativeView | null;
}

/**
 * Reads the three required-set narrative items.
 *
 * A `narratives[]` element without a `narrative_type` fails the decode: it
 * cannot be attributed to a panel, and silently dropping it would present a
 * committed AI text as "not ready". An item of an unrecognized type is ignored
 * rather than rejected, so a future fourth narrative type does not break the
 * dashboard.
 */
function decodeNarratives(
  raw: readonly Record<string, unknown>[],
): NarrativeBundle | MalformedBlock {
  let report: ReportNarrativeView | null = null;
  let alert: PublicAlertNarrativeView | null = null;
  let explanation: ExplanationNarrativeView | null = null;

  for (const entry of raw) {
    const narrativeType = optionalNonEmptyString(entry, 'narrative_type');
    if (narrativeType === undefined || narrativeType === null) return MALFORMED;

    const coreVersionRef = optionalFiniteNumber(entry, 'core_version_ref');
    const readyEventId = optionalNonEmptyString(entry, 'ready_event_id');
    const payload = optionalRecord(entry, 'payload');
    if (coreVersionRef === undefined || readyEventId === undefined || payload === undefined) {
      return MALFORMED;
    }
    const meta: NarrativeMetaView = { coreVersionRef, readyEventId };
    const body = payload ?? {};

    if (narrativeType === 'REPORT') {
      const reportText = optionalString(body, 'report_text');
      const cmsExplanationText = optionalString(body, 'cms_explanation_text');
      const citationsPresentation = optionalString(body, 'citations_presentation');
      if (
        reportText === undefined ||
        cmsExplanationText === undefined ||
        citationsPresentation === undefined
      ) {
        return MALFORMED;
      }
      report = { ...meta, reportText, cmsExplanationText, citationsPresentation };
      continue;
    }

    if (narrativeType === 'PUBLIC_ALERT') {
      const textsRecord = optionalRecord(body, 'public_alert_text');
      if (textsRecord === undefined) return MALFORMED;
      const texts: PublicAlertTextView[] = [];
      for (const [language, value] of Object.entries(textsRecord ?? {})) {
        if (typeof value !== 'string') return MALFORMED;
        texts.push({ language, text: value });
      }
      alert = { ...meta, texts };
      continue;
    }

    if (narrativeType === 'EXPLANATION') {
      const explanationText = optionalString(body, 'explanation_text');
      if (explanationText === undefined) return MALFORMED;
      explanation = { ...meta, explanationText };
    }
  }

  return { report, alert, explanation };
}

function decodePublish(raw: unknown): PublishRecordView | null | MalformedBlock {
  if (raw === undefined || raw === null) return null;
  if (!isRecord(raw)) return MALFORMED;

  const publishState = optionalNonEmptyString(raw, 'publish_state');
  const channels = optionalStringArray(raw, 'channels');
  const approvedBy = optionalNonEmptyString(raw, 'approved_by');
  const publishedBy = optionalNonEmptyString(raw, 'published_by');
  const failureReason = optionalString(raw, 'failure_reason');
  const version = optionalFiniteNumber(raw, 'version');
  const updatedAt = optionalNonEmptyString(raw, 'updated_at');
  const rawTrail = optionalRecordArray(raw, 'audit_trail');

  if (
    publishState === undefined ||
    channels === undefined ||
    approvedBy === undefined ||
    publishedBy === undefined ||
    failureReason === undefined ||
    version === undefined ||
    updatedAt === undefined ||
    rawTrail === undefined
  ) {
    return MALFORMED;
  }

  const auditTrail: PublishAuditEntryView[] = [];
  for (const entry of rawTrail) {
    const actor = optionalNonEmptyString(entry, 'actor');
    const action = optionalNonEmptyString(entry, 'action');
    const fromState = optionalNonEmptyString(entry, 'from_state');
    const toState = optionalNonEmptyString(entry, 'to_state');
    const at = optionalNonEmptyString(entry, 'at');
    if (
      actor === undefined ||
      action === undefined ||
      fromState === undefined ||
      toState === undefined ||
      at === undefined
    ) {
      return MALFORMED;
    }
    auditTrail.push({ actor, action, fromState, toState, at });
  }

  return {
    publishState,
    channels,
    approvedBy,
    publishedBy,
    failureReason,
    version,
    updatedAt,
    auditTrail,
  };
}

function decodeExecution(raw: unknown): ExecutionSummaryView | null | MalformedBlock {
  if (raw === undefined || raw === null) return null;
  if (!isRecord(raw)) return MALFORMED;

  const status = optionalNonEmptyString(raw, 'status');
  const lastError = optionalString(raw, 'last_error');
  const retryable = optionalBoolean(raw, 'retryable');
  const attemptCount = optionalFiniteNumber(raw, 'attempt_count');

  if (
    status === undefined ||
    lastError === undefined ||
    retryable === undefined ||
    attemptCount === undefined
  ) {
    return MALFORMED;
  }
  return { status, lastError, retryable, attemptCount };
}

// ─── Entry Point ─────────────────────────────────────────────

/**
 * Decodes an unvalidated `GET /decisions/{decision_id}` body.
 *
 * Fail-closed by construction:
 * - `schema_version`, `trace_id`, `decision_id`, `data_status`, `core` and
 *   `narratives` must all be present
 * - the §10.11c invariant is enforced in both directions: `core: null` with a
 *   non-`insufficient_data` status, and a present `core` with
 *   `insufficient_data`, are both reported as `CORE_STATUS_MISMATCH` rather
 *   than silently normalized
 * - a present-but-wrong-typed field anywhere fails the decode
 * - absent optional evidence (`publish`, `execution`, `policy_version`,
 *   `provisional`, `core.ete`, `core.policy`) decodes to `null` so a panel can
 *   render "not supplied" instead of an invented value
 */
export function decodeDecisionReadModel(raw: unknown): DecisionDecodeResult {
  if (!isRecord(raw)) {
    return decodeError('NOT_AN_OBJECT', 'GET /decisions 回應不是有效的物件結構');
  }

  const schemaVersion = requiredNonEmptyString(raw, 'schema_version');
  if (typeof schemaVersion === 'object') {
    return schemaVersion.kind === 'MISSING'
      ? decodeError('MISSING_SCHEMA_VERSION', 'GET /decisions 回應缺少 schema_version')
      : decodeError('INVALID_SCHEMA_VERSION', 'schema_version 必須是非空字串');
  }

  const traceId = requiredNonEmptyString(raw, 'trace_id');
  if (typeof traceId === 'object') {
    return traceId.kind === 'MISSING'
      ? decodeError('MISSING_TRACE_ID', 'GET /decisions 回應缺少 trace_id')
      : decodeError('INVALID_TRACE_ID', 'trace_id 必須是非空字串');
  }

  const decisionId = requiredNonEmptyString(raw, 'decision_id');
  if (typeof decisionId === 'object') {
    return decisionId.kind === 'MISSING'
      ? decodeError('MISSING_DECISION_ID', 'GET /decisions 回應缺少 decision_id')
      : decodeError('INVALID_DECISION_ID', 'decision_id 必須是非空字串');
  }

  if (!('data_status' in raw) || raw['data_status'] === null || raw['data_status'] === undefined) {
    return decodeError('MISSING_DATA_STATUS', 'GET /decisions 回應缺少 data_status');
  }
  const rawDataStatus = raw['data_status'];
  if (
    typeof rawDataStatus !== 'string' ||
    !DECISION_DATA_STATUSES.includes(rawDataStatus as DecisionDataStatus)
  ) {
    return decodeError(
      'INVALID_DATA_STATUS',
      "data_status 必須是 'ready'、'partial' 或 'insufficient_data'",
    );
  }
  const dataStatus = rawDataStatus as DecisionDataStatus;

  if (!('core' in raw) || raw['core'] === undefined) {
    return decodeError('MISSING_CORE_KEY', 'GET /decisions 回應缺少 core 欄位（即使為 null）');
  }
  const rawCore = raw['core'];
  if (rawCore !== null && !isRecord(rawCore)) {
    return decodeError('INVALID_CORE', 'core 必須是物件或 null');
  }
  if (rawCore === null && dataStatus !== 'insufficient_data') {
    return decodeError(
      'CORE_STATUS_MISMATCH',
      `core 為 null 但 data_status 為 ${dataStatus}；違反 §10.11c 不變式`,
    );
  }
  if (rawCore !== null && dataStatus === 'insufficient_data') {
    return decodeError(
      'CORE_STATUS_MISMATCH',
      'data_status 為 insufficient_data 但 core 不為 null；違反 §10.11c 不變式',
    );
  }

  let core: DecisionCoreView | null = null;
  if (rawCore !== null) {
    const decodedCore = decodeCore(rawCore);
    if (!decodedCore.ok) {
      return { ok: false, error: decodedCore.error };
    }
    core = decodedCore.core;
  }

  const rawNarratives = raw['narratives'];
  if (!Array.isArray(rawNarratives)) {
    return decodeError('MISSING_NARRATIVES', 'GET /decisions 回應缺少 narratives 陣列');
  }
  const narrativeRecords = optionalRecordArray(raw, 'narratives');
  if (narrativeRecords === undefined) {
    return decodeError('INVALID_NARRATIVE', 'narratives 陣列包含非物件元素');
  }
  const narratives = decodeNarratives(narrativeRecords);
  if (narratives === MALFORMED) {
    return decodeError('INVALID_NARRATIVE', 'narratives 元素或 payload 型別不正確');
  }

  const missingNarrativeTypes = optionalStringArray(raw, 'missing_narrative_types');
  const policyVersion = optionalNonEmptyString(raw, 'policy_version');
  const provisional = optionalBoolean(raw, 'provisional');
  const sourceManifestHash = optionalNonEmptyString(raw, 'source_manifest_hash');
  if (
    missingNarrativeTypes === undefined ||
    policyVersion === undefined ||
    provisional === undefined ||
    sourceManifestHash === undefined
  ) {
    return decodeError('MALFORMED_ENVELOPE_FIELD', 'GET /decisions 回應的信封欄位型別不正確');
  }

  const publish = decodePublish(raw['publish']);
  if (publish === MALFORMED) {
    return decodeError('INVALID_PUBLISH', 'publish 區塊型別不正確');
  }

  const execution = decodeExecution(raw['execution']);
  if (execution === MALFORMED) {
    return decodeError('INVALID_EXECUTION', 'execution 區塊型別不正確');
  }

  return {
    ok: true,
    model: {
      schemaVersion,
      traceId,
      decisionId,
      dataStatus,
      core,
      report: narratives.report,
      alert: narratives.alert,
      explanation: narratives.explanation,
      missingNarrativeTypes,
      publish,
      execution,
      policyVersion,
      provisional,
      sourceManifestHash,
    },
  };
}
