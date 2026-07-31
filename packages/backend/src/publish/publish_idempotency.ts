/**
 * publish_idempotency — publish 冪等防護模組 (TASK-151)
 *
 * 職責（§15.2, §10.11d）：
 * - 以 `decision_id` + `publish_state` + 樂觀鎖 `version` 三元組去重
 * - retry 回傳當前 PublishRecord，**不**重複執行狀態轉移
 * - retry **不得**重新推送 `public_alert.ready` 或重新觸發一鍵發布
 * - 偵測「同一狀態已到達」vs「版本衝突需重讀」vs「可繼續轉移」
 *
 * 設計定位：
 * - 此模組在 publish_fn.ts 讀取 PublishRecord 之後、寫入之前呼叫
 * - 純判斷邏輯，無 AWS 依賴，可單元測試
 *
 * 冪等語意定義（§15.2）：
 * ```
 *   (decision_id, target_state, expectedVersion) 三元組相同的重試
 *     → 視為同一次操作
 *     → 若目標狀態已達成且 version 相符 → ALREADY_PUBLISHED（回現有 record）
 *     → 若 version 不符 → VERSION_DRIFT（需重讀）
 *     → 若目標狀態尚未達成 → PROCEED（允許繼續）
 * ```
 *
 * @module backend/publish/publish_idempotency
 */

import type { PublishRecord } from '@city-commander/shared-schemas';
import { PublishStatus } from '@city-commander/shared-schemas';

// ─── Result types ─────────────────────────────────────────────────────────────

/**
 * checkPublishIdempotency 的回傳結果。
 */
export type PublishIdempotencyResult =
  /**
   * 目標狀態已達成（且 version 一致）。
   * 呼叫端應直接回傳 existing record，**不**再執行狀態轉移或觸發任何副作用。
   */
  | {
      readonly kind: 'ALREADY_PUBLISHED';
      readonly record: PublishRecord;
    }
  /**
   * 目標狀態已達成，但 version 不一致（並發修改達成同一目標）。
   * 目標已達成，不視為錯誤 → 回 200，建議呼叫端重讀最新 record。
   */
  | {
      readonly kind: 'VERSION_DRIFT';
      readonly currentState: PublishStatus;
      readonly currentVersion: number;
    }
  /**
   * 目標狀態尚未達成，可繼續執行狀態轉移。
   */
  | {
      readonly kind: 'PROCEED';
    };

// ─── Core logic ───────────────────────────────────────────────────────────────

/**
 * 檢查此次 publish 操作是否為重複請求。
 *
 * 呼叫時機：publish_fn.ts 讀取 PublishRecord 之後、執行寫入之前。
 *
 * 三元組去重（§15.2）：
 * - `decision_id` 已隱含在 `existing`（呼叫端以 decision_id 讀取的 record）
 * - `publish_state` 對應 `targetState`
 * - `version` 對應 `expectedVersion`
 *
 * 判斷規則：
 * 1. 若 `existing` 為 null（record 尚未建立）→ PROCEED（首次建立）
 * 2. 若 `existing.publish_state === targetState`（目標已達成）：
 *    - `existing.version === expectedVersion` → ALREADY_PUBLISHED（相同 retry）
 *    - `existing.version !== expectedVersion` → VERSION_DRIFT（並發達成，回 200 告知重讀）
 * 3. 其他情況 → PROCEED（繼續執行轉移）
 *
 * @param existing - 現有 PublishRecord（null 表示尚未建立；decision_id 隱含於此）
 * @param targetState - 本次操作的目標狀態（三元組的 publish_state 部分）
 * @param expectedVersion - 呼叫端讀到的 version（三元組的 version 部分）
 */
export function checkPublishIdempotency(
  existing: PublishRecord | null,
  targetState: PublishStatus,
  expectedVersion: number,
): PublishIdempotencyResult {
  // 首次建立：record 不存在，直接繼續
  if (existing === null) {
    return { kind: 'PROCEED' };
  }

  // 目標狀態已達成
  if (existing.publish_state === targetState) {
    if (existing.version === expectedVersion) {
      // 完全相同的 retry（same state + same version）
      // 回傳現有 record，不觸發任何副作用
      return { kind: 'ALREADY_PUBLISHED', record: existing };
    }
    // 目標達成但 version 偏移（另一個並發請求已寫入相同目標狀態）
    // 通知呼叫端重讀，不視為錯誤
    return {
      kind: 'VERSION_DRIFT',
      currentState: existing.publish_state,
      currentVersion: existing.version,
    };
  }

  // 目標狀態尚未達成，繼續執行轉移
  return { kind: 'PROCEED' };
}

// ─── Published state check ────────────────────────────────────────────────────

/**
 * 判斷 PublishRecord 是否已到達終端發布狀態（`published`）。
 *
 * 用於防止在 `published` 之後重新觸發發布或重推 `public_alert.ready`。
 *
 * 終端狀態：
 * - `published`：成功發布（不可再轉移）
 * - `publish_failed`：發布失敗（可重試，但需明確指定 `target_state`）
 *
 * 注意：`publish_failed` 不視為終端，允許從 `approved` 重試至 `published`。
 *
 * @returns true 表示已成功發布，不應觸發任何重複副作用
 */
export function isAlreadyPublished(record: PublishRecord | null): boolean {
  return record?.publish_state === PublishStatus.published;
}

/**
 * 判斷此次請求是否會觸發 `public_alert.ready` 事件。
 *
 * 規則（§15.2）：
 * - 只有 `null → draft → approved → published` 的**首次** `published` 轉移才觸發
 * - retry（idempotency check 回 ALREADY_PUBLISHED）**不**觸發
 * - `VERSION_DRIFT` 重讀後達成 `published` 亦視為已發布，**不**重觸發
 *
 * 呼叫時機：publish_fn.ts 在 writePublishRecord 成功後判斷是否推送事件。
 *
 * @param idempotencyResult - checkPublishIdempotency 的回傳結果
 * @param targetState - 本次操作的目標狀態
 * @returns true 表示應推送 `public_alert.ready`
 */
export function shouldEmitPublicAlertReady(
  idempotencyResult: PublishIdempotencyResult,
  targetState: PublishStatus,
): boolean {
  // 只有 PROCEED（非 retry）且目標為 published 時才觸發
  return idempotencyResult.kind === 'PROCEED' && targetState === PublishStatus.published;
}
