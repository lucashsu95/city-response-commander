/**
 * ExplanationComposer — 決策解釋生成器 (TASK-115)
 *
 * 職責（§10.11b, §14.2, §8, competition_quality_floor）：
 * - 讀取 DecisionCore.evidence（EvidenceTrace）與 citation_article_set（決定性事實，LLM-prohibited）
 * - 組裝 prompt → invoke Bedrock → 產生 explanation_text
 * - SchemaValidator 確保 LLM 只填 `explanation_text`（text-only；不可改動任何數值或路線）
 * - Bedrock 失敗或 SchemaValidator 拒絕 → 決定性 template fallback
 * - 呼叫 `putNarrative` 寫入 EXPLANATION item（`attribute_not_exists(decision_id)` conditional Put）
 * - EXPLANATION 的完成訊號透過 `decision.enriched` 發出，無獨立 `explanation.ready` 事件
 *
 * 界線（§9）：
 * - ExplanationComposer 不計算任何數值、不判斷 SOP 觸發、不選路
 * - LLM 只能寫 `explanation_text` 的文字措辭
 * - 所有 EvidenceTrace 事實均為 LLM-prohibited；LLM 只能解釋這些事實
 * - DecisionCore 保持 read-only，永不被修改
 *
 * @module rag/explanation_composer
 */

import {
  NarrativeType,
  type DecisionCore,
  type ExplanationPayload,
} from '@city-commander/shared-schemas';
import type { EvidenceTrace, ClassificationReasoning, ExcludedRouteReason } from '@city-commander/shared-schemas';
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
 * `composeExplanation()` 所需的輸入。
 *
 * - `core`：已提交的 DecisionCore（read-only；所有欄位均為 LLM-prohibited）
 * - `citations`：SopRetriever 取回的 SOP citations（verbatim），對應 citation_article_set
 * - `narrativeClient`：NarrativeTableClient
 * - `bedrockInvoker`：BedrockInvoker
 */
export interface ExplanationComposerInput {
  readonly core: DecisionCore;
  readonly citations: readonly SopCitationResult[];
  readonly narrativeClient: NarrativeTableClient;
  readonly bedrockInvoker: BedrockInvoker;
}

/** `composeExplanation()` 成功（首次或重試安全） */
export interface ExplanationComposeSuccess {
  readonly outcome: 'committed' | 'branch_already_completed';
  /**
   * Dashboard dedup key（`decision_id|decision.enriched|core_version_ref`）。
   * EXPLANATION 完成訊號透過 `decision.enriched` 發出（§13），
   * 無獨立 `explanation.ready` 事件。
   * 供上層 decision.enriched gate 使用。
   */
  readonly ready_event_id: string;
  /** 文字來源 */
  readonly text_source: 'bedrock' | 'template';
}

/** `composeExplanation()` 底層 DDB 錯誤 */
export interface ExplanationComposeFailed {
  readonly outcome: 'failed';
  readonly error: string;
}

export type ExplanationComposeResult = ExplanationComposeSuccess | ExplanationComposeFailed;

// ─── Main function ────────────────────────────────────────────────────────────

/**
 * 生成決策解釋並寫入 DecisionNarrativeTable 的 EXPLANATION item。
 *
 * 流程（§14.2, Figure 8）：
 * ```
 * DecisionCore.evidence（EvidenceTrace）+ citation_article_set
 *   → buildExplanationPrompt(core, citations)
 *   → BedrockInvoker.invoke()
 *     ↓ success → JSON.parse（非 JSON → warn log + fallback）
 *       → validateBedrockPayload(EXPLANATION, raw)
 *         ↓ accepted    → use validation.fields.explanation_text
 *         ↓ use_template → buildTemplateExplanation(core, citations)
 *     ↓ use_template → buildTemplateExplanation(core, citations)
 *   → putNarrative(EXPLANATION, ...)
 *     ↓ committed                → outcome: 'committed'
 *     ↓ branch_already_completed → outcome: 'branch_already_completed'
 *     ↓ throws (DDB error)       → outcome: 'failed'
 * ```
 *
 * @param input - ExplanationComposerInput（core, citations, narrativeClient, bedrockInvoker）
 */
