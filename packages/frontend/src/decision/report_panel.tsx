/**
 * Command-Centre Report Panel (§10.12, §16, R13; TASK-132)
 *
 * Renders the交控中心建議書 from the `GET /decisions/{decision_id}` read model:
 * the deterministic core facts a commander issues orders from, plus the
 * Bedrock-written `REPORT` narrative — kept visually and semantically separate.
 *
 * P37 boundary, enforced by layout: `cms_core_text` is the official CMS wording
 * written by `DecisionFn` and is LLM-prohibited (§10.11a); `cms_explanation_text`
 * is supplementary AI wording. The core text is rendered first, in its own
 * block, marked deterministic; the AI explanation is rendered after it, marked
 * as AI text that must not replace core values. The AI text can never occupy the
 * core-text slot, even when the core text is absent — in that case the slot says
 * so explicitly.
 *
 * When the `REPORT` narrative has not been committed yet (`data_status=partial`,
 * the normal Fast Path state, or a Bedrock outage) the narrative slot shows the
 * deterministic §21.3 template, labelled 「系統模板」 — never a blank panel and
 * never an invented value.
 *
 * This panel performs NO deterministic judgement. It does not classify a
 * segment, evaluate an SOP threshold, rank a route, or compute an ETE. Route
 * exclusion reasons (TASK-130), the evidence chain and citations (TASK-129) and
 * the full ETE calculation basis (TASK-131) are rendered by their own panels in
 * the same region; this panel shows the report-level facts of §10.12 only.
 *
 * @module frontend/decision/report_panel
 */

import type { ReactNode } from 'react';
import {
  EmptyState,
  ErrorState,
  InsufficientDataState,
  LoadingIndicator,
} from '../components/system/async_state.js';
import {
  AiTextBadge,
  DeterministicBadge,
  FieldList,
  FieldRow,
  ManualConfirmationNotice,
  NOT_SUPPLIED,
  ProvisionalBadge,
  TemplateBadge,
  articleListText,
  booleanText,
  idListText,
  numberText,
  textOrUnavailable,
} from './decision_display.js';
import type { DecisionCoreView, SegmentClassificationView } from './decision_read_model.js';
import { buildReportTemplate } from './narrative_fallback.js';
import type { DecisionReadModelState } from './use_decision_read_model.js';

/**
 * Canonical spelling of the "no ETE was computed" status, as design §10.9
 * writes it. The live wire spells the same state `insufficient_common_snapshot`
 * (see the drift note in `ete_model.ts`); both are recognized so the panel
 * behaves correctly against either, and neither is rewritten on screen.
 */
function isInsufficientEte(status: string | null): boolean {
  return status === 'INSUFFICIENT_COMMON_SNAPSHOT' || status === 'insufficient_common_snapshot';
}

// ─── Event Identification (R13.1) ────────────────────────────

function EventIdentification({ core }: { readonly core: DecisionCoreView }): ReactNode {
  return (
    <section className="report-panel__section" aria-labelledby="report-event-heading">
      <h4 id="report-event-heading" className="report-panel__subheading">
        事件辨識
      </h4>
      <FieldList>
        <FieldRow label="事件編號">{textOrUnavailable(core.eventId)}</FieldRow>
        <FieldRow label="事件時間">{textOrUnavailable(core.occurredAt)}</FieldRow>
        <FieldRow label="事件位置">{textOrUnavailable(core.eventFacts?.location ?? null)}</FieldRow>
        <FieldRow label="事件類型">{textOrUnavailable(core.eventFacts?.type ?? null)}</FieldRow>
        <FieldRow label="事件狀態">{textOrUnavailable(core.eventFacts?.status ?? null)}</FieldRow>
        <FieldRow label="嚴重度">{textOrUnavailable(core.eventFacts?.severity ?? null)}</FieldRow>
        <FieldRow label="受影響路段">
          {textOrUnavailable(core.eventFacts?.affectedSegment ?? null)}
        </FieldRow>
        <FieldRow
          label="contextual affected_road"
          marker={<ProvisionalBadge>DISPLAY_AND_CONTEXT_ONLY</ProvisionalBadge>}
        >
          {textOrUnavailable(core.eventFacts?.affectedRoad ?? null)}
        </FieldRow>
        <FieldRow label="觸發條款">{articleListText(core.triggeredArticles)}</FieldRow>
        <FieldRow label="套用公式條款">{articleListText(core.appliedFormulaArticles)}</FieldRow>
        <FieldRow label="啟用程序">{idListText(core.invokedProcedures)}</FieldRow>
      </FieldList>
      <p className="report-panel__note">
        contextual affected_road 僅供顯示與事件背景，不進入 ETE 集合、不觸發第 1/2 條（§10.9b）。
      </p>
    </section>
  );
}

