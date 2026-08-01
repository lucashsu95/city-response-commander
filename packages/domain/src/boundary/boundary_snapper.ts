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

import type {
  AnchorGazetteerEntry,
  BoundarySnapperConfig,
  BoundarySnapperConfigError,
  EntityScopeResult,
  Incident,
  PerimeterAnchor,
  SnapResult,
} from '@city-commander/shared-schemas';
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

// ─── Spatial snapping (R3, R4 AC3-AC8, R5) ─────────────────

const EARTH_RADIUS_METERS = 6371000;

/**
 * Standard haversine great-circle distance between two WGS84 coordinates,
 * rounded to the nearest integer meter (R3 AC2/AC5).
 */
export function haversineMeters(a: AnchorGazetteerEntry, b: AnchorGazetteerEntry): number {
  const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;
  const deltaLat = toRadians(b.lat - a.lat);
  const deltaLon = toRadians(b.lon - a.lon);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const sinHalfDeltaLat = Math.sin(deltaLat / 2);
  const sinHalfDeltaLon = Math.sin(deltaLon / 2);
  const h =
    sinHalfDeltaLat * sinHalfDeltaLat +
    Math.cos(lat1) * Math.cos(lat2) * sinHalfDeltaLon * sinHalfDeltaLon;
  const centralAngle = 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));

  return Math.round(EARTH_RADIUS_METERS * centralAngle);
}

/** WGS84 bounds check (R3 AC4). */
function isValidCoordinate(coordinate: AnchorGazetteerEntry): boolean {
  return (
    coordinate.lat >= -90 &&
    coordinate.lat <= 90 &&
    coordinate.lon >= -180 &&
    coordinate.lon <= 180
  );
}

/** R4 AC3 — highest capacity_vph wins; tie-break lexicographically smallest segment_id. */
function pickByCapacity(anchors: readonly PerimeterAnchor[]): PerimeterAnchor {
  let best = anchors[0] as PerimeterAnchor;
  for (const anchor of anchors) {
    if (
      anchor.capacity_vph > best.capacity_vph ||
      (anchor.capacity_vph === best.capacity_vph && anchor.segment_id < best.segment_id)
    ) {
      best = anchor;
    }
  }
  return best;
}

/** R4 AC4 — nearest by haversine distance wins; tie-break lexicographically smallest segment_id. */
function pickByDistance(
  anchors: readonly { anchor: PerimeterAnchor; distance: number }[],
): { anchor: PerimeterAnchor; distance: number } {
  let best = anchors[0] as { anchor: PerimeterAnchor; distance: number };
  for (const candidate of anchors) {
    if (
      candidate.distance < best.distance ||
      (candidate.distance === best.distance && candidate.anchor.segment_id < best.anchor.segment_id)
    ) {
      best = candidate;
    }
  }
  return best;
}

/**
 * Spatial snapping (R4 AC3-AC8, R5) — only called once `checkEntityScope`
 * has already returned `OUT_OF_BOUNDS` (R4 AC8: the caller must not invoke
 * this, and must set the anchor field to `null`, for `IN_SCOPE` /
 * `IN_SCOPE_BY_INTERSECTION` incidents — that precondition is the caller's
 * responsibility, not re-checked here).
 *
 * `eventCoordinate` is an optional WGS84 point supplied by the caller
 * (e.g. a future Dashboard map-click) — the `Incident` schema itself
 * carries no coordinate fields, so this is never derived from `incident`.
 * Against the current official dataset this is always `undefined` and the
 * coordinate path is consequently unreachable (design.md §11 Non-Goals).
 */
export function snap(
  incident: Incident,
  roadNetwork: RoadNetworkModel,
  config: BoundarySnapperConfig,
  eventCoordinate?: AnchorGazetteerEntry,
): SnapResult | BoundarySnapperConfigError {
  void incident; // reserved for future per-incident snapping refinements; unused today.

  // R5 AC1/AC2 — defense-in-depth: never snap without a real threshold.
  if (typeof config.max_snap_distance_meters !== 'number' || !Number.isFinite(config.max_snap_distance_meters)) {
    return { error: 'CONFIG_MISSING', missing_key: 'boundary_snapping.max_snap_distance_meters' };
  }

  const anchors = derivePerimeterAnchors(roadNetwork);
  if (anchors.length === 0) {
    // R4 AC5
    return {
      coverage_status: 'OUT_OF_JURISDICTION',
      anchor: null,
      distance_meters: null,
      reason: 'no_perimeter_anchor_available',
      evidence: [],
    };
  }

  // Determine whether the coordinate path is actually usable for this call.
  let coordinatePathEvidence: string | null = null;
  let usableCoordinate: AnchorGazetteerEntry | null = null;

  if (!config.coordinate_path_enabled) {
    coordinatePathEvidence = 'distance_threshold_not_applicable'; // R5 AC6
  } else if (eventCoordinate === undefined) {
    coordinatePathEvidence = 'distance_threshold_not_applicable';
  } else if (!isValidCoordinate(eventCoordinate)) {
    coordinatePathEvidence = 'invalid_coordinate'; // R3 AC4
  } else if (config.anchor_gazetteer === undefined) {
    coordinatePathEvidence = 'gazetteer_unavailable'; // R3 AC3
  } else {
    usableCoordinate = eventCoordinate;
  }

  if (usableCoordinate === null) {
    // R4 AC3 — capacity-based fallback.
    return {
      coverage_status: 'OUT_OF_BOUNDS_SNAPPED',
      anchor: pickByCapacity(anchors),
      distance_meters: null,
      reason: 'nearest_perimeter_anchor_by_capacity',
      evidence: coordinatePathEvidence !== null ? [coordinatePathEvidence] : [],
    };
  }

  // R4 AC4 — distance-based selection among anchors with a known gazetteer coordinate.
  const gazetteer = config.anchor_gazetteer as ReadonlyMap<string, AnchorGazetteerEntry>;
  const withDistance = anchors
    .map((anchor) => {
      const anchorCoordinate = gazetteer.get(anchor.segment_id);
      if (anchorCoordinate === undefined) return null;
      return { anchor, distance: haversineMeters(usableCoordinate as AnchorGazetteerEntry, anchorCoordinate) };
    })
    .filter((entry): entry is { anchor: PerimeterAnchor; distance: number } => entry !== null);

  if (withDistance.length === 0) {
    // No anchor has a known coordinate in the gazetteer — degrade to capacity path.
    return {
      coverage_status: 'OUT_OF_BOUNDS_SNAPPED',
      anchor: pickByCapacity(anchors),
      distance_meters: null,
      reason: 'nearest_perimeter_anchor_by_capacity',
      evidence: ['gazetteer_unavailable'],
    };
  }

  const nearest = pickByDistance(withDistance);

  if (nearest.distance > config.max_snap_distance_meters) {
    // R5 AC3
    return {
      coverage_status: 'OUT_OF_JURISDICTION',
      anchor: null,
      distance_meters: nearest.distance,
      reason: `distance_exceeds_max_snap_distance_meters:measured=${nearest.distance},threshold=${config.max_snap_distance_meters}`,
      evidence: [],
    };
  }

  return {
    coverage_status: 'OUT_OF_BOUNDS_SNAPPED',
    anchor: nearest.anchor,
    distance_meters: nearest.distance,
    reason: 'nearest_perimeter_anchor_by_distance',
    evidence: [],
  };
}
