/**
 * Dashboard Operations Map (schematic SVG, no third-party dependency)
 *
 * Renders one combined "事件態勢地圖" view over the existing TASK-125 road
 * traffic state and TASK-126 crowd snapshot state — road congestion,
 * station/crowd status, and their stale/insufficient/degraded conditions —
 * plus the current authoritative timeline position for context.
 *
 * ## Why schematic, not geographic
 *
 * Neither `GetRoadsResponse`/`RoadSegment` nor `GetCrowdResponse`
 * (`@city-commander/shared-schemas`) carries a coordinate or geometry field
 * (confirmed by reading every field in `raw-data.ts`/`api-contracts.ts` before
 * writing this module — see `map_model.ts`'s module doc for the full audit).
 * There is therefore no official geographic layout to plot entities on. This
 * component always renders in schematic mode and always shows the mandated
 * disclosure text ("營運示意圖，非實際地理比例") near the title, so it is
 * never mistaken for a to-scale map.
 *
 * ## Why plain SVG, no dependency
 *
 * The task requires offline availability and no new third-party dependency.
 * A hand-built `<svg>` grid needs neither a tile server, an API key, nor a
 * bundle addition, and every element it draws is fully inspectable/testable
 * DOM (`<rect>`/`<circle>`/`<text>` with `data-testid`), unlike a canvas-based
 * mapping library.
 *
 * ## Server truth boundary
 *
 * This component receives already-decoded {@link OperationsMapModel} entries
 * built by `map_model.ts` from the TASK-125/126 controllers' own state. It
 * performs no threshold comparison, no SOP evaluation, and no staleness
 * calculation of its own — `level`, `flags`, `stale`, and `dataStatus` are
 * rendered exactly as the backend supplied them.
 *
 * ## Transport boundary
 *
 * This component issues no `fetch`, opens no `WebSocket`, and starts no
 * polling loop. It is purely presentational over props supplied by
 * `pages/dashboard.tsx`, which already owns the road/crowd/timeline
 * controllers (§13/§16 single-source-of-truth rule already enforced by
 * TASK-122/125/126).
 *
 * @module frontend/map/operations_map
 */

import { useCallback, useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ErrorState, LoadingIndicator } from '../components/system/async_state.js';
import { useI18n } from '../i18n/index.js';
import { formatTimelineTimestamp } from '../timeline/timeline_model.js';
import {
  buildOperationsMapModel,
  crowdSectionStatus,
  mapEntityKey,
  roadsSectionStatus,
} from './map_model.js';
import type {
  CrowdMapEntry,
  MapEntity,
  MapSectionStatus,
  RoadMapEntry,
} from './map_model.js';
import type { RoadControllerStateName, RoadTrafficState } from '../roads/use_road_traffic.js';
import type { CrowdControllerStateName, CrowdSnapshotState } from '../crowd/use_crowd_snapshot.js';

// ─── Grid Geometry (pure layout constants, no coordinates) ────

const CELL_SIZE = 64;
const CELL_GAP = 12;
const CELL_STRIDE = CELL_SIZE + CELL_GAP;
const GRID_MARGIN = 24;
const ROAD_COLUMNS = 6;
const CROWD_COLUMNS = 6;
/** Vertical gap between the roads block and the crowd block. */
const SECTION_GAP = CELL_STRIDE;

function gridWidth(columns: number): number {
  return GRID_MARGIN * 2 + columns * CELL_STRIDE - CELL_GAP;
}

function gridHeight(rows: number): number {
  return rows === 0 ? CELL_STRIDE : GRID_MARGIN * 2 + rows * CELL_STRIDE - CELL_GAP;
}

function rowCountOf(entries: readonly { readonly position: { readonly row: number } }[]): number {
  let maxRow = -1;
  for (const entry of entries) {
    if (entry.position.row > maxRow) maxRow = entry.position.row;
  }
  return maxRow + 1;
}

// ─── Visual Tokens ──────────────────────────────────────────

const ROAD_FILL: Readonly<Record<RoadMapEntry['visualLevel'], string>> = {
  red: '#ef4444',
  yellow: '#eab308',
  neutral: '#64748b',
};

