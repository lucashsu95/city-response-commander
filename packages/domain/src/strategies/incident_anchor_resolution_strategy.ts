/**
 * IncidentAnchorResolutionStrategy (Strategy D) — Incident Location Anchor Resolution
 *
 * Maps `Incident.location` text to a structured anchor (intersection, direction,
 * upstream/downstream) for art.2 candidate qualification, and when it cannot be
 * uniquely resolved, returns `manual_confirmation_required` with no primary and
 * unranked direct intersections (design doc sections 11.5, 10.8a, R6).
 *
 * Modes (config-driven via `policy.incident_anchor.mode`):
 * - `incident_anchor_from_location_text` (default): evidence-based match of
 *   intersection names within location text.
 * - `explicit_host_mapping`: use a configured mapping (for when the host provides
 *   explicit answers to OQ-004).
 *
 * OQ-004 - PROVISIONAL_TEAM_POLICY / AWAITING_HOST_REPLY
 *
 * @module domain/strategies/incident_anchor_resolution_strategy
 */

import type { Incident, IncidentAnchor, RoadSegment } from '@city-commander/shared-schemas';
import type { RoadNetworkModel } from '../road_network/road_network_model.js';

// ─── Types ─────────────────────────────────────────────────

/**
 * IncidentAnchorMode - strategy mode enum.
 * Matches the config schema's `policy.incident_anchor.mode` allowed values.
 */
export type IncidentAnchorMode = 'incident_anchor_from_location_text' | 'explicit_host_mapping';

/**
 * Configuration for explicit_host_mapping mode.
 * Maps event_id or location text patterns to explicit anchor data.
 */
export interface ExplicitAnchorMapping {
  readonly anchor_intersection: string;
  readonly position_relative_to_intersection: string;
}

/**
 * Configuration for the IncidentAnchorResolutionStrategy.
 */
export interface IncidentAnchorConfig {
  readonly mode: IncidentAnchorMode;
  /**
   * For explicit_host_mapping mode: a map from event_id to anchor data.
   * When the host provides explicit answers, this is populated.
   */
  readonly explicit_mappings?: Readonly<Record<string, ExplicitAnchorMapping>>;
}

/**
 * IncidentAnchorResolutionStrategy interface.
 * Resolves an incident's location text into a structured anchor.
 */
export interface IncidentAnchorResolutionStrategy {
  resolve(
    incident: Incident,
    roadNetwork: RoadNetworkModel,
    config: IncidentAnchorConfig,
  ): IncidentAnchor;
}

// ─── Default Implementation: incident_anchor_from_location_text ─────

/**
 * Default mode: evidence-based match of intersection names within location text.
 *
 * Algorithm:
 * 1. Get the affected road's intersections list from RoadNetworkModel
 * 2. For each intersection name, check if it appears in the location text
 * 3. If exactly ONE match -> high confidence, use it as the anchor
 * 4. If MULTIPLE matches -> resolution is ambiguous and requires manual confirmation
 * 5. If NO match -> low confidence, return manual_confirmation_required=true
 *
 * When non-unique resolution:
 * - manual_confirmation_required=true
 * - primary_evacuation=null (output indicates no primary should be selected)
 * - list unranked_direct_intersections
 * - never invent direction
 *
 * Output feeds upstream_or_downstream into EvacuationSelector via
 * RoadNetworkModel.positionRelativeToAnchor (NOT Strategy A).
 */
export const incidentAnchorFromLocationText: IncidentAnchorResolutionStrategy = {
  resolve(
    incident: Incident,
    roadNetwork: RoadNetworkModel,
    _config: IncidentAnchorConfig,
  ): IncidentAnchor {
    const affectedSegmentId = incident.affected_segment;
    const segment = roadNetwork.getSegment(affectedSegmentId);

    // If the affected segment is not found in the road network, cannot resolve
    if (!segment) {
      return buildUnresolvableAnchor(
        affectedSegmentId,
        incident.location,
        [],
        'affected_segment not found in road network',
      );
    }

    const intersections = segment.intersections;
    const locationText = incident.location;

    // Find intersection names (or their unambiguous road-name alias without a
    // section suffix, e.g. 忠孝東路四段 -> 忠孝東路) in the official location text.
    const matches: Array<{ name: string; index: number }> = [];
    for (let i = 0; i < intersections.length; i++) {
      if (intersectionAppearsInLocation(locationText, intersections[i])) {
        matches.push({ name: intersections[i], index: i });
      }
    }

    // Case: NO match -> low confidence, manual confirmation required
    if (matches.length === 0) {
      return buildUnresolvableAnchor(
        affectedSegmentId,
        locationText,
        intersections.slice(), // all intersections as unranked
        'no intersection name found in location text',
      );
    }

    // Case: Exactly ONE match -> high confidence
    if (matches.length === 1) {
      const match = matches[0];
      return buildResolvedAnchor(segment, match.name, match.index, locationText, 'high');
    }

    // Case: MULTIPLE matches -> non-unique. Never choose one or invent a
    // direction; expose only the matched intersections for manual resolution.
    return buildUnresolvableAnchor(
      affectedSegmentId,
      locationText,
      matches.map((match) => match.name),
      'multiple intersection names found in location text',
    );
  },
};

// ─── Alternative Implementation: explicit_host_mapping ─────

/**
 * Alternative mode: use a configured mapping for when the host
 * provides explicit answers to OQ-004.
 *
 * If the event_id has an explicit mapping, use it directly.
 * Otherwise, fall back to the location-text-based resolution.
 */
