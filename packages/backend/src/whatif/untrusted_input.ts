/**
 * untrusted_input — UNTRUSTED_USER_INPUT 的共用防護工具 (§17)
 *
 * What-if 的 `raw_question` 全程為 `UNTRUSTED_USER_INPUT`（§10.14）。
 * stage 1（ScenarioParser）與 stage 4（explanation）都會把它放進 Bedrock prompt，
 * 兩處必須用**同一套**跳脫規則——否則防護會不對稱，
 * 而不對稱的那一邊就是攻擊者會挑的那一邊。
 *
 * @module backend/whatif/untrusted_input
 */

/**
 * 使用者輸入在 prompt 中的隔離標籤名稱。
 *
 * stage 1 與 stage 4 共用，確保兩處的 prompt 結構一致。
 */
export const USER_QUESTION_TAG = 'user_question';

/**
 * 脫逸使用者輸入中的 XML 特殊字元，防止 prompt injection 提前閉合 XML tag。
 *
 * 攻擊向量：`rawQuestion` 含 `</user_question>` → 提前關閉 tag，
 * 使後續偽造內容落進 prompt 中「受信任」的區段
 * （例如偽造一段「系統指示」或偽造 stage 3 的決定性事實）。
 * 脫逸 `&`、`<`、`>` 後，tag 邊界無法被使用者輸入破壞。
 *
 * ⚠️ 先跳脫 `&`，否則會把後續產生的 `&lt;` 再次跳脫成 `&amp;lt;`。
 *
 * 注意：這不是唯一防線——
 * - stage 2 的 SchemaValidator + DomainValidator 才是數值真值的守門員
 * - stage 4 的 `validateBedrockPayload` 不允許 prohibited fields 通過
 * 跳脫的作用是降低 Bedrock 被誤導、產生錯誤措辭或錯誤 assumptions 的機率。
 */
export function escapeXmlEntities(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * 把不可信輸入包進隔離標籤，內容先經 `escapeXmlEntities` 跳脫。
 *
 * @param rawQuestion - UNTRUSTED_USER_INPUT
 * @returns `<user_question>...</user_question>` 區塊（已跳脫）
 */
export function wrapUntrustedQuestion(rawQuestion: string): string {
  return `<${USER_QUESTION_TAG}>\n${escapeXmlEntities(rawQuestion)}\n</${USER_QUESTION_TAG}>`;
}
