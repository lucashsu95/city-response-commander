/**
 * Anomaly Popup (TASK-127)
 *
 * Presentation-only dialog for the anomaly auto-popup. It parses no transport,
 * issues no request, and derives no domain truth: it renders exactly what
 * `anomaly_model.ts` read from the backend, plus fixed UI framing.
 *
 * The framing strings are the only text this component contributes. They label
 * the situation and point the operator at the panels that already hold the
 * authoritative detail; they never state a cause, an SOP conclusion, a route,
 * an ETE, or a severity. When the backend supplied a `summary`, that text is
 * shown verbatim instead of the framing description.
 *
 * Accessibility (§16 operator-facing UI):
 * - `role="alertdialog"` with `aria-modal`, since the dialog appears on its own
 *   and carries an alert the operator did not request
 * - labelled by its heading and described by its body
 * - focus moves to the close control on open and returns to the previously
 *   focused element on close
 * - `Escape` closes
 * - every state is carried by text, never by colour alone
 *
 * @module frontend/alerts/anomaly_popup
 */

import { useEffect, useRef, type ReactNode } from 'react';
import { useI18n } from '../i18n/index.js';
import type { AnomalyPresentation, AnomalySource } from './anomaly_model.js';

const TITLE_ID = 'anomaly-popup-title';
const DESCRIPTION_ID = 'anomaly-popup-description';

/** Operator-facing label for each official channel. */
const SOURCE_LABELS: Readonly<Record<AnomalySource, string>> = {
  realtime: '即時推播（WebSocket）',
  roads: '路段輪詢（GET /roads）',
  crowd: '人流輪詢（GET /crowd）',
};

export interface AnomalyPopupProps {
  /** Anomaly to render. `null` renders nothing. */
  readonly anomaly: AnomalyPresentation | null;
  readonly isOpen: boolean;
  /** Invoked by the close control and by `Escape`. */
  readonly onDismiss: () => void;
}

interface DetailRowProps {
  readonly label: string;
  readonly value: string;
  readonly testId: string;
}

function DetailRow({ label, value, testId }: DetailRowProps): ReactNode {
  return (
    <div className="anomaly-popup__detail">
      <dt className="anomaly-popup__detail-label">{label}</dt>
      <dd className="anomaly-popup__detail-value" data-testid={testId}>
        {value}
      </dd>
    </div>
  );
}

/**
 * Renders the anomaly dialog.
 *
 * Returns `null` when closed, so no dialog node exists in the accessibility
 * tree while the dashboard is in its ordinary state.
 */
export function AnomalyPopup({ anomaly, isOpen, onDismiss }: AnomalyPopupProps): ReactNode {
  const { t } = useI18n();
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  const visible = isOpen && anomaly !== null;

  // Focus enters the dialog on open and returns to the previously focused
  // element on close. The restore target is re-checked against the live
  // document, so a control that unmounted meanwhile never gets focus.
  useEffect(() => {
    if (!visible) {
      return;
    }
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    restoreFocusRef.current = previouslyFocused;
    closeButtonRef.current?.focus();

    return () => {
      const target = restoreFocusRef.current;
      restoreFocusRef.current = null;
      if (target !== null && document.contains(target)) {
        target.focus();
      }
    };
  }, [visible]);

  useEffect(() => {
    if (!visible) {
      return;
    }
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.preventDefault();
        onDismiss();
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [visible, onDismiss]);

  if (!visible || anomaly === null) {
    return null;
  }

  const description = anomaly.summary ?? t('anomaly.framingDescription');

  return (
    <div className="anomaly-popup__backdrop" data-testid="anomaly-popup-backdrop">
      <div
        className="anomaly-popup"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={TITLE_ID}
        aria-describedby={DESCRIPTION_ID}
        data-testid="anomaly-popup"
        data-anomaly-identity={anomaly.identity}
        data-anomaly-source={anomaly.source}
      >
        <h2 id={TITLE_ID} className="anomaly-popup__title">
          {t('anomaly.framingTitle')}
        </h2>

        <p id={DESCRIPTION_ID} className="anomaly-popup__description" data-testid="anomaly-popup-description">
          {description}
        </p>

        {/* Backend staleness verdict. Rendered as text, never colour alone, and
            only when the backend actually said so. */}
        {anomaly.stale === true ? (
          <p className="anomaly-popup__badge anomaly-popup__badge--stale" data-testid="anomaly-popup-stale">
            資料陳舊（後端標記 stale）
          </p>
        ) : null}

        {anomaly.provisional === true ? (
          <p
            className="anomaly-popup__badge anomaly-popup__badge--provisional"
            data-testid="anomaly-popup-provisional"
          >
            暫定政策（provisional）
          </p>
        ) : null}

        <dl className="anomaly-popup__details">
          <DetailRow label="來源" value={SOURCE_LABELS[anomaly.source]} testId="anomaly-popup-source" />
          {anomaly.category !== null ? (
            <DetailRow label="分類" value={anomaly.category} testId="anomaly-popup-category" />
          ) : null}
          {anomaly.entityId !== null ? (
            <DetailRow label="對象" value={anomaly.entityId} testId="anomaly-popup-entity" />
          ) : null}
          {anomaly.observedAt !== null ? (
            <DetailRow label="觀測時間" value={anomaly.observedAt} testId="anomaly-popup-observed-at" />
          ) : null}
          {anomaly.dataStatus !== null ? (
            <DetailRow label="資料狀態" value={anomaly.dataStatus} testId="anomaly-popup-data-status" />
          ) : null}
          {anomaly.thresholdLabel !== null ? (
            <DetailRow
              label="後端門檻說明"
              value={anomaly.thresholdLabel}
              testId="anomaly-popup-threshold"
            />
          ) : null}
          {anomaly.valueLabel !== null ? (
            <DetailRow label="後端觀測值" value={anomaly.valueLabel} testId="anomaly-popup-value" />
          ) : null}
          {anomaly.serverSignals.length > 0 ? (
            <DetailRow
              label="後端訊號"
              value={anomaly.serverSignals.join('、')}
              testId="anomaly-popup-signals"
            />
          ) : null}
        </dl>

        <div className="anomaly-popup__actions">
          <button
            type="button"
            ref={closeButtonRef}
            className="anomaly-popup__close"
            onClick={onDismiss}
            data-testid="anomaly-popup-close"
          >
            {t('anomaly.close')}
          </button>
        </div>
      </div>
    </div>
  );
}
