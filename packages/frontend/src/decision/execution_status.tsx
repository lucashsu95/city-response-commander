/**
 * Execution Status Panel (§10.11c FIX 1, §10.11e, §12, §13, §16; TASK-133)
 *
 * Renders the read-only `execution` projection, the outcome of the latest
 * injection attempt, and the latest `processing.failed` event — the three places
 * a commander learns that an asynchronous workflow did not finish.
 *
 * ## Read-only, and not part of DecisionCore
 *
 * `execution` is a **pure read projection** of `IdempotencyTable` (FIX 1). This
 * panel therefore contains no control that could change it: the projection is
 * rendered as a description list with no editable field and no state-transition
 * action. It is also kept visually and textually distinct from `DecisionCore`,
 * which is `immutable_after_commit` and holds no `IdempotencyTable` state at all
 * (§10.11c) — conflating them would suggest either that the core mutates or that
 * the workflow state is frozen, and neither is true.
 *
 * ## The four inject outcomes are four different screens
 *
 * §12 forbids merging them, so each is rendered from its own branch:
 *
 * - **`202`** — accepted / in progress. No result yet; the Fast Path result
 *   arrives later by `decision.fast_path_ready` or by polling `GET /decisions`.
 * - **`200`** — `status=completed`. A finished decision, deliberately *not* the
 *   same branch as `202`.
 * - **`503 WORKFLOW_START_FAILED`** — the workflow never started. `retryable=true`
 *   and the same `idempotency_key` recovers through lease recovery, so a retry
 *   path **is** offered.
 * - **`409 CORE_IDENTITY_CONFLICT`** — terminal and non-recoverable
 *   (`retryable=false`, `recovery_stage=NONE`). **No retry affordance is
 *   rendered**, the wording is specific rather than generic, and the status is
 *   shown as `409` — never as a `500`, and never folded into "an error occurred".
 *   `offersRetry` refuses this outcome structurally, so no payload can talk the
 *   panel into a retry button.
 *
 * Any other status (`401`/`403`/`429`/`500`…) renders in its own branch as well,
 * so an authorization failure is never mistaken for a conflict.
 *
 * ## Nothing is fabricated (§9, §21)
 *
 * `decision_id`, `trace_id`, `status`, `error_code`, `retryable` and
 * `attempt_count` are printed as received. Absent ⇒ an explicit "not supplied".
 * No retryability is inferred from an HTTP status, and no `attempt_count` is
 * defaulted to 1.
 *
 * @module frontend/decision/execution_status
 */

import type { ReactNode } from 'react';
import {
  EmptyState,
  ErrorState,
  InsufficientDataState,
  LoadingIndicator,
} from '../components/system/async_state.js';
import { CometSpinner } from '../components/loading/comet_spinner.js';
import { useI18n } from '../i18n/index.js';
import {
  DataContractWarning,
  FieldList,
  FieldRow,
  ManualConfirmationNotice,
  NOT_SUPPLIED,
  UNAVAILABLE,
  booleanText,
  textOrUnavailable,
} from './decision_display.js';
import {
  CORE_IDENTITY_CONFLICT,
  RECOVERY_CORE_MISSING,
  STALE_RUNNING_EXECUTION,
  WORKFLOW_START_FAILED,
  attemptCountText,
  isCoreIdentityConflict,
  offersRetry,
} from './execution_model.js';
import type {
  ExecutionPresentation,
  InjectionOutcome,
  ProcessingFailedView,
} from './execution_model.js';
import type { DecisionReadModelState } from './use_decision_read_model.js';
import type { ExecutionStatusView } from './use_execution_status.js';

// ─── Local Presentation Atoms ────────────────────────────────

/**
 * Marks the block as a projection the UI can only observe.
 *
 * Deliberately worded as an ownership statement rather than "disabled": the
 * fields are not disabled controls, they are not controls.
 */
function ReadOnlyProjectionBadge(): ReactNode {
  return (
    <span className="decision-badge decision-badge--readonly" role="note">
      唯讀投影（IdempotencyTable，前端不可變更）
    </span>
  );
}

