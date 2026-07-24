/**
 * 城市交通應變 AI 指揮台 — 共用列舉
 *
 * 所有列舉值嚴格對齊官方文件：
 * - emergency_traffic_sop.txt (7 條 SOP)
 * - road_network_geometry.json (路段欄位)
 * - live_incidents.json (事件欄位)
 * - design.md §10, §12, §13
 *
 * @module shared-schemas/enums
 */

// ─── Schema Version ────────────────────────────────────────

/** Current schema version for all data models */
export const SCHEMA_VERSION = '1.0.0' as const;

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

/** 事件狀態 (live_incidents.json) */
export enum IncidentStatus {
  Closed = 'Closed',
  Blocked = 'Blocked',
  Restricted = 'Restricted',
  Open = 'Open',
  Caution = 'Caution',
}

/** 事件嚴重度 */
export enum Severity {
  Critical = 'Critical',
  High = 'High',
  Medium = 'Medium',
}

// Keep IncidentSeverity as alias for backward compat
export const IncidentSeverity = Severity;
export type IncidentSeverity = Severity;

// ─── 敘述類型 (§10.11b) ───────────────────────────────────

/**
 * DecisionNarrative narrative_type (SK)
 * Required set = {REPORT, PUBLIC_ALERT, EXPLANATION}
 */
export enum NarrativeType {
  /** 交控中心建議書 */
  REPORT = 'REPORT',
  /** 民眾警示 */
  PUBLIC_ALERT = 'PUBLIC_ALERT',
  /** 決策解釋 */
  EXPLANATION = 'EXPLANATION',
}

// ─── IdempotencyTable status (§10.11e) ─────────────────────

/**
 * IdempotencyTable.status — exactly 5 values (no 'accepted')
 *
 * HTTP 202 Accepted is an API response semantic, NOT a DynamoDB status.
 */
export enum IdempotencyStatus {
  starting = 'starting',
  running = 'running',
  completed = 'completed',
  start_failed = 'start_failed',
  processing_failed = 'processing_failed',
}

// ─── Recovery (§10.11e, §15.2) ─────────────────────────────

/** Recovery stage — determines what to re-run on recovery */
export enum RecoveryStage {
  /** No recovery needed (completed or terminal conflict) */
  detect = 'detect',
  /** Recovery gate phase */
  gate = 'gate',
  /** Reconciliation phase */
  reconcile = 'reconcile',
  /** Restart phase */
  restart = 'restart',
}

/** Recovery mode — passed as workflow INPUT */
export enum RecoveryMode {
  /** First execution (no recovery) */
  FIRST_RUN = 'FIRST_RUN',
  /** Stale recovery detected */
  STALE_RECOVERY = 'STALE_RECOVERY',
  /** Start failed, retry */
  START_FAILED_RETRY = 'START_FAILED_RETRY',
}

// ─── Evidence Source (§10.11e) ─────────────────────────────

/** Evidence source for core_committed flag */
export enum EvidenceSource {
  /** DecisionFn successfully committed the core */
  DECISIONFN_COMMITTED = 'DECISIONFN_COMMITTED',
  /** RecoveryGateFn confirmed core_exists during ENRICHMENT_ONLY */
  ENRICHMENT_COMMITTED = 'ENRICHMENT_COMMITTED',
}

// ─── Core Write Status (§6, §15.2) ────────────────────────

/**
 * DecisionFn conditional Put result — execution-local value
 *
 * NOT stored in DecisionCoreTable.
 */
export enum CoreWriteStatus {
  /** First successful write */
  COMMITTED = 'COMMITTED',
  /** Put failed but identity matches (safe task retry) */
  ALREADY_COMMITTED_SAME_DECISION = 'ALREADY_COMMITTED_SAME_DECISION',
  /** Put failed and identity does NOT match (fail-closed) */
  CORE_IDENTITY_CONFLICT = 'CORE_IDENTITY_CONFLICT',
}

// ─── Status Action Result (§10.11e fencing) ───────────────

/** Result of a fenced status action (apply-or-confirm) */
export enum StatusActionResult {
  /** Action applied successfully */
  APPLIED = 'APPLIED',
  /** Target already reached by same execution+attempt */
  ALREADY_APPLIED = 'ALREADY_APPLIED',
  /** Different execution/attempt — old execution terminates */
  FENCED_STALE_EXECUTION = 'FENCED_STALE_EXECUTION',
}

// ─── Congestion Level (§9.4, §10.8) ───────────────────────

/** Congestion level classification for route candidates */
export enum CongestionLevel {
  /** Saturation >= 0.95 */
  A = 'A',
  /** 0.85 <= Saturation < 0.95 */
  B = 'B',
  /** Saturation < 0.85 */
  NONE = 'NONE',
}

// ─── Publish status (§10.11d, §10.17) ─────────────────────

/** PublishRecord state machine states */
export enum PublishStatus {
  draft = 'draft',
  approved = 'approved',
  published = 'published',
  publish_failed = 'publish_failed',
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

// ─── Route Candidate Role (§10.8) ──────────────────────────

/** Route candidate role in evacuation */
export enum RouteCandidateRole {
  primary = 'primary',
  secondary = 'secondary',
  excluded = 'excluded',
  unranked_direct_intersection = 'unranked_direct_intersection',
}

// ─── Upstream/Downstream (§10.8) ───────────────────────────

/** Position relative to incident anchor */
export enum UpstreamDownstream {
  upstream = 'upstream',
  downstream = 'downstream',
}

// ─── 路段 ID 前綴 ──────────────────────────────────────────

/** 路段 ID 前綴 (road_network_geometry.json) */
export const ROAD_SEGMENT_PREFIX = 'RD_TPE_' as const;

/** 基地台 ID 前綴 (signaling_crowd_density.csv) */
export const BASE_STATION_PREFIX = 'BS_' as const;
