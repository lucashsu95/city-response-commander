/**
 * WhatIfFn handler 測試 (TASK-136, TASK-142)
 *
 * 涵蓋 HTTP 進入點的守門與四階段串接：
 * - Cognito operator 授權（fail-closed）
 * - request body 解析（含 base64 + UTF-8 中文）
 * - clarification 短路：stage 2 失敗時不進入 stage 3/4
 * - 回應恆帶 does_not_mutate_state=true
 *
 * @module backend/test/whatif/whatif_fn
 */

import { describe, it, expect } from 'vitest';
import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import type { BedrockInvoker, BedrockResult, SopRetriever } from '@city-commander/rag';
import { createWhatIfHandler } from '../../src/whatif/whatif_fn.js';

const OPERATOR = 'cognito-sub-operator-1';

// ─── Stubs ────────────────────────────────────────────────────────────────────

function bedrockReturning(text: string): BedrockInvoker {
  return {
    async invoke(): Promise<BedrockResult> {
      return { outcome: 'success', text, usedModelId: 'stub-model' };
    },
  };
}

function bedrockFailing(): BedrockInvoker {
  return {
    async invoke(): Promise<BedrockResult> {
      return { outcome: 'use_template', reason: 'timeout', message: 'stub timeout' };
    },
  };
}

/** 記錄 prompt 以便驗證使用者輸入如何進入 Bedrock */
function bedrockCapturing(texts: string[], response: string): BedrockInvoker {
  return {
    async invoke(prompt: string): Promise<BedrockResult> {
      texts.push(prompt);
      return { outcome: 'success', text: response, usedModelId: 'stub-model' };
    },
  };
}

function retrieverStub(onCall?: () => void): SopRetriever {
  return {
    async retrieve() {
      onCall?.();
      return { outcome: 'success', citations: [], source: 'kb' };
    },
  } as unknown as SopRetriever;
}

const PARSED_BL17 = JSON.stringify({
  status: 'parsed',
  assumptions: [{ entity_id: 'BS_MRT_BL17', field: 'User_Count', operator: '=', value: 40000 }],
});

// ─── Event builder ────────────────────────────────────────────────────────────

function makeEvent(options: {
  body?: string | null;
  isBase64Encoded?: boolean;
  claims?: Record<string, unknown> | null;
}): APIGatewayProxyEventV2 {
  const { claims = { sub: OPERATOR, 'cognito:groups': ['operators'] } } = options;
  return {
    body: options.body,
    isBase64Encoded: options.isBase64Encoded ?? false,
    headers: {},
    requestContext: {
      requestId: 'req-whatif-1',
      ...(claims === null ? {} : { authorizer: { jwt: { claims } } }),
    },
  } as unknown as APIGatewayProxyEventV2;
}

function statusOf(result: unknown): number {
  return (result as { statusCode: number }).statusCode;
}

function parseBody(result: unknown): Record<string, unknown> {
  return JSON.parse((result as { body: string }).body) as Record<string, unknown>;
}

// ─── 授權 ─────────────────────────────────────────────────────────────────────

describe('WhatIfFn — Cognito operator 授權', () => {
  it('無 claims → 401，且不呼叫 Bedrock', async () => {
    let invoked = false;
    const handler = createWhatIfHandler({
      bedrockInvoker: {
        async invoke(): Promise<BedrockResult> {
          invoked = true;
          return { outcome: 'use_template', reason: 'timeout', message: '' };
        },
      },
      sopRetriever: retrieverStub(),
    });

    const result = await handler(makeEvent({ body: '{"query":"x"}', claims: null }));
    expect(statusOf(result)).toBe(401);
    expect(parseBody(result).error_code).toBe('UNAUTHORIZED');
    expect(invoked).toBe(false);
  });

  it('非 operators group → 401', async () => {
    const handler = createWhatIfHandler({
      bedrockInvoker: bedrockReturning(PARSED_BL17),
      sopRetriever: retrieverStub(),
    });
    const result = await handler(
      makeEvent({ body: '{"query":"x"}', claims: { sub: OPERATOR, 'cognito:groups': ['viewers'] } }),
    );
    expect(statusOf(result)).toBe(401);
  });
});

// ─── request body 解析 ────────────────────────────────────────────────────────

