/**
 * BedrockAdapter — Bedrock Converse 客戶端封裝 (TASK-112)
 *
 * 職責（§4.1, §21.2, §23）：
 * - `invoke(prompt, opts)` 帶 client timeout（預設 30 s）與 model_id_fallbacks
 * - region lacks model → 繼續嘗試 fallback list → 全數失敗才回傳 use_template
 * - 逾時或所有 model 耗盡 → 回傳 use_template，絕不阻擋 Fast Path
 * - model_id 與 region 從 ConfigProvider 取得，不硬編
 * - BedrockRuntimeClient 為 class field（長生命週期），不在每次呼叫重建
 *
 * ⚠️  不在 Fast Path 上（DecisionFn 不依賴本模組）。
 *
 * @module rag/bedrock_adapter
 */

import {
  BedrockRuntimeClient,
  ConverseCommand,
  type ConverseCommandOutput,
  type Message,
} from '@aws-sdk/client-bedrock-runtime';
import type { ConfigProvider } from '@city-commander/config';

// ─── Public types ──────────────────────────────────────────────────────────

/** invoke() 成功時的結果 */
export interface BedrockSuccess {
  readonly outcome: 'success';
  /** Bedrock 回傳的純文字（已從 Converse response 抽取） */
  readonly text: string;
  /** 最終使用的 model ID（可能是 fallback） */
  readonly usedModelId: string;
}

/** invoke() 失敗時的結果，呼叫端必須使用 template fallback */
export interface BedrockFailure {
  readonly outcome: 'use_template';
  /** 失敗原因，供 structured logging 使用 */
  readonly reason: BedrockFailureReason;
  /** 人可讀的診斷訊息（不含 prompt 內容，避免 prompt injection log） */
  readonly message: string;
}

export type BedrockFailureReason =
  | 'timeout'               // 逾時（該 model 可重試下一個 fallback）
  | 'model_not_supported'   // 所有 model ID 在此 region 均不支援
  | 'throttled'             // 被 throttle（該 model 可重試下一個 fallback）
  | 'unexpected_error';     // 其他非預期錯誤

export type BedrockResult = BedrockSuccess | BedrockFailure;

/** invoke() 的選項 */
export interface BedrockInvokeOptions {
  /**
   * 每次 API 呼叫的 timeout（毫秒）。
   * 預設 30000 ms（30 s），符合 spec §21.2 要求。
   */
  readonly timeoutMs?: number;
}

// ─── Adapter interface ─────────────────────────────────────────────────────

/**
 * BedrockInvoker interface — 讓 composers 依賴 abstraction，
 * 方便 LOCAL_MOCK 注入 MockBedrockAdapter。
 */
export interface BedrockInvoker {
  invoke(prompt: string, opts?: BedrockInvokeOptions): Promise<BedrockResult>;
}

// ─── Default timeout ───────────────────────────────────────────────────────

const DEFAULT_TIMEOUT_MS = 30_000;

// ─── BedrockAdapter implementation ────────────────────────────────────────

/**
 * 真實的 Bedrock Converse adapter。
 *
 * BedrockRuntimeClient 在 constructor 建立一次（長生命週期），
 * 避免重複建立造成 TCP 連線洩漏。
 *
 * 使用方式：
 * ```ts
 * const adapter = new BedrockAdapter(configProvider);
 * const result = await adapter.invoke(prompt);
 * if (result.outcome === 'use_template') { ... }
 * ```
 */
export class BedrockAdapter implements BedrockInvoker {
  private readonly primaryModelId: string;
  private readonly fallbackModelIds: readonly string[];
  /** 長生命週期 client；region 固定於 constructor，不在每次呼叫重建 */
  private readonly client: BedrockRuntimeClient;

  constructor(config: ConfigProvider) {
    const region = config.get('bedrock.region') as string;
    this.primaryModelId = config.get('bedrock.model_id') as string;
    this.fallbackModelIds = config.get('bedrock.model_id_fallbacks') as readonly string[];
    this.client = new BedrockRuntimeClient({ region });
  }

