/**
 * ETEResult — Frontend Runtime Boundary Decoder (§10.9, §11.3, §11.4, R12)
 *
 * TASK-131. Validates the `core.ete` block of the
 * `GET /decisions/{decision_id}` payload into the full calculation basis the
 * ETE panel discloses: severity and base clearance, the affected road set with
 * its roles, the common exact snapshot timestamp, every per-road
 * `Saturation_Score`, the formula operands, the result, and the
 * organizer-guidance provenance.
 *
 * Why the numbers must come from here and not from `evidence.formula_substitution`:
 * the live `buildEvidenceTrace` emits only `classification_reasoning`,
 * `excluded_routes`, `sop_citations` and `data_points`, so the four HG-001
 * evidence blocks (`formula_substitution` included) are absent from the wire.
 * `core.ete` is the authoritative source of the operands (§10.11a).
 *
 * Deterministic boundary (§9), which this module exists to hold:
 *
 * - **no arithmetic.** `avg_saturation`, `saturation_sum`, `road_count`,
 *   `congestion_penalty` and `ete_minutes` are read as supplied. This module
 *   never computes `sum / count`, never evaluates `max(0, (avg - 0.5) * 60)`,
 *   and never adds `base_clearance + congestion_penalty` — not even to
 *   cross-check. A value the backend did not supply stays `null` and is
 *   disclosed as not supplied.
 * - `road_count` is not `affected_set.length`. Counting the set would be a
 *   client-side derivation of a formula operand, so an absent `road_count` is
 *   reported as absent even though the set is right there.
 * - a role is never inferred from a member's position in `affected_set`, even
 *   though §11.3 fixes the semantic order INCIDENT → PRIMARY → SECONDARY.
 *   Roles come from `affected_set[].role` or, when the backend supplies it,
 *   `evidence.affected_set_construction[].role` — each cell carries its own
 *   provenance (see {@link resolveAffectedRoles}).
 * - `calculation_status` is never rewritten. When it says no common exact
 *   snapshot exists, {@link eteSubstitution} returns `null` so no ETE number and
 *   no formula substitution can be rendered at all.
 *
 * Known contract drift, tolerated as *documented spellings* of the same field —
 * never as a rename and never as a guess:
 *
 * | quantity | design §10.9 | live wire |
 * | --- | --- | --- |
 * | snapshot time | `ete_snapshot_timestamp` | `snapshot_provenance.common_snapshot_timestamp` |
 * | per-road readings | `saturation_inputs[]` | `snapshot_provenance.readings[]` |
 * | basis text | `basis_note` | `applicability_note` |
 * | status | `CALCULATED` / `INSUFFICIENT_COMMON_SNAPSHOT` | `computed` / `insufficient_common_snapshot` |
 *
 * Design §12's response example additionally shows `saturation_inputs` as a bare
 * `number[]`; that form is accepted with a `null` segment id rather than being
 * matched positionally against `affected_set`.
 *
 * `saturation_sum`, `road_count`, `policy_mode`, `snapshot_mode`, `guidance_id`
 * and `basis_note` have no live counterpart at all. They decode to `null` and
 * the panel discloses each as not supplied.
 *
 * @module frontend/decision/ete_model
 */

import {
  isRecord,
  optionalBoolean,
  optionalFiniteNumber,
  optionalNonEmptyString,
  optionalString,
} from './decode_primitives.js';
import type { AffectedSetConstructionView } from './evidence_model.js';

// ─── Read Model ──────────────────────────────────────────────

/** One member of `affected_set` (§10.9). `role` is `null` when not supplied. */
export interface EteAffectedRoadView {
  readonly segmentId: string;
  /** `INCIDENT` / `PRIMARY` / `SECONDARY` as supplied; never positional. */
  readonly role: string | null;
}

/**
 * One per-road saturation input (§10.9 `saturation_inputs`, live
 * `snapshot_provenance.readings`).
 */
