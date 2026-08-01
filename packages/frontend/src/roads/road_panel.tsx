/**
 * Road Traffic Panel (§12 GET /roads, §16, §22.1 P7, HG-001, TASK-125)
 *
 * Presentation layer for TASK-125. Renders the road-segment state produced by
 * {@link useRoadTraffic}: loading/empty/insufficient/error states, every
 * server-returned segment in server order, and the server-provided `level`
 * mapped to a red/yellow/neutral indicator.
 *
 * Authority boundary (competition_quality_floor / failure_cases in
 * tasks.md TASK-125): this component never recomputes `level` from
 * `saturation_score`, never compares against 0.85/0.95, and never derives
 * staleness from a timestamp. Every value rendered is either read verbatim
 * from the backend or an explicit "unavailable"/"unavailable-provenance"
 * placeholder — never a calculation, never `Date.now()`.
 *
 * @module frontend/roads/road_panel
 */

import type { ReactNode } from 'react';
import { ErrorState, LoadingIndicator } from '../components/system/async_state.js';
import { CometSpinner } from '../components/loading/comet_spinner.js';
import { useI18n } from '../i18n/index.js';
import type { RoadSegmentView } from './road_model.js';
import type { RoadTrafficState } from './use_road_traffic.js';

// ─── Level → Visual Mapping ──────────────────────────────────

/**
 * Presentation token for one backend-supplied `level` value. This is a pure
 * lookup, never a threshold comparison: `'A'` and `'B'` are the only values
 * mapped to a specific colour; every other value (including `null`) maps to
 * the neutral token. No `saturation_score` is read here.
 */
type LevelToken = 'level-a' | 'level-b' | 'level-neutral';

function levelToken(level: string | null): LevelToken {
  if (level === 'A') {
    return 'level-a';
  }
  if (level === 'B') {
    return 'level-b';
  }
  return 'level-neutral';
}

const LEVEL_INDICATOR_CLASS: Record<LevelToken, string> = {
  'level-a': 'road-panel__level-dot--red',
  'level-b': 'road-panel__level-dot--yellow',
  'level-neutral': 'road-panel__level-dot--neutral',
};

interface LevelIndicatorProps {
  readonly level: string | null;
}

/**
 * Renders the backend-provided `level` as a colour dot *and* text label, so
 * the classification is never communicated by colour alone (Phase 5
 * accessibility rule).
 */
function LevelIndicator({ level }: LevelIndicatorProps): ReactNode {
  const { t } = useI18n();
  const token = levelToken(level);
  const label =
    token === 'level-a'
      ? t('roads.levelA')
      : token === 'level-b'
        ? t('roads.levelB')
        : t('roads.levelNeutral');
  return (
    <span className="road-panel__level">
      <span
        className={`road-panel__level-dot ${LEVEL_INDICATOR_CLASS[token]}`}
        aria-hidden="true"
      />
      <span className="road-panel__level-text">{label}</span>
    </span>
  );
}

// ─── Provenance Cell ─────────────────────────────────────────

interface ProvenanceCellProps {
  readonly observationTimestamp: string | null;
  readonly stalenessMinutes: number | null;
  readonly dataStatus: string | null;
}

/**
 * Displays per-segment HG-001 provenance/staleness evidence exactly as
 * supplied by the backend. Every field renders the backend value or an
 * explicit unavailable placeholder — never a calculation.
 */
function ProvenanceCell({
  observationTimestamp,
  stalenessMinutes,
  dataStatus,
}: ProvenanceCellProps): ReactNode {
  const hasAnyEvidence =
    observationTimestamp !== null || stalenessMinutes !== null || dataStatus !== null;

  if (!hasAnyEvidence) {
    return <span className="road-panel__provenance road-panel__provenance--unavailable">provenance 未提供</span>;
  }

  return (
    <span className="road-panel__provenance">
      {observationTimestamp !== null ? (
        <span className="road-panel__provenance-item">觀測時間：{observationTimestamp}</span>
      ) : null}
      {stalenessMinutes !== null ? (
        <span className="road-panel__provenance-item road-panel__provenance-item--stale">
          資料延遲：{stalenessMinutes} 分鐘
        </span>
      ) : null}
      {dataStatus !== null ? (
        <span className="road-panel__provenance-item">狀態：{dataStatus}</span>
      ) : null}
    </span>
  );
}