/** Terminal, non-recoverable state. Never used for a retryable failure. */
function TerminalNotice({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <div
      className="decision-notice decision-notice--terminal"
      role="alert"
      data-testid="execution-terminal-notice"
    >
      {children}
    </div>
  );
}

/** A failure the backend marked recoverable. Carries the recovery route. */
function RecoverableNotice({ children }: { readonly children: ReactNode }): ReactNode {
  return (
    <div
      className="decision-notice decision-notice--recoverable"
      role="status"
      data-testid="execution-recoverable-notice"
    >
      {children}
    </div>
  );
}

/** Human-readable label for each projection state. */
const STATUS_LABEL: Readonly<Record<ExecutionPresentation['kind'], string>> = {
  absent: '無執行紀錄',
  starting: '啟動中（starting）',
  running: '執行中（running）',
  completed: '已完成（completed）',
  start_failed: '啟動失敗（start_failed）',
  processing_failed_retryable: '處理失敗，可復原（processing_failed）',
  terminal_identity_conflict: '處理失敗，終端且非可復原（processing_failed）',
  processing_failed_terminal: '處理失敗，後端標記不可復原（processing_failed）',
  processing_failed_unknown_retryability: '處理失敗，後端未提供 retryable',
  unrecognized: '未知狀態（不在 §10.11e 五種狀態內）',
};

/** Explains what `last_error` means, using only documented values. */
function lastErrorExplanation(lastError: string | null): string | null {
  switch (lastError) {
    case CORE_IDENTITY_CONFLICT:
      return 'DecisionCore identity 比對不符，fail-closed：不覆寫既有核心、不推送公眾告警、不進行 enrichment。此為終端狀態，租約復原條件不成立。';
    case STALE_RUNNING_EXECUTION:
      return '執行超過 running_deadline_at，已由後續同鍵請求對帳為處理失敗；可分級復原。';
    case RECOVERY_CORE_MISSING:
      return 'ENRICHMENT_ONLY 復原時強一致讀取未找到既有核心，已改判為需完整工作流復原。';
    default:
      return null;
  }
}

// ─── Read-only Execution Projection (§10.11c FIX 1) ──────────

