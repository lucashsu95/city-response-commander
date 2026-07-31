/**
 * ReportComposer — 交控中心建議書生成器 (TASK-113)
 *
 * 職責（§10.11b, §14.3, competition_quality_floor）：
 * - 讀取 DecisionCore 決定性事實（read-only）+ SOP citations
 * - 組裝 prompt → invoke Bedrock → 產生 report_text / cms_explanation_text / citations_presentation
 * - 透過 SchemaValidator 確保 LLM 只填文字欄位；`cms_core_text` 絕不可被修改
 * - Bedrock 失敗或 SchemaValidator 拒絕（含 core field overwrite 嘗試）→ template fallback（§21.3）
 * - 呼叫 `putNarrative` 寫入 REPORT item（`attribute_not_exists(decision_id)` conditional Put）
 * - re-put → `branch_already_completed`（at-least-once 安全）
 *
 * 界線（§9）：
 * - ReportComposer 不計算任何數值、不判斷 SOP 觸發、不選路
 * - 唯一寫入目標是 DecisionNarrativeTable 的 REPORT item
 * - LLM 只能寫 `report_text`、`cms_explanation_text`、`citations_presentation`
 * - `cms_core_text` 永遠不會出現在 REPORT payload（它屬於 DecisionCore，LLM-prohibited）
 *
 * @module rag/report_composer
 */

import {
  NarrativeType,
  type DecisionCore,
  type ReportPayload,
} from '@city-commander/shared-schemas';
import { validateBedrockPayload } from './schema_validator.js';
import {
  putNarrative,
  buildReadyEventId,
  type NarrativeTableClient,
  type NarrativePutResult,
} from './narrative_writer.js';
import type { BedrockInvoker } from './bedrock_adapter.js';
import type { SopCitationResult } from './sop_retriever.js';

// ─── Input / Output types ─────────────────────────────────────────────────────

/**
 * `composeReport()` 所需的輸入。
 *
 * - `core`：已提交的 DecisionCore（read-only，不可修改）
 * - `citations`：SopRetriever 取回的 SOP citations（verbatim）
 * - `narrativeClient`：NarrativeTableClient（注入 DynamoDB wrapper 或 stub）
 * - `bedrockInvoker`：BedrockInvoker（注入 BedrockAdapter 或 MockBedrockAdapter）
 */
export interface ReportComposerInput {
  readonly core: DecisionCore;
  readonly citations: readonly SopCitationResult[];
  readonly narrativeClient: NarrativeTableClient;
  readonly bedrockInvoker: BedrockInvoker;
}

/** `composeReport()` 成功寫入（首次）或重試安全（已存在） */
export interface ReportComposeSuccess {
  readonly outcome: 'committed' | 'branch_already_completed';
  /**
   * Dashboard dedup key（`decision_id|report.ready|core_version_ref`）。
   * 供上層推送 `report.ready` WebSocket 事件使用。
   * 值與寫入 DynamoDB item 的 `ready_event_id` 一致（同源 `buildReadyEventId`）。
   */
  readonly ready_event_id: string;
  /** 使用的文字來源：Bedrock 生成或 template fallback */
  readonly text_source: 'bedrock' | 'template';
}

/** `composeReport()` 遇到不可重試的底層錯誤（DynamoDB 非 conditional-check 錯誤）*/
export interface ReportComposeFailed {
  readonly outcome: 'failed';
  readonly error: string;
}

export type ReportComposeResult = ReportComposeSuccess | ReportComposeFailed;

// ─── Main function ────────────────────────────────────────────────────────────

/**
 * 生成交控中心建議書並寫入 DecisionNarrativeTable 的 REPORT item。
 *
 * 流程（§14.3, Figure 8）：
 * ```
 * DecisionCore facts + SOP citations
 *   → buildReportPrompt()
 *   → BedrockInvoker.invoke()
 *     ↓ success → JSON.parse（非 JSON → warn log + fallback）
 *       → validateBedrockPayload(REPORT, raw)
 *         ↓ accepted    → use Bedrock fields
 *         ↓ use_template → buildTemplateReport(core, citations)
 *     ↓ use_template → buildTemplateReport(core, citations)
 *   → putNarrative(REPORT, ...)
 *     ↓ committed                → outcome: 'committed'
 *     ↓ branch_already_completed → outcome: 'branch_already_completed'
 *     ↓ throws (DDB error)       → outcome: 'failed'
 * ```
 *
 * @param input - ReportComposerInput（core, citations, narrativeClient, bedrockInvoker）
 */
