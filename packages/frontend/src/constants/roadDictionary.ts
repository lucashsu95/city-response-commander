/**
 * Road name → geographic polyline dictionary (Xinyi District, Taipei).
 *
 * CSV traffic rows carry `road_name` only — no lat/lng. This lookup table
 * supplies `[Lat, Lng]` vertices for Leaflet `Polyline` rendering.
 *
 * Coordinates align with `demo-data-source/road_network_geometry.json` segment
 * names (15 core corridors). Each polyline uses multiple vertices so paths
 * follow the street grid instead of a single straight chord.
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
 * Xinyi core road network — one entry per official demo segment name.
 *
 * Vertices are approximate centre-line paths for operational visualization.
 */
export const ROAD_DICTIONARY: Readonly<Record<string, readonly RoadCoordinate[]>> = Object.freeze({
  忠孝東路四段: Object.freeze([
    [25.041, 121.548],
    [25.0411, 121.551],
    [25.0412, 121.554],
    [25.0413, 121.557],
    [25.0414, 121.56],
    [25.0415, 121.563],
    [25.0416, 121.566],
  ] as const),
  光復南路: Object.freeze([
    [25.033, 121.5574],
    [25.035, 121.5575],
    [25.037, 121.5576],
    [25.039, 121.5577],
    [25.041, 121.5578],
    [25.043, 121.5579],
    [25.045, 121.558],
  ] as const),
  基隆路一段: Object.freeze([
    [25.0335, 121.561],
    [25.036, 121.5612],
    [25.0385, 121.5614],
    [25.041, 121.5616],
    [25.0435, 121.5618],
    [25.046, 121.562],
  ] as const),
  市民大道四段: Object.freeze([
    [25.045, 121.548],
    [25.0451, 121.551],
    [25.0452, 121.554],
    [25.0453, 121.557],
    [25.0454, 121.56],
    [25.0455, 121.563],
  ] as const),
  仁愛路四段: Object.freeze([
    [25.038, 121.548],
    [25.0381, 121.551],
    [25.0382, 121.554],
    [25.0383, 121.557],
    [25.0384, 121.56],
    [25.0385, 121.563],
  ] as const),
  敦化南路一段: Object.freeze([
    [25.033, 121.549],
    [25.0355, 121.5492],
    [25.038, 121.5494],
    [25.0405, 121.5496],
    [25.043, 121.5498],
    [25.0455, 121.55],
  ] as const),
  松高路: Object.freeze([
    [25.036, 121.558],
    [25.0361, 121.561],
    [25.0362, 121.564],
    [25.0363, 121.567],
  ] as const),
  延吉街: Object.freeze([
    [25.039, 121.555],
    [25.0405, 121.5552],
    [25.042, 121.5554],
    [25.0435, 121.5556],
  ] as const),
  基隆路地下道: Object.freeze([
    [25.041, 121.5605],
    [25.0412, 121.561],
    [25.0414, 121.5615],
    [25.0416, 121.562],
    [25.0418, 121.5625],
  ] as const),
  市府路: Object.freeze([
    [25.034, 121.564],
    [25.036, 121.5642],
    [25.038, 121.5644],
    [25.04, 121.5646],
    [25.042, 121.5648],
  ] as const),
  松壽路: Object.freeze([
    [25.034, 121.558],
    [25.0341, 121.561],
    [25.0342, 121.564],
    [25.0343, 121.567],
  ] as const),
  敦化南路二段: Object.freeze([
    [25.031, 121.549],
    [25.0325, 121.5491],
    [25.034, 121.5492],
    [25.0355, 121.5493],
  ] as const),
  信義路五段: Object.freeze([
    [25.033, 121.558],
    [25.0331, 121.561],
    [25.0332, 121.564],
    [25.0333, 121.567],
  ] as const),
  松智路: Object.freeze([
    [25.032, 121.565],
    [25.0335, 121.5652],
    [25.035, 121.5654],
    [25.0365, 121.5656],
  ] as const),
  復興南路一段: Object.freeze([
    [25.033, 121.544],
    [25.036, 121.5442],
    [25.039, 121.5444],
    [25.042, 121.5446],
    [25.045, 121.5448],
  ] as const),
});

/** All road names that have known geometry. */
export const ROAD_DICTIONARY_KEYS: readonly string[] = Object.freeze(Object.keys(ROAD_DICTIONARY));

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
