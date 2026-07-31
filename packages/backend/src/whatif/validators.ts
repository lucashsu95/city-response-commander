/**
 * validators — What-if stage 2：SchemaValidator + DomainValidator (TASK-138)
 *
 * 職責（§14.5 stage 2, §22.1 P35）：
 * - SchemaValidator：驗證 entity_id 前綴合法（RD_TPE_/BS_）、field 在白名單內、
 *   value 為有限數字（已在 stage 1 保證，此處雙重確認）
 * - DomainValidator：驗證 field 與 entity_id 類型匹配、value 在合理範圍內
 * - 歧義偵測：同一 entity_id + field 組合出現超過一次 → clarification_required
 * - 任何驗證失敗 → `clarification_required` + `clarification_prompt`，不猜測、不進入 stage 3
 *
 * 設計原則：
 * - 純 domain 邏輯，無 AWS 依賴，無 LLM 呼叫
 * - 所有驗證規則皆來自官方資料定義（raw-data.ts 欄位語意）
 * - 驗證失敗時提供針對性的 clarification_prompt（不是通用錯誤訊息）
 *
 * @module backend/whatif/validators
 */

import type { WhatIfAssumption, ValidateScenarioResult } from './whatif_types.js';
import { ROAD_SEGMENT_PREFIX, BASE_STATION_PREFIX } from '@city-commander/shared-schemas';
import { sanitizeEchoedText } from './untrusted_input.js';

// ─── 回顯清潔 ─────────────────────────────────────────────────────────────────

/**
 * 清潔要回顯進 `clarification_prompt` 的不可信片段。
 *
 * `entity_id` 與 `field` 由 Bedrock 從 `raw_question`（UNTRUSTED_USER_INPUT）
 * 解析而來，stage 1 只確認它們是非空字串——沒有長度上限，也沒有字元限制。
 * 直接串進錯誤訊息會讓 What-if 的回應變成一條回顯通道。
 *
 * 數值真值不受影響（那是本模組其餘驗證的工作）；
 * 這裡處理的是「送回 Dashboard 的文字」。
 */
function echo(value: string): string {
  return sanitizeEchoedText(value);
}

// ─── Entity type classification ───────────────────────────────────────────────

type EntityType = 'road_segment' | 'base_station';

function classifyEntity(entityId: string): EntityType | null {
  if (entityId.startsWith(ROAD_SEGMENT_PREFIX)) return 'road_segment';
  if (entityId.startsWith(BASE_STATION_PREFIX)) return 'base_station';
  return null;
}

// ─── Field definitions ────────────────────────────────────────────────────────

/**
 * 欄位 → 適用的 entity 類型 + value 範圍。
 * 來源：raw-data.ts 欄位語意定義。
 *
 * - Saturation_Score：RawTrafficRecord，範圍 [0, 1]
 * - User_Count：RawCrowdRecord，非負整數（下限 0）
 * - Growth_Rate：RawCrowdRecord，小數量綱 [-1, 10]（SOP-3/SOP-4 門檻本身即小數）
 * - Roaming_User_Pct：RawCrowdRecord（normalized 0–1）；
 *   接受百分比量綱輸入，由 `normalizePercentScale` 轉為小數
 */
interface FieldSpec {
  readonly allowedEntities: readonly EntityType[];
  /** 正規化**後**的合法下限 */
  readonly minValue: number;
  /** 正規化**後**的合法上限 */
  readonly maxValue: number;
  /** 此欄位是否必須是非負整數 */
  readonly mustBeInteger?: boolean;
  /**
   * 此欄位是否接受百分比量綱輸入（如 35 代表 35%）。
   * 見 `normalizePercentScale`。
   */
  readonly acceptsPercentScale?: boolean;
  /** 值超出範圍時附加的量綱提示（幫使用者用對單位） */
  readonly scaleHint?: string;
};

