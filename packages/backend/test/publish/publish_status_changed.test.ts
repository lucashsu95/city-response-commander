/**
 * publish.status_changed WebSocket 事件測試 (TASK-148, TASK-152)
 *
 * - ready_event_id 去重 key 格式（§13）
 * - payload 欄位與 polling fallback 提示（§16.4）
 * - 廣播：部分失敗不阻斷、410 Gone 標為 stale 並清理
 *
 * @module backend/test/publish/publish_status_changed
 */

import { describe, it, expect, vi } from 'vitest';
import type { PublishRecord } from '@city-commander/shared-schemas';
import { PublishStatus, SCHEMA_VERSION } from '@city-commander/shared-schemas';
import {
  PUBLISH_STATUS_CHANGED_EVENT,
  buildPublishStatusChangedReadyEventId,
  buildPublishStatusChangedPayload,
  isStalePublishConnection,
  emitPublishStatusChanged,
  type PublishStatusConnectionPublisher,
} from '../../src/realtime/publish_status_changed.js';

const DECISION_ID = 'DEC_WS_001';

function record(overrides: Partial<PublishRecord> = {}): PublishRecord {
  return {
    decision_id: DECISION_ID,
    publish_state: PublishStatus.published,
    channels: ['CMS_MOCK'],
    audit_trail: [
      {
        actor: 'commander-1',
        action: PublishStatus.published,
        from_state: PublishStatus.approved,
        to_state: PublishStatus.published,
        at: '2026-05-20 22:15',
      },
    ],
    version: 3,
    updated_at: '2026-05-20 22:15',
    ...overrides,
  };
}

// ─── ready_event_id ───────────────────────────────────────────────────────────

describe('buildPublishStatusChangedReadyEventId', () => {
  it('格式為 decision_id|publish.status_changed|state|version', () => {
    expect(
      buildPublishStatusChangedReadyEventId({
        decisionId: DECISION_ID,
        publishState: PublishStatus.published,
        version: 3,
      }),
    ).toBe(`${DECISION_ID}|publish.status_changed|published|3`);
  });

  it('不同狀態產生不同 key（同一 decision 的各次轉移不互相去重）', () => {
    const approved = buildPublishStatusChangedReadyEventId({
      decisionId: DECISION_ID,
      publishState: PublishStatus.approved,
      version: 2,
    });
    const published = buildPublishStatusChangedReadyEventId({
      decisionId: DECISION_ID,
      publishState: PublishStatus.published,
      version: 3,
    });
    expect(approved).not.toBe(published);
  });

  it('同狀態不同 version 產生不同 key（重試後的事件不被去重掉）', () => {
    const v3 = buildPublishStatusChangedReadyEventId({
      decisionId: DECISION_ID,
      publishState: PublishStatus.published,
      version: 3,
    });
    const v4 = buildPublishStatusChangedReadyEventId({
      decisionId: DECISION_ID,
      publishState: PublishStatus.published,
      version: 4,
    });
    expect(v3).not.toBe(v4);
  });
});

// ─── payload ──────────────────────────────────────────────────────────────────

describe('buildPublishStatusChangedPayload', () => {
  it('攜帶 publish_state、audit_trail 與 polling fallback 路徑', () => {
    const payload = buildPublishStatusChangedPayload({
      record: record(),
      traceId: 'trace-1',
      policyVersion: 'v1',
    });

    expect(payload.event_type).toBe(PUBLISH_STATUS_CHANGED_EVENT);
    expect(payload.schema_version).toBe(SCHEMA_VERSION);
    expect(payload.decision_id).toBe(DECISION_ID);
    expect(payload.publish_state).toBe(PublishStatus.published);
    expect(payload.audit_trail).toHaveLength(1);
    // §16.4：斷線時 Dashboard 改用 polling
    expect(payload.polling_fallback_path).toBe(`/decisions/${DECISION_ID}`);
    expect(payload.trace_id).toBe('trace-1');
    expect(payload.occurred_at).toBe('2026-05-20 22:15');
  });

  it('publish_failed 同樣可組裝（失敗也是一次狀態轉移）', () => {
    const payload = buildPublishStatusChangedPayload({
      record: record({ publish_state: PublishStatus.publish_failed, version: 4 }),
      traceId: 'trace-2',
      policyVersion: 'v1',
    });
    expect(payload.publish_state).toBe(PublishStatus.publish_failed);
    expect(payload.ready_event_id).toContain('publish_failed');
  });
});

