/**
 * TrafficMap data adapter — converts backend / demo payloads into map rows.
 *
 * Only roads present in {@link ROAD_DICTIONARY} are emitted; unknown names are
 * skipped silently so React never crashes on unmapped geometry.
 *
 * @module frontend/map/traffic_map_adapter
 */

import { lookupRoadCoordinates, ROAD_DICTIONARY_KEYS } from '../constants/roadDictionary.js';
import type { TrafficAlertLevel, TrafficDataItem } from '../components/TrafficMap.js';
import type { DemoDecisionView } from '../api/demo_api_adapter.js';
import type { RoadReadModel, RoadSegmentView } from '../roads/road_model.js';
import { DEMO_PLAYBACK_START, parseDemoToMinutes } from '../demo/demo_timeline_range.js';

/** Pitch controls select a time anchor or decision overlay — never static rows. */
export type TrafficMapViewMode = 'baseline' | 'incident' | 'arbitration';

/** Official incident anchor from `demo-data-source/live_incidents.json` (TPE_2026_ACC_001). */
export const DEMO_INCIDENT_MAP_TIMESTAMP = '2026-05-20 22:10';

export const TRAFFIC_MAP_VIEW_LABELS: Readonly<Record<TrafficMapViewMode, string>> = Object.freeze({
  baseline: '預設狀態',
  incident: '光復南路突發事故',
  arbitration: 'AI 仲裁完成',
});

/** @deprecated use {@link TrafficMapViewMode} */
export type TrafficMapDemoPreset = TrafficMapViewMode;

/** @deprecated use {@link TRAFFIC_MAP_VIEW_LABELS} */
export const TRAFFIC_MAP_DEMO_PRESET_LABELS = TRAFFIC_MAP_VIEW_LABELS;

// ─── Level mapping (display only — backend `level` is authoritative) ──

/** Maps canonical backend A/B grading to map alert colours. */
export function mapBackendLevelToAlert(level: string | null): TrafficAlertLevel | null {
  if (level === 'A') return 'RED';
  if (level === 'B') return 'YELLOW';
  if (level === null) return null;
  return 'GREEN';
}

/**
 * Demo-only saturation fallback when the demo timeseries row has no `level`.
 * Production `/roads` paths must prefer {@link mapBackendLevelToAlert} only.
 */
export function mapDemoSaturationToAlert(saturation: number): TrafficAlertLevel {
  if (!Number.isFinite(saturation)) return 'GREEN';
  if (saturation >= 0.85) return 'RED';
  if (saturation >= 0.6) return 'YELLOW';
  return 'GREEN';
}

function resolveAlertLevel(
  level: string | null,
  saturation: number,
  allowSaturationFallback: boolean,
): TrafficAlertLevel {
  const fromLevel = mapBackendLevelToAlert(level);
  if (fromLevel !== null) return fromLevel;
  return allowSaturationFallback ? mapDemoSaturationToAlert(saturation) : 'GREEN';
}

function toMapRow(
  roadName: string,
  level: string | null,
  saturation: number,
  allowSaturationFallback: boolean,
): TrafficDataItem | null {
  const trimmed = roadName.trim();
  if (trimmed.length === 0 || lookupRoadCoordinates(trimmed) === null) {
    return null;
  }

  return {
    road_name: trimmed,
    alert_level: resolveAlertLevel(level, saturation, allowSaturationFallback),
    saturation: Number.isFinite(saturation) ? saturation : 0,
  };
}

// ─── Production GET /roads ───────────────────────────────────

export function adaptRoadReadModelToTrafficData(
  model: RoadReadModel | null | undefined,
): readonly TrafficDataItem[] {
  if (model === null || model === undefined) return [];
  if (model.dataStatus === 'insufficient_data') return [];

  const rows: TrafficDataItem[] = [];
  for (const segment of model.segments) {
    const row = adaptRoadSegmentToTrafficData(segment, false);
    if (row !== null) rows.push(row);
  }
  return rows;
}

export function adaptRoadSegmentToTrafficData(
  segment: RoadSegmentView,
  allowSaturationFallback = false,
): TrafficDataItem | null {
  return toMapRow(
    segment.roadName,
    segment.level,
    segment.saturationScore,
    allowSaturationFallback,
  );
}

// ─── Demo GET /demo/timeseries ───────────────────────────────

export interface DemoTrafficRow {
  readonly timestamp_raw?: string;
  readonly Segment_ID?: string;
  readonly Road_Name: string;
  readonly Saturation_Score?: number;
  readonly Lane_Status?: string;
  readonly level?: string | null;
}

export interface DemoTrafficSnapshotSlice {
  readonly traffic: readonly DemoTrafficRow[];
}

export function flattenSnapshotTraffic(
  snapshots: readonly DemoTrafficSnapshotSlice[],
): readonly DemoTrafficRow[] {
  const rows: DemoTrafficRow[] = [];
  for (const snapshot of snapshots) {
    rows.push(...snapshot.traffic);
  }
  return rows;
}

/**
 * Converts demo timeseries traffic rows into map-ready data.
 * When `anchorTimestamp` is set, keeps the latest row per road at or before that time.
 */
