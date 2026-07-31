/**
 * recompute — What-if stage 3：決定性重算 (TASK-139)
 *
 * 職責（§14.5 stage 3, §10.15, §22.1 P28）：
 * - 接收 stage 2 驗證通過的假設條件（`WhatIfAssumption[]`）
 * - **以假設值重跑決定性 Rule Engine**（`@city-commander/domain`），不呼叫 LLM
 * - 回傳 `RecomputeResult`（triggered_articles / applied_formula_articles /
 *   expected_actions / ete_preview / does_not_mutate_state）
 * - `does_not_mutate_state: true` 為靜態型別保證——此函式**零寫入**任何狀態表
 *
 * 邊界（§9，成員 4 紅線）：
 * - 本模組**不得**自行定義任何 SOP 門檻或分級規則。
 *   所有布林與數值真值一律來自 `@city-commander/domain` 的 Rule Engine：
 *     `classifySegments`（A/B 分級門檻 0.95 / 0.85）
 *     `evaluateArticle1` （art.1 觸發路段與措施）
 *     `evaluateArticle3` （art.3 BL17 門檻 > 25000 / > 0.30）
 *     `evaluateArticle6` （art.6 漫遊率門檻 >= 0.30）
 *     `aggregateArticles`（triggered / applied_formula 分離與排序）
 * - 本模組只負責兩件事：
 *   (1) 把 `WhatIfAssumption[]` 轉成 Rule Engine 的輸入形狀
 *   (2) 把 Rule Engine 的結構化輸出轉成給指揮官看的 `expected_actions` 文字
 *   —— 文字措辭屬於呈現層，門檻與觸發結果一律由 domain 決定。
 *
 * P28（§22.1）要求「重算結果須等同以相同假設值直接跑 Rule Engine 的結果」，
 * 因此唯一能保證這件事的實作方式就是**真的去跑 Rule Engine**，而非複製其規則。
 *
 * @module backend/whatif/recompute
 */

import {
  classifySegments,
  evaluateArticle1,
  evaluateArticle3,
  evaluateArticle6,
  aggregateArticles,
  ARTICLE3_STATION_ID,
  type SegmentSnapshot,
  type CurrentStationSnapshot,
} from '@city-commander/domain';
import type { WhatIfAssumption, RecomputeResult } from './whatif_types.js';

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
 * 以 `assumptions` 為輸入重跑 Rule Engine，回傳假設情境下的決策摘要。
 * `does_not_mutate_state: true`（靜態型別保證），零寫入任何狀態表。
 *
 * @param input - RecomputeInput（validated_assumptions）
 * @returns RecomputeResult（does_not_mutate_state: true）
 */
export function recompute(input: RecomputeInput): RecomputeResult {
  const { assumptions } = input;

  // ── 1. 假設條件 → Rule Engine 輸入形狀 ────────────────────────────────────
  const hypothetical = buildHypotheticalInputs(assumptions);

  // ── 2. art.1：分級 + 觸發路段措施（門檻由 domain 決定）───────────────────
  const classifications = classifySegments(hypothetical.segmentSnapshots);
  const article1 = evaluateArticle1(classifications);

  // ── 3. art.3：BL17 人流門檻（門檻由 domain 決定）─────────────────────────
  const article3 = evaluateArticle3({
    bs_id: ARTICLE3_STATION_ID,
    user_count: hypothetical.bl17UserCount,
    growth_rate: hypothetical.bl17GrowthRate,
  });

  // ── 4. art.6：漫遊率多語觸發（門檻由 domain 決定）────────────────────────
  // What-if 的站集即「使用者明確假設的站」，對應 Strategy F 的 explicit 模式語意。
  const article6 = evaluateArticle6({
    mode: 'explicit_host_policy',
    stations_in_scope: hypothetical.roamingStations,
  });

  // ── 5. 條款聚合（triggered / applied_formula 分離，由 domain 決定）───────
  const aggregation = aggregateArticles({
    evaluations: [
      { article: 1, triggered: article1.triggered, invoked_procedures: article1.invoked_procedures },
      { article: 3, triggered: article3.triggered },
      { article: 6, triggered: article6.triggered },
    ],
    applied_formula_articles: [],
  });

  // ── 6. 呈現層：把決定性結果轉成指揮官可讀的動作說明 ──────────────────────
  const expectedActions = buildExpectedActions(article1, article3, article6);

  // ── 7. ETE 預覽（Saturation_Score 假設時提供粗略估計）────────────────────
  const etePreview = buildEtePreview(hypothetical.segmentSnapshots);

  return {
    triggered_articles: aggregation.triggered_articles,
    applied_formula_articles: aggregation.applied_formula_articles,
    expected_actions: expectedActions,
    ete_preview: etePreview,
    does_not_mutate_state: true,
  };
}

