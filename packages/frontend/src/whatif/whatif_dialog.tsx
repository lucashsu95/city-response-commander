/**
 * What-if Dialog (§14.5, §16, R16; TASK-141)
 *
 * Operator-only dialog that submits hypothetical questions to `POST /what-if`
 * and renders the deterministic result: triggered articles, expected actions,
 * ETE preview, SOP citations, or a `clarification_required` prompt.
 *
 * ## State mutation guarantee
 *
 * The dialog prominently indicates `does_not_mutate_state` — the What-if
 * engine re-runs the Rule Engine on the hypothetical input without writing
 * to DecisionCore, IdempotencyTable, or any other persistent state.
 *
 * ## Confirmation gate
 *
 * Like TASK-128's injection panel, the dialog passes through an explicit
 * `confirming` state before issuing the POST request. This mirrors the
 * publish-confirmation gate in TASK-132's alert_panel.tsx.
 *
 * @module frontend/whatif/whatif_dialog
 */

import { useCallback, useState, type FormEvent, type ReactNode } from 'react';
import type { WhatIfResponse } from '@city-commander/shared-schemas';
import { EmptyState, ErrorState, LoadingIndicator } from '../components/system/async_state.js';
import {
  DataContractWarning,
  FieldList,
  FieldRow,
  NOT_SUPPLIED,
  articleListText,
  textOrUnavailable,
} from '../decision/decision_display.js';
import type { ApiClient } from '../api/client.js';

type WhatIfPhase = 'input' | 'confirming' | 'submitting' | 'answered' | 'clarification' | 'error';

export interface WhatIfDialogProps {
  readonly client: ApiClient;
}

function normalizeQuery(raw: string): string | null {
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}

function decodeWhatIfResponse(
  httpStatus: number,
  body: unknown,
):
  | { kind: 'answered'; data: WhatIfResponse }
  | { kind: 'clarification'; data: WhatIfResponse }
  | { kind: 'http_error'; status: number; message: string } {
  if (httpStatus !== 200) {
    return {
      kind: 'http_error',
      status: httpStatus,
      message: `HTTP ${String(httpStatus)}：伺服器未回傳 What-if 結果`,
    };
  }

  const record = body as Record<string, unknown>;
  const data: WhatIfResponse = {
    schema_version: String(record.schema_version ?? ''),
    trace_id: String(record.trace_id ?? ''),
    request_id: String(record.request_id ?? ''),
    status:
      record.status === 'answered' || record.status === 'clarification_required'
        ? (record.status as 'answered' | 'clarification_required')
        : 'answered',
    triggered_articles: Array.isArray(record.triggered_articles)
      ? (record.triggered_articles as readonly number[])
      : [],
    applied_formula_articles: Array.isArray(record.applied_formula_articles)
      ? (record.applied_formula_articles as readonly number[])
      : [],
    expected_actions: Array.isArray(record.expected_actions)
      ? (record.expected_actions as readonly string[])
      : [],
    ete_preview: record.ete_preview as WhatIfResponse['ete_preview'],
    sop_citations: Array.isArray(record.sop_citations)
      ? (record.sop_citations as WhatIfResponse['sop_citations'])
      : [],
    summary_text: typeof record.summary_text === 'string' ? record.summary_text : undefined,
    explanation_text:
      typeof record.explanation_text === 'string' ? record.explanation_text : undefined,
    clarification_prompt:
      typeof record.clarification_prompt === 'string' ? record.clarification_prompt : undefined,
    does_not_mutate_state: true as const,
    provisional: typeof record.provisional === 'boolean' ? record.provisional : false,
  };

  return data.status === 'clarification_required'
    ? { kind: 'clarification', data }
    : { kind: 'answered', data };
}