// ─── stale 判定 ───────────────────────────────────────────────────────────────

describe('isStalePublishConnection', () => {
  it('GoneException → stale', () => {
    expect(isStalePublishConnection({ name: 'GoneException' })).toBe(true);
  });

  it('$metadata.httpStatusCode = 410 → stale', () => {
    expect(isStalePublishConnection({ $metadata: { httpStatusCode: 410 } })).toBe(true);
  });

  it('其他錯誤 / 非物件 → 非 stale', () => {
    expect(isStalePublishConnection({ $metadata: { httpStatusCode: 500 } })).toBe(false);
    expect(isStalePublishConnection(new Error('boom'))).toBe(false);
    expect(isStalePublishConnection(null)).toBe(false);
    expect(isStalePublishConnection('410')).toBe(false);
  });
});

// ─── 廣播 ─────────────────────────────────────────────────────────────────────

describe('emitPublishStatusChanged', () => {
  function publisher(
    connectionIds: string[],
    post: (id: string) => Promise<void>,
    deleteConnection?: (id: string) => Promise<void>,
  ): PublishStatusConnectionPublisher {
    return {
      listConnectionIds: async () => connectionIds,
      postToConnection: async (id) => post(id),
      ...(deleteConnection ? { deleteConnection } : {}),
    };
  }

  it('推送至所有連線', async () => {
    const reached: string[] = [];
    const result = await emitPublishStatusChanged(
      publisher(['c1', 'c2'], async (id) => {
        reached.push(id);
      }),
      { record: record(), traceId: 't', policyVersion: 'v1' },
    );
    expect(result.delivered).toBe(2);
    expect(result.failures).toEqual([]);
    expect(reached.sort()).toEqual(['c1', 'c2']);
  });

  it('部分連線失敗 → 其餘照常送達，不拋出例外', async () => {
    const result = await emitPublishStatusChanged(
      publisher(['ok', 'bad'], async (id) => {
        if (id === 'bad') throw new Error('network');
      }),
      { record: record(), traceId: 't', policyVersion: 'v1' },
    );
    expect(result.delivered).toBe(1);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].connectionId).toBe('bad');
    expect(result.staleConnectionIds).toEqual([]);
  });

  it('410 Gone → 標記 stale 並呼叫 deleteConnection 清理', async () => {
    const deleted: string[] = [];
    const result = await emitPublishStatusChanged(
      publisher(
        ['live', 'gone'],
        async (id) => {
          if (id === 'gone') throw { name: 'GoneException' };
        },
        async (id) => {
          deleted.push(id);
        },
      ),
      { record: record(), traceId: 't', policyVersion: 'v1' },
    );

    expect(result.staleConnectionIds).toEqual(['gone']);
    // 清理是背景進行，等一個 microtask flush
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(deleted).toEqual(['gone']);
  });

  it('未實作 deleteConnection → 靜默跳過清理，不影響回傳', async () => {
    const result = await emitPublishStatusChanged(
      publisher(['gone'], async () => {
        throw { $metadata: { httpStatusCode: 410 } };
      }),
      { record: record(), traceId: 't', policyVersion: 'v1' },
    );
    expect(result.staleConnectionIds).toEqual(['gone']);
    expect(result.delivered).toBe(0);
  });

  it('無任何連線 → delivered 0，不呼叫 postToConnection', async () => {
    const post = vi.fn(async () => undefined);
    const result = await emitPublishStatusChanged(
      { listConnectionIds: async () => [], postToConnection: post },
      { record: record(), traceId: 't', policyVersion: 'v1' },
    );
    expect(result.delivered).toBe(0);
    expect(post).not.toHaveBeenCalled();
  });

  it('送出的字串可還原為 payload（Dashboard 以 ready_event_id 去重）', async () => {
    let captured = '';
    await emitPublishStatusChanged(
      {
        listConnectionIds: async () => ['c1'],
        postToConnection: async (_id, payload) => {
          captured = payload;
        },
      },
      { record: record(), traceId: 't', policyVersion: 'v1' },
    );
    const parsed = JSON.parse(captured) as { ready_event_id: string; event_type: string };
    expect(parsed.event_type).toBe(PUBLISH_STATUS_CHANGED_EVENT);
    expect(parsed.ready_event_id).toBe(`${DECISION_ID}|publish.status_changed|published|3`);
  });
});
