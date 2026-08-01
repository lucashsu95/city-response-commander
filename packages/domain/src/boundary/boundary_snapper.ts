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

import type { EntityScopeResult, Incident, PerimeterAnchor } from '@city-commander/shared-schemas';
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

// ─── Perimeter_Anchor derivation (R4 AC1/AC2/AC6/AC7) ──────

/**
 * Cache keyed by RoadNetworkModel instance — topology is immutable once
 * loaded (road_network_model.ts), so the derived anchor set never changes
 * for a given instance and only needs to be computed once.
 */
const perimeterAnchorCache = new WeakMap<RoadNetworkModel, readonly PerimeterAnchor[]>();

/**
 * Derive every Perimeter_Anchor from road-network topology alone — no
 * hardcoded anchor IDs (R4 AC1/AC2).
 *
 * A segment's `intersections` entry is a Perimeter_Gateway_Intersection when
 * it does not match any segment's `name` in the network — i.e. it names a
 * road the official dataset does not itself model, representing an opening
 * to outside the mapped jurisdiction (Glossary: Perimeter_Gateway_Intersection).
 *
 * One PerimeterAnchor is emitted per (segment, gateway_intersection) pair
 * (R4 AC2). Both fields are always real Road_Whitelist / Intersection_Whitelist
 * members by construction (R4 AC6/AC7), since they are read directly off the
 * RoadNetworkModel — never fabricated.
 */
export function derivePerimeterAnchors(roadNetwork: RoadNetworkModel): readonly PerimeterAnchor[] {
  const cached = perimeterAnchorCache.get(roadNetwork);
  if (cached !== undefined) return cached;

  const segments = roadNetwork.getAllSegments();
  const segmentNames = new Set(segments.map((segment) => segment.name));

  const anchors: PerimeterAnchor[] = [];
  for (const segment of segments) {
    for (const intersectionName of segment.intersections) {
      if (segmentNames.has(intersectionName)) continue; // not a gateway — resolves to a modeled segment
      anchors.push({
        segment_id: segment.segment_id,
        gateway_intersection: intersectionName,
        capacity_vph: segment.capacity_vph,
      });
    }
  }

  const frozen = Object.freeze(anchors);
  perimeterAnchorCache.set(roadNetwork, frozen);
  return frozen;
}
