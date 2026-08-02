/**
 * Road name → geographic polyline dictionary (Xinyi District, Taipei).
 *
 * CSV traffic rows carry `road_name` only — no lat/lng. This lookup table
 * supplies `[Lat, Lng]` vertices for Leaflet `Polyline` rendering.
 *
 * @module frontend/constants/roadDictionary
 */

/** Leaflet-compatible coordinate tuple: `[latitude, longitude]`. */
export type RoadCoordinate = readonly [lat: number, lng: number];

/** A named road segment as an ordered polyline. */
export interface RoadGeometry {
  readonly roadName: string;
  readonly coordinates: readonly RoadCoordinate[];
}

/**
 * Primary Xinyi District roads used in demo / ACC_001 scenarios.
 *
 * Coordinates are approximate centre-line paths suitable for operational
 * visualization — not survey-grade geometry.
 */
export const ROAD_DICTIONARY: Readonly<Record<string, readonly RoadCoordinate[]>> = Object.freeze({
  光復南路: Object.freeze([
    [25.0364, 121.5576],
    [25.0382, 121.5578],
    [25.0401, 121.558],
    [25.042, 121.5582],
    [25.0442, 121.5584],
  ] as const),
  市民大道四段: Object.freeze([
    [25.041, 121.5512],
    [25.0411, 121.554],
    [25.0412, 121.5568],
    [25.0413, 121.5596],
    [25.0414, 121.5624],
  ] as const),
  仁愛路四段: Object.freeze([
    [25.0378, 121.5518],
    [25.038, 121.5552],
    [25.0382, 121.5586],
    [25.0384, 121.562],
  ] as const),
  逸仙路: Object.freeze([
    [25.0392, 121.5552],
    [25.0402, 121.5558],
    [25.0412, 121.5564],
    [25.0422, 121.557],
  ] as const),
});

/** All road names that have known geometry. */
export const ROAD_DICTIONARY_KEYS: readonly string[] = Object.freeze(
  Object.keys(ROAD_DICTIONARY),
);

/**
 * Resolve a CSV `road_name` to its polyline coordinates.
 *
 * @returns coordinates when the name exists; `null` when unmapped (safe skip).
 */
export function lookupRoadCoordinates(roadName: string): readonly RoadCoordinate[] | null {
  const trimmed = roadName.trim();
  if (trimmed.length === 0) return null;

  const coordinates = ROAD_DICTIONARY[trimmed];
  if (coordinates === undefined || coordinates.length < 2) return null;

  return coordinates;
}
