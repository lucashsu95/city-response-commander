/**
 * Incident Injection Panel (§12, §16.3, §17, R5; TASK-128)
 *
 * Admin-only UI for `POST /incidents/{event_id}/inject`. A commander names an
 * `event_id` from `live_incidents.json`, confirms the action, and the panel
 * renders exactly one of the four documented outcomes (§12): `202` accepted,
 * `200` completed, `503 WORKFLOW_START_FAILED`, `409 CORE_IDENTITY_CONFLICT`.
 *
 * ## Why this is gated behind an explicit confirmation step
 *
 * Injection is a **commander action with real consequences**: a successful
 * `202` starts a Step Functions execution, which — once it reaches
 * `MARK_CORE_COMMITTED` — pushes a public warning (§16.3 Fast Path). There is
 * no "preview" of an injection. The panel therefore never calls
 * `client.postInject` from the same interaction that names the `event_id`: it
 * always passes through an explicit `confirming` state with its own
 * confirm/cancel controls, mirroring the publish-confirmation gate already
 * built for TASK-132 (`alert_panel.tsx`'s `PublishSection`).
 *
 * ## Why the outcome rendering is the TASK-133 module verbatim
 *
 * §12's four outcomes are exactly the ones `execution_model.ts` /
 * `execution_status.tsx` (TASK-133) already classify and render
 * (`decodeInjectionResponse`, `InjectionOutcomeSection`). Reimplementing that
 * branching here would risk the two copies drifting — in particular, silently
 * regaining a generic-error rendering for `409`, which §12 forbids. This panel
 * therefore decodes with `decodeInjectionResponse` and renders with the same
 * `InjectionOutcomeSection`, and adds nothing on top for the four outcomes
 * themselves.
 *
 * ## Admin gating
 *
 * `packages/frontend` had no Cognito/auth seam before this task (checked: no
 * reference anywhere under `src/`). §17 requires `POST /incidents/{id}/inject`
 * to be Cognito(admin)-protected, so this task adds the minimal
 * `auth/admin_session.ts` seam and gates the form on
 * {@link hasAdminToken}. With no admin token, the panel renders a disabled
 * notice instead of a usable form — never a silently-permissive one.
 *
 * ## Nothing fabricated (§9, §21)
 *
 * The request body carries only `event_id` (`InjectIncidentRequest`); the
 * `idempotency_key` is derived server-side from
 * `event_id|event_timestamp|policy_version`
 * (`packages/backend/src/inject/idempotency_key.ts` on the live branch) and is
 * never constructed or guessed here. `decision_id` / `trace_id` are displayed
 * exactly as the response reports them, by the reused `InjectionOutcomeSection`.
 *
 * @module frontend/inject/injection_panel
 */

import { useCallback, useState, type FormEvent, type ReactNode } from 'react';
import { adminAuthorizationHeader, hasAdminToken } from '../auth/admin_session.js';
import type { AdminToken } from '../auth/admin_session.js';
import { DataContractWarning } from '../decision/decision_display.js';
import { decodeInjectionResponse } from '../decision/execution_model.js';
import type { InjectionOutcome } from '../decision/execution_model.js';
import { InjectionOutcomeSection } from '../decision/execution_status.js';
import type { ApiClient } from '../api/client.js';
import { useI18n } from '../i18n/index.js';
import { LoadingIndicator } from '../components/system/async_state.js';

/** Local phase of the confirm-then-submit flow. Not shared with any hook. */
type InjectionFlowPhase =
  | 'form'
  | 'confirming'
  | 'submitting'
  | 'submitted'
  | 'transport_error';

export interface InjectionPanelProps {
  /** TASK-121 API client. The panel calls only `postInject` on it. */
  readonly client: ApiClient;
  /**
   * Admin bearer token, or `null` when no admin session exists.
   *
   * Injected rather than read from a global so the panel stays testable
   * without a real Cognito session; `null` renders the disabled admin-gate
   * notice.
   */
  readonly adminToken: AdminToken;
}

/**
 * Trims and validates the operator-entered `event_id`.
 *
 * The only validation performed client-side: non-empty after trimming. Every
 * other rule (whether the event exists, whether it is already
 * injected/closed) is the backend's to enforce and report back through the
 * §12 outcome — this panel does not pre-guess them.
 */
