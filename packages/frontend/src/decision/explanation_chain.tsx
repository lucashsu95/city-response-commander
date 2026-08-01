/**
 * Explanation Chain Panel (§10.10, §14.2, §16, R15, P26/P27; TASK-129)
 *
 * Renders WHY the decision came out the way it did: the grading reasoning with
 * its supporting data points, the reason every candidate route was excluded, and
 * the SOP citations covering `citation_article_set`
 * (= `triggered_articles ∪ applied_formula_articles`, so article 7 appears
 * whenever the ETE formula was applied).
 *
 * Deterministic boundary (§9, R15.5):
 * - the grading conclusion is the backend's. The value and the threshold text
 *   beside it are evidence *shown to the operator*, never re-evaluated here — a
 *   saturation of 0.97 next to a backend conclusion of `B` renders as `B`.
 * - the citation set is a union of two authoritative backend arrays, used to lay
 *   the citations out and to name a gap. No article is inferred from a threshold.
 * - a missing exclusion reason is surfaced as a data-contract error. R13.3 makes
 *   the non-empty reason the server's guarantee, and inventing one here would be
 *   exactly the failure this panel exists to prevent.
 * - Bedrock's `EXPLANATION` text is rendered as explanation only, after the
 *   deterministic facts, and is replaced by the labelled §21.3 template when it
 *   has not been committed yet.
 *
 * HG-001 amendment (tasks.md TASK-129): observation selection, affected-set
 * construction, the common timestamp and the formula substitution are displayed
 * when the backend supplies them. The live `EvidenceTrace` does not carry those
 * four §10.10 blocks yet, so each has an explicit "not supplied" disclosure
 * instead of a client-side reconstruction.
 *
 * @module frontend/decision/explanation_chain
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
  AiTextBadge,
  DataContractWarning,
  DeterministicBadge,
  FieldList,
  FieldRow,
  NOT_SUPPLIED,
  NotSuppliedNote,
  ProvisionalBadge,
  TemplateBadge,
  booleanText,
  idListText,
  numberText,
  textOrUnavailable,
} from './decision_display.js';
import type { DecisionCoreView } from './decision_read_model.js';
import { citationCoverage } from './evidence_model.js';
import type {
  AffectedSetConstructionView,
  ClassificationReasoningView,
  DataPointView,
  EvidenceTraceView,
  ExcludedRouteReasonView,
  FormulaSubstitutionView,
  ObservationSelectionView,
  PolicyProvenanceView,
  SopCitationView,
} from './evidence_model.js';
import { buildExplanationTemplate } from './narrative_fallback.js';
import type { DecisionReadModelState } from './use_decision_read_model.js';
import type { EvidenceViewResult } from './use_evidence_view.js';

/** Renders a data-point value in its original wire form. */
function dataPointValueText(value: string | number | boolean | null): string {
  if (value === null) return '尚無資料';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value);
}

// ─── Grading Reasoning (R15.1) ───────────────────────────────

