/**
 * ETE calculation trace types for What-if and incident responses.
 *
 * Captures the SOP-7 formula, all inputs, and the step-by-step
 * substitution so that the result is independently auditable.
 *
 * Formula (SOP Article 7):
 *   ETE_minutes = base_clearance + congestion_penalty
 *   congestion_penalty = max(0, (avg_saturation - 0.5) × 60)
 *   base_clearance: Critical=60, High=40, Medium=20
 *
 * @module shared-schemas/ete_calculation
 */

/**
 * A single variable used in the ETE formula.
 */
export interface EteCalculationVariable {
  /** Variable name as it appears in the SOP-7 formula */
  readonly name: string;
  /** The numeric value used in this calculation */
  readonly value: number;
  /** Unit of measurement */
  readonly unit: string;
  /**
   * Where this value came from.
   * "incident.severity" | "traffic.saturation_score" | "computed" | "missing"
   */
  readonly source: string;
}

/**
 * ETE calculation trace attached to What-if and incident responses.
 *
 * When `result_minutes` is present, the calculation is complete.
 * When `result_minutes` is null, `missing_inputs` lists the variables
 * that could not be resolved — no fabricated values are used.
 */
export interface EteCalculationTrace {
  /** SOP article that defines the formula */
  readonly source_article: 7;
  /** The canonical SOP-7 formula text */
  readonly formula: string;
  /** All variables used in the substitution */
  readonly variables: readonly EteCalculationVariable[];
  /** Step-by-step substitution string (e.g. "60 + 4.4 = 64.4") */
  readonly substitution: string;
  /**
   * Final ETE in minutes. Null when the formula cannot be fully evaluated
   * (e.g. missing saturation data). Null does NOT mean zero.
   */
  readonly result_minutes: number | null;
  /** Timestamp used as the base for recovery_at (event timestamp or assumption timestamp) */
  readonly base_timestamp: string;
  /** Timezone of base_timestamp (IANA tz name or UTC offset) */
  readonly timezone: string;
  /**
   * Computed recovery timestamp: base_timestamp + result_minutes.
   * Null when result_minutes is null.
   */
  readonly recovery_at: string | null;
  /**
   * Variables that could not be resolved from the data.
   * Empty when all inputs are available.
   */
  readonly missing_inputs: readonly string[];
}
