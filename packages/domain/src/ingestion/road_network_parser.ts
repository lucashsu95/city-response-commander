/**
 * Road Network Geometry Parser — road_network_geometry.json
 *
 * Parses raw JSON string content into typed RoadSegment[].
 * Preserves `intersections` order (upstream→downstream) verbatim.
 * Preserves `alternatives` order verbatim.
 * Treats empty `nearby_stations` as a valid empty set (never fills).
 * Rejects on malformed geometry (no fabrication).
 *
 * @module domain/ingestion/road_network_parser
 */

import type { RoadSegment } from '@city-commander/shared-schemas';

/** Error types for road network parsing failures */
export class RoadNetworkParseError extends Error {
  constructor(
    message: string,
    public readonly code: 'INVALID_JSON' | 'NOT_ARRAY' | 'INVALID_SEGMENT' | 'EMPTY_DATA',
    public readonly details?: { index?: number; field?: string; value?: unknown },
  ) {
    super(message);
    this.name = 'RoadNetworkParseError';
  }
}

/**
 * Validate that a value is a non-empty string.
 */
function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Validate that a value is a string array.
 */
function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

/**
 * Validate and parse a single segment object.
 */
function validateSegment(raw: unknown, index: number): RoadSegment {
  if (raw === null || typeof raw !== 'object') {
    throw new RoadNetworkParseError(
      `Segment at index ${index}: expected an object`,
      'INVALID_SEGMENT',
      { index },
    );
  }

  const obj = raw as Record<string, unknown>;

  // segment_id: required non-empty string
  if (!isNonEmptyString(obj.segment_id)) {
    throw new RoadNetworkParseError(
      `Segment at index ${index}: "segment_id" must be a non-empty string`,
      'INVALID_SEGMENT',
      { index, field: 'segment_id', value: obj.segment_id },
    );
  }

  // name: required non-empty string
  if (!isNonEmptyString(obj.name)) {
    throw new RoadNetworkParseError(
      `Segment at index ${index}: "name" must be a non-empty string`,
      'INVALID_SEGMENT',
      { index, field: 'name', value: obj.name },
    );
  }

  // flow_direction: required non-empty string
  if (!isNonEmptyString(obj.flow_direction)) {
    throw new RoadNetworkParseError(
      `Segment at index ${index}: "flow_direction" must be a non-empty string`,
      'INVALID_SEGMENT',
      { index, field: 'flow_direction', value: obj.flow_direction },
    );
  }

  // intersections: required string array (may be empty)
  if (!isStringArray(obj.intersections)) {
    throw new RoadNetworkParseError(
      `Segment at index ${index}: "intersections" must be a string array`,
      'INVALID_SEGMENT',
      { index, field: 'intersections', value: obj.intersections },
    );
  }

  // capacity_vph: required positive integer
  if (
    typeof obj.capacity_vph !== 'number' ||
    !Number.isFinite(obj.capacity_vph) ||
    obj.capacity_vph < 0
  ) {
    throw new RoadNetworkParseError(
      `Segment at index ${index}: "capacity_vph" must be a non-negative number`,
      'INVALID_SEGMENT',
      { index, field: 'capacity_vph', value: obj.capacity_vph },
    );
  }

  // alternatives: required string array (may be empty)
  if (!isStringArray(obj.alternatives)) {
    throw new RoadNetworkParseError(
      `Segment at index ${index}: "alternatives" must be a string array`,
      'INVALID_SEGMENT',
      { index, field: 'alternatives', value: obj.alternatives },
    );
  }

  // nearby_stations: required string array (empty is valid and normal)
  if (!isStringArray(obj.nearby_stations)) {
    throw new RoadNetworkParseError(
      `Segment at index ${index}: "nearby_stations" must be a string array`,
      'INVALID_SEGMENT',
      { index, field: 'nearby_stations', value: obj.nearby_stations },
    );
  }

  return Object.freeze({
    segment_id: obj.segment_id,
    name: obj.name,
    flow_direction: obj.flow_direction,
    intersections: Object.freeze([...obj.intersections]),
    capacity_vph: obj.capacity_vph,
    alternatives: Object.freeze([...obj.alternatives]),
    nearby_stations: Object.freeze([...obj.nearby_stations]),
  });
}

/**
 * Parse raw JSON content into typed RoadSegment[].
 *
 * @param jsonContent - Raw JSON string
 * @returns Readonly array of RoadSegment with array orders preserved
 * @throws RoadNetworkParseError on malformed data
 */
export function parseRoadNetworkJson(jsonContent: string): readonly RoadSegment[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonContent);
  } catch (e) {
    throw new RoadNetworkParseError(
      `Failed to parse JSON: ${(e as Error).message}`,
      'INVALID_JSON',
    );
  }

  if (!Array.isArray(parsed)) {
    throw new RoadNetworkParseError('Road network JSON must be a top-level array', 'NOT_ARRAY');
  }

  if (parsed.length === 0) {
    throw new RoadNetworkParseError('Road network JSON array is empty', 'EMPTY_DATA');
  }

  const segments: RoadSegment[] = [];
  for (let i = 0; i < parsed.length; i++) {
    segments.push(validateSegment(parsed[i], i));
  }

  return Object.freeze(segments);
}