const ROAD_LABEL: Readonly<Record<RoadMapEntry['visualLevel'], string>> = {
  red: 'A 級',
  yellow: 'B 級',
  neutral: '未分級',
};

// ─── Detail Panel ───────────────────────────────────────────

interface DetailPanelProps {
  readonly entity: MapEntity | null;
}

/**
 * Accessible detail region for the currently selected entity. Rendered as a
 * live region so a screen reader announces the selection without requiring
 * focus to move away from the SVG grid.
 */
function DetailPanel({ entity }: DetailPanelProps): ReactNode {
  const { t } = useI18n();
  if (entity === null) {
    return (
      <div
        className="operations-map__detail"
        role="status"
        aria-live="polite"
        data-testid="map-detail-empty"
      >
        {t('map.detailEmpty')}
      </div>
    );
  }

  if (entity.kind === 'road') {
    return (
      <dl
        className="operations-map__detail"
        role="status"
        aria-live="polite"
        data-testid="map-detail-road"
      >
        <div className="operations-map__detail-row">
          <dt>路段 ID</dt>
          <dd data-testid="map-detail-entity-id">{entity.segmentId}</dd>
        </div>
        <div className="operations-map__detail-row">
          <dt>路名</dt>
          <dd>{entity.roadName}</dd>
        </div>
        <div className="operations-map__detail-row">
          <dt>伺服器狀態（level）</dt>
          <dd data-testid="map-detail-server-status">
            {entity.level ?? '未提供'}（{ROAD_LABEL[entity.visualLevel]}）
          </dd>
        </div>
        <div className="operations-map__detail-row">
          <dt>車道狀態</dt>
          <dd>{entity.laneStatus}</dd>
        </div>
        <div className="operations-map__detail-row">
          <dt>觀測時間</dt>
          <dd data-testid="map-detail-timestamp">
            {formatDisplayTimestamp(entity.observationTimestamp)}
          </dd>
        </div>
        <div className="operations-map__detail-row">
          <dt>延遲分鐘</dt>
          <dd>{entity.stalenessMinutes === null ? '未提供' : `${entity.stalenessMinutes} 分鐘`}</dd>
        </div>
        <div className="operations-map__detail-row">
          <dt>data_status</dt>
          <dd>{entity.dataStatus ?? '未提供'}</dd>
        </div>
      </dl>
    );
  }

  return (
    <dl
      className="operations-map__detail"
      role="status"
      aria-live="polite"
      data-testid="map-detail-crowd"
    >
      <div className="operations-map__detail-row">
        <dt>基地台 ID</dt>
        <dd data-testid="map-detail-entity-id">{entity.bsId}</dd>
      </div>
      <div className="operations-map__detail-row">
        <dt>位置</dt>
        <dd>{entity.locationName ?? '未提供'}</dd>
      </div>
      <div className="operations-map__detail-row">
        <dt>伺服器狀態（flags）</dt>
        <dd data-testid="map-detail-server-status">
          {entity.flags.length === 0 ? '未觸發' : entity.flags.join('、')}
        </dd>
      </div>
      <div className="operations-map__detail-row">
        <dt>stale</dt>
        <dd>{entity.stale === null ? '未提供' : entity.stale ? '是' : '否'}</dd>
      </div>
      <div className="operations-map__detail-row">
        <dt>觀測時間</dt>
        <dd data-testid="map-detail-timestamp">
          {formatDisplayTimestamp(entity.observationTimestamp)}
        </dd>
      </div>
      <div className="operations-map__detail-row">
        <dt>延遲分鐘</dt>
        <dd>{entity.stalenessMinutes === null ? '未提供' : `${entity.stalenessMinutes} 分鐘`}</dd>
      </div>
      <div className="operations-map__detail-row">
        <dt>data_status</dt>
        <dd>{entity.dataStatus ?? '未提供'}</dd>
      </div>
    </dl>
  );
}

function formatDisplayTimestamp(value: string | null): string {
  const formatted = formatTimelineTimestamp(value);
  return formatted.ok ? formatted.text : '未提供';
}

// ─── Legend ─────────────────────────────────────────────────

