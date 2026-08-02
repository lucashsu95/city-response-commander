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
import type { RoadReadModel, RoadSegmentView } from '../roads/road_model.js';

// ─── Demo presets (Pitch / manual override) ──────────────────

export type TrafficMapDemoPreset = 'baseline' | 'incident' | 'arbitration';

export const TRAFFIC_MAP_DEMO_PRESETS: Readonly<
  Record<TrafficMapDemoPreset, readonly TrafficDataItem[]>
> = Object.freeze({
  // Explicit type argument on each `Object.freeze` call so `alert_level`'s
  // string literals ('RED'/'YELLOW'/'GREEN') are checked directly against
  // `TrafficAlertLevel` instead of widening to `string` — generic inference
  // for a function-call argument does not inherit the outer `Record<...>`
  // contextual type the way a plain object-literal property does.
  baseline: Object.freeze<TrafficDataItem[]>([
    { road_name: '光復南路', alert_level: 'GREEN', saturation: 0.35 },
    { road_name: '市民大道四段', alert_level: 'YELLOW', saturation: 0.55 },
    { road_name: '仁愛路四段', alert_level: 'GREEN', saturation: 0.3 },
    { road_name: '逸仙路', alert_level: 'GREEN', saturation: 0.25 },
  ]),
  incident: Object.freeze<TrafficDataItem[]>([
    { road_name: '光復南路', alert_level: 'RED', saturation: 0.97 },
    { road_name: '市民大道四段', alert_level: 'YELLOW', saturation: 0.72 },
    { road_name: '仁愛路四段', alert_level: 'GREEN', saturation: 0.35 },
  ]),
  arbitration: Object.freeze<TrafficDataItem[]>([
    { road_name: '光復南路', alert_level: 'RED', saturation: 0.97 },
    { road_name: '市民大道四段', alert_level: 'YELLOW', saturation: 0.72 },
    { road_name: '仁愛路四段', alert_level: 'GREEN', saturation: 0.25 },
  ]),
});

export const TRAFFIC_MAP_DEMO_PRESET_LABELS: Readonly<Record<TrafficMapDemoPreset, string>> =
  Object.freeze({
    baseline: '預設狀態',
    incident: '光復南路突發事故',
    arbitration: 'AI 仲裁完成',
  });

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
  readonly Road_Name: string;
  readonly Saturation_Score?: number;
  readonly Lane_Status?: string;
  readonly level?: string | null;
}

/**
 * Converts demo timeseries traffic rows into map-ready data.
 * Filters to {@link currentTimestamp} when provided; otherwise keeps the
 * latest row per mapped road name.
 */
export function adaptDemoTrafficToTrafficData(
  traffic: readonly DemoTrafficRow[],
  currentTimestamp: string | null = null,
): readonly TrafficDataItem[] {
  if (!Array.isArray(traffic) || traffic.length === 0) {
    return [];
  }

  const scoped =
    currentTimestamp !== null && currentTimestamp.trim().length > 0
      ? traffic.filter((row) => row.timestamp_raw === currentTimestamp)
      : traffic;

  const source = scoped.length > 0 ? scoped : traffic;
  const latestByRoad = new Map<string, DemoTrafficRow>();

  for (const row of source) {
    const name = row.Road_Name?.trim() ?? '';
    if (name.length === 0) continue;
    latestByRoad.set(name, row);
  }

  const rows: TrafficDataItem[] = [];
  for (const row of latestByRoad.values()) {
    const level =
      typeof row.level === 'string' || row.level === null ? row.level : null;
    const saturation =
      typeof row.Saturation_Score === 'number' && Number.isFinite(row.Saturation_Score)
        ? row.Saturation_Score
        : 0;

    const mapped = toMapRow(row.Road_Name, level, saturation, true);
    if (mapped !== null) rows.push(mapped);
  }

  return rows;
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