export interface EteSaturationInputView {
  /** `null` only for design §12's bare-number form, which carries no id. */
  readonly segmentId: string | null;
  readonly role: string | null;
  /** The `Saturation_Score` the formula used. Displayed, never averaged. */
  readonly saturation: number | null;
  /** The reading's own observation timestamp, for exact-snapshot proof. */
  readonly timestamp: string | null;
}

/** Validated `core.ete` block. */
export interface EteView {
  readonly severity: string | null;
  /** `base_clearance` — 60/40/20 by severity, backend-derived. */
  readonly baseClearance: number | null;
  readonly affectedSet: readonly EteAffectedRoadView[];
  /** `snapshot_provenance.event_timestamp` — the incident instant. */
  readonly eventTimestamp: string | null;
  /** The single exact timestamp shared by the whole set, or `null`. */
  readonly eteSnapshotTimestamp: string | null;
  /** `snapshot_provenance.selection_status`, verbatim. */
  readonly snapshotSelectionStatus: string | null;
  /** `null` when the backend supplied no per-road readings at all. */
  readonly saturationInputs: readonly EteSaturationInputView[] | null;
  readonly saturationSum: number | null;
  /** `road_count` as supplied. Never `affected_set.length`. */
  readonly roadCount: number | null;
  readonly avgSaturation: number | null;
  readonly congestionPenalty: number | null;
  /** `null` ⇒ no ETE was computed. Never substituted by a lower bound. */
  readonly eteMinutes: number | null;
  readonly eteLowerBoundMinutes: number | null;
  readonly calculationStatus: string | null;
  readonly manualConfirmationRequired: boolean | null;
  readonly formulaApplicability: string | null;
  readonly basisNote: string | null;
  readonly lowerBoundOnly: boolean | null;
  readonly policyMode: string | null;
  readonly snapshotMode: string | null;
  readonly guidanceId: string | null;
}

// ─── Decode Result ───────────────────────────────────────────

export type EteDecodeErrorCode =
  | 'NOT_AN_OBJECT'
  | 'INVALID_AFFECTED_SET'
  | 'INVALID_SNAPSHOT_PROVENANCE'
  | 'INVALID_SATURATION_INPUTS'
  | 'INVALID_ETE_FIELD';

export interface EteDecodeError {
  readonly code: EteDecodeErrorCode;
  readonly message: string;
}

export type EteDecodeResult =
  | { readonly ok: true; readonly ete: EteView }
  | { readonly ok: false; readonly error: EteDecodeError };

function fail(code: EteDecodeErrorCode, message: string): EteDecodeResult {
  return { ok: false, error: { code, message } };
}

const INVALID = 'INVALID' as const;
type Invalid = typeof INVALID;

// ─── Status Predicates ───────────────────────────────────────

/**
 * Whether `calculation_status` states that no common exact snapshot exists.
 *
 * Both documented spellings are recognized so the panel behaves correctly
 * against either payload. The status text itself is displayed verbatim.
 */
export function isInsufficientCommonSnapshot(status: string | null): boolean {
  return status === 'INSUFFICIENT_COMMON_SNAPSHOT' || status === 'insufficient_common_snapshot';
}

/** Whether `calculation_status` states that the formula was applied. */
export function isCalculated(status: string | null): boolean {
  return status === 'CALCULATED' || status === 'computed';
}

// ─── Element Decoders ────────────────────────────────────────

function decodeAffectedSet(raw: unknown): readonly EteAffectedRoadView[] | Invalid {
  if (raw === null || raw === undefined) return [];
  if (!Array.isArray(raw)) return INVALID;

  const out: EteAffectedRoadView[] = [];
  for (const entry of raw) {
    if (typeof entry === 'string') {
      if (entry.trim() === '') return INVALID;
      // The live wire carries ids only. The role stays unknown rather than
      // being read off the member's position (§11.3 order is not evidence).
      out.push({ segmentId: entry, role: null });
      continue;
    }
    if (!isRecord(entry)) return INVALID;
    const segmentId = optionalNonEmptyString(entry, 'segment_id');
    const role = optionalNonEmptyString(entry, 'role');
    if (segmentId === undefined || segmentId === null || role === undefined) return INVALID;
    out.push({ segmentId, role });
  }
  return out;
}

