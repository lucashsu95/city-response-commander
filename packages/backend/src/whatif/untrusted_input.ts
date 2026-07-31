/**
 * untrusted_input — UNTRUSTED_USER_INPUT 的共用防護工具 (§17)
 *
 * What-if 的 `raw_question` 全程為 `UNTRUSTED_USER_INPUT`（§10.14）。
 * stage 1（ScenarioParser）與 stage 4（explanation）都會把它放進 Bedrock prompt，
 * 兩處必須用**同一套**跳脫規則——否則防護會不對稱，
 * 而不對稱的那一邊就是攻擊者會挑的那一邊。
 *
 * 本模組同時負責**回顯出口**的清潔（`clarification_prompt`），
 * 見 `sanitizeEchoedText`。
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

// ─── 回顯清潔（clarification_prompt 出口）────────────────────────────────────

/** 回顯到 clarification_prompt 的單一片段（entity_id / field）長度上限 */
export const MAX_ECHOED_FRAGMENT_LENGTH = 80;

/** Bedrock 回傳的 clarification reason 長度上限 */
export const MAX_CLARIFICATION_REASON_LENGTH = 200;

/**
 * C0 與 C1 控制字元。
 *
 * 以 `new RegExp` + 跳脫字串建構，避免在原始碼中寫入實體控制字元
 * （實體控制字元會讓檔案難以 diff、grep 與 code review）。
 */
// eslint-disable-next-line no-control-regex -- 比對控制字元正是本 regex 的目的（用於移除）
const CONTROL_CHARS = new RegExp('[\\u0000-\\u001F\\u007F-\\u009F]', 'g');

/**
 * 清潔要「回顯給使用者」的不可信文字。
 *
 * `clarification_prompt` 是 What-if 唯一會把使用者／LLM 內容原樣送回 Dashboard
 * 的出口。`entity_id`、`field` 這些值最終源自 `raw_question`（經 Bedrock 解析），
 * 未經清潔就串進錯誤訊息等於開了一條回顯通道：
 * 可塞控制字元干擾終端與日誌，也可塞長文把真正的錯誤原因洗掉。
 *
 * 清潔規則：
 * 1. 移除 C0/C1 控制字元（含 CR/LF/TAB，避免偽造多行訊息與日誌注入）
 * 2. 壓縮連續空白
 * 3. 超過 `maxLength` 截斷並補「…」
 *
 * ⚠️ 這只負責「送回 Dashboard 的文字」；防止數值被竄改的是 stage 2 的
 * Schema/DomainValidator，兩者職責不同，不可互相取代。
 *
 * @param value - 不可信文字
 * @param maxLength - 截斷長度上限
 * @returns 清潔後的字串（可能為空字串，由呼叫端決定備援文字）
 */
export function sanitizeEchoedText(
  value: string,
  maxLength: number = MAX_ECHOED_FRAGMENT_LENGTH,
): string {
  const stripped = value
    .replace(CONTROL_CHARS, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (stripped.length <= maxLength) return stripped;
  return `${stripped.slice(0, maxLength)}…`;
}