function MapLegend(): ReactNode {
  const { t } = useI18n();
  return (
    <div className="operations-map__legend" role="group" aria-label={t('map.legendAria')}>
      <h3 className="operations-map__legend-heading">{t('map.legendHeading')}</h3>
      <ul className="operations-map__legend-list">
        <li className="operations-map__legend-item">
          <span
            className="operations-map__legend-swatch"
            style={{ backgroundColor: ROAD_FILL.red }}
            aria-hidden="true"
          />
          道路 A 級（伺服器判定）
        </li>
        <li className="operations-map__legend-item">
          <span
            className="operations-map__legend-swatch"
            style={{ backgroundColor: ROAD_FILL.yellow }}
            aria-hidden="true"
          />
          道路 B 級（伺服器判定）
        </li>
        <li className="operations-map__legend-item">
          <span
            className="operations-map__legend-swatch"
            style={{ backgroundColor: ROAD_FILL.neutral }}
            aria-hidden="true"
          />
          道路未分級／NONE
        </li>
        <li className="operations-map__legend-item">
          <span
            className="operations-map__legend-swatch operations-map__legend-swatch--crowd-active"
            aria-hidden="true"
          />
          基地台觸發 SOP flag（伺服器判定）
        </li>
        <li className="operations-map__legend-item">
          <span
            className="operations-map__legend-swatch operations-map__legend-swatch--crowd-idle"
            aria-hidden="true"
          />
          基地台未觸發
        </li>
        <li className="operations-map__legend-item">
          <span className="operations-map__legend-swatch--stale-ring" aria-hidden="true" />
          資料延遲（stale，伺服器判定）
        </li>
      </ul>
    </div>
  );
}

// ─── SVG Grid ───────────────────────────────────────────────

interface EntityShapeProps {
  readonly entity: MapEntity;
  readonly selected: boolean;
  readonly onSelect: (key: string) => void;
}

function entityCenter(entity: MapEntity): { readonly cx: number; readonly cy: number } {
  return {
    cx: GRID_MARGIN + entity.position.column * CELL_STRIDE + CELL_SIZE / 2,
    cy: GRID_MARGIN + entity.position.row * CELL_STRIDE + CELL_SIZE / 2,
  };
}

function roadAriaLabel(entity: RoadMapEntry): string {
  const staleText = entity.dataStatus === 'insufficient_data' ? '，資料不足' : '';
  return `路段 ${entity.roadName}（${entity.segmentId}），伺服器狀態 ${entity.level ?? '未提供'}${staleText}`;
}

function crowdAriaLabel(entity: CrowdMapEntry): string {
  const flagText = entity.hasActiveFlags ? `已觸發 ${entity.flags.join('、')}` : '未觸發';
  const staleText = entity.stale === true ? '，資料延遲' : '';
  return `基地台 ${entity.locationName ?? entity.bsId}（${entity.bsId}），${flagText}${staleText}`;
}

