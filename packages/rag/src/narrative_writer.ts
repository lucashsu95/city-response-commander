/**
 * narrative_writer — 共用 DecisionNarrative 寫入器 (TASK-116)
 *
 * 每個 Composer 呼叫 `putNarrative()` 以 PK(decision_id) + SK(narrative_type) 複合鍵，
 * 透過 `attribute_not_exists(decision_id)` **單一參數** conditional Put
 * 寫入自己的 `narrative_type` item（絕不覆寫其他 branch 的 item）。
 *
 * 設計規則（§10.11b, §15.1, competition_quality_floor）：
 * - **單一 PK+SK 組合**：每個 branch 只寫自己的 `narrative_type`；
 *   三個 branch（REPORT / PUBLIC_ALERT / EXPLANATION）同時執行時互不干擾。
 * - **`attribute_not_exists(decision_id)` 單一參數形式**：
 *   PK 與 SK 皆隨 Put item 提供；condition expression 只看 PK 是否已存在於
 *   同一 PK+SK 組合（DynamoDB 複合主鍵語意）。
 *   ⚠️ 禁止雙參數 `attribute_not_exists(decision_id) AND attribute_not_exists(narrative_type)` 形式，
 *   此為無效的 DynamoDB condition expression 語法（spec §15.1 明確禁止）。
 * - **ConditionalCheckFailedException → `branch_already_completed`**：
 *   同一 `(decision_id, narrative_type)` 已存在時，回傳此結果而非丟出例外；
 *   確保 at-least-once Lambda / Step Functions 重試安全。
 * - **跨 branch 不覆寫**：
 *   `attribute_not_exists(decision_id)` 在複合鍵表上只保護同 PK+SK 組合，
 *   因此 REPORT 無法覆蓋 PUBLIC_ALERT 等其他 item。
 *
 * 依賴：
 * - `NarrativeTableClient`：抽象介面，讓 composers 在 LOCAL_MOCK / 測試中注入 stub，
 *   不直接依賴 `@aws-sdk/client-dynamodb`（rag 套件暫無 DDB SDK 依賴）。
 * - `TASK-063`（真實 DynamoDB client 包裝）完成後，由後端注入 `DynamoNarrativeTableClient`。
 *
 * @module rag/narrative_writer
 */

import type {
  NarrativeType,
  ReportPayload,
  PublicAlertPayload,
  ExplanationPayload,
} from '@city-commander/shared-schemas';

// ─── Event type mapping ───────────────────────────────────────────────────────

/**
 * NarrativeType → WebSocket event_type 對應表。
 *
 * `ready_event_id` 格式為 `{decision_id}|{event_type}|{core_version_ref}`，
 * 其中 `event_type` 是 WebSocket 事件鑑別子（§13），**不是** NarrativeType enum 值。
 * Dashboard 以此 key 做 dedup，兩端（DynamoDB 與 WebSocket）必須一致。
 *
 * - REPORT        → `report.ready`
 * - PUBLIC_ALERT  → `public_alert.ready`
 * - EXPLANATION   → `decision.enriched`（無獨立 explanation.ready，以 enriched 表示）
 */
const NARRATIVE_TYPE_TO_EVENT_TYPE: Record<NarrativeType, string> = {
  REPORT: 'report.ready',
  PUBLIC_ALERT: 'public_alert.ready',
  EXPLANATION: 'decision.enriched',
};

// ─── NarrativeTableClient interface ──────────────────────────────────────────

/**
 * 抽象 DynamoDB 寫入介面。
 *
 * 這個介面讓 narrative_writer 不直接依賴 AWS SDK，
 * 方便 LOCAL_MOCK / 測試注入 stub，
 * 也讓真實的 DynamoDB 包裝（TASK-063）延後注入。
 *
 * @precondition 實作此介面時，`conditionalPut` 的 ConditionExpression **必須**使用
 *   單一參數形式：`attribute_not_exists(decision_id)`（PK+SK 均已作為 item 提供）。
 *   禁止雙參數形式（`attribute_not_exists(decision_id) AND attribute_not_exists(narrative_type)`），
 *   此為無效的 DynamoDB condition expression（spec §15.1）。
 */
export interface NarrativeTableClient {
  /**
   * 以 `attribute_not_exists(decision_id)` conditional Put 寫入一筆 narrative item。
   *
   * **ConditionExpression 約束（§15.1）**：
   * - 使用 **單一參數形式**：`attribute_not_exists(decision_id)`
   * - 提供完整 PK(decision_id) + SK(narrative_type) 作為 item key
   * - **禁止**雙參數形式：`attribute_not_exists(decision_id) AND attribute_not_exists(narrative_type)`
   *
   * - 成功寫入 → 回傳 `'committed'`
   * - 該 (decision_id, narrative_type) 已存在（ConditionalCheckFailedException）
   *   → 回傳 `'already_exists'`
   * - 其他 DynamoDB 錯誤 → **丟出例外**（呼叫端負責處理）
   *
   * @param item - 完整的 narrative item，包含 PK(decision_id)、SK(narrative_type) 與 payload
   * @returns `'committed'` 或 `'already_exists'`
   */
  conditionalPut(item: NarrativeItem): Promise<'committed' | 'already_exists'>;
}

