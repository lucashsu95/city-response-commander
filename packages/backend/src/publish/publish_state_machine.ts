/**
 * PublishRecord state machine — conditional DynamoDB write with optimistic lock (TASK-145)
 *
 * 職責（§10.11d, §10.17）：
 * - 在 PublishRecordTable 上執行 conditional Put/Update（樂觀鎖 `version`）
 * - 強制 `draft → approved → published`（或 `publish_failed`）狀態轉移
 * - 每次轉移將 `audit_trail` entry 附加到既有軌跡（append-only）
 * - 寫入失敗時回傳具名錯誤而非拋出例外（呼叫端負責 HTTP 回應）
 * - **零寫入** DecisionCoreTable / DecisionNarrativeTable / IdempotencyTable
 *
 * 狀態機（§10.11d）：
 * ```
 *   null (首次)
 *     ↓ conditional Put（attribute_not_exists(decision_id)）
 *   draft
 *     ↓ conditional Update（version = expectedVersion）
 *   approved
 *     ↓ conditional Update（version = expectedVersion）
 *   published  ──或──  publish_failed
 * ```
 *
 * 樂觀鎖（§10.17）：
 * - 首次 Put：`attribute_not_exists(decision_id)` + `version = 1`
 * - 後續 Update：`version = expectedVersion` condition
 * - ConditionalCheckFailedException → `VERSION_CONFLICT`（呼叫端重讀後重試）
 *
 * 設計限制：
 * - 只有 PublishFnRole 可呼叫本模組（IAM §18）
 * - 此模組不驗證 Cognito 身份，由 publish_fn.ts 負責
 * - 此模組不組裝 PublishRecord 結構，由 publish_fn.ts 組裝後傳入
 *
 * @module backend/publish/publish_state_machine
 */

import type { PublishRecord } from '@city-commander/shared-schemas';
import { PublishStatus } from '@city-commander/shared-schemas';
import type { WritePublishRecordResult } from './publish_fn.js';
import { isLegalPublishTransition } from './publish_transitions.js';

// ─── DynamoDB client abstraction ──────────────────────────────────────────────

/**
 * PublishRecordTable DynamoDB 操作介面。
 *
 * 抽象化實際 DynamoDB SDK 呼叫，讓測試可注入 in-memory stub。
 * 生產實作在 publish_fn_handler.ts（Lambda 進入點）中注入。
 */
export interface PublishRecordStore {
  /**
   * 以 `attribute_not_exists(decision_id)` conditional Put 建立新 record。
   *
   * 若 item 已存在（同 decision_id），回傳 `{ success: false, reason: 'ALREADY_EXISTS' }`。
   * 永遠不 overwrite 既有 item。
   *
   * @param record - 要寫入的完整 PublishRecord（version 必須為 1）
   */
  readonly conditionalPut: (record: PublishRecord) => Promise<
    | { readonly success: true }
    | { readonly success: false; readonly reason: 'ALREADY_EXISTS' | 'INTERNAL_ERROR'; readonly message: string }
  >;

  /**
   * 以 `version = expectedVersion` conditional Update 更新既有 record。
   *
   * 若 version 不符（並發寫入），回傳 `{ success: false, reason: 'VERSION_CONFLICT' }`。
   *
   * @param record - 完整的 updated PublishRecord（含新 version）
   * @param expectedVersion - 預期的當前 version（樂觀鎖條件）
   */
  readonly conditionalUpdate: (record: PublishRecord, expectedVersion: number) => Promise<
    | { readonly success: true }
    | { readonly success: false; readonly reason: 'VERSION_CONFLICT' | 'INTERNAL_ERROR'; readonly message: string }
  >;
}

// ─── Legal transition guard ───────────────────────────────────────────────────
// 轉移規則由 publish_transitions.ts 統一定義（SINGLE SOURCE OF TRUTH）
// 此處僅保留 assertLegalTransition 防禦層，內部委派 isLegalPublishTransition

/**
 * state machine 層二次驗證：確認轉移合法（防禦性第二道）。
 *
 * publish_fn.ts 已做第一道驗證；即使 handler 被 bypass，
 * state machine 仍拒絕非法轉移。
 * 內部委派 isLegalPublishTransition（publish_transitions.ts）。
 *
 * @param from - 原狀態（null 表示首次建立）
 * @param to - 目標狀態
 * @throws IllegalTransitionError 若轉移非法
 */
