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
import { requireString, requireStringArray } from './config_helpers.js';

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
  | 'timeout' // 逾時（該 model 可重試下一個 fallback）
  | 'model_not_supported' // 所有 model ID 在此 region 均不支援
  | 'throttled' // 被 throttle（該 model 可重試下一個 fallback）
  | 'unexpected_error'; // 其他非預期錯誤

export type BedrockResult = BedrockSuccess | BedrockFailure;

/** invoke() 的選項 */
export interface BedrockInvokeOptions {
  /**
   * 每次 API 呼叫的 timeout（毫秒）。
   * 預設 30000 ms（30 s），符合 spec §21.2 要求。
   */
  readonly timeoutMs?: number;
  /**
   * 整個 `invoke()`（含所有 fallback model）的總預算（毫秒）。
   *
   * 沒有總預算時，`model_id_fallbacks` 有幾個 model，最壞情況就是
   * 幾倍的單次 timeout（4 個 model × 30 s = 120 s），
   * 足以超過 Lambda 的執行上限而被強制中斷——
   * 那會變成沒有回應，而不是乾淨的 template fallback。
   *
   * 預設 60000 ms：允許主要 model 逾時後仍試得到 fallback，
   * 同時把 `invoke()` 的耗時上限釘死在一個可預期的數字。
   */
  readonly totalBudgetMs?: number;
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

/** 整個 invoke()（含所有 fallback）的預設總預算 */
const DEFAULT_TOTAL_BUDGET_MS = 60_000;

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
    const region = requireString(config, 'bedrock.region');
    this.primaryModelId = requireString(config, 'bedrock.model_id');
    this.fallbackModelIds = requireStringArray(config, 'bedrock.model_id_fallbacks');
    this.client = new BedrockRuntimeClient({ region });
  }

  /**
   * 呼叫 Converse API。
   *
   * fallback 策略（§21.2 spec）：
   * - timeout / throttled / unexpected_error → 繼續嘗試下一個 fallback
   * - model_not_supported → 繼續嘗試下一個 fallback（region lacks model 情境）
   * - 所有 model ID 均失敗 → 回傳 use_template
   */
  async invoke(prompt: string, opts: BedrockInvokeOptions = {}): Promise<BedrockResult> {
    const perCallTimeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const totalBudgetMs = opts.totalBudgetMs ?? DEFAULT_TOTAL_BUDGET_MS;
    const deadline = Date.now() + totalBudgetMs;

    const modelIds = [this.primaryModelId, ...this.fallbackModelIds];
    let lastReason: BedrockFailureReason = 'unexpected_error';
    let lastMessage = '';
    let attempted = 0;

    for (const modelId of modelIds) {
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        // 總預算用盡 → 停止嘗試，交回 template fallback
        // （繼續試下去只會讓 Lambda 被強制中斷，變成沒有回應）
        return {
          outcome: 'use_template',
          reason: 'timeout',
          message:
            `Total budget of ${totalBudgetMs}ms exhausted after ${attempted} of ` +
            `${modelIds.length} model ID(s). Last error: ${lastMessage}`,
        };
      }

      attempted++;
      // 單次呼叫不得超過剩餘總預算
      const result = await this.tryModel(modelId, prompt, Math.min(perCallTimeoutMs, remainingMs));
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

    // AbortController 讓逾時真的中止底層請求。
    // 只用 racing Promise 的話，逾時後 SDK 的請求仍在跑：
    // 連線不會釋放，而且下一個 fallback 會與它並存，
    // 在 Lambda 上疊成好幾條同時在飛的 Bedrock 請求。
    const controller = new AbortController();

    try {
      const response = await withTimeout(
        this.client.send(command, { abortSignal: controller.signal }),
        timeoutMs,
        () => controller.abort(),
      );
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
 * 為 Promise 加上 timeout（racing Promise 模式）。
 *
 * `onTimeout` 讓呼叫端在逾時當下中止底層請求（AbortController）——
 * 少了這一步，逾時只會讓「我們不再等它」，請求本身還在跑。
 */
function withTimeout<T>(promise: Promise<T>, ms: number, onTimeout?: () => void): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout?.();
      reject(new TimeoutError(`Bedrock request timed out after ${ms}ms`));
    }, ms);
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
 * 從 ConverseCommandOutput 抽取第一個文字區塊。
 * 使用 AWS SDK v3 的官方型別定義，避免 any。
 */
function extractTextFromConverse(response: ConverseCommandOutput): string | null {
  const blocks = response?.output?.message?.content;
  if (!Array.isArray(blocks)) return null;
  for (const block of blocks) {
    if ('text' in block && typeof block.text === 'string') return block.text;
  }
  return null;
}

/** 將 AWS SDK 錯誤分類為對應的 BedrockFailure */
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
