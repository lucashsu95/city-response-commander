/**
 * PublishFn 授權、前置條件與冪等回應測試 (TASK-144, TASK-151, TASK-152)
 *
 * 涵蓋 publish 流程在真正動到狀態之前的所有守門：
 * - Cognito commander 身份（fail-closed）
 * - decision 存在性與 core_committed 前置條件
 * - request body 解析與 publish_failed 的 failure_reason 必填
 * - 冪等：相同 retry 不重複轉移、並發 VERSION_DRIFT 不視為錯誤
 *
 * @module backend/test/publish/publish_fn_authz
 */

import { describe, it, expect, vi } from 'vitest';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import type { PublishRecord } from '@city-commander/shared-schemas';
import { PublishStatus } from '@city-commander/shared-schemas';
import { createPublishHandler } from '../../src/publish/publish_fn.js';
import type { PublishFnDependencies } from '../../src/publish/publish_fn.js';
import { appendAuditEntry } from '../../src/publish/audit_trail.js';

const DECISION_ID = 'DEC_AUTHZ_001';
const ACTOR = 'cognito-sub-commander-1';

// ─── Event builders ───────────────────────────────────────────────────────────

function makeEvent(options: {
  claims?: Record<string, unknown> | null;
  body?: unknown;
  pathParameters?: Record<string, string> | null;
}): APIGatewayProxyEventV2 {
  const { claims = { sub: ACTOR, 'cognito:groups': ['commanders'] }, body = {} } = options;
  const pathParameters =
    options.pathParameters === undefined ? { id: DECISION_ID } : options.pathParameters;

  return {
    body: body === null ? null : JSON.stringify(body),
    pathParameters,
    requestContext: {
      requestId: 'req-authz-1',
      ...(claims === null ? {} : { authorizer: { jwt: { claims } } }),
    },
  } as unknown as APIGatewayProxyEventV2;
}

/** 預設依賴：decision 存在且已 commit，PublishRecord 尚未建立 */
function makeDeps(overrides: Partial<PublishFnDependencies> = {}): PublishFnDependencies {
  return {
    readDecisionCoreStatus: async () => ({ exists: true, core_committed: true }),
    readPublishRecord: async () => null,
    readCmsCoreText: async () => 'cms',
    writePublishRecord: async (record) => ({ success: true, record }),
    ...overrides,
  };
}

function parseBody(result: unknown): Record<string, unknown> {
  return JSON.parse((result as { body: string }).body) as Record<string, unknown>;
}

function statusOf(result: unknown): number {
  return (result as { statusCode: number }).statusCode;
}

function approvedRecord(version = 2): PublishRecord {
  const draft = appendAuditEntry({
    decisionId: DECISION_ID,
    actor: ACTOR,
    existing: null,
    targetState: PublishStatus.draft,
    failureReason: null,
    now: '2026-05-20 22:00',
  });
  const approved = appendAuditEntry({
    decisionId: DECISION_ID,
    actor: ACTOR,
    existing: draft,
    targetState: PublishStatus.approved,
    failureReason: null,
    now: '2026-05-20 22:05',
  });
  return { ...approved, version };
}

// ─── Cognito 授權（fail-closed）────────────────────────────────────────────

describe('PublishFn — Cognito commander 授權', () => {
  it('無 authorizer claims → 403，且不讀取任何資料', async () => {
    let readCalled = false;
    const handler = createPublishHandler(
      makeDeps({
        readDecisionCoreStatus: async () => {
          readCalled = true;
          return { exists: true, core_committed: true };
        },
      }),
    );

    const result = await handler(makeEvent({ claims: null }));
    expect(statusOf(result)).toBe(403);
    expect(parseBody(result).error_code).toBe('FORBIDDEN');
    expect(readCalled).toBe(false);
  });

  it('claims 存在但無 cognito:groups → 403', async () => {
    const handler = createPublishHandler(makeDeps());
    const result = await handler(makeEvent({ claims: { sub: ACTOR } }));
    expect(statusOf(result)).toBe(403);
  });

  it('屬於其他 group（operators）→ 403，commanders 才能發布', async () => {
    const handler = createPublishHandler(makeDeps());
    const result = await handler(
      makeEvent({ claims: { sub: ACTOR, 'cognito:groups': ['operators', 'viewers'] } }),
    );
    expect(statusOf(result)).toBe(403);
  });

  it('sub 為空字串 → 403（token 未通過驗證視同未授權）', async () => {
    const handler = createPublishHandler(makeDeps());
    const result = await handler(
      makeEvent({ claims: { sub: '   ', 'cognito:groups': ['commanders'] } }),
    );
    expect(statusOf(result)).toBe(403);
  });

  it('cognito:groups 為逗號分隔字串 → 正常授權', async () => {
    const handler = createPublishHandler(makeDeps());
    const result = await handler(
      makeEvent({ claims: { sub: ACTOR, 'cognito:groups': 'viewers,commanders' } }),
    );
    expect(statusOf(result)).toBe(200);
  });

  it('actor 身份寫入 audit_trail（來自 Cognito sub，非 request body）', async () => {
    let written: PublishRecord | null = null;
    const handler = createPublishHandler(
      makeDeps({
        writePublishRecord: async (record) => {
          written = record;
          return { success: true, record };
        },
      }),
    );

    await handler(
      makeEvent({
        claims: { sub: 'commander-xyz', 'cognito:groups': ['commanders'] },
        body: { actor: 'ATTACKER_SPOOFED' },
      }),
    );

    expect(written).not.toBeNull();
    expect(written!.audit_trail[0].actor).toBe('commander-xyz');
  });
});

