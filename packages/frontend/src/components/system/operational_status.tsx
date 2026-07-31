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
  /** Current connection mode (backend/system-provided) */
  readonly mode: ConnectionMode;
}

const CONNECTION_MODE_LABELS: Record<ConnectionMode, string> = {
  websocket: '即時連線',
  polling: '輪詢模式',
  disconnected: '已斷線',
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
    <span className={className} role="status" aria-live={isDegraded ? 'polite' : 'off'}>
      <span className="status-indicator__dot" aria-hidden="true" />
      <span className="status-indicator__text">{CONNECTION_MODE_LABELS[mode]}</span>
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
}

/**
 * Combined display of all operational status indicators.
 */
export function OperationalStatusBar({ status }: OperationalStatusBarProps): ReactNode {
  return (
    <div className="operational-status-bar" role="region" aria-label="系統狀態">
      <FreshnessIndicator isStale={status.isStale} stalenessMinutes={status.stalenessMinutes} />
      <ConnectionModeIndicator mode={status.connectionMode} />
      <ProvisionalPolicyIndicator isProvisional={status.isProvisionalPolicy} />
      <ManualConfirmationIndicator required={status.manualConfirmationRequired} />
    </div>
  );
}