// ─── Segment Row ─────────────────────────────────────────────

interface SegmentRowProps {
  readonly segment: RoadSegmentView;
}

function SegmentRow({ segment }: SegmentRowProps): ReactNode {
  return (
    <li className="road-panel__row" data-segment-id={segment.segmentId}>
      <div className="road-panel__row-main">
        <span className="road-panel__road-name">{segment.roadName}</span>
        <span className="road-panel__segment-id">{segment.segmentId}</span>
        <LevelIndicator level={segment.level} />
      </div>
      <div className="road-panel__row-meta">
        <span className="road-panel__saturation">
          飽和度：{segment.saturationScore}
        </span>
        <span className="road-panel__lane-status">車道狀態：{segment.laneStatus}</span>
      </div>
      <ProvenanceCell
        observationTimestamp={segment.observationTimestamp}
        stalenessMinutes={segment.stalenessMinutes}
        dataStatus={segment.dataStatus}
      />
    </li>
  );
}

// ─── Panel Props ──────────────────────────────────────────────

export interface RoadPanelProps {
  readonly traffic: RoadTrafficState;
  /** Retries the initial (non-background) load. */
  readonly onRetry: () => void;
}

/**
 * Road traffic panel (TASK-125).
 *
 * State → UI mapping:
 * - `idle`/`loading` with no prior success → {@link LoadingIndicator}
 * - `error` with no prior success → {@link ErrorState} with a retry button
 * - `empty` → explicit empty-response message, no fabricated fixture
 * - `insufficient` → explicit insufficient-data message (backend
 *   `data_status`, never inferred)
 * - `ready` → every server-returned segment, in server order
 * - a background `refreshing` status or a background error is layered on top
 *   of the existing content, which is never removed
 */
export function RoadPanel({ traffic, onRetry }: RoadPanelProps): ReactNode {
  const { t } = useI18n();
  const { state, error } = traffic;

  if (state === 'idle' || state === 'loading') {
    return (
      <div className="road-panel">
        <LoadingIndicator label={t('roads.loading')} />
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="road-panel">
        <ErrorState
          message={error === null ? t('roads.errorFallback') : `${t('roads.errorFallback')}：${error.message}`}
        />
        <button type="button" className="road-panel__retry" onClick={onRetry}>
          {t('action.retry')}
        </button>
      </div>
    );
  }

  if (state === 'disposed') {
    return null;
  }

  // state is 'ready' | 'empty' | 'insufficient' from here on: render the live
  // surface, plus a non-destructive background-refresh/error banner.
  const model = traffic.model;

  return (
    <div className="road-panel">
      <h3 className="road-panel__heading">{t('roads.heading')}</h3>

      <div
        className="road-panel__status"
        role={traffic.refreshStatus === 'refreshing' ? undefined : 'status'}
        aria-live="polite"
      >
        {traffic.refreshStatus === 'refreshing' ? (
          <CometSpinner className="loading-spinner--inline" label={t('roads.refreshing')} />
        ) : null}
        {traffic.refreshStatus === 'idle' && traffic.error !== null
          ? t('async.backgroundError', { message: traffic.error.message })
          : null}
      </div>

      {state === 'insufficient' ? (
        <p className="road-panel__insufficient" role="status">
          {t('roads.insufficient')}
        </p>
      ) : null}

      {state === 'empty' ? (
        <p className="road-panel__empty">{t('roads.empty')}</p>
      ) : null}

      {model !== null && model.segments.length > 0 ? (
        <>
          <p className="road-panel__snapshot-timestamp">快照時間：{model.timestamp}</p>
          <ul className="road-panel__list" aria-label="路段車流列表">
            {model.segments.map((segment) => (
              <SegmentRow key={segment.segmentId} segment={segment} />
            ))}
          </ul>
        </>
      ) : null}
    </div>
  );
}
