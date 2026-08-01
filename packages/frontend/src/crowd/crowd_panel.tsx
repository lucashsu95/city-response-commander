/**
 * Crowd / Signaling Panel (§12 `GET /crowd`, §16, R8/R9/R11, HG-001)
 *
 * TASK-126 presentation layer. Renders the base-station snapshot produced by
 * {@link useCrowdSnapshot}: official readings, backend SOP flags
 * (SOP-3 shuttle / SOP-4 dome dispersal / SOP-6 multilingual), the scope-level
 * art.6 result, and the HG-001 evidence for every row (observation timestamp,
 * staleness, and the OQ-005 station-scope policy in force).
 *
 * This component performs NO deterministic judgement. Specifically it does not:
 * - compare `roamingPctValue` with 30%, `userCount` with 25,000, or
 *   `growthRate` with 0.30 / -0.20 — flags come from the backend evaluators
 * - derive `stale` from `stalenessMinutes`, or staleness from timestamps
 * - decide `inMultilingualScope`, `multilingualRequired`, or `dataStatus`
 * - reformat an official value: `Roaming_User_Pct` and the observation
 *   timestamps are displayed exactly as received (R11.5 `YYYY-MM-DD HH:MM`)
 *
 * An unknown flag code is displayed verbatim rather than dropped: a flag the
 * client does not recognize is still backend truth the operator must see.
 *
 * @module frontend/crowd/crowd_panel
 */

import type { ReactNode } from 'react';
import {
  EmptyState,
  ErrorState,
  InsufficientDataState,
  LoadingIndicator,
} from '../components/system/async_state.js';
import { CometSpinner } from '../components/loading/comet_spinner.js';
import { useI18n } from '../i18n/index.js';
import { formatTimelineTimestamp } from '../timeline/timeline_model.js';
import type { CrowdPolicyView, CrowdStationRow, MultilingualScopeSummary } from './crowd_model.js';
import type { CrowdSnapshotState } from './use_crowd_snapshot.js';

/** Shown wherever the backend supplied no value. Never a substituted number. */
const UNAVAILABLE = '尚無資料';

/**
 * Labels for the flag vocabulary the backend publishes. A code that is absent
 * from this map is rendered as-is (see module note).
 */
const FLAG_LABELS: Readonly<Record<string, string>> = {
  SOP3_MRT_SHUTTLE: 'SOP-3 捷運接駁分流',
  SOP4_DOME_DISPERSAL: 'SOP-4 大巨蛋散場',
  SOP6_MULTILINGUAL: 'SOP-6 多語通報',
};

function flagLabel(code: string): string {
  return FLAG_LABELS[code] ?? code;
}

/** Presentation of a backend boolean. Never inferred from anything else. */
function booleanText(value: boolean | null): string {
  if (value === null) return UNAVAILABLE;
  return value ? '是' : '否';
}

/** Presentation of a backend number, unrounded and unscaled. */
function numberText(value: number | null): string {
  return value === null ? UNAVAILABLE : String(value);
}

/** Presentation of an official raw timestamp (`YYYY-MM-DD HH:MM`, R11.5). */
function timestampText(value: string | null): string {
  const formatted = formatTimelineTimestamp(value);
  return formatted.ok ? formatted.text : UNAVAILABLE;
}

// ─── Policy Disclosure (OQ-005, §10.6) ───────────────────────

interface PolicyDisclosureProps {
  readonly policy: CrowdPolicyView | null;
  readonly provisional: boolean | null;
  readonly multilingual: MultilingualScopeSummary | null;
}

/**
 * Discloses the provisional-policy context this panel depends on.
 *
 * The OQ-005 station-scope mode is read from `policy.multilingual_scope.mode`
 * and, when that envelope is absent, from the scope-level `multilingual` block
 * the same response carries. Both are backend values; neither is defaulted to a
 * mode name the client picked.
 */
function PolicyDisclosure({ policy, provisional, multilingual }: PolicyDisclosureProps): ReactNode {
  const scopeMode = policy?.multilingualScopeMode ?? multilingual?.scopeMode ?? null;

  return (
    <section className="crowd-panel__policy" aria-labelledby="crowd-policy-heading">
      <h4 id="crowd-policy-heading" className="crowd-panel__policy-heading">
        政策揭露（OQ-005）
      </h4>
      {provisional === true ? (
        <p className="crowd-panel__badge crowd-panel__badge--provisional" role="note">
          臨時團隊政策（尚待主辦確認，非官方規則）
        </p>
      ) : null}
      {provisional === null ? (
        <p className="crowd-panel__badge crowd-panel__badge--unknown" role="note">
          後端未提供政策狀態
        </p>
      ) : null}
      <dl className="crowd-panel__policy-list">
        <div className="crowd-panel__policy-row">
          <dt>多語站集範圍政策</dt>
          <dd className="crowd-panel__code">{scopeMode ?? UNAVAILABLE}</dd>
        </div>
        <div className="crowd-panel__policy-row">
          <dt>政策分類</dt>
          <dd className="crowd-panel__code">{policy?.classification ?? UNAVAILABLE}</dd>
        </div>
        <div className="crowd-panel__policy-row">
          <dt>政策狀態</dt>
          <dd className="crowd-panel__code">{policy?.status ?? UNAVAILABLE}</dd>
        </div>
        <div className="crowd-panel__policy-row">
          <dt>是否官方規則</dt>
          <dd>{booleanText(policy?.isOfficial ?? null)}</dd>
        </div>
        <div className="crowd-panel__policy-row">
          <dt>指引依據</dt>
          <dd className="crowd-panel__code">{policy?.guidanceId ?? UNAVAILABLE}</dd>
        </div>
      </dl>
      <p className="crowd-panel__policy-note">
        OQ-005 之站集範圍維度仍為開放議題，以上模式為可配置之臨時政策。
      </p>
    </section>
  );
}

