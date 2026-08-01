/**
 * RuleEngine Article 2 — SOP-2 Trigger and Candidate Qualification (3-AND)
 *
 * Deterministic encoding of SOP-2 (車禍與路障應變):
 *
 * TRIGGER (all three must be true):
 *   1. event.status IN {Closed, Blocked, Restricted}
 *   2. event.severity IN {High, Critical}
 *   3. event.affected_segment starts with "RD_"
 *      (BS_ events go to art.3, NOT art.2)
 *
 * CANDIDATE QUALIFICATION (exactly 3 AND conditions):
 *   1. capacity_vph >= 1000
 *   2. Candidate name appears in incident road's intersections (is_direct_intersection)
 *   3. Candidate intersection is upstream of incident point
 *
 * IMPORTANT: Saturation_Score is recorded on each candidate but is NOT a
 * qualification filter. It is used only for ranking among qualified candidates
 * (done in EvacuationSelector, TASK-025). See §9.4 art.2, §11.7, OQ-008.
 *
 * @module domain/rule_engine/article2
 */

import type { Incident, RouteCandidate, RoadSegment } from '@city-commander/shared-schemas';
import {
  IncidentStatus,
  Severity,
  UpstreamDownstream,
  RouteCandidateRole,
} from '@city-commander/shared-schemas';
import type { RoadNetworkModel } from '../road_network/road_network_model.js';

// ─── Constants ─────────────────────────────────────────────

/** Status values that satisfy the first trigger condition */
const TRIGGER_STATUSES: ReadonlySet<string> = new Set([
  IncidentStatus.Closed,
  IncidentStatus.Blocked,
  IncidentStatus.Restricted,
]);

/** Severity values that satisfy the second trigger condition */
const TRIGGER_SEVERITIES: ReadonlySet<string> = new Set([Severity.Critical, Severity.High]);

/** Prefix for road segment events (art.2 applies) */
const ROAD_SEGMENT_PREFIX = 'RD_';

/**
 * Minimum capacity for candidate qualification.
 * Exported for reuse by `universal_defense.ts` (UARE), which applies the same
 * physical-capacity floor to its own grounding candidates without redeclaring
 * the threshold value (design.md §5.1).
 */
export const CAPACITY_THRESHOLD = 1000;

// ─── Trigger ───────────────────────────────────────────────

/**
 * Determine whether SOP-2 (art.2) is triggered for a given incident.
 *
 * The 3-AND trigger conditions:
 *   1. status IN {Closed, Blocked, Restricted}
 *   2. severity IN {High, Critical}
 *   3. affected_segment starts with "RD_"
 *
 * BS_ events route to art.3 evaluation, NOT art.2.
 *
 * @param incident - The incident to evaluate
 * @returns true if all three conditions are met
 */
export function isArticle2Triggered(incident: Incident): boolean {
  // Condition 1: status IN {Closed, Blocked, Restricted}
  const statusMatch = TRIGGER_STATUSES.has(incident.status);

  // Condition 2: severity IN {High, Critical}
  const severityMatch = TRIGGER_SEVERITIES.has(incident.severity);

  // Condition 3: affected_segment starts with "RD_"
  // BS_ events go to art.3, not art.2
  const isRoadSegment = incident.affected_segment.startsWith(ROAD_SEGMENT_PREFIX);

  return statusMatch && severityMatch && isRoadSegment;
}

// ─── Candidate Qualification ───────────────────────────────

/**
 * A map of segment_id to saturation score at the current snapshot.
 * Saturation is recorded but NOT used as a qualification filter.
 */
export type SaturationMap = ReadonlyMap<string, number>;

/**
 * Evaluate each alternative of the incident segment against the 3-AND
 * qualification filters, producing RouteCandidate records.
 *
 * The 3-AND qualification conditions:
 *   1. capacity_vph >= 1000 (passes_capacity)
 *   2. Candidate name appears in incident road's intersections (is_direct_intersection)
 *   3. Candidate intersection is upstream of incident point (upstream_or_downstream)
 *
 * Saturation_Score is recorded on each candidate (saturation_at_snapshot) but
 * is explicitly EXCLUDED from qualification. It is used only for ranking among
 * qualified candidates (done downstream in EvacuationSelector).
 *
 * If anchorIntersection is null, upstream/downstream cannot be determined,
 * and candidates that otherwise pass capacity + direct intersection will be
 * marked as 'unranked_direct_intersection' (no primary selection possible).
 *
 * @param incidentSegmentId - The affected_segment from the incident
 * @param anchorIntersection - The resolved anchor intersection name (from Strategy D),
 *                             or null if unresolved
 * @param roadNetwork - The loaded RoadNetworkModel
 * @param saturationMap - Map of segment_id -> saturation score at snapshot
 * @returns Array of RouteCandidate records for all alternatives
 */
export function qualifyCandidates(
  incidentSegmentId: string,
  anchorIntersection: string | null,
  roadNetwork: RoadNetworkModel,
  saturationMap: SaturationMap,
): readonly RouteCandidate[] {
  // Get the incident segment to access its alternatives
  const incidentSegment = roadNetwork.getSegment(incidentSegmentId);
  if (!incidentSegment) {
    return [];
  }

  const alternatives = roadNetwork.alternativesOf(incidentSegmentId);

  return alternatives.map((altSegmentId) => {
    return evaluateSingleCandidate(
      altSegmentId,
      incidentSegmentId,
      incidentSegment,
      anchorIntersection,
      roadNetwork,
      saturationMap,
    );
  });
}

