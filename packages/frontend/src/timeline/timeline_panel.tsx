/**
 * Timeline Playback Panel (§12 GET /timeline, §13 timeline.updated, §16.1, HG-001)
 *
 * Presentation layer for TASK-124. Renders the authoritative playback state
 * produced by {@link useTimelinePlayback}: current position, selectable
 * timestamps, previous/next controls, loading/empty/error/refreshing states,
 * and the HG-001 timing/provenance evidence supplied by the backend.
 *
 * This component fabricates nothing: every timestamp and every HG-001 field
 * is either a value read from {@link TimelinePlaybackState} or an explicit
 * "unavailable" presentation, never a calculation.
 *
 * @module frontend/timeline/timeline_panel
 */

import type { ReactNode } from 'react';
import { ErrorState, LoadingIndicator } from '../components/system/async_state.js';
import { formatTimelineTimestamp } from './timeline_model.js';
import type { TimelineControllerError, TimelinePlaybackState } from './use_timeline_playback.js';

// ─── Timestamp Display ──────────────────────────────────────

interface TimestampTextProps {
  readonly value: string | null;
  readonly unavailableLabel?: string;
}

/**
 * Renders one authoritative timestamp as `YYYY-MM-DD HH:MM`, or an explicit
 * unavailable label for `null`/malformed input. Never falls back to the
 * current clock and never repairs a malformed value.
 */
function TimestampText({ value, unavailableLabel = '無法取得' }: TimestampTextProps): ReactNode {
  const formatted = formatTimelineTimestamp(value);
  return <>{formatted.ok ? formatted.text : unavailableLabel}</>;
}

// ─── HG-001 Timing Evidence ──────────────────────────────────

interface TimingEvidencePanelProps {
  readonly timing: TimelinePlaybackState['timing'];
}

/**
 * Displays HG-001 timing/provenance evidence exactly as supplied by the
 * backend. Every row shows the backend value or an explicit "尚無資料"
 * (unavailable) placeholder — never a calculation, never `Date.now()`.
 */
function TimingEvidencePanel({ timing }: TimingEvidencePanelProps): ReactNode {
  if (timing === null) {
    return null;
  }

  return (
    <section className="timeline-panel__evidence" aria-labelledby="timeline-evidence-heading">
      <h3 id="timeline-evidence-heading" className="timeline-panel__evidence-heading">
        HG-001 時間證據
      </h3>
      <dl className="timeline-panel__evidence-list">
        <div className="timeline-panel__evidence-row">
          <dt>事件時間</dt>
          <dd>
            <TimestampText value={timing.eventTimestamp} unavailableLabel="尚無資料" />
          </dd>
        </div>
        <div className="timeline-panel__evidence-row">
          <dt>決策截止時間</dt>
          <dd>
            <TimestampText value={timing.decisionCutoffTimestamp} unavailableLabel="尚無資料" />
          </dd>
        </div>
        <div className="timeline-panel__evidence-row">
          <dt>選定觀測時間</dt>
          <dd>
            <TimestampText value={timing.observationTimestamp} unavailableLabel="尚無資料" />
          </dd>
        </div>
        <div className="timeline-panel__evidence-row">
          <dt>資料延遲（分鐘）</dt>
          <dd>{timing.stalenessMinutes === null ? '尚無資料' : timing.stalenessMinutes}</dd>
        </div>
        <div className="timeline-panel__evidence-row">
          <dt>選取模式</dt>
          <dd className="timeline-panel__evidence-code">
            {timing.selectionMode === null ? '尚無資料' : timing.selectionMode}
          </dd>
        </div>
        <div className="timeline-panel__evidence-row">
          <dt>指引依據</dt>
          <dd className="timeline-panel__evidence-code">
            {timing.guidanceId === null ? '尚無資料' : timing.guidanceId}
          </dd>
        </div>
      </dl>
    </section>
  );
}

// ─── Error Message Mapping ──────────────────────────────────

function errorMessage(error: TimelineControllerError): string {
  return `時間軸讀取失敗：${error.message}`;
}

// ─── Panel Props ─────────────────────────────────────────────

export interface TimelinePanelProps {
  readonly playback: TimelinePlaybackState;
  /** Retries the initial (non-background) load. */
  readonly onRetry: () => void;
  readonly onSelect: (timestamp: string) => void;
  readonly onPrevious: () => void;
  readonly onNext: () => void;
}

/**
 * Timeline playback panel (TASK-124).
 *
 * State → UI mapping:
 * - `idle`/`loading` with no prior success → {@link LoadingIndicator}
 * - `error` with no prior success → {@link ErrorState} with a retry button
 * - `empty` → explicit empty-timeline message, no fabricated fixture
 * - `ready` → current position, selectable timestamps, previous/next controls
 * - a background `refreshing` status or a background error is layered on top
 *   of the existing `ready`/`empty` content, which is never removed
 */