function assertLegalTransition(from: PublishStatus | null, to: PublishStatus): void {
  if (!isLegalPublishTransition(from, to)) {
    throw new IllegalTransitionError(
      `PublishRecord state machine 拒絕非法轉移：${from ?? 'null'} → ${to}`,
      from,
      to,
    );
  }
}

// ─── Custom error types ───────────────────────────────────────────────────────

/** 非法狀態轉移（state machine 層拒絕） */
export class IllegalTransitionError extends Error {
  readonly from: PublishStatus | null;
  readonly to: PublishStatus;

  constructor(message: string, from: PublishStatus | null, to: PublishStatus) {
    super(message);
    this.name = 'IllegalTransitionError';
    this.from = from;
    this.to = to;
  }
}

// ─── State machine entry point ────────────────────────────────────────────────

/**
 * 執行 PublishRecord 狀態轉移並寫入 DynamoDB。
 *
 * 由 `publish_fn.ts` 呼叫，接收已組裝好的 `newRecord` 和
 * `expectedVersion`（樂觀鎖條件）。
 *
 * 寫入策略：
 * - `expectedVersion === 0`（首次）→ `conditionalPut`
 *   - ALREADY_EXISTS → 表示並發第一筆寫入，回傳 VERSION_CONFLICT
 * - `expectedVersion > 0`（更新）→ `conditionalUpdate`
 *   - VERSION_CONFLICT → 同上
 *
 * 此函式**永遠不**寫入 DecisionCoreTable、DecisionNarrativeTable
 * 或 IdempotencyTable（§18 零寫入保證）。
 *
 * @param store - DynamoDB 操作實作（生產 or 測試 stub）
 * @param newRecord - 已組裝好的 PublishRecord（含 audit_trail、version）
 * @param expectedVersion - 樂觀鎖預期版本（0 = 首次建立）
 * @returns WritePublishRecordResult（success 時攜帶最終 record）
 */
export async function applyPublishTransition(
  store: PublishRecordStore,
  newRecord: PublishRecord,
  expectedVersion: number,
): Promise<WritePublishRecordResult> {
  // ── 1. state machine 層二次驗證（防禦性）──────────────────────────────
  // 從 audit_trail 推算 from_state（最後一筆 entry 的 from_state）
  const lastEntry = newRecord.audit_trail[newRecord.audit_trail.length - 1];
  const fromState = lastEntry?.from_state ?? null;
  const toState = newRecord.publish_state;

  try {
    assertLegalTransition(fromState, toState);
  } catch (err) {
    if (err instanceof IllegalTransitionError) {
      return {
        success: false,
        reason: 'ILLEGAL_TRANSITION',
        message: err.message,
      };
    }
    throw err;
  }

  // ── 2. DynamoDB 寫入（首次 Put vs 後續 Update）────────────────────────
  if (expectedVersion === 0) {
    // 首次建立：conditional Put（attribute_not_exists(decision_id)）
    const putResult = await store.conditionalPut(newRecord);

    if (!putResult.success) {
      if (putResult.reason === 'ALREADY_EXISTS') {
        // 並發寫入——另一個請求已搶先建立 record
        return {
          success: false,
          reason: 'VERSION_CONFLICT',
          message: `decision_id=${newRecord.decision_id} 的 PublishRecord 已存在，請重新讀取後再試。`,
        };
      }
      return {
        success: false,
        reason: 'INTERNAL_ERROR',
        message: putResult.message,
      };
    }
  } else {
    // 後續更新：conditional Update（version = expectedVersion）
    const updateResult = await store.conditionalUpdate(newRecord, expectedVersion);

    if (!updateResult.success) {
      if (updateResult.reason === 'VERSION_CONFLICT') {
        return {
          success: false,
          reason: 'VERSION_CONFLICT',
          message: `PublishRecord 版本衝突（預期 version=${expectedVersion}），請重新讀取後再試。`,
        };
      }
      return {
        success: false,
        reason: 'INTERNAL_ERROR',
        message: updateResult.message,
      };
    }
  }

  // ── 3. 寫入成功，回傳最終 record ──────────────────────────────────────
  return { success: true, record: newRecord };
}

// ─── In-memory store ─────────────────────────────────────────────────────────
// For LOCAL_MOCK / unit tests, import from:
//   packages/backend/test/publish/publish_store_stub.ts
// This production module does NOT export an in-memory implementation.