function ProjectionSection({
  presentation,
}: {
  readonly presentation: ExecutionPresentation;
}): ReactNode {
  const explanation = lastErrorExplanation(presentation.lastError);

  return (
    <section className="execution-panel__section" aria-labelledby="execution-projection-heading">
      <h4 id="execution-projection-heading" className="execution-panel__subheading">
        執行狀態 <ReadOnlyProjectionBadge />
      </h4>

      {presentation.kind === 'absent' ? (
        <EmptyState message="後端未提供 execution 區塊（IdempotencyTable 紀錄可能已因 TTL 到期或從未建立）；此非失敗，決策核心仍以 GET /decisions 為權威。" />
      ) : (
        <FieldList>
          <FieldRow label="狀態判讀">
            <span data-testid="execution-status-label">{STATUS_LABEL[presentation.kind]}</span>
          </FieldRow>
          <FieldRow label="execution.status（後端原值）">
            <span data-testid="execution-status">{textOrUnavailable(presentation.status)}</span>
          </FieldRow>
          <FieldRow label="execution.last_error">
            <span data-testid="execution-last-error">
              {presentation.lastError === null ? '無' : presentation.lastError}
            </span>
          </FieldRow>
          <FieldRow label="execution.retryable">
            <span data-testid="execution-retryable">
              {presentation.retryable === null ? NOT_SUPPLIED : booleanText(presentation.retryable)}
            </span>
          </FieldRow>
          <FieldRow label="execution.attempt_count">
            <span data-testid="execution-attempt-count">
              {attemptCountText(presentation.attemptCount, NOT_SUPPLIED)}
            </span>
          </FieldRow>
        </FieldList>
      )}

      {explanation !== null ? (
        <p className="execution-panel__note" data-testid="execution-last-error-explanation">
          {explanation}
        </p>
      ) : null}

      {presentation.kind === 'terminal_identity_conflict' ? (
        <TerminalNotice>
          <strong>終端衝突（CORE_IDENTITY_CONFLICT）：</strong>
          此執行已終止且<strong>無法復原</strong>（`retryable=false`、`recovery_stage=NONE`）。 系統
          <strong>不會</strong>自動重試，介面亦<strong>不提供</strong>重試操作； 後續相同
          `idempotency_key` 的注入請求一律回 <code>409 Conflict</code>，不會被視為一般錯誤或
          <code>500</code>。請改以人工核對事件來源後，以不同的官方事件識別重新處理。
        </TerminalNotice>
      ) : null}

      {presentation.kind === 'processing_failed_terminal' ? (
        <TerminalNotice>
          後端標記 <code>retryable=false</code>，此失敗不提供重試操作。 最近錯誤：
          {textOrUnavailable(presentation.lastError)}。
        </TerminalNotice>
      ) : null}

      {presentation.kind === 'processing_failed_retryable' ? (
        <RecoverableNotice>
          後端標記 <code>retryable=true</code>：相同 `idempotency_key`
          的後續注入請求可經租約復原（依 `recovery_stage` 分級為 FULL_WORKFLOW 或
          ENRICHMENT_ONLY）重新推進。
        </RecoverableNotice>
      ) : null}

      {presentation.kind === 'start_failed' ? (
        <RecoverableNotice>
          工作流<strong>尚未啟動</strong>（StartExecution 失敗），因此不會有任何 DecisionCore
          或公眾告警產生。相同 `idempotency_key` 可立即競爭復原租約重試。
        </RecoverableNotice>
      ) : null}

      {presentation.kind === 'processing_failed_unknown_retryability' ? (
        <DataContractWarning message="execution.status 為 processing_failed 但未提供 retryable；為 fail-closed，介面不提供任何重試操作，也不推定可復原性。" />
      ) : null}

      {presentation.kind === 'unrecognized' ? (
        <DataContractWarning
          message={`execution.status「${presentation.status ?? UNAVAILABLE}」不在 §10.11e 的五種狀態（starting／running／completed／start_failed／processing_failed）內；原值照實呈現，不對應到任何已知狀態。`}
        />
      ) : null}

      <p className="execution-panel__note" data-testid="execution-readonly-note">
        本區塊為 `IdempotencyTable` 的<strong>唯讀投影</strong>（FIX 1）：其狀態由後端 `InjectFn` 與
        `WorkflowStatusFn` 依分區所有權寫入，前端<strong>無法</strong>
        修改，畫面上亦無任何可變更此狀態的操作。它<strong>不是</strong> `DecisionCore` 的一部分——
        `DecisionCore` 為 `immutable_after_commit`，且不含任何 `IdempotencyTable` 狀態。
      </p>
    </section>
  );
}

// ─── Inject HTTP Outcome (§12 status matrix) ─────────────────

function OutcomeIdentifiers({ outcome }: { readonly outcome: InjectionOutcome }): ReactNode {
  return (
    <FieldList>
      <FieldRow label="HTTP 狀態">
        <span data-testid="injection-http-status">{String(outcome.httpStatus)}</span>
      </FieldRow>
      <FieldRow label="decision_id">
        <span data-testid="injection-decision-id">
          {outcome.decisionId === null ? NOT_SUPPLIED : outcome.decisionId}
        </span>
      </FieldRow>
      <FieldRow label="trace_id">
        <span data-testid="injection-trace-id">
          {outcome.traceId === null ? NOT_SUPPLIED : outcome.traceId}
        </span>
      </FieldRow>
      <FieldRow label="回應 status 欄位">
        <span data-testid="injection-body-status">
          {outcome.status === null ? NOT_SUPPLIED : outcome.status}
        </span>
      </FieldRow>
      <FieldRow label="error_code">
        <span data-testid="injection-error-code">
          {outcome.errorCode === null ? '無' : outcome.errorCode}
        </span>
      </FieldRow>
      <FieldRow label="retryable">
        <span data-testid="injection-retryable">
          {outcome.retryable === null ? NOT_SUPPLIED : booleanText(outcome.retryable)}
        </span>
      </FieldRow>
    </FieldList>
  );
}

export interface InjectionOutcomeSectionProps {
  readonly outcome: InjectionOutcome;
  /**
   * Re-issues the injection with the same `idempotency_key`.
   *
   * Rendered **only** when {@link offersRetry} authorizes it, and never for the
   * terminal conflict. Optional so a display-only mount (no command capability)
   * still shows the recovery route as guidance without an inert button.
   */
  readonly onRetryInjection?: () => void;
}

