/**
 * Operational Status Display Components (§16.4)
 *
 * Displays backend-provided operational flags.
 * Does not calculate staleness, provisional status, or confirmation requirements.
 *
 * @module frontend/components/system/operational_status
 */

import type { ReactNode } from 'react';
import type { OperationalStatus, ConnectionMode } from '../../state/app_state.js';

// ─── Freshness Indicator ───────────────────────────────────

export interface FreshnessIndicatorProps {
  /** Backend-provided stale flag */
  readonly isStale: boolean;
  /** Backend-provided staleness duration in minutes */
  readonly stalenessMinutes?: number | null;
}

/**
 * Displays data freshness status.
 * Values are display-only; staleness is not calculated from timestamps.
 */
export function FreshnessIndicator({
  isStale,
  stalenessMinutes,
}: FreshnessIndicatorProps): ReactNode {
  if (!isStale) {
    return (
      <span className="status-indicator status-indicator--fresh" role="status">
        <span className="status-indicator__dot" aria-hidden="true" />
        <span className="status-indicator__text">資料為最新</span>
      </span>
    );
  }

  const staleText =
    stalenessMinutes !== null && stalenessMinutes !== undefined
      ? `資料已過時 ${stalenessMinutes} 分鐘`
      : '資料已過時';

  return (
    <span
      className="status-indicator status-indicator--stale"
      role="status"
      aria-live="polite"
    >
      <span className="status-indicator__dot" aria-hidden="true" />
      <span className="status-indicator__text">{staleText}</span>
    </span>
  );
}

// ─── Connection Mode Indicator ─────────────────────────────

export interface ConnectionModeIndicatorProps {
  /** Current connection mode reported by the realtime transport (§16.4) */
  readonly mode: ConnectionMode;
}

/**
 * Mode wording required by §13/§16.4.
 *
 * `polling` uses the specified degraded wording so the operator can never
 * mistake fallback reads for a live push connection.
 */
const CONNECTION_MODE_LABELS: Record<ConnectionMode, string> = {
  websocket: '即時連線（WebSocket）',
  polling: '即時連線降級為輪詢',
  disconnected: '已斷線',
};

/**
 * Text glyph per mode so the state never depends on colour alone.
 */
const CONNECTION_MODE_GLYPHS: Record<ConnectionMode, string> = {
  websocket: '⇄',
  polling: '⟳',
  disconnected: '⛔',
};

/**
 * Displays current connection mode.
 */
export function ConnectionModeIndicator({ mode }: ConnectionModeIndicatorProps): ReactNode {
  const isDegraded = mode !== 'websocket';
  const className = isDegraded
    ? 'status-indicator status-indicator--degraded'
    : 'status-indicator status-indicator--connected';

  return (
    <span
      className={className}
      role="status"
      aria-live={isDegraded ? 'polite' : 'off'}
      data-connection-mode={mode}
    >
      <span className="status-indicator__dot" aria-hidden="true" />
      <span className="status-indicator__icon" aria-hidden="true">
        {CONNECTION_MODE_GLYPHS[mode]}
      </span>
      <span className="status-indicator__text">{CONNECTION_MODE_LABELS[mode]}</span>
    </span>
  );
}

// ─── Polling Degradation Detail ────────────────────────────

export interface PollingDegradationNoticeProps {
  /** Current connection mode; the notice renders only while polling. */
  readonly mode: ConnectionMode;
  /**
   * Route-level polling failure text from the realtime transport.
   * Sanitized upstream: no stack traces, headers, or credentials.
   */
  readonly pollingErrorMessage?: string | null;
  /** Polling cycles that refreshed at least one canonical read target. */
  readonly pollingUpdateCount?: number;
}

/**
 * Supplements the degraded badge while polling.
 *
 * When polling itself is failing this renders an error, so the UI never claims
 * that data is still being refreshed.
 */
export function PollingDegradationNotice({
  mode,
  pollingErrorMessage = null,
  pollingUpdateCount = 0,
}: PollingDegradationNoticeProps): ReactNode {
  if (mode !== 'polling') {
    return null;
  }

  if (pollingErrorMessage !== null && pollingErrorMessage !== '') {
    return (
      <span
        className="status-indicator status-indicator--polling-error"
        role="alert"
        aria-live="assertive"
      >
        <span className="status-indicator__icon" aria-hidden="true">
          ⚠
        </span>
        <span className="status-indicator__text">輪詢更新失敗：{pollingErrorMessage}</span>
      </span>
    );
  }

  return (
    <span className="status-indicator status-indicator--polling-ok" role="status" aria-live="polite">
      <span className="status-indicator__text">已完成 {pollingUpdateCount} 次輪詢更新</span>
    </span>
  );
}

// ─── Provisional Policy Indicator ──────────────────────────

export interface ProvisionalPolicyIndicatorProps {
  /** Backend-provided provisional flag */
  readonly isProvisional: boolean;
}

/**
 * Displays provisional policy status.
 * Value is display-only; frontend does not infer provisional status.
 */
export function ProvisionalPolicyIndicator({
  isProvisional,
}: ProvisionalPolicyIndicatorProps): ReactNode {
  if (!isProvisional) {
    return null;
  }

  return (
    <span
      className="status-indicator status-indicator--provisional"
      role="status"
      aria-live="polite"
    >
      <span className="status-indicator__icon" aria-hidden="true">
        ⚙
      </span>
      <span className="status-indicator__text">暫定政策</span>
    </span>
  );
}

// ─── Manual Confirmation Indicator ─────────────────────────

export interface ManualConfirmationIndicatorProps {
  /** Backend-provided manual confirmation flag */
  readonly required: boolean;
}

/**
 * Displays manual confirmation requirement.
 * Value is display-only; frontend does not infer confirmation requirement.
 */
export function ManualConfirmationIndicator({
  required,
}: ManualConfirmationIndicatorProps): ReactNode {
  if (!required) {
    return null;
  }

  return (
    <span
      className="status-indicator status-indicator--confirmation"
      role="alert"
      aria-live="assertive"
    >
      <span className="status-indicator__icon" aria-hidden="true">
        ⚡
      </span>
      <span className="status-indicator__text">需人工確認</span>
    </span>
  );
}

// ─── Combined Status Bar ───────────────────────────────────

export interface OperationalStatusBarProps {
  /** Full operational status from backend/system */
  readonly status: OperationalStatus;
  /** Current polling failure text, when the fallback loop is failing */
  readonly pollingErrorMessage?: string | null;
  /** Polling cycles that refreshed at least one canonical read target */
  readonly pollingUpdateCount?: number;
}

/**
 * Combined display of all operational status indicators.
 */
export function OperationalStatusBar({
  status,
  pollingErrorMessage = null,
  pollingUpdateCount = 0,
}: OperationalStatusBarProps): ReactNode {
  return (
    <div className="operational-status-bar" role="region" aria-label="系統狀態">
      <FreshnessIndicator isStale={status.isStale} stalenessMinutes={status.stalenessMinutes} />
      <ConnectionModeIndicator mode={status.connectionMode} />
      <PollingDegradationNotice
        mode={status.connectionMode}
        pollingErrorMessage={pollingErrorMessage}
        pollingUpdateCount={pollingUpdateCount}
      />
      <ProvisionalPolicyIndicator isProvisional={status.isProvisionalPolicy} />
      <ManualConfirmationIndicator required={status.manualConfirmationRequired} />
    </div>
  );
}
