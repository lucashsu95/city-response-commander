/**
 * 決策核心型別
 *
 * DecisionCore 是整個系統的核心資料結構，
 * 記錄一次完整決策的所有數值與布林真值。
 *
 * 所有欄位由 deterministic code 填寫，
 * AI (Bedrock) 只負責填寫文字欄位。
 *
 * @module shared-schemas/decision-core
 */

import type {
  TrafficGrade,
  DecisionStatus,
  SOPArticle,
  Language,
  ValidationStatus,
} from './enums.js';

// ─── 時間戳 ────────────────────────────────────────────────

/** 時間戳三件組 */
export interface TimestampTriplet {
  /** 原始時間戳 (byte-identical to source) */
  readonly raw: string;
  /** 正規化時間戳 (ISO 8601) */
  readonly normalized: string;
  /** 顯示用時間戳 (YYYY-MM-DD HH:MM) */
  readonly display: string;
}

// ─── 路段分級結果 ──────────────────────────────────────────

/** 單一路段的分級結果 */
export interface SegmentClassification {
  /** 路段 ID */
  readonly segment_id: string;
  /** 路名 */
  readonly road_name: string;
  /** 摘和度 */
  readonly saturation_score: number;
  /** 分級 */
  readonly grade: TrafficGrade;
  /** 是否為城市應變觸發路段 (RD_TPE_001 或 RD_TPE_002) */
  readonly is_trigger_segment: boolean;
}

// ─── 疏散路徑候選 ──────────────────────────────────────────

/** 疏散路徑候選 */
export interface RouteCandidate {
  /** 路段 ID */
  readonly segment_id: string;
  /** 路名 */
  readonly road_name: string;
  /** 容量 vph */
  readonly capacity_vph: number;
  /** 當下飽和度 */
  readonly saturation_at_snapshot: number;
  /** 是否通過三項篩選 */
  readonly passes_all_filters: boolean;
  /** 排除原因 (若未通過篩選) */
  readonly exclusion_reasons: readonly string[];
  /** 是否為上游 (true=上游→主疏散, false=下游→次要) */
  readonly is_upstream: boolean;
}

// ─── ETE 結果 ──────────────────────────────────────────────

/** ETE 計算結果 */
export interface ETEResult {
  /** ETE 分鐘數 */
  readonly ete_minutes: number;
  /** base_clearance 分鐘 */
  readonly base_clearance: number;
  /** congestion_penalty 分鐘 */
  readonly congestion_penalty: number;
  /** 受影響路段平均飽和度 */
  readonly avg_saturation: number;
  /** 嚴重度 */
  readonly severity: string;
}

// ─── 觸發的 SOP 條款 ──────────────────────────────────────

/** SOP 觸發記錄 */
export interface SOPTrigger {
  /** 條款編號 */
  readonly article: SOPArticle;
  /** 觸發條件描述 */
  readonly trigger_condition: string;
  /** 使用的資料值 */
  readonly data_values: Record<string, unknown>;
}

// ─── 決策核心 ──────────────────────────────────────────────

/**
 * 決策核心 — 一次事件決策的完整數值快照
 *
 * 所有數值欄位由 deterministic code 填寫，
 * immutable_after_commit 後不可修改。
 */
export interface DecisionCore {
  /** 決策 ID */
  readonly decision_id: string;
  /** 事件 ID */
  readonly event_id: string;
  /** 決策時間戳 */
  readonly decision_timestamp: TimestampTriplet;
  /** 決策狀態 */
  status: DecisionStatus;

  // ── 事件資料快照 ──
  /** 事件類型 */
  readonly incident_type: string;
  /** 受影響路段 */
  readonly affected_segment: string;
  /** 事件嚴重度 */
  readonly severity: string;
  /** 事件狀態 */
  readonly incident_status: string;

  // ── 分級結果 ──
  /** 全部 15 路段分級 */
  readonly classifications: readonly SegmentClassification[];
  /** 觸發的 SOP 條款 */
  readonly triggered_articles: readonly SOPArticle[];

  // ── 路徑決策 ──
  /** 主疏散路徑 */
  readonly primary_evacuation?: RouteCandidate;
  /** 次要疏散路徑 */
  readonly secondary_evacuation?: readonly RouteCandidate[];
  /** 被排除的路徑 */
  readonly excluded_routes: readonly RouteCandidate[];

  // ── ETE ──
  /** ETE 計算結果 */
  readonly ete?: ETEResult;

  // ── 觸發措施 ──
  /** 是否啟動長綠燈時制 */
  readonly long_green_light: boolean;
  /** 是否通知北捷 */
  readonly notify_metro: boolean;
  /** 是否通知公車處 */
  readonly notify_bus: boolean;
  /** 是否調度警力 */
  readonly dispatch_police: boolean;

  // ── CMS 文字 (deterministic template) ──
  /** CMS 官方文字 */
  readonly cms_core_text: string;

  // ── 來源驗證 ──
  /** 官方來源雜湊驗證狀態 */
  readonly source_manifest_hash: string;

  // ── 時間戳對齊 (Strategy A) ──
  /** 使用的時間對齊策略 */
  readonly time_alignment_strategy: string;
  /** 對齊的快照時間戳 */
  readonly snapshot_timestamp: TimestampTriplet;
  /** 是否精確匹配 */
  readonly exact_match: boolean;
}

// ─── 決策筆記 (AI 生成) ────────────────────────────────────

/** 決策筆記 — AI 生成的文字內容 */
export interface DecisionNarrative {
  /** 決策 ID */
  readonly decision_id: string;
  /** 筆記類型 */
  readonly narrative_type: 'REPORT' | 'PUBLIC_ALERT' | 'EXPLANATION';
  /** 語言 */
  readonly language: Language;
  /** AI 生成的文字內容 */
  content: string;
  /** 生成時間 */
  readonly generated_at: string;
  /** 使用的 Bedrock 模型 ID */
  readonly model_id: string;
}
