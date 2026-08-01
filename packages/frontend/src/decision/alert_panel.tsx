/**
 * Multilingual Public-Alert Panel (§10.13, §14.4, §16, §21.3, R14; TASK-132)
 *
 * Renders the民眾簡訊 from the `GET /decisions/{decision_id}` read model: the
 * deterministic article-6 verdict and the message points a commander must be
 * able to check, plus the Bedrock-written `PUBLIC_ALERT` text per language.
 *
 * Deterministic boundary (§9, R14.1):
 * - `multilingual_required` is displayed verbatim. This panel never evaluates
 *   the 30% `Roaming_User_Pct` threshold, never counts base stations, and never
 *   decides which languages "should" be triggered.
 * - the language *floor* applied when text is missing is a documented
 *   consequence of that backend boolean (§14.4, §21.3
 *   「不得退化為僅中文」): `zh` always, plus `en` when the backend says
 *   multilingual publication is required. Bonus `ja`/`ko` are rendered only when
 *   the backend actually supplies their text — no client-side ja/ko template is
 *   produced (TASK-134 scope).
 * - a language whose text has not been written yet shows the deterministic
 *   §21.3 template, labelled 「系統模板」 — never a blank bubble and never an
 *   invented ETE.
 *
 * HG-001 amendment (tasks.md TASK-132): the public-facing output never
 * fabricates an ETE when no common snapshot exists (the delay clause degrades to
 * the known lower bound, or disappears), and a contextual `affected_road` is
 * never presented as a route or a trigger — it is not part of the alert at all.
 *
 * Publish confirmation (R11.6, §10.11d): the panel shows the backend
 * `PublishRecord` state and audit trail and gates any publish action behind an
 * explicit two-step confirmation. The action itself is injected
 * ({@link AlertPanelProps.onConfirmPublish}); with no handler wired the control
 * stays disabled with the reason stated, because `POST /decisions/{id}/publish`
 * is not part of this task's transport surface.
 *
 * @module frontend/decision/alert_panel
 */

import { useCallback, useState, type ReactNode } from 'react';
import {
  EmptyState,
  ErrorState,
  InsufficientDataState,
  LoadingIndicator,
} from '../components/system/async_state.js';
import { CometSpinner } from '../components/loading/comet_spinner.js';
import {
  AiTextBadge,
  DeterministicBadge,
  FieldList,
  FieldRow,
  TemplateBadge,
  articleListText,
  booleanText,
  idListText,
  numberText,
  textOrUnavailable,
} from './decision_display.js';
import type { DecisionCoreView, PublishRecordView } from './decision_read_model.js';
import { buildPublicAlertTemplate, fallbackLanguageFloor } from './narrative_fallback.js';
import type { DecisionReadModelState } from './use_decision_read_model.js';
import { selectServerPublicAlertText, useI18n } from '../i18n/index.js';

/** Display labels for the language codes the design names (§14.4). */
const LANGUAGE_LABELS: Readonly<Record<string, string>> = {
  zh: '中文',
  en: 'English',
  ja: '日本語',
  ko: '한국어',
};

function languageLabel(code: string): string {
  return LANGUAGE_LABELS[code] ?? code;
}

/** One rendered language row: backend text, or the deterministic template. */
export interface AlertRow {
  readonly language: string;
  readonly text: string | null;
  readonly source: 'backend' | 'template';
  readonly omittedFields: readonly string[];
}

/**
 * Builds the rows to render.
 *
 * Order: every language the backend supplied, in wire order, then any floor
 * language it did not supply. Backend text always wins; a template is only ever
 * produced for a language with no committed text.
 */
export function buildAlertRows(
  core: DecisionCoreView,
  suppliedTexts: readonly { readonly language: string; readonly text: string }[],
): readonly AlertRow[] {
  const rows: AlertRow[] = suppliedTexts.map((entry) => ({
    language: entry.language,
    text: entry.text,
    source: 'backend' as const,
    omittedFields: [],
  }));

  const supplied = new Set(suppliedTexts.map((entry) => entry.language));
  for (const language of fallbackLanguageFloor(core.multilingualRequired)) {
    if (supplied.has(language)) continue;
    const template = buildPublicAlertTemplate(core, language);
    rows.push({
      language,
      text: template.text,
      source: 'template',
      omittedFields: template.omittedFields,
    });
  }

  return rows;
}

// ─── Language Rows ───────────────────────────────────────────

