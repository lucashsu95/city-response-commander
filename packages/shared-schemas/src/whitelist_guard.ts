/**
 * Whitelist_Guard types — partitioning any candidate road-id set against
 * Road_Whitelist (spec: boundary-snapping-containment, R9 AC1, R14.5).
 *
 * @module shared-schemas/whitelist_guard
 */

export interface WhitelistPartition {
  /** Members of the candidate set that are in the whitelist. */
  readonly allowed: ReadonlySet<string>;
  /** Members of the candidate set that are NOT in the whitelist. */
  readonly rejected: ReadonlySet<string>;
}
