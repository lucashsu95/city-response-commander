/**
 * AffectedRoadContext — Strategy B (AffectedRoadStrategy) output (§11.2)
 *
 * Produced by `AffectedRoadStrategy.role()` for incidents that carry an
 * `affected_road` field (only EVT_002-style incidents).
 *
 * Hard rules (never overridden by role or description text):
 * - BS_ events route to art.3 evaluation via `affected_segment`, NOT via
 *   `affected_road`.
 * - `affected_road` must NEVER directly trigger SOP art.2, regardless of
 *   the configured role.
 *
 * @module shared-schemas/affected_road_context
 */

/**
 * AffectedRoadContext — Strategy B role and derived context flags for
 * an incident's `affected_road`.
 */
export interface AffectedRoadContext {
  /** @derived incident event identifier this context was derived for */
  readonly incident_event_id: string;
  /** @derived segment_id, only present for EVT_002-style incidents */
  readonly affected_road: string;
  /**
   * @provisional Strategy B (OQ-002), resolved for implementation by
   * HG-001 default `display_only`, but remains configurable.
   */
  readonly role: 'display_only' | 'context_and_ete' | 'parallel_road_impact_explicit_host';
  /** @immutable-official hard rule: affected_road never directly triggers art.2 */
  readonly triggers_article2: false;
  /** @derived true only when role !== 'display_only' and policy C allows */
  readonly included_in_ete: boolean;
  /** @derived true only if role === 'parallel_road_impact_explicit_host' */
  readonly revalidated_article2_conditions: boolean;
}