export const explicitHostMapping: IncidentAnchorResolutionStrategy = {
  resolve(
    incident: Incident,
    roadNetwork: RoadNetworkModel,
    config: IncidentAnchorConfig,
  ): IncidentAnchor {
    const mapping = config.explicit_mappings?.[incident.event_id];

    if (!mapping) {
      // No explicit mapping for this event — fall back to location text
      return incidentAnchorFromLocationText.resolve(incident, roadNetwork, config);
    }

    const affectedSegmentId = incident.affected_segment;
    const segment = roadNetwork.getSegment(affectedSegmentId);

    if (!segment) {
      return buildUnresolvableAnchor(
        affectedSegmentId,
        incident.location,
        [],
        'affected_segment not found in road network (explicit mapping mode)',
      );
    }

    const intersections = segment.intersections;
    const anchorIndex = intersections.indexOf(mapping.anchor_intersection);

    if (anchorIndex === -1) {
      // Mapped intersection not found in the segment's intersections
      return buildUnresolvableAnchor(
        affectedSegmentId,
        incident.location,
        intersections.slice(),
        `explicit mapping anchor "${mapping.anchor_intersection}" not found in segment intersections`,
      );
    }

    return {
      affected_road: segment.name,
      anchor_intersection: mapping.anchor_intersection,
      anchor_index: anchorIndex,
      travel_direction: segment.flow_direction,
      position_relative_to_intersection: mapping.position_relative_to_intersection,
      resolution_confidence: 'high',
      source_evidence: `explicit_host_mapping for event_id="${incident.event_id}"`,
      manual_confirmation_required: false,
      unranked_direct_intersections: [],
      provisional: true,
    };
  },
};

// ─── Strategy Resolver ─────────────────────────────────────

/**
 * Resolve the IncidentAnchorResolutionStrategy implementation from the configured mode.
 *
 * @param mode - The incident anchor mode from config
 * @returns The appropriate strategy implementation
 */
export function resolveIncidentAnchorStrategy(
  mode: IncidentAnchorMode,
): IncidentAnchorResolutionStrategy {
  switch (mode) {
    case 'incident_anchor_from_location_text':
      return incidentAnchorFromLocationText;
    case 'explicit_host_mapping':
      return explicitHostMapping;
    default: {
      const _exhaustive: never = mode;
      throw new Error(`Unknown incident anchor mode: ${mode}`);
    }
  }
}

// ─── Helpers ───────────────────────────────────────────────

function intersectionAppearsInLocation(locationText: string, intersectionName: string): boolean {
  if (locationText.includes(intersectionName)) return true;
  const roadAlias = intersectionName.replace(/[一二三四五六七八九十]+段$/u, '');
  return roadAlias !== intersectionName && locationText.includes(roadAlias);
}

/**
 * Extract a position hint from location text relative to an intersection.
 * Looks for directional keywords near the intersection name.
 */
function extractPositionHint(locationText: string, intersectionName: string): string {
  // Look for direction keywords following the intersection mention. Official
  // location text may omit the road section suffix used by road geometry.
  let afterIdx = locationText.indexOf(intersectionName);
  let matchedName = intersectionName;
  if (afterIdx === -1) {
    matchedName = intersectionName.replace(/[一二三四五六七八九十]+段$/u, '');
    afterIdx = locationText.indexOf(matchedName);
  }
  if (afterIdx === -1) return 'unknown';

  const afterText = locationText.slice(afterIdx + matchedName.length);
  const beforeText = locationText.slice(0, afterIdx);
  const contextText = beforeText + afterText;

  // Chinese directional keywords
  if (contextText.includes('北側') || contextText.includes('北方')) return 'north';
  if (contextText.includes('南側') || contextText.includes('南方')) return 'south';
  if (contextText.includes('東側') || contextText.includes('東方')) return 'east';
  if (contextText.includes('西側') || contextText.includes('西方')) return 'west';
  if (contextText.includes('上游')) return 'upstream';
  if (contextText.includes('下游')) return 'downstream';

  // Check for "口" pattern with direction: e.g., "忠孝東路口南側"
  const surroundingText = locationText;
  if (surroundingText.includes('口北側')) return 'north';
  if (surroundingText.includes('口南側')) return 'south';
  if (surroundingText.includes('口東側')) return 'east';
  if (surroundingText.includes('口西側')) return 'west';

  return 'at_intersection';
}

/**
 * Build an IncidentAnchor for a successfully resolved case.
 */
function buildResolvedAnchor(
  segment: RoadSegment,
  anchorIntersection: string,
  anchorIndex: number,
  locationText: string,
  confidence: 'high' | 'medium',
): IncidentAnchor {
  const positionHint = extractPositionHint(locationText, anchorIntersection);

  return {
    affected_road: segment.name,
    anchor_intersection: anchorIntersection,
    anchor_index: anchorIndex,
    travel_direction: segment.flow_direction,
    position_relative_to_intersection: positionHint,
    resolution_confidence: confidence,
    source_evidence: `location="${locationText}", matched intersection="${anchorIntersection}"`,
    manual_confirmation_required: false,
    unranked_direct_intersections: [],
    provisional: true,
  };
}

/**
 * Build an IncidentAnchor for an unresolvable case.
 *
 * When anchor cannot be uniquely resolved:
 * - manual_confirmation_required=true
 * - No primary evacuation should be selected (caller must handle)
 * - All direct intersections listed as unranked
 * - Never invent direction
 */
function buildUnresolvableAnchor(
  affectedSegmentId: string,
  locationText: string,
  unrankedIntersections: readonly string[],
  reason: string,
): IncidentAnchor {
  return {
    affected_road: affectedSegmentId,
    anchor_intersection: '',
    anchor_index: -1,
    travel_direction: '',
    position_relative_to_intersection: '',
    resolution_confidence: 'low',
    source_evidence: `location="${locationText}", resolution_failed: ${reason}`,
    manual_confirmation_required: true,
    unranked_direct_intersections: unrankedIntersections,
    provisional: true,
  };
}
