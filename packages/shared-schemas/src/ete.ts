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

/**
 * ETEResult — deterministic ETE computation output
 *
 * All fields LLM-prohibited; Bedrock MUST NOT recompute ETE.
 */
export interface ETEResult {
  /** @derived ETE in minutes = base_clearance + congestion_penalty */
  readonly ete_minutes: number;
  /** @derived Critical=60, High=40, Medium=20 */
  readonly base_clearance: number;
  /** @derived max(0, (avg_saturation - 0.5) * 60) */
  readonly congestion_penalty: number;
  /** @immutable-official event severity */
  readonly severity: string;
  /** @provisional average saturation of affected set (Strategy C) */
  readonly avg_saturation: number;
  /** @provisional affected segment IDs (Strategy C) */
  readonly affected_set?: readonly string[];
  /**
   * Whether the ETE formula is fully applicable.
   * PARTIALLY_DEFINED when inputs are not officially defined (OQ-003, OQ-011).
   * @provisional
   */
  readonly formula_applicability: 'applicable' | 'partially_defined';
  /** @provisional note about which inputs are not officially defined */
  readonly applicability_note?: string;
  /** @derived true when saturation data is insufficient */
  readonly lower_bound_only?: boolean;
}
