/**
 * recompute — What-if stage 3：決定性重算 (TASK-139)
 *
 * 職責（§14.5 stage 3, §10.15, §22.1 P28）：
 * - 接收 stage 2 驗證通過的假設條件（`WhatIfAssumption[]`）
 * - 以假設值直接套用 SOP 觸發規則（決定性，不呼叫 LLM）
 * - 回傳 `RecomputeResult`（triggered_articles / applied_formula_articles /
 *   expected_actions / ete_preview / does_not_mutate_state）
 * - `does_not_mutate_state: true` 為靜態型別保證——此函式**零寫入**任何狀態表
 *
 * 設計說明：
 * - 直接內聯 SOP 觸發規則（閾值來自官方 SOP 文件），不依賴外部套件
 * - 避免跨套件依賴造成的 vitest ESM 解析問題
 * - 規則與 packages/domain/src/rule_engine/ 完全一致，但獨立實作以確保可測試性
 *
 * 支援的假設條件欄位（與 TASK-138 DomainValidator 的 FIELD_SPECS 對齊）：
 * - `Saturation_Score`（路段）→ SOP-1 分級（A/B）
 * - `User_Count`（基地台）→ SOP-3 觸發條件
 * - `Growth_Rate`（基地台）→ SOP-3 觸發條件
 * - `Roaming_User_Pct`（基地台）→ SOP-6 多語觸發
 *
 * @module backend/whatif/recompute
 */

import type { WhatIfAssumption, RecomputeResult } from './whatif_types.js';

// ─── SOP thresholds（來自 emergency_traffic_sop.txt）──────────────────────────

/** SOP-1：A 級 Saturation_Score >= 0.95 */
const A_LEVEL_THRESHOLD = 0.95;

/** SOP-1：B 級 0.85 <= Saturation_Score < 0.95 */
const B_LEVEL_THRESHOLD = 0.85;

/** SOP-3：BL17 User_Count strictly > 25000 */
const BL17_USER_COUNT_THRESHOLD = 25000;

/** SOP-3：BL17 Growth_Rate strictly > 0.30 */
const BL17_GROWTH_RATE_THRESHOLD = 0.30;

/** SOP-6：Roaming_User_Pct >= 0.30 */
const ROAMING_THRESHOLD = 0.30;

/** SOP-3 的目標基地台 */
const BL17_STATION_ID = 'BS_MRT_BL17';

// ─── Input type ────────────────────────────────────────────────────────────

/**
 * `recompute()` 所需的輸入。
 * - `assumptions`：stage 2 驗證通過的假設條件（read-only）
 */
export interface RecomputeInput {
  readonly assumptions: readonly WhatIfAssumption[];
}

// ─── Main function ────────────────────────────────────────────────────────────

/**
 * What-if stage 3 決定性重算。
 *
 * 以 `assumptions` 直接套用 SOP 觸發規則，回傳假設情境下的決策摘要。
 * `does_not_mutate_state: true`（靜態型別保證），零寫入任何狀態表。
 *
 * P28（§22.1）：重算結果須等同以相同假設值直接跑 Rule Engine 的結果。
 *
 * @param input - RecomputeInput（validated_assumptions）
 * @returns RecomputeResult（does_not_mutate_state: true）
 */