function ClassificationReasoningTable({
  rows,
}: {
  readonly rows: readonly ClassificationReasoningView[];
}): ReactNode {
  return (
    <section className="explanation-chain__section" aria-labelledby="explanation-grading-heading">
      <h4 id="explanation-grading-heading" className="explanation-chain__subheading">
        分級判定推理 <DeterministicBadge />
      </h4>
      {rows.length === 0 ? (
        <EmptyState message="後端未提供分級判定推理" />
      ) : (
        <table className="explanation-chain__table">
          <caption className="explanation-chain__table-caption">
            數值與門檻為佐證，結論由後端規則引擎判定；前端不重新套用門檻
          </caption>
          <thead>
            <tr>
              <th scope="col">路段</th>
              <th scope="col">飽和度數值</th>
              <th scope="col">套用門檻</th>
              <th scope="col">判定結論</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.segmentId} data-reasoning-segment={row.segmentId}>
                <th scope="row">{row.segmentId}</th>
                <td data-testid={`reasoning-value-${row.segmentId}`}>{numberText(row.value)}</td>
                <td>{textOrUnavailable(row.threshold)}</td>
                <td data-testid={`reasoning-conclusion-${row.segmentId}`}>
                  {textOrUnavailable(row.conclusion)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

// ─── Data Points (R15.1 佐證) ────────────────────────────────

function DataPointTable({ rows }: { readonly rows: readonly DataPointView[] }): ReactNode {
  return (
    <section className="explanation-chain__section" aria-labelledby="explanation-data-heading">
      <h4 id="explanation-data-heading" className="explanation-chain__subheading">
        資料佐證
      </h4>
      {rows.length === 0 ? (
        <EmptyState message="後端未提供任何資料點" />
      ) : (
        <table className="explanation-chain__table">
          <caption className="explanation-chain__table-caption">
            判定所引用之官方來源欄位與時間戳，逐字呈現
          </caption>
          <thead>
            <tr>
              <th scope="col">來源</th>
              <th scope="col">欄位</th>
              <th scope="col">數值</th>
              <th scope="col">時間戳</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={`${row.source ?? 'unknown'}-${row.field ?? 'unknown'}-${index}`}>
                <td>{textOrUnavailable(row.source)}</td>
                <td>{textOrUnavailable(row.field)}</td>
                <td>{dataPointValueText(row.value)}</td>
                <td>{textOrUnavailable(row.timestamp)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

// ─── Exclusion Reasons (R15.2 / R13.3) ───────────────────────

function ExclusionReasonList({
  rows,
}: {
  readonly rows: readonly ExcludedRouteReasonView[];
}): ReactNode {
  const missing = rows.filter((row) => row.reason === null);

  return (
    <section className="explanation-chain__section" aria-labelledby="explanation-exclusion-heading">
      <h4 id="explanation-exclusion-heading" className="explanation-chain__subheading">
        替代道路排除理由 <DeterministicBadge />
      </h4>
      {rows.length === 0 ? (
        <EmptyState message="本決策未排除任何替代道路" />
      ) : (
        <ul className="explanation-chain__exclusions">
          {rows.map((row) => (
            <li
              key={row.segmentId}
              className="explanation-chain__exclusion"
              data-excluded-segment={row.segmentId}
            >
              <span className="explanation-chain__exclusion-segment">{row.segmentId}</span>
              <span className="explanation-chain__exclusion-reason">
                {row.reason ?? '後端未提供排除理由（違反 R13.3 非空理由保證）'}
              </span>
            </li>
          ))}
        </ul>
      )}
      {missing.length > 0 ? (
        <DataContractWarning
          message={`以下被排除路段缺少非空排除理由：${idListText(
            missing.map((row) => row.segmentId),
          )}`}
        />
      ) : null}
    </section>
  );
}

// ─── SOP Citations (R15.3, §14.2, P27) ───────────────────────

function CitationView({ citation }: { readonly citation: SopCitationView }): ReactNode {
  return (
    <li className="explanation-chain__citation" data-citation-article={citation.articleNo}>
      <p className="explanation-chain__citation-location">
        來源位置：{textOrUnavailable(citation.sourceLocation)}
      </p>
      <blockquote className="explanation-chain__citation-content">
        {textOrUnavailable(citation.content)}
      </blockquote>
      <p className="explanation-chain__citation-score">相關度分數：{numberText(citation.score)}</p>
    </li>
  );
}

function CitationSection({
  core,
  citations,
}: {
  readonly core: DecisionCoreView;
  readonly citations: readonly SopCitationView[];
}): ReactNode {
  const coverage = citationCoverage(core.triggeredArticles, core.appliedFormulaArticles, citations);

  return (
    <section className="explanation-chain__section" aria-labelledby="explanation-citation-heading">
      <h4 id="explanation-citation-heading" className="explanation-chain__subheading">
        SOP 條款引用 <DeterministicBadge />
      </h4>
      <p className="explanation-chain__note">
        引用集合 = 觸發條款 ∪ 套用公式條款（§14.2）；套用第 7 條公式時，第 7 條亦納入引用而
        <strong>不</strong>計為觸發條款。
      </p>
      {coverage.rows.length === 0 ? (
        <EmptyState message="後端未提供任何觸發或套用公式條款，故無引用集合" />
      ) : (
        <ol className="explanation-chain__articles">
          {coverage.rows.map((row) => (
            <li
              key={row.articleNo}
              className="explanation-chain__article"
              data-article-no={row.articleNo}
            >
              <h5 className="explanation-chain__article-heading">
                SOP 第 {row.articleNo} 條（
                {[row.triggered ? '觸發' : null, row.appliedFormula ? '套用公式' : null]
                  .filter((label): label is string => label !== null)
                  .join('、')}
                ）
              </h5>
              {row.citations.length === 0 ? (
                <p className="explanation-chain__citation-missing">後端未提供本條款之引用段落</p>
              ) : (
                <ul className="explanation-chain__citation-list">
                  {row.citations.map((citation, index) => (
                    <CitationView
                      key={`${citation.articleNo}-${citation.sourceLocation ?? index}`}
                      citation={citation}
                    />
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ol>
      )}
      {coverage.missingArticles.length > 0 ? (
        <DataContractWarning
          message={`引用集合中缺少引用段落之條款：第 ${coverage.missingArticles.join('、')} 條（§14.2 要求逐條保真引用）`}
        />
      ) : null}
      {coverage.extraneousArticles.length > 0 ? (
        <DataContractWarning
          message={`引用段落超出引用集合之條款：第 ${coverage.extraneousArticles.join('、')} 條`}
        />
      ) : null}
    </section>
  );
}

// ─── HG-001 Evidence Blocks (§10.10) ─────────────────────────

function ObservationSelectionSection({
  rows,
}: {
  readonly rows: readonly ObservationSelectionView[] | null;
}): ReactNode {
  return (
    <section
      className="explanation-chain__section"
      aria-labelledby="explanation-observation-heading"
    >
      <h4 id="explanation-observation-heading" className="explanation-chain__subheading">
        觀測選取（HG-001 / Strategy A） <ProvisionalBadge />
      </h4>
      {rows === null ? (
        <NotSuppliedNote message="後端未提供 evidence.observation_selection（設計 §10.10 欄位）；前端不代算 cutoff、觀測時間或 staleness。" />
      ) : rows.length === 0 ? (
        <EmptyState message="後端提供了空的觀測選取清單" />
      ) : (
        <table className="explanation-chain__table">
          <thead>
            <tr>
              <th scope="col">實體</th>
              <th scope="col">決策截止</th>
              <th scope="col">選取觀測時間</th>
              <th scope="col">staleness</th>
              <th scope="col">精確對齊</th>
              <th scope="col">選取模式</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={`${row.entityId ?? 'unknown'}-${index}`}>
                <th scope="row">{textOrUnavailable(row.entityId)}</th>
                <td>{textOrUnavailable(row.cutoff)}</td>
                <td>{textOrUnavailable(row.observationTimestamp)}</td>
                <td>{numberText(row.staleness)}</td>
                <td>{booleanText(row.exactMatch)}</td>
                <td>{textOrUnavailable(row.mode)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function AffectedSetSection({
  rows,
}: {
  readonly rows: readonly AffectedSetConstructionView[] | null;
}): ReactNode {
  return (
    <section className="explanation-chain__section" aria-labelledby="explanation-affected-heading">
      <h4 id="explanation-affected-heading" className="explanation-chain__subheading">
        ETE 受影響集合建構（HG-001 / Strategy C） <ProvisionalBadge />
      </h4>
      {rows === null ? (
        <NotSuppliedNote message="後端未提供 evidence.affected_set_construction（設計 §10.10 欄位）；路段角色與納入理由不由前端推定。" />
      ) : rows.length === 0 ? (
        <EmptyState message="後端提供了空的受影響集合建構清單" />
      ) : (
        <table className="explanation-chain__table">
          <thead>
            <tr>
              <th scope="col">路段</th>
              <th scope="col">角色</th>
              <th scope="col">是否納入</th>
              <th scope="col">理由</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.segmentId} data-affected-segment={row.segmentId}>
                <th scope="row">{row.segmentId}</th>
                <td>{textOrUnavailable(row.role)}</td>
                <td>{booleanText(row.included)}</td>
                <td>{textOrUnavailable(row.reason)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}

function FormulaSubstitutionSection({
  substitution,
}: {
  readonly substitution: FormulaSubstitutionView | null;
}): ReactNode {
  return (
    <section className="explanation-chain__section" aria-labelledby="explanation-formula-heading">
      <h4 id="explanation-formula-heading" className="explanation-chain__subheading">
        公式代入（HG-001）
      </h4>
      {substitution === null ? (
        <NotSuppliedNote message="後端未提供 evidence.formula_substitution（設計 §10.10 欄位）；完整代入請見 ETE 面板，前端不自行加總或平均。" />
      ) : (
        <FieldList>
          <FieldRow label="飽和度總和">{numberText(substitution.sum)}</FieldRow>
          <FieldRow label="路段筆數">{numberText(substitution.count)}</FieldRow>
          <FieldRow label="平均飽和度">{numberText(substitution.average)}</FieldRow>
          <FieldRow label="基礎清除時間">{numberText(substitution.base)}</FieldRow>
          <FieldRow label="壅塞加乘">{numberText(substitution.penalty)}</FieldRow>
          <FieldRow label="ETE">{numberText(substitution.ete)}</FieldRow>
        </FieldList>
      )}
    </section>
  );
}

function PolicyProvenanceSection({
  provenance,
  core,
}: {
  readonly provenance: PolicyProvenanceView | null;
  readonly core: DecisionCoreView;
}): ReactNode {
  return (
    <section
      className="explanation-chain__section"
      aria-labelledby="explanation-provenance-heading"
    >
      <h4 id="explanation-provenance-heading" className="explanation-chain__subheading">
        政策來源（HG-001） <ProvisionalBadge />
      </h4>
      {provenance === null ? (
        <NotSuppliedNote message="後端未提供 evidence.policy_provenance（設計 §10.10 欄位）；以下改自 core.policy 之政策揭露。" />
      ) : (
        <FieldList>
          <FieldRow label="政策模式">{textOrUnavailable(provenance.policyMode)}</FieldRow>
          <FieldRow label="指引依據">{textOrUnavailable(provenance.guidanceId)}</FieldRow>
          <FieldRow label="是否可配置">{booleanText(provenance.configurable)}</FieldRow>
        </FieldList>
      )}
      <FieldList>
        <FieldRow label="時間對齊模式">
          {textOrUnavailable(core.policy?.timeAlignmentMode ?? null)}
        </FieldRow>
        <FieldRow label="ETE 受影響集合模式">
          {textOrUnavailable(core.policy?.eteAffectedSetMode ?? null)}
        </FieldRow>
        <FieldRow label="錨點解析模式">
          {textOrUnavailable(core.policy?.incidentAnchorMode ?? null)}
        </FieldRow>
        <FieldRow label="指引依據（core.policy）">
          {textOrUnavailable(core.policy?.guidanceId ?? null)}
        </FieldRow>
      </FieldList>
    </section>
  );
}

// ─── AI Explanation (§21.3) ──────────────────────────────────

function ExplanationNarrativeSection({
  core,
  evidence,
  explanationText,
  missingNarrativeTypes,
}: {
  readonly core: DecisionCoreView;
  readonly evidence: EvidenceTraceView;
  readonly explanationText: string | null;
  readonly missingNarrativeTypes: readonly string[];
}): ReactNode {
  const hasNarrative = explanationText !== null && explanationText !== '';
  const template = hasNarrative ? null : buildExplanationTemplate(core, evidence);

  return (
    <section className="explanation-chain__section" aria-labelledby="explanation-text-heading">
      <h4 id="explanation-text-heading" className="explanation-chain__subheading">
        推理說明文字
      </h4>
      {hasNarrative ? (
        <>
          <p className="explanation-chain__badges">
            <AiTextBadge />
          </p>
          <p className="explanation-chain__narrative" data-testid="explanation-narrative">
            {explanationText}
          </p>
        </>
      ) : (
        <>
          <p className="explanation-chain__badges">
            <TemplateBadge />
          </p>
          <p className="explanation-chain__narrative" data-testid="explanation-narrative-template">
            {template?.text ?? '後端尚無可代入之解釋鏈事實，未產生模板文字'}
          </p>
          <p className="explanation-chain__note">
            EXPLANATION 敘述尚未產出（
            {missingNarrativeTypes.length === 0
              ? '後端未列出缺少的敘述項目'
              : `缺少：${idListText(missingNarrativeTypes)}`}
            ）；以上為決定性系統模板，非 AI 生成。
          </p>
          {template !== null && template.omittedFields.length > 0 ? (
            <p className="explanation-chain__note" data-testid="explanation-template-omitted">
              模板省略之欠缺欄位：{idListText(template.omittedFields)}
            </p>
          ) : null}
        </>
      )}
      <p className="explanation-chain__note">
        說明文字僅重述上方決定性事實，不得改寫任何數值或布林真值（R15.5）。
      </p>
    </section>
  );
}

// ─── Panel ───────────────────────────────────────────────────

export interface ExplanationChainProps {
  readonly decision: DecisionReadModelState;
  /** Decoded `core.evidence`, from {@link useEvidenceView}. */
  readonly evidence: EvidenceViewResult;
  /** Retries the initial (non-background) read. */
  readonly onRetry: () => void;
}

/**
 * Explanation chain panel (TASK-129).
 *
 * State → UI mapping:
 * - `idle` → explicit "no decision identified yet"
 * - `loading` → {@link LoadingIndicator}
 * - `error` → {@link ErrorState} plus a retry control
 * - `insufficient_data` → the backend STOP: no core, so no reasoning to show
 * - `ready` / `partial` → the deterministic chain, with the AI text or the
 *   labelled §21.3 template
 * - a core whose mandatory `evidence` block is malformed → a data-contract
 *   error, never an empty reasoning list
 */
export function ExplanationChain({
  decision,
  evidence,
  onRetry,
}: ExplanationChainProps): ReactNode {
  const { t } = useI18n();
  const { state, error, core } = decision;

  if (state === 'idle') {
    return (
      <div className="explanation-chain">
        <EmptyState message={t('explanation.idle')} />
      </div>
    );
  }

  if (state === 'loading') {
    return (
      <div className="explanation-chain">
        <LoadingIndicator label={t('explanation.loading')} />
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="explanation-chain">
        <ErrorState
          message={error === null ? t('explanation.errorFallback') : `${t('explanation.errorFallback')}：${error.message}`}
        />
        <button type="button" className="explanation-chain__retry" onClick={onRetry}>
          {t('action.retry')}
        </button>
      </div>
    );
  }

  if (state === 'insufficient_data' || core === null) {
    return (
      <div className="explanation-chain">
        <h3 className="explanation-chain__heading">{t('explanation.heading')}</h3>
        <InsufficientDataState message="尚無已提交的決策核心，無可揭露之推理過程" />
      </div>
    );
  }

  return (
    <div className="explanation-chain">
      <h3 className="explanation-chain__heading">{t('explanation.heading')}</h3>

      <div
        className="explanation-chain__status"
        role={decision.refreshStatus === 'refreshing' ? undefined : 'status'}
        aria-live="polite"
      >
        {decision.refreshStatus === 'refreshing' ? (
          <CometSpinner
            className="loading-spinner--inline"
            label={t('explanation.refreshing')}
          />
        ) : null}
        {decision.refreshStatus === 'idle' && error !== null
          ? t('async.backgroundError', { message: error.message })
          : null}
      </div>

      {decision.provisional === true ? (
        <ProvisionalBadge>本推理鏈含暫定政策（Strategy A–F）之結論</ProvisionalBadge>
      ) : null}

      {evidence.kind === 'error' ? (
        <>
          <DataContractWarning
            message={`core.evidence 無法解析（${evidence.error.code}）：${evidence.error.message}。R15 要求必附解釋鏈，故不以空白推理呈現。`}
          />
          <FieldList>
            <FieldRow label="觸發條款">{idListText(core.triggeredArticles.map(String))}</FieldRow>
            <FieldRow label="套用公式條款">
              {idListText(core.appliedFormulaArticles.map(String))}
            </FieldRow>
            <FieldRow label="決策截止時間">{core.decisionCutoffTimestamp ?? NOT_SUPPLIED}</FieldRow>
          </FieldList>
        </>
      ) : evidence.kind === 'absent' ? (
        <InsufficientDataState message="無決策核心，故無 EvidenceTrace" />
      ) : (
        <>
          <ClassificationReasoningTable rows={evidence.evidence.classificationReasoning} />
          <DataPointTable rows={evidence.evidence.dataPoints} />
          <ExclusionReasonList rows={evidence.evidence.excludedRoutes} />
          <CitationSection core={core} citations={evidence.evidence.sopCitations} />
          <ObservationSelectionSection rows={evidence.evidence.observationSelection} />
          <AffectedSetSection rows={evidence.evidence.affectedSetConstruction} />
          <FormulaSubstitutionSection substitution={evidence.evidence.formulaSubstitution} />
          <PolicyProvenanceSection provenance={evidence.evidence.policyProvenance} core={core} />
          <ExplanationNarrativeSection
            core={core}
            evidence={evidence.evidence}
            explanationText={decision.explanation?.explanationText ?? null}
            missingNarrativeTypes={decision.missingNarrativeTypes}
          />
        </>
      )}
    </div>
  );
}
