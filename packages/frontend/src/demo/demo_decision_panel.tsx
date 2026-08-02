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
 * Module 5 publish (§10.11d, R11.6): the "發布警示" button is wired to
 * `DemoApiClient.publishDecision()`, which calls `POST /decisions/{id}/publish`
 * on the demo backend. The two-stage confirmation flow (preview → confirm) mirrors
 * the pattern in `multilingual_card_demo.tsx`. The publish action is disabled
 * until a decision has been injected (no `lastView`).
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

type InjectOutcome =
  | { readonly kind: 'idle' }
  | { readonly kind: 'in_flight' }
  | { readonly kind: 'ok'; readonly view: DemoDecisionView }
  | { readonly kind: 'error'; readonly message: string };

type PublishStage = 'idle' | 'preview' | 'confirming' | 'success' | 'error';

interface PublishResult {
  readonly publishState: string;
  readonly channels: readonly string[];
  readonly languages: readonly string[];
  readonly publishedAt: string;
  readonly approvedBy: string;
  readonly deliveryMode: string;
}

export function DemoDecisionPanel({
  adapter,
  injectedEventId,
  adminToken,
  onDecisionInjected,
}: DemoDecisionPanelProps): ReactNode {
  const [eventIdInput, setEventIdInput] = useState<string>(injectedEventId ?? 'TPE_2026_ACC_001');
  const [outcome, setOutcome] = useState<InjectOutcome>({ kind: 'idle' });
  const [publishStage, setPublishStage] = useState<PublishStage>('idle');
  const [publishResult, setPublishResult] = useState<PublishResult | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);

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

  // ── Module 5 Publish (§10.11d, R11.6) ──────────────────────────────────

  const handlePublishClick = useCallback(() => {
    setPublishStage('preview');
    setPublishError(null);
  }, []);

  const handleConfirmPublish = useCallback(async () => {
    if (lastView === null) return;
    setPublishStage('confirming');
    setPublishError(null);

    const languages =
      lastView.publicAlerts?.languages !== undefined && lastView.publicAlerts.languages.length > 0
        ? lastView.publicAlerts.languages
        : ['zh', 'en'];

    const result = await adapter.publishDecision(
      lastView.decisionId,
      ['sms', 'cms'],
      'demo-commander',
      languages,
    );

    if (!result.ok) {
      setPublishError(result.error.message);
      setPublishStage('preview');
      return;
    }

    const body = result.data.body as Record<string, unknown>;
    setPublishResult({
      publishState: String(body.publish_state ?? 'unknown'),
      channels: Array.isArray(body.channels) ? (body.channels as readonly string[]) : [],
      languages: Array.isArray(body.languages) ? (body.languages as readonly string[]) : [],
      publishedAt: String(body.published_at ?? new Date().toISOString()),
      approvedBy: String(body.approved_by ?? 'demo-commander'),
      deliveryMode: String(body.delivery_mode ?? 'unknown'),
    });
    setPublishStage('success');
  }, [adapter, lastView]);

  const handleDismissPublish = useCallback(() => {
    setPublishStage('idle');
    setPublishResult(null);
    setPublishError(null);
  }, []);

  const publishDisabled = lastView === null;

  return (
    <div className="demo-decision-panel" data-testid="demo-decision-panel">
      <h3 className="demo-decision-panel__title">事件注入（Demo Mode）</h3>
      <p className="demo-decision-panel__hint">
        POST /demo/incidents：demo 後端不要求管理員 JWT。注入事件後，可透過下方「發布警示」按鈕執行
        模組 5 一鍵發布（POST /decisions/{'{id}'}/publish）。
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

      {/* ── Module 5 Publish Section ─────────────────────────────── */}
      <div className="demo-decision-panel__publish" data-testid="demo-publish-section">
        <h4 className="demo-decision-panel__publish-heading">
          模組 5：數位通報與多語化
        </h4>

        {publishStage === 'idle' && (
          <>
            <button
              type="button"
              className="demo-decision-panel__publish-btn"
              disabled={publishDisabled}
              title={publishDisabled ? '請先注入事件再執行發布' : '發布警示'}
              onClick={handlePublishClick}
              data-testid="demo-publish-button"
            >
              發布警示
            </button>
            {publishDisabled && (
              <p className="demo-decision-panel__publish-reason">
                請先注入事件再執行發布
              </p>
            )}
          </>
        )}

        {publishStage === 'preview' && lastView !== null && (
          <div className="demo-decision-panel__publish-preview" data-testid="demo-publish-preview">
            <p className="demo-decision-panel__publish-preview-title">待發布內容確認</p>
            <dl className="demo-decision-panel__publish-preview-list">
              <dt>決策 ID</dt>
              <dd><code>{lastView.decisionId}</code></dd>
              <dt>發布頻道</dt>
              <dd>SMS、CMS</dd>
              <dt>發布語言</dt>
              <dd>
                {(lastView.publicAlerts?.languages ?? ['zh', 'en']).join('、')}
              </dd>
              <dt>核准人</dt>
              <dd>demo-commander</dd>
            </dl>
            {publishError !== null && (
              <p className="demo-decision-panel__publish-error" role="alert">
                錯誤：{publishError}
              </p>
            )}
            <div className="demo-decision-panel__publish-actions">
              <button
                type="button"
                className="demo-decision-panel__publish-confirm"
                onClick={handleConfirmPublish}
              >
                確認發布
              </button>
              <button
                type="button"
                className="demo-decision-panel__publish-cancel"
                onClick={handleDismissPublish}
              >
                取消
              </button>
            </div>
          </div>
        )}

        {publishStage === 'confirming' && (
          <div className="demo-decision-panel__publish-confirming" data-testid="demo-publish-confirming">
            <p>發布中…</p>
          </div>
        )}

        {publishStage === 'success' && publishResult !== null && (
          <div className="demo-decision-panel__publish-success" data-testid="demo-publish-success">
            <p className="demo-decision-panel__publish-success-title">發布成功</p>
            <dl className="demo-decision-panel__publish-success-list">
              <dt>發布狀態</dt>
              <dd>{publishResult.publishState}</dd>
              <dt>頻道</dt>
              <dd>{publishResult.channels.join('、')}</dd>
              <dt>語言</dt>
              <dd>{publishResult.languages.join('、')}</dd>
              <dt>發布時間</dt>
              <dd>{publishResult.publishedAt}</dd>
              <dt>核准人</dt>
              <dd>{publishResult.approvedBy}</dd>
              <dt>派送模式</dt>
              <dd>{publishResult.deliveryMode}</dd>
            </dl>
            {publishResult.deliveryMode === 'competition_demo_dispatch' && (
              <p className="demo-decision-panel__publish-disclaimer">
                競賽展示派送，未連接真實電信簡訊閘道
              </p>
            )}
            <button
              type="button"
              className="demo-decision-panel__publish-close"
              onClick={handleDismissPublish}
            >
              關閉
            </button>
          </div>
        )}
      </div>
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
