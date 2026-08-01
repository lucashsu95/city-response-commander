/**
 * publish.status_changed WebSocket event publisher (TASK-148)
 *
 * 職責（§13, §10.11d）：
 * - 每次 PublishRecord 狀態轉移後推送 `publish.status_changed` 事件
 * - event payload 攜帶 `publish_state` + `audit_trail` + `ready_event_id`（去重）
 * - 以 `GET /decisions/{id}` polling 作為 WebSocket 斷線時的 fallback
 * - 推送失敗不拋出例外：publish 狀態已寫入 DynamoDB，polling 為授權的 fallback（§13, §16.4）
 * - **不**修改 DecisionCore / PublishRecord（此模組純推送，零寫入 DynamoDB）
 *
 * 事件去重（§13）：
 * - `ready_event_id = decision_id|publish.status_changed|publish_state|version`
 * - Dashboard 以此 key 排除重複投遞（at-least-once WebSocket delivery）
 *
 * Polling fallback（§13, §16.4）：
 * - 斷線時 Dashboard 呼叫 `GET /decisions/{id}`
 * - 回傳的 `publish_state` + `audit_trail` 與本 event 欄位相同
 *
 * @module backend/realtime/publish_status_changed
 */

import type { PublishRecord, PublishStatusChangedEvent } from '@city-commander/shared-schemas';
import { PublishStatus, SCHEMA_VERSION } from '@city-commander/shared-schemas';

// ─── Event constant ───────────────────────────────────────────────────────────

/** WebSocket event type（§13） */
export const PUBLISH_STATUS_CHANGED_EVENT = 'publish.status_changed' as const;

/** ready_event_id 欄位分隔符 */
const READY_EVENT_ID_SEP = '|';

// ─── ready_event_id builder ───────────────────────────────────────────────────

/**
 * 建立 `publish.status_changed` 的去重 key。
 *
 * 格式：`{decision_id}|publish.status_changed|{publish_state}|{version}`
 *
 * 設計理由：
 * - `decision_id` 確保不同 decision 不互相去重
 * - `publish.status_changed` 確保不與其他 event type 衝突
 * - `publish_state` 確保同一 decision 的不同轉移狀態各自唯一
 * - `version` 確保樂觀鎖失敗重試後的事件不被去重掉
 */
export function buildPublishStatusChangedReadyEventId(input: {
  readonly decisionId: string;
  readonly publishState: PublishStatus;
  readonly version: number;
}): string {
  return [
    input.decisionId,
    PUBLISH_STATUS_CHANGED_EVENT,
    input.publishState,
    String(input.version),
  ].join(READY_EVENT_ID_SEP);
}

// ─── Event payload ────────────────────────────────────────────────────────────

/**
 * `publish.status_changed` WebSocket event payload（§13）。
 *
 * **刻意 `extends` shared-schemas 的 `PublishStatusChangedEvent`**，
 * 而不是自己重列一份欄位：
 * 前端（成員 5）是照 shared-schemas 的型別寫的，若這裡自行維護一份平行定義，
 * 成員 1 之後調整事件契約時兩邊會**靜默分歧**——編譯照過，執行期才發現對不上。
 * 繼承之後，任何契約變動都會在本檔案立刻變成編譯錯誤。
 *
 * ⚠️ 以下兩個欄位是本模組的**擴充**，尚未進入 shared-schemas：
 * `ready_event_id`、`polling_fallback_path`。
 * 需請成員 1 納入 `PublishStatusChangedEvent`，前端才能有型別地取用；
 * 在那之前，前端讀取這兩個欄位會是 untyped access。
 */
export interface PublishStatusChangedPayload extends PublishStatusChangedEvent {
  /** 去重 key（§13）*/
  readonly ready_event_id: string;
  /**
   * Polling fallback URL hint（§13, §16.4）。
   *
   * 告知 Dashboard 斷線時以 `GET {polling_fallback_path}` 取得最新 publish 狀態。
   */
  readonly polling_fallback_path: string;
}

// ─── Payload builder ──────────────────────────────────────────────────────────

/**
 * 從 PublishRecord 組裝 `publish.status_changed` 事件 payload。
 *
 * @param record - 已轉移到目標狀態的 PublishRecord（由 applyPublishTransition 回傳）
 * @param traceId - X-Ray trace ID（§19）
 * @param policyVersion - 本次決策使用的 policy version（§30）
 */
export function buildPublishStatusChangedPayload(input: {
  readonly record: PublishRecord;
  readonly traceId: string;
  readonly policyVersion: string;
}): PublishStatusChangedPayload {
  const { record, traceId, policyVersion } = input;

  return {
    event_type: PUBLISH_STATUS_CHANGED_EVENT,
    schema_version: SCHEMA_VERSION,
    trace_id: traceId,
    occurred_at: record.updated_at,
    provisional: false,
    policy_version: policyVersion,
    ready_event_id: buildPublishStatusChangedReadyEventId({
      decisionId: record.decision_id,
      publishState: record.publish_state,
      version: record.version,
    }),
    decision_id: record.decision_id,
    publish_state: record.publish_state,
    audit_trail: record.audit_trail,
    polling_fallback_path: `/decisions/${record.decision_id}`,
  };
}

