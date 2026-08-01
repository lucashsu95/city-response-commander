/**
 * EvidenceTrace — Frontend Runtime Boundary Decoder (§10.10, R15, P26/P27)
 *
 * TASK-129. Validates the `core.evidence` block of the
 * `GET /decisions/{decision_id}` payload into the explanation chain the
 * dashboard renders: classification reasoning with its data points, per-route
 * exclusion reasons, and the SOP citations covering `citation_article_set`.
 *
 * Contract drift, reported rather than papered over: the live backend's
 * `buildEvidenceTrace` emits only `decision_id`, `classification_reasoning`,
 * `excluded_routes`, `sop_citations` and `data_points`. Design §10.10 also
 * specifies four HG-001 blocks — `observation_selection`,
 * `affected_set_construction`, `formula_substitution` and `policy_provenance`.
 * They are decoded here as independently optional evidence: present ⇒ rendered
 * verbatim, absent ⇒ `null`, so the panel discloses the gap instead of
 * reconstructing any of it client-side.
 *
 * Nothing in this module derives a decision. In particular:
 *
 * - the threshold in `classification_reasoning` is a backend *string* that is
 *   displayed, never parsed and never re-applied to the value beside it
 * - the conclusion is displayed as given, even if the value would suggest a
 *   different level under SOP-1 (§9)
 * - `formula_substitution` numbers are read, never summed or averaged
 * - an excluded route with a blank reason is surfaced as a contract breach
 *   (R13.3 makes a non-empty reason the server's guarantee), never hidden
 *
 * @module frontend/decision/evidence_model
 */

import {
  isRecord,
  optionalBoolean,
  optionalFiniteNumber,
  optionalNonEmptyString,
  optionalRecord,
  optionalRecordArray,
  optionalString,
} from './decode_primitives.js';

// ─── Read Model ──────────────────────────────────────────────

/** One segment's grading reasoning (§10.10). All four fields are backend truth. */
export interface ClassificationReasoningView {
  readonly segmentId: string;
  /** The saturation value the backend used. Displayed, never re-thresholded. */
  readonly value: number | null;
  /** The threshold expression as text (e.g. `">= 0.95"`). Displayed verbatim. */
  readonly threshold: string | null;
  /** The backend's conclusion (`A` / `B` / `normal` / …). Authoritative. */
  readonly conclusion: string | null;
}

/** One excluded route and its reason (§10.10, R13.3). */
export interface ExcludedRouteReasonView {
  readonly segmentId: string;
  /** `null` only when the server broke its non-empty-reason guarantee. */
  readonly reason: string | null;
}

/** One SOP citation, preserved verbatim from KB Retrieve or the S3 fallback. */
export interface SopCitationView {
  readonly articleNo: number;
  readonly sourceLocation: string | null;
  readonly content: string | null;
  readonly score: number | null;
}

/** One data point used by the decision (§10.10). */
export interface DataPointView {
  readonly source: string | null;
  readonly field: string | null;
  /** `string | number | boolean` on the wire; kept in its original form. */
  readonly value: string | number | boolean | null;
  readonly timestamp: string | null;
}

/**
 * HG-001 observation-selection evidence (§10.10, Strategy A).
 * Absent on the live wire today.
 */
export interface ObservationSelectionView {
  readonly entityId: string | null;
  readonly cutoff: string | null;
  readonly observationTimestamp: string | null;
  /** `staleness` as supplied. Never derived from the two timestamps above. */
  readonly staleness: number | null;
  readonly exactMatch: boolean | null;
  readonly mode: string | null;
}

/**
 * HG-001 affected-set construction evidence (§10.10, Strategy C): which segment
 * entered the ETE set, in which role, and why. Absent on the live wire today.
 */
export interface AffectedSetConstructionView {
  readonly segmentId: string;
  /** `INCIDENT` / `PRIMARY` / `SECONDARY` as supplied. Never inferred. */
  readonly role: string | null;
  readonly included: boolean | null;
  readonly reason: string | null;
}

/**
 * HG-001 formula-substitution evidence (§10.10).
 *
 * Design §10.10 names the fields `sum`/`count`/`average`/`base`/`penalty`/`ETE`;
 * the §10.9 ETE block names the same quantities `saturation_sum`/`road_count`/
 * `avg_saturation`/`base_clearance`/`congestion_penalty`/`ete_minutes`. Both
 * documented spellings are accepted; neither value is computed here.
 */
