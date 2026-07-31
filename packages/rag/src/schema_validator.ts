/**
 * SchemaValidator — §9 boundary enforcement (TASK-111)
 *
 * 機械性驗證 Bedrock 輸出只填入允許的文字欄位，
 * 拒絕任何試圖覆寫 LLM-prohibited core fields 的嘗試，
 * 並在拒絕時回傳 template fallback 訊號（§9.3, §10.11b, P37）。
 *
 * 設計規則：
 * - WHITELIST per narrative_type（只有這些欄位可通過）
 *   REPORT       → {report_text, cms_explanation_text, citations_presentation}
 *   PUBLIC_ALERT → {public_alert_text}
 *   EXPLANATION  → {explanation_text}
 * - 任何 payload key 出現在 LLM_PROHIBITED_FIELDS → 全部拒絕，回傳 use_template
 * - 任何 payload key 不在該 narrative_type 的白名單 → 全部拒絕，回傳 use_template
 * - 通過時只回傳白名單內的欄位（strip 掉多餘 key），且所有值強制為 string
 *
 * @module rag/schema_validator
 */

import { NarrativeType } from '@city-commander/shared-schemas';

// ─── LLM-prohibited core fields（與 eslint-local-rules.cjs 同步）─────────────
//
 // ⚠️  MAINTENANCE NOTE — Divergent Change risk:
//     這份清單必須與 eslint-local-rules.cjs 的 LLM_PROHIBITED_FIELDS 保持一致。
//     當 DecisionCore 新增或移除欄位時，兩處都需同步更新。
//     長期修復方向：由 @city-commander/shared-schemas 匯出 canonical list，
//     讓 eslint-local-rules.cjs 和此檔案共同引用同一份來源。
//
// 來源：eslint-local-rules.cjs → LLM_PROHIBITED_FIELDS（§9 boundary）
const LLM_PROHIBITED_FIELDS = new Set<string>([
  'decision_id',
  'idempotency_key',
  'core_hash',
  'source_manifest_hash',
  'immutable_after_commit',
  'event_id',
  'occurred_at',
  'event_facts',
  'triggered_articles',
  'applied_formula_articles',
  'invoked_procedures',
  'art1_measures',
  'classifications',
  'incident_anchor',
  'primary_evacuation',
  'secondary_evacuation',
  'excluded_candidates',
  'affected_intersection_scope',
  'ete',
  'multilingual_required',
  'multilingual_scope',
  'evidence',
  'policy',
  'cms_core_text',
  'provisional',
  'schema_version',
]);

// ─── 白名單 per narrative_type ─────────────────────────────────────────────
//
// 只有這些欄位可以從 Bedrock 輸出寫入 DecisionNarrative payload。
// 任何其他欄位（包含 LLM-prohibited）都視為越界嘗試。
const ALLOWED_FIELDS: Record<NarrativeType, ReadonlySet<string>> = {
  [NarrativeType.REPORT]: new Set([
    'report_text',
    'cms_explanation_text',
    'citations_presentation',
  ]),
  [NarrativeType.PUBLIC_ALERT]: new Set([
    'public_alert_text',
  ]),
  [NarrativeType.EXPLANATION]: new Set([
    'explanation_text',
  ]),
};

// ─── Result types ──────────────────────────────────────────────────────────

/** SchemaValidator 驗證通過，回傳已清潔的純文字欄位 */
export interface ValidatedPayload {
  readonly outcome: 'accepted';
  /**
   * 僅含白名單內欄位的 payload（多餘 key 已 strip）。
   * 所有值均為 string，符合 spec「text-only payload」要求（§10.11b）。
   * 非 string 值在驗證階段會被拒絕（outcome: use_template）。
   */
  readonly fields: Readonly<Record<string, string>>;
}

/** SchemaValidator 驗證失敗，呼叫端必須使用 template fallback */
export interface RejectedPayload {
  readonly outcome: 'use_template';
  /** 拒絕原因，供 structured logging 使用（不含 payload 內容本身，避免 prompt injection log） */
  readonly reason: RejectionReason;
  /** 觸發拒絕的欄位名稱（診斷用；不含值） */
  readonly offendingFields: readonly string[];
}