// ─── Scope-level SOP-6 Result ────────────────────────────────

interface MultilingualSummaryProps {
  readonly multilingual: MultilingualScopeSummary | null;
}

/** Displays the backend art.6 verdict verbatim; no threshold is applied here. */
function MultilingualSummaryView({ multilingual }: MultilingualSummaryProps): ReactNode {
  if (multilingual === null) {
    return (
      <section className="crowd-panel__multilingual">
        <h4 className="crowd-panel__subheading">多語通報判定（SOP 第 6 條）</h4>
        <EmptyState message="後端未提供多語通報判定結果" />
      </section>
    );
  }

  return (
    <section className="crowd-panel__multilingual" aria-labelledby="crowd-multilingual-heading">
      <h4 id="crowd-multilingual-heading" className="crowd-panel__subheading">
        多語通報判定（SOP 第 6 條）
      </h4>
      {multilingual.dataStatus === 'insufficient_data' ? (
        <InsufficientDataState message="多語通報判定資料不足，未作出觸發結論" />
      ) : null}
      <dl className="crowd-panel__multilingual-list">
        <div className="crowd-panel__multilingual-row">
          <dt>是否觸發</dt>
          <dd>{booleanText(multilingual.triggered)}</dd>
        </div>
        <div className="crowd-panel__multilingual-row">
          <dt>須多語發布</dt>
          <dd>{booleanText(multilingual.multilingualRequired)}</dd>
        </div>
        <div className="crowd-panel__multilingual-row">
          <dt>判定資料狀態</dt>
          <dd className="crowd-panel__code">{multilingual.dataStatus}</dd>
        </div>
        <div className="crowd-panel__multilingual-row">
          <dt>觸發站點</dt>
          <dd>
            {multilingual.triggeringStationIds.length === 0
              ? '無'
              : multilingual.triggeringStationIds.join('、')}
          </dd>
        </div>
        <div className="crowd-panel__multilingual-row">
          <dt>納入範圍站點</dt>
          <dd>
            {multilingual.stationsInScope.length === 0
              ? '無'
              : multilingual.stationsInScope.join('、')}
          </dd>
        </div>
      </dl>
    </section>
  );
}

// ─── Station Rows ────────────────────────────────────────────

interface StationRowProps {
  readonly station: CrowdStationRow;
}

/** One base station, including its HG-001 provenance and backend flags. */
function StationRow({ station }: StationRowProps): ReactNode {
  const insufficient = station.dataStatus === 'insufficient_data';

  return (
    <tr
      className={`crowd-panel__row${station.stale === true ? ' crowd-panel__row--stale' : ''}`}
      data-station-id={station.bsId}
    >
      <th scope="row" className="crowd-panel__station">
        <span className="crowd-panel__station-id">{station.bsId}</span>
        <span className="crowd-panel__station-name">{station.locationName ?? UNAVAILABLE}</span>
      </th>
      <td className="crowd-panel__cell crowd-panel__cell--count">
        {numberText(station.userCount)}
      </td>
      <td className="crowd-panel__cell crowd-panel__cell--growth">
        {numberText(station.growthRate)}
      </td>
      <td className="crowd-panel__cell crowd-panel__cell--roaming">
        <span className="crowd-panel__roaming-display">
          {station.roamingPctDisplay ?? UNAVAILABLE}
        </span>
        <span className="crowd-panel__roaming-value">
          （{numberText(station.roamingPctValue)}）
        </span>
      </td>
      <td className="crowd-panel__cell crowd-panel__cell--flags">
        {station.flags.length === 0 ? (
          <span className="crowd-panel__no-flags">未觸發</span>
        ) : (
          <ul className="crowd-panel__flags">
            {station.flags.map((flag) => (
              <li key={flag} className="crowd-panel__flag" data-flag={flag}>
                {flagLabel(flag)}
              </li>
            ))}
          </ul>
        )}
      </td>
      <td className="crowd-panel__cell crowd-panel__cell--observation">
        <span className="crowd-panel__observation">
          {timestampText(station.observationTimestamp)}
        </span>
        <span className="crowd-panel__exact-match">
          精確對齊：{booleanText(station.exactMatch)}
        </span>
      </td>
      <td className="crowd-panel__cell crowd-panel__cell--staleness">
        <span className="crowd-panel__staleness-minutes">
          {numberText(station.stalenessMinutes)}
        </span>
        {station.stale === true ? (
          <span className="crowd-panel__badge crowd-panel__badge--stale">資料延遲</span>
        ) : null}
        {station.stale === null ? (
          <span className="crowd-panel__badge crowd-panel__badge--unknown">延遲狀態未提供</span>
        ) : null}
      </td>
      <td className="crowd-panel__cell crowd-panel__cell--scope">
        {booleanText(station.inMultilingualScope)}
      </td>
      <td className="crowd-panel__cell crowd-panel__cell--status">
        {insufficient ? (
          <span className="crowd-panel__badge crowd-panel__badge--insufficient">資料不足</span>
        ) : (
          <span className="crowd-panel__code">{station.dataStatus ?? UNAVAILABLE}</span>
        )}
      </td>
    </tr>
  );
}

