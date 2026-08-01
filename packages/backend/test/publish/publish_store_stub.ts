/**
 * In-memory PublishRecordStore stub — 測試與 LOCAL_MOCK 專用 (TASK-145, TASK-152)
 *
 * 模擬 DynamoDB conditional Put/Update 語意，**不**放入 production module。
 *
 * @module backend/test/publish/publish_store_stub
 */

import type { PublishRecord } from '@city-commander/shared-schemas';
import type { PublishRecordStore } from '../../src/publish/publish_state_machine.js';

/**
 * 建立 in-memory PublishRecordStore stub。
 *
 * - `conditionalPut`：若 decision_id 已存在 → `ALREADY_EXISTS`
 * - `conditionalUpdate`：若 version 不符 → `VERSION_CONFLICT`
 *
 * **不**保證執行緒安全，僅供測試環境使用。
 *
 * @example
 * const store = createPublishRecordStoreStub();
 * const result = await applyPublishTransition(store, record, 0);
 */
export function createPublishRecordStoreStub(): PublishRecordStore & {
  /** 直接讀取 table 內容（測試 assertion 用） */
  readonly getRecord: (decisionId: string) => PublishRecord | undefined;
  /** 清空所有 records（每個 test case 前 reset 用） */
  readonly reset: () => void;
} {
  const table = new Map<string, PublishRecord>();

  return {
    async conditionalPut(record) {
      if (table.has(record.decision_id)) {
        return {
          success: false,
          reason: 'ALREADY_EXISTS',
          message: `decision_id=${record.decision_id} 已存在（stub）。`,
        };
      }
      table.set(record.decision_id, record);
      return { success: true };
    },

    async conditionalUpdate(record, expectedVersion) {
      const existing = table.get(record.decision_id);
      if (!existing) {
        return {
          success: false,
          reason: 'VERSION_CONFLICT',
          message: `decision_id=${record.decision_id} 不存在，無法更新（stub）。`,
        };
      }
      if (existing.version !== expectedVersion) {
        return {
          success: false,
          reason: 'VERSION_CONFLICT',
          message: `版本衝突：當前 version=${existing.version}，預期 version=${expectedVersion}（stub）。`,
        };
      }
      table.set(record.decision_id, record);
      return { success: true };
    },

    getRecord(decisionId) {
      return table.get(decisionId);
    },

    reset() {
      table.clear();
    },
  };
}
