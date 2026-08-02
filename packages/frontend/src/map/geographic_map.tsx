/**
 * Geographic Operations Map — TrafficMap wiring + demo pitch controls.
 *
 * Track A: live data from `/demo/timeseries` or production `GET /roads`.
 * Track B: manual demo preset buttons for pitch scenarios.
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
import { TrafficMap, type TrafficDataItem } from '../components/TrafficMap.js';
import '../styles/mapAnimation.css';
import type { DemoDecisionView, DemoTimeseriesResponse } from '../api/demo_api_adapter.js';
import type { RoadReadModel } from '../roads/road_model.js';
import {
  adaptDemoTrafficToTrafficData,
  adaptRoadReadModelToTrafficData,
  TRAFFIC_MAP_DEMO_PRESET_LABELS,
  TRAFFIC_MAP_DEMO_PRESETS,
  withDictionaryFallback,
  type TrafficMapDemoPreset,
} from './traffic_map_adapter.js';
import {
  enrichRoadsWithTraffic,
  fetchRoadSegments,
  ROAD_COLORS,
  trafficVisualLevel,
  type EnrichedRoad,
  type RoadSegment,
} from './road_geometry_adapter.js';

// ─── Props ───────────────────────────────────────────────────

export interface GeographicMapProps {
  readonly snapshot: DemoTimeseriesResponse | null;
  readonly decision: DemoDecisionView | null;
  readonly loading: boolean;
  readonly errorMessage: string | null;
  readonly selectedSegmentId: string | null;
  readonly onSegmentClick: (id: string) => void;
  /** Replay position — filters demo traffic rows by `timestamp_raw`. */
  readonly currentTimestamp?: string | null;
  /** Production Track A: decoded `GET /roads` read model. */
  readonly roadReadModel?: RoadReadModel | null;
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
      <span className="geo-map__route-banner__icon" aria-hidden="true">
        🚨
      </span>
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

// ─── Demo Preset Controls ─────────────────────────────────────

interface DemoTriggerBarProps {
  readonly activePreset: TrafficMapDemoPreset | null;
  readonly onSelectPreset: (preset: TrafficMapDemoPreset | null) => void;
}

function DemoTriggerBar({ activePreset, onSelectPreset }: DemoTriggerBarProps): ReactNode {
  const presets = Object.keys(TRAFFIC_MAP_DEMO_PRESETS) as TrafficMapDemoPreset[];

  return (
    <div className="geo-map__demo-triggers" role="toolbar" aria-label="地圖情境快捷">
      <button
        type="button"
        className={`geo-map__demo-trigger${activePreset === null ? ' geo-map__demo-trigger--active' : ''}`}
        onClick={() => onSelectPreset(null)}
      >
        即時資料
      </button>
      {presets.map((preset) => (
        <button
          key={preset}
          type="button"
          className={`geo-map__demo-trigger${activePreset === preset ? ' geo-map__demo-trigger--active' : ''}`}
          onClick={() => onSelectPreset(preset)}
        >
          {TRAFFIC_MAP_DEMO_PRESET_LABELS[preset]}
        </button>
      ))}
    </div>
  );
}

// ─── Overlays ────────────────────────────────────────────────

function LoadingOverlay(): ReactNode {
  return (
    <div className="geo-map__overlay geo-map__overlay--loading" role="status" aria-label="載入中">
      <div className="geo-map__spinner" />
      <span>載入交通資料…</span>
    </div>
  );
}

function ErrorOverlay({ msg }: { readonly msg: string }): ReactNode {
  return (
    <div className="geo-map__overlay geo-map__overlay--error" role="alert">
      <span>⚠ {msg}</span>
    </div>
  );
}

// ─── Main Component ──────────────────────────────────────────

export function GeographicMap({
  snapshot,
  decision,
  loading,
  errorMessage,
  selectedSegmentId,
  onSegmentClick,
  currentTimestamp = null,
  roadReadModel = null,
}: GeographicMapProps): ReactNode {
  const [segments, setSegments] = useState<readonly RoadSegment[]>([]);
  const [metadataError, setMetadataError] = useState<string | null>(null);
  const [demoPreset, setDemoPreset] = useState<TrafficMapDemoPreset | null>(null);

  useEffect(() => {
    fetchRoadSegments()
      .then(setSegments)
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        setMetadataError(msg);
      });
  }, []);

  useEffect(() => {
    if (decision !== null) {
      setDemoPreset('incident');
    }
  }, [decision?.decisionId]);

  const enrichedRoads = useMemo<EnrichedRoad[]>(
    () => enrichRoadsWithTraffic(segments, snapshot?.traffic ?? []),
    [segments, snapshot],
  );

  const liveTrafficData = useMemo<readonly TrafficDataItem[]>(() => {
    const fromRoads = adaptRoadReadModelToTrafficData(roadReadModel);
    if (fromRoads.length > 0) {
      return withDictionaryFallback(fromRoads);
    }

    const fromDemo = adaptDemoTrafficToTrafficData(snapshot?.traffic ?? [], currentTimestamp);
    return withDictionaryFallback(fromDemo);
  }, [roadReadModel, snapshot?.traffic, currentTimestamp]);

  const trafficData = useMemo<readonly TrafficDataItem[]>(() => {
    if (demoPreset !== null) {
      return TRAFFIC_MAP_DEMO_PRESETS[demoPreset];
    }
    if (liveTrafficData.length > 0) {
      return liveTrafficData;
    }
    return TRAFFIC_MAP_DEMO_PRESETS.baseline;
  }, [demoPreset, liveTrafficData]);

  const handleSelectPreset = useCallback((preset: TrafficMapDemoPreset | null) => {
    setDemoPreset(preset);
  }, []);

  if (metadataError) {
    return (
      <div className="geo-map">
        <div className="geo-map__map-area geo-map__map-area--error">
          <div className="geo-map__traffic-stage geo-map__traffic-stage--glass">
            <TrafficMap trafficData={TRAFFIC_MAP_DEMO_PRESETS.baseline} />
          </div>
          <ErrorOverlay msg={`路段資料載入失敗：${metadataError}`} />
        </div>
      </div>
    );
  }

  return (
    <div className="geo-map">
      <div className="geo-map__map-area">
        <div className="geo-map__traffic-stage geo-map__traffic-stage--glass">
          <TrafficMap trafficData={trafficData} />
        </div>

        <DemoTriggerBar activePreset={demoPreset} onSelectPreset={handleSelectPreset} />

        <div className="geo-map__legend" role="group" aria-label="交通狀態圖例">
          <h4 className="geo-map__legend-title">地圖警戒</h4>
          <ul className="geo-map__legend-list">
            <li className="geo-map__legend-item">
              <span
                className="geo-map__legend-line"
                style={{ height: '4px', background: '#FF3B30' }}
              />
              <span>RED — A 級 / 事故路段</span>
            </li>
            <li className="geo-map__legend-item">
              <span
                className="geo-map__legend-line"
                style={{ height: '4px', background: '#FFCC00' }}
              />
              <span>YELLOW — B 級注意</span>
            </li>
            <li className="geo-map__legend-item">
              <span
                className="geo-map__legend-line"
                style={{ height: '4px', background: '#34C759' }}
              />
              <span>GREEN — 暢通 / 疏散路線</span>
            </li>
          </ul>
        </div>

        {loading && <LoadingOverlay />}
        {errorMessage && !loading && <ErrorOverlay msg={errorMessage} />}
        <RouteBanner decision={decision} />
      </div>

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
      </aside>
    </div>
  );
}
