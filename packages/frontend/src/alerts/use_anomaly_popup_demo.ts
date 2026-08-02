/**
 * Demo Anomaly Auto-Popup Hook
 *
 * Monitors `GET /demo/timeseries` snapshots for new anomalies and surfaces them
 * as auto-popup dialogs without requiring user action.
 *
 * Dedup by `anomaly.id`: the same anomaly never opens the popup twice in the
 * same session. Each polling cycle compares incoming anomalies against a
 * Set of already-seen IDs.
 *
 * @module frontend/alerts/use_anomaly_popup_demo
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { DemoTimeseriesResponse } from '../api/demo_api_adapter.js';

// ─── Presentation Model ─────────────────────────────────────────

export interface DemoAnomalyPresentation {
  readonly id: string;
  readonly type: string;
  readonly severity: string;
  readonly source: string;
  readonly entityId: string | null;
  readonly observedValue: number | null;
  readonly threshold: number | null;
  readonly unit: string | null;
  readonly triggeredArticle: number | null;
  readonly summary: string | null;
  readonly timestamp: string | null;
}

// ─── Controller ────────────────────────────────────────────────

export interface DemoAnomalyPopupState {
  readonly current: DemoAnomalyPresentation | null;
  readonly isOpen: boolean;
}

export interface DemoAnomalyPopupController extends DemoAnomalyPopupState {
  /** Called with each new demo timeseries snapshot. Issues no HTTP request. */
  ingestSnapshot(snapshot: DemoTimeseriesResponse): void;
  /** Closes the popup without forgetting the identity. */
  dismiss(): void;
}

function toPresentation(raw: {
  readonly id: string;
  readonly type: string;
  readonly severity: string;
  readonly source: string;
  readonly station_id?: string;
  readonly segment_id?: string;
  readonly observed_value: number;
  readonly threshold: number;
  readonly unit: string;
  readonly triggered_article: number;
  readonly summary_zh: string;
  readonly detected_at: string;
}): DemoAnomalyPresentation {
  return {
    id: raw.id,
    type: raw.type,
    severity: raw.severity,
    source: raw.source,
    entityId: raw.station_id ?? raw.segment_id ?? null,
    observedValue: raw.observed_value,
    threshold: raw.threshold,
    unit: raw.unit,
    triggeredArticle: raw.triggered_article,
    summary: raw.summary_zh,
    timestamp: raw.detected_at,
  };
}

const CLOSED: DemoAnomalyPopupState = { current: null, isOpen: false };

/**
 * Creates the demo anomaly popup controller.
 *
 * Watches `GET /demo/timeseries` responses for new anomalies.
 * Uses `anomaly.id` for dedup. The popup fires exactly once per unique ID.
 */
export function useDemoAnomalyPopup(): DemoAnomalyPopupController {
  const [state, setState] = useState<DemoAnomalyPopupState>(CLOSED);
  const seenRef = useRef<Set<string>>(new Set<string>());
  const disposedRef = useRef(false);

  useEffect(() => {
    disposedRef.current = false;
    return () => {
      disposedRef.current = true;
    };
  }, []);

  const present = useCallback((anomaly: DemoAnomalyPresentation) => {
    if (disposedRef.current) return;
    if (seenRef.current.has(anomaly.id)) return;
    seenRef.current.add(anomaly.id);
    setState({ current: anomaly, isOpen: true });
  }, []);

  const ingestSnapshot = useCallback(
    (snapshot: DemoTimeseriesResponse) => {
      if (disposedRef.current) return;
      const anomalies = snapshot.anomalies;
      if (anomalies === undefined || anomalies === null) return;
      for (const raw of anomalies) {
        if (typeof raw !== 'object' || raw === null) continue;
        if (seenRef.current.has(raw.id)) continue;
        const presentation = toPresentation(
          raw as {
            readonly id: string;
            readonly type: string;
            readonly severity: string;
            readonly source: string;
            readonly station_id?: string;
            readonly segment_id?: string;
            readonly observed_value: number;
            readonly threshold: number;
            readonly unit: string;
            readonly triggered_article: number;
            readonly summary_zh: string;
            readonly detected_at: string;
          },
        );
        present(presentation);
        return; // Only one new anomaly per snapshot
      }
    },
    [present],
  );

  const dismiss = useCallback(() => {
    if (disposedRef.current) return;
    setState((prev) => (prev.isOpen ? { ...prev, isOpen: false } : prev));
  }, []);

  return {
    current: state.current,
    isOpen: state.isOpen,
    ingestSnapshot,
    dismiss,
  };
}
