/**
 * audit_trail — PublishRecord 稽核軌跡組裝模組 (TASK-147)
 *
 * 職責（§10.11d, §19）：
 * - 為每次 publish 狀態轉移建立 AuditTrailEntry（actor、action、from/to、at）
 * - 將新 entry append 到既有軌跡（append-only，永不刪除或修改舊 entry）
 * - 填寫 `approved_by` / `published_by`（Cognito actor identity）
 * - 填寫 `failure_reason`（publish_failed 時）
 * - 格式化 `YYYY-MM-DD HH:MM` 時間戳
 *
 * 設計限制：
 * - 純 domain 邏輯，無 AWS 依賴，無 DynamoDB 呼叫
 * - 稽核軌跡是 tamper-evident：只能 append，不能 patch
 * - 此模組不驗證 Cognito 身份，由 publish_fn.ts 負責
 *
 * Optimistic lock 與此模組的關係（§10.17, §19）：
 * - `version` 由 publish_fn.ts 計算（currentVersion + 1），不在此模組
 * - 此模組保證：凡 appendAuditEntry 回傳的 record，audit_trail 必含本次轉移 entry
 * - 若 DynamoDB 條件寫入因 version 衝突失敗（state machine 層），
 *   此模組的 in-memory record 會被丟棄，不會 persist 不完整的 audit_trail
 *
 * @module backend/publish/audit_trail
 */

import type { AuditTrailEntry, PublishRecord } from '@city-commander/shared-schemas';
import { PublishStatus } from '@city-commander/shared-schemas';

// ─── Timestamp helper ─────────────────────────────────────────────────────────

/**
 * 產生 `YYYY-MM-DD HH:MM` UTC 時間戳（§10.17 格式）。
 *
 * 所有 audit trail 時間戳均使用此格式，與 design 文件一致。
 */
export function formatAuditTimestamp(date: Date = new Date()): string {
  const pad = (n: number): string => String(n).padStart(2, '0');
  return (
    `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())} ` +
    `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`
  );
}

// ─── Audit entry builder ──────────────────────────────────────────────────────

/**
 * 建立單一 AuditTrailEntry。
 *
 * @param actor - Cognito sub（指揮官身份）
 * @param from - 原狀態（null 表示首次建立）
 * @param to - 目標狀態
 * @param at - 時間戳（預設為當下 UTC，可注入用於測試）
 */
export function buildAuditEntry(
  actor: string,
  from: PublishStatus | null,
  to: PublishStatus,
  at: string = formatAuditTimestamp(),
): AuditTrailEntry {
  return {
    actor,
    action: to, // 動詞語意：'draft' | 'approved' | 'published' | 'publish_failed'
    from_state: from,
    to_state: to,
    at,
  };
}

// ─── PublishRecord assembler ──────────────────────────────────────────────────

/**
 * appendAuditEntry 的輸入參數。
 */
export interface AppendAuditEntryInput {
  /** 已驗證的 decision_id */
  readonly decisionId: string;
  /** Cognito actor（指揮官 sub） */
  readonly actor: string;
  /** 現有 PublishRecord（null 表示首次建立） */
  readonly existing: PublishRecord | null;
  /** 目標狀態 */
  readonly targetState: PublishStatus;
  /** publish_failed 時的失敗原因（必須在 publish_fn.ts 已驗證非 null） */
  readonly failureReason: string | null;
  /** 時間戳（可注入用於測試，預設為當下 UTC） */
  readonly now?: string;
}

/**
 * 將新的 AuditTrailEntry append 至 PublishRecord，回傳完整的新 record。
 *
 * 組裝規則（§10.11d）：
 * - `audit_trail`：append 新 entry（append-only）
 * - `approved_by`：approved 轉移時記錄 actor
 * - `published_by`：published 轉移時記錄 actor（同時保留前一步的 approved_by）
 * - `failure_reason`：publish_failed 轉移時記錄原因
 * - `version`：currentVersion + 1（樂觀鎖遞增）
 * - `updated_at`：同 audit entry 的 at
 * - `channels`：沿用既有值（由 TASK-146 填充）
 *
 * 注意：此函式不驗證轉移合法性（由 publish_fn.ts 步驟 6 已確認）。
 *
 * @returns 新的 PublishRecord（尚未寫入 DynamoDB）
 */
export function appendAuditEntry(input: AppendAuditEntryInput): PublishRecord {
  const { decisionId, actor, existing, targetState, failureReason } = input;
  const now = input.now ?? formatAuditTimestamp();
  const currentVersion = existing?.version ?? 0;
  const fromState = existing?.publish_state ?? null;

  const entry = buildAuditEntry(actor, fromState, targetState, now);

  return {
    decision_id: decisionId,
    publish_state: targetState,
    channels: existing?.channels ?? [],
    // approved_by：approved 轉移時記錄核准者
    ...(targetState === PublishStatus.approved && { approved_by: actor }),
    // published_by：published 轉移時記錄發布者，並保留前一步的 approved_by
    ...(targetState === PublishStatus.published && {
      approved_by: existing?.approved_by ?? actor,
      published_by: actor,
    }),
    // failure_reason：publish_failed 時記錄失敗原因
    ...(targetState === PublishStatus.publish_failed &&
      failureReason !== null && { failure_reason: failureReason }),
    // append-only audit trail（既有 + 新 entry）
    audit_trail: [...(existing?.audit_trail ?? []), entry],
    // optimistic lock：version 遞增
    version: currentVersion + 1,
    updated_at: now,
  };
}

// ─── Validation helpers ───────────────────────────────────────────────────────

/**
 * 驗證 audit_trail 是否完整（tamper-evident check）。
 *
 * 規則：
 * 1. audit_trail 不能為空（至少有一筆 entry）
 * 2. 最後一筆 entry 的 `to_state` 必須等於 `publish_state`
 * 3. 每筆 entry 的 `from_state → to_state` 構成連續鏈（前一筆 to = 後一筆 from）
 *
 * 用於 read model 驗證（TASK-149）和整合測試（TASK-152）。
 *
 * @returns `{ valid: true }` 或 `{ valid: false; reason: string }`
 */
export function validateAuditTrailIntegrity(
  record: PublishRecord,
): { readonly valid: true } | { readonly valid: false; readonly reason: string } {
  const trail = record.audit_trail;

  if (trail.length === 0) {
    return { valid: false, reason: 'audit_trail 不能為空。' };
  }

  const last = trail[trail.length - 1];
  if (last.to_state !== record.publish_state) {
    return {
      valid: false,
      reason: `audit_trail 最後一筆 to_state=${last.to_state} 與 publish_state=${record.publish_state} 不一致。`,
    };
  }

  // 連續鏈檢查（i+1 的 from_state 必須等於 i 的 to_state）
  for (let i = 0; i < trail.length - 1; i++) {
    const curr = trail[i];
    const next = trail[i + 1];
    if (next.from_state !== curr.to_state) {
      return {
        valid: false,
        reason: `audit_trail 鏈斷裂：entry[${i}].to_state=${curr.to_state} ≠ entry[${i + 1}].from_state=${next.from_state}。`,
      };
    }
  }

  return { valid: true };
}
