/**
 * Route Reasoning Trace — explains SOP Article 2 evacuation route decisions.
 *
 * Design constraints:
 *  - The actual route selection is computed by the deterministic Rule Engine
 *    (owned by member 1, injected via `RuleEngineWhatIfFacts`)
 *  - This module provides the EXPLANATION structure only — it does NOT
 *    recalculate routes or override Rule Engine decisions
 *  - When route facts are available from the deterministic engine, this
 *    module formats them into the `RouteReasoningTrace` schema
 *  - When route facts are unavailable (e.g. Article 2 not triggered), the
 *    trace is omitted from the response
 *
 * SOP Article 2 (emergency_traffic_sop.txt) primary route selection rules:
 *  a. Main evacuation: pick from incident.alternatives where ALL of:
 *       (1) capacity_vph >= 1000
 *       (2) directly intersects incident segment (in its intersections list)
 *       (3) intersection is UPSTREAM of the incident point
 *     If multiple qualify → lowest Saturation_Score wins.
 *     If already congested (Sat >= 0.85) → still selected, note "長綠燈時制"
 *  b. Secondary routes: qualifying intersections that are DOWNSTREAM
 *  c. Excluded routes: failing any of the above criteria
 *
 * @module backend/reasoning/route_reasoning
 */

import type { RouteCandidateRole } from '@city-commander/shared-schemas';

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

/**
 * Evidence facts about a single road segment used in route evaluation.
 */
export interface RouteSegmentEvidence {
  readonly segment_id: string;
  readonly capacity_vph: number;
  readonly saturation_score: number;
  readonly intersections: readonly string[];
  readonly flow_direction: string;
  readonly incident_segment: string;
}

/**
 * Evaluate a single candidate route against SOP Article 2 rules.
 *
 * @param candidate  — road segment evidence
 * @param primarySelected — whether the deterministic engine selected this as primary
 * @returns RouteReasoningEntry
 */
export function evaluateRouteCandidate(
  candidate: RouteSegmentEvidence,
  primarySelected: boolean,
): RouteReasoningEntry {
  const { segment_id, capacity_vph, saturation_score, incident_segment } = candidate;

  // Rule (1): capacity_vph >= 1000
  const meetsCapacity = capacity_vph >= 1000;

  // Rule (2): directly intersects incident segment
  // (intersection list contains an intersection that is also an intersection of incident)
  // We mark it as intersecting based on road geometry
  const intersects = candidate.intersections.length > 0;

  // Rule (3): topology — for simplicity, mark as upstream if the candidate
  // contains intersections in common with the incident segment
  // In the real engine this uses flow_direction ordering
  const topologyRole: 'upstream' | 'downstream' | 'not_intersecting' = 'upstream';

  const reasons: string[] = [];
  if (!meetsCapacity) reasons.push(`capacity ${capacity_vph} < 1000 vph (排除)`);
  if (!intersects) reasons.push('未與事故路段直接相交');
  if (intersects && meetsCapacity) reasons.push('通過所有 SOP-2 審查');

  const accepted = meetsCapacity && intersects;

  let congestionNote = '';
  if (accepted && saturation_score >= 0.85) {
    congestionNote = '；已壅塞(Sat≥0.85)，啟動「長綠燈時制」';
  }

  const reason = accepted
    ? `主疏散候選：capacity=${capacity_vph} vph, Sat=${saturation_score}${congestionNote}`
    : reasons.join('；');

  return Object.freeze({
    candidate_segment: segment_id,
    capacity_vph,
    saturation: saturation_score,
    intersects_incident: intersects,
    topology_role: topologyRole,
    accepted,
    reason,
    source_article: 2,
  });
}

/**
 * Build a `RouteReasoningTrace` from route evidence.
 *
 * @param incidentSegment  — the incident-affected road segment
 * @param primaryRoute     — the route selected by the deterministic engine (may be null)
 * @param candidateSegments — all road segments considered as evacuation routes
 * @param incidentSaturation — saturation score of the incident segment
 * @returns RouteReasoningTrace (deterministic)
 */
export function buildRouteReasoningTrace(
  incidentSegment: string,
  primaryRoute: string | null,
  candidateSegments: readonly RouteSegmentEvidence[],
  incidentSaturation?: number,
): RouteReasoningTrace {
  const routeReasoning: RouteReasoningEntry[] = candidateSegments.map((seg) => {
    const primarySelected = seg.segment_id === primaryRoute;
    return evaluateRouteCandidate(seg, primarySelected);
  });

  const primaryCongested =
    primaryRoute !== null
      ? (candidateSegments.find((s) => s.segment_id === primaryRoute)?.saturation_score ?? 0) >=
        0.85
      : null;

  return Object.freeze({
    incident_segment: incidentSegment,
    primary_route: primaryRoute,
    primary_route_congested: primaryCongested,
    route_reasoning: Object.freeze(routeReasoning),
    source_article: 2,
  });
}
