/**
 * What-if 四階段流程的內部中間型別 (§10.14, §14.5)
 *
 * 這些型別是 packages/backend/src/whatif/ 的內部合約，
 * 供 stage 1→2→3→4 之間傳遞資料使用。
 *
 * 邊界（§9）：
 * - `WhatIfAssumption` 的結構由決定性程式碼定義，值由 Bedrock stage 1 填入
 * - stage 2 驗證後才能進入 stage 3 決定性重算
 * - Bedrock 永遠不決定 triggered_articles / ETE / A/B 分級
 * - `does_not_mutate_state: true` 為靜態型別保證
 *
 * @module backend/whatif/whatif_types
 */

// ─── Stage 1 輸出：假設條件 ────────────────────────────────────────────────

/**
 * Bedrock ScenarioParser 解析出的單一假設條件（§14.5 stage 1）。
 *
 * - `entity_id`：假設的實體（如 `BS_MRT_BL17`、`RD_TPE_002`）
 * - `field`：假設的欄位（如 `User_Count`、`Saturation_Score`）
 * - `operator`：比較運算子
 * - `value`：假設的數值（由 Bedrock 解析，須通過 stage 2 驗證）
 *
 * ⚠️ LLM 僅填入文字/數值，不得計算 SOP 觸發、ETE 或分級。
 */
export interface WhatIfAssumption {
  readonly entity_id: string;
  readonly field: string;
  readonly operator: '=' | '>' | '<' | '>=' | '<=';
  readonly value: number;
}

// ─── Stage 1 結果 ──────────────────────────────────────────────────────────

/** stage 1 成功：Bedrock 解析出結構化假設條件 */
export interface ParseScenarioSuccess {
  readonly parse_status: 'parsed';
  readonly assumptions: readonly WhatIfAssumption[];
  /** 實際使用的 model ID（供日誌與稽核） */
  readonly used_model_id: string;
}

/**
 * stage 1 釐清要求：Bedrock 無法解析，或 Bedrock 失敗。
 * 直接回傳 clarification_required，不進入 stage 2/3/4。
 */
export interface ParseScenarioClarificationRequired {
  readonly parse_status: 'clarification_required';
  readonly clarification_prompt: string;
}

export type ParseScenarioResult = ParseScenarioSuccess | ParseScenarioClarificationRequired;

// ─── Stage 2 結果 ──────────────────────────────────────────────────────────

/** stage 2 驗證通過 */
export interface ValidateScenarioPass {
  readonly validation_status: 'valid';
  readonly validated_assumptions: readonly WhatIfAssumption[];
}

/** stage 2 驗證失敗（entity 不存在、field 非法、type 錯誤、超出範圍、歧義） */
export interface ValidateScenarioFailed {
  readonly validation_status: 'clarification_required';
  readonly clarification_prompt: string;
  readonly validation_errors: readonly string[];
}

export type ValidateScenarioResult = ValidateScenarioPass | ValidateScenarioFailed;

// ─── Stage 3 結果 ──────────────────────────────────────────────────────────

/**
 * stage 3 決定性重算結果（§10.15 的決定性欄位）。
 * `does_not_mutate_state` 為靜態型別保證，永遠為 `true`。
 */
export interface RecomputeResult {
  readonly triggered_articles: readonly number[];
  readonly applied_formula_articles: readonly number[];
  readonly expected_actions: readonly string[];
  readonly ete_preview?: { readonly ete_minutes: number };
  readonly does_not_mutate_state: true;
}
