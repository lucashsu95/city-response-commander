/**
 * Command Center Shell Layout
 *
 * Redesigned dashboard shell for the City Traffic AI Command Center.
 * Three-column layout: Nav | Main Map+Timeline+Charts | AI Decision Panel
 *
 * Design principles:
 * - Map is the hero element (largest area on screen)
 * - Dark command center aesthetic
 * - Minimal chrome, maximum data density
 * - No raw data tables visible by default
 *
 * @module frontend/layout/command_center_shell
 */

import {
  useCallback,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import type { ConnectionMode } from '../state/app_state.js';
import { OperationalStatusBar } from '../components/system/operational_status.js';

// ─── Clock ────────────────────────────────────────────────

function useSystemClock(): string {
  const [time, setTime] = useState<string>(() => formatClock(new Date()));

  useEffect(() => {
    const id = setInterval(() => setTime(formatClock(new Date())), 1000);
    return () => clearInterval(id);
  }, []);

  return time;
}

function formatClock(date: Date): string {
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const mi = String(date.getMinutes()).padStart(2, '0');
  const s = String(date.getSeconds()).padStart(2, '0');
  return `${y}-${mo}-${d} ${h}:${mi}:${s}`;
}

// ─── Navigation Item ──────────────────────────────────────

interface NavItem {
  readonly id: string;
  readonly label: string;
  readonly icon: string;
}

const NAV_ITEMS: NavItem[] = [
  { id: 'dashboard', label: '儀表板', icon: '⬡' },
  { id: 'traffic', label: '交通', icon: '⬢' },
  { id: 'incident', label: '事件', icon: '◆' },
  { id: 'timeline', label: '時間軸', icon: '◇' },
  { id: 'ai', label: 'AI決策', icon: '◈' },
  { id: 'whatif', label: 'What-if', icon: '◎' },
  { id: 'settings', label: '設定', icon: '○' },
];

interface NavSidebarProps {
  readonly activeId: string;
  readonly onNavigate: (id: string) => void;
}

function NavSidebar({ activeId, onNavigate }: NavSidebarProps): ReactNode {
  return (
    <nav className="cmd-nav" aria-label="主導覽">
      <div className="cmd-nav__logo" aria-hidden="true">
        <span className="cmd-nav__logo-icon">⬡</span>
      </div>
      <ul className="cmd-nav__list" role="list">
        {NAV_ITEMS.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              className={`cmd-nav__item${activeId === item.id ? ' cmd-nav__item--active' : ''}`}
              onClick={() => onNavigate(item.id)}
              aria-current={activeId === item.id ? 'page' : undefined}
              title={item.label}
            >
              <span className="cmd-nav__icon" aria-hidden="true">{item.icon}</span>
              <span className="cmd-nav__label">{item.label}</span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}

// ─── Command Header ───────────────────────────────────────

interface CommandHeaderProps {
  readonly connectionMode: ConnectionMode;
  readonly pollingErrorMessage?: string | null;
  readonly pollingUpdateCount?: number;
  readonly onInjectClick: () => void;
}

function CommandHeader({
  connectionMode,
  pollingErrorMessage,
  pollingUpdateCount,
  onInjectClick,
}: CommandHeaderProps): ReactNode {
  const clock = useSystemClock();

  const status = {
    isStale: false,
    stalenessMinutes: null,
    connectionMode,
    isProvisionalPolicy: false,
    manualConfirmationRequired: false,
  };

  return (
    <header className="cmd-header" role="banner">
      {/* Left: Title */}
      <div className="cmd-header__left">
        <div className="cmd-header__title-block">
          <h1 className="cmd-header__title">城市交通應變 AI 指揮台</h1>
          <span className="cmd-header__subtitle">中華電信命題</span>
        </div>
      </div>

      {/* Center: Branding */}
      <div className="cmd-header__center">
        <span className="cmd-header__brand">中華電信</span>
        <span className="cmd-header__brand-divider" aria-hidden="true">|</span>
        <span className="cmd-header__brand-name">城市應變分析 AI Agent</span>
      </div>

      {/* Right: Status + Inject */}
      <div className="cmd-header__right">
        <div className="cmd-header__clock" aria-live="polite" aria-label="系統時間">
          <span className="cmd-header__clock-icon" aria-hidden="true">◷</span>
          <span className="cmd-header__clock-value">{clock}</span>
        </div>

        <div className="cmd-header__status-group">
          <OperationalStatusBar
            status={status}
            pollingErrorMessage={pollingErrorMessage}
            pollingUpdateCount={pollingUpdateCount}
          />
        </div>

        <button
          type="button"
          className="cmd-header__inject-btn"
          onClick={onInjectClick}
          aria-label="突發事件注入"
        >
          <span className="cmd-header__inject-icon" aria-hidden="true">⚡</span>
          <span>突發事件注入</span>
        </button>
      </div>
    </header>
  );
}

// ─── Timeline Bar ────────────────────────────────────────

interface TimelineBarProps {
  readonly timestamps: readonly string[];
  readonly currentIndex: number | null;
  readonly isPlaying: boolean;
  readonly loading: boolean;
  readonly onSelect: (timestamp: string) => void;
  readonly onPrevious: () => void;
  readonly onNext: () => void;
  readonly onPlay: () => void;
  readonly onPause: () => void;
}

function formatTimestamp(ts: string | null): string {
  if (ts === null) return '--:--:--';
  // Handle both "2026/5/20 17:00" and "2026-05-20T17:00:00" formats
  const trimmed = ts.trim();
  if (trimmed.includes('T')) {
    const d = new Date(trimmed);
    if (!isNaN(d.getTime())) {
      return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
    }
  }
  // Parse "YYYY/M/D HH:MM" or "YYYY/M/D H:MM"
  const match = trimmed.match(/(\d{4})\/(\d+)\/(\d+)\s+(\d+):(\d+)/);
  if (match) {
    return `${match[4].padStart(2, '0')}:${match[5].padStart(2, '0')}:00`;
  }
  return trimmed;
}

function TimelineBar({
  timestamps,
  currentIndex,
  isPlaying,
  loading,
  onSelect,
  onPrevious,
  onNext,
  onPlay,
  onPause,
}: TimelineBarProps): ReactNode {
  const hasTimestamps = timestamps.length > 0;
  const atStart = currentIndex === null || currentIndex <= 0;
  const atEnd = currentIndex === null || currentIndex >= timestamps.length - 1;
  const currentTs = currentIndex !== null && currentIndex >= 0 && currentIndex < timestamps.length
    ? timestamps[currentIndex]
    : null;

  return (
    <div className="timeline-bar" role="region" aria-label="時間軸播放控制">
      <div className="timeline-bar__controls">
        <button
          type="button"
          className="timeline-bar__btn"
          onClick={onPrevious}
          disabled={atStart || loading}
          aria-label="上一個時點"
          title="上一個"
        >
          <span aria-hidden="true">◂</span>
        </button>

        <button
          type="button"
          className={`timeline-bar__btn timeline-bar__btn--play${isPlaying ? ' timeline-bar__btn--active' : ''}`}
          onClick={isPlaying ? onPause : onPlay}
          disabled={!hasTimestamps || loading}
          aria-label={isPlaying ? '暫停' : '播放'}
          title={isPlaying ? '暫停' : '播放'}
        >
          <span aria-hidden="true">{isPlaying ? '⏸' : '▶'}</span>
        </button>

        <button
          type="button"
          className="timeline-bar__btn"
          onClick={onNext}
          disabled={atEnd || loading}
          aria-label="下一個時點"
          title="下一個"
        >
          <span aria-hidden="true">▸</span>
        </button>
      </div>

      <div className="timeline-bar__track">
        {hasTimestamps ? (
          <>
            <div className="timeline-bar__progress">
              {timestamps.map((ts, i) => {
                const pct = ((i + 1) / timestamps.length) * 100;
                const isSelected = i === currentIndex;
                return (
                  <div
                    key={`${ts}-${i}`}
                    className={`timeline-bar__tick${isSelected ? ' timeline-bar__tick--active' : ''}`}
                    style={{ left: `${pct}%` }}
                    title={formatTimestamp(ts)}
                    role="presentation"
                  />
                );
              })}
              {currentIndex !== null && (
                <div
                  className="timeline-bar__cursor"
                  style={{
                    left: currentIndex === 0 ? `${(1 / timestamps.length) * 100}%`
                      : `${((currentIndex + 0.5) / timestamps.length) * 100}%`,
                  }}
                  aria-hidden="true"
                />
              )}
            </div>
            <input
              type="range"
              className="timeline-bar__slider"
              min={0}
              max={timestamps.length - 1}
              value={currentIndex ?? 0}
              onChange={(e) => onSelect(timestamps[parseInt(e.target.value, 10)])}
              aria-label="選擇時間點"
              disabled={loading}
            />
          </>
        ) : (
          <span className="timeline-bar__empty">
            {loading ? '載入中…' : '尚無時間軸資料'}
          </span>
        )}
      </div>

      <div className="timeline-bar__info">
        <span className="timeline-bar__current" aria-live="polite">
          <span className="timeline-bar__current-label">時間</span>
          <span className="timeline-bar__current-value">
            {currentTs ? formatTimestamp(currentTs) : '--:--:--'}
          </span>
        </span>
        {hasTimestamps && currentIndex !== null && (
          <span className="timeline-bar__index">
            {currentIndex + 1} / {timestamps.length}
          </span>
        )}
      </div>
    </div>
  );
}

// ─── Metric Chart Cards ────────────────────────────────────

export interface RoadMetricData {
  readonly roadName: string;
  readonly avgSpeed: number | null;
  readonly saturation: number | null;
  readonly status: 'clear' | 'caution' | 'blocked' | 'unknown';
}

export interface CrowdMetricData {
  readonly stationId: string;
  readonly locationName: string;
  readonly userCount: number | null;
  readonly roamingPct: number | null;
}

export interface RoamingMetricData {
  readonly stationId: string;
  readonly roamingPct: number | null;
}

interface MetricChartsProps {
  readonly roads: readonly RoadMetricData[];
  readonly crowd: readonly CrowdMetricData[];
  readonly roaming: readonly RoamingMetricData[];
}

function MetricCharts({ roads, crowd, roaming }: MetricChartsProps): ReactNode {
  return (
    <div className="metric-charts">
      {/* Chart 1: Road Speed */}
      <div className="metric-card metric-card--road">
        <div className="metric-card__header">
          <span className="metric-card__icon" aria-hidden="true">⬢</span>
          <h3 className="metric-card__title">核心路段車速</h3>
        </div>
        <div className="metric-card__body">
          {roads.length === 0 ? (
            <span className="metric-card__empty">後端未提供</span>
          ) : (
            <div className="metric-card__bars">
              {roads.slice(0, 5).map((r) => {
                const maxSpeed = 60;
                const speed = r.avgSpeed ?? 0;
                const pct = Math.min(100, (speed / maxSpeed) * 100);
                return (
                  <div key={r.roadName} className="metric-bar">
                    <div className="metric-bar__label">
                      <span className="metric-bar__name">{r.roadName}</span>
                      <span className="metric-bar__value">{speed > 0 ? `${speed} km/h` : '—'}</span>
                    </div>
                    <div className="metric-bar__track">
                      <div
                        className={`metric-bar__fill metric-bar__fill--${r.status}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Chart 2: MRT Crowd */}
      <div className="metric-card metric-card--crowd">
        <div className="metric-card__header">
          <span className="metric-card__icon" aria-hidden="true">◈</span>
          <h3 className="metric-card__title">捷運站人流</h3>
        </div>
        <div className="metric-card__body">
          {crowd.length === 0 ? (
            <span className="metric-card__empty">後端未提供</span>
          ) : (
            <div className="metric-card__gauges">
              {crowd.slice(0, 4).map((s) => {
                const max = 50000;
                const count = s.userCount ?? 0;
                const pct = Math.min(100, (count / max) * 100);
                const gaugeColor = pct > 80 ? '#ef4444' : pct > 50 ? '#eab308' : '#22c55e';
                return (
                  <div key={s.stationId} className="metric-gauge">
                    <div className="metric-gauge__label">
                      <span className="metric-gauge__name">{s.locationName || s.stationId}</span>
                      <span className="metric-gauge__value">
                        {count > 0 ? count.toLocaleString() : '—'}
                      </span>
                    </div>
                    <div className="metric-gauge__track">
                      <div
                        className="metric-gauge__fill"
                        style={{ width: `${pct}%`, backgroundColor: gaugeColor }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Chart 3: Roaming */}
      <div className="metric-card metric-card--roaming">
        <div className="metric-card__header">
          <span className="metric-card__icon" aria-hidden="true">◎</span>
          <h3 className="metric-card__title">基地台漫遊比例</h3>
        </div>
        <div className="metric-card__body">
          {roaming.length === 0 ? (
            <span className="metric-card__empty">後端未提供</span>
          ) : (
            <div className="metric-card__ranked">
              {roaming.slice(0, 5).map((r, i) => {
                const pct = r.roamingPct ?? 0;
                return (
                  <div key={r.stationId} className="metric-ranked">
                    <span className="metric-ranked__rank">{i + 1}</span>
                    <span className="metric-ranked__name">{r.stationId.replace('BS_', '')}</span>
                    <span className="metric-ranked__bar">
                      <span
                        className="metric-ranked__fill"
                        style={{ width: `${Math.min(100, pct)}%` }}
                      />
                    </span>
                    <span className="metric-ranked__value">{pct > 0 ? `${pct.toFixed(1)}%` : '—'}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── AI Decision Card ────────────────────────────────────

interface AIDecisionCardProps {
  readonly severity: string | null;
  readonly incidentType: string | null;
  readonly triggeredArticles: readonly number[];
  readonly eteMinutes: number | null;
  readonly cmsCoreText: string | null;
  readonly textSource: string | null;
  readonly isProvisional: boolean;
}

function AIDecisionCard({
  severity,
  incidentType,
  triggeredArticles,
  eteMinutes,
  cmsCoreText,
  textSource,
  isProvisional,
}: AIDecisionCardProps): ReactNode {
  const severityColor = severity === 'Critical' ? '#dc2626'
    : severity === 'High' ? '#f97316'
    : severity === 'Medium' ? '#eab308'
    : '#64748b';

  return (
    <div className="ai-card ai-card--decision">
      <div className="ai-card__header">
        <span className="ai-card__icon" aria-hidden="true">◈</span>
        <h3 className="ai-card__title">AI 決策推理</h3>
        {isProvisional && (
          <span className="ai-card__badge ai-card__badge--provisional">暫定</span>
        )}
      </div>
      <div className="ai-card__body">
        <div className="ai-card__field">
          <span className="ai-card__field-label">事故等級</span>
          <span
            className="ai-card__field-value ai-card__severity"
            style={{ color: severityColor }}
          >
            {severity ?? '後端未提供'}
          </span>
        </div>
        <div className="ai-card__field">
          <span className="ai-card__field-label">事件類型</span>
          <span className="ai-card__field-value">{incidentType ?? '後端未提供'}</span>
        </div>
        <div className="ai-card__field">
          <span className="ai-card__field-label">ETE</span>
          <span className="ai-card__field-value">
            {eteMinutes !== null ? `${eteMinutes} 分鐘` : '後端未提供'}
          </span>
        </div>
        <div className="ai-card__field">
          <span className="ai-card__field-label">觸發 SOP</span>
          <span className="ai-card__field-value">
            {triggeredArticles.length > 0
              ? triggeredArticles.map((a) => `第 ${a} 條`).join('、')
              : '後端未提供'}
          </span>
        </div>
        {cmsCoreText && (
          <div className="ai-card__text-block">
            <span className="ai-card__field-label">AI 推論摘要</span>
            <p className="ai-card__text">{cmsCoreText}</p>
          </div>
        )}
        {textSource && (
          <div className="ai-card__field ai-card__field--source">
            <span className="ai-card__field-label">文字來源</span>
            <span className="ai-card__field-value ai-card__source">{textSource}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Route Advice Card ────────────────────────────────────

interface RouteAdviceCardProps {
  readonly primary: string | null;
  readonly secondary: readonly string[];
  readonly excluded: readonly { id: string; reason: string }[];
}

function RouteAdviceCard({
  primary,
  secondary,
  excluded,
}: RouteAdviceCardProps): ReactNode {
  return (
    <div className="ai-card ai-card--routes">
      <div className="ai-card__header">
        <span className="ai-card__icon" aria-hidden="true">⬢</span>
        <h3 className="ai-card__title">推薦疏散路線</h3>
      </div>
      <div className="ai-card__body">
        {primary ? (
          <div className="ai-route ai-route--primary">
            <span className="ai-route__badge ai-route__badge--primary">主</span>
            <span className="ai-route__name">{primary}</span>
          </div>
        ) : (
          <div className="ai-route ai-route--empty">後端未提供主疏散路線</div>
        )}

        {secondary.length > 0 && (
          <div className="ai-route-group">
            <span className="ai-route-group__label">次要疏散</span>
            {secondary.map((s) => (
              <div key={s} className="ai-route ai-route--secondary">
                <span className="ai-route__badge ai-route__badge--secondary">次</span>
                <span className="ai-route__name">{s}</span>
              </div>
            ))}
          </div>
        )}

        {excluded.length > 0 && (
          <div className="ai-route-group">
            <span className="ai-route-group__label">排除路段</span>
            {excluded.map((e) => (
              <div key={e.id} className="ai-route ai-route--excluded">
                <span className="ai-route__badge ai-route__badge--excluded">×</span>
                <span className="ai-route__name">{e.id}</span>
                <span className="ai-route__reason">{e.reason}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Multilingual Card ────────────────────────────────────

type Lang = '中文' | 'English' | '日本語' | '한국어';

interface MultilingualCardProps {
  readonly texts: Readonly<Record<Lang, string | null>>;
  readonly publishDisabled?: boolean;
}

function MultilingualCard({ texts, publishDisabled = true }: MultilingualCardProps): ReactNode {
  const [activeLang, setActiveLang] = useState<Lang>('中文');

  const langs: Lang[] = ['中文', 'English', '日本語', '한국어'];

  const currentText = texts[activeLang];

  return (
    <div className="ai-card ai-card--multilingual">
      <div className="ai-card__header">
        <span className="ai-card__icon" aria-hidden="true">◎</span>
        <h3 className="ai-card__title">多語通報</h3>
      </div>
      <div className="ai-card__body">
        <div className="ai-card__lang-tabs" role="tablist" aria-label="語言">
          {langs.map((lang) => (
            <button
              key={lang}
              type="button"
              role="tab"
              className={`ai-card__lang-tab${activeLang === lang ? ' ai-card__lang-tab--active' : ''}`}
              onClick={() => setActiveLang(lang)}
              aria-selected={activeLang === lang}
            >
              {lang}
            </button>
          ))}
        </div>
        <div
          className="ai-card__lang-content"
          role="tabpanel"
          aria-label={activeLang}
        >
          {currentText ? (
            <p className="ai-card__multilingual-text">{currentText}</p>
          ) : (
            <span className="ai-card__empty">後端未提供</span>
          )}
        </div>
        <button
          type="button"
          className="ai-card__publish-btn"
          disabled={publishDisabled}
          title={publishDisabled ? '發布功能尚未接線' : '發布警示'}
        >
          發布警示
        </button>
        {publishDisabled && (
          <p className="ai-card__publish-note">發布功能尚未接線</p>
        )}
      </div>
    </div>
  );
}

// ─── What-if Card ────────────────────────────────────────

interface WhatIfCardProps {
  readonly content: ReactNode;
}

function WhatIfCard({ content }: WhatIfCardProps): ReactNode {
  return (
    <div className="ai-card ai-card--whatif">
      <div className="ai-card__header">
        <span className="ai-card__icon" aria-hidden="true">◎</span>
        <h3 className="ai-card__title">What-if 策略諮詢</h3>
      </div>
      <div className="ai-card__body">
        {content}
      </div>
    </div>
  );
}

// ─── Injection Modal (Portal) ───────────────────────────────

interface InjectionModalProps {
  readonly isOpen: boolean;
  readonly onClose: () => void;
  readonly content: ReactNode;
}

function InjectionModal({ isOpen, onClose, content }: InjectionModalProps): ReactNode {
  // Lock body scroll while modal is open
  useEffect(() => {
    if (!isOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [isOpen]);

  // Close on Escape
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [isOpen, onClose]);

  if (!isOpen || typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="injection-modal__layer"
      role="dialog"
      aria-modal="true"
      aria-label="突發事件注入"
    >
      {/* Backdrop — clicking it closes; clicking the panel does not */}
      <div
        className="injection-modal__backdrop"
        aria-hidden="true"
        onClick={onClose}
      />

      {/* Panel */}
      <section className="injection-modal">
        <div className="injection-modal__header">
          <h2 className="injection-modal__title">突發事件注入</h2>
          <button
            type="button"
            className="injection-modal__close"
            onClick={onClose}
            aria-label="關閉突發事件注入"
          >
            ✕
          </button>
        </div>
        <div className="injection-modal__body">
          {content}
        </div>
      </section>
    </div>,
    document.body,
  );
}

// ─── Main Shell Props ─────────────────────────────────────

export interface CommandCenterShellProps {
  /** Realtime connection mode */
  readonly connectionMode: ConnectionMode;
  /** Polling failure message */
  readonly pollingErrorMessage?: string | null;
  /** Polling update count */
  readonly pollingUpdateCount?: number;
  /** Timeline timestamps */
  readonly timelineTimestamps: readonly string[];
  /** Current timeline index */
  readonly timelineIndex: number | null;
  /** Timeline is playing */
  readonly timelinePlaying: boolean;
  /** Timeline loading state */
  readonly timelineLoading: boolean;
  /** Timeline callbacks */
  readonly onTimelineSelect: (timestamp: string) => void;
  readonly onTimelinePrevious: () => void;
  readonly onTimelineNext: () => void;
  readonly onTimelinePlay: () => void;
  readonly onTimelinePause: () => void;
  /** Map content (OperationsMap component) */
  readonly mapContent: ReactNode;
  /** Road metric data */
  readonly roadMetrics: readonly RoadMetricData[];
  /** Crowd metric data */
  readonly crowdMetrics: readonly CrowdMetricData[];
  /** Roaming metric data */
  readonly roamingMetrics: readonly RoamingMetricData[];
  /** AI decision content */
  readonly aiDecisionContent: ReactNode;
  /** Route advice content */
  readonly routeAdviceContent: ReactNode;
  /** Multilingual content */
  readonly multilingualContent: ReactNode;
  /** What-if content */
  readonly whatifContent: ReactNode;
  /** Injection modal content */
  readonly injectionContent: ReactNode;
  /** Control Center Recommendation panel (optional, shown after injection) */
  readonly recommendationContent?: ReactNode;
  /** Anomaly demo popup overlay (optional) */
  readonly overlayContent?: ReactNode;
}

// ─── Command Center Shell ─────────────────────────────────

export function CommandCenterShell({
  connectionMode,
  pollingErrorMessage = null,
  pollingUpdateCount = 0,
  timelineTimestamps,
  timelineIndex,
  timelinePlaying,
  timelineLoading,
  onTimelineSelect,
  onTimelinePrevious,
  onTimelineNext,
  onTimelinePlay,
  onTimelinePause,
  mapContent,
  roadMetrics,
  crowdMetrics,
  roamingMetrics,
  aiDecisionContent,
  routeAdviceContent,
  multilingualContent,
  whatifContent,
  injectionContent,
  recommendationContent,
  overlayContent,
}: CommandCenterShellProps): ReactNode {
  const [activeNav, setActiveNav] = useState('dashboard');
  const [injectionOpen, setInjectionOpen] = useState(false);

  const handleNavigate = useCallback((id: string) => {
    setActiveNav(id);
    // Scroll to section - handled via CSS scroll-behavior or JS
    const el = document.getElementById(`section-${id}`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, []);

  const handleInjectClick = useCallback(() => {
    setInjectionOpen(true);
  }, []);

  const handleInjectClose = useCallback(() => {
    setInjectionOpen(false);
  }, []);

  return (
    <div className="cmd-shell">
      <CommandHeader
        connectionMode={connectionMode}
        pollingErrorMessage={pollingErrorMessage}
        pollingUpdateCount={pollingUpdateCount}
        onInjectClick={handleInjectClick}
      />

      <div className="cmd-body">
        <NavSidebar activeId={activeNav} onNavigate={handleNavigate} />

        <main className="cmd-main" role="main">
          {/* Section: Dashboard */}
          <section id="section-dashboard" className="cmd-section cmd-section--map" aria-label="交通地圖">
            <div className="cmd-section__map-area">
              {mapContent}
            </div>
          </section>

          {/* Section: Timeline */}
          <section id="section-timeline" className="cmd-section cmd-section--timeline" aria-label="時間軸">
            <TimelineBar
              timestamps={timelineTimestamps}
              currentIndex={timelineIndex}
              isPlaying={timelinePlaying}
              loading={timelineLoading}
              onSelect={onTimelineSelect}
              onPrevious={onTimelinePrevious}
              onNext={onTimelineNext}
              onPlay={onTimelinePlay}
              onPause={onTimelinePause}
            />
          </section>

          {/* Section: Metrics */}
          <section id="section-traffic" className="cmd-section cmd-section--metrics" aria-label="交通指標">
            <MetricCharts
              roads={roadMetrics}
              crowd={crowdMetrics}
              roaming={roamingMetrics}
            />
          </section>
        </main>

        {/* Right: AI Decision Column */}
        <aside className="cmd-ai-column" aria-label="AI 決策面板">
          <div className="cmd-ai-column__content">
            <div id="section-ai" className="cmd-ai-column__section">
              {aiDecisionContent}
            </div>
            <div className="cmd-ai-column__section">
              {routeAdviceContent}
            </div>
            {recommendationContent && (
              <div className="cmd-ai-column__section">
                {recommendationContent}
              </div>
            )}
            <div className="cmd-ai-column__section">
              {multilingualContent}
            </div>
            <div id="section-whatif" className="cmd-ai-column__section">
              <WhatIfCard content={whatifContent} />
            </div>
          </div>
        </aside>
      </div>

      {/* Overlay Content (e.g. Anomaly Demo Popup) */}
      {overlayContent}

      {/* Injection Modal */}
      <InjectionModal
        isOpen={injectionOpen}
        onClose={handleInjectClose}
        content={injectionContent}
      />
    </div>
  );
}