function normalizedEventId(raw: string): string | null {
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Renders the admin-only incident injection form (TASK-128).
 *
 * Flow: `form` (enter `event_id`) → `confirming` (explicit confirm/cancel,
 * no request issued yet) → `submitting` → `submitted` (renders the decoded
 * §12 outcome via the TASK-133 {@link InjectionOutcomeSection}) or
 * `transport_error` (the request never reached the §12 outcome — a network
 * failure, an unparseable body, or a client-side configuration error, kept
 * visually distinct from a `503`/`409` outcome so a transport fault is never
 * mistaken for a documented workflow outcome).
 */
export function InjectionPanel({ client, adminToken }: InjectionPanelProps): ReactNode {
  const { t } = useI18n();
  const [eventIdInput, setEventIdInput] = useState('');
  const [phase, setPhase] = useState<InjectionFlowPhase>('form');
  const [pendingEventId, setPendingEventId] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<InjectionOutcome | null>(null);
  const [transportErrorMessage, setTransportErrorMessage] = useState<string | null>(null);

  const admin = hasAdminToken(adminToken);

  const handleSubmitEventId = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const eventId = normalizedEventId(eventIdInput);
      if (eventId === null) return;
      setPendingEventId(eventId);
      setPhase('confirming');
    },
    [eventIdInput],
  );

  const cancelConfirmation = useCallback(() => {
    setPendingEventId(null);
    setPhase('form');
  }, []);

  const confirmAndInject = useCallback(() => {
    if (pendingEventId === null) return;
    const authorizationHeader = adminAuthorizationHeader(adminToken);
    if (authorizationHeader === null) {
      // The confirm control is not rendered without an admin token (see the
      // admin-gate branch below), so reaching here means the token was
      // revoked between render and click. Fail closed rather than posting
      // without authorization.
      setPhase('transport_error');
      setTransportErrorMessage('管理員憑證已失效，請重新登入後再試一次；本次未送出注入請求。');
      return;
    }

    setPhase('submitting');
    void client
      .postInject(pendingEventId, { authorizationHeader })
      .then((result) => {
        if (!result.ok) {
          setPhase('transport_error');
          setTransportErrorMessage(
            `注入請求未能送達（${result.error.code}）：${result.error.message}`,
          );
          return;
        }
        setOutcome(decodeInjectionResponse(result.data.httpStatus, result.data.body));
        setPhase('submitted');
      })
      .catch((error: unknown) => {
        setPhase('transport_error');
        setTransportErrorMessage(
          `注入請求發生未預期錯誤：${error instanceof Error ? error.message : String(error)}`,
        );
      });
  }, [client, pendingEventId, adminToken]);

  const startOver = useCallback(() => {
    setEventIdInput('');
    setPendingEventId(null);
    setOutcome(null);
    setTransportErrorMessage(null);
    setPhase('form');
  }, []);

  const retryInjection = useCallback(() => {
    // Re-issues with the SAME event_id. The backend derives the same
    // `idempotency_key` (event_id|event_timestamp|policy_version) from it, so
    // this recovers through lease recovery rather than starting a second
    // decision (§15.2) — it never fabricates a new key client-side.
    if (pendingEventId === null) return;
    setPhase('confirming');
  }, [pendingEventId]);

  if (!admin) {
    return (
      <div className="injection-panel" data-testid="injection-panel">
        <h3 className="injection-panel__heading">{t('injection.heading')}</h3>
        <DataContractWarning message="尚未偵測到管理員憑證（Cognito admin）。事件注入為具實際後果之指揮動作，僅限管理員操作；本面板停用表單，不提供任何繞過授權之操作。" />
      </div>
    );
  }

  return (
    <div className="injection-panel" data-testid="injection-panel">
      <h3 className="injection-panel__heading">{t('injection.heading')}</h3>
      <p className="injection-panel__note">
        將 <code>live_incidents.json</code> 中的事件注入系統（
        <code>POST /incidents/{'{event_id}'}/inject</code>）。此為具實際後果之指揮動作：成功注入將啟動
        決策工作流並可能立即推送公眾初步警示（§16.3 Fast Path）。
      </p>

      {phase === 'form' ? (
        <form
          className="injection-panel__form"
          onSubmit={handleSubmitEventId}
          aria-label="事件注入表單"
        >
          <label className="injection-panel__label" htmlFor="injection-event-id">
            事件 ID（event_id，例如 TPE_2026_ACC_001）
          </label>
          <input
            id="injection-event-id"
            className="injection-panel__input"
            type="text"
            value={eventIdInput}
            onChange={(event) => setEventIdInput(event.target.value)}
            placeholder="TPE_2026_ACC_001"
            data-testid="injection-event-id-input"
            required
          />
          <button
            type="submit"
            className="injection-panel__submit"
            data-testid="injection-submit-button"
            disabled={normalizedEventId(eventIdInput) === null}
          >
            {t('injection.submit')}
          </button>
        </form>
      ) : null}

      {phase === 'confirming' && pendingEventId !== null ? (
        <div
          className="injection-panel__confirm"
          role="group"
          aria-label="注入確認"
          data-testid="injection-confirm-group"
        >
          <p className="injection-panel__confirm-question" data-testid="injection-confirm-question">
            確認注入事件 <strong>{pendingEventId}</strong>？此動作將啟動決策工作流，且可能立即
            推送公眾初步警示，發出後無法取消。
          </p>
          <button
            type="button"
            className="injection-panel__confirm-yes"
            onClick={confirmAndInject}
            data-testid="injection-confirm-button"
          >
            {t('injection.confirmYes')}
          </button>
          <button
            type="button"
            className="injection-panel__confirm-no"
            onClick={cancelConfirmation}
            data-testid="injection-cancel-button"
          >
            {t('injection.confirmNo')}
          </button>
        </div>
      ) : null}

      {phase === 'submitting' ? (
        <LoadingIndicator label={t('injection.submitting')} />
      ) : null}

      {phase === 'transport_error' ? (
        <div data-testid="injection-transport-error">
          <DataContractWarning
            message={
              transportErrorMessage ??
              '注入請求未能送達，且未取得任何 §12 定義之回應狀態（202／200／503／409）。'
            }
          />
          <button
            type="button"
            className="injection-panel__retry-button"
            onClick={() => setPhase('confirming')}
            data-testid="injection-transport-retry-button"
          >
            {t('injection.retry')}
          </button>
          <button
            type="button"
            className="injection-panel__reset-button"
            onClick={startOver}
            data-testid="injection-reset-button"
          >
            {t('injection.resetLabel')}
          </button>
        </div>
      ) : null}

      {phase === 'submitted' && outcome !== null ? (
        <>
          <InjectionOutcomeSection outcome={outcome} onRetryInjection={retryInjection} />
          <button
            type="button"
            className="injection-panel__reset-button"
            onClick={startOver}
            data-testid="injection-reset-button"
          >
            {t('injection.again')}
          </button>
        </>
      ) : null}
    </div>
  );
}