export function WhatIfDialog({ client }: WhatIfDialogProps): ReactNode {
  const [queryInput, setQueryInput] = useState('');
  const [phase, setPhase] = useState<WhatIfPhase>('input');
  const [pendingQuery, setPendingQuery] = useState<string | null>(null);
  const [result, setResult] = useState<WhatIfResponse | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleSubmitQuery = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const query = normalizeQuery(queryInput);
      if (query === null) return;
      setPendingQuery(query);
      setPhase('confirming');
    },
    [queryInput],
  );

  const cancelConfirmation = useCallback(() => {
    setPendingQuery(null);
    setPhase('input');
  }, []);

  const confirmAndSubmit = useCallback(() => {
    if (pendingQuery === null) return;
    setPhase('submitting');
    void client
      .postWhatIf(pendingQuery)
      .then((response) => {
        if (!response.ok) {
          setPhase('error');
          setErrorMessage(
            `What-if 請求未能送達（${response.error.code}）：${response.error.message}`,
          );
          return;
        }
        const decoded = decodeWhatIfResponse(response.data.httpStatus, response.data.body);
        if (decoded.kind === 'http_error') {
          setPhase('error');
          setErrorMessage(decoded.message);
          return;
        }
        setResult(decoded.data);
        setPhase(decoded.kind);
      })
      .catch((error: unknown) => {
        setPhase('error');
        setErrorMessage(
          `What-if 請求發生未預期錯誤：${error instanceof Error ? error.message : String(error)}`,
        );
      });
  }, [client, pendingQuery]);

  const startOver = useCallback(() => {
    setQueryInput('');
    setPendingQuery(null);
    setResult(null);
    setErrorMessage(null);
    setPhase('input');
  }, []);

  return (
    <div className="whatif-dialog" data-testid="whatif-dialog">
      <h3 className="whatif-dialog__heading">What-if 假設情境模擬</h3>

      <p className="whatif-dialog__note" data-testid="whatif-mutate-state-notice">
        本功能<strong>不會</strong>變更任何決策核心、執行狀態或持久化資料（
        <code>does_not_mutate_state = true</code>）。所有計算皆為臨時性重跑，結果僅供參考。
      </p>

      {phase === 'input' ? (
        <form
          className="whatif-dialog__form"
          onSubmit={handleSubmitQuery}
          aria-label="What-if 假設情境輸入"
        >
          <label className="whatif-dialog__label" htmlFor="whatif-query">
            假設性問題（例如：若 BL17 人數增至 40000）
          </label>
          <textarea
            id="whatif-query"
            className="whatif-dialog__textarea"
            value={queryInput}
            onChange={(event) => setQueryInput(event.target.value)}
            placeholder="若 BS_MRT_BL17 的 User_Count 增至 40000，會觸發哪些 SOP 條款？"
            rows={3}
            data-testid="whatif-query-input"
            required
          />
          <button
            type="submit"
            className="whatif-dialog__submit"
            data-testid="whatif-submit-button"
            disabled={normalizeQuery(queryInput) === null}
          >
            準備詢問…
          </button>
        </form>
      ) : null}

      {phase === 'confirming' && pendingQuery !== null ? (
        <div
          className="whatif-dialog__confirm"
          role="group"
          aria-label="What-if 確認"
          data-testid="whatif-confirm-group"
        >
          <p className="whatif-dialog__confirm-question" data-testid="whatif-confirm-question">
            確認送出假設情境？此操作<strong>不會</strong>變更任何系統狀態。
          </p>
          <blockquote className="whatif-dialog__confirm-query" data-testid="whatif-confirm-query">
            {pendingQuery}
          </blockquote>
          <button
            type="button"
            className="whatif-dialog__confirm-yes"
            onClick={confirmAndSubmit}
            data-testid="whatif-confirm-button"
          >
            確認詢問
          </button>
          <button
            type="button"
            className="whatif-dialog__confirm-no"
            onClick={cancelConfirmation}
            data-testid="whatif-cancel-button"
          >
            取消
          </button>
        </div>
      ) : null}

      {phase === 'submitting' ? <LoadingIndicator label="What-if 計算中" /> : null}

      {phase === 'error' ? (
        <div data-testid="whatif-error">
          <ErrorState message={errorMessage ?? 'What-if 請求失敗'} />
          <button
            type="button"
            className="whatif-dialog__reset-button"
            onClick={startOver}
            data-testid="whatif-reset-button"
          >
            重新輸入
          </button>
        </div>
      ) : null}

      {phase === 'clarification' && result !== null ? (
        <div data-testid="whatif-clarification">
          <section className="whatif-dialog__section">
            <h4 className="whatif-dialog__subheading">需要更多資訊</h4>
            <p
              className="whatif-dialog__clarification-prompt"
              data-testid="whatif-clarification-prompt"
            >
              {result.clarification_prompt ?? '系統無法唯一判定您的假設情境，請提供更多細節。'}
            </p>
          </section>
          <FieldList>
            <FieldRow label="trace_id">
              <span data-testid="whatif-trace-id">{textOrUnavailable(result.trace_id)}</span>
            </FieldRow>
            <FieldRow label="request_id">
              <span data-testid="whatif-request-id">{textOrUnavailable(result.request_id)}</span>
            </FieldRow>
          </FieldList>
          <button
            type="button"
            className="whatif-dialog__reset-button"
            onClick={startOver}
            data-testid="whatif-reset-button"
          >
            重新輸入
          </button>
        </div>
      ) : null}

      {phase === 'answered' && result !== null ? (
        <div data-testid="whatif-answered">
          <section className="whatif-dialog__section">
            <h4 className="whatif-dialog__subheading">套用的公式條款</h4>
            <p data-testid="whatif-applied-articles">
              {articleListText(result.applied_formula_articles)}
            </p>
          </section>

          <section className="whatif-dialog__section">
            <h4 className="whatif-dialog__subheading">預期動作</h4>
            <ul data-testid="whatif-expected-actions">
              {result.expected_actions.length === 0 ? (
                <li>無</li>
              ) : (
                result.expected_actions.map((action, index) => <li key={index}>{action}</li>)
              )}
            </ul>
          </section>

          {result.ete_preview !== undefined ? (
            <section className="whatif-dialog__section">
              <h4 className="whatif-dialog__subheading">ETE 預覽</h4>
              <p data-testid="whatif-ete-preview">
                預計恢復時間：{String(result.ete_preview.ete_minutes)} 分鐘
              </p>
            </section>
          ) : null}

          {result.sop_citations.length > 0 ? (
            <section className="whatif-dialog__section">
              <h4 className="whatif-dialog__subheading">SOP 引用</h4>
              <dl data-testid="whatif-sop-citations">
                {result.sop_citations.map((citation) => (
                  <div key={citation.article_no}>
                    <dt>第 {String(citation.article_no)} 條</dt>
                    <dd>{citation.content}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ) : null}

          <section className="whatif-dialog__section">
            <h4 className="whatif-dialog__subheading">詳細 AI 解釋</h4>
            {result.summary_text !== undefined ? (
              <p data-testid="whatif-summary" className="whatif-dialog__summary">
                {result.summary_text}
              </p>
            ) : null}
            <p data-testid="whatif-triggered-articles">
              觸發的 SOP 條款：{articleListText(result.triggered_articles)}
            </p>
            {result.explanation_text !== undefined ? (
              <p data-testid="whatif-explanation">{result.explanation_text}</p>
            ) : null}
          </section>

          <FieldList>
            <FieldRow label="trace_id">
              <span data-testid="whatif-trace-id">{textOrUnavailable(result.trace_id)}</span>
            </FieldRow>
            <FieldRow label="request_id">
              <span data-testid="whatif-request-id">{textOrUnavailable(result.request_id)}</span>
            </FieldRow>
            <FieldRow label="does_not_mutate_state">
              <span data-testid="whatif-no-mutate">
                {result.does_not_mutate_state ? 'true' : NOT_SUPPLIED}
              </span>
            </FieldRow>
            {result.provisional ? (
              <FieldRow label="provisional">
                <span
                  className="decision-badge decision-badge--provisional"
                  data-testid="whatif-provisional-badge"
                >
                  暫定政策
                </span>
              </FieldRow>
            ) : null}
          </FieldList>

          <button
            type="button"
            className="whatif-dialog__reset-button"
            onClick={startOver}
            data-testid="whatif-reset-button"
          >
            啟動新的假設情境
          </button>
        </div>
      ) : null}
    </div>
  );
}