/** Decodes `saturation_inputs` in either documented form. */
function decodeSaturationInputs(raw: unknown): readonly EteSaturationInputView[] | Invalid {
  if (!Array.isArray(raw)) return INVALID;

  const out: EteSaturationInputView[] = [];
  for (const entry of raw) {
    if (typeof entry === 'number') {
      if (!Number.isFinite(entry)) return INVALID;
      out.push({ segmentId: null, role: null, saturation: entry, timestamp: null });
      continue;
    }
    if (!isRecord(entry)) return INVALID;
    const segmentId = optionalNonEmptyString(entry, 'segment_id');
    const role = optionalNonEmptyString(entry, 'role');
    const saturation = optionalFiniteNumber(entry, 'saturation');
    const timestamp = optionalNonEmptyString(entry, 'timestamp');
    if (
      segmentId === undefined ||
      role === undefined ||
      saturation === undefined ||
      timestamp === undefined
    ) {
      return INVALID;
    }
    out.push({ segmentId, role, saturation, timestamp });
  }
  return out;
}

/** Decodes the live `snapshot_provenance.readings` form. */
function decodeReadings(raw: unknown): readonly EteSaturationInputView[] | Invalid {
  if (!Array.isArray(raw)) return INVALID;

  const out: EteSaturationInputView[] = [];
  for (const entry of raw) {
    if (!isRecord(entry)) return INVALID;
    const segmentId = optionalNonEmptyString(entry, 'road_id');
    const timestamp = optionalNonEmptyString(entry, 'observation_timestamp');
    const saturation = optionalFiniteNumber(entry, 'saturation_score');
    if (segmentId === undefined || timestamp === undefined || saturation === undefined) {
      return INVALID;
    }
    out.push({ segmentId, role: null, saturation, timestamp });
  }
  return out;
}

interface SnapshotProvenanceParts {
  readonly selectionStatus: string | null;
  readonly eventTimestamp: string | null;
  readonly commonSnapshotTimestamp: string | null;
  readonly readings: readonly EteSaturationInputView[] | null;
}

function decodeSnapshotProvenance(raw: unknown): SnapshotProvenanceParts | Invalid {
  if (raw === null || raw === undefined) {
    return {
      selectionStatus: null,
      eventTimestamp: null,
      commonSnapshotTimestamp: null,
      readings: null,
    };
  }
  if (!isRecord(raw)) return INVALID;

  const selectionStatus = optionalNonEmptyString(raw, 'selection_status');
  const eventTimestamp = optionalNonEmptyString(raw, 'event_timestamp');
  const commonSnapshotTimestamp = optionalNonEmptyString(raw, 'common_snapshot_timestamp');
  if (
    selectionStatus === undefined ||
    eventTimestamp === undefined ||
    commonSnapshotTimestamp === undefined
  ) {
    return INVALID;
  }

  let readings: readonly EteSaturationInputView[] | null = null;
  if ('readings' in raw && raw['readings'] !== null && raw['readings'] !== undefined) {
    const decoded = decodeReadings(raw['readings']);
    if (decoded === INVALID) return INVALID;
    readings = decoded;
  }

  return { selectionStatus, eventTimestamp, commonSnapshotTimestamp, readings };
}

// ─── Entry Point ─────────────────────────────────────────────

/**
 * Decodes an `ete` block.
 *
 * @param raw - the `ete` value from the validated core object
 * @returns the typed ETE view, or a typed decode failure. An absent block is a
 *          decode failure rather than an empty view: R12 makes the ETE and its
 *          basis a mandatory disclosure, and an all-`null` view would read as
 *          "the ETE could not be computed" when in fact nothing was received.
 */
