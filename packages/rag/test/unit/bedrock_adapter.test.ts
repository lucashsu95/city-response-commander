/**
 * BedrockAdapter — unit tests (TASK-112)
 *
 * 重點：
 * - fallback 走訪順序與失敗分類
 * - 逾時會真的中止底層請求（AbortSignal），不只是「不再等它」
 * - 總預算把 invoke() 的耗時上限釘死，不隨 fallback 數量線性放大
 *
 * @module rag/test/unit/bedrock_adapter
 */

import { describe, it, expect, vi } from 'vitest';
import { BedrockAdapter } from '../../src/bedrock_adapter.js';
import type { ConfigProvider } from '@city-commander/config';

// ─── Stub helpers ──────────────────────────────────────────────────────────

function makeConfig(modelIds: readonly string[]): ConfigProvider {
  const [primary, ...fallbacks] = modelIds;
  return {
    get(key: string) {
      if (key === 'bedrock.region') return 'ap-northeast-1';
      if (key === 'bedrock.model_id') return primary;
      if (key === 'bedrock.model_id_fallbacks') return fallbacks;
      return undefined;
    },
  } as unknown as ConfigProvider;
}

interface SendCall {
  readonly modelId: string;
  readonly signal: AbortSignal;
}

/**
 * 以受控的 send() 取代真實 SDK client。
 * `behaviour` 決定每個 model 的行為；未列出者視為成功。
 */
function makeAdapter(
  modelIds: readonly string[],
  behaviour: Record<string, 'success' | 'hang' | { error: { name: string } }>,
  calls: SendCall[],
): BedrockAdapter {
  const adapter = new BedrockAdapter(makeConfig(modelIds));
  const stubClient = {
    async send(command: { input: { modelId: string } }, options: { abortSignal: AbortSignal }) {
      const modelId = command.input.modelId;
      calls.push({ modelId, signal: options.abortSignal });
      const mode = behaviour[modelId] ?? 'success';

      if (mode === 'hang') {
        // 永不 resolve；只有 abort 或逾時才會結束等待
        return new Promise(() => {});
      }
      if (typeof mode === 'object') {
        throw Object.assign(new Error(mode.error.name), mode.error);
      }
      return {
        output: { message: { content: [{ text: `reply from ${modelId}` }] } },
      };
    },
  };
  (adapter as unknown as { client: unknown }).client = stubClient;
  return adapter;
}

// ─── fallback 走訪 ─────────────────────────────────────────────────────────

describe('BedrockAdapter — model fallback', () => {
  it('主要 model 成功 → 不嘗試 fallback', async () => {
    const calls: SendCall[] = [];
    const adapter = makeAdapter(['primary', 'fb1', 'fb2'], {}, calls);

    const result = await adapter.invoke('prompt');
    expect(result.outcome).toBe('success');
    if (result.outcome !== 'success') return;
    expect(result.usedModelId).toBe('primary');
    expect(calls.map((c) => c.modelId)).toEqual(['primary']);
  });

  it('region 不支援主要 model → 依序試 fallback 直到成功', async () => {
    const calls: SendCall[] = [];
    const adapter = makeAdapter(
      ['primary', 'fb1', 'fb2'],
      {
        primary: { error: { name: 'ValidationException' } },
        fb1: { error: { name: 'AccessDeniedException' } },
      },
      calls,
    );

    const result = await adapter.invoke('prompt');
    expect(result.outcome).toBe('success');
    if (result.outcome !== 'success') return;
    expect(result.usedModelId).toBe('fb2');
    expect(calls.map((c) => c.modelId)).toEqual(['primary', 'fb1', 'fb2']);
  });

  it('全部 model 失敗 → use_template（絕不阻擋呼叫端）', async () => {
    const calls: SendCall[] = [];
    const adapter = makeAdapter(
      ['primary', 'fb1'],
      {
        primary: { error: { name: 'ThrottlingException' } },
        fb1: { error: { name: 'ThrottlingException' } },
      },
      calls,
    );

    const result = await adapter.invoke('prompt');
    expect(result.outcome).toBe('use_template');
    if (result.outcome !== 'use_template') return;
    expect(result.reason).toBe('throttled');
    expect(result.message).toContain('exhausted');
  });
});

// ─── 逾時與中止 ───────────────────────────────────────────────────────────

describe('BedrockAdapter — 逾時會中止底層請求', () => {
  it('逾時後 abortSignal 被觸發（不只是停止等待）', async () => {
    const calls: SendCall[] = [];
    const adapter = makeAdapter(['primary'], { primary: 'hang' }, calls);

    const result = await adapter.invoke('prompt', { timeoutMs: 20, totalBudgetMs: 100 });

    expect(result.outcome).toBe('use_template');
    if (result.outcome !== 'use_template') return;
    expect(result.reason).toBe('timeout');
    // 關鍵：底層請求收到中止訊號，連線不會繼續掛著
    expect(calls[0].signal.aborted).toBe(true);
  });

  it('前一個 model 逾時後，其 signal 已中止，不與 fallback 並存', async () => {
    const calls: SendCall[] = [];
    const adapter = makeAdapter(['primary', 'fb1'], { primary: 'hang' }, calls);

    const result = await adapter.invoke('prompt', { timeoutMs: 20, totalBudgetMs: 500 });

    expect(result.outcome).toBe('success');
    expect(calls.map((c) => c.modelId)).toEqual(['primary', 'fb1']);
    expect(calls[0].signal.aborted).toBe(true);
    expect(calls[1].signal.aborted).toBe(false);
  });
});

// ─── 總預算 ───────────────────────────────────────────────────────────────

describe('BedrockAdapter — 總預算上限', () => {
  it('預算用盡後不再嘗試剩餘 model', async () => {
    const calls: SendCall[] = [];
    const adapter = makeAdapter(
      ['m1', 'm2', 'm3', 'm4'],
      { m1: 'hang', m2: 'hang', m3: 'hang', m4: 'hang' },
      calls,
    );

    const started = Date.now();
    const result = await adapter.invoke('prompt', { timeoutMs: 30, totalBudgetMs: 70 });
    const elapsed = Date.now() - started;

    expect(result.outcome).toBe('use_template');
    if (result.outcome !== 'use_template') return;
    expect(result.reason).toBe('timeout');
    // 四個 model 各 30ms 會是 120ms；總預算 70ms 讓它提前收手
    expect(calls.length).toBeLessThan(4);
    expect(elapsed).toBeLessThan(120);
    expect(result.message).toContain('Total budget');
  });

  it('單次逾時不得超過剩餘預算', async () => {
    const calls: SendCall[] = [];
    const adapter = makeAdapter(['m1', 'm2'], { m1: 'hang', m2: 'hang' }, calls);

    const started = Date.now();
    await adapter.invoke('prompt', { timeoutMs: 1000, totalBudgetMs: 60 });
    const elapsed = Date.now() - started;

    // 單次 timeout 1000ms 但總預算只有 60ms → 實際等待被壓到預算內
    expect(elapsed).toBeLessThan(300);
  });

  it('未指定選項時使用預設值，行為不變（成功路徑）', async () => {
    const calls: SendCall[] = [];
    const adapter = makeAdapter(['primary'], {}, calls);
    const result = await adapter.invoke('prompt');
    expect(result.outcome).toBe('success');
  });
});
