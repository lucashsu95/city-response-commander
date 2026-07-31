/**
 * PublishFn channel-failure 轉移測試 (TASK-144, TASK-145, TASK-146, TASK-147)
 *
 * 回歸保護：channel 派送失敗時，`publish_failed` 必須**真的寫進** PublishRecordTable。
 *
 * 原本的 bug（兩個獨立缺陷疊加）：
 * 1. 以 `newRecord`（published，從未持久化）為 from_state → `published → publish_failed`
 *    在 PUBLISH_TRANSITIONS 中沒有出口 → ILLEGAL_TRANSITION
 * 2. expectedVersion 傳 `newRecord.version`（= currentVersion + 1），
 *    但表中仍是 currentVersion → VERSION_CONFLICT
 * 兩者都會被吞掉（回傳值未檢查），結果：回 500 說「已記錄為 publish_failed」，
 * 但稽核軌跡完全沒有這筆轉移。
 *
 * @module backend/test/publish/publish_channel_failure
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import type { PublishRecord } from '@city-commander/shared-schemas';
import { PublishStatus } from '@city-commander/shared-schemas';

// channels 模組必須在 import publish_fn 之前 mock，才能攔截其具名匯出
vi.mock('../../src/publish/channels.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/publish/channels.js')>();
  return { ...actual, evaluateChannelOutcome: vi.fn(actual.evaluateChannelOutcome) };
});

import { createPublishHandler } from '../../src/publish/publish_fn.js';
import { applyPublishTransition } from '../../src/publish/publish_state_machine.js';
import { appendAuditEntry, validateAuditTrailIntegrity } from '../../src/publish/audit_trail.js';
import { evaluateChannelOutcome } from '../../src/publish/channels.js';
import { createPublishRecordStoreStub } from './publish_store_stub.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const DECISION_ID = 'DEC_TEST_001';
const ACTOR = 'cognito-sub-commander-1';

/** 帶 commanders group 的 API Gateway event */
function makeEvent(body: unknown = {}): APIGatewayProxyEventV2 {
  return {
    body: JSON.stringify(body),
    pathParameters: { id: DECISION_ID },
    requestContext: {
      requestId: 'req-test-1',
      authorizer: { jwt: { claims: { sub: ACTOR, 'cognito:groups': ['commanders'] } } },
    },
  } as unknown as APIGatewayProxyEventV2;
}

/** 已經走到 approved 的既有 record（version=2） */
function approvedRecord(): PublishRecord {
  const draft = appendAuditEntry({
    decisionId: DECISION_ID,
    actor: ACTOR,
    existing: null,
    targetState: PublishStatus.draft,
    failureReason: null,
    now: '2026-05-20 22:00',
  });
  return appendAuditEntry({
    decisionId: DECISION_ID,
    actor: ACTOR,
    existing: draft,
    targetState: PublishStatus.approved,
    failureReason: null,
    now: '2026-05-20 22:05',
  });
}

/**
 * 以 in-memory store 建立 handler，writePublishRecord 走真正的 state machine
 * （轉移合法性 + 樂觀鎖語意都會被實際檢查）。
 */
function makeHandler(seed: PublishRecord | null) {
  const store = createPublishRecordStoreStub();
  if (seed !== null) {
    // 直接以首次 Put 塞入種子 record（version 依 seed 為準）
    void store.conditionalPut(seed);
  }

  const handler = createPublishHandler({
    readDecisionCoreStatus: async () => ({ exists: true, core_committed: true }),
    readPublishRecord: async (id) => store.getRecord(id) ?? null,
    readCmsCoreText: async () => '忠孝東路封閉，請改道 光復南路，預計延誤 78.6 分鐘',
    writePublishRecord: (record, expectedVersion) =>
      applyPublishTransition(store, record, expectedVersion),
  });

  return { handler, store };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('PublishFn — channel 失敗時的 publish_failed 轉移', () => {
  beforeEach(() => {
    vi.mocked(evaluateChannelOutcome).mockReset();
  });

  it('channel 失敗 → publish_failed 實際寫入，且稽核軌跡完整', async () => {
    vi.mocked(evaluateChannelOutcome).mockReturnValue({
      failed: true,
      reason: '所有發布通道均失敗：CMS_MOCK: gateway down',
    });

    const seed = approvedRecord();
    const { handler, store } = makeHandler(seed);

    const result = await handler(makeEvent({ target_state: 'published' }));

    expect(evaluateChannelOutcome).toHaveBeenCalledWith(expect.anything(), false);

    // HTTP 層如實回報失敗
    expect(typeof result === 'object' && result !== null && 'statusCode' in result).toBe(true);
    const response = result as { statusCode: number; body: string };
    expect(response.statusCode).toBe(500);
    expect(JSON.parse(response.body).error_code).toBe('CHANNEL_DISPATCH_FAILED');

    // 關鍵斷言：狀態真的被持久化（原 bug 下這裡仍是 approved）
    const stored = store.getRecord(DECISION_ID);
    expect(stored?.publish_state).toBe(PublishStatus.publish_failed);
    expect(stored?.failure_reason).toContain('CMS_MOCK');
    expect(stored?.version).toBe(seed.version + 1);

    // 稽核軌跡：approved → publish_failed，且鏈條連續
    const lastEntry = stored!.audit_trail[stored!.audit_trail.length - 1];
    expect(lastEntry.from_state).toBe(PublishStatus.approved);
    expect(lastEntry.to_state).toBe(PublishStatus.publish_failed);
    expect(lastEntry.actor).toBe(ACTOR);
    expect(validateAuditTrailIntegrity(stored!)).toEqual({ valid: true });
  });

  it('channel 成功 → published 寫入，channels 記錄於 record', async () => {
    vi.mocked(evaluateChannelOutcome).mockReturnValue({ failed: false });

    const seed = approvedRecord();
    const { handler, store } = makeHandler(seed);

    const result = await handler(makeEvent({ target_state: 'published' }));
    const response = result as { statusCode: number; body: string };
    expect(response.statusCode).toBe(200);

    const stored = store.getRecord(DECISION_ID);
    expect(stored?.publish_state).toBe(PublishStatus.published);
    expect(stored?.published_by).toBe(ACTOR);
    expect(stored?.channels).toContain('CMS_MOCK');
    expect(stored?.channels).toContain('SMS_MOCK');
    expect(stored?.version).toBe(seed.version + 1);
    expect(validateAuditTrailIntegrity(stored!)).toEqual({ valid: true });
  });

  it('publish_failed 寫入失敗（版本衝突）→ 據實回報，不謊稱已記錄', async () => {
    vi.mocked(evaluateChannelOutcome).mockReturnValue({
      failed: true,
      reason: 'CMS_MOCK: gateway down',
    });

    const seed = approvedRecord();
    const store = createPublishRecordStoreStub();
    void store.conditionalPut(seed);

    const handler = createPublishHandler({
      readDecisionCoreStatus: async () => ({ exists: true, core_committed: true }),
      readPublishRecord: async (id) => store.getRecord(id) ?? null,
      readCmsCoreText: async () => 'cms',
      // 模擬並發：寫入時版本已被別人推進
      writePublishRecord: async () => ({
        success: false,
        reason: 'VERSION_CONFLICT',
        message: '版本衝突（stub）',
      }),
    });

    const result = await handler(makeEvent({ target_state: 'published' }));
    const response = result as { statusCode: number; body: string };
    expect(response.statusCode).toBe(409);
    expect(JSON.parse(response.body).error_code).toBe('PUBLISH_FAILED_NOT_RECORDED');
  });
});