export interface FormulaSubstitutionView {
  readonly sum: number | null;
  readonly count: number | null;
  readonly average: number | null;
  readonly base: number | null;
  readonly penalty: number | null;
  readonly ete: number | null;
}

/** HG-001 policy provenance evidence (§10.10). */
export interface PolicyProvenanceView {
  readonly policyMode: string | null;
  readonly guidanceId: string | null;
  readonly configurable: boolean | null;
}

/** Validated `core.evidence` block. */
export interface EvidenceTraceView {
  readonly decisionId: string | null;
  readonly classificationReasoning: readonly ClassificationReasoningView[];
  readonly excludedRoutes: readonly ExcludedRouteReasonView[];
  readonly sopCitations: readonly SopCitationView[];
  readonly dataPoints: readonly DataPointView[];
  /** `null` when the backend supplied no `observation_selection` block. */
  readonly observationSelection: readonly ObservationSelectionView[] | null;
  /** `null` when the backend supplied no `affected_set_construction` block. */
  readonly affectedSetConstruction: readonly AffectedSetConstructionView[] | null;
  /** `null` when the backend supplied no `formula_substitution` block. */
  readonly formulaSubstitution: FormulaSubstitutionView | null;
  /** `null` when the backend supplied no `policy_provenance` block. */
  readonly policyProvenance: PolicyProvenanceView | null;
}

// ─── Decode Result ───────────────────────────────────────────

export type EvidenceDecodeErrorCode =
  | 'NOT_AN_OBJECT'
  | 'INVALID_CLASSIFICATION_REASONING'
  | 'INVALID_EXCLUDED_ROUTES'
  | 'INVALID_SOP_CITATIONS'
  | 'INVALID_DATA_POINTS'
  | 'INVALID_OBSERVATION_SELECTION'
  | 'INVALID_AFFECTED_SET_CONSTRUCTION'
  | 'INVALID_FORMULA_SUBSTITUTION'
  | 'INVALID_POLICY_PROVENANCE';

export interface EvidenceDecodeError {
  readonly code: EvidenceDecodeErrorCode;
  readonly message: string;
}

export type EvidenceDecodeResult =
  | { readonly ok: true; readonly evidence: EvidenceTraceView }
  | { readonly ok: false; readonly error: EvidenceDecodeError };

function fail(code: EvidenceDecodeErrorCode, message: string): EvidenceDecodeResult {
  return { ok: false, error: { code, message } };
}

// ─── Element Decoders ────────────────────────────────────────

const INVALID = 'INVALID' as const;
type Invalid = typeof INVALID;

function decodeClassificationReasoning(
  rows: readonly Record<string, unknown>[],
): readonly ClassificationReasoningView[] | Invalid {
  const out: ClassificationReasoningView[] = [];
  for (const row of rows) {
    const segmentId = optionalNonEmptyString(row, 'segment_id');
    const value = optionalFiniteNumber(row, 'value');
    const threshold = optionalString(row, 'threshold');
    const conclusion = optionalString(row, 'conclusion');
    if (
      segmentId === undefined ||
      segmentId === null ||
      value === undefined ||
      threshold === undefined ||
      conclusion === undefined
    ) {
      return INVALID;
    }
    out.push({ segmentId, value, threshold, conclusion });
  }
  return out;
}

function decodeExcludedRoutes(
  rows: readonly Record<string, unknown>[],
): readonly ExcludedRouteReasonView[] | Invalid {
  const out: ExcludedRouteReasonView[] = [];
  for (const row of rows) {
    const segmentId = optionalNonEmptyString(row, 'segment_id');
    // A blank reason is a server-side contract breach, not a decode error: the
    // panel must be able to name the offending segment while reporting it.
    const reason = optionalString(row, 'reason');
    if (segmentId === undefined || segmentId === null || reason === undefined) return INVALID;
    out.push({ segmentId, reason: reason === null || reason.trim() === '' ? null : reason });
  }
  return out;
}

