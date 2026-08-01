/**
 * Boundary_Snapper — Entity_Scope_Check and (later) spatial snapping
 * (spec: boundary-snapping-containment, R2/R3/R4/R5).
 *
 * Pure functions only. Imports only `@city-commander/shared-schemas` types
 * and other `packages/domain` modules — never Layer 2/3 code (design.md §1
 * Requirement 1 AC3).
 *
 * @module domain/boundary/boundary_snapper
 */

import type { EntityScopeResult, Incident } from '@city-commander/shared-schemas';
import type { RoadNetworkModel } from '../road_network/road_network_model.js';
import { intersectionAppearsInLocation } from '../road_network/intersection_text_match.js';

/**
 * Entity_Scope_Check (R2) — determine whether an incident's location falls
 * within Road_Network coverage using only `affected_segment` / `affected_road`
 * / `location` text. No coordinates required or consulted.
 *
 * Precedence (R2 AC1-AC4):
 * 1. `affected_segment` ∈ Road_Whitelist → IN_SCOPE
 * 2. else `affected_road` ∈ Road_Whitelist → IN_SCOPE
 * 3. else `location` text contains an Intersection_Whitelist name → IN_SCOPE_BY_INTERSECTION
 * 4. else → OUT_OF_BOUNDS
 */
export function checkEntityScope(
  incident: Incident,
  roadNetwork: RoadNetworkModel,
): EntityScopeResult {
  // R2 AC1
  if (roadNetwork.getSegment(incident.affected_segment) !== undefined) {
    return {
      coverage_status: 'IN_SCOPE',
      decision_anchor_segment_id: incident.affected_segment,
      matched_field: 'affected_segment',
      matched_value: incident.affected_segment,
    };
  }

  // R2 AC2
  if (
    incident.affected_road !== undefined &&
    roadNetwork.getSegment(incident.affected_road) !== undefined
  ) {
    return {
      coverage_status: 'IN_SCOPE',
      decision_anchor_segment_id: incident.affected_road,
      matched_field: 'affected_road',
      matched_value: incident.affected_road,
    };
  }

  // R2 AC3/AC5 — collect every Intersection_Whitelist name that appears in the
  // location text, each with the set of segments listing it.
  const nameToSegmentIds = new Map<string, string[]>();
  for (const segment of roadNetwork.getAllSegments()) {
    for (const intersectionName of segment.intersections) {
      if (!intersectionAppearsInLocation(incident.location, intersectionName)) continue;
      const segmentIds = nameToSegmentIds.get(intersectionName) ?? [];
      segmentIds.push(segment.segment_id);
      nameToSegmentIds.set(intersectionName, segmentIds);
    }
  }

  if (nameToSegmentIds.size === 0) {
    // R2 AC4
    return {
      coverage_status: 'OUT_OF_BOUNDS',
      decision_anchor_segment_id: null,
      matched_field: null,
      matched_value: null,
    };
  }

  // R2 AC5 — longest intersection-name match wins; tie-break lexicographically smallest name.
  let winningName: string | null = null;
  for (const name of nameToSegmentIds.keys()) {
    if (
      winningName === null ||
      name.length > winningName.length ||
      (name.length === winningName.length && name < winningName)
    ) {
      winningName = name;
    }
  }

  // R2 AC3 — anchor is the lexicographically smallest segment_id among segments
  // that list the winning intersection name.
  const candidateSegmentIds = nameToSegmentIds.get(winningName as string) ?? [];
  const anchorSegmentId = [...candidateSegmentIds].sort()[0] ?? null;

  return {
    coverage_status: 'IN_SCOPE_BY_INTERSECTION',
    decision_anchor_segment_id: anchorSegmentId,
    matched_field: 'location_intersection',
    matched_value: winningName,
  };
}
