/**
 * PublishRecord 狀態轉移表（單一定義，供 publish_fn 與 publish_state_machine 共用）
 *
 * 此檔案是 SINGLE SOURCE OF TRUTH — 任何修改轉移規則都必須只改這裡。
 * publish_fn.ts 和 publish_state_machine.ts 均 import 此定義。
 *
 * 狀態機（§10.11d）：
 * - null（首次建立）→ draft
 * - draft → approved
 * - approved → published
 * - approved → publish_failed
 * - publish_failed → approved（失敗復原；需指揮官重新核准後才能再次發布）
 *
 * 終端狀態只有 `published`。`publish_failed` **不是**終端：
 * 發布通道失敗後若無復原路徑，該 decision 將永遠無法發布
 * （Demo 當天第一次失敗就沒有救回的機會）。
 * 復原刻意繞回 `approved` 而非直接跳 `published`，理由：
 * - 失敗後重發需要指揮官重新核准，該動作會留下 audit_trail entry（§19）
 * - `approved → published` 維持為進入 published 的唯一路徑，
 *   channel 派送與 channels 欄位寫入的邏輯只有一個入口
 *
 * @module backend/publish/publish_transitions
 */

import { PublishStatus } from '@city-commander/shared-schemas';

/**
 * 合法的 publish 狀態轉移表。
 *
 * Key: 原狀態（null 表示 record 尚未存在）
 * Value: 該狀態下合法的目標狀態集合
 */
export const PUBLISH_TRANSITIONS: ReadonlyMap<
  PublishStatus | null,
  ReadonlySet<PublishStatus>
> = new Map<PublishStatus | null, ReadonlySet<PublishStatus>>([
  [null, new Set([PublishStatus.draft])],
  [PublishStatus.draft, new Set([PublishStatus.approved])],
  [PublishStatus.approved, new Set([PublishStatus.published, PublishStatus.publish_failed])],
  // 失敗復原：回到 approved 重新核准後才能再次嘗試發布。
  // 需由呼叫端明確指定 target_state（見 inferNextPublishState）。
  [PublishStatus.publish_failed, new Set([PublishStatus.approved])],
]);

/**
 * 驗證 publish 狀態轉移是否合法。
 *
 * @param from - 原狀態（null 表示首次建立）
 * @param to - 目標狀態
 * @returns true 表示合法轉移
 */
export function isLegalPublishTransition(
  from: PublishStatus | null,
  to: PublishStatus,
): boolean {
  return PUBLISH_TRANSITIONS.get(from)?.has(to) ?? false;
}

/**
 * 從當前狀態推斷下一個合法目標狀態。
 *
 * - null → draft（首次建立）
 * - draft → approved
 * - approved → published（approved 有兩個出口，無 target 時預設 published）
 * - publish_failed → null（**復原不自動發生**，見下）
 * - published → null（終端狀態，無法推斷）
 *
 * `publish_failed` 雖然有合法後繼（approved），但刻意**不**自動推斷：
 * 發布失敗後的重試必須是指揮官的明確決定，
 * 呼叫端必須在 body 指定 `"target_state": "approved"`。
 * 否則一次誤觸的重送就會把失敗的發布悄悄推回核准狀態。
 *
 * @returns PublishStatus 或 null（需明確指定 target_state）
 */
export function inferNextPublishState(
  currentState: PublishStatus | null,
): PublishStatus | null {
  // 失敗復原必須明確指定，不自動推斷
  if (currentState === PublishStatus.publish_failed) return null;

  const allowed = PUBLISH_TRANSITIONS.get(currentState);
  if (!allowed || allowed.size === 0) return null;
  if (allowed.size === 1) return [...allowed][0];
  // approved 有兩個出口（published / publish_failed），
  // 無 target_state 時預設推進到 published
  if (currentState === PublishStatus.approved) return PublishStatus.published;
  return null;
}

/**
 * 取得某狀態的所有合法後繼狀態（用於錯誤訊息）。
 *
 * @returns 合法後繼狀態陣列（空陣列表示終端狀態）
 */
export function allowedNextStates(
  currentState: PublishStatus | null,
): readonly PublishStatus[] {
  return [...(PUBLISH_TRANSITIONS.get(currentState) ?? [])];
}
