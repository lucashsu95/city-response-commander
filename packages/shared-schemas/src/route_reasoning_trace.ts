/**
 * Route Reasoning Trace — SOP Article 2 route selection explanation.
 *
 * Exposes the deterministic route evaluation so that:
 * - Frontend/dashboard can display why each route was selected or excluded
 * - Auditors can verify SOP-2 compliance without re-running the engine
 *
 * @module shared-schemas/route_reasoning_trace
 */

/**
 * Single route candidate evaluation in the route reasoning trace.
 */
export interface RouteReasoningEntry {
  /** Road segment ID (e.g. "RD_TPE_004") */
  readonly candidate_segment: string;
  /** Capacity in vehicles per hour */
  readonly capacity_vph: number | null;
  /** Current saturation score (0.0–1.0) */
  readonly saturation: number | null;
  /** Whether this segment intersects the incident road */
  readonly intersects_incident: boolean;
  /** Whether the intersecting point is upstream or downstream of the incident */
  readonly topology_role: 'upstream' | 'downstream' | 'not_intersecting';
  /** Whether the segment passed all SOP-2 criteria */
  readonly accepted: boolean;
  /** Human-readable reason for acceptance or exclusion */
  readonly reason: string;
  /** SOP source article */
  readonly source_article: 2;
}

/**
 * Route reasoning trace for the response.
 *
 * Attached when Article 2 (車禍與路障應變) is triggered.
 * `primary_route` is the one selected by the deterministic Rule Engine.
 * `route_reasoning` lists every considered alternative with acceptance/rejection reason.
 */
export interface RouteReasoningTrace {
  /** The incident road segment */
  readonly incident_segment: string;
  /** The primary evacuation route chosen by the deterministic engine */
  readonly primary_route: string | null;
  /** Whether the primary route is congested (Sat >= 0.85) */
  readonly primary_route_congested: boolean | null;
  /** Per-candidate evaluation details */
  readonly route_reasoning: readonly RouteReasoningEntry[];
  /** SOP source article */
  readonly source_article: 2;
}