  /**
   * Converse API を呼び出す。
   *
   * fallback 策略（§21.2 spec）：
   * - timeout / throttled / unexpected_error → 繼續嘗試下一個 fallback
   * - model_not_supported → 繼續嘗試下一個 fallback（region lacks model 情境）
   * - 所有 model ID 均失敗 → 回傳 use_template
   */
  async invoke(prompt: string, opts: BedrockInvokeOptions = {}): Promise<BedrockResult> {
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const modelIds = [this.primaryModelId, ...this.fallbackModelIds];
    let lastReason: BedrockFailureReason = 'unexpected_error';
    let lastMessage = '';

    for (const modelId of modelIds) {
      const result = await this.tryModel(modelId, prompt, timeoutMs);
      if (result.outcome === 'success') {
        return result;
      }
      // 所有失敗類型都嘗試下一個 fallback（包含 model_not_supported）
      // 原因：spec §21.2「region lacks model → fallback list」要求全 list 都試過才放棄
      lastReason = result.reason;
      lastMessage = result.message;
    }

    return {
      outcome: 'use_template',
      reason: lastReason,
      message: `All ${modelIds.length} model ID(s) exhausted. Last error: ${lastMessage}`,
    };
  }

  // ─── private helpers ─────────────────────────────────────────────────────

  private async tryModel(
    modelId: string,
    prompt: string,
    timeoutMs: number,
  ): Promise<BedrockResult> {
    const messages: Message[] = [{ role: 'user', content: [{ text: prompt }] }];
    const command = new ConverseCommand({ modelId, messages });

    try {
      const response = await withTimeout(this.client.send(command), timeoutMs);
      const text = extractTextFromConverse(response);
      if (text === null) {
        return {
          outcome: 'use_template',
          reason: 'unexpected_error',
          message: `Model ${modelId} returned no text content in Converse response`,
        };
      }
      return { outcome: 'success', text, usedModelId: modelId };
    } catch (err) {
      return classifyError(err, modelId);
    }
  }
}

// ─── Internal helpers ──────────────────────────────────────────────────────

/**
 * Promise に timeout を追加する（racing Promise パターン）。
 * AWS SDK v3 の send() は AbortSignal をサポートするが、
 * racing Promise で統一することで SDK バージョン依存を避ける。
 */
function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new TimeoutError(`Bedrock request timed out after ${ms}ms`)),
      ms,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}

/**
 * ConverseCommandOutput から最初のテキストブロックを抽出する。
 * AWS SDK v3 の型定義を使用し、any を排除する。
 */
function extractTextFromConverse(response: ConverseCommandOutput): string | null {
  const blocks = response?.output?.message?.content;
  if (!Array.isArray(blocks)) return null;
  for (const block of blocks) {
    if ('text' in block && typeof block.text === 'string') return block.text;
  }
  return null;
}

/** AWS SDK エラーを BedrockFailure に分類する */
function classifyError(err: unknown, modelId: string): BedrockFailure {
  if (err instanceof TimeoutError) {
    return { outcome: 'use_template', reason: 'timeout', message: err.message };
  }
  if (isAwsError(err)) {
    const code = err.name ?? '';
    if (code === 'ValidationException' || code === 'AccessDeniedException') {
      return {
        outcome: 'use_template',
        reason: 'model_not_supported',
        message: `Model ${modelId} not supported in this region: ${code}`,
      };
    }
    if (code === 'ThrottlingException' || code === 'ServiceUnavailableException') {
      return {
        outcome: 'use_template',
        reason: 'throttled',
        message: `Model ${modelId} throttled: ${code}`,
      };
    }
  }
  const msg = err instanceof Error ? err.message : String(err);
  return { outcome: 'use_template', reason: 'unexpected_error', message: msg };
}

class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'TimeoutError';
  }
}

function isAwsError(err: unknown): err is { name: string; message: string } {
  return typeof err === 'object' && err !== null && 'name' in err;
}