export async function composeExplanation(
  input: ExplanationComposerInput,
): Promise<ExplanationComposeResult> {
  const { core, citations, narrativeClient, bedrockInvoker } = input;

  // ── 1. Invoke Bedrock ─────────────────────────────────────────────────────
  const prompt = buildExplanationPrompt(core, citations);
  const bedrockResult = await bedrockInvoker.invoke(prompt);

  let explanationPayload: ExplanationPayload;
  let textSource: 'bedrock' | 'template';

  if (bedrockResult.outcome === 'success') {
    // ── 2. Parse Bedrock text as JSON ────────────────────────────────────
    let rawParsed: unknown = null;
    try {
      rawParsed = JSON.parse(bedrockResult.text);
    } catch {
      // Bedrock 回傳非 JSON（純文字或 markdown）→ fallback
      console.warn(
        '[ExplanationComposer] Bedrock returned non-JSON text; falling back to template explanation.',
        { decision_id: core.decision_id, model: bedrockResult.usedModelId },
      );
    }

    // ── 3. SchemaValidator：只接受 EXPLANATION 白名單欄位 ────────────────
    const validation = validateBedrockPayload(NarrativeType.EXPLANATION, rawParsed);

    if (validation.outcome === 'accepted') {
      // 空字串視同缺漏（SchemaValidator 只確認 string 型別，不排除空字串）
      const rawText = validation.fields['explanation_text'];
      const effectiveText =
        rawText != null && rawText.trim().length > 0
          ? rawText
          : null;

      explanationPayload = {
        type: 'EXPLANATION',
        explanation_text: effectiveText ?? buildFallbackExplanationText(core, citations),
      };
      // text_source 只在 Bedrock 實際提供非空文字時才標記為 'bedrock'
      textSource = effectiveText !== null ? 'bedrock' : 'template';
    } else {
      // SchemaValidator 拒絕（含 core field overwrite 嘗試）→ template
      explanationPayload = buildTemplateExplanation(core, citations);
      textSource = 'template';
    }
  } else {
    // Bedrock 失敗（timeout / model_not_supported 等）→ template
    explanationPayload = buildTemplateExplanation(core, citations);
    textSource = 'template';
  }

  // ── 4. putNarrative → EXPLANATION item conditional Put ──────────────────
  let putResult: NarrativePutResult;
  try {
    putResult = await putNarrative(
      narrativeClient,
      core.decision_id,
      NarrativeType.EXPLANATION,
      core.version,
      explanationPayload,
    );
  } catch (err) {
    return {
      outcome: 'failed',
      error: err instanceof Error ? err.message : String(err),
    };
  }

  // EXPLANATION 的 ready_event_id 透過 decision.enriched 發出（§13）
  // 此處使用 NarrativeType.EXPLANATION 讓 buildReadyEventId 映射到 'decision.enriched'
  const ready_event_id = buildReadyEventId(
    core.decision_id,
    NarrativeType.EXPLANATION,
    core.version,
  );

  return {
    outcome: putResult.outcome,
    ready_event_id,
    text_source: textSource,
  };
}

// ─── ETE formatting helpers ──────────────────────────────────────────────────

/**
 * 格式化 ETE 供 prompt 使用（§10.9 discriminant narrowing）。
 * 與 report_composer.ts 邏輯一致，集中於此模組避免重複。
 */
function formatEteForPrompt(core: DecisionCore): string {
  if (!core.ete) return 'ETE：（未計算）';
  if (core.ete.calculation_status === 'computed') {
    return `ETE：${core.ete.ete_minutes} 分鐘（決定性，不可改動）`;
  }
  return `ETE：資料不足，需人工確認（下限 ${core.ete.ete_lower_bound_minutes} 分鐘）`;
}

/**
 * 格式化 ETE 供 template text 使用（繁體中文）。
 * 回傳空字串時由呼叫端忽略。
 */
function formatEteForTemplate(core: DecisionCore): string {
  if (!core.ete) return '';
  if (core.ete.calculation_status === 'computed') {
    return `預計交通恢復時間（ETE）：${core.ete.ete_minutes} 分鐘`;
  }
  return `ETE 資料不足，需人工確認（下限 ${core.ete.ete_lower_bound_minutes} 分鐘）`;
}

// ─── Prompt builder ───────────────────────────────────────────────────────────

/**
 * 組裝決策解釋的 Bedrock prompt。
 *
 * Prompt 只提供決定性事實（EvidenceTrace、分類理由、排除路段、SOP 引用）；
 * 明確指示 Bedrock 只回傳 JSON，且只填 `explanation_text`，
 * 不得改寫任何數值、路線或 SOP 結果。
 *
 * 防 prompt injection（§17）：
 * - 使用者輸入（raw_question）不在此流程中
 * - core.evidence 皆為決定性程式碼產出，非使用者自由輸入
 */
