/**
 * 城市交通應變 AI 指揮台 — 共用列舉
 *
 * 所有列舉值嚴格對齊官方文件：
 * - emergency_traffic_sop.txt (7 條 SOP)
 * - road_network_geometry.json (路段欄位)
 * - live_incidents.json (事件欄位)
 *
 * @module shared-schemas/enums
 */

// ─── 交通擁塞分級 (SOP 第 1 條) ───────────────────────────

/** 交通擁塞分級 */
export enum TrafficGrade {
  /** 正常: Saturation_Score < 0.85 */
  NORMAL = 'NORMAL',
  /** B 級 (壅擠 / 黃燈): 0.85 <= Saturation_Score < 0.95 */
  B_LEVEL = 'B_LEVEL',
  /** A 級 (癱瘓 / 紅燈): Saturation_Score >= 0.95 */
  A_LEVEL = 'A_LEVEL',
}

// ─── 車道狀態 ─────────────────────────────────────────────

/** 車道狀態 (city_traffic_flow.csv Lane_Status) */
export enum LaneStatus {
  Normal = 'Normal',
  Congested = 'Congested',
  Critical = 'Critical',
  Blocked = 'Blocked',
  Gridlock = 'Gridlock',
  Accident_Impact = 'Accident_Impact',
  Partial_Open = 'Partial_Open',
}

// ─── 事件欄位 (live_incidents.json) ────────────────────────

/** 事件類型 */
export enum IncidentType {
  Road_Collapse_Accident = 'Road_Collapse_Accident',
  Crowd_Surge_Injury = 'Crowd_Surge_Injury',
  Power_Failure = 'Power_Failure',
}

/** 事件狀態 */
export enum IncidentStatus {
  Closed = 'Closed',
  Blocked = 'Blocked',
  Restricted = 'Restricted',
  Caution = 'Caution',
}

/** 事件嚴重度 */
export enum IncidentSeverity {
  Critical = 'Critical',
  High = 'High',
  Medium = 'Medium',
}

// ─── 決策核心狀態 ─────────────────────────────────────────

/** 決策流程狀態 */
export enum DecisionStatus {
  /** 偵測到事件 */
  DETECTED = 'DETECTED',
  /** 核心決策已產出 (Fast Path) */
  CORE_COMMITTED = 'CORE_COMMITTED',
  /** 完整 enriched (含 AI 文字) */
  ENRICHED = 'ENRICHED',
  /** 已發布 */
  PUBLISHED = 'PUBLISHED',
  /** 處理失敗 */
  FAILED = 'FAILED',
}

// ─── 筆記/報告類型 ─────────────────────────────────────────

/** 決策筆記類型 */
export enum NarrativeType {
  /** 交控中心建議書 */
  REPORT = 'REPORT',
  /** 民眾警示 */
  PUBLIC_ALERT = 'PUBLIC_ALERT',
  /** 決策解釋 */
  EXPLANATION = 'EXPLANATION',
}

// ─── 語言 ──────────────────────────────────────────────────

/** 支援語言 */
export enum Language {
  ZH = 'zh',
  EN = 'en',
  JA = 'ja',
  KO = 'ko',
}

// ─── 資料來源類型 ──────────────────────────────────────────

/** 官方來源類型 */
export enum OfficialSourceType {
  PDF = 'PDF',
  DOCX = 'DOCX',
  CSV = 'CSV',
  JSON = 'JSON',
  SOP_TXT = 'SOP_TXT',
}

/** 驗證狀態 */
export enum ValidationStatus {
  VERIFIED = 'verified',
  HASH_MISMATCH = 'hash_mismatch',
  MISSING = 'missing',
  UNREADABLE = 'unreadable',
}

// ─── SOP 條款 ──────────────────────────────────────────────

/** SOP 條款編號 */
export enum SOPArticle {
  ARTICLE_1 = 1,
  ARTICLE_2 = 2,
  ARTICLE_3 = 3,
  ARTICLE_4 = 4,
  ARTICLE_5 = 5,
  ARTICLE_6 = 6,
  ARTICLE_7 = 7,
}

// ─── 路段 ID 前綴 ──────────────────────────────────────────

/** 路段 ID 前綴 (road_network_geometry.json) */
export const ROAD_SEGMENT_PREFIX = 'RD_TPE_' as const;

/** 基地台 ID 前綴 (signaling_crowd_density.csv) */
export const BASE_STATION_PREFIX = 'BS_' as const;
