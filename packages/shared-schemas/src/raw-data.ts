/**
 * 原始資料解析型別
 *
 * 對應五個官方資料檔案的原始欄位：
 * - city_traffic_flow.csv
 * - signaling_crowd_density.csv
 * - road_network_geometry.json
 * - live_incidents.json
 * - emergency_traffic_sop.txt
 *
 * @module shared-schemas/raw-data
 */

import type { LaneStatus, IncidentType, IncidentStatus, IncidentSeverity } from './enums.js';

// ─── city_traffic_flow.csv ──────────────────────────────────

/** 原始車流記錄 (對應 CSV 每一列) */
export interface RawTrafficRecord {
  /** 原始時間戳 (不可變更，例如 "2026/5/20 22:10") */
  readonly timestamp_raw: string;
  /** 路段 ID (例如 "RD_TPE_002") */
  readonly Segment_ID: string;
  /** 路名 (例如 "光復南路") */
  readonly Road_Name: string;
  /** 平均車速 km/h */
  readonly Avg_Speed: number;
  /** 車輛數 */
  readonly Vehicle_Count: number;
  /** 飽和度 0.0~1.0 */
  readonly Saturation_Score: number;
  /** 車道狀態 */
  readonly Lane_Status: LaneStatus;
}

// ─── signaling_crowd_density.csv ────────────────────────────

/** 原始人流記錄 (對應 CSV 每一列) */
export interface RawCrowdRecord {
  /** 原始時間戳 (不可變更) */
  readonly timestamp_raw: string;
  /** 基地台 ID (例如 "BS_MRT_BL17") */
  readonly BS_ID: string;
  /** 位置名稱 (例如 "捷運國父紀念館站") */
  readonly Location_Name: string;
  /** 用戶數 */
  readonly User_Count: number;
  /** 平均停留時間 (分鐘) */
  readonly Stay_Time_Avg: number;
  /** 成長率 (例如 0.08 = 8%) */
  readonly Growth_Rate: number;
  /** 漫遊用戶比率原始字串 (例如 "30%") */
  readonly Roaming_User_Pct: string;
  /** 漫遊用戶比率 normalized (例如 0.30) — 由 PercentParser 產生 */
  readonly roaming_pct_value: number;
}

// ─── road_network_geometry.json ─────────────────────────────

/** 路段幾何記錄 (對應 JSON 每個元素) */
export interface RoadSegment {
  /** 路段 ID (例如 "RD_TPE_002") */
  readonly segment_id: string;
  /** 路名 (例如 "光復南路") */
  readonly name: string;
  /** 車流方向 (例如 "南北向") */
  readonly flow_direction: string;
  /** 相交路口 (已按上游→下游排序) */
  readonly intersections: readonly string[];
  /** 每小時承載容量 */
  readonly capacity_vph: number;
  /** 建議分流方向 (單向，不可假設對稱) */
  readonly alternatives: readonly string[];
  /** 周邊基地台 (空陣列為正常) */
  readonly nearby_stations: readonly string[];
}

// ─── live_incidents.json ────────────────────────────────────

/** 事件記錄 (對應 JSON 每個元素) */
export interface Incident {
  /** 事件 ID */
  readonly event_id: string;
  /** 事件類型 */
  readonly type: IncidentType;
  /** 事件位置 (自然語言) */
  readonly location: string;
  /** 受影響 segment ID */
  readonly affected_segment: string;
  /** 受影響道路 ID (僅 EVT_002 有此欄位) */
  readonly affected_road?: string;
  /** 事件狀態 */
  readonly status: IncidentStatus;
  /** 事件嚴重度 */
  readonly severity: IncidentSeverity;
  /** 事件描述 */
  readonly description: string;
  /** 事件時間戳 (ISO 格式 "2026-05-20 22:10") */
  readonly timestamp: string;
}

// ─── emergency_traffic_sop.txt ──────────────────────────────

/** SOP 條款區塊 */
export interface SOPArticleChunk {
  /** 條款編號 (1~7) */
  readonly article_no: number;
  /** 條款標題 */
  readonly title: string;
  /** 條款原文 (逐字保留) */
  readonly text: string;
}