/**
 * Renders one inject outcome.
 *
 * Every branch is separate, and the retry affordance is gated on the backend's
 * own `retryable` flag rather than on the branch — so a `503` that arrived
 * without `retryable: true` gets guidance but no button.
 */
export function InjectionOutcomeSection({
  outcome,
  onRetryInjection,
}: InjectionOutcomeSectionProps): ReactNode {
  const retryAllowed = offersRetry(outcome);

  return (
    <section
      className="execution-panel__section"
      aria-labelledby="injection-outcome-heading"
      data-testid="injection-outcome"
      data-outcome-kind={outcome.kind}
    >
      <h4 id="injection-outcome-heading" className="execution-panel__subheading">
        最近一次事件注入結果（POST /incidents/{'{event_id}'}/inject）
      </h4>

      {outcome.kind === 'accepted' ? (
        <div data-testid="injection-accepted">
          <RecoverableNotice>
            <strong>202 Accepted — 已受理、處理中。</strong>
            此回應僅代表工作流已受理（或既有執行仍在進行中），<strong>不代表</strong>
            決策已完成；結果稍後由 `decision.fast_path_ready` 推送，或以 GET /decisions/
            {'{decision_id}'} 輪詢取得。
          </RecoverableNotice>
        </div>
      ) : null}

      {outcome.kind === 'completed' ? (
        <div data-testid="injection-completed">
          <RecoverableNotice>
            <strong>200 OK — 此鍵的決策已完成。</strong>
            後端未重新啟動工作流，直接回傳既有 `decision_id`。此為與 202
            <strong>不同</strong>的分支：202 表示仍在進行中，200 表示已完成。
          </RecoverableNotice>
        </div>
      ) : null}

      {outcome.kind === 'start_failed' ? (
        <div data-testid="injection-start-failed">
          <RecoverableNotice>
            <strong>
              503 Service Unavailable（{outcome.errorCode ?? WORKFLOW_START_FAILED}）—
              工作流尚未啟動。
            </strong>
            StartExecution 失敗，因此<strong>沒有</strong>建立 DecisionCore、
            <strong>沒有</strong>推送公眾告警，且 `idempotency_key`
            <strong>不會</strong>永久卡死。
          </RecoverableNotice>
        </div>
      ) : null}

      {outcome.kind === 'terminal_conflict' ? (
        <div data-testid="injection-terminal-conflict">
          <TerminalNotice>
            <strong>
              409 Conflict（{outcome.errorCode ?? CORE_IDENTITY_CONFLICT}）— 終端、非可復原。
            </strong>
            後端已記錄 `status=processing_failed`、`retryable=false`、`recovery_stage=NONE`。 系統
            <strong>不會</strong>自動重試，介面<strong>不提供</strong>重試操作， 且此結果
            <strong>不是</strong>一般錯誤、<strong>不是</strong> <code>500</code>： 相同
            `idempotency_key` 的後續請求一律回 <code>409</code>。
            請人工核對事件來源與既有決策核心後，改以正確的官方事件識別重新處理。
          </TerminalNotice>
        </div>
      ) : null}

      {outcome.kind === 'other_error' ? (
        <div data-testid="injection-other-error">
          <ErrorState
            message={`注入請求失敗（HTTP ${String(outcome.httpStatus)}${
              outcome.errorCode === null ? '' : `／${outcome.errorCode}`
            }）：${outcome.message ?? '回應未提供錯誤說明'}。此為與 409 終端衝突及 503 啟動失敗不同的結果，未作合併呈現。`}
          />
        </div>
      ) : null}

      <OutcomeIdentifiers outcome={outcome} />

      {outcome.bodyMalformed ? (
        <DataContractWarning message="注入回應的內容不是有效的 JSON 物件，因此 decision_id／trace_id／error_code 均標示為未提供；不代表後端未配發這些識別。" />
      ) : null}

      {retryAllowed ? (
        <div className="execution-panel__retry" data-testid="injection-retry-guidance">
          <p className="execution-panel__note">
            後端標記 <code>retryable=true</code>：可以<strong>相同</strong>
            `idempotency_key` 重新注入，由租約復原（lease recovery）接手；此重試不會產生第二筆
            DecisionCore，也不會重複推送公眾告警。
          </p>
          {onRetryInjection === undefined ? null : (
            <button
              type="button"
              className="execution-panel__retry-button"
              data-testid="injection-retry-button"
              onClick={onRetryInjection}
            >
              以相同 idempotency_key 重新注入
            </button>
          )}
        </div>
      ) : null}
    </section>
  );
}

