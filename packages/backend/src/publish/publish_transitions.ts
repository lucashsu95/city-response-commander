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
 * - published / publish_failed → null（終端狀態，無法推斷）
 *
 * @returns PublishStatus 或 null（需明確指定 target_state）
 */
export function inferNextPublishState(
  currentState: PublishStatus | null,
): PublishStatus | null {
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
