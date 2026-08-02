/**
 * Anomaly Demo Popup
 *
 * Auto-display popup for anomalies detected from `GET /demo/timeseries`.
 * Shows type, severity, observed value, threshold, SOP article, summary, and timestamp.
 * Uses `role="alertdialog"` for accessibility.
 *
 * @module frontend/alerts/anomaly_demo_popup
 */

import { useEffect, useRef, type ReactNode } from 'react';
import type { DemoAnomalyPresentation } from './use_anomaly_popup_demo.js';

const TITLE_ID = 'anomaly-demo-popup-title';
const DESC_ID = 'anomaly-demo-popup-description';

const SEVERITY_COLORS: Readonly<Record<string, string>> = {
  high: '#dc2626',
  medium: '#f97316',
};

const SOP_LABEL: Readonly<Record<number, string>> = {
  1: 'SOP 第 1 條（路段饱和度分级）',
  3: 'SOP 第 3 條（BL17 人流突增）',
  4: 'SOP 第 4 條（DOM-E 人流消散）',
  6: 'SOP 第 6 條（漫遊比例達標）',
};

export interface AnomalyDemoPopupProps {
  readonly anomaly: DemoAnomalyPresentation | null;
  readonly isOpen: boolean;
  readonly onDismiss: () => void;
}

export function AnomalyDemoPopup({
  anomaly,
  isOpen,
  onDismiss,
}: AnomalyDemoPopupProps): ReactNode {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  const visible = isOpen && anomaly !== null;

  useEffect(() => {
    if (!visible) return;
    const prev = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    restoreRef.current = prev;
    closeRef.current?.focus();
    return () => {
      const target = restoreRef.current;
      restoreRef.current = null;
      if (target !== null && document.contains(target)) {
        target.focus();
      }
    };
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [visible, onDismiss]);

  if (!visible || anomaly === null) return null;

  const severityColor = SEVERITY_COLORS[anomaly.severity] ?? '#64748b';
  const sopLabel = anomaly.triggeredArticle !== null
    ? (SOP_LABEL[anomaly.triggeredArticle] ?? `SOP 第 ${anomaly.triggeredArticle} 條`)
    : null;
  const unit = anomaly.unit ?? '';

  return (
    <div className="anomaly-demo-popup__backdrop" data-testid="anomaly-demo-popup-backdrop">
      <div
        className="anomaly-demo-popup"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={TITLE_ID}
        aria-describedby={DESC_ID}
        data-testid="anomaly-demo-popup"
        data-anomaly-id={anomaly.id}
      >
        <h2 id={TITLE_ID} className="anomaly-demo-popup__title">
          偵測到異常
        </h2>

        <p id={DESC_ID} className="anomaly-demo-popup__summary">
          {anomaly.summary ?? '後端偵測到異常事件'}
        </p>

        <dl className="anomaly-demo-popup__details">
          <div className="anomaly-demo-popup__detail">
            <dt>類型</dt>
            <dd data-testid="anomaly-demo-type">{anomaly.type}</dd>
          </div>
          <div className="anomaly-demo-popup__detail">
            <dt>嚴重度</dt>
            <dd
              data-testid="anomaly-demo-severity"
              style={{ color: severityColor, fontWeight: 700 }}
            >
              {anomaly.severity.toUpperCase()}
            </dd>
          </div>
          <div className="anomaly-demo-popup__detail">
            <dt>觀測值</dt>
            <dd data-testid="anomaly-demo-value">
              {anomaly.observedValue !== null ? `${anomaly.observedValue} ${unit}` : '後端未提供'}
            </dd>
          </div>
          <div className="anomaly-demo-popup__detail">
            <dt>門檻</dt>
            <dd data-testid="anomaly-demo-threshold">
              {anomaly.threshold !== null ? `${anomaly.threshold} ${unit}` : '後端未提供'}
            </dd>
          </div>
          {sopLabel !== null && (
            <div className="anomaly-demo-popup__detail">
              <dt>SOP 條款</dt>
              <dd data-testid="anomaly-demo-article">{sopLabel}</dd>
            </div>
          )}
          {anomaly.entityId !== null && (
            <div className="anomaly-demo-popup__detail">
              <dt>對象</dt>
              <dd data-testid="anomaly-demo-entity">{anomaly.entityId}</dd>
            </div>
          )}
          {anomaly.timestamp !== null && (
            <div className="anomaly-demo-popup__detail">
              <dt>時間戳</dt>
              <dd data-testid="anomaly-demo-timestamp">{anomaly.timestamp}</dd>
            </div>
          )}
          <div className="anomaly-demo-popup__detail">
            <dt>來源</dt>
            <dd data-testid="anomaly-demo-source">
              {anomaly.source === 'traffic' ? '交通路段輪詢' : '人流基地台輪詢'}
            </dd>
          </div>
        </dl>

        <div className="anomaly-demo-popup__actions">
          <button
            type="button"
            ref={closeRef}
            className="anomaly-demo-popup__close"
            onClick={onDismiss}
            data-testid="anomaly-demo-popup-close"
          >
            關閉
          </button>
        </div>
      </div>
    </div>
  );
}
