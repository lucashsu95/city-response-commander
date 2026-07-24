/**
 * API 合約型別
 *
 * 定義前端與後端之間的 API 請求/回應格式。
 *
 * @module shared-schemas/api-contracts
 */

import type { DecisionCore, DecisionNarrative } from './decision-core.js';
import type { Language } from './enums.js';

// ─── 事件注入 ──────────────────────────────────────────────

/** POST /api/incidents/inject — 請求體 */
export interface InjectIncidentRequest {
  /** 事件 ID (來自 live_incidents.json) */
  readonly event_id: string;
}

/** POST /api/incidents/inject — 回應體 */
export interface InjectIncidentResponse {
  /** 決策 ID */
  readonly decision_id: string;
  /** 事件 ID */
  readonly event_id: string;
  /** 決策狀態 */
  readonly status: string;
  /** 快速路徑是否就緒 */
  readonly fast_path_ready: boolean;
}

// ─── 決策查詢 ──────────────────────────────────────────────

/** GET /api/decisions/:id — 回應體 */
export interface GetDecisionResponse {
  /** 完整決策核心 */
  readonly core: DecisionCore;
  /** AI 生成筆記 (可能為 null，若 enrichment 尚未完成) */
  readonly narratives: readonly DecisionNarrative[];
}

// ─── 路段查詢 ──────────────────────────────────────────────

/** GET /api/roads — 回應體 */
export interface GetRoadsResponse {
  /** 全部 15 路段分級 */
  readonly roads: readonly {
    readonly segment_id: string;
    readonly road_name: string;
    readonly saturation_score: number;
    readonly grade: string;
    readonly is_trigger_segment: boolean;
  }[];
  /** 查詢時間戳 */
  readonly timestamp: string;
}

// ─── 人群查詢 ──────────────────────────────────────────────

/** GET /api/crowd — 回應體 */
export interface GetCrowdResponse {
  /** 全部基地台人流 */
  readonly stations: readonly {
    readonly bs_id: string;
    readonly location_name: string;
    readonly user_count: number;
    readonly growth_rate: number;
    readonly roaming_user_pct: number;
    readonly roaming_pct_display: string;
  }[];
  /** 查詢時間戳 */
  readonly timestamp: string;
}

// ─── What-if ────────────────────────────────────────────────

/** POST /api/what-if — 請求體 */
export interface WhatIfRequest {
  /** 自然語言假設條件 */
  readonly query: string;
}

/** POST /api/what-if — 回應體 */
export interface WhatIfResponse {
  /** 重新計算的決策核心 */
  readonly simulated_core: DecisionCore;
  /** AI 生成的解釋 */
  readonly explanation: string;
  /** 觸發的 SOP 條款 */
  readonly triggered_articles: readonly number[];
  /** 是否有歧義需要澄清 */
  readonly clarification_required: boolean;
  /** 需要澄清的問題 (若有) */
  readonly clarification_question?: string;
}

// ─── 多語警示 ──────────────────────────────────────────────

/** 多語警示內容 */
export interface MultilingualAlert {
  /** 觸發的 SOP 條款 */
  readonly triggered_sop: number;
  /** 各語言版本 */
  readonly messages: Record<Language, string>;
}
