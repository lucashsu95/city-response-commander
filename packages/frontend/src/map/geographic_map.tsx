/**
 * Geographic Operations Map (React Leaflet)
 *
 * Renders a real OSM street map centred on Taipei's Xinyi/Daan district.
 * Traffic data from /demo/timeseries is displayed as a scrollable summary
 * overlay beside the map.
 *
 * NOTE: `road_network_geometry.json` contains NO geographic coordinates or
 * GeoJSON geometry.  Road polylines cannot be rendered until the backend
 * provides a geometry source.  The map displays the real OSM base layer and
 * traffic status as an overlay card.
 *
 * @module frontend/map/geographic_map
 */

import {
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import {
  MapContainer,
  TileLayer,
} from 'react-leaflet';
import {
  enrichRoadsWithTraffic,
  fetchRoadSegments,
  ROAD_COLORS,
  trafficVisualLevel,
  type EnrichedRoad,
  type RoadSegment,
} from './road_geometry_adapter.js';
import type { DemoDecisionView } from '../api/demo_api_adapter.js';
import type { DemoTimeseriesResponse } from '../api/demo_api_adapter.js';
import { formatRatioAsPercent, calculateAverageRatio } from '../utils/percentage.js';

// ─── Constants ───────────────────────────────────────────────

const TAIPEI_CENTER: [number, number] = [25.0400, 121.5570];

const OSM_TILE_URL = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

const MAX_ZOOM = 17;
const MIN_ZOOM = 13;

// ─── No-coordinates notice ──────────────────────────────────

function NoGeometryNotice(): ReactNode {
  return (
    <div className="geo-map__no-geometry" role="status">
      <span className="geo-map__no-geometry-icon">⚠</span>
      <p className="geo-map__no-geometry-text">
        後端尚未提供路段地理座標，暫以 OSM 底圖顯示。<br />
        交通狀態請見右側 summary 面板。
      </p>
    </div>
  );
}

// ─── Traffic Summary Row ─────────────────────────────────────

interface TrafficRowProps {
  readonly road: EnrichedRoad;
  readonly selected: boolean;
  readonly onClick: (id: string) => void;
}

function TrafficRow({ road, selected, onClick }: TrafficRowProps): ReactNode {
  const { segment, traffic } = road;
  const level = traffic
    ? trafficVisualLevel(traffic.laneStatus, traffic.saturationScore)
    : 'unknown';
  const color = ROAD_COLORS[level];

  const sat = traffic ? traffic.saturationScore : null;
  const satLabel = sat !== null ? `${(sat * 100).toFixed(0)}%` : '—';

  return (
    <button
      type="button"
      className={`geo-map__traffic-row${selected ? ' geo-map__traffic-row--selected' : ''}`}
      onClick={() => onClick(segment.segmentId)}
      style={{ '--row-accent': color } as React.CSSProperties}
    >
      <span
        className="geo-map__traffic-row__dot"
        style={{ background: color }}
        aria-hidden="true"
      />
      <span className="geo-map__traffic-row__name">{segment.roadName}</span>
      <span className="geo-map__traffic-row__speed">
        {traffic ? `${traffic.avgSpeed} km/h` : '—'}
      </span>
      <span className="geo-map__traffic-row__sat" style={{ color }}>
        {satLabel}
      </span>
      <span className="geo-map__traffic-row__status">
        {traffic ? traffic.laneStatus : '無資料'}
      </span>
    </button>
  );
}

// ─── Incident Route Banner ───────────────────────────────────

interface RouteBannerProps {
  readonly decision: DemoDecisionView | null;
}

function RouteBanner({ decision }: RouteBannerProps): ReactNode {
  if (!decision) return null;

  return (
    <div className="geo-map__route-banner" role="status" aria-label="疏散路線">
      <span className="geo-map__route-banner__icon">🚨</span>
      <div className="geo-map__route-banner__content">
        <strong>事故：{decision.location}</strong>
        <span>主疏散：{decision.primaryEvacuation}</span>
        {decision.secondaryEvacuation.length > 0 && (
          <span>次要：{decision.secondaryEvacuation.join('、')}</span>
        )}
        <span className="geo-map__route-banner__ete">ETE {decision.eteMinutes} 分鐘</span>
      </div>
    </div>
  );
}

// ─── Crowd Stats ─────────────────────────────────────────────

interface CrowdStatsProps {
  readonly crowd: ReadonlyArray<{
    readonly BS_ID: string;
    readonly Location_Name: string;
    readonly User_Count: number;
    readonly roaming_pct_value: number;
  }>;
}

function CrowdStatsSummary({ crowd }: CrowdStatsProps): ReactNode {
  if (crowd.length === 0) return null;

  const totalUsers = crowd.reduce((sum, c) => sum + (c.User_Count ?? 0), 0);
  const avgRoaming = calculateAverageRatio(crowd.map((c) => c.roaming_pct_value));

  return (
    <div className="geo-map__crowd-stats" role="status" aria-label="基地台統計">
      <h4 className="geo-map__crowd-stats__title">基地台</h4>
      <div className="geo-map__crowd-stats__row">
        <span>基站數</span><span>{crowd.length} 站</span>
      </div>
      <div className="geo-map__crowd-stats__row">
        <span>總用戶</span><span>{totalUsers.toLocaleString()} 人</span>
      </div>
      <div className="geo-map__crowd-stats__row">
        <span>均漫遊</span><span>{formatRatioAsPercent(avgRoaming, 1)}</span>
      </div>
    </div>
  );
}

// ─── Loading / Error overlays ────────────────────────────────

function LoadingOverlay(): ReactNode {
  return (
    <div className="geo-map__overlay geo-map__overlay--loading" role="status" aria-label="載入中">
      <div className="geo-map__spinner" />
      <span>載入交通資料…</span>
    </div>
  );
}

function ErrorOverlay({ msg }: { msg: string }): ReactNode {
  return (
    <div className="geo-map__overlay geo-map__overlay--error" role="alert">
      <span>⚠ {msg}</span>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────

export interface GeographicMapProps {
  /**
   * Full timeseries response. The parent ensures `traffic` and `crowd` fields
   * reflect the active snapshot for the current timeline index.
   */
  readonly snapshot: DemoTimeseriesResponse | null;
  readonly decision: DemoDecisionView | null;
  readonly loading: boolean;
  readonly errorMessage: string | null;
  readonly selectedSegmentId: string | null;
  readonly onSegmentClick: (id: string) => void;
}

export function GeographicMap({
  snapshot,
  decision,
  loading,
  errorMessage,
  selectedSegmentId,
  onSegmentClick,
}: GeographicMapProps): ReactNode {
  const [segments, setSegments] = useState<readonly RoadSegment[]>([]);
  const [metadataError, setMetadataError] = useState<string | null>(null);

  // Load road segment metadata once
  useEffect(() => {
    fetchRoadSegments()
      .then(setSegments)
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        setMetadataError(msg);
      });
  }, []);

  // Merge traffic data
  const enrichedRoads = useMemo<EnrichedRoad[]>(
    () => enrichRoadsWithTraffic(segments, snapshot?.traffic ?? []),
    [segments, snapshot],
  );

  // Show error overlay for metadata failure
  if (metadataError) {
    return (
      <div className="geo-map">
        <div className="geo-map__map-area geo-map__map-area--error">
          <MapContainer
            center={TAIPEI_CENTER}
            zoom={14}
            minZoom={MIN_ZOOM}
            maxZoom={MAX_ZOOM}
            className="geo-map__container"
            zoomControl={false}
            attributionControl={false}
          >
            <TileLayer url={OSM_TILE_URL} attribution={OSM_ATTRIBUTION} />
          </MapContainer>
          <ErrorOverlay msg={`路段資料載入失敗：${metadataError}`} />
        </div>
      </div>
    );
  }

  return (
    <div className="geo-map">
      <div className="geo-map__map-area">
        {/* OSM base map */}
        <MapContainer
          center={TAIPEI_CENTER}
          zoom={14}
          minZoom={MIN_ZOOM}
          maxZoom={MAX_ZOOM}
          className="geo-map__container"
          zoomControl={false}
          attributionControl={false}
        >
          <TileLayer
            url={OSM_TILE_URL}
            attribution={OSM_ATTRIBUTION}
          />
        </MapContainer>

        {/* Attribution */}
        <div className="geo-map__attribution" aria-label="地圖版權">
          <span dangerouslySetInnerHTML={{ __html: OSM_ATTRIBUTION }} />
        </div>

        {/* Legend */}
        <div className="geo-map__legend" role="group" aria-label="交通狀態圖例">
          <h4 className="geo-map__legend-title">交通視覺分級</h4>
          <ul className="geo-map__legend-list">
            <li className="geo-map__legend-item">
              <span className="geo-map__legend-dot" style={{ background: ROAD_COLORS.critical }} />
              <span>封閉/高度壅塞</span>
            </li>
            <li className="geo-map__legend-item">
              <span className="geo-map__legend-dot" style={{ background: ROAD_COLORS.warning }} />
              <span>注意/中度壅塞</span>
            </li>
            <li className="geo-map__legend-item">
              <span className="geo-map__legend-dot" style={{ background: ROAD_COLORS.normal }} />
              <span>暢通</span>
            </li>
            <li className="geo-map__legend-item">
              <span className="geo-map__legend-dot" style={{ background: ROAD_COLORS.unknown }} />
              <span>未知/無資料</span>
            </li>
          </ul>
        </div>

        {/* No-geometry notice */}
        <NoGeometryNotice />

        {/* Loading */}
        {loading && <LoadingOverlay />}

        {/* API error */}
        {errorMessage && !loading && <ErrorOverlay msg={errorMessage} />}

        {/* Incident route banner */}
        <RouteBanner decision={decision} />
      </div>

      {/* Traffic summary sidebar */}
      <aside className="geo-map__sidebar" aria-label="路段交通狀態">
        <div className="geo-map__sidebar-header">
          <h3 className="geo-map__sidebar-title">路段狀態</h3>
          <span className="geo-map__sidebar-count">{enrichedRoads.length} 路段</span>
        </div>

        <div className="geo-map__traffic-list" role="list">
          {enrichedRoads.length === 0 && !loading && (
            <p className="geo-map__traffic-empty">尚無路段資料</p>
          )}
          {enrichedRoads.map((road) => (
            <TrafficRow
              key={road.segment.segmentId}
              road={road}
              selected={selectedSegmentId === road.segment.segmentId}
              onClick={onSegmentClick}
            />
          ))}
        </div>

        <CrowdStatsSummary crowd={snapshot?.crowd ?? []} />
      </aside>
    </div>
  );
}