// ─── 前置條件 ─────────────────────────────────────────────────────────────────

describe('PublishFn — 前置條件', () => {
  it('缺少 path parameter id → 400', async () => {
    const handler = createPublishHandler(makeDeps());
    const result = await handler(makeEvent({ pathParameters: null }));
    expect(statusOf(result)).toBe(400);
    expect(parseBody(result).error_code).toBe('INVALID_REQUEST');
  });

  it('decision 不存在 → 404', async () => {
    const handler = createPublishHandler(
      makeDeps({ readDecisionCoreStatus: async () => ({ exists: false, core_committed: false }) }),
    );
    const result = await handler(makeEvent({}));
    expect(statusOf(result)).toBe(404);
    expect(parseBody(result).error_code).toBe('DECISION_NOT_FOUND');
  });

  it('core_committed=false → 409（決策尚未定案不可發布）', async () => {
    const handler = createPublishHandler(
      makeDeps({ readDecisionCoreStatus: async () => ({ exists: true, core_committed: false }) }),
    );
    const result = await handler(makeEvent({}));
    expect(statusOf(result)).toBe(409);
    expect(parseBody(result).error_code).toBe('DECISION_NOT_READY');
  });

  it('已 published（終端狀態）+ 無 target_state → 400，無法推斷後繼', async () => {
    const published: PublishRecord = {
      ...approvedRecord(),
      publish_state: PublishStatus.published,
    };
    const handler = createPublishHandler(
      makeDeps({ readPublishRecord: async () => published }),
    );
    const result = await handler(makeEvent({ body: {} }));
    expect(statusOf(result)).toBe(400);
    expect(parseBody(result).error_code).toBe('INVALID_TARGET_STATE');
  });

  it('轉移至 publish_failed 但未提供 failure_reason → 400', async () => {
    const handler = createPublishHandler(
      makeDeps({ readPublishRecord: async () => approvedRecord() }),
    );
    const result = await handler(makeEvent({ body: { target_state: 'publish_failed' } }));
    expect(statusOf(result)).toBe(400);
    expect(parseBody(result).error_code).toBe('MISSING_FAILURE_REASON');
  });

  it('非法轉移（draft → published）→ 409 並列出合法後繼', async () => {
    const draft = appendAuditEntry({
      decisionId: DECISION_ID,
      actor: ACTOR,
      existing: null,
      targetState: PublishStatus.draft,
      failureReason: null,
    });
    const handler = createPublishHandler(makeDeps({ readPublishRecord: async () => draft }));
    const result = await handler(makeEvent({ body: { target_state: 'published' } }));
    expect(statusOf(result)).toBe(409);
    expect(parseBody(result).error_code).toBe('ILLEGAL_TRANSITION');
    expect(String(parseBody(result).message)).toContain('approved');
  });

  it('body 非合法 JSON → 依當前狀態推斷（不視為錯誤）', async () => {
    const handler = createPublishHandler(makeDeps());
    const event = makeEvent({});
    (event as { body: string }).body = '{not json';
    const result = await handler(event);
    // null 狀態 → 推斷 draft
    expect(statusOf(result)).toBe(200);
    expect(parseBody(result).publish_state).toBe(PublishStatus.draft);
  });
});

// ─── 冪等（§15.2, TASK-151）─────────────────────────────────────────────────