function decodeSopCitations(
  rows: readonly Record<string, unknown>[],
): readonly SopCitationView[] | Invalid {
  const out: SopCitationView[] = [];
  for (const row of rows) {
    const articleNo = optionalFiniteNumber(row, 'article_no');
    const sourceLocation = optionalString(row, 'source_location');
    const content = optionalString(row, 'content');
    const score = optionalFiniteNumber(row, 'score');
    if (
      articleNo === undefined ||
      articleNo === null ||
      sourceLocation === undefined ||
      content === undefined ||
      score === undefined
    ) {
      return INVALID;
    }
    out.push({ articleNo, sourceLocation, content, score });
  }
  return out;
}

function decodeDataPoints(
  rows: readonly Record<string, unknown>[],
): readonly DataPointView[] | Invalid {
  const out: DataPointView[] = [];
  for (const row of rows) {
    const source = optionalString(row, 'source');
    const field = optionalString(row, 'field');
    const timestamp = optionalString(row, 'timestamp');
    if (source === undefined || field === undefined || timestamp === undefined) return INVALID;

    const rawValue = row['value'];
    let value: string | number | boolean | null;
    if (rawValue === undefined || rawValue === null) {
      value = null;
    } else if (
      typeof rawValue === 'string' ||
      typeof rawValue === 'boolean' ||
      (typeof rawValue === 'number' && Number.isFinite(rawValue))
    ) {
      value = rawValue;
    } else {
      return INVALID;
    }

    out.push({ source, field, value, timestamp });
  }
  return out;
}

function decodeObservationSelection(
  rows: readonly Record<string, unknown>[],
): readonly ObservationSelectionView[] | Invalid {
  const out: ObservationSelectionView[] = [];
  for (const row of rows) {
    const entityId = optionalNonEmptyString(row, 'entity_id');
    const cutoff = optionalNonEmptyString(row, 'cutoff');
    const observationTimestamp = optionalNonEmptyString(row, 'observation_timestamp');
    const staleness = optionalFiniteNumber(row, 'staleness');
    const exactMatch = optionalBoolean(row, 'exact_match');
    const mode = optionalNonEmptyString(row, 'mode');
    if (
      entityId === undefined ||
      cutoff === undefined ||
      observationTimestamp === undefined ||
      staleness === undefined ||
      exactMatch === undefined ||
      mode === undefined
    ) {
      return INVALID;
    }
    out.push({ entityId, cutoff, observationTimestamp, staleness, exactMatch, mode });
  }
  return out;
}

function decodeAffectedSetConstruction(
  rows: readonly Record<string, unknown>[],
): readonly AffectedSetConstructionView[] | Invalid {
  const out: AffectedSetConstructionView[] = [];
  for (const row of rows) {
    const segmentId = optionalNonEmptyString(row, 'segment_id');
    const role = optionalNonEmptyString(row, 'role');
    const included = optionalBoolean(row, 'included');
    const reason = optionalString(row, 'reason');
    if (
      segmentId === undefined ||
      segmentId === null ||
      role === undefined ||
      included === undefined ||
      reason === undefined
    ) {
      return INVALID;
    }
    out.push({ segmentId, role, included, reason });
  }
  return out;
}

/** Reads one quantity under either of its two documented spellings. */
function eitherNumber(
  record: Record<string, unknown>,
  designName: string,
  eteBlockName: string,
): number | null | undefined {
  const primary = optionalFiniteNumber(record, designName);
  if (primary === undefined) return undefined;
  if (primary !== null) return primary;
  return optionalFiniteNumber(record, eteBlockName);
}

function decodeFormulaSubstitution(raw: unknown): FormulaSubstitutionView | Invalid {
  if (!isRecord(raw)) return INVALID;

  const sum = eitherNumber(raw, 'sum', 'saturation_sum');
  const count = eitherNumber(raw, 'count', 'road_count');
  const average = eitherNumber(raw, 'average', 'avg_saturation');
  const base = eitherNumber(raw, 'base', 'base_clearance');
  const penalty = eitherNumber(raw, 'penalty', 'congestion_penalty');
  const eteDesign = optionalFiniteNumber(raw, 'ETE');
  const eteLower = optionalFiniteNumber(raw, 'ete');
  const eteBlock = optionalFiniteNumber(raw, 'ete_minutes');

  if (
    sum === undefined ||
    count === undefined ||
    average === undefined ||
    base === undefined ||
    penalty === undefined ||
    eteDesign === undefined ||
    eteLower === undefined ||
    eteBlock === undefined
  ) {
    return INVALID;
  }

  return {
    sum,
    count,
    average,
    base,
    penalty,
    ete: eteDesign ?? eteLower ?? eteBlock,
  };
}

