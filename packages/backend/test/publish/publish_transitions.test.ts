/**
 * PublishRecord 狀態轉移表測試 (TASK-145)
 *
 * 重點覆蓋 `publish_failed` 的復原路徑：
 * 原本 `publish_failed` 在轉移表中沒有任何出口，等於死路——
 * 發布通道失敗一次，該 decision 就永遠無法發布。
 *
 * @module backend/test/publish/publish_transitions
 */

import { describe, it, expect } from 'vitest';
import { PublishStatus } from '@city-commander/shared-schemas';
import {
  isLegalPublishTransition,
  inferNextPublishState,
  allowedNextStates,
} from '../../src/publish/publish_transitions.js';
import { applyPublishTransition } from '../../src/publish/publish_state_machine.js';
import { appendAuditEntry, validateAuditTrailIntegrity } from '../../src/publish/audit_trail.js';
import { createPublishRecordStoreStub } from './publish_store_stub.js';

const DECISION_ID = 'DEC_TEST_TRANSITION';
const ACTOR = 'cognito-sub-commander-1';

describe('PUBLISH_TRANSITIONS — 正常前進路徑', () => {
  it('null → draft → approved → published 全部合法', () => {
    expect(isLegalPublishTransition(null, PublishStatus.draft)).toBe(true);
    expect(isLegalPublishTransition(PublishStatus.draft, PublishStatus.approved)).toBe(true);
    expect(isLegalPublishTransition(PublishStatus.approved, PublishStatus.published)).toBe(true);
  });

  it('approved → publish_failed 合法（通道失敗）', () => {
    expect(isLegalPublishTransition(PublishStatus.approved, PublishStatus.publish_failed)).toBe(
      true,
    );
  });

  it('跳關轉移不合法', () => {
    expect(isLegalPublishTransition(null, PublishStatus.published)).toBe(false);
    expect(isLegalPublishTransition(PublishStatus.draft, PublishStatus.published)).toBe(false);
  });

  it('published 是唯一終端狀態，沒有任何出口', () => {
    expect(allowedNextStates(PublishStatus.published)).toEqual([]);
    expect(inferNextPublishState(PublishStatus.published)).toBeNull();
  });
});

describe('PUBLISH_TRANSITIONS — publish_failed 復原路徑', () => {
  it('publish_failed → approved 合法（不是死路）', () => {
    expect(isLegalPublishTransition(PublishStatus.publish_failed, PublishStatus.approved)).toBe(
      true,
    );
    expect(allowedNextStates(PublishStatus.publish_failed)).toEqual([PublishStatus.approved]);
  });

  it('publish_failed → published 不可直接跳過重新核准', () => {
    expect(isLegalPublishTransition(PublishStatus.publish_failed, PublishStatus.published)).toBe(
      false,
    );
  });

  it('publish_failed 的復原不自動推斷，必須明確指定 target_state', () => {
    expect(inferNextPublishState(PublishStatus.publish_failed)).toBeNull();
  });

  it('完整復原鏈：approved → publish_failed → approved → published 可持久化且稽核連續', async () => {
    const store = createPublishRecordStoreStub();

    // draft
    let record = appendAuditEntry({
      decisionId: DECISION_ID,
      actor: ACTOR,
      existing: null,
      targetState: PublishStatus.draft,
      failureReason: null,
      now: '2026-05-20 22:00',
    });
    expect((await applyPublishTransition(store, record, 0)).success).toBe(true);

    // approved
    record = appendAuditEntry({
      decisionId: DECISION_ID,
      actor: ACTOR,
      existing: record,
      targetState: PublishStatus.approved,
      failureReason: null,
      now: '2026-05-20 22:05',
    });
    expect((await applyPublishTransition(store, record, 1)).success).toBe(true);

    // publish_failed（通道失敗）
    record = appendAuditEntry({
      decisionId: DECISION_ID,
      actor: ACTOR,
      existing: record,
      targetState: PublishStatus.publish_failed,
      failureReason: 'CMS_MOCK: gateway down',
      now: '2026-05-20 22:10',
    });
    expect((await applyPublishTransition(store, record, 2)).success).toBe(true);
    expect(store.getRecord(DECISION_ID)?.failure_reason).toBe('CMS_MOCK: gateway down');

    // 復原：重新核准
    record = appendAuditEntry({
      decisionId: DECISION_ID,
      actor: ACTOR,
      existing: record,
      targetState: PublishStatus.approved,
      failureReason: null,
      now: '2026-05-20 22:12',
    });
    const recovery = await applyPublishTransition(store, record, 3);
    expect(recovery.success).toBe(true);

    // 再次發布成功
    record = appendAuditEntry({
      decisionId: DECISION_ID,
      actor: ACTOR,
      existing: record,
      targetState: PublishStatus.published,
      failureReason: null,
      now: '2026-05-20 22:15',
    });
    expect((await applyPublishTransition(store, record, 4)).success).toBe(true);

    const final = store.getRecord(DECISION_ID);
    expect(final?.publish_state).toBe(PublishStatus.published);
    expect(final?.version).toBe(5);
    // 稽核軌跡完整保留失敗與復原的每一步（append-only）
    expect(final?.audit_trail.map((e) => e.to_state)).toEqual([
      PublishStatus.draft,
      PublishStatus.approved,
      PublishStatus.publish_failed,
      PublishStatus.approved,
      PublishStatus.published,
    ]);
    expect(validateAuditTrailIntegrity(final!)).toEqual({ valid: true });
  });

  it('state machine 拒絕 publish_failed → published 的非法直跳', async () => {
    const store = createPublishRecordStoreStub();

    const failed = appendAuditEntry({
      decisionId: DECISION_ID,
      actor: ACTOR,
      existing: null,
      targetState: PublishStatus.draft,
      failureReason: null,
    });
    await applyPublishTransition(store, failed, 0);

    const illegal = {
      ...failed,
      publish_state: PublishStatus.published,
      audit_trail: [
        {
          actor: ACTOR,
          action: PublishStatus.published,
          from_state: PublishStatus.publish_failed,
          to_state: PublishStatus.published,
          at: '2026-05-20 22:20',
        },
      ],
      version: 2,
    };

    const result = await applyPublishTransition(store, illegal, 1);
    expect(result.success).toBe(false);
    if (!result.success) expect(result.reason).toBe('ILLEGAL_TRANSITION');
  });
});