/** 拒絕原因 */
export type RejectionReason =
  | 'prohibited_field_overwrite' // payload 含 LLM-prohibited core field
  | 'non_whitelisted_field'       // payload 含該 narrative_type 白名單外的欄位
  | 'non_string_value'            // 白名單內欄位的值不是 string（spec: text-only）
  | 'invalid_narrative_type'      // 傳入未知的 narrative_type
  | 'not_a_plain_object';         // payload 不是純物件（無法安全遍歷）

export type ValidationResult = ValidatedPayload | RejectedPayload;

// ─── Main validator ────────────────────────────────────────────────────────

/**
 * 驗證 Bedrock 輸出的 raw payload，確保只含允許的文字欄位。
 *
 * 呼叫端流程：
 * ```
 * const result = validateBedrockPayload(NarrativeType.REPORT, rawOutput);
 * if (result.outcome === 'use_template') {
 *   // 丟棄 Bedrock 輸出，使用 deterministic template
 * } else {
 *   // 安全使用 result.fields（所有值已確認為 string）
 * }
 * ```
 *
 * @param narrativeType - 本次 RendererFn branch 的 narrative_type
 * @param rawPayload    - Bedrock 原始輸出（未信任的 unknown）
 * @returns ValidationResult
 */
export function validateBedrockPayload(
  narrativeType: NarrativeType,
  rawPayload: unknown,
): ValidationResult {
  // 1. narrative_type 必須已知。
  //    ALLOWED_FIELDS 以 enum 為 key，TypeScript 層靜態完整；
  //    此 guard 防禦 runtime 傳入非 enum string 的情況（如字串轉型錯誤）。
  const allowedFields = ALLOWED_FIELDS[narrativeType];
  if (allowedFields === undefined) {
    return {
      outcome: 'use_template',
      reason: 'invalid_narrative_type',
      offendingFields: [],
    };
  }

  // 2. payload 必須是純物件（防止 array / primitive / Object.create(null) injection）。
  //    Object.create(null) 的 prototype 不是 Object.prototype，刻意排除，
  //    因為 Object.keys() 在無 prototype 的物件上行為雖然合法，
  //    但 JSON.parse 不會產生此類物件；排除可降低意外行為的攻擊面。
  if (!isPlainObject(rawPayload)) {
    return {
      outcome: 'use_template',
      reason: 'not_a_plain_object',
      offendingFields: [],
    };
  }

  const keys = Object.keys(rawPayload);

  // 3. 先掃 prohibited fields（最高優先，任何一個即全拒）
  const prohibitedHits = keys.filter((k) => LLM_PROHIBITED_FIELDS.has(k));
  if (prohibitedHits.length > 0) {
    return {
      outcome: 'use_template',
      reason: 'prohibited_field_overwrite',
      offendingFields: prohibitedHits,
    };
  }

  // 4. 再掃非白名單欄位
  const nonWhitelisted = keys.filter((k) => !allowedFields.has(k));
  if (nonWhitelisted.length > 0) {
    return {
      outcome: 'use_template',
      reason: 'non_whitelisted_field',
      offendingFields: nonWhitelisted,
    };
  }

  // 5. 驗證所有白名單欄位的值必須是 string（spec: text-only payload）
  const nonStringFields = keys.filter(
    (k) => allowedFields.has(k) && typeof rawPayload[k] !== 'string',
  );
  if (nonStringFields.length > 0) {
    return {
      outcome: 'use_template',
      reason: 'non_string_value',
      offendingFields: nonStringFields,
    };
  }

  // 6. 通過：只回傳白名單內的欄位，型別已確認為 string
  const clean: Record<string, string> = {};
  for (const k of keys) {
    if (allowedFields.has(k)) {
      clean[k] = rawPayload[k] as string;
    }
  }

  return { outcome: 'accepted', fields: clean };
}

// ─── Internal helpers ──────────────────────────────────────────────────────

/**
 * 嚴格純物件判斷：排除 null、Array、Date 等特殊 object，
 * 以及 Object.create(null)（無 prototype，JSON.parse 不產生此類型）。
 * 確保 Object.keys() 遍歷行為可預測，且 prototype chain 不含意外方法。
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}