const FIELD_SPECS: Record<string, FieldSpec> = {
  Saturation_Score: {
    allowedEntities: ['road_segment'],
    minValue: 0,
    maxValue: 1,
  },
  User_Count: {
    allowedEntities: ['base_station'],
    minValue: 0,
    maxValue: 10_000_000,
    mustBeInteger: true,
  },
  Growth_Rate: {
    allowedEntities: ['base_station'],
    minValue: -1,
    // SOP-3 / SOP-4 的門檻以小數表示（> 0.30、<= -0.20），
    // 上限收斂到 10（= 1000% 成長）。原本的 100 會讓「成長率 35%」
    // 這種百分比輸入被當成 3500% 靜默通過並錯誤觸發 SOP-3。
    maxValue: 10,
    scaleHint: '成長率請以小數表示（0.30 代表 30%）；若您指的是 35%，請輸入 0.35。',
  },
  Roaming_User_Pct: {
    allowedEntities: ['base_station'],
    minValue: 0,
    maxValue: 1,
    // 官方資料以 "30%" 字串儲存，REQ-010 也以百分比敘述，
    // 指揮官自然會說「漫遊率達 35%」→ Bedrock 解析為 35。
    acceptsPercentScale: true,
  },
};

// ─── 量綱正規化（百分比 → 小數）───────────────────────────────────────────

/**
 * 正規化結果：值本身，或需要澄清的原因。
 */
type NormalizeResult =
  | { readonly kind: 'value'; readonly value: number }
  | { readonly kind: 'ambiguous'; readonly message: string };

/**
 * 把百分比量綱的輸入轉為小數（與 domain `parsePercent` 的 `/100` 一致）。
 *
 * 判定規則：
 * - `0 <= v < 1`  → 已是小數，原值採用（0.35 = 35%）
 * - `1 < v <= 100` → 百分比，除以 100（35 → 0.35）
 * - `v === 1`      → **無法判定**：可能是 1（=100%）也可能是 1%。
 *                    依 §14.5「不猜測」原則回 clarification，不替使用者選一個。
 * - 其他            → 交給 `validateValueRange` 以正規化後的範圍判定
 *
 * 只對 `acceptsPercentScale` 的欄位套用。
 */
function normalizePercentScale(assumption: WhatIfAssumption): NormalizeResult {
  const spec = FIELD_SPECS[assumption.field];
  if (spec === undefined || spec.acceptsPercentScale !== true) {
    return { kind: 'value', value: assumption.value };
  }

  const { value } = assumption;

  if (value === 1) {
    return {
      kind: 'ambiguous',
      message:
        `欄位「${echo(assumption.field)}」的值 1 無法判定單位：` +
        '可能是 1（即 100%）或 1%。請改用明確寫法，例如 1.0（100%）或 0.01（1%）。',
    };
  }

  if (value > 1 && value <= 100) {
    return { kind: 'value', value: value / 100 };
  }

  return { kind: 'value', value };
}

// ─── Individual validators ────────────────────────────────────────────────────

/** entity_id 前綴驗證（SchemaValidator） */
function validateEntityPrefix(assumption: WhatIfAssumption): string | null {
  const type = classifyEntity(assumption.entity_id);
  if (type === null) {
    return `無法識別實體「${echo(assumption.entity_id)}」。實體 ID 必須以 ${ROAD_SEGMENT_PREFIX}（路段）或 ${BASE_STATION_PREFIX}（基地台）開頭。`;
  }
  return null;
}

/** field 白名單驗證（SchemaValidator） */
function validateFieldWhitelist(assumption: WhatIfAssumption): string | null {
  if (!(assumption.field in FIELD_SPECS)) {
    const valid = Object.keys(FIELD_SPECS).join('、');
    return `欄位「${echo(assumption.field)}」不在支援的欄位清單中。有效欄位：${valid}。`;
  }
  return null;
}

/** entity 類型與 field 的匹配驗證（DomainValidator） */
function validateEntityFieldMatch(assumption: WhatIfAssumption): string | null {
  const entityType = classifyEntity(assumption.entity_id);
  if (entityType === null) return null; // 已由 validateEntityPrefix 處理

  const spec = FIELD_SPECS[assumption.field];
  if (spec === undefined) return null; // 已由 validateFieldWhitelist 處理

  if (!spec.allowedEntities.includes(entityType)) {
    const allowed = spec.allowedEntities.map((t) =>
      t === 'road_segment' ? `路段（${ROAD_SEGMENT_PREFIX}*）` : `基地台（${BASE_STATION_PREFIX}*）`,
    ).join('或');
    return `欄位「${echo(assumption.field)}」只適用於 ${allowed}，無法用於「${echo(assumption.entity_id)}」。`;
  }
  return null;
}

