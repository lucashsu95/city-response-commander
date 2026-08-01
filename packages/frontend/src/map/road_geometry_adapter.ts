/**
 * Road Geometry Adapter
 *
 * Fetches road segment metadata from the static
 * `/data/road_network_geometry.json` asset (synced from `demo-data-source/`).
 *
 * IMPORTANT: `road_network_geometry.json` contains NO coordinates, geometry,
 * or GeoJSON.  The backend has not yet provided geographic line data for
 * any segment.  This adapter therefore only fetches and normalises the
 * metadata array — no polyline rendering is possible without a real geometry
 * source.
 *
 * The map UI shows the OSM base map and a traffic summary overlay.
 * Once the backend provides segment GeoJSON coordinates, enrich this adapter
 * and the map will automatically render them.
 *
 * @module frontend/map/road_geometry_adapter
 */

import type { DemoTimeseriesResponse } from '../api/demo_api_adapter.js';

// ─── Raw source shape ────────────────────────────────────────

interface RawRoadSegment {
  readonly segment_id: string;
  readonly name: string;
  readonly flow_direction: string;
  readonly intersections: readonly string[];
  readonly capacity_vph: number;
  readonly alternatives: readonly string[];
  readonly nearby_stations: readonly string[];
}

// ─── Output shape (metadata only — no geometry) ────────────

export interface RoadSegment {
  readonly segmentId: string;
  readonly roadName: string;
  readonly flowDirection: string;
  readonly capacityVph: number;
  readonly intersections: readonly string[];
  readonly nearbyStations: readonly string[];
}

export interface EnrichedRoad {
  readonly segment: RoadSegment;
  /** Joined from /demo/timeseries traffic row, if matched by Segment_ID */
  readonly traffic: {
    readonly segmentId: string;
    readonly roadName: string;
    readonly avgSpeed: number;
    readonly vehicleCount: number;
    readonly saturationScore: number;
    readonly laneStatus: string;
    readonly timestampRaw: string;
  } | null;
}

// ─── Fetch metadata (no coordinates available) ────────────────

/** Cached metadata so we only fetch once. */
let segmentCache: readonly RoadSegment[] | null = null;

export async function fetchRoadSegments(): Promise<readonly RoadSegment[]> {
  if (segmentCache !== null) return segmentCache;

  try {
    const res = await fetch(`${import.meta.env.BASE_URL}data/road_network_geometry.json`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const raw = (await res.json()) as RawRoadSegment[];

    const segments: RoadSegment[] = raw.map((s) => ({
      segmentId: s.segment_id,
      roadName: s.name,
      flowDirection: s.flow_direction,
      capacityVph: s.capacity_vph,
      intersections: [...s.intersections],
      nearbyStations: [...s.nearby_stations],
    }));

    segmentCache = segments;
    return segments;
  } catch (err) {
    console.error('[road_geometry_adapter] Failed to load road metadata:', err);
    return [];
  }
}

// ─── Merge with traffic data ─────────────────────────────────

export function enrichRoadsWithTraffic(
  segments: readonly RoadSegment[],
  traffic: ReadonlyArray<{
    readonly Segment_ID: string;
    readonly Road_Name: string;
    readonly Avg_Speed: number;
    readonly Vehicle_Count: number;
    readonly Saturation_Score: number;
    readonly Lane_Status: string;
    readonly timestamp_raw: string;
  }>,
): EnrichedRoad[] {
  const trafficMap = new Map(
    traffic.map((t) => [
      t.Segment_ID,
      {
        segmentId: t.Segment_ID,
        roadName: t.Road_Name,
        avgSpeed: t.Avg_Speed,
        vehicleCount: t.Vehicle_Count,
        saturationScore: t.Saturation_Score,
        laneStatus: t.Lane_Status,
        timestampRaw: t.timestamp_raw,
      },
    ]),
  );

  return segments.map((seg) => ({
    segment: seg,
    traffic: trafficMap.get(seg.segmentId) ?? null,
  }));
}

// ─── Colour helpers ──────────────────────────────────────────

export type TrafficVisualLevel = 'critical' | 'warning' | 'normal' | 'unknown';

export function trafficVisualLevel(
  laneStatus: string | null,
  saturationScore: number,
): TrafficVisualLevel {
  if (laneStatus !== null) {
    const s = laneStatus.toLowerCase();
    if (s.includes('closed') || s.includes('blocked') || s.includes('critical')) return 'critical';
    if (s.includes('warning') || s.includes('congested') || s.includes('caution')) return 'warning';
    if (s.includes('normal') || s.includes('clear') || s.includes('暢通')) return 'normal';
  }
  if (saturationScore >= 0.85) return 'critical';
  if (saturationScore >= 0.70) return 'warning';
  return 'normal';
}

export const ROAD_COLORS: Record<TrafficVisualLevel, string> = {
  critical: '#ef4444',
  warning:  '#eab308',
  normal:   '#22c55e',
  unknown:  '#64748b',
};
