/**
 * ETEResult — SOP-7 ETE calculation result (§10.9)
 *
 * Formula: ETE_minutes = base_clearance + congestion_penalty
 * where congestion_penalty = max(0, (avg_saturation - 0.5) * 60)
 *
 * Art.7 is ALWAYS applied_formula_articles, NEVER triggered_articles.
 *
 * @module shared-schemas/ete
 */

/** A single traffic saturation reading used as an ETE formula input. */
export interface EteSnapshotRoadReading {
  readonly road_id: string;
  /** Normalized observation time (`YYYY-MM-DD HH:MM`). */
  readonly observation_timestamp: string;
  readonly saturation_score: number;
}

/** Provenance for a single exact snapshot shared by every ETE road. */
export interface CommonExactEteSnapshot {
  readonly selection_status: 'common_exact_snapshot';
  readonly event_timestamp: string;
  readonly common_snapshot_timestamp: string;
  /** One reading for every unique member of `affected_set`, all at the common time. */
  readonly readings: readonly EteSnapshotRoadReading[];
}

/** Explicit no-computation result when no exact snapshot is shared by the full set. */
export interface InsufficientCommonEteSnapshot {
  readonly selection_status: 'insufficient_common_snapshot';
  readonly event_timestamp: string;
  readonly common_snapshot_timestamp: null;
  readonly readings: readonly [];
}

export type EteSnapshotProvenance = CommonExactEteSnapshot | InsufficientCommonEteSnapshot;

/** ETEResult — deterministic ETE computation output. */
interface ETEBaseResult {
  /** @derived Critical=60, High=40, Medium=20 */
  readonly base_clearance: number;
  /** @immutable-official event severity */
  readonly severity: string;
  /** @provisional stable, duplicate-free segment IDs selected by Strategy C. */
  readonly affected_set: readonly string[];
  /** Whether a numeric ETE was computed or a common snapshot was unavailable. */
  readonly calculation_status: 'computed' | 'insufficient_common_snapshot';
  /** Exact-time provenance for every saturation value used by the formula. */
  readonly snapshot_provenance: EteSnapshotProvenance;
  /** Whether a human must confirm before treating the lower bound as an ETE. */
  readonly manual_confirmation_required: boolean;
  /**
   * Whether the ETE formula is fully applicable.
   * PARTIALLY_DEFINED when inputs are not officially defined (OQ-003, OQ-011).
   * @provisional
   */
  readonly formula_applicability: 'applicable' | 'partially_defined';
  /** @provisional note about which inputs are not officially defined */
  readonly applicability_note?: string;
}

/** ETE result when a full common exact snapshot is available and the formula is computed. */
interface ComputedETEResult extends ETEBaseResult {
  readonly calculation_status: 'computed';
  readonly snapshot_provenance: CommonExactEteSnapshot;
  readonly manual_confirmation_required: false;
  /** @derived ETE in minutes = base_clearance + congestion_penalty */
  readonly ete_minutes: number;
  /** @derived max(0, (avg_saturation - 0.5) * 60) */
  readonly congestion_penalty: number;
  /** @provisional average saturation of the shared exact snapshot (Strategy C) */
  readonly avg_saturation: number;
  readonly lower_bound_only: false;
}

/** ETE result when no full common exact snapshot exists and only the known base lower bound remains. */
interface LowerBoundETEResult extends ETEBaseResult {
  readonly calculation_status: 'insufficient_common_snapshot';
  readonly snapshot_provenance: InsufficientCommonEteSnapshot;
  readonly manual_confirmation_required: true;
  /** Not computed because a common exact snapshot is unavailable. */
  readonly ete_minutes: null;
  /** Known ETE lower bound from severity alone. */
  readonly ete_lower_bound_minutes: number;
  /** Not computed because the full set cannot be averaged at one exact time. */
  readonly congestion_penalty: null;
  /** Not computed because the full set cannot be averaged at one exact time. */
  readonly avg_saturation: null;
  readonly lower_bound_only: true;
}

/**
 * Deterministic ETE output. The discriminant prevents an incomplete or
 * mixed-timestamp road set from being represented as a calculated average.
 */
export type ETEResult = ComputedETEResult | LowerBoundETEResult;