// ─── `processing.failed` Event (§13) ─────────────────────────

function FailureEventSection({ event }: { readonly event: ProcessingFailedView }): ReactNode {
  const terminal = isCoreIdentityConflict(event.errorCode);

  return (
    <section
      className="execution-panel__section"
      aria-labelledby="processing-failed-heading"
      data-testid="processing-failed-event"
    >
      <h4 id="processing-failed-heading" className="execution-panel__subheading">
        最近 processing.failed 事件（即時通知）
      </h4>

      {event.malformed ? (
        <DataContractWarning message="收到的 processing.failed 事件不是有效的物件結構；不推測其內容。" />
      ) : (
        <FieldList>
          <FieldRow label="error_code">
            <span data-testid="failure-event-error-code">
              {event.errorCode === null ? NOT_SUPPLIED : event.errorCode}
            </span>
          </FieldRow>
          <FieldRow label="retryable">
            <span data-testid="failure-event-retryable">
              {event.retryable === null ? NOT_SUPPLIED : booleanText(event.retryable)}
            </span>
          </FieldRow>
          <FieldRow label="decision_id">
            {event.decisionId === null ? NOT_SUPPLIED : event.decisionId}
          </FieldRow>
          <FieldRow label="event_id">
            {event.eventId === null ? NOT_SUPPLIED : event.eventId}
          </FieldRow>
          <FieldRow label="trace_id">
            <span data-testid="failure-event-trace-id">
              {event.traceId === null ? NOT_SUPPLIED : event.traceId}
            </span>
          </FieldRow>
          <FieldRow label="occurred_at">
            {event.occurredAt === null ? NOT_SUPPLIED : event.occurredAt}
          </FieldRow>
          <FieldRow label="policy_version">
            {event.policyVersion === null ? NOT_SUPPLIED : event.policyVersion}
          </FieldRow>
        </FieldList>
      )}

      {terminal ? (
        <TerminalNotice>
          此事件為 <code>CORE_IDENTITY_CONFLICT</code> 的<strong>終端非可復原</strong>
          變體（<code>retryable=false</code>）；不提供重試，亦不會自動重試。
        </TerminalNotice>
      ) : null}

      <p className="execution-panel__note">
        `processing.failed` 為<strong>通知</strong>（§13）：權威失敗紀錄為上方 `GET /decisions/
        {'{decision_id}'}` 的唯讀 `execution` 摘要。
      </p>
    </section>
  );
}

// ─── Panel ───────────────────────────────────────────────────

export interface ExecutionStatusPanelProps {
  readonly decision: DecisionReadModelState;
  /** Classified execution view, from {@link useExecutionStatus}. */
  readonly execution: ExecutionStatusView;
  /** Retries the `GET /decisions/{decision_id}` read (not the workflow). */
  readonly onRetry: () => void;
  /** Re-issues the injection; only rendered where `retryable=true`. */
  readonly onRetryInjection?: () => void;
}

/**
 * Execution status / error panel (TASK-133).
 *
 * State → UI mapping:
 * - `idle` → explicit "no decision identified yet"
 * - `loading` → {@link LoadingIndicator}
 * - `error` → {@link ErrorState} plus a retry for the *read*, kept clearly
 *   separate from a workflow failure
 * - `insufficient_data` → **the execution projection is still rendered.** This is
 *   the terminal-conflict shape itself: a conflict means no core was committed,
 *   so `core: null` / `data_status=insufficient_data` arrives together with
 *   `execution.status=processing_failed`. Suppressing the block here would hide
 *   the one state the panel exists to show.
 * - `ready` / `partial` → the projection plus any outcome and failure event
 * - background refresh in flight / failed → refreshing or stale/degraded notice,
 *   with existing content preserved
 */
