/**
 * Evacuation Route — Frontend Runtime Boundary Decoder
 * (§10.8 RouteCandidate, §10.8a IncidentAnchor, §11.5, §11.7, R6/R13)
 *
 * TASK-130. Validates the route blocks of the `GET /decisions/{decision_id}`
 * core — `excluded_candidates`, `incident_anchor`, and the SOP-2 congestion
 * disposition — into the view rendered by `route_panel.tsx`. The already-decoded
 * `primary_evacuation` / `secondary_evacuation` come from the TASK-132 read
 * model and are not re-read here.
 *
 * Deterministic boundary (§9). This module reads and shapes; it decides nothing:
 *
 * - it never re-ranks candidates. `primary_evacuation` is whatever the backend
 *   `EvacuationSelector` chose; a candidate with a lower `saturation_at_snapshot`
 *   is still displayed as excluded, in wire order.
 * - it never re-applies the three art.2 qualification conditions (capacity,
 *   direct intersection, upstream) and never compares a saturation against
 *   0.85 or 1000. `passes_capacity`, `is_direct_intersection`,
 *   `upstream_or_downstream` and the congestion disposition are backend truth.
 * - it never derives upstream/downstream, and never invents a primary when the
 *   anchor is unresolved (§11.5 hard rule).
 * - an excluded candidate with a blank `exclusion_reason` decodes to
 *   `exclusionReason: null` so the panel can name it as an R13.3 contract
 *   breach. A reason is never synthesized from the candidate's own numbers.
 *
 * Contract drift, reported rather than papered over: the live backend's
 * `selectEvacuation` computes `primary_congested`,
 * `long_green_timing_for_primary`, `public_transit_recommended`,
 * `congestion_note` and `no_candidate_note`, but its `DeterministicDecisionFacts`
 * does not carry them onto `DecisionCore`, so they are absent from the wire
 * today. They are decoded here as an independently optional block: present ⇒
 * rendered verbatim, absent ⇒ `null`, which the panel discloses as "not
 * supplied". The §11.7 disposition is never inferred from
 * `saturation_at_snapshot >= 0.85` on the client.
 *
 * @module frontend/decision/route_model
 */

import {
  optionalBoolean,
  optionalFiniteNumber,
  optionalNonEmptyString,
  optionalRecord,
  optionalRecordArray,
  optionalString,
  optionalStringArray,
} from './decode_primitives.js';
import type { DecisionCoreView } from './decision_read_model.js';

// ─── Read Model ──────────────────────────────────────────────

/**
 * One `RouteCandidate` (§10.8), read verbatim.
 *
 * Every flag is the backend's evaluation of an official condition. `role` and
 * `upstreamOrDownstream` are kept as opaque strings so an unrecognized enum
 * value is still displayed rather than silently dropped.
 */
export interface RouteCandidateView {
  readonly segmentId: string;
  /** `capacity_vph` — immutable-official. Never compared to 1000 here. */
  readonly capacityVph: number | null;
  /** `passes_capacity` — the backend's `>= 1000` evaluation. */
  readonly passesCapacity: boolean | null;
  readonly isDirectIntersection: boolean | null;
  /** `upstream` / `downstream` as supplied. Never derived from geometry. */
  readonly upstreamOrDownstream: string | null;
  /** `saturation_at_snapshot` (Strategy A). Displayed, never used to rank. */
  readonly saturationAtSnapshot: number | null;
  /** `primary` / `secondary` / `excluded` / `unranked_direct_intersection`. */
  readonly role: string | null;
  /** `null` only when the server broke its R13.3 non-empty-reason guarantee. */
  readonly exclusionReason: string | null;
}

/** `incident_anchor` (§10.8a, Strategy D). Every field is provisional. */
export interface IncidentAnchorView {
  readonly affectedRoad: string | null;
  readonly anchorIntersection: string | null;
  /** Index within `affected_road.intersections`, as supplied. */
  readonly anchorIndex: number | null;
  readonly travelDirection: string | null;
  readonly positionRelativeToIntersection: string | null;
  readonly resolutionConfidence: string | null;
  /** Quoted fragment of `Incident.location` the resolution relied on. */
  readonly sourceEvidence: string | null;
  /** `true` ⇒ §11.5 forbids a selected primary and any candidate ranking. */
  readonly manualConfirmationRequired: boolean | null;
  /** Direct intersections deliberately left unranked (§11.5, P30). */
  readonly unrankedDirectIntersections: readonly string[];
  readonly provisional: boolean | null;
}

/**
 * SOP-2 congestion disposition (§9.4 art.2, §11.7, R6.6).
 *
 * The whole block is backend truth. `primaryCongested` is the backend's
 * `Saturation >= 0.85` evaluation; the frontend never performs that comparison.
 */
export interface CongestionDispositionView {
  readonly primaryCongested: boolean | null;
  readonly longGreenTimingForPrimary: boolean | null;
  readonly publicTransitRecommended: boolean | null;
  readonly congestionNote: string | null;
}

