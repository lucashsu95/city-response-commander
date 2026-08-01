/**
 * Operations Map — Schematic Layout Model (Dashboard Operations Map)
 *
 * Builds the presentation model for the SVG operations map from the existing
 * TASK-125 (`roads/road_model.ts`) and TASK-126 (`crowd/crowd_model.ts`) read
 * models. This module issues no request, owns no transport, and computes no
 * SOP/threshold truth — it only re-presents backend-decided values.
 *
 * ## Geographic vs. schematic mode
 *
 * Neither `GetRoadsResponse` (`shared-schemas/api-contracts.ts`) nor
 * `RoadSegment` (`shared-schemas/raw-data.ts`) nor `GetCrowdResponse` carries
 * any coordinate or geometry field (`RoadSegment` has `intersections`,
 * `capacity_vph`, `flow_direction`, `alternatives`, `nearby_stations` — no
 * lat/lng, no GeoJSON). This was confirmed by reading every field in those
 * files before writing this module. There is therefore no official geographic
 * layout to place entities on, and none is fabricated here: every entity's
 * `column`/`row` is a deterministic *index-based* schematic grid position
 * (a rendering choice, not a geographic claim), and the map is always rendered
 * in schematic mode with the mandated on-screen disclosure text.
 *
 * ## What this module never does
 *
 * - it never classifies a road level, an SOP flag, or a staleness verdict:
 *   `level`, `flags`, `stale`, `dataStatus` are read verbatim from the backend
 *   models this module is handed
 * - it never invents an entity, a station, a coordinate, or a timestamp: the
 *   entity list is exactly the backend-supplied `segments`/`stations` array,
 *   in backend order
 * - the red/yellow/neutral mapping below is a pure vocabulary lookup over the
 *   backend's own `'A'`/`'B'`/other value — the same three-way mapping
 *   `roads/road_panel.tsx` and `alerts/anomaly_model.ts` already use
 *   independently; it is not a threshold comparison
 *
 * @module frontend/map/map_model
 */

import type { RoadReadModel, RoadSegmentView } from '../roads/road_model.js';
import type { CrowdStationRow } from '../crowd/crowd_model.js';

// ─── Visual Vocabulary (pure lookups, no thresholds) ─────────

/** Rendering token for a backend-supplied road `level`. Never a computation. */
export type RoadVisualLevel = 'red' | 'yellow' | 'neutral';

/**
 * Maps a backend `level` value to a rendering token.
 *
 * Mirrors `roads/road_panel.tsx`'s `levelToken` and
 * `alerts/anomaly_model.ts`'s `classifyRoadLevel`: `'A'` → red, `'B'` →
 * yellow, everything else (`null`, `'NONE'`, or any unrecognized value) →
 * neutral. This is a vocabulary lookup over a value the backend already
 * decided, never a `saturation_score` comparison.
 */
export function classifyRoadVisualLevel(level: string | null): RoadVisualLevel {
  if (level === 'A') return 'red';
  if (level === 'B') return 'yellow';
  return 'neutral';
}

/**
 * Whether a crowd station has at least one backend-supplied SOP flag.
 *
 * Pure array-length check on the backend's own `flags` array — never a
 * `User_Count`/`Growth_Rate`/roaming-percent comparison.
 */
export function hasActiveCrowdFlags(flags: readonly string[]): boolean {
  return flags.length > 0;
}

// ─── Deterministic Schematic Layout ───────────────────────────

/** One schematic grid cell. Index-based only — never a coordinate. */
export interface SchematicPosition {
  readonly column: number;
  readonly row: number;
}

/**
 * Deterministic index → grid-cell mapping.
 *
 * Pure function of `index` and `columns`: the same backend order always
 * produces the same layout, and no randomness, hashing, or fabricated
 * coordinate is involved.
 */
export function schematicPositionOf(index: number, columns: number): SchematicPosition {
  const safeColumns = columns > 0 ? columns : 1;
  return {
    column: index % safeColumns,
    row: Math.floor(index / safeColumns),
  };
}

// ─── Road Map Entries ──────────────────────────────────────────

export interface RoadMapEntry {
  readonly kind: 'road';
  readonly segmentId: string;
  readonly roadName: string;
  /** Backend `level` verbatim. */
  readonly level: string | null;
  readonly visualLevel: RoadVisualLevel;
  readonly laneStatus: string;
  /** Backend per-segment `data_status`, verbatim. `null` when not supplied. */
  readonly dataStatus: string | null;
  readonly observationTimestamp: string | null;
  readonly stalenessMinutes: number | null;
  readonly position: SchematicPosition;
}

const DEFAULT_ROAD_COLUMNS = 6;

/**
 * Builds one map entry per backend-supplied segment, in backend order.
 *
 * Never reorders, filters, pads, or fabricates a segment; a caller with an
 * empty `segments` array gets an empty result, not a placeholder entity.
 */