export async function composeReport(input: ReportComposerInput): Promise<ReportComposeResult> {
  const { core, citations, narrativeClient, bedrockInvoker } = input;

  // ── 1. Invoke Bedrock ────────────────────────────────────────────────────
  const prompt = buildReportPrompt(core, citations);
  const bedrockResult = await bedrockInvoker.invoke(prompt);

  let reportPayload: ReportPayload;
  let textSource: 'bedrock' | 'template';

  if (bedrockResult.outcome === 'success') {
    // ── 2. Parse Bedrock text as JSON ──────────────────────────────────────
    let rawParsed: unknown = null;
    try {
      rawParsed = JSON.parse(bedrockResult.text);
    } catch {
      // Bedrock 回傳非 JSON（純文字或 markdown）→ fallback
      console.warn(
        '[ReportComposer] Bedrock returned non-JSON text; falling back to template report.',
        { decision_id: core.decision_id, model: bedrockResult.usedModelId },
      );
    }

    // ── 3. SchemaValidator：只接受 REPORT 白名單欄位 ────────────────────
    const validation = validateBedrockPayload(NarrativeType.REPORT, rawParsed);

    if (validation.outcome === 'accepted') {
      // report_text 若缺漏（Bedrock accepted 但未提供此欄位）→ fallback 填入
      reportPayload = {
        type: 'REPORT',
        report_text: validation.fields['report_text'] ?? buildFallbackReportText(core, citations),
        ...(validation.fields['cms_explanation_text'] !== undefined && {
          cms_explanation_text: validation.fields['cms_explanation_text'],
        }),
        // citations_presentation 僅在 Bedrock 有提供時才寫入，避免空字串語意混淆
        ...(validation.fields['citations_presentation'] !== undefined && {
          citations_presentation: validation.fields['citations_presentation'],
        }),
      };
      textSource = 'bedrock';
    } else {
      // SchemaValidator 拒絕（含 core field overwrite 嘗試） → template
      reportPayload = buildTemplateReport(core, citations);
      textSource = 'template';
    }
  } else {
    // Bedrock 失敗（timeout / model_not_supported 等） → template
    reportPayload = buildTemplateReport(core, citations);
    textSource = 'template';
  }

  // ── 4. putNarrative → REPORT item conditional Put ────────────────────────
  let putResult: NarrativePutResult;
  try {
    putResult = await putNarrative(
      narrativeClient,
      core.decision_id,
      NarrativeType.REPORT,
      core.version,
      reportPayload,
    );
  } catch (err) {
    return {
      outcome: 'failed',
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // ready_event_id 與 narrative_writer 的 buildReadyEventId 同源，確保兩端一致
  const ready_event_id = buildReadyEventId(core.decision_id, NarrativeType.REPORT, core.version);

  return {
    outcome: putResult.outcome,
    ready_event_id,
    text_source: textSource,
  };
}

// ─── Prompt builder ───────────────────────────────────────────────────────────

/**
 * 組裝交控中心建議書的 Bedrock prompt。
 *
 * Prompt 只提供決定性事實（數值、路線、SOP 條款）；
 * 明確指示 Bedrock 只回傳 JSON，且只填 report_text / cms_explanation_text /
 * citations_presentation，不得改寫任何數值或路線。
 *
 * 防 prompt injection（§17）：
 * - 使用者輸入（raw_question）不在此流程中
 * - core 與 citations 皆為決定性程式碼產出，非使用者自由輸入
 */
function buildReportPrompt(core: DecisionCore, citations: readonly SopCitationResult[]): string {
  const primaryRoute = core.primary_evacuation ?? '（無合規替代路段）';
  const secondaryRoutes = core.secondary_evacuation.length > 0
    ? core.secondary_evacuation.join('、')
    : '（無）';
  const triggeredArticles = core.triggered_articles.join('、');
  const invokedProcedures = core.invoked_procedures.length > 0
    ? core.invoked_procedures.join('、')
    : '（無）';

  const eteSection = formatEteForPrompt(core);
  const signalTimingLine = buildSignalTimingLine(core);
  const crossSystemLine = buildCrossSystemLine(core);
  const classificationLine = buildClassificationLine(core);

  const citationLines = citations
    .map((c) => `  - 第 ${c.article_no} 條（來源：${c.source_location}）：${c.content.slice(0, 120)}`)
    .join('\n');

  const excludedRoutes = buildExclusionLines(core).join('\n');

  return `你是城市交通應變 AI 指揮台的報告生成模組。請依下列已決定的事實，產生一份給交控中心的建議書摘要。

## 事件資訊
- 事件 ID：${core.event_id}
- 事故發生時間：${core.occurred_at}
- CMS 核心文字（官方模板，不可改動）：${core.cms_core_text}

## SOP 觸發結果（決定性，不可改動）
- 觸發條款：第 ${triggeredArticles} 條
- 啟動程序：${invokedProcedures}
${classificationLine ? `- ${classificationLine}\n` : ''}- 主疏散路段：${primaryRoute}
- 次疏散路段：${secondaryRoutes}
- ${eteSection}
${signalTimingLine ? `- ${signalTimingLine}\n` : ''}${crossSystemLine ? `- ${crossSystemLine}\n` : ''}
## 排除路段
${excludedRoutes || '  （無排除路段）'}

## SOP 引用
${citationLines || '  （無引用）'}

## 指示
請回傳 JSON 物件，只包含以下欄位：
- report_text：完整建議書文字（繁體中文，含事件辨識、分級依據、路線建議、號誌調整、跨系統協調）
- cms_explanation_text（選填）：補充 CMS 說明（不可改動 cms_core_text 的道路名稱或 ETE 數值）
- citations_presentation（選填）：SOP 引用格式化呈現

禁止事項：
- 不可改動任何數值（ETE、飽和度、容量等）
- 不可更改路線選擇結果
- 不可虛構 SOP 條款或資料
- 不可回傳上述三個欄位以外的任何欄位`;
}

// ─── Template fallback ────────────────────────────────────────────────────────

/**
 * 決定性 template fallback（§21.3）。
 *
 * 當 Bedrock 失敗或 SchemaValidator 拒絕時使用。
 * 只插入決定性事實，不虛構任何內容。
 * `citations_presentation` 僅在有 citations 時寫入，避免空字串語意混淆。
 */
function buildTemplateReport(
  core: DecisionCore,
  citations: readonly SopCitationResult[],
): ReportPayload {
  const payload: ReportPayload = {
    type: 'REPORT',
    report_text: buildFallbackReportText(core, citations),
  };

  if (citations.length > 0) {
    return {
      ...payload,
      citations_presentation: citations
        .map((c) => `第 ${c.article_no} 條 | ${c.source_location}`)
        .join('\n'),
    };
  }

  return payload;
}

/**
 * 從決定性事實組裝 fallback report_text。
 */
function buildFallbackReportText(
  core: DecisionCore,
  citations: readonly SopCitationResult[],
): string {
  const primaryRoute = core.primary_evacuation ?? '查無合規替代路段';
  const secondaryRoutes = core.secondary_evacuation.length > 0
    ? core.secondary_evacuation.join('、')
    : '無';
  const triggeredArticles = core.triggered_articles.join('、');
  const eteText = formatEteForReport(core);
  const signalTimingLine = buildSignalTimingLine(core);
  const crossSystemLine = buildCrossSystemLine(core);
  const classificationLine = buildClassificationLine(core);
  const exclusionLines = buildExclusionLines(core);

  const articleList = citations.length > 0
    ? citations.map((c) => `第 ${c.article_no} 條`).join('、')
    : `第 ${triggeredArticles} 條`;

  return [
    `【交控中心建議書】`,
    `事件：${core.event_id}（${core.occurred_at}）`,
    ``,
    `CMS 訊息：${core.cms_core_text}`,
    ``,
    `觸發 SOP：${articleList}`,
    ...(classificationLine ? [classificationLine] : []),
    `主疏散路段：${primaryRoute}`,
    `次疏散路段：${secondaryRoutes}`,
    ...(exclusionLines.length > 0 ? [`排除路段：`, ...exclusionLines] : []),
    ...(eteText ? [eteText] : []),
    ...(signalTimingLine ? [signalTimingLine] : []),
    ...(crossSystemLine ? [crossSystemLine] : []),
    ``,
    `（本報告由決定性模板產生，Bedrock 不可用）`,
  ].join('\n');
}

// ─── Signal timing / cross-system helpers ─────────────────────────────────────

/**
 * 組裝號誌調整建議文字（REQ-021）。
 *
 * 只插入 `core.art1_measures`（SOP-1 決定性測量結果，LLM-prohibited）；
 * 無 art1_measures 時回傳 null，呼叫端省略整行。
 */
function buildSignalTimingLine(core: DecisionCore): string | null {
  const measures = core.art1_measures;
  if (!measures) return null;

  const parts = [`號誌調整：${measures.trigger_segment} 替代路口綠燈時間 +${measures.alternatives_green_plus_pct}%`];
  if (measures.long_green_timing) parts.push('啟動長綠燈時制');
  if (measures.police_clear_intersections) parts.push('派遣警力協助路口疏導');
  return parts.join('，');
}

/**
 * 組裝跨系統聯動文字（REQ-021）。
 *
 * 只依 `core.triggered_articles`（決定性，LLM-prohibited）判斷：
 * - 觸發第 3 條（捷運與接駁分流）→ 請求北捷／公車處支援
 * - 觸發第 5 條（號誌故障）→ 請求警力支援
 * 兩者皆未觸發時回傳 null，呼叫端省略整行。
 */
function buildCrossSystemLine(core: DecisionCore): string | null {
  const requests: string[] = [];
  if (core.triggered_articles.includes(3)) {
    requests.push('請求北捷「過站不停」與公車處調度接駁專車');
  }
  if (core.triggered_articles.includes(5)) {
    requests.push('請求警力支援路口人工指揮');
  }
  if (requests.length === 0) return null;
  return `跨系統協調：${requests.join('；')}`;
}

/**
 * 組裝交通分級判定文字（REQ-021：「說明該事件被判定為 A 級 / B 級之依據」）。
 *
 * 只插入 `core.classifications`（決定性分級結果，LLM-prohibited）；
 * 未分級（level 為 null）之路段不列入；全數未分級時回傳 null。
 */
function buildClassificationLine(core: DecisionCore): string | null {
  const graded = core.classifications.filter((c) => c.level !== null);
  if (graded.length === 0) return null;
  return `交通分級判定：${graded.map((c) => `${c.segment_id} = ${c.level} 級`).join('、')}`;
}

/**
 * 組裝排除路段清單（REQ-021：「說明排除其他候選路段之理由」）。
 *
 * 供 prompt 與決定性 template 共用，避免同一份 `excluded_candidates` 映射邏輯
 * 兩處各自維護、未來措辭調整時漏改一邊。
 */
function buildExclusionLines(core: DecisionCore): readonly string[] {
  return core.excluded_candidates.map(
    (r) => `  - ${r.segment_id}：${r.exclusion_reason ?? '未提供理由'}`,
  );
}

// ─── ETE formatting helpers ───────────────────────────────────────────────────

/**
 * 格式化 ETE 供 prompt 使用。
 *
 * 使用 `calculation_status` discriminant narrowing（§10.9）：
 * - `'computed'` → `ete_minutes` 已計算，直接展示
 * - `'insufficient_common_snapshot'` → 僅展示 lower bound 與人工確認提示
 */
function formatEteForPrompt(core: DecisionCore): string {
  if (!core.ete) return 'ETE：（未計算）';

  if (core.ete.calculation_status === 'computed') {
    return `ETE: ${core.ete.ete_minutes} 分鐘`;
  }
  // insufficient_common_snapshot
  return `ETE: 資料不足，需人工確認（下限 ${core.ete.ete_lower_bound_minutes} 分鐘）`;
}

/**
 * 格式化 ETE 供 report text 使用（繁體中文）。
 * 回傳空字串時由呼叫端忽略。
 */
function formatEteForReport(core: DecisionCore): string {
  if (!core.ete) return '';

  if (core.ete.calculation_status === 'computed') {
    return `預計交通恢復時間（ETE）：${core.ete.ete_minutes} 分鐘`;
  }
  // insufficient_common_snapshot
  return `ETE 資料不足，需人工確認（下限 ${core.ete.ete_lower_bound_minutes} 分鐘）`;
}
