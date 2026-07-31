/**
 * MockBedrockAdapter — LOCAL_MOCK 環境下的零 AWS 替代品 (TASK-112)
 *
 * 職責（§23, competition_quality_floor）：
 * - 在 LOCAL_MOCK / CI 環境下完全不發送任何 AWS 請求
 * - 回傳固定文字，讓 composers 端對端可在無網路環境跑通
 * - 介面與 BedrockAdapter 完全相同（同實作 BedrockInvoker）
 *
 * 使用方式：
 * ```ts
 * // createBedrockAdapter(config) 依 env 自動選擇
 * const adapter = createBedrockAdapter(configProvider);
 * ```
 *
 * @module rag/mock_bedrock_adapter
 */

import type { ConfigProvider, EnvironmentProfile } from '@city-commander/config';
import type { BedrockInvoker, BedrockInvokeOptions, BedrockResult } from './bedrock_adapter.js';

// ─── Fixed mock responses per narrative context ───────────────────────────
//
// 固定文字讓測試的 snapshot 穩定；如需可配置，請透過 opts 擴充。
const MOCK_TEXT =
  '[MOCK-BEDROCK] This is a deterministic test response. ' +
  'No AWS Bedrock calls were made. ' +
  'Core fields remain unchanged per §9 boundary.';

// ─── MockBedrockAdapter ────────────────────────────────────────────────────

/**
 * LOCAL_MOCK 環境的 Bedrock adapter。
 *
 * - 永遠回傳 `outcome: 'success'` 帶固定文字
 * - 完全不 import 或呼叫 @aws-sdk/client-bedrock-runtime
 * - 供 composers 在 CI / LOCAL_MOCK 下注入使用
 */
export class MockBedrockAdapter implements BedrockInvoker {
  // usedModelId 固定為 'mock'，方便測試斷言
  private static readonly MOCK_MODEL_ID = 'mock';

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async invoke(_prompt: string, _opts?: BedrockInvokeOptions): Promise<BedrockResult> {
    return {
      outcome: 'success',
      text: MOCK_TEXT,
      usedModelId: MockBedrockAdapter.MOCK_MODEL_ID,
    };
  }
}

// ─── Factory ───────────────────────────────────────────────────────────────

/**
 * 依 ConfigProvider 的 `env` 欄位選擇正確的 adapter：
 * - `LOCAL_MOCK` → MockBedrockAdapter（零 AWS 呼叫）
 * - 其他（PERSONAL_AWS_DEV / COMPETITION_AWS）→ BedrockAdapter（真實呼叫）
 *
 * 此 factory 是 spec「select via ConfigProvider」的實作點。
 *
 * @param config - ConfigProvider 實例
 * @returns BedrockInvoker 實例
 */
export async function createBedrockAdapter(config: ConfigProvider): Promise<BedrockInvoker> {
  const env = config.get('env') as EnvironmentProfile;

  if (env === 'LOCAL_MOCK') {
    return new MockBedrockAdapter();
  }

  // 動態 import 確保 CI / LOCAL_MOCK 下完全不載入 AWS SDK
  const { BedrockAdapter } = await import('./bedrock_adapter.js');
  return new BedrockAdapter(config);
}