function decodePolicyProvenance(raw: unknown): PolicyProvenanceView | Invalid {
  if (!isRecord(raw)) return INVALID;
  const policyMode = optionalNonEmptyString(raw, 'policy_mode');
  const guidanceId = optionalNonEmptyString(raw, 'guidance_id');
  const configurable = optionalBoolean(raw, 'configurable');
  if (policyMode === undefined || guidanceId === undefined || configurable === undefined) {
    return INVALID;
  }
  return { policyMode, guidanceId, configurable };
}

// ─── Entry Point ─────────────────────────────────────────────

/**
 * Decodes a `core.evidence` block.
 *
 * @param raw - the `evidence` value from the validated core object
 * @returns the typed evidence view, or a typed decode failure. A `null` /
 *          absent block is a decode failure, not an empty trace: R15 makes the
 *          explanation chain mandatory, and an empty trace would render as
 *          "there was no reasoning".
 */
export function decodeEvidenceTrace(raw: unknown): EvidenceDecodeResult {
  if (!isRecord(raw)) {
    return fail('NOT_AN_OBJECT', 'core.evidence 不是有效的物件結構');
  }

  const decisionId = optionalNonEmptyString(raw, 'decision_id');
  if (decisionId === undefined) {
    return fail('NOT_AN_OBJECT', 'core.evidence.decision_id 型別不正確');
  }

  const rawReasoning = optionalRecordArray(raw, 'classification_reasoning');
  if (rawReasoning === undefined) {
    return fail('INVALID_CLASSIFICATION_REASONING', 'classification_reasoning 必須是物件陣列');
  }
  const classificationReasoning = decodeClassificationReasoning(rawReasoning);
  if (classificationReasoning === INVALID) {
    return fail('INVALID_CLASSIFICATION_REASONING', 'classification_reasoning 元素型別不正確');
  }

  const rawExcluded = optionalRecordArray(raw, 'excluded_routes');
  if (rawExcluded === undefined) {
    return fail('INVALID_EXCLUDED_ROUTES', 'excluded_routes 必須是物件陣列');
  }
  const excludedRoutes = decodeExcludedRoutes(rawExcluded);
  if (excludedRoutes === INVALID) {
    return fail('INVALID_EXCLUDED_ROUTES', 'excluded_routes 元素型別不正確');
  }

  const rawCitations = optionalRecordArray(raw, 'sop_citations');
  if (rawCitations === undefined) {
    return fail('INVALID_SOP_CITATIONS', 'sop_citations 必須是物件陣列');
  }
  const sopCitations = decodeSopCitations(rawCitations);
  if (sopCitations === INVALID) {
    return fail('INVALID_SOP_CITATIONS', 'sop_citations 元素型別不正確');
  }

  const rawDataPoints = optionalRecordArray(raw, 'data_points');
  if (rawDataPoints === undefined) {
    return fail('INVALID_DATA_POINTS', 'data_points 必須是物件陣列');
  }
  const dataPoints = decodeDataPoints(rawDataPoints);
  if (dataPoints === INVALID) {
    return fail('INVALID_DATA_POINTS', 'data_points 元素型別不正確');
  }

  let observationSelection: readonly ObservationSelectionView[] | null = null;
  if ('observation_selection' in raw && raw['observation_selection'] !== null) {
    const rows = optionalRecordArray(raw, 'observation_selection');
    if (rows === undefined) {
      return fail('INVALID_OBSERVATION_SELECTION', 'observation_selection 必須是物件陣列');
    }
    const decoded = decodeObservationSelection(rows);
    if (decoded === INVALID) {
      return fail('INVALID_OBSERVATION_SELECTION', 'observation_selection 元素型別不正確');
    }
    observationSelection = decoded;
  }

  let affectedSetConstruction: readonly AffectedSetConstructionView[] | null = null;
  if ('affected_set_construction' in raw && raw['affected_set_construction'] !== null) {
    const rows = optionalRecordArray(raw, 'affected_set_construction');
    if (rows === undefined) {
      return fail('INVALID_AFFECTED_SET_CONSTRUCTION', 'affected_set_construction 必須是物件陣列');
    }
    const decoded = decodeAffectedSetConstruction(rows);
    if (decoded === INVALID) {
      return fail('INVALID_AFFECTED_SET_CONSTRUCTION', 'affected_set_construction 元素型別不正確');
    }
    affectedSetConstruction = decoded;
  }

  let formulaSubstitution: FormulaSubstitutionView | null = null;
  const rawFormula = optionalRecord(raw, 'formula_substitution');
  if (rawFormula === undefined) {
    return fail('INVALID_FORMULA_SUBSTITUTION', 'formula_substitution 必須是物件');
  }
  if (rawFormula !== null) {
    const decoded = decodeFormulaSubstitution(rawFormula);
    if (decoded === INVALID) {
      return fail('INVALID_FORMULA_SUBSTITUTION', 'formula_substitution 欄位型別不正確');
    }
    formulaSubstitution = decoded;
  }

  let policyProvenance: PolicyProvenanceView | null = null;
  const rawProvenance = optionalRecord(raw, 'policy_provenance');
  if (rawProvenance === undefined) {
    return fail('INVALID_POLICY_PROVENANCE', 'policy_provenance 必須是物件');
  }
  if (rawProvenance !== null) {
    const decoded = decodePolicyProvenance(rawProvenance);
    if (decoded === INVALID) {
      return fail('INVALID_POLICY_PROVENANCE', 'policy_provenance 欄位型別不正確');
    }
    policyProvenance = decoded;
  }

  return {
    ok: true,
    evidence: {
      decisionId,
      classificationReasoning,
      excludedRoutes,
      sopCitations,
      dataPoints,
      observationSelection,
      affectedSetConstruction,
      formulaSubstitution,
      policyProvenance,
    },
  };
}