export function adaptDemoTrafficToTrafficData(
  traffic: readonly DemoTrafficRow[],
  anchorTimestamp: string | null = null,
): readonly TrafficDataItem[] {
  if (!Array.isArray(traffic) || traffic.length === 0) {
    return [];
  }

  const anchorMinutes =
    anchorTimestamp !== null && anchorTimestamp.trim().length > 0
      ? parseDemoToMinutes(anchorTimestamp)
      : null;

  const latestByRoad = new Map<string, { row: DemoTrafficRow; minutes: number }>();

  for (const row of traffic) {
    const name = row.Road_Name?.trim() ?? '';
    if (name.length === 0) continue;

    const rawTs = row.timestamp_raw ?? '';
    const rowMinutes = parseDemoToMinutes(rawTs);
    if (rowMinutes === null) continue;
    if (anchorMinutes !== null && rowMinutes > anchorMinutes) continue;

    const existing = latestByRoad.get(name);
    if (existing === undefined || rowMinutes > existing.minutes) {
      latestByRoad.set(name, { row, minutes: rowMinutes });
    }
  }

  const rows: TrafficDataItem[] = [];
  for (const { row } of latestByRoad.values()) {
    const level = typeof row.level === 'string' || row.level === null ? row.level : null;
    const saturation =
      typeof row.Saturation_Score === 'number' && Number.isFinite(row.Saturation_Score)
        ? row.Saturation_Score
        : 0;

    const mapped = toMapRow(row.Road_Name, level, saturation, true);
    if (mapped !== null) rows.push(mapped);
  }

  return rows;
}

function buildSegmentRoadMap(traffic: readonly DemoTrafficRow[]): ReadonlyMap<string, string> {
  const map = new Map<string, string>();
  for (const row of traffic) {
    const segmentId = row.Segment_ID?.trim();
    const roadName = row.Road_Name?.trim();
    if (
      segmentId !== undefined &&
      segmentId.length > 0 &&
      roadName !== undefined &&
      roadName.length > 0
    ) {
      map.set(segmentId, roadName);
    }
  }
  return map;
}

/** Applies decision-engine route exclusions and evacuation highlights on top of live traffic rows. */
export function applyDecisionArbitrationOverlay(
  rows: readonly TrafficDataItem[],
  traffic: readonly DemoTrafficRow[],
  decision: DemoDecisionView,
): readonly TrafficDataItem[] {
  const segmentRoads = buildSegmentRoadMap(traffic);
  const excludedRoads = new Set<string>();
  for (const excluded of decision.excludedRoutes) {
    const roadName = segmentRoads.get(excluded.segment_id);
    if (roadName !== undefined) excludedRoads.add(roadName);
  }

  const primaryRoute = decision.primaryEvacuation.trim();
  const secondaryRoutes = new Set(decision.secondaryEvacuation.map((name) => name.trim()));

  return rows.map((row) => {
    if (excludedRoads.has(row.road_name)) {
      return {
        ...row,
        alert_level: 'RED' as const,
        saturation: Math.max(row.saturation, 0.9),
      };
    }
    if (row.road_name === primaryRoute || secondaryRoutes.has(row.road_name)) {
      return {
        ...row,
        alert_level: 'GREEN' as const,
      };
    }
    return row;
  });
}

/** Ensures every dictionary road appears once (fills gaps as GREEN). */
export function withDictionaryFallback(
  rows: readonly TrafficDataItem[],
): readonly TrafficDataItem[] {
  const byName = new Map(rows.map((row) => [row.road_name, row]));
  const merged: TrafficDataItem[] = [];

  for (const roadName of ROAD_DICTIONARY_KEYS) {
    merged.push(
      byName.get(roadName) ?? {
        road_name: roadName,
        alert_level: 'GREEN',
        saturation: 0.2,
      },
    );
  }

  return merged;
}

export function resolveTrafficForViewMode(params: {
  readonly mode: TrafficMapViewMode | null;
  readonly snapshots: readonly DemoTrafficSnapshotSlice[];
  readonly currentTimestamp: string | null;
  readonly decision: DemoDecisionView | null;
  readonly roadReadModel: RoadReadModel | null | undefined;
}): readonly TrafficDataItem[] {
  const fromRoads = adaptRoadReadModelToTrafficData(params.roadReadModel);
  if (fromRoads.length > 0) {
    return withDictionaryFallback(fromRoads);
  }

  const allTraffic = flattenSnapshotTraffic(params.snapshots);
  if (allTraffic.length === 0) {
    return withDictionaryFallback([]);
  }

  let anchorTimestamp = params.currentTimestamp;
  if (params.mode === 'baseline') {
    anchorTimestamp = DEMO_PLAYBACK_START;
  } else if (params.mode === 'incident' || params.mode === 'arbitration') {
    anchorTimestamp = DEMO_INCIDENT_MAP_TIMESTAMP;
  }

  let rows = adaptDemoTrafficToTrafficData(allTraffic, anchorTimestamp);
  rows = withDictionaryFallback(rows);

  if (params.mode === 'arbitration' && params.decision !== null) {
    rows = applyDecisionArbitrationOverlay(rows, allTraffic, params.decision);
  }

  return rows;
}