/** One selectable entity shape: a road tile or a crowd-station marker. */
function EntityShape({ entity, selected, onSelect }: EntityShapeProps): ReactNode {
  const key = mapEntityKey(entity);
  const { cx, cy } = entityCenter(entity);

  const handleActivate = useCallback(() => {
    onSelect(key);
  }, [key, onSelect]);

  const handleKeyDown = useCallback(
    (event: KeyboardEvent<SVGGElement>) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        handleActivate();
      }
    },
    [handleActivate],
  );

  if (entity.kind === 'road') {
    const label = roadAriaLabel(entity);
    return (
      <g
        role="button"
        tabIndex={0}
        aria-label={label}
        aria-pressed={selected}
        data-testid={`map-entity-${key}`}
        data-entity-kind="road"
        data-entity-id={entity.segmentId}
        onClick={handleActivate}
        onKeyDown={handleKeyDown}
        className="operations-map__entity operations-map__entity--road"
      >
        <rect
          x={cx - CELL_SIZE / 2}
          y={cy - CELL_SIZE / 2}
          width={CELL_SIZE}
          height={CELL_SIZE}
          rx={6}
          fill={ROAD_FILL[entity.visualLevel]}
          stroke={selected ? '#f8fafc' : '#0f172a'}
          strokeWidth={selected ? 3 : 1}
        />
        {entity.dataStatus === 'insufficient_data' ? (
          <rect
            x={cx - CELL_SIZE / 2}
            y={cy - CELL_SIZE / 2}
            width={CELL_SIZE}
            height={CELL_SIZE}
            rx={6}
            fill="none"
            stroke="#fbbf24"
            strokeDasharray="4 3"
            strokeWidth={2}
          />
        ) : null}
        <text
          x={cx}
          y={cy + 4}
          textAnchor="middle"
          className="operations-map__entity-label"
          aria-hidden="true"
        >
          {ROAD_LABEL[entity.visualLevel]}
        </text>
        <title>{label}</title>
      </g>
    );
  }

  const label = crowdAriaLabel(entity);
  const radius = CELL_SIZE / 2 - 4;
  return (
    <g
      role="button"
      tabIndex={0}
      aria-label={label}
      aria-pressed={selected}
      data-testid={`map-entity-${key}`}
      data-entity-kind="crowd_station"
      data-entity-id={entity.bsId}
      onClick={handleActivate}
      onKeyDown={handleKeyDown}
      className="operations-map__entity operations-map__entity--crowd"
    >
      <circle
        cx={cx}
        cy={cy}
        r={radius}
        className={
          entity.hasActiveFlags
            ? 'operations-map__crowd-marker operations-map__crowd-marker--active'
            : 'operations-map__crowd-marker operations-map__crowd-marker--idle'
        }
        stroke={selected ? '#f8fafc' : entity.stale === true ? '#fbbf24' : '#0f172a'}
        strokeWidth={selected ? 3 : entity.stale === true ? 3 : 1}
        strokeDasharray={entity.stale === true ? '4 3' : undefined}
      />
      <text
        x={cx}
        y={cy + 4}
        textAnchor="middle"
        className="operations-map__entity-label"
        aria-hidden="true"
      >
        {entity.hasActiveFlags ? '!' : '·'}
      </text>
      <title>{label}</title>
    </g>
  );
}

// ─── Section States (loading / empty / error / insufficient) ─

interface SectionStateNoticeProps {
  readonly status: MapSectionStatus;
  readonly label: string;
  readonly loadingLabel: string;
}

/** Renders a section-level notice for a non-ready state. `null` when ready. */
function SectionStateNotice({ status, label, loadingLabel }: SectionStateNoticeProps): ReactNode {
  if (status === 'ready') return null;
  if (status === 'loading') {
    return <LoadingIndicator label={loadingLabel} />;
  }
  if (status === 'error') {
    return <ErrorState message={`${label}讀取失敗，地圖上的${label}圖層可能不完整`} />;
  }
  if (status === 'insufficient') {
    return (
      <p className="operations-map__section-note operations-map__section-note--insufficient" role="status">
        {label}資料不足（insufficient_data），地圖僅顯示現有圖層。
      </p>
    );
  }
  // empty
  return (
    <p className="operations-map__section-note" role="status">
      目前無{label}資料可顯示。
    </p>
  );
}

// ─── Panel ───────────────────────────────────────────────────

export interface OperationsMapProps {
  /** TASK-125 road traffic controller state, injected verbatim. */
  readonly roads: RoadTrafficState;
  /** TASK-126 crowd snapshot controller state, injected verbatim. */
  readonly crowd: CrowdSnapshotState;
  /** Authoritative timeline current position (§16.1), display-only context. */
  readonly currentTimestamp: string | null;
  /** Backend realtime/polling degradation notice, display-only context. */
  readonly degraded?: boolean;
}

function roadStateNameToStatus(state: RoadControllerStateName): MapSectionStatus {
  return roadsSectionStatus(state === 'disposed' ? 'disposed' : state);
}

function crowdStateNameToStatus(state: CrowdControllerStateName): MapSectionStatus {
  return crowdSectionStatus(state);
}

/**
 * Dashboard operations map: renders road congestion and crowd/station status
 * on one schematic SVG grid, with an accessible legend and detail panel.
 *
 * Every state this component renders (roads loading/ready/empty/insufficient/
 * error, crowd loading/ready/empty/insufficient_data/error, and the realtime
 * degraded flag) is read from the props supplied by `pages/dashboard.tsx`,
 * which already owns those controllers — this component adds no fetch,
 * timer, or socket of its own.
 */
