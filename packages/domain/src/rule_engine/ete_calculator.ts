/** RuleEngine Article 7 — deterministic ETE formula application. */

import type { ETEResult, EteSnapshotProvenance } from '@city-commander/shared-schemas';
import { Severity } from '@city-commander/shared-schemas';
import type { EteAffectedSetResult } from '../strategies/ete_affected_set_strategy.js';

export interface EteCalculationInput {
  readonly severity: Severity;
  readonly affected_set: EteAffectedSetResult;
  /** Provenance from the latest exact snapshot shared by every affected road. */
  readonly snapshot_provenance: EteSnapshotProvenance;
}

export type EteCalculationResult = ETEResult & {
  /** Article 7 is a formula application, never an article trigger. */
  readonly applied_formula_articles: readonly [7];
};

export function calculateEte(input: EteCalculationInput): EteCalculationResult {
  const base_clearance = baseClearanceFor(input.severity);
  if (!hasCompleteCommonSnapshot(input.affected_set.affected_set, input.snapshot_provenance)) {
    return lowerBoundResult(input, base_clearance);
  }

  const saturationValues = input.snapshot_provenance.readings.map((reading) => reading.saturation_score);
  const avg_saturation = saturationValues.reduce((total, value) => total + value, 0) / saturationValues.length;
  const congestion_penalty = Math.max(0, (avg_saturation - 0.5) * 60);
  return {
    severity: input.severity,
    base_clearance,
    congestion_penalty,
    ete_minutes: base_clearance + congestion_penalty,
    avg_saturation,
    affected_set: input.affected_set.affected_set,
    calculation_status: 'computed',
    snapshot_provenance: input.snapshot_provenance,
    manual_confirmation_required: false,
    formula_applicability: input.affected_set.formula_applicability,
    applicability_note: input.affected_set.applicability_note,
    lower_bound_only: false,
    applied_formula_articles: [7],
  };
}

function hasCompleteCommonSnapshot(
  affectedSet: readonly string[],
  provenance: EteSnapshotProvenance,
): provenance is Extract<EteSnapshotProvenance, { selection_status: 'common_exact_snapshot' }> {
  if (provenance.selection_status !== 'common_exact_snapshot') return false;

  const uniqueAffectedSet = new Set(affectedSet);
  if (uniqueAffectedSet.size !== affectedSet.length || uniqueAffectedSet.size === 0) return false;
  if (provenance.readings.length !== uniqueAffectedSet.size) return false;

  const observedRoads = new Set(provenance.readings.map((reading) => reading.road_id));
  return observedRoads.size === uniqueAffectedSet.size
    && [...uniqueAffectedSet].every((roadId) => observedRoads.has(roadId))
    && provenance.readings.every((reading) => reading.observation_timestamp === provenance.common_snapshot_timestamp);
}

function lowerBoundResult(input: EteCalculationInput, base_clearance: 60 | 40 | 20): EteCalculationResult {
  return {
    severity: input.severity,
    base_clearance,
    congestion_penalty: null,
    ete_minutes: null,
    ete_lower_bound_minutes: base_clearance,
    avg_saturation: null,
    affected_set: input.affected_set.affected_set,
    calculation_status: 'insufficient_common_snapshot',
    snapshot_provenance: {
      selection_status: 'insufficient_common_snapshot',
      event_timestamp: input.snapshot_provenance.event_timestamp,
      common_snapshot_timestamp: null,
      readings: [],
    },
    manual_confirmation_required: true,
    formula_applicability: input.affected_set.formula_applicability,
    applicability_note: input.affected_set.applicability_note ?? 'No common exact snapshot exists across the full ETE affected-road set.',
    lower_bound_only: true,
    applied_formula_articles: [7],
  };
}

export function baseClearanceFor(severity: Severity): 60 | 40 | 20 {
  switch (severity) {
    case Severity.Critical: return 60;
    case Severity.High: return 40;
    case Severity.Medium: return 20;
  }
}