/**
 * Evaluate a single alternative against the 3-AND qualification.
 */
function evaluateSingleCandidate(
  candidateSegmentId: string,
  incidentSegmentId: string,
  incidentSegment: RoadSegment,
  anchorIntersection: string | null,
  roadNetwork: RoadNetworkModel,
  saturationMap: SaturationMap,
): RouteCandidate {
  const candidateSegment = roadNetwork.getSegment(candidateSegmentId);

  // Get capacity from the candidate segment (or 0 if not found)
  const capacity_vph = candidateSegment?.capacity_vph ?? 0;

  // Condition 1: capacity_vph >= 1000
  const passes_capacity = capacity_vph >= CAPACITY_THRESHOLD;

  // Condition 2: Candidate's name appears in incident road's intersections
  // We check if the candidate segment's name is in the incident road's intersections
  const candidateName = candidateSegment?.name ?? '';
  const is_direct_intersection = roadNetwork.isDirectIntersection(incidentSegmentId, candidateName);

  // Condition 3: Upstream determination (requires anchor)
  let upstream_or_downstream: UpstreamDownstream;
  let canDeterminePosition = false;

  if (anchorIntersection !== null && candidateName !== '') {
    const position = roadNetwork.positionRelativeToAnchor(
      incidentSegmentId,
      candidateName,
      anchorIntersection,
    );
    if (position === 'upstream') {
      upstream_or_downstream = UpstreamDownstream.upstream;
      canDeterminePosition = true;
    } else if (position === 'downstream') {
      upstream_or_downstream = UpstreamDownstream.downstream;
      canDeterminePosition = true;
    } else {
      // Position is null (not found in intersections or same as anchor)
      upstream_or_downstream = UpstreamDownstream.downstream;
      canDeterminePosition = false;
    }
  } else {
    // Anchor unresolved — cannot determine upstream/downstream
    upstream_or_downstream = UpstreamDownstream.downstream;
    canDeterminePosition = false;
  }

  // Saturation at snapshot (NOT a qualification filter, recorded for ranking)
  const saturation_at_snapshot = saturationMap.get(candidateSegmentId) ?? 0;

  // Determine role based on qualification
  const { role, exclusion_reason } = determineRole(
    passes_capacity,
    is_direct_intersection,
    upstream_or_downstream,
    canDeterminePosition,
    anchorIntersection,
    capacity_vph,
  );

  return {
    segment_id: candidateSegmentId,
    capacity_vph,
    passes_capacity,
    is_direct_intersection,
    upstream_or_downstream,
    saturation_at_snapshot,
    role,
    exclusion_reason,
  };
}

/**
 * Determine the role of a candidate based on the 3-AND qualification.
 *
 * Qualification = passes_capacity AND is_direct_intersection AND upstream.
 * Saturation is NOT a filter.
 */
function determineRole(
  passes_capacity: boolean,
  is_direct_intersection: boolean,
  upstream_or_downstream: UpstreamDownstream,
  canDeterminePosition: boolean,
  anchorIntersection: string | null,
  capacity_vph: number,
): { role: RouteCandidateRole; exclusion_reason?: string } {
  // If anchor is unresolved, cannot rank — mark as unranked if direct intersection
  if (anchorIntersection === null) {
    if (passes_capacity && is_direct_intersection) {
      return { role: RouteCandidateRole.unranked_direct_intersection };
    }
    // Still excluded if capacity or intersection fails
    if (!passes_capacity) {
      return {
        role: RouteCandidateRole.excluded,
        exclusion_reason: `capacity_vph ${capacity_vph} < ${CAPACITY_THRESHOLD}`,
      };
    }
    if (!is_direct_intersection) {
      return {
        role: RouteCandidateRole.excluded,
        exclusion_reason: '不在事故路段的 intersections（非直接相交）',
      };
    }
    return { role: RouteCandidateRole.unranked_direct_intersection };
  }

  // Anchor is resolved — apply full 3-AND qualification

  // Check capacity first
  if (!passes_capacity) {
    return {
      role: RouteCandidateRole.excluded,
      exclusion_reason: `capacity_vph ${capacity_vph} < ${CAPACITY_THRESHOLD}`,
    };
  }

  // Check direct intersection
  if (!is_direct_intersection) {
    return {
      role: RouteCandidateRole.excluded,
      exclusion_reason: '不在事故路段的 intersections（非直接相交）',
    };
  }

  // Check upstream (third condition)
  if (!canDeterminePosition) {
    // Cannot determine position even with anchor (e.g., candidate not in intersections list)
    return {
      role: RouteCandidateRole.excluded,
      exclusion_reason: '無法判定候選路口相對於錨點的上下游位置',
    };
  }

  if (upstream_or_downstream === UpstreamDownstream.downstream) {
    // Downstream candidates are listed as secondary only, not excluded
    return { role: RouteCandidateRole.secondary };
  }

  // All 3 conditions met: upstream + direct intersection + capacity >= 1000
  // Role will be finalized (primary selection by lowest saturation) in EvacuationSelector
  // For now, mark as primary (qualified candidate)
  return { role: RouteCandidateRole.primary };
}