function AlertMessage({ row, active }: { readonly row: AlertRow; readonly active: boolean }): ReactNode {
  return (
    <li
      className="alert-panel__message"
      data-language={row.language}
      data-source={row.source}
      data-active-language={active ? 'true' : 'false'}
    >
      <h5 className="alert-panel__message-heading">
        {languageLabel(row.language)}
        {row.source === 'backend' ? <AiTextBadge /> : <TemplateBadge />}
      </h5>
      <p className="alert-panel__message-text">
        {row.text === null || row.text === ''
          ? '後端尚未提供文字，且無可代入之決定性事實，未產生模板'
          : row.text}
      </p>
      {row.source === 'template' && row.omittedFields.length > 0 ? (
        <p className="alert-panel__note">模板省略之欠缺欄位：{idListText(row.omittedFields)}</p>
      ) : null}
    </li>
  );
}

// ─── Publish Confirmation (R11.6) ────────────────────────────

interface PublishSectionProps {
  readonly publish: PublishRecordView | null;
  readonly onConfirmPublish?: () => void;
}

function PublishSection({ publish, onConfirmPublish }: PublishSectionProps): ReactNode {
  const [confirming, setConfirming] = useState(false);

  const requestConfirmation = useCallback(() => {
    setConfirming(true);
  }, []);
  const cancelConfirmation = useCallback(() => {
    setConfirming(false);
  }, []);
  const confirm = useCallback(() => {
    setConfirming(false);
    onConfirmPublish?.();
  }, [onConfirmPublish]);

  return (
    <section className="alert-panel__section" aria-labelledby="alert-publish-heading">
      <h4 id="alert-publish-heading" className="alert-panel__subheading">
        一鍵發布狀態
      </h4>
      {publish === null ? (
        <EmptyState message="尚未進入發布流程（後端未提供 publish 記錄）" />
      ) : (
        <>
          <FieldList>
            <FieldRow label="發布狀態">
              <span data-testid="publish-state">{textOrUnavailable(publish.publishState)}</span>
            </FieldRow>
            <FieldRow label="發布管道">{idListText(publish.channels)}</FieldRow>
            <FieldRow label="核准者">{textOrUnavailable(publish.approvedBy)}</FieldRow>
            <FieldRow label="發布者">{textOrUnavailable(publish.publishedBy)}</FieldRow>
            <FieldRow label="失敗原因">{textOrUnavailable(publish.failureReason)}</FieldRow>
            <FieldRow label="樂觀鎖版本">{numberText(publish.version)}</FieldRow>
            <FieldRow label="最後更新">{textOrUnavailable(publish.updatedAt)}</FieldRow>
          </FieldList>
          {publish.auditTrail.length === 0 ? (
            <EmptyState message="後端未提供發布稽核軌跡" />
          ) : (
            <ol className="alert-panel__audit">
              {publish.auditTrail.map((entry, index) => (
                <li key={`${entry.at ?? 'unknown'}-${index}`} className="alert-panel__audit-entry">
                  {textOrUnavailable(entry.at)}｜{textOrUnavailable(entry.actor)}｜
                  {textOrUnavailable(entry.action)}｜{textOrUnavailable(entry.fromState)} →{' '}
                  {textOrUnavailable(entry.toState)}
                </li>
              ))}
            </ol>
          )}
        </>
      )}

      <div className="alert-panel__publish-gate">
        {onConfirmPublish === undefined ? (
          <p className="decision-notice decision-notice--gap" role="note">
            發布動作未接線：`POST /decisions/&#123;id&#125;/publish`（R11.6）不在本面板的傳輸範圍，
            故確認鍵停用。
          </p>
        ) : confirming ? (
          <div className="alert-panel__confirm" role="group" aria-label="發布確認">
            <p className="alert-panel__confirm-question">
              確認發布上列民眾簡訊？發布後將寫入稽核軌跡且不可撤回。
            </p>
            <button type="button" className="alert-panel__confirm-yes" onClick={confirm}>
              確認發布
            </button>
            <button type="button" className="alert-panel__confirm-no" onClick={cancelConfirmation}>
              取消
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="alert-panel__publish-request"
            onClick={requestConfirmation}
          >
            發布民眾簡訊…
          </button>
        )}
      </div>
    </section>
  );
}

// ─── Panel ───────────────────────────────────────────────────

export interface AlertPanelProps {
  readonly decision: DecisionReadModelState;
  /** Retries the initial (non-background) read. */
  readonly onRetry: () => void;
  /**
   * Invoked after the commander confirms publication. Optional: when absent the
   * confirmation control is disabled with the reason shown, rather than
   * pretending a publish transport exists.
   */
  readonly onConfirmPublish?: () => void;
}

/**
 * Multilingual public-alert panel (TASK-132).
 *
 * State → UI mapping:
 * - `idle` → explicit "no decision identified yet"
 * - `loading` → {@link LoadingIndicator}
 * - `error` → {@link ErrorState} plus a retry control
 * - `insufficient_data` → the backend STOP: no committed core, so no alert
 * - `partial` → deterministic facts with §21.3 templates for missing languages
 * - `ready` → deterministic facts with the committed AI text per language
 */