export function TimelinePanel({
  playback,
  onRetry,
  onSelect,
  onPrevious,
  onNext,
}: TimelinePanelProps): ReactNode {
  const { state, error } = playback;

  if (state === 'idle' || state === 'loading') {
    return (
      <div className="timeline-panel">
        <LoadingIndicator label="載入時間軸中" />
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="timeline-panel">
        <ErrorState message={error === null ? '時間軸讀取失敗' : errorMessage(error)} />
        <button type="button" className="timeline-panel__retry" onClick={onRetry}>
          重試
        </button>
      </div>
    );
  }

  if (state === 'disposed') {
    return null;
  }

  // state is 'ready' or 'empty' from here on: render the live playback
  // surface, plus a non-destructive background-refresh/error banner.
  const isEmpty = state === 'empty';
  const atStart = playback.selectedIndex === null || playback.selectedIndex <= 0;
  const atEnd =
    playback.selectedIndex === null || playback.selectedIndex >= playback.timestamps.length - 1;

  // FIX 1: the position badge shown beside "目前重播位置" must be derived
  // from the authoritative `currentTimestamp`, never from the local
  // `selectedIndex`. `current` is guaranteed by the decoder to be one of
  // `timestamps` for a non-empty timeline, but `indexOf` is used defensively
  // rather than trusting that invariant here; an unavailable/unmatched
  // current yields no inferred index.
  const currentIndex =
    playback.currentTimestamp === null
      ? null
      : playback.timestamps.indexOf(playback.currentTimestamp);
  const currentPositionLabel =
    currentIndex === null || currentIndex === -1
      ? null
      : `${currentIndex + 1} / ${playback.timestamps.length}`;

  // The selected position is a fully separate, explicitly labeled value —
  // never rendered next to "目前重播位置", never substituted for it.
  const selectedPositionLabel =
    playback.selectedIndex === null
      ? null
      : `${playback.selectedIndex + 1} / ${playback.timestamps.length}`;

  return (
    <div className="timeline-panel">
      <h3 className="timeline-panel__heading">時間軸重播</h3>

      <div className="timeline-panel__status" role="status" aria-live="polite">
        {playback.refreshStatus === 'refreshing' ? '背景更新中…' : null}
        {playback.refreshStatus === 'idle' && playback.error !== null
          ? `背景更新失敗：${playback.error.message}（顯示上次成功的時間軸）`
          : null}
      </div>

      {isEmpty ? (
        <p className="timeline-panel__empty">目前時間軸尚無可播放的時點</p>
      ) : (
        <>
          <div className="timeline-panel__current" aria-live="polite">
            <span className="timeline-panel__current-label">目前重播位置</span>
            <span className="timeline-panel__current-value">
              <TimestampText value={playback.currentTimestamp} />
            </span>
            {currentPositionLabel !== null ? (
              <span
                className="timeline-panel__position"
                aria-label={`目前重播位置 ${currentPositionLabel}`}
              >
                {currentPositionLabel}
              </span>
            ) : null}
          </div>

          <div className="timeline-panel__controls">
            <button
              type="button"
              className="timeline-panel__nav"
              onClick={onPrevious}
              disabled={atStart}
              aria-label="上一個時點"
            >
              上一個
            </button>

            <label className="timeline-panel__select-label" htmlFor="timeline-select">
              選擇時點
            </label>
            <select
              id="timeline-select"
              className="timeline-panel__select"
              value={playback.selectedTimestamp ?? ''}
              onChange={(event) => onSelect(event.target.value)}
            >
              {playback.timestamps.map((timestamp) => (
                <option key={timestamp} value={timestamp}>
                  {timestampOptionText(timestamp)}
                </option>
              ))}
            </select>

            <button
              type="button"
              className="timeline-panel__nav"
              onClick={onNext}
              disabled={atEnd}
              aria-label="下一個時點"
            >
              下一個
            </button>
          </div>

          <p className="timeline-panel__selected">
            已選時點：<TimestampText value={playback.selectedTimestamp} />
            {selectedPositionLabel !== null ? (
              <span
                className="timeline-panel__position timeline-panel__position--selected"
                aria-label={`選擇位置 ${selectedPositionLabel}`}
              >
                選擇位置 {selectedPositionLabel}
              </span>
            ) : null}
          </p>
        </>
      )}

      <TimingEvidencePanel timing={playback.timing} />
    </div>
  );
}

/**
 * `<option>` children must be a plain string, so this reuses the same
 * `YYYY-MM-DD HH:MM` formatting rule as {@link TimestampText} without JSX.
 */
function timestampOptionText(value: string): string {
  const formatted = formatTimelineTimestamp(value);
  return formatted.ok ? formatted.text : value;
}