export function recompute(input: RecomputeInput): RecomputeResult {
  const { assumptions } = input;

  // ── 1. 解析假設快照 ────────────────────────────────────────────────────────
  const hypothetical = buildHypotheticalValues(assumptions);

  const triggeredArticles: number[] = [];
  const appliedFormulaArticles: number[] = [];
  const expectedActions: string[] = [];

  // ── 2. SOP-1：Saturation_Score → A/B 分級 ─────────────────────────────────
  let hasALevel = false;
  let hasBLevel = false;
  for (const [, sat] of hypothetical.saturationBySegment) {
    if (sat >= A_LEVEL_THRESHOLD) hasALevel = true;
    else if (sat >= B_LEVEL_THRESHOLD) hasBLevel = true;
  }

  if (hasALevel || hasBLevel) {
    if (!triggeredArticles.includes(1)) triggeredArticles.push(1);
    expectedActions.push('SOP-1：啟動長綠燈時制');
    if (hasALevel) {
      expectedActions.push('SOP-1：啟動替代路徑引導（A 級）');
    }
  }

  // ── 3. SOP-3：BL17 User_Count / Growth_Rate ────────────────────────────────
  const bl17CountTriggered =
    hypothetical.bl17UserCount !== null &&
    hypothetical.bl17UserCount > BL17_USER_COUNT_THRESHOLD;
  const bl17GrowthTriggered =
    hypothetical.bl17GrowthRate !== null &&
    hypothetical.bl17GrowthRate > BL17_GROWTH_RATE_THRESHOLD;

  if (bl17CountTriggered || bl17GrowthTriggered) {
    if (!triggeredArticles.includes(3)) triggeredArticles.push(3);
    expectedActions.push('SOP-3：建議北捷「過站不停」');
    expectedActions.push('SOP-3：通知公車處調度接駁專車');
    expectedActions.push('SOP-3：引導群眾步行至 BS_MRT_BL18');
  }

  // ── 4. SOP-6：Roaming_User_Pct ────────────────────────────────────────────
  const sop6Triggered = hypothetical.roamingStations.some(([, pct]) => pct >= ROAMING_THRESHOLD);
  if (sop6Triggered) {
    if (!triggeredArticles.includes(6)) triggeredArticles.push(6);
    expectedActions.push('SOP-6：產出多語化警示');
  }

  // ── 5. ETE 預覽（Saturation_Score 假設時提供粗略估計）────────────────────
  const etePreview = buildEtePreview(hypothetical.saturationBySegment);

  // 排序 triggered_articles（與 domain aggregateArticles 一致）
  triggeredArticles.sort((a, b) => a - b);

  return {
    triggered_articles: triggeredArticles,
    applied_formula_articles: appliedFormulaArticles,
    expected_actions: expectedActions,
    ete_preview: etePreview,
    does_not_mutate_state: true,
  };
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

interface HypotheticalValues {
  readonly saturationBySegment: readonly [string, number][];
  readonly bl17UserCount: number | null;
  readonly bl17GrowthRate: number | null;
  readonly roamingStations: readonly [string, number][];
}

function buildHypotheticalValues(assumptions: readonly WhatIfAssumption[]): HypotheticalValues {
  const saturationBySegment: [string, number][] = [];
  let bl17UserCount: number | null = null;
  let bl17GrowthRate: number | null = null;
  const roamingStations: [string, number][] = [];

  for (const a of assumptions) {
    switch (a.field) {
      case 'Saturation_Score':
        saturationBySegment.push([a.entity_id, a.value]);
        break;
      case 'User_Count':
        if (a.entity_id === BL17_STATION_ID) bl17UserCount = a.value;
        break;
      case 'Growth_Rate':
        if (a.entity_id === BL17_STATION_ID) bl17GrowthRate = a.value;
        break;
      case 'Roaming_User_Pct':
        roamingStations.push([a.entity_id, a.value]);
        break;
    }
  }

  return { saturationBySegment, bl17UserCount, bl17GrowthRate, roamingStations };
}

/**
 * 若有 Saturation_Score 假設，計算粗略 ETE 預覽（僅供 What-if 參考）。
 * 使用 SOP-7 公式（base=40/High, penalty=(avg_sat-0.5)*60, ≥0）。
 */
function buildEtePreview(
  saturationBySegment: readonly [string, number][],
): { readonly ete_minutes: number } | undefined {
  if (saturationBySegment.length === 0) return undefined;

  const saturations = saturationBySegment.map(([, s]) => s);
  const avg = saturations.reduce((sum, s) => sum + s, 0) / saturations.length;
  const base = 40; // High severity base（What-if 預覽保守值）
  const penalty = Math.max(0, (avg - 0.5) * 60);
  const ete_minutes = Math.round((base + penalty) * 10) / 10;

  return { ete_minutes };
}