export function OperationsMap({
  roads,
  crowd,
  currentTimestamp,
  degraded = false,
}: OperationsMapProps): ReactNode {
  const { t } = useI18n();
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const model = useMemo(
    () => buildOperationsMapModel(roads.model, crowd.stations),
    [roads.model, crowd.stations],
  );

  const roadStatus = roadStateNameToStatus(roads.state);
  const crowdStatus = crowdStateNameToStatus(crowd.state);

  const roadRows = rowCountOf(model.roads);
  const crowdRows = rowCountOf(model.crowdStations);
  const roadsBlockHeight = gridHeight(roadRows);
  const crowdBlockHeight = gridHeight(crowdRows);
  const svgWidth = Math.max(gridWidth(ROAD_COLUMNS), gridWidth(CROWD_COLUMNS));
  const svgHeight =
    (model.roads.length > 0 ? roadsBlockHeight : 0) +
    (model.roads.length > 0 && model.crowdStations.length > 0 ? SECTION_GAP : 0) +
    (model.crowdStations.length > 0 ? crowdBlockHeight : 0) ||
    CELL_STRIDE;

  const crowdOffsetY = model.roads.length > 0 ? roadsBlockHeight + SECTION_GAP : 0;

  const allEntities = useMemo<readonly MapEntity[]>(
    () => [...model.roads, ...model.crowdStations],
    [model.roads, model.crowdStations],
  );

  const selectedEntity = useMemo(
    () => allEntities.find((entity) => mapEntityKey(entity) === selectedKey) ?? null,
    [allEntities, selectedKey],
  );

  const handleSelect = useCallback((key: string) => {
    setSelectedKey((previous) => (previous === key ? previous : key));
  }, []);

  const timestampDisplay = formatDisplayTimestamp(currentTimestamp);
  const hasAnyEntity = allEntities.length > 0;

  return (
    <section className="operations-map" aria-labelledby="operations-map-heading">
      <div className="operations-map__header">
        <h3 id="operations-map-heading" className="operations-map__heading">
          {t('map.heading')}
        </h3>
        <p className="operations-map__disclosure" data-testid="map-schematic-disclosure">
          {t('map.disclosure')}
        </p>
      </div>

      <p className="operations-map__timepoint" data-testid="map-current-timestamp">
        目前時間點：{timestampDisplay}
      </p>

      {degraded ? (
        <p className="operations-map__degraded-notice" role="status" data-testid="map-degraded-notice">
          即時連線降級為輪詢，地圖圖層可能非即時更新。
        </p>
      ) : null}

      <SectionStateNotice
        status={roadStatus}
        label="路段"
        loadingLabel={t('map.roadsLoading')}
      />
      <SectionStateNotice
        status={crowdStatus}
        label="基地台"
        loadingLabel={t('map.crowdLoading')}
      />

      {hasAnyEntity ? (
        <svg
          className="operations-map__svg"
          viewBox={`0 0 ${svgWidth} ${svgHeight}`}
          role="img"
          aria-label={`事件態勢地圖（示意圖）：${model.roads.length} 個路段、${model.crowdStations.length} 個基地台`}
          data-testid="operations-map-svg"
        >
          <g data-testid="map-roads-layer">
            {model.roads.map((entity) => (
              <EntityShape
                key={mapEntityKey(entity)}
                entity={entity}
                selected={mapEntityKey(entity) === selectedKey}
                onSelect={handleSelect}
              />
            ))}
          </g>
          <g data-testid="map-crowd-layer" transform={`translate(0, ${crowdOffsetY})`}>
            {model.crowdStations.map((entity) => (
              <EntityShape
                key={mapEntityKey(entity)}
                entity={entity}
                selected={mapEntityKey(entity) === selectedKey}
                onSelect={handleSelect}
              />
            ))}
          </g>
        </svg>
      ) : roadStatus === 'ready' || crowdStatus === 'ready' ? (
        <p className="operations-map__section-note" role="status">
          目前無可顯示於地圖上的路段或基地台資料。
        </p>
      ) : null}

      <div className="operations-map__footer">
        <MapLegend />
        <DetailPanel entity={selectedEntity} />
      </div>
    </section>
  );
}