// ─── WebSocket transport port ─────────────────────────────────────────────────

/**
 * WebSocket 傳輸埠介面（依賴注入，生產時注入 API Gateway Management Client）。
 *
 * 與 `publish_fast_path_ready.ts` 的 `ConnectionPublisherPort` 相同契約，
 * 但為獨立介面以避免跨模組循環依賴。
 */
export interface PublishStatusConnectionPublisher {
  /** 取得目前所有活躍連線 ID */
  listConnectionIds(): Promise<readonly string[]>;
  /**
   * 推送訊息至單一連線。
   *
   * @throws 攜帶 `$metadata.httpStatusCode === 410` 或 `name === 'GoneException'`
   *   的錯誤表示連線已斷開（stale）
   */
  postToConnection(connectionId: string, payload: string): Promise<void>;
  /**
   * 清理已斷開的連線記錄（選配）。
   *
   * 若實作此方法，`emitPublishStatusChanged` 廣播後會自動呼叫，
   * 清除返回 410 Gone 的 stale 連線，避免後續廣播浪費呼叫。
   * 未實作時靜默跳過（不影響事件推送）。
   */
  deleteConnection?(connectionId: string): Promise<void>;
}

// ─── Connection delivery result ───────────────────────────────────────────────

/** 單一連線的推送結果 */
export interface PublishStatusDeliveryResult {
  readonly connectionId: string;
  readonly delivered: boolean;
  /** true 表示連線已斷開（HTTP 410），呼叫端可清理 */
  readonly stale: boolean;
  readonly error?: string;
}

/** `emitPublishStatusChanged` 的整體結果 */
export interface EmitPublishStatusChangedResult {
  readonly payload: PublishStatusChangedPayload;
  readonly delivered: number;
  /** 已斷開的連線 ID */
  readonly staleConnectionIds: readonly string[];
  readonly failures: readonly PublishStatusDeliveryResult[];
}

// ─── Stale connection detection ───────────────────────────────────────────────

/**
 * 判斷推送錯誤是否代表「連線已消失」（HTTP 410 Gone）。
 *
 * API Gateway Management API 在連線不存在時回傳 410，
 * 需清理 ConnectionTable 以避免持續推送至已斷連線。
 */
export function isStalePublishConnection(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  const name = (error as { name?: unknown }).name;
  if (name === 'GoneException') return true;
  const status = (error as { $metadata?: { httpStatusCode?: unknown } }).$metadata?.httpStatusCode;
  return status === 410;
}

// ─── Main emitter ─────────────────────────────────────────────────────────────

/**
 * 廣播 `publish.status_changed` 至所有活躍 WebSocket 連線。
 *
 * 呼叫時機：`publish_fn.ts` 在 `writePublishRecord` 成功後呼叫（TASK-148 接線點）。
 *
 * 設計保證：
 * - **推送失敗不拋出例外**：publish 狀態已持久化；polling 是授權 fallback（§16.4）
 * - **零寫入 DynamoDB**：此函式只發 WebSocket 事件，不碰 PublishRecordTable
 * - **idempotent payload**：`ready_event_id` 讓 Dashboard 對重複投遞安全去重
 *
 * @param publisher - WebSocket 傳輸埠（生產注入 API Gateway Management Client）
 * @param input.record - 已完成狀態轉移的 PublishRecord
 * @param input.traceId - API Gateway request ID（代用 trace ID）
 * @param input.policyVersion - policy version（§30）
 * @returns 推送結果（delivered count、stale connection IDs、failures）
 */
export async function emitPublishStatusChanged(
  publisher: PublishStatusConnectionPublisher,
  input: {
    readonly record: PublishRecord;
    readonly traceId: string;
    readonly policyVersion: string;
  },
): Promise<EmitPublishStatusChangedResult> {
  const payload = buildPublishStatusChangedPayload(input);
  const serialized = JSON.stringify(payload);

  const connectionIds = await publisher.listConnectionIds();

  const results = await Promise.all(
    connectionIds.map(async (connectionId): Promise<PublishStatusDeliveryResult> => {
      try {
        await publisher.postToConnection(connectionId, serialized);
        return { connectionId, delivered: true, stale: false };
      } catch (error: unknown) {
        return {
          connectionId,
          delivered: false,
          stale: isStalePublishConnection(error),
          error: error instanceof Error ? error.message : String(error),
        };
      }
    }),
  );

  const staleConnectionIds = results.filter((r) => r.stale).map((r) => r.connectionId);

  // stale 連線清理：若 publisher 提供 deleteConnection，背景清理 410 的連線
  // 清理失敗靜默忽略（不阻斷廣播結果回傳）
  if (publisher.deleteConnection !== undefined && staleConnectionIds.length > 0) {
    const deleteConnection = publisher.deleteConnection.bind(publisher);
    Promise.all(staleConnectionIds.map((id) => deleteConnection(id).catch(() => undefined))).catch(
      () => undefined,
    );
  }

  return {
    payload,
    delivered: results.filter((r) => r.delivered).length,
    staleConnectionIds,
    failures: results.filter((r) => !r.delivered),
  };
}