interface StationTableProps {
  readonly stations: readonly CrowdStationRow[];
}

function StationTable({ stations }: StationTableProps): ReactNode {
  return (
    <table className="crowd-panel__table">
      <caption className="crowd-panel__table-caption">
        基地台人流與信令（數值與旗標皆由後端判定）
      </caption>
      <thead>
        <tr>
          <th scope="col">基地台</th>
          <th scope="col">人數</th>
          <th scope="col">成長率</th>
          <th scope="col">漫遊比率</th>
          <th scope="col">SOP 旗標</th>
          <th scope="col">觀測時間</th>
          <th scope="col">資料延遲（分鐘）</th>
          <th scope="col">納入多語範圍</th>
          <th scope="col">資料狀態</th>
        </tr>
      </thead>
      <tbody>
        {stations.map((station) => (
          <StationRow key={station.bsId} station={station} />
        ))}
      </tbody>
    </table>
  );
}

// ─── Panel ───────────────────────────────────────────────────

export interface CrowdPanelProps {
  readonly snapshot: CrowdSnapshotState;
  /** Retries the initial (non-background) read. */
  readonly onRetry: () => void;
}

/**
 * Crowd/signaling panel (TASK-126).
 *
 * State → UI mapping:
 * - `idle`/`loading` before any success → {@link LoadingIndicator}
 * - `error` before any success → {@link ErrorState} plus a retry control
 * - `insufficient_data` → the backend STOP is shown with its `stop_reason`,
 *   never as an empty table implying "no crowd pressure"
 * - `empty` → explicit "no station reading at this replay position"
 * - `ready` → the station table with per-row HG-001 provenance
 *
 * A background refresh (or a failed background refresh) is layered on top of
 * existing content, which is never removed.
 */
export function CrowdPanel({ snapshot, onRetry }: CrowdPanelProps): ReactNode {
  const { t } = useI18n();
  const { state, error } = snapshot;

  if (state === 'idle' || state === 'loading') {
    return (
      <div className="crowd-panel">
        <LoadingIndicator label={t('crowd.loading')} />
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="crowd-panel">
        <ErrorState
          message={error === null ? t('crowd.errorFallback') : `${t('crowd.errorFallback')}：${error.message}`}
        />
        <button type="button" className="crowd-panel__retry" onClick={onRetry}>
          {t('action.retry')}
        </button>
      </div>
    );
  }

  return (
    <div className="crowd-panel">
      <h3 className="crowd-panel__heading">{t('crowd.heading')}</h3>

      <div
        className="crowd-panel__status"
        role={snapshot.refreshStatus === 'refreshing' ? undefined : 'status'}
        aria-live="polite"
      >
        {snapshot.refreshStatus === 'refreshing' ? (
          <CometSpinner className="loading-spinner--inline" label={t('crowd.refreshing')} />
        ) : null}
        {snapshot.refreshStatus === 'idle' && error !== null
          ? t('async.backgroundError', { message: error.message })
          : null}
      </div>

      <p className="crowd-panel__cutoff">
        決策截止時間：
        <span className="crowd-panel__cutoff-value">
          {timestampText(snapshot.decisionCutoffTimestamp)}
        </span>
      </p>

      <PolicyDisclosure
        policy={snapshot.policy}
        provisional={snapshot.provisional}
        multilingual={snapshot.multilingual}
      />

      {state === 'insufficient_data' ? (
        <InsufficientDataState
          message={
            snapshot.stopReason === null
              ? '後端回報資料不足，未提供基地台讀數'
              : `後端回報資料不足：${snapshot.stopReason}`
          }
        />
      ) : null}

      {state === 'empty' ? <EmptyState message={t('crowd.empty')} /> : null}

      {state === 'ready' ? <StationTable stations={snapshot.stations} /> : null}

      <MultilingualSummaryView multilingual={snapshot.multilingual} />
    </div>
  );
}
