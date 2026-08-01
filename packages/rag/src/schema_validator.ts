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
 * - 任何 payload path 出現在 CONTAINMENT_PROHIBITED_PATHS → 全部拒絕，回傳 use_template
 * - 任何 payload key 不在該 narrative_type 的白名單 → 全部拒絕，回傳 use_template
 * - 通過時只回傳白名單內的欄位（strip 掉多餘 key），且所有值強制為 string
 *
 * @module rag/schema_validator
 */

import {
  CONTAINMENT_PROHIBITED_PATHS,
  LLM_PROHIBITED_FIELDS,
  NarrativeType,
} from '@city-commander/shared-schemas';

// ─── LLM-prohibited core fields ─────────────────────────────────────────────
//
// Canonical source: @city-commander/shared-schemas (packages/shared-schemas/src/llm_boundary.ts).
// `eslint-local-rules.cjs` (repo-root lint-time CJS, outside any package's build
// output) keeps its own literal copy since it can't import this ESM package at
// lint time; `eslint-local-rules/test/prohibited-fields-sync.test.ts` asserts
// the two stay identical.

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
  [NarrativeType.PUBLIC_ALERT]: new Set(['public_alert_text']),
  [NarrativeType.EXPLANATION]: new Set(['explanation_text']),
};

// ─── Result types ──────────────────────────────────────────────────────────

/** SchemaValidator 驗證通過，回傳已清潔的純文字欄位 */
export interface ValidatedPayload {
  readonly outcome: 'accepted';
  /**
   * 僅含白名單內欄位的 payload（多餘 key 已 strip）。
   * REPORT / EXPLANATION：所有值均為 string。
   * PUBLIC_ALERT：`fields.public_alert_text` 為 undefined，改用 `alertTextMap`。
   */
  readonly fields: Readonly<Record<string, string>>;
  /**
   * 僅 `PUBLIC_ALERT` narrative_type 有值：
   * Bedrock 回傳的語言 map（`{zh: "...", en: "...", ...}`），每個 value 已確認為 string。
   * REPORT / EXPLANATION 此欄位為 undefined。
   */
  readonly alertTextMap?: Readonly<Record<string, string>>;
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
  | 'non_whitelisted_field' // payload 含該 narrative_type 白名單外的欄位
  | 'non_string_value' // 白名單內欄位的值不是 string（REPORT / EXPLANATION）
  | 'public_alert_text_map_invalid' // PUBLIC_ALERT 的 public_alert_text 不是合法語言 map
  | 'invalid_narrative_type' // 傳入未知的 narrative_type
  | 'not_a_plain_object'; // payload 不是純物件（無法安全遍歷）

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

  // 4. 以獨立常數掃 containment disclosure paths（R13 AC4/AC5）。
  //    不與 DecisionCore 的 LLM_PROHIBITED_FIELDS 合併，因兩者型別與來源不同。
  const containmentProhibitedHits = collectObjectPaths(rawPayload).filter((path) =>
    CONTAINMENT_PROHIBITED_PATHS.has(path),
  );
  if (containmentProhibitedHits.length > 0) {
    return {
      outcome: 'use_template',
      reason: 'prohibited_field_overwrite',
      offendingFields: containmentProhibitedHits,
    };
  }

  // 5. 再掃非白名單欄位
  const nonWhitelisted = keys.filter((k) => !allowedFields.has(k));
  if (nonWhitelisted.length > 0) {
    return {
      outcome: 'use_template',
      reason: 'non_whitelisted_field',
      offendingFields: nonWhitelisted,
    };
  }

  // 6. PUBLIC_ALERT 的 public_alert_text 需要專屬的語言 map 驗證
  //    其值為 Partial<Record<Language, string>>（物件，非純字串）。
  //    其他 narrative_type（REPORT / EXPLANATION）的白名單欄位值均須為 string。
  if (narrativeType === NarrativeType.PUBLIC_ALERT) {
    return validatePublicAlertPayload(rawPayload);
  }

  // 6b. REPORT / EXPLANATION：所有白名單欄位的值必須是 string
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

  // 7. 通過：只回傳白名單內的欄位，型別已確認為 string
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
 * Enumerate dotted paths in an untrusted JSON-like object so nested
 * containment fields (for example `decision.reroute_roads`) are checked by
 * the same validator pass as top-level disclosure fields.
 */
function collectObjectPaths(
  value: Record<string, unknown>,
  prefix = '',
  seen: WeakSet<object> = new WeakSet<object>(),
): readonly string[] {
  if (seen.has(value)) {
    return [];
  }
  seen.add(value);

  const paths: string[] = [];
  for (const [key, nestedValue] of Object.entries(value)) {
    const path = prefix === '' ? key : `${prefix}.${key}`;
    paths.push(path);
    if (isPlainObject(nestedValue)) {
      paths.push(...collectObjectPaths(nestedValue, path, seen));
    }
  }
  return paths;
}

/**
 * PUBLIC_ALERT 專屬驗證：`public_alert_text` 值為語言 map（物件）。
 *
 * Bedrock 應回傳：`{"public_alert_text": {"zh": "...", "en": "..."}}`
 * 此函式確保：
 * - `public_alert_text` 存在
 * - 其值為純物件
 * - 物件的每個 value 都是非空 string
 * - 通過時回傳 `alertTextMap`（不放入通用 `fields`，避免型別混淆）
 */
function validatePublicAlertPayload(rawPayload: Record<string, unknown>): ValidationResult {
  const alertText = rawPayload['public_alert_text'];

  if (!isPlainObject(alertText)) {
    return {
      outcome: 'use_template',
      reason: 'public_alert_text_map_invalid',
      offendingFields: ['public_alert_text'],
    };
  }

  // 每個語言 value 必須是非空 string
  const alertMap = alertText as Record<string, unknown>;
  const invalidValues = Object.keys(alertMap).filter(
    (k) => typeof alertMap[k] !== 'string' || (alertMap[k] as string).trim() === '',
  );
  if (invalidValues.length > 0) {
    return {
      outcome: 'use_template',
      reason: 'public_alert_text_map_invalid',
      offendingFields: ['public_alert_text'],
    };
  }

  // 通過：alertTextMap 獨立回傳，fields 為空（PUBLIC_ALERT 無其他 string 欄位）
  const cleanMap: Record<string, string> = {};
  for (const k of Object.keys(alertMap)) {
    cleanMap[k] = alertMap[k] as string;
  }

  return { outcome: 'accepted', fields: {}, alertTextMap: cleanMap };
}

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