/** Validated route view for one decision core. */
export interface RouteView {
  /** `null` when no candidate qualified, or when the anchor is unresolved. */
  readonly primaryEvacuation: string | null;
  readonly secondaryEvacuation: readonly string[];
  /** In wire order. Never re-sorted, never filtered. */
  readonly excludedCandidates: readonly RouteCandidateView[];
  readonly incidentAnchor: IncidentAnchorView | null;
  /** `null` when the backend supplied no congestion-disposition fields. */
  readonly congestion: CongestionDispositionView | null;
  /** `no_candidate_note` (R6.8, 「查無合規替代路段」), when supplied. */
  readonly noCandidateNote: string | null;
  /** Excluded candidates whose mandatory R13.3 reason is missing. */
  readonly reasonlessExclusions: readonly string[];
}

// ─── Decode Result ───────────────────────────────────────────

export type RouteDecodeErrorCode =
  'INVALID_EXCLUDED_CANDIDATES' | 'INVALID_INCIDENT_ANCHOR' | 'INVALID_CONGESTION_DISPOSITION';

export interface RouteDecodeError {
  readonly code: RouteDecodeErrorCode;
  readonly message: string;
}

export type RouteDecodeResult =
  | { readonly ok: true; readonly routes: RouteView }
  | { readonly ok: false; readonly error: RouteDecodeError };

function fail(code: RouteDecodeErrorCode, message: string): RouteDecodeResult {
  return { ok: false, error: { code, message } };
}

const INVALID = 'INVALID' as const;
type Invalid = typeof INVALID;

// ─── Element Decoders ────────────────────────────────────────

function decodeCandidates(
  rows: readonly Record<string, unknown>[],
): readonly RouteCandidateView[] | Invalid {
  const out: RouteCandidateView[] = [];
  for (const row of rows) {
    const segmentId = optionalNonEmptyString(row, 'segment_id');
    const capacityVph = optionalFiniteNumber(row, 'capacity_vph');
    const passesCapacity = optionalBoolean(row, 'passes_capacity');
    const isDirectIntersection = optionalBoolean(row, 'is_direct_intersection');
    const upstreamOrDownstream = optionalNonEmptyString(row, 'upstream_or_downstream');
    const saturationAtSnapshot = optionalFiniteNumber(row, 'saturation_at_snapshot');
    const role = optionalNonEmptyString(row, 'role');
    // A blank reason is a server-side contract breach, not a decode failure:
    // the panel must be able to name the offending segment while reporting it.
    const exclusionReason = optionalString(row, 'exclusion_reason');

    if (
      segmentId === undefined ||
      segmentId === null ||
      capacityVph === undefined ||
      passesCapacity === undefined ||
      isDirectIntersection === undefined ||
      upstreamOrDownstream === undefined ||
      saturationAtSnapshot === undefined ||
      role === undefined ||
      exclusionReason === undefined
    ) {
      return INVALID;
    }

    out.push({
      segmentId,
      capacityVph,
      passesCapacity,
      isDirectIntersection,
      upstreamOrDownstream,
      saturationAtSnapshot,
      role,
      exclusionReason:
        exclusionReason === null || exclusionReason.trim() === '' ? null : exclusionReason,
    });
  }
  return out;
}

function decodeAnchor(raw: Record<string, unknown>): IncidentAnchorView | Invalid {
  const affectedRoad = optionalNonEmptyString(raw, 'affected_road');
  const anchorIntersection = optionalNonEmptyString(raw, 'anchor_intersection');
  const anchorIndex = optionalFiniteNumber(raw, 'anchor_index');
  const travelDirection = optionalNonEmptyString(raw, 'travel_direction');
  const positionRelativeToIntersection = optionalNonEmptyString(
    raw,
    'position_relative_to_intersection',
  );
  const resolutionConfidence = optionalNonEmptyString(raw, 'resolution_confidence');
  const sourceEvidence = optionalString(raw, 'source_evidence');
  const manualConfirmationRequired = optionalBoolean(raw, 'manual_confirmation_required');
  const unrankedDirectIntersections = optionalStringArray(raw, 'unranked_direct_intersections');
  const provisional = optionalBoolean(raw, 'provisional');

  if (
    affectedRoad === undefined ||
    anchorIntersection === undefined ||
    anchorIndex === undefined ||
    travelDirection === undefined ||
    positionRelativeToIntersection === undefined ||
    resolutionConfidence === undefined ||
    sourceEvidence === undefined ||
    manualConfirmationRequired === undefined ||
    unrankedDirectIntersections === undefined ||
    provisional === undefined
  ) {
    return INVALID;
  }

  return {
    affectedRoad,
    anchorIntersection,
    anchorIndex,
    travelDirection,
    positionRelativeToIntersection,
    resolutionConfidence,
    sourceEvidence,
    manualConfirmationRequired,
    unrankedDirectIntersections,
    provisional,
  };
}