export function AlertPanel({ decision, onRetry, onConfirmPublish }: AlertPanelProps): ReactNode {
  const { locale, t } = useI18n();
  const { state, error, core } = decision;

  if (state === 'idle') {
    return (
      <div className="alert-panel">
        <EmptyState message={t('alert.idle')} />
      </div>
    );
  }

  if (state === 'loading') {
    return (
      <div className="alert-panel">
        <LoadingIndicator label={t('alert.loading')} />
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="alert-panel">
        <ErrorState
          message={error === null ? t('alert.errorFallback') : `${t('alert.errorFallback')}：${error.message}`}
        />
        <button type="button" className="alert-panel__retry" onClick={onRetry}>
          {t('action.retry')}
        </button>
      </div>
    );
  }

  if (state === 'insufficient_data' || core === null) {
    return (
      <div className="alert-panel">
        <h3 className="alert-panel__heading">{t('alert.heading')}</h3>
        <InsufficientDataState message="尚無已提交的決策核心，不對外產出任何民眾簡訊" />
      </div>
    );
  }

  const suppliedTexts = decision.alert?.texts ?? [];
  const rows = buildAlertRows(core, suppliedTexts);
  const selectedServerText = selectServerPublicAlertText(suppliedTexts, locale);

  return (
    <div className="alert-panel">
      <h3 className="alert-panel__heading">{t('alert.heading')}</h3>

      <div
        className="alert-panel__status"
        role={decision.refreshStatus === 'refreshing' ? undefined : 'status'}
        aria-live="polite"
      >
        {decision.refreshStatus === 'refreshing' ? (
          <CometSpinner className="loading-spinner--inline" label={t('alert.refreshing')} />
        ) : null}
        {decision.refreshStatus === 'idle' && error !== null
          ? t('async.backgroundError', { message: error.message })
          : null}
      </div>

      <section className="alert-panel__section" aria-labelledby="alert-trigger-heading">
        <h4 id="alert-trigger-heading" className="alert-panel__subheading">
          SOP 第 6 條觸發判定
        </h4>
        <FieldList>
          <FieldRow label="是否須多語發布" marker={<DeterministicBadge />}>
            <span data-testid="alert-multilingual-required">
              {booleanText(core.multilingualRequired)}
            </span>
          </FieldRow>
          <FieldRow label="觸發條款">{articleListText(core.triggeredArticles)}</FieldRow>
        </FieldList>
        {core.multilingualRequired === null ? (
          <p className="decision-notice decision-notice--gap" role="note">
            後端未提供 multilingual_required；不推定觸發與否，僅呈現中文語言下限。
          </p>
        ) : null}
        <p className="alert-panel__note">
          觸發判定與語言集合皆為後端決定性真值；本面板不重算漫遊比率門檻。
        </p>
      </section>

      <section className="alert-panel__section" aria-labelledby="alert-points-heading">
        <h4 id="alert-points-heading" className="alert-panel__subheading">
          訊息要點（R14.4）
        </h4>
        <FieldList>
          <FieldRow label="事故位置">
            {textOrUnavailable(core.eventFacts?.location ?? null)}
          </FieldRow>
          <FieldRow label="事件狀態">{textOrUnavailable(core.eventFacts?.status ?? null)}</FieldRow>
          <FieldRow label="改道指引（主疏散）">
            {core.primaryEvacuation === null ? '尚未確定（需人工確認）' : core.primaryEvacuation}
          </FieldRow>
          <FieldRow label="預計延誤（分鐘）">
            <span data-testid="alert-ete-minutes">
              {core.ete === null || core.ete.eteMinutes === null
                ? '未計算；僅能揭露已知下限'
                : numberText(core.ete.eteMinutes)}
            </span>
          </FieldRow>
          <FieldRow label="已知下限（分鐘）">
            {numberText(core.ete?.eteLowerBoundMinutes ?? core.ete?.baseClearance ?? null)}
          </FieldRow>
        </FieldList>
      </section>

      <section className="alert-panel__section" aria-labelledby="alert-messages-heading">
        <h4 id="alert-messages-heading" className="alert-panel__subheading">
          各語言簡訊
        </h4>
        {rows.length === 0 ? (
          <EmptyState message="後端未提供任何語言文字，且無語言下限可套用" />
        ) : (
          <ul className="alert-panel__messages">
            {rows.map((row) => (
              <AlertMessage
                key={`${row.language}-${row.source}`}
                row={row}
                active={
                  row.source === 'backend' && selectedServerText?.language === row.language
                }
              />
            ))}
          </ul>
        )}
      </section>

      <PublishSection
        publish={decision.publish}
        {...(onConfirmPublish === undefined ? {} : { onConfirmPublish })}
      />
    </div>
  );
}