export function buildRoadMapEntries(
  segments: readonly RoadSegmentView[],
  columns: number = DEFAULT_ROAD_COLUMNS,
): readonly RoadMapEntry[] {
  return segments.map((segment, index) => ({
    kind: 'road',
    segmentId: segment.segmentId,
    roadName: segment.roadName,
    level: segment.level,
    visualLevel: classifyRoadVisualLevel(segment.level),
    laneStatus: segment.laneStatus,
    dataStatus: segment.dataStatus,
    observationTimestamp: segment.observationTimestamp,
    stalenessMinutes: segment.stalenessMinutes,
    position: schematicPositionOf(index, columns),
  }));
}

// ─── Crowd Map Entries ─────────────────────────────────────────

export interface CrowdMapEntry {
  readonly kind: 'crowd_station';
  readonly bsId: string;
  readonly locationName: string | null;
  /** Backend `flags` verbatim, opaque codes. */
  readonly flags: readonly string[];
  readonly hasActiveFlags: boolean;
  /** Backend staleness verdict, verbatim. `null` = backend did not say. */
  readonly stale: boolean | null;
  readonly dataStatus: 'ready' | 'insufficient_data' | null;
  readonly observationTimestamp: string | null;
  readonly stalenessMinutes: number | null;
  readonly position: SchematicPosition;
}

const DEFAULT_CROWD_COLUMNS = 6;

/**
 * Builds one map entry per backend-supplied station, in backend order.
 *
 * Same fabrication guarantees as {@link buildRoadMapEntries}: the entity list
 * is exactly `stations`, and every rendered field is read verbatim.
 */
export function buildCrowdMapEntries(
  stations: readonly CrowdStationRow[],
  columns: number = DEFAULT_CROWD_COLUMNS,
): readonly CrowdMapEntry[] {
  return stations.map((station, index) => ({
    kind: 'crowd_station',
    bsId: station.bsId,
    locationName: station.locationName,
    flags: station.flags,
    hasActiveFlags: hasActiveCrowdFlags(station.flags),
    stale: station.stale,
    dataStatus: station.dataStatus,
    observationTimestamp: station.observationTimestamp,
    stalenessMinutes: station.stalenessMinutes,
    position: schematicPositionOf(index, columns),
  }));
}

// ─── Combined Model ────────────────────────────────────────────

export type MapEntity = RoadMapEntry | CrowdMapEntry;

/** Stable cross-kind identity for selection/keyboard lookups. */
export function mapEntityKey(entity: MapEntity): string {
  return entity.kind === 'road' ? `road:${entity.segmentId}` : `crowd_station:${entity.bsId}`;
}

export interface OperationsMapModel {
  /** Always `true`: no coordinate/geometry contract exists (see module doc). */
  readonly schematic: true;
  readonly roads: readonly RoadMapEntry[];
  readonly crowdStations: readonly CrowdMapEntry[];
}

/**
 * Builds the combined operations-map model from the two existing read
 * models. `null` inputs (controller not yet loaded) produce empty entity
 * lists — never a placeholder entity standing in for missing data.
 */
export function buildOperationsMapModel(
  roadsModel: RoadReadModel | null,
  crowdStations: readonly CrowdStationRow[],
): OperationsMapModel {
  return {
    schematic: true,
    roads: buildRoadMapEntries(roadsModel?.segments ?? []),
    crowdStations: buildCrowdMapEntries(crowdStations),
  };
}

// ─── Section Status (loading / empty / error / insufficient) ──

/** One domain section's presentation status, independent of the other. */
export type MapSectionStatus = 'loading' | 'ready' | 'empty' | 'insufficient' | 'error';

/**
 * Normalizes the TASK-125 road controller state name into the map's section
 * vocabulary. Pure rename — `'idle'` and `'loading'` both present as
 * `'loading'` since the map has nothing to show either way; every other name
 * is passed through as-is (the road controller's own state machine already
 * distinguishes `ready`/`empty`/`insufficient`/`error`).
 */
export function roadsSectionStatus(
  state: 'idle' | 'loading' | 'ready' | 'empty' | 'insufficient' | 'error' | 'disposed',
): MapSectionStatus {
  if (state === 'idle' || state === 'loading' || state === 'disposed') return 'loading';
  return state;
}

/**
 * Normalizes the TASK-126 crowd controller state name into the map's section
 * vocabulary. Same rule as {@link roadsSectionStatus}; `'insufficient_data'`
 * maps to the shared `'insufficient'` label used by both sections.
 */
export function crowdSectionStatus(
  state: 'idle' | 'loading' | 'ready' | 'empty' | 'insufficient_data' | 'error',
): MapSectionStatus {
  if (state === 'idle' || state === 'loading') return 'loading';
  if (state === 'insufficient_data') return 'insufficient';
  return state;
}