// ─── Citation Coverage (§14.2, R15.3) ────────────────────────

/** One required article and whether a citation for it arrived. */
export interface CitationCoverageRow {
  readonly articleNo: number;
  /** Why the article is in `citation_article_set`. Both are possible at once. */
  readonly triggered: boolean;
  readonly appliedFormula: boolean;
  readonly citations: readonly SopCitationView[];
}

export interface CitationCoverage {
  /** `citation_article_set` = `triggered_articles ∪ applied_formula_articles`. */
  readonly rows: readonly CitationCoverageRow[];
  /** Required articles with no citation. Non-empty ⇒ a §14.2 contract breach. */
  readonly missingArticles: readonly number[];
  /** Citations for articles outside the required set. Also a breach. */
  readonly extraneousArticles: readonly number[];
}

/**
 * Projects the citation set defined by §14.2 /
 * R15.3: `citation_article_set = triggered_articles ∪ applied_formula_articles`.
 *
 * This is a set union over two authoritative backend arrays, used purely to lay
 * the citations out and to name a gap. No article is added, removed, or inferred
 * from any threshold: which articles triggered and which formula was applied is
 * decided entirely by the backend rule engine.
 */
export function citationCoverage(
  triggeredArticles: readonly number[],
  appliedFormulaArticles: readonly number[],
  citations: readonly SopCitationView[],
): CitationCoverage {
  const triggered = new Set(triggeredArticles);
  const applied = new Set(appliedFormulaArticles);
  const required = [...new Set([...triggeredArticles, ...appliedFormulaArticles])].sort(
    (left, right) => left - right,
  );

  const rows = required.map((articleNo) => ({
    articleNo,
    triggered: triggered.has(articleNo),
    appliedFormula: applied.has(articleNo),
    citations: citations.filter((citation) => citation.articleNo === articleNo),
  }));

  return {
    rows,
    missingArticles: rows.filter((row) => row.citations.length === 0).map((row) => row.articleNo),
    extraneousArticles: [
      ...new Set(
        citations
          .map((citation) => citation.articleNo)
          .filter((articleNo) => !triggered.has(articleNo) && !applied.has(articleNo)),
      ),
    ].sort((left, right) => left - right),
  };
}
