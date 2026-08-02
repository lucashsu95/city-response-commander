/**
 * Demo Decision Panel
 *
 * Renders the latest `/demo/incidents` response the Demo API Adapter cached
 * after an admin pressed "Inject" in the public demo. This panel is only
 * mounted when the dashboard is in `VITE_API_MODE=demo`.
 *
 * @module frontend/demo/demo_decision_panel
 */

import { useCallback, useMemo, useState, type ReactNode } from 'react';
import type { AdminToken } from '../auth/admin_session.js';
import type { DemoApiClient, DemoDecisionView } from '../api/demo_api_adapter.js';
import {
  DEMO_INCIDENT_PRESETS,
  formatPresetJson,
  type DemoIncidentPreset,
} from './demo_incident_presets.js';

export interface DemoDecisionPanelProps {
  readonly adapter: DemoApiClient;
  readonly injectedEventId: string | null;
  readonly adminToken: AdminToken;
  readonly onDecisionInjected: (decision: DemoDecisionView) => void;
}

type InjectOutcome =
  | { readonly kind: 'idle' }
  | { readonly kind: 'in_flight' }
  | { readonly kind: 'ok'; readonly view: DemoDecisionView }
  | { readonly kind: 'error'; readonly message: string };

export function DemoDecisionPanel({
  adapter,
  injectedEventId,
  adminToken,
  onDecisionInjected,
}: DemoDecisionPanelProps): ReactNode {
  const defaultPreset = DEMO_INCIDENT_PRESETS[0];
  const [eventIdInput, setEventIdInput] = useState<string>(
    injectedEventId ?? defaultPreset.eventId,
  );
  const [payloadJson, setPayloadJson] = useState<string>(formatPresetJson(defaultPreset));
  const [outcome, setOutcome] = useState<InjectOutcome>({ kind: 'idle' });

  const applyPreset = useCallback((preset: DemoIncidentPreset) => {
    setEventIdInput(preset.eventId);
    setPayloadJson(formatPresetJson(preset));
    setOutcome({ kind: 'idle' });
  }, []);

  const onInject = useCallback(async () => {
    const trimmed = eventIdInput.trim();
    if (trimmed === '') {
      setOutcome({ kind: 'error', message: '請輸入事件 ID' });
      return;
    }
    const header =
      adminToken !== null && adminToken.trim() !== ''
        ? `Bearer ${adminToken.trim()}`
        : undefined;
    setOutcome({ kind: 'in_flight' });
    const result = await adapter.postInject(trimmed, {
      ...(header !== undefined ? { authorizationHeader: header } : {}),
    });
    if (!result.ok) {
      setOutcome({ kind: 'error', message: `注入失敗：${result.error.message}` });
      return;
    }
    const view = adapter.getDemoDecisionView(trimmed);
    if (view === null) {
      setOutcome({ kind: 'error', message: 'demo 後端未回傳 decision' });
      return;
    }
    setOutcome({ kind: 'ok', view });
    onDecisionInjected(view);
  }, [adapter, adminToken, eventIdInput, onDecisionInjected]);

  const lastView: DemoDecisionView | null = useMemo(() => {
    if (outcome.kind === 'ok') return outcome.view;
    if (injectedEventId !== null) {
      return adapter.getDemoDecisionView(injectedEventId);
    }
    return null;
  }, [adapter, injectedEventId, outcome]);

  return (
    <div className="demo-decision-panel" data-testid="demo-decision-panel">
      <h3 className="demo-decision-panel__title">事件注入（Demo Mode）</h3>
      <p className="demo-decision-panel__hint">
        POST /demo/incidents：選擇官方事件快捷鍵或編輯 Payload，一鍵注入決策流程。
      </p>

      <div className="demo-decision-panel__shortcuts" role="group" aria-label="官方事件快捷鍵">
        {DEMO_INCIDENT_PRESETS.map((preset) => (
          <button
            key={preset.eventId}
            type="button"
            className={`demo-decision-panel__shortcut${
              eventIdInput === preset.eventId ? ' demo-decision-panel__shortcut--active' : ''
            }`}
            onClick={() => applyPreset(preset)}
            data-testid={`demo-preset-${preset.eventId}`}
          >
            {preset.label}
          </button>
        ))}
      </div>

      <div className="demo-decision-panel__form">
        <label htmlFor="demo-decision-event-id">事件 ID（event_id）</label>
        <input
          id="demo-decision-event-id"
          type="text"
          value={eventIdInput}
          onChange={(e) => setEventIdInput(e.target.value)}
          placeholder="TPE_2026_ACC_001"
          aria-label="demo 事件 ID"
        />

        <label htmlFor="demo-decision-payload-json">Payload JSON（展示 / 複製用）</label>
        <textarea
          id="demo-decision-payload-json"
          className="demo-decision-panel__payload"
          value={payloadJson}
          onChange={(e) => setPayloadJson(e.target.value)}
          rows={8}
          spellCheck={false}
          aria-label="事件 Payload JSON"
        />

        <button type="button" onClick={onInject} disabled={outcome.kind === 'in_flight'}>
          {outcome.kind === 'in_flight' ? '注入中…' : '注入事件'}
        </button>
      </div>

      {outcome.kind === 'error' && (
        <p className="demo-decision-panel__error" role="alert">
          {outcome.message}
        </p>
      )}

      {lastView !== null ? (
        <DemoDecisionSummary view={lastView} />
      ) : (
        <p className="demo-decision-panel__empty">尚未注入事件。</p>
      )}
    </div>
  );
}

interface DemoDecisionSummaryProps {
  readonly view: DemoDecisionView;
}

function DemoDecisionSummary({ view }: DemoDecisionSummaryProps): ReactNode {
  const sopListText = view.triggeredArticles.length === 0 ? '（無）' : view.triggeredArticles.join('、');
  return (
    <dl className="demo-decision-summary" data-testid="demo-decision-summary">
      <dt>decision_id</dt>
      <dd>{view.decisionId}</dd>
      <dt>event_id</dt>
      <dd>{view.eventId}</dd>
      <dt>incident_type</dt>
      <dd>{view.incidentType}</dd>
      <dt>severity</dt>
      <dd>{view.severity}</dd>
      <dt>triggered_articles</dt>
      <dd data-testid="triggered-articles">{sopListText}</dd>
      <dt>invoked_procedures</dt>
      <dd>{view.invokedProcedures.join('、')}</dd>
      <dt>primary_evacuation</dt>
      <dd data-testid="primary-evacuation">{view.primaryEvacuation}</dd>
      <dt>secondary_evacuation</dt>
      <dd data-testid="secondary-evacuation">{view.secondaryEvacuation.join('、')}</dd>
      <dt>ete_minutes</dt>
      <dd data-testid="ete-minutes">{view.eteMinutes}</dd>
      <dt>cms_core_text</dt>
      <dd>{view.cmsCoreText}</dd>
      <dt>data_status</dt>
      <dd>{view.dataStatus}</dd>
      <dt>text_source</dt>
      <dd>{view.textSource}</dd>
    </dl>
  );
}
