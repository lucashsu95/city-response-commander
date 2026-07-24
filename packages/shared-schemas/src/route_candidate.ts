/**
 * RouteCandidate — SOP2 evacuation candidate (§10.8)
 *
 * Qualification: exactly 3 AND conditions (capacity, direct intersection, upstream).
 * Saturation is NOT a hard filter — it's used for ranking only.
 *
 * @module shared-schemas/route_candidate
 */

import type { RouteCandidateRole, UpstreamDownstream } from './enums.js';

/**
 * RouteCandidate — evacuation route candidate per SOP-2
 *
 * All fields derived deterministically; LLM-prohibited.
 */
export interface RouteCandidate {
  /** @derived segment identifier */
  readonly segment_id: string;
  /** @immutable-official capacity in vehicles per hour */
  readonly capacity_vph: number;
  /** @derived passes capacity >= 1000 */
  readonly passes_capacity: boolean;
  /** @derived candidate appears in incident road's intersections */
  readonly is_direct_intersection: boolean;
  /**
   * @provisional Determined by RoadNetworkModel + Strategy D (NOT Strategy A)
   */
  readonly upstream_or_downstream: UpstreamDownstream;
  /**
   * @provisional Saturation at the time-aligned snapshot (Strategy A).
   * NOT a qualification filter — used only for ranking among qualified candidates.
   */
  readonly saturation_at_snapshot: number;
  /** @derived role in evacuation decision */
  readonly role: RouteCandidateRole;
  /** @derived non-empty exclusion reason when role=excluded (R13.3) */
  readonly exclusion_reason?: string;
}
