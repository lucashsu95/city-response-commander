/**
 * Roaming threshold alert modal — SOP Article 6 (≥ 30%).
 *
 * Surfaces multilingual emergency broadcast content in a high-priority
 * full-screen dialog during timeline playback, instead of hiding it in
 * the side panel alone.
 *
 * @module frontend/alerts/roaming_alert_modal
 */

import { useEffect, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { formatRatioAsPercent } from '../utils/percentage.js';

export interface RoamingAlertContent {
  readonly stationId: string;
  readonly locationName: string;
  readonly roamingPct: number;
  readonly timestamp: string | null;
  readonly texts: Readonly<{
    readonly zh: string;
    readonly en: string;
    readonly ja: string;
    readonly ko: string;
  }>;
}

export interface RoamingAlertModalProps {
  readonly alert: RoamingAlertContent | null;
  readonly isOpen: boolean;
  readonly publishing?: boolean;
  readonly onDismiss: () => void;
  readonly onConfirmPublish: () => void;
}

const TITLE_ID = 'roaming-alert-modal-title';

export function RoamingAlertModal({
  alert,
  isOpen,
  publishing = false,
  onDismiss,
  onConfirmPublish,
}: RoamingAlertModalProps): ReactNode {
  const confirmRef = useRef<HTMLButtonElement | null>(null);

  const visible = isOpen && alert !== null;

  useEffect(() => {
    if (!visible) return;
    document.body.style.overflow = 'hidden';
    confirmRef.current?.focus();
    return () => {
      document.body.style.overflow = '';
    };
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onDismiss();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [visible, onDismiss]);

  if (!visible || alert === null || typeof document === 'undefined') {
    return null;
  }

  return createPortal(
    <div
      className="roaming-alert-modal__backdrop"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby={TITLE_ID}
      data-testid="roaming-alert-modal"
    >
      <section className="roaming-alert-modal">
        <header className="roaming-alert-modal__header">
          <span className="roaming-alert-modal__badge" aria-hidden="true">
            SOP 第 6 條
          </span>
          <h2 id={TITLE_ID} className="roaming-alert-modal__title">
            漫遊比例達標 — 多語緊急通報
          </h2>
          <p className="roaming-alert-modal__summary">
            偵測到 <strong>{alert.locationName || alert.stationId}</strong> 漫遊比例{' '}
            <strong>{formatRatioAsPercent(alert.roamingPct)}</strong>，已達 30% 通報門檻。
            {alert.timestamp !== null ? `（時點 ${alert.timestamp}）` : null}
          </p>
        </header>

        <div className="roaming-alert-modal__body">
          <h3 className="roaming-alert-modal__section-title">多語緊急通報預覽</h3>
          <dl className="roaming-alert-modal__messages">
            <div>
              <dt>中文</dt>
              <dd>{alert.texts.zh}</dd>
            </div>
            <div>
              <dt>English</dt>
              <dd>{alert.texts.en}</dd>
            </div>
            <div>
              <dt>日本語</dt>
              <dd>{alert.texts.ja}</dd>
            </div>
            <div>
              <dt>한국어</dt>
              <dd>{alert.texts.ko}</dd>
            </div>
          </dl>

          <p className="roaming-alert-modal__advice">
            建議處置：立即啟動 SMS / CMS 多語廣播，並同步更新路線疏導與現場指揮指示。
          </p>
        </div>

        <footer className="roaming-alert-modal__actions">
          <button
            type="button"
            ref={confirmRef}
            className="roaming-alert-modal__publish"
            onClick={onConfirmPublish}
            disabled={publishing}
            data-testid="roaming-alert-publish"
          >
            {publishing ? '發布中…' : '確認 / 發布通報'}
          </button>
          <button
            type="button"
            className="roaming-alert-modal__dismiss"
            onClick={onDismiss}
            disabled={publishing}
            data-testid="roaming-alert-dismiss"
          >
            稍後處理
          </button>
        </footer>
      </section>
    </div>,
    document.body,
  );
}