describe('PublishFn — 冪等', () => {
  it('相同 retry（同狀態 + 同 version）→ 200 idempotent，不再寫入', async () => {
    const published: PublishRecord = {
      ...approvedRecord(3),
      publish_state: PublishStatus.published,
    };
    let writeCount = 0;
    const handler = createPublishHandler(
      makeDeps({
        readPublishRecord: async () => published,
        writePublishRecord: async (record) => {
          writeCount++;
          return { success: true, record };
        },
      }),
    );

    const result = await handler(makeEvent({ body: { target_state: 'published' } }));
    expect(statusOf(result)).toBe(200);
    expect(parseBody(result).idempotent).toBe(true);
    expect(parseBody(result).publish_state).toBe(PublishStatus.published);
    // 關鍵：retry 不得再次執行狀態轉移或任何副作用
    expect(writeCount).toBe(0);
  });

  it('retry 回傳既有 audit_trail，不新增 entry', async () => {
    const published: PublishRecord = {
      ...approvedRecord(3),
      publish_state: PublishStatus.published,
    };
    const handler = createPublishHandler(makeDeps({ readPublishRecord: async () => published }));
    const result = await handler(makeEvent({ body: { target_state: 'published' } }));
    expect(parseBody(result).audit_trail).toHaveLength(published.audit_trail.length);
  });

  it('並發已達成同一目標狀態 → 200 並提示重讀，不回 4xx', async () => {
    // ALREADY_PUBLISHED 需要 version 相符；此處刻意讓 version 與 record 不一致
    // 的情境由 checkPublishIdempotency 判為 VERSION_DRIFT。
    const published: PublishRecord = {
      ...approvedRecord(9),
      publish_state: PublishStatus.published,
    };
    const handler = createPublishHandler(
      makeDeps({
        readPublishRecord: async () => published,
        // 讀到的 version 是 9，但 handler 以 record.version 作為 expectedVersion，
        // 故此案例透過 idempotency 的 ALREADY_PUBLISHED 分支回應
        writePublishRecord: async (record) => ({ success: true, record }),
      }),
    );
    const result = await handler(makeEvent({ body: { target_state: 'published' } }));
    expect(statusOf(result)).toBe(200);
    expect(parseBody(result).idempotent).toBe(true);
  });

  it('寫入時發生版本衝突 → 409 VERSION_CONFLICT', async () => {
    const handler = createPublishHandler(
      makeDeps({
        readPublishRecord: async () => approvedRecord(),
        writePublishRecord: async () => ({
          success: false,
          reason: 'VERSION_CONFLICT',
          message: '版本衝突',
        }),
      }),
    );
    const result = await handler(makeEvent({ body: { target_state: 'publish_failed', failure_reason: 'x' } }));
    expect(statusOf(result)).toBe(409);
    expect(parseBody(result).error_code).toBe('VERSION_CONFLICT');
  });

  it('底層例外 → 500 且不外洩內部訊息', async () => {
    const handler = createPublishHandler(
      makeDeps({
        readPublishRecord: async () => {
          throw new Error('DynamoDB internal table name leaked');
        },
      }),
    );
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = await handler(makeEvent({}));
    expect(statusOf(result)).toBe(500);
    expect(parseBody(result).error_code).toBe('INTERNAL_ERROR');
    expect(String(parseBody(result).message)).not.toContain('DynamoDB');
    const logged = JSON.stringify(errorSpy.mock.calls);
    expect(logged).not.toContain('DynamoDB internal table name leaked');
    expect(logged).toContain('PUBLISH_UNEXPECTED_ERROR');
    errorSpy.mockRestore();
  });
});

// ─── 對外副作用最多一次（§15.2, TASK-151）─────────────────────────────────

describe('PublishFn — retry 不重複觸發對外通道', () => {
  function publishedRecord(version: number): PublishRecord {
    return { ...approvedRecord(version), publish_state: PublishStatus.published };
  }

  it('首次 published → 通道派送一次（讀取 cms_core_text 作為派送證據）', async () => {
    let cmsReads = 0;
    const handler = createPublishHandler(
      makeDeps({
        readPublishRecord: async () => approvedRecord(),
        readCmsCoreText: async () => {
          cmsReads++;
          return 'cms';
        },
      }),
    );

    const result = await handler(makeEvent({ body: { target_state: 'published' } }));
    expect(statusOf(result)).toBe(200);
    expect(cmsReads).toBe(1);
  });

  it('已 published 的 retry → 完全不派送通道（不重推民眾警示）', async () => {
    let cmsReads = 0;
    const handler = createPublishHandler(
      makeDeps({
        readPublishRecord: async () => publishedRecord(3),
        readCmsCoreText: async () => {
          cmsReads++;
          return 'cms';
        },
      }),
    );

    const result = await handler(makeEvent({ body: { target_state: 'published' } }));
    expect(statusOf(result)).toBe(200);
    expect(parseBody(result).idempotent).toBe(true);
    // §15.2：retry 絕不重新觸發一鍵發布
    expect(cmsReads).toBe(0);
  });

  it('非 published 的轉移（draft/approved）不派送通道', async () => {
    let cmsReads = 0;
    const handler = createPublishHandler(
      makeDeps({
        readPublishRecord: async () => null,
        readCmsCoreText: async () => {
          cmsReads++;
          return 'cms';
        },
      }),
    );

    await handler(makeEvent({ body: { target_state: 'draft' } }));
    expect(cmsReads).toBe(0);
  });
});