describe('WhatIfFn — request body 解析', () => {
  it('base64 編碼的中文問句正確還原（UTF-8，非 latin1）', async () => {
    const prompts: string[] = [];
    const question = '若 BL17 人數增至 40000，會觸發哪些 SOP？';
    const handler = createWhatIfHandler({
      bedrockInvoker: bedrockCapturing(prompts, PARSED_BL17),
      sopRetriever: retrieverStub(),
    });

    const body = Buffer.from(JSON.stringify({ query: question }), 'utf-8').toString('base64');
    const result = await handler(makeEvent({ body, isBase64Encoded: true }));

    expect(statusOf(result)).toBe(200);
    // 中文完整進入 stage 1 prompt，沒有變成亂碼
    expect(prompts[0]).toContain(question);
    expect(prompts[0]).not.toContain('è');
  });

  it('非 base64 的一般 body 照常解析', async () => {
    const prompts: string[] = [];
    const handler = createWhatIfHandler({
      bedrockInvoker: bedrockCapturing(prompts, PARSED_BL17),
      sopRetriever: retrieverStub(),
    });

    const result = await handler(
      makeEvent({ body: JSON.stringify({ query: '若 BL17 人數 = 40000' }) }),
    );
    expect(statusOf(result)).toBe(200);
    expect(prompts[0]).toContain('若 BL17 人數 = 40000');
  });

  it('body 為 null → 400', async () => {
    const handler = createWhatIfHandler({
      bedrockInvoker: bedrockReturning(PARSED_BL17),
      sopRetriever: retrieverStub(),
    });
    const result = await handler(makeEvent({ body: null }));
    expect(statusOf(result)).toBe(400);
    expect(parseBody(result).error_code).toBe('INVALID_REQUEST');
  });

  it('query 為空白字串 → 400', async () => {
    const handler = createWhatIfHandler({
      bedrockInvoker: bedrockReturning(PARSED_BL17),
      sopRetriever: retrieverStub(),
    });
    const result = await handler(makeEvent({ body: JSON.stringify({ query: '   ' }) }));
    expect(statusOf(result)).toBe(400);
  });

  it('query 超過 2000 字元 → 400（防超長 prompt injection）', async () => {
    const handler = createWhatIfHandler({
      bedrockInvoker: bedrockReturning(PARSED_BL17),
      sopRetriever: retrieverStub(),
    });
    const result = await handler(
      makeEvent({ body: JSON.stringify({ query: 'a'.repeat(2001) }) }),
    );
    expect(statusOf(result)).toBe(400);
  });

  it('body 非合法 JSON → 400', async () => {
    const handler = createWhatIfHandler({
      bedrockInvoker: bedrockReturning(PARSED_BL17),
      sopRetriever: retrieverStub(),
    });
    const result = await handler(makeEvent({ body: '{not json' }));
    expect(statusOf(result)).toBe(400);
  });
});

// ─── 四階段短路 ───────────────────────────────────────────────────────────────

describe('WhatIfFn — clarification 短路（§14.5）', () => {
  it('stage 1 無法解析 → 200 clarification，不進入 stage 4（不呼叫 SopRetriever）', async () => {
    let retrieveCalled = false;
    const handler = createWhatIfHandler({
      bedrockInvoker: bedrockFailing(),
      sopRetriever: retrieverStub(() => {
        retrieveCalled = true;
      }),
    });

    const result = await handler(makeEvent({ body: JSON.stringify({ query: '天氣如何？' }) }));
    const body = parseBody(result);

    expect(statusOf(result)).toBe(200);
    expect(body.status).toBe('clarification_required');
    expect(body.clarification_prompt).toBeTruthy();
    expect(body.triggered_articles).toEqual([]);
    expect(retrieveCalled).toBe(false);
  });

  it('stage 2 驗證失敗 → 200 clarification，不進入 stage 3/4', async () => {
    let retrieveCalled = false;
    const badEntity = JSON.stringify({
      status: 'parsed',
      assumptions: [{ entity_id: 'UNKNOWN_X', field: 'User_Count', operator: '=', value: 1 }],
    });
    const handler = createWhatIfHandler({
      bedrockInvoker: bedrockReturning(badEntity),
      sopRetriever: retrieverStub(() => {
        retrieveCalled = true;
      }),
    });

    const result = await handler(makeEvent({ body: JSON.stringify({ query: 'x' }) }));
    const body = parseBody(result);

    expect(body.status).toBe('clarification_required');
    expect(body.triggered_articles).toEqual([]);
    expect(retrieveCalled).toBe(false);
  });

  it('完整流程通過 → answered，決定性欄位來自 stage 3', async () => {
    const handler = createWhatIfHandler({
      bedrockInvoker: bedrockReturning(PARSED_BL17),
      sopRetriever: retrieverStub(),
    });

    const result = await handler(
      makeEvent({ body: JSON.stringify({ query: '若 BL17 人數增至 40000' }) }),
    );
    const body = parseBody(result);

    expect(body.status).toBe('answered');
    expect(body.triggered_articles).toEqual([3]);
    expect(Array.isArray(body.expected_actions)).toBe(true);
  });
});

// ─── 不變式 ───────────────────────────────────────────────────────────────────

describe('WhatIfFn — 回應不變式', () => {
  const cases: readonly [string, BedrockInvoker][] = [
    ['clarification', bedrockFailing()],
    ['answered', bedrockReturning(PARSED_BL17)],
  ];

  for (const [label, invoker] of cases) {
    it(`${label} 回應恆帶 does_not_mutate_state=true 與 provisional`, async () => {
      const handler = createWhatIfHandler({
        bedrockInvoker: invoker,
        sopRetriever: retrieverStub(),
      });
      const body = parseBody(
        await handler(makeEvent({ body: JSON.stringify({ query: '若 BL17 人數 = 40000' }) })),
      );
      expect(body.does_not_mutate_state).toBe(true);
      expect(body.provisional).toBe(true);
      expect(body.schema_version).toBeTruthy();
    });
  }

  it('非預期例外 → 500 且不外洩內部訊息', async () => {
    const handler = createWhatIfHandler({
      bedrockInvoker: {
        async invoke(): Promise<BedrockResult> {
          throw new Error('bedrock endpoint arn leaked');
        },
      },
      sopRetriever: retrieverStub(),
    });

    const result = await handler(makeEvent({ body: JSON.stringify({ query: 'x' }) }));
    expect(statusOf(result)).toBe(500);
    expect(String(parseBody(result).message)).not.toContain('arn');
  });
});