/** value 範圍驗證（DomainValidator） */
function validateValueRange(assumption: WhatIfAssumption): string | null {
  const spec = FIELD_SPECS[assumption.field];
  if (spec === undefined) return null;

  const { value } = assumption;

  if (!isFinite(value)) {
    return `欄位「${echo(assumption.field)}」的值必須是有限數字。`;
  }

  if (value < spec.minValue || value > spec.maxValue) {
    const hint = spec.scaleHint !== undefined ? ` ${spec.scaleHint}` : '';
    return `欄位「${echo(assumption.field)}」的值 ${value} 超出合理範圍（${spec.minValue}–${spec.maxValue}）。${hint}`;
  }

  if (spec.mustBeInteger && !Number.isInteger(value)) {
    return `欄位「${echo(assumption.field)}」的值必須是整數（如 40000），收到 ${value}。`;
  }

  return null;
}

/** 歧義偵測：同一 entity_id + field 出現超過一次（DomainValidator） */
function detectAmbiguity(assumptions: readonly WhatIfAssumption[]): string | null {
  const seen = new Set<string>();
  for (const a of assumptions) {
    const key = `${a.entity_id}::${a.field}`;
    if (seen.has(key)) {
      return `假設條件中，實體「${echo(a.entity_id)}」的欄位「${echo(a.field)}」出現超過一次，造成歧義。請只指定一個值。`;
    }
    seen.add(key);
  }
  return null;
}

// ─── Main function ────────────────────────────────────────────────────────────

/**
 * What-if stage 2 決定性驗證：SchemaValidator + DomainValidator。
 *
 * 驗證順序（§14.5 stage 2）：
 * 1. SchemaValidator：entity_id 前綴、field 白名單
 * 2. 量綱正規化：百分比 → 小數（單位無法判定時直接澄清，不猜測）
 * 3. DomainValidator：entity/field 匹配、value 範圍（以正規化後的值）
 * 4. 歧義偵測
 *
 * 通過時回傳的 `validated_assumptions` 是**正規化後**的值，
 * 與 Rule Engine 的門檻同一量綱（小數）。
 *
 * 任一項失敗 → `validation_status: 'clarification_required'`（不進入 stage 3）。
 * 全部通過 → `validation_status: 'valid'`（validated_assumptions 交給 stage 3）。
 *
 * @param assumptions - stage 1 Bedrock 解析出的假設條件
 * @returns ValidateScenarioResult
 */
export function validateScenario(
  assumptions: readonly WhatIfAssumption[],
): ValidateScenarioResult {
  if (assumptions.length === 0) {
    return {
      validation_status: 'clarification_required',
      clarification_prompt: '假設條件不能為空，請輸入至少一個假設條件。',
      validation_errors: ['empty_assumptions'],
    };
  }

  const errors: string[] = [];

  // ── 1. SchemaValidator per assumption ───────────────────────────────────
  for (const assumption of assumptions) {
    const prefixError = validateEntityPrefix(assumption);
    if (prefixError) errors.push(prefixError);

    const fieldError = validateFieldWhitelist(assumption);
    if (fieldError) errors.push(fieldError);
  }

  // ── 2. 量綱正規化（百分比 → 小數）；無法判定單位即澄清 ────────────────
  //     必須在範圍驗證之前執行，範圍是以正規化後的量綱定義的。
  const normalized: WhatIfAssumption[] = [];
  if (errors.length === 0) {
    for (const assumption of assumptions) {
      const result = normalizePercentScale(assumption);
      if (result.kind === 'ambiguous') {
        errors.push(result.message);
        continue;
      }
      normalized.push(
        result.value === assumption.value ? assumption : { ...assumption, value: result.value },
      );
    }
  }

  // ── 3. DomainValidator per assumption（以正規化後的值驗證）────────────
  if (errors.length === 0) {
    for (const assumption of normalized) {
      const matchError = validateEntityFieldMatch(assumption);
      if (matchError) errors.push(matchError);

      const rangeError = validateValueRange(assumption);
      if (rangeError) errors.push(rangeError);
    }
  }

  // ── 4. 歧義偵測 ──────────────────────────────────────────────────────────
  if (errors.length === 0) {
    const ambiguityError = detectAmbiguity(normalized);
    if (ambiguityError) errors.push(ambiguityError);
  }

  if (errors.length > 0) {
    return {
      validation_status: 'clarification_required',
      clarification_prompt: errors.join(' '),
      validation_errors: errors,
    };
  }

  // stage 3 一律收到正規化後的值（小數量綱），與 Rule Engine 的門檻同單位
  return {
    validation_status: 'valid',
    validated_assumptions: normalized,
  };
}
