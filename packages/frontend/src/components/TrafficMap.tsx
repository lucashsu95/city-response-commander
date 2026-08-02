/**
 * Traffic Operations Map — road-name CSV ➔ Leaflet polyline highlight.
 *
 * Maps alert levels onto pre-defined Xinyi road geometries via
 * {@link lookupRoadCoordinates}. RED segments receive a neon glow layer +
 * CSS pulse animation.
 *
 * @module frontend/components/TrafficMap
 */

import { useEffect, useMemo, type ReactNode } from 'react';
import { MapContainer, Polyline, Popup, TileLayer, useMap } from 'react-leaflet';
import type { LatLngExpression } from 'leaflet';
import { lookupRoadCoordinates } from '../constants/roadDictionary.js';
import '../styles/mapAnimation.css';

// ─── Types ───────────────────────────────────────────────────

export type TrafficAlertLevel = 'RED' | 'YELLOW' | 'GREEN';

export interface TrafficDataItem {
  readonly road_name: string;
  readonly alert_level: TrafficAlertLevel;
  readonly saturation: number;
}

export interface TrafficMapProps {
  readonly trafficData: readonly TrafficDataItem[];
  readonly className?: string;
}

interface ResolvedRoadSegment {
  readonly key: string;
  readonly roadName: string;
  readonly alertLevel: TrafficAlertLevel;
  readonly saturation: number;
  /**
   * Leaflet's `Polyline` prop types (`LatLngExpression[]`) are mutable, so
   * the frozen `readonly [lat, lng]` tuples from `roadDictionary.ts` are
   * copied into fresh mutable tuples here rather than passed through.
   */
  readonly coordinates: LatLngExpression[];
}

// ─── Constants ───────────────────────────────────────────────

const MAP_CENTER: LatLngExpression = [25.038, 121.557];
const MAP_ZOOM = 15;

const CARTO_DARK_TILE_URL =
  'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png';
const CARTO_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

const ALERT_COLORS: Readonly<Record<TrafficAlertLevel, string>> = Object.freeze({
  RED: '#FF3B30',
  YELLOW: '#FFCC00',
  GREEN: '#34C759',
});

const ALERT_LABELS: Readonly<Record<TrafficAlertLevel, string>> = Object.freeze({
  RED: '紅色警戒',
  YELLOW: '黃色注意',
  GREEN: '綠色暢通',
});

const GLOW_PATH_OPTIONS = Object.freeze({
  color: '#FF3B30',
  weight: 14,
  opacity: 0.35,
  lineCap: 'round' as const,
  lineJoin: 'round' as const,
  className: 'pulsing-red-road',
});

// ─── Helpers ─────────────────────────────────────────────────

function formatSaturationPercent(saturation: number): string {
  if (!Number.isFinite(saturation)) return '—';
  const pct = saturation <= 1 ? saturation * 100 : saturation;
  return `${pct.toFixed(1)}%`;
}

function resolveSegments(trafficData: readonly TrafficDataItem[]): readonly ResolvedRoadSegment[] {
  const resolved: ResolvedRoadSegment[] = [];

  for (const [index, row] of trafficData.entries()) {
    const roadName = row.road_name?.trim() ?? '';
    if (roadName.length === 0) continue;

    const coordinates = lookupRoadCoordinates(roadName);
    if (coordinates === null) continue;

    resolved.push({
      key: `${roadName}-${index}`,
      roadName,
      alertLevel: row.alert_level,
      saturation: row.saturation,
      coordinates: coordinates.map(([lat, lng]): LatLngExpression => [lat, lng]),
    });
  }

  return resolved;
}

function corePathOptions(alertLevel: TrafficAlertLevel) {
  return {
    color: ALERT_COLORS[alertLevel],
    weight: 5,
    opacity: 1,
    lineCap: 'round' as const,
    lineJoin: 'round' as const,
  };
}

// ─── Sub-components ──────────────────────────────────────────

interface RoadPopupContentProps {
  readonly roadName: string;
  readonly alertLevel: TrafficAlertLevel;
  readonly saturation: number;
}

function RoadPopupContent({
  roadName,
  alertLevel,
  saturation,
}: RoadPopupContentProps): ReactNode {
  return (
    <div className="traffic-map__popup">
      <strong>{roadName}</strong>
      <div>警戒層級：{ALERT_LABELS[alertLevel]}</div>
      <div>飽和度：{formatSaturationPercent(saturation)}</div>
    </div>
  );
}

/** Keeps Leaflet layout correct when the command-center panel resizes. */
function MapResizeHandler(): null {
  const map = useMap();

  useEffect(() => {
    const container = map.getContainer();

    const invalidate = (): void => {
      map.invalidateSize({ animate: false });
    };

    invalidate();

    const observer =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => {
            invalidate();
          })
        : null;

    observer?.observe(container);
    window.addEventListener('resize', invalidate);

    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', invalidate);
    };
  }, [map]);

  return null;
}

// ─── Main Component ──────────────────────────────────────────

export function TrafficMap({ trafficData, className }: TrafficMapProps): ReactNode {
  const segments = useMemo(() => resolveSegments(trafficData), [trafficData]);
  const rootClassName = className ? `traffic-map ${className}` : 'traffic-map';

  return (
    <div className={rootClassName} data-testid="traffic-map">
      <MapContainer
        center={MAP_CENTER}
        zoom={MAP_ZOOM}
        className="traffic-map__container"
        scrollWheelZoom
      >
        <TileLayer url={CARTO_DARK_TILE_URL} attribution={CARTO_ATTRIBUTION} />
        <MapResizeHandler />

        {segments.map((segment) => (
          <RoadSegmentLayers key={segment.key} segment={segment} />
        ))}
      </MapContainer>
    </div>
  );
}

interface RoadSegmentLayersProps {
  readonly segment: ResolvedRoadSegment;
}

function RoadSegmentLayers({ segment }: RoadSegmentLayersProps): ReactNode {
  const popup = (
    <Popup>
      <RoadPopupContent
        roadName={segment.roadName}
        alertLevel={segment.alertLevel}
        saturation={segment.saturation}
      />
    </Popup>
  );

  if (segment.alertLevel === 'RED') {
    return (
      <>
        <Polyline positions={segment.coordinates} pathOptions={GLOW_PATH_OPTIONS} />
        <Polyline positions={segment.coordinates} pathOptions={corePathOptions('RED')}>
          {popup}
        </Polyline>
      </>
    );
  }

  return (
    <Polyline
      positions={segment.coordinates}
      pathOptions={corePathOptions(segment.alertLevel)}
    >
      {popup}
    </Polyline>
  );
}

export default TrafficMap;