// ─── Assumption → Rule Engine input ───────────────────────────────────────────

interface HypotheticalInputs {
  /** art.1 分級輸入（每個被假設的路段一筆） */
  readonly segmentSnapshots: readonly SegmentSnapshot[];
  /** art.3 BL17 人數；null 表示本次假設未指定 */
  readonly bl17UserCount: number | null;
  /** art.3 BL17 成長率；null 表示本次假設未指定 */
  readonly bl17GrowthRate: number | null;
  /** art.6 站集（每個被假設漫遊率的基地台一筆） */
  readonly roamingStations: readonly CurrentStationSnapshot[];
}

/**
 * 將驗證後的假設條件攤平成 Rule Engine 各條款所需的輸入。
 *
 * 只做資料搬運，不做任何門檻判斷。
 * 未被假設到的欄位一律為 `null`（Rule Engine 會據此回報 `insufficient_data`，
 * 而非猜測），符合「不猜測」原則。
 */
function buildHypotheticalInputs(
  assumptions: readonly WhatIfAssumption[],
): HypotheticalInputs {
  const segmentSnapshots: SegmentSnapshot[] = [];
  const roamingStations: CurrentStationSnapshot[] = [];
  let bl17UserCount: number | null = null;
  let bl17GrowthRate: number | null = null;

  for (const a of assumptions) {
    switch (a.field) {
      case 'Saturation_Score':
        segmentSnapshots.push({ segment_id: a.entity_id, saturation_score: a.value });
        break;
      case 'User_Count':
        if (a.entity_id === ARTICLE3_STATION_ID) bl17UserCount = a.value;
        break;
      case 'Growth_Rate':
        if (a.entity_id === ARTICLE3_STATION_ID) bl17GrowthRate = a.value;
        break;
      case 'Roaming_User_Pct':
        roamingStations.push({ bs_id: a.entity_id, roaming_pct_value: a.value });
        break;
    }
  }

  return { segmentSnapshots, bl17UserCount, bl17GrowthRate, roamingStations };
}

// ─── Rule Engine output → expected_actions（呈現層）───────────────────────────

/**
 * 依 Rule Engine 的觸發結果組裝 `expected_actions` 文字。
 *
 * 這裡只做「布林 → 文字」的呈現轉換：
 * 是否觸發、觸發哪些條款，全部由 domain 的評估結果決定，本函式不做任何判斷。
 * art.3 的動作文字直接沿用 domain 回傳的 `actions`（官方 SOP 條文措辭），
 * art.1 的措施則由結構化 `art1_measures` 渲染，數值（+25% 綠燈）來自 domain。
 */
function buildExpectedActions(
  article1: ReturnType<typeof evaluateArticle1>,
  article3: ReturnType<typeof evaluateArticle3>,
  article6: ReturnType<typeof evaluateArticle6>,
): readonly string[] {
  const actions: string[] = [];

  for (const measure of article1.art1_measures) {
    actions.push(
      `SOP-1（${measure.trigger_segment}，${measure.level} 級）：啟動長綠燈時制、` +
        `替代路徑綠燈 +${measure.alternatives_green_plus_pct}%、派遣警力淨空路口`,
    );
    if (measure.a_level_invokes_article2_alternative_route_guidance) {
      actions.push(`SOP-1（${measure.trigger_segment}，A 級）：啟動第 2 條替代路徑引導程序`);
    }
  }

  for (const action of article3.actions) {
    actions.push(`SOP-3：${action}`);
  }

  if (article6.triggered) {
    const stations = article6.triggering_station_ids.join('、');
    actions.push(`SOP-6：產出多語化警示（觸發站台：${stations}）`);
  }

  return actions;
}

// ─── ETE preview ──────────────────────────────────────────────────────────────

/**
 * 若有 Saturation_Score 假設，計算粗略 ETE 預覽（僅供 What-if 參考）。
 * 使用 SOP-7 公式（base=40/High, penalty=(avg_sat-0.5)*60, ≥0）。
 */
function buildEtePreview(
  segmentSnapshots: readonly SegmentSnapshot[],
): { readonly ete_minutes: number } | undefined {
  const saturations = segmentSnapshots
    .map((s) => s.saturation_score)
    .filter((s): s is number => s !== null);
  if (saturations.length === 0) return undefined;

  const avg = saturations.reduce((sum, s) => sum + s, 0) / saturations.length;
  const base = 40; // High severity base（What-if 預覽保守值）
  const penalty = Math.max(0, (avg - 0.5) * 60);
  const ete_minutes = Math.round((base + penalty) * 10) / 10;

  return { ete_minutes };
}