export function decodeEte(raw: unknown): EteDecodeResult {
  if (!isRecord(raw)) {
    return fail('NOT_AN_OBJECT', 'core.ete 不是有效的物件結構');
  }

  const affectedSet = decodeAffectedSet(raw['affected_set']);
  if (affectedSet === INVALID) {
    return fail('INVALID_AFFECTED_SET', 'core.ete.affected_set 元素型別不正確');
  }

  const provenance = decodeSnapshotProvenance(raw['snapshot_provenance']);
  if (provenance === INVALID) {
    return fail('INVALID_SNAPSHOT_PROVENANCE', 'core.ete.snapshot_provenance 欄位型別不正確');
  }

  let saturationInputs: readonly EteSaturationInputView[] | null = provenance.readings;
  if ('saturation_inputs' in raw && raw['saturation_inputs'] !== null) {
    const decoded = decodeSaturationInputs(raw['saturation_inputs']);
    if (decoded === INVALID) {
      return fail('INVALID_SATURATION_INPUTS', 'core.ete.saturation_inputs 元素型別不正確');
    }
    saturationInputs = decoded;
  }

  const severity = optionalNonEmptyString(raw, 'severity');
  const baseClearance = optionalFiniteNumber(raw, 'base_clearance');
  const designSnapshotTimestamp = optionalNonEmptyString(raw, 'ete_snapshot_timestamp');
  const saturationSum = optionalFiniteNumber(raw, 'saturation_sum');
  const roadCount = optionalFiniteNumber(raw, 'road_count');
  const avgSaturation = optionalFiniteNumber(raw, 'avg_saturation');
  const congestionPenalty = optionalFiniteNumber(raw, 'congestion_penalty');
  const eteMinutes = optionalFiniteNumber(raw, 'ete_minutes');
  const eteLowerBoundMinutes = optionalFiniteNumber(raw, 'ete_lower_bound_minutes');
  const calculationStatus = optionalNonEmptyString(raw, 'calculation_status');
  const manualConfirmationRequired = optionalBoolean(raw, 'manual_confirmation_required');
  const formulaApplicability = optionalNonEmptyString(raw, 'formula_applicability');
  const designBasisNote = optionalString(raw, 'basis_note');
  const liveApplicabilityNote = optionalString(raw, 'applicability_note');
  const lowerBoundOnly = optionalBoolean(raw, 'lower_bound_only');
  const policyMode = optionalNonEmptyString(raw, 'policy_mode');
  const snapshotMode = optionalNonEmptyString(raw, 'snapshot_mode');
  const guidanceId = optionalNonEmptyString(raw, 'guidance_id');

  if (
    severity === undefined ||
    baseClearance === undefined ||
    designSnapshotTimestamp === undefined ||
    saturationSum === undefined ||
    roadCount === undefined ||
    avgSaturation === undefined ||
    congestionPenalty === undefined ||
    eteMinutes === undefined ||
    eteLowerBoundMinutes === undefined ||
    calculationStatus === undefined ||
    manualConfirmationRequired === undefined ||
    formulaApplicability === undefined ||
    designBasisNote === undefined ||
    liveApplicabilityNote === undefined ||
    lowerBoundOnly === undefined ||
    policyMode === undefined ||
    snapshotMode === undefined ||
    guidanceId === undefined
  ) {
    return fail('INVALID_ETE_FIELD', 'core.ete 的欄位型別不正確');
  }

  return {
    ok: true,
    ete: {
      severity,
      baseClearance,
      affectedSet,
      eventTimestamp: provenance.eventTimestamp,
      eteSnapshotTimestamp: designSnapshotTimestamp ?? provenance.commonSnapshotTimestamp,
      snapshotSelectionStatus: provenance.selectionStatus,
      saturationInputs,
      saturationSum,
      roadCount,
      avgSaturation,
      congestionPenalty,
      eteMinutes,
      eteLowerBoundMinutes,
      calculationStatus,
      manualConfirmationRequired,
      formulaApplicability,
      basisNote: designBasisNote ?? liveApplicabilityNote,
      lowerBoundOnly,
      policyMode,
      snapshotMode,
      guidanceId,
    },
  };
}

