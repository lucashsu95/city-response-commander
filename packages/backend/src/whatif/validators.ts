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
 * - Growth_Rate：RawCrowdRecord，無硬性上限，但通常 [-1, 100]
 * - Roaming_User_Pct：RawCrowdRecord（normalized 0–1），由 stage 1 解析後為小數或百分比值
 */
interface FieldSpec {
  readonly allowedEntities: readonly EntityType[];
  readonly minValue: number;
  readonly maxValue: number;
  /** 此欄位是否必須是非負整數 */
  readonly mustBeInteger?: boolean;
}

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
    maxValue: 100,
  },
  Roaming_User_Pct: {
    allowedEntities: ['base_station'],
    minValue: 0,
    maxValue: 1,
  },
};

// ─── Individual validators ────────────────────────────────────────────────────

/** entity_id 前綴驗證（SchemaValidator） */
function validateEntityPrefix(assumption: WhatIfAssumption): string | null {
  const type = classifyEntity(assumption.entity_id);
  if (type === null) {
    return `無法識別實體「${assumption.entity_id}」。實體 ID 必須以 ${ROAD_SEGMENT_PREFIX}（路段）或 ${BASE_STATION_PREFIX}（基地台）開頭。`;
  }
  return null;
}

/** field 白名單驗證（SchemaValidator） */
function validateFieldWhitelist(assumption: WhatIfAssumption): string | null {
  if (!(assumption.field in FIELD_SPECS)) {
    const valid = Object.keys(FIELD_SPECS).join('、');
    return `欄位「${assumption.field}」不在支援的欄位清單中。有效欄位：${valid}。`;
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
    return `欄位「${assumption.field}」只適用於 ${allowed}，無法用於「${assumption.entity_id}」。`;
  }
  return null;
}

/** value 範圍驗證（DomainValidator） */
function validateValueRange(assumption: WhatIfAssumption): string | null {
  const spec = FIELD_SPECS[assumption.field];
  if (spec === undefined) return null;

  const { value } = assumption;

  if (!isFinite(value)) {
    return `欄位「${assumption.field}」的值必須是有限數字。`;
  }

  if (value < spec.minValue || value > spec.maxValue) {
    return `欄位「${assumption.field}」的值 ${value} 超出合理範圍（${spec.minValue}–${spec.maxValue}）。`;
  }

  if (spec.mustBeInteger && !Number.isInteger(value)) {
    return `欄位「${assumption.field}」的值必須是整數（如 40000），收到 ${value}。`;
  }

  return null;
}

/** 歧義偵測：同一 entity_id + field 出現超過一次（DomainValidator） */
function detectAmbiguity(assumptions: readonly WhatIfAssumption[]): string | null {
  const seen = new Set<string>();
  for (const a of assumptions) {
    const key = `${a.entity_id}::${a.field}`;
    if (seen.has(key)) {
      return `假設條件中，實體「${a.entity_id}」的欄位「${a.field}」出現超過一次，造成歧義。請只指定一個值。`;
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
 * 2. DomainValidator：entity/field 匹配、value 範圍
 * 3. 歧義偵測
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

  // ── 2. DomainValidator per assumption（僅在 schema 通過後執行）────────
  if (errors.length === 0) {
    for (const assumption of assumptions) {
      const matchError = validateEntityFieldMatch(assumption);
      if (matchError) errors.push(matchError);

      const rangeError = validateValueRange(assumption);
      if (rangeError) errors.push(rangeError);
    }
  }

  // ── 3. 歧義偵測 ──────────────────────────────────────────────────────────
  if (errors.length === 0) {
    const ambiguityError = detectAmbiguity(assumptions);
    if (ambiguityError) errors.push(ambiguityError);
  }

  if (errors.length > 0) {
    return {
      validation_status: 'clarification_required',
      clarification_prompt: errors.join(' '),
      validation_errors: errors,
    };
  }

  return {
    validation_status: 'valid',
    validated_assumptions: assumptions,
  };
}