// ─── Classification (R13.2) ──────────────────────────────────

function ClassificationSection({
  classifications,
}: {
  readonly classifications: readonly SegmentClassificationView[];
}): ReactNode {
  return (
    <section className="report-panel__section" aria-labelledby="report-classification-heading">
      <h4 id="report-classification-heading" className="report-panel__subheading">
        交通分級判定
      </h4>
      {classifications.length === 0 ? (
        <EmptyState message="後端未提供任何路段分級" />
      ) : (
        <table className="report-panel__table">
          <caption className="report-panel__table-caption">
            分級由後端規則引擎判定，前端不重算門檻
          </caption>
          <thead>
            <tr>
              <th scope="col">路段</th>
              <th scope="col">級別</th>
            </tr>
          </thead>
          <tbody>
            {classifications.map((row) => (
              <tr key={row.segmentId} data-segment-id={row.segmentId}>
                <th scope="row">{row.segmentId}</th>
                <td data-level={row.level ?? ''}>{textOrUnavailable(row.level)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="report-panel__note">
        分級所依據之飽和度數值與門檻，見解釋鏈面板之判定推理與資料點。
      </p>
    </section>
  );
}

// ─── Routes (R13.3) + ETE (R13.6) ────────────────────────────

function RouteSummarySection({ core }: { readonly core: DecisionCoreView }): ReactNode {
  return (
    <section className="report-panel__section" aria-labelledby="report-route-heading">
      <h4 id="report-route-heading" className="report-panel__subheading">
        疏散路徑建議
      </h4>
      <FieldList>
        <FieldRow
          label="主疏散路徑"
          marker={<ProvisionalBadge>Strategy A/D 相依</ProvisionalBadge>}
        >
          <span data-testid="report-primary-evacuation">
            {core.primaryEvacuation === null ? '尚未確定（需人工確認）' : core.primaryEvacuation}
          </span>
        </FieldRow>
        <FieldRow label="次要疏散路徑">{idListText(core.secondaryEvacuation)}</FieldRow>
      </FieldList>
      <p className="report-panel__note">
        候選路段之排除理由與上下游判定，見替代路徑面板（SOP 第 2 條）。
      </p>
    </section>
  );
}

function EteSummarySection({ core }: { readonly core: DecisionCoreView }): ReactNode {
  const ete = core.ete;

  if (ete === null) {
    return (
      <section className="report-panel__section" aria-labelledby="report-ete-heading">
        <h4 id="report-ete-heading" className="report-panel__subheading">
          預計恢復時間（ETE）
        </h4>
        <InsufficientDataState message="後端未提供 ETE 區塊，未顯示任何恢復時間" />
      </section>
    );
  }

  const insufficient = isInsufficientEte(ete.calculationStatus);

  return (
    <section className="report-panel__section" aria-labelledby="report-ete-heading">
      <h4 id="report-ete-heading" className="report-panel__subheading">
        預計恢復時間（ETE）
      </h4>
      <FieldList>
        <FieldRow label="ETE（分鐘）" marker={<DeterministicBadge />}>
          <span data-testid="report-ete-minutes">
            {ete.eteMinutes === null ? '未計算（無共同快照）' : numberText(ete.eteMinutes)}
          </span>
        </FieldRow>
        <FieldRow label="計算狀態">{textOrUnavailable(ete.calculationStatus)}</FieldRow>
        {ete.eteMinutes === null ? (
          <FieldRow label="已知下限（分鐘）">
            {numberText(ete.eteLowerBoundMinutes ?? ete.baseClearance)}
          </FieldRow>
        ) : null}
      </FieldList>
      {insufficient ? (
        <InsufficientDataState message="無共同 exact 快照，僅呈現下限，不顯示虛構 ETE（R13.9）" />
      ) : null}
      {ete.manualConfirmationRequired === true ? (
        <ManualConfirmationNotice message="ETE 僅為下限，需人工確認後方可作為恢復時程" />
      ) : null}
      <p className="report-panel__note">
        完整計算依據（受影響路段角色、各路段飽和度、總和/筆數/平均、公式代入與 HG-001 指引來源）見
        ETE 面板。
      </p>
    </section>
  );
}

// ─── CMS Text (P37) ──────────────────────────────────────────

function CmsSection({
  core,
  cmsExplanationText,
}: {
  readonly core: DecisionCoreView;
  readonly cmsExplanationText: string | null;
}): ReactNode {
  return (
    <section
      className="report-panel__section report-panel__cms"
      aria-labelledby="report-cms-heading"
    >
      <h4 id="report-cms-heading" className="report-panel__subheading">
        CMS 發布文字
      </h4>

      <div className="report-panel__cms-core">
        <h5 className="report-panel__cms-label">
          決定性核心文字 cms_core_text <DeterministicBadge />
        </h5>
        <p className="report-panel__cms-text" data-testid="cms-core-text">
          {core.cmsCoreText === null || core.cmsCoreText === ''
            ? '後端未提供 cms_core_text；不以任何 AI 文字替代'
            : core.cmsCoreText}
        </p>
      </div>

      <div className="report-panel__cms-explanation">
        <h5 className="report-panel__cms-label">
          AI 補充說明 cms_explanation_text <AiTextBadge />
        </h5>
        <p className="report-panel__cms-text" data-testid="cms-explanation-text">
          {cmsExplanationText === null || cmsExplanationText === ''
            ? '尚無 AI 補充說明'
            : cmsExplanationText}
        </p>
        <p className="report-panel__note">
          補充說明僅解釋上方核心文字，不得改寫路段、ETE 或官方指令。
        </p>
      </div>
    </section>
  );
}

// ─── Narrative (R13.7 / §21.3) ───────────────────────────────

function NarrativeSection({
  core,
  reportText,
  citationsPresentation,
  missingNarrativeTypes,
}: {
  readonly core: DecisionCoreView;
  readonly reportText: string | null;
  readonly citationsPresentation: string | null;
  readonly missingNarrativeTypes: readonly string[];
}): ReactNode {
  const hasNarrative = reportText !== null && reportText !== '';
  const template = hasNarrative ? null : buildReportTemplate(core);

  return (
    <section className="report-panel__section" aria-labelledby="report-narrative-heading">
      <h4 id="report-narrative-heading" className="report-panel__subheading">
        建議書內文
      </h4>
      {hasNarrative ? (
        <>
          <p className="report-panel__badges">
            <AiTextBadge />
          </p>
          <p className="report-panel__narrative" data-testid="report-narrative">
            {reportText}
          </p>
        </>
      ) : (
        <>
          <p className="report-panel__badges">
            <TemplateBadge />
          </p>
          <p className="report-panel__narrative" data-testid="report-narrative-template">
            {template?.text ?? '後端尚未提供任何可代入之決定性事實，未產生模板文字'}
          </p>
          <p className="report-panel__note">
            REPORT 敘述尚未產出（
            {missingNarrativeTypes.length === 0
              ? '後端未列出缺少的敘述項目'
              : `缺少：${idListText(missingNarrativeTypes)}`}
            ）；以上為決定性系統模板，非 AI 生成。
          </p>
          {template !== null && template.omittedFields.length > 0 ? (
            <p className="report-panel__note" data-testid="report-template-omitted">
              模板省略之欠缺欄位：{idListText(template.omittedFields)}
            </p>
          ) : null}
        </>
      )}
      <FieldList>
        <FieldRow label="引用呈現格式">{textOrUnavailable(citationsPresentation)}</FieldRow>
      </FieldList>
    </section>
  );
}

// ─── Provenance Header ───────────────────────────────────────

function ProvenanceHeader({ decision }: { readonly decision: DecisionReadModelState }): ReactNode {
  const core = decision.core;
  return (
    <section className="report-panel__section" aria-labelledby="report-provenance-heading">
      <h4 id="report-provenance-heading" className="report-panel__subheading">
        決策來源與政策
      </h4>
      {decision.provisional === true ? (
        <ProvisionalBadge>本決策含暫定政策（Strategy A–F），非官方標準答案</ProvisionalBadge>
      ) : null}
      {decision.provisional === null ? (
        <span className="decision-badge decision-badge--unknown" role="note">
          後端未提供 provisional 狀態
        </span>
      ) : null}
      <FieldList>
        <FieldRow label="決策識別">{textOrUnavailable(decision.decisionId)}</FieldRow>
        <FieldRow label="追蹤識別">{textOrUnavailable(decision.traceId)}</FieldRow>
        <FieldRow label="資料狀態">{textOrUnavailable(decision.dataStatus)}</FieldRow>
        <FieldRow label="schema 版本">{textOrUnavailable(decision.schemaVersion)}</FieldRow>
        <FieldRow label="政策版本">{textOrUnavailable(decision.policyVersion)}</FieldRow>
        <FieldRow label="來源清單雜湊">{textOrUnavailable(decision.sourceManifestHash)}</FieldRow>
        <FieldRow label="核心版本">{numberText(core?.version ?? null)}</FieldRow>
        <FieldRow label="決策截止時間">
          {core?.decisionCutoffTimestamp === null || core?.decisionCutoffTimestamp === undefined
            ? NOT_SUPPLIED
            : core.decisionCutoffTimestamp}
        </FieldRow>
        <FieldRow label="政策分類">
          {textOrUnavailable(core?.policy?.classification ?? null)}
        </FieldRow>
        <FieldRow label="政策狀態">{textOrUnavailable(core?.policy?.status ?? null)}</FieldRow>
        <FieldRow label="是否官方規則">{booleanText(core?.policy?.isOfficial ?? null)}</FieldRow>
        <FieldRow label="指引依據">{textOrUnavailable(core?.policy?.guidanceId ?? null)}</FieldRow>
        <FieldRow label="多語通報要求">{booleanText(core?.multilingualRequired ?? null)}</FieldRow>
      </FieldList>
    </section>
  );
}

// ─── Panel ───────────────────────────────────────────────────

export interface ReportPanelProps {
  readonly decision: DecisionReadModelState;
  /** Retries the initial (non-background) read. */
  readonly onRetry: () => void;
}

/**
 * Command-centre report panel (TASK-132).
 *
 * State → UI mapping:
 * - `idle` → explicit "no decision identified yet"
 * - `loading` → {@link LoadingIndicator}
 * - `error` → {@link ErrorState} plus a retry control
 * - `insufficient_data` → the backend STOP: no committed core, so no report
 * - `partial` → deterministic core with the §21.3 template narrative
 * - `ready` → deterministic core with the committed AI narrative
 *
 * A failed *background* refresh is layered on top of existing content, which is
 * never removed.
 */
export function ReportPanel({ decision, onRetry }: ReportPanelProps): ReactNode {
  const { state, error, core } = decision;

  if (state === 'idle') {
    return (
      <div className="report-panel">
        <EmptyState message="尚未有決策可產出建議書（等待事件注入或即時事件）" />
      </div>
    );
  }

  if (state === 'loading') {
    return (
      <div className="report-panel">
        <LoadingIndicator label="載入交控中心建議書中" />
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="report-panel">
        <ErrorState
          message={error === null ? '建議書讀取失敗' : `建議書讀取失敗：${error.message}`}
        />
        <button type="button" className="report-panel__retry" onClick={onRetry}>
          重試
        </button>
      </div>
    );
  }

  return (
    <div className="report-panel">
      <h3 className="report-panel__heading">交控中心建議書</h3>

      <div className="report-panel__status" role="status" aria-live="polite">
        {decision.refreshStatus === 'refreshing' ? '背景更新中…' : null}
        {decision.refreshStatus === 'idle' && error !== null
          ? `背景更新失敗：${error.message}（顯示上次成功的讀取結果）`
          : null}
      </div>

      {state === 'insufficient_data' || core === null ? (
        <>
          <InsufficientDataState message="尚無已提交的決策核心（data_status=insufficient_data），不顯示任何建議內容" />
          <FieldList>
            <FieldRow label="決策識別">{textOrUnavailable(decision.decisionId)}</FieldRow>
            <FieldRow label="追蹤識別">{textOrUnavailable(decision.traceId)}</FieldRow>
          </FieldList>
        </>
      ) : (
        <>
          <ProvenanceHeader decision={decision} />
          <EventIdentification core={core} />
          <ClassificationSection classifications={core.classifications} />
          <RouteSummarySection core={core} />
          <EteSummarySection core={core} />
          <CmsSection
            core={core}
            cmsExplanationText={decision.report?.cmsExplanationText ?? null}
          />
          <NarrativeSection
            core={core}
            reportText={decision.report?.reportText ?? null}
            citationsPresentation={decision.report?.citationsPresentation ?? null}
            missingNarrativeTypes={decision.missingNarrativeTypes}
          />
        </>
      )}
    </div>
  );
}