function buildExplanationPrompt(
  core: DecisionCore,
  citations: readonly SopCitationResult[],
): string {
  const evidence: EvidenceTrace = core.evidence;

  const classificationLines = evidence.classification_reasoning
    .map(
      (c: ClassificationReasoning) =>
        `  - ${c.segment_id}：飽和度 ${c.value}，門檻 ${c.threshold}，判定 ${c.conclusion}`,
    )
    .join('\n');

  const excludedLines = evidence.excluded_routes
    .map((r: ExcludedRouteReason) => `  - ${r.segment_id}：${r.reason}`)
    .join('\n');

  const sopLines = evidence.sop_citations
    .map((s) => `  - 第 ${s.article_no} 條（${s.source_location}）：${s.content.slice(0, 100)}`)
    .join('\n');

  const citationLines = citations
    .map(
      (c) =>
        `  - 第 ${c.article_no} 條（來源：${c.source_location}）：${c.content.slice(0, 120)}`,
    )
    .join('\n');

  const primaryRoute = core.primary_evacuation ?? '（無合規替代路段）';
  const secondaryRoutes =
    core.secondary_evacuation.length > 0
      ? core.secondary_evacuation.join('、')
      : '（無）';
  const triggeredArticles = core.triggered_articles.join('、');
  const eteSection = formatEteForPrompt(core);

  return `你是城市交通應變 AI 指揮台的解釋生成模組。請根據以下決定性事實，以易懂的方式解釋本次決策的推理過程。

## 事件資訊
- 事件 ID：${core.event_id}
- 事故發生時間：${core.occurred_at}
- 觸發 SOP 條款：第 ${triggeredArticles} 條

## 路段分類結果（決定性，不可改動）
${classificationLines || '  （無分類記錄）'}

## 疏散路線結果（決定性，不可改動）
- 主疏散路段：${primaryRoute}
- 次疏散路段：${secondaryRoutes}
- ${eteSection}

## 排除路段及理由（決定性，不可改動）
${excludedLines || '  （無排除路段）'}

## EvidenceTrace SOP 引用
${sopLines || '  （無）'}

## KB/S3 SOP 引用
${citationLines || '  （無引用）'}

## 指示
請回傳 JSON 物件，只包含以下欄位：
- explanation_text：決策解釋文字（繁體中文，清楚說明為何判定此級別、為何選擇此主路線、為何排除其他候選路段）

禁止事項：
- 不可改動任何數值（飽和度、ETE、容量等）
- 不可更改路線選擇或排除結果
- 不可虛構 SOP 條款或資料
- 不可回傳 explanation_text 以外的任何欄位`;
}

// ─── Template fallback ────────────────────────────────────────────────────────

/**
 * 決定性 template fallback（§21.3）。
 *
 * 當 Bedrock 失敗或 SchemaValidator 拒絕時使用。
 * 只插入 EvidenceTrace 中的決定性事實，不虛構任何內容。
 */
function buildTemplateExplanation(
  core: DecisionCore,
  citations: readonly SopCitationResult[],
): ExplanationPayload {
  return {
    type: 'EXPLANATION',
    explanation_text: buildFallbackExplanationText(core, citations),
  };
}

/**
 * 從 EvidenceTrace 事實組裝 fallback explanation_text。
 *
 * 遵守「只插入決定性事實」原則；不虛構任何內容。
 */
function buildFallbackExplanationText(
  core: DecisionCore,
  citations: readonly SopCitationResult[],
): string {
  const evidence: EvidenceTrace = core.evidence;
  const primaryRoute = core.primary_evacuation ?? '查無合規替代路段';
  const secondaryRoutes =
    core.secondary_evacuation.length > 0
      ? core.secondary_evacuation.join('、')
      : '無';
  const triggeredArticles = core.triggered_articles.join('、');

  const classificationLines = evidence.classification_reasoning
    .map(
      (c: ClassificationReasoning) =>
        `  ${c.segment_id}：飽和度 ${c.value}（門檻 ${c.threshold}）→ ${c.conclusion}`,
    )
    .join('\n');

  const excludedLines = evidence.excluded_routes
    .map((r: ExcludedRouteReason) => `  ${r.segment_id}：${r.reason}`)
    .join('\n');

  const articleList =
    citations.length > 0
      ? citations.map((c) => `第 ${c.article_no} 條`).join('、')
      : `第 ${triggeredArticles} 條`;

  const lines: string[] = [
    `【決策解釋】`,
    `事件：${core.event_id}（${core.occurred_at}）`,
    ``,
    `觸發 SOP：${articleList}`,
    ``,
    `路段分類結果：`,
    classificationLines || '  （無分類記錄）',
    ``,
    `疏散路線：主路 ${primaryRoute}，次路 ${secondaryRoutes}`,
  ];

  const eteText = formatEteForTemplate(core);
  if (eteText) {
    lines.push(eteText);
  }

  if (evidence.excluded_routes.length > 0) {
    lines.push(``, `排除路段及理由：`, excludedLines);
  }

  lines.push(``, `（本解釋由決定性模板產生，Bedrock 不可用）`);

  return lines.join('\n');
}