/**
 * narrative item 的資料結構，對應 DecisionNarrativeTable 一筆記錄。
 *
 * 欄位語意：
 * - `decision_id`：PK（對應 DecisionCore.decision_id）
 * - `narrative_type`：SK（REPORT / PUBLIC_ALERT / EXPLANATION）
 * - `core_version_ref`：DecisionCore.version，item metadata，供版本追溯與 ready_event_id 組裝
 * - `ready_event_id`：Dashboard dedup key（`decision_id|event_type|core_version_ref`），
 *   `event_type` 為 WebSocket 事件鑑別子（`report.ready` 等），非 NarrativeType enum 值
 * - `payload`：LLM 生成的型別化 payload（已通過 SchemaValidator）
 * - `created_at`：ISO 8601 寫入時間戳記
 */
export interface NarrativeItem {
  readonly decision_id: string;
  readonly narrative_type: NarrativeType;
  /** DecisionCore.version — item metadata，用於版本追溯與 ready_event_id 組裝 */
  readonly core_version_ref: number;
  /**
   * Dashboard dedup key：`{decision_id}|{event_type}|{core_version_ref}`
   * `event_type` 是 WebSocket 事件鑑別子（`report.ready` / `public_alert.ready` / `decision.enriched`）
   */
  readonly ready_event_id: string;
  /** 已通過 SchemaValidator 驗證的型別化 LLM payload */
  readonly payload: ReportPayload | PublicAlertPayload | ExplanationPayload;
  readonly created_at: string;
}

// ─── Result types ─────────────────────────────────────────────────────────────

/** `putNarrative()` 寫入成功（首次寫入）*/
export interface NarrativePutCommitted {
  readonly outcome: 'committed';
}

/**
 * `putNarrative()` 已存在（at-least-once 重試安全）。
 *
 * 對應 DynamoDB `ConditionalCheckFailedException`：
 * 同 `(decision_id, narrative_type)` 已由本 branch 先前執行寫入，
 * 呼叫端可安全跳過，不視為錯誤。
 */
export interface NarrativePutBranchAlreadyCompleted {
  readonly outcome: 'branch_already_completed';
}

export type NarrativePutResult = NarrativePutCommitted | NarrativePutBranchAlreadyCompleted;

// ─── Main function ────────────────────────────────────────────────────────────

/**
 * 將已驗證的 narrative 寫入 DecisionNarrativeTable。
 *
 * 每個 Composer 呼叫此函式寫入自己的 `narrative_type` item。
 * 並行的三個 branch 因各自的 SK 不同，永不互相覆寫。
 *
 * 寫入邏輯（§15.1）：
 * ```
 * conditional Put with attribute_not_exists(decision_id)
 *   ↓ success           → committed
 *   ↓ ConditionalCheck  → branch_already_completed
 *   ↓ other DDB error   → throws（呼叫端自行處理 / template fallback）
 * ```
 *
 * @param client          - NarrativeTableClient 實例（LOCAL_MOCK 注入 stub；生產注入 DDB wrapper）
 * @param decisionId      - 對應 DecisionCore.decision_id（PK）
 * @param narrativeType   - 本次 branch 的 narrative_type（SK）
 * @param coreVersionRef  - DecisionCore.version（item metadata；用於 ready_event_id 組裝）
 * @param payload         - 已通過 SchemaValidator 的型別化 LLM payload
 * @returns NarrativePutResult
 *
 * @throws {Error} 當底層 DynamoDB 拋出非 conditional-check 錯誤時
 *
 * @example
 * // ReportComposer 使用範例
 * const result = await putNarrative(
 *   tableClient,
 *   core.decision_id,
 *   NarrativeType.REPORT,
 *   core.version,
 *   { type: 'REPORT', report_text: 'AI 生成的建議書...' },
 * );
 * if (result.outcome === 'branch_already_completed') {
 *   // at-least-once retry 安全跳過
 * }
 */
export async function putNarrative(
  client: NarrativeTableClient,
  decisionId: string,
  narrativeType: NarrativeType,
  coreVersionRef: number,
  payload: ReportPayload | PublicAlertPayload | ExplanationPayload,
): Promise<NarrativePutResult> {
  const item: NarrativeItem = {
    decision_id: decisionId,
    narrative_type: narrativeType,
    core_version_ref: coreVersionRef,
    ready_event_id: buildReadyEventId(decisionId, narrativeType, coreVersionRef),
    payload,
    created_at: new Date().toISOString(),
  };

  const putResult = await client.conditionalPut(item);

  if (putResult === 'already_exists') {
    return { outcome: 'branch_already_completed' };
  }

  return { outcome: 'committed' };
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * 組裝 ready_event_id（Dashboard dedup key）。
 *
 * 格式：`{decision_id}|{event_type}|{core_version_ref}`
 *
 * `event_type` 使用 WebSocket 事件鑑別子（如 `report.ready`），
 * 而非 NarrativeType enum 值（如 `REPORT`）。
 * 兩端（DynamoDB item 與 WebSocket 推送）必須使用相同格式，否則 dashboard dedup 靜默失效。
 *
 * @see NARRATIVE_TYPE_TO_EVENT_TYPE
 * @see events.ts 中的 `ReportReadyEvent`, `PublicAlertReadyEvent`, `DecisionEnrichedEvent`
 */
function buildReadyEventId(
  decisionId: string,
  narrativeType: NarrativeType,
  coreVersionRef: number,
): string {
  const eventType = NARRATIVE_TYPE_TO_EVENT_TYPE[narrativeType];
  return `${decisionId}|${eventType}|${coreVersionRef}`;
}