export function ExecutionStatusPanel({
  decision,
  execution,
  onRetry,
  onRetryInjection,
}: ExecutionStatusPanelProps): ReactNode {
  const { t } = useI18n();
  const { state, error } = decision;
  const { presentation, lastFailureEvent, injection } = execution;

  if (state === 'idle') {
    return (
      <div className="execution-panel">
        <h3 className="execution-panel__heading">{t('execution.heading')}</h3>
        {injection === null ? (
          <EmptyState message="尚未有決策或注入請求（等待管理員注入事件或即時事件）" />
        ) : (
          <InjectionOutcomeSection outcome={injection} onRetryInjection={onRetryInjection} />
        )}
      </div>
    );
  }

  if (state === 'loading') {
    return (
      <div className="execution-panel">
        <h3 className="execution-panel__heading">{t('execution.heading')}</h3>
        <LoadingIndicator label={t('execution.loading')} />
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="execution-panel">
        <h3 className="execution-panel__heading">{t('execution.heading')}</h3>
        <ErrorState
          message={
            error === null
              ? '執行狀態讀取失敗'
              : `執行狀態讀取失敗：${error.message}（此為讀取決策讀取模型失敗，並非工作流本身失敗）`
          }
        />
        <button type="button" className="execution-panel__retry-button" onClick={onRetry}>
          {t('action.retry')}
        </button>
        {injection === null ? null : (
          <InjectionOutcomeSection outcome={injection} onRetryInjection={onRetryInjection} />
        )}
      </div>
    );
  }

  const manualConfirmationRequired = decision.core?.ete?.manualConfirmationRequired ?? null;

  return (
    <div className="execution-panel">
      <h3 className="execution-panel__heading">{t('execution.heading')}</h3>

      <div
        className="execution-panel__status"
        role={decision.refreshStatus === 'refreshing' ? undefined : 'status'}
        aria-live="polite"
      >
        {decision.refreshStatus === 'refreshing' ? (
          <CometSpinner className="loading-spinner--inline" label={t('execution.refreshing')} />
        ) : null}
        {decision.refreshStatus === 'idle' && error !== null
          ? t('async.executionMayBeStale', { message: error.message })
          : null}
      </div>

      {state === 'insufficient_data' ? (
        <InsufficientDataState message="尚無已提交的決策核心（data_status=insufficient_data）。這與執行狀態是兩件事：終端 CORE_IDENTITY_CONFLICT 正是「無核心 + processing_failed」的組合，因此以下執行摘要照實呈現。" />
      ) : null}

      <ProjectionSection presentation={presentation} />

      {execution.retryabilityDisagreement ? (
        <DataContractWarning message="processing.failed 事件與唯讀 execution 摘要對 retryable 的陳述不一致；兩者皆照實呈現，不予調和。權威來源為 GET /decisions 的 execution 摘要。" />
      ) : null}

      {injection === null ? (
        <section className="execution-panel__section">
          <h4 className="execution-panel__subheading">最近一次事件注入結果</h4>
          <EmptyState message="本次連線尚未由此介面發出注入請求；此區塊僅呈現本介面實際收到的回應，不推測後端歷史。" />
        </section>
      ) : (
        <InjectionOutcomeSection outcome={injection} onRetryInjection={onRetryInjection} />
      )}

      {lastFailureEvent === null ? (
        <section className="execution-panel__section">
          <h4 className="execution-panel__subheading">最近 processing.failed 事件</h4>
          <EmptyState message="尚未收到 processing.failed 事件" />
        </section>
      ) : (
        <FailureEventSection event={lastFailureEvent} />
      )}

      {manualConfirmationRequired === true ? (
        <ManualConfirmationNotice message="決策核心標記 manual_confirmation_required；在人工確認前，不得將此決策結果作為對外發布依據。" />
      ) : null}

      {presentation.kind === 'terminal_identity_conflict' ? (
        <ManualConfirmationNotice message="終端 CORE_IDENTITY_CONFLICT 無法由系統復原，必須由人工核對事件來源與既有決策核心後處置。" />
      ) : null}
    </div>
  );
}
