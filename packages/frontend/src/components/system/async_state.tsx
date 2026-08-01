/**
 * Async State Display Components
 *
 * Renders loading, empty, error, and insufficient-data states.
 * No fake data or placeholder text.
 *
 * @module frontend/components/system/async_state
 */

import type { ReactNode } from 'react';
import type { AsyncStatus } from '../../state/app_state.js';
import { CometSpinner } from '../loading/comet_spinner.js';
import { useI18n } from '../../i18n/index.js';

// ─── Loading State ─────────────────────────────────────────

export interface LoadingIndicatorProps {
  /** Accessible label for the loading state */
  readonly label?: string;
}

/**
 * Loading indicator with accessible labeling.
 */
export function LoadingIndicator({ label }: LoadingIndicatorProps): ReactNode {
  const { t } = useI18n();
  const resolvedLabel = label ?? t('async.loading');

  return (
    <div className="async-state async-state--loading">
      <CometSpinner label={resolvedLabel} />
    </div>
  );
}

// ─── Empty State ───────────────────────────────────────────

export interface EmptyStateProps {
  /** Message explaining the empty state */
  readonly message: string;
}

/**
 * Empty state display with professional messaging.
 */
export function EmptyState({ message }: EmptyStateProps): ReactNode {
  return (
    <div className="async-state async-state--empty" role="status">
      <span className="async-state__text">{message}</span>
    </div>
  );
}

// ─── Error State ───────────────────────────────────────────

export interface ErrorStateProps {
  /** Error message to display */
  readonly message: string;
}

/**
 * Error state display with accessible announcement.
 */
export function ErrorState({ message }: ErrorStateProps): ReactNode {
  return (
    <div className="async-state async-state--error" role="alert" aria-live="assertive">
      <span className="async-state__icon" aria-hidden="true">
        ⚠
      </span>
      <span className="async-state__text">{message}</span>
    </div>
  );
}

// ─── Insufficient Data State ───────────────────────────────

export interface InsufficientDataStateProps {
  /** Message explaining what data is missing */
  readonly message?: string;
}

/**
 * Insufficient data state display.
 */
export function InsufficientDataState({
  message = '資料不足，無法完整顯示',
}: InsufficientDataStateProps): ReactNode {
  return (
    <div className="async-state async-state--insufficient" role="status">
      <span className="async-state__text">{message}</span>
    </div>
  );
}

// ─── Async State Wrapper ───────────────────────────────────

export interface AsyncStateWrapperProps<T> {
  /** Current async status */
  readonly status: AsyncStatus;
  /** Data when ready */
  readonly data: T | null;
  /** Error message when in error state */
  readonly errorMessage: string | null;
  /** Empty state message */
  readonly emptyMessage: string;
  /** Render function for ready state */
  readonly children: (data: T) => ReactNode;
}

/**
 * Generic wrapper that renders appropriate state component.
 */
export function AsyncStateWrapper<T>({
  status,
  data,
  errorMessage,
  emptyMessage,
  children,
}: AsyncStateWrapperProps<T>): ReactNode {
  switch (status) {
    case 'idle':
      return null;

    case 'loading':
      return <LoadingIndicator />;

    case 'ready':
      return data !== null ? children(data) : <EmptyState message={emptyMessage} />;

    case 'empty':
      return <EmptyState message={emptyMessage} />;

    case 'error':
      return <ErrorState message={errorMessage ?? '發生未知錯誤'} />;

    case 'insufficient_data':
      return <InsufficientDataState />;
  }
}