// ─── Affected-Set Roles (§10.9, §10.10) ──────────────────────

/** Where a displayed role came from. `null` ⇒ no backend block supplied one. */
export type AffectedRoleSource = 'ete.affected_set' | 'evidence.affected_set_construction' | null;

export interface AffectedRoleRow {
  readonly segmentId: string;
  readonly role: string | null;
  readonly roleSource: AffectedRoleSource;
}

/**
 * Pairs each `affected_set` member with the role the backend gave it.
 *
 * Two authoritative blocks may carry the role: `ete.affected_set[].role`
 * (§10.9) and `evidence.affected_set_construction[].role` (§10.10). The first is
 * preferred; the second is consulted by `segment_id` only. This is a lookup
 * between two backend records, and each row reports which block it came from —
 * it is not an inference. When neither supplies a role the row stays `null`, and
 * the position of the member in the set is never used as a substitute.
 */
export function resolveAffectedRoles(
  affectedSet: readonly EteAffectedRoadView[],
  roleEvidence: readonly AffectedSetConstructionView[] | null,
): readonly AffectedRoleRow[] {
  return affectedSet.map((member) => {
    if (member.role !== null) {
      return { segmentId: member.segmentId, role: member.role, roleSource: 'ete.affected_set' };
    }
    const evidenceRow = roleEvidence?.find((row) => row.segmentId === member.segmentId);
    if (evidenceRow !== undefined && evidenceRow.role !== null) {
      return {
        segmentId: member.segmentId,
        role: evidenceRow.role,
        roleSource: 'evidence.affected_set_construction',
      };
    }
    return { segmentId: member.segmentId, role: null, roleSource: null };
  });
}

// ─── Formula Substitution (R12.9, §11.4) ─────────────────────

/** One substituted formula line. All three parts are text, never arithmetic. */
export interface FormulaLine {
  /** The formula as SOP art.7 states it. */
  readonly expression: string;
  /** The same formula with the backend's operands written in. */
  readonly substituted: string;
  /** The backend's result for that line. */
  readonly result: string;
}

export interface EteSubstitution {
  readonly average: FormulaLine;
  readonly penalty: FormulaLine;
  readonly ete: FormulaLine;
}

/**
 * Builds the art.7 substitution display from values the backend already
 * computed.
 *
 * This is string formatting, not calculation: every operand and every result is
 * a backend field rendered verbatim, and an operand the backend did not supply
 * is written as the caller's `missing` marker rather than being reconstructed
 * (the live payload supplies no `saturation_sum` / `road_count`, so the average
 * line legitimately shows two missing operands beside a supplied average).
 *
 * @returns `null` when `calculation_status` reports no common exact snapshot, or
 *          when `ete_minutes` is absent. In that state R12.8 / R13.9 forbid
 *          showing an ETE at all, so there is nothing to substitute — the caller
 *          must render the lower bound as a lower bound instead.
 */
export function eteSubstitution(ete: EteView, missing: string): EteSubstitution | null {
  if (isInsufficientCommonSnapshot(ete.calculationStatus) || ete.eteMinutes === null) {
    return null;
  }

  const text = (value: number | null): string => (value === null ? missing : String(value));

  return {
    average: {
      expression: 'avg_saturation = saturation_sum / road_count',
      substituted: `${text(ete.saturationSum)} / ${text(ete.roadCount)}`,
      result: text(ete.avgSaturation),
    },
    penalty: {
      expression: 'congestion_penalty = max(0, (avg_saturation - 0.5) * 60)',
      substituted: `max(0, (${text(ete.avgSaturation)} - 0.5) * 60)`,
      result: text(ete.congestionPenalty),
    },
    ete: {
      expression: 'ete_minutes = base_clearance + congestion_penalty',
      substituted: `${text(ete.baseClearance)} + ${text(ete.congestionPenalty)}`,
      result: text(ete.eteMinutes),
    },
  };
}