/** The five field names the live `EvacuationResult` uses for the disposition. */
const CONGESTION_KEYS = [
  'primary_congested',
  'long_green_timing_for_primary',
  'public_transit_recommended',
  'congestion_note',
] as const;

function decodeCongestion(
  raw: Record<string, unknown>,
): CongestionDispositionView | null | Invalid {
  // Absent as a whole ⇒ "not supplied", which the panel discloses. A partially
  // supplied block is still decoded: each field carries its own null.
  if (!CONGESTION_KEYS.some((key) => key in raw && raw[key] !== null && raw[key] !== undefined)) {
    return null;
  }

  const primaryCongested = optionalBoolean(raw, 'primary_congested');
  const longGreenTimingForPrimary = optionalBoolean(raw, 'long_green_timing_for_primary');
  const publicTransitRecommended = optionalBoolean(raw, 'public_transit_recommended');
  const congestionNote = optionalString(raw, 'congestion_note');

  if (
    primaryCongested === undefined ||
    longGreenTimingForPrimary === undefined ||
    publicTransitRecommended === undefined ||
    congestionNote === undefined
  ) {
    return INVALID;
  }

  return {
    primaryCongested,
    longGreenTimingForPrimary,
    publicTransitRecommended,
    congestionNote,
  };
}

// ─── Entry Point ─────────────────────────────────────────────

/**
 * Decodes the route blocks of a validated decision core.
 *
 * Absence and malformation are kept apart: an absent `incident_anchor` or
 * congestion block decodes to `null` (the panel says so), while a present block
 * of the wrong shape fails the whole decode rather than being partially trusted.
 *
 * @param core - the TASK-132 core view; `fields` carries the raw blocks
 */
export function decodeRouteView(core: DecisionCoreView): RouteDecodeResult {
  const raw = core.fields;

  const rawCandidates = optionalRecordArray(raw, 'excluded_candidates');
  if (rawCandidates === undefined) {
    return fail('INVALID_EXCLUDED_CANDIDATES', 'core.excluded_candidates 必須是物件陣列');
  }
  const excludedCandidates = decodeCandidates(rawCandidates);
  if (excludedCandidates === INVALID) {
    return fail('INVALID_EXCLUDED_CANDIDATES', 'core.excluded_candidates 元素型別不正確');
  }

  const rawAnchor = optionalRecord(raw, 'incident_anchor');
  if (rawAnchor === undefined) {
    return fail('INVALID_INCIDENT_ANCHOR', 'core.incident_anchor 必須是物件');
  }
  let incidentAnchor: IncidentAnchorView | null = null;
  if (rawAnchor !== null) {
    const decoded = decodeAnchor(rawAnchor);
    if (decoded === INVALID) {
      return fail('INVALID_INCIDENT_ANCHOR', 'core.incident_anchor 欄位型別不正確');
    }
    incidentAnchor = decoded;
  }

  const congestion = decodeCongestion(raw);
  if (congestion === INVALID) {
    return fail('INVALID_CONGESTION_DISPOSITION', 'core 的 SOP-2 壅塞處置欄位型別不正確');
  }

  const noCandidateNote = optionalString(raw, 'no_candidate_note');
  if (noCandidateNote === undefined) {
    return fail('INVALID_CONGESTION_DISPOSITION', 'core.no_candidate_note 必須是字串');
  }

  return {
    ok: true,
    routes: {
      primaryEvacuation: core.primaryEvacuation,
      secondaryEvacuation: core.secondaryEvacuation,
      excludedCandidates,
      incidentAnchor,
      congestion,
      noCandidateNote:
        noCandidateNote === null || noCandidateNote.trim() === '' ? null : noCandidateNote,
      reasonlessExclusions: excludedCandidates
        .filter((candidate) => candidate.exclusionReason === null)
        .map((candidate) => candidate.segmentId),
    },
  };
}

// ─── Anchor / Primary Consistency (§11.5, P30) ───────────────

/**
 * Whether §11.5's unresolved-anchor rule is in force for this decision.
 *
 * Reads `manual_confirmation_required` only. The frontend never decides that an
 * anchor is unresolved: an absent anchor block is "not supplied", not
 * "unresolved".
 */
export function anchorUnresolved(routes: RouteView): boolean {
  return routes.incidentAnchor?.manualConfirmationRequired === true;
}

/**
 * `true` when the payload states an unresolved anchor *and* still names a
 * primary evacuation route.
 *
 * §11.5 makes those mutually exclusive, so this is a server-side contract
 * breach. It is surfaced, never repaired: the panel neither hides the supplied
 * value nor presents it as a valid selection.
 */
export function anchorPrimaryConflict(routes: RouteView): boolean {
  return anchorUnresolved(routes) && routes.primaryEvacuation !== null;
}
