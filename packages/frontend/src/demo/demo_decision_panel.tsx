/**
 * Demo Decision Panel
 *
 * Renders the latest `/demo/incidents` response the Demo API Adapter cached
 * after an admin pressed "Inject" in the public demo. This panel is only
 * mounted when the dashboard is in `VITE_API_MODE=demo` — production mode
 * keeps the original `ReportPanel` + `AlertPanel` + `RoutePanel` + `EtePanel`
 * + `ExplanationChain` + `ExecutionStatusPanel` set driven by the canonical
 * `useDecisionReadModel`.
 *
 * The panel reads from the adapter's `DemoDecisionView`, which mirrors the
 * fields the demo backend actually returns (never inventing any). When the
 * adapter has no cached decision it renders an explicit empty state instead
 * of fabricating one.
 *
 * Publish is intentionally not wired: `Module 5` is disabled in the demo path
 * because the deployment stack has no `POST /decisions/{id}/publish` route.
 *
 * @module frontend/demo/demo_decision_panel
 */

import { useCallback, useMemo, useState, type ReactNode } from 'react';
import type { AdminToken } from '../auth/admin_session.js';
import type { DemoApiClient, DemoDecisionView } from '../api/demo_api_adapter.js';

export interface DemoDecisionPanelProps {
  readonly adapter: DemoApiClient;
  readonly injectedEventId: string | null;
  readonly adminToken: AdminToken;
  readonly onDecisionInjected: (decision: DemoDecisionView) => void;
}

const PUBLISH_DISABLED_REASON =
  '發布功能尚未接線：demo 後端沒有 POST /decisions/{id}/publish';

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
  const [eventIdInput, setEventIdInput] = useState<string>(injectedEventId ?? 'TPE_2026_ACC_001');
  const [outcome, setOutcome] = useState<InjectOutcome>({ kind: 'idle' });

  const onInject = useCallback(async () => {
    const trimmed = eventIdInput.trim();
    if (trimmed === '') {
      setOutcome({ kind: 'error', message: '請輸入事件 ID' });
      return;
    }
    // Demo mode never requires an admin JWT: the deploy's `/demo/incidents`
    // is the documented public test surface (per demo-mode strict
    // limitations). The token is still wired through unchanged so a
    // production deployment of this same adapter sets it later, but the
    // header is only attached when the token is non-blank.
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
        POST /demo/incidents：demo 後端不要求管理員 JWT，下方「發布」按鈕刻意停用，直到
        production stack 接線。
      </p>

      <div className="demo-decision-panel__form">
        <label htmlFor="demo-decision-event-id">事件 ID</label>
        <input
          id="demo-decision-event-id"
          type="text"
          value={eventIdInput}
          onChange={(e) => setEventIdInput(e.target.value)}
          placeholder="TPE_2026_ACC_001"
          aria-label="demo 事件 ID"
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

      <fieldset className="demo-decision-panel__publish" disabled>
        <legend>模組 5 發布（刻意停用）</legend>
        <button
          type="button"
          disabled
          aria-disabled="true"
          title={PUBLISH_DISABLED_REASON}
          data-testid="demo-publish-button"
        >
          發布警示
        </button>
        <p className="demo-decision-panel__publish-reason">{PUBLISH_DISABLED_REASON}</p>
      </fieldset>
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
