/**
 * MockBedrockAdapter — LOCAL_MOCK 環境下的零 AWS 替代品 (TASK-112)
 *
 * 職責（§23, competition_quality_floor）：
 * - 在 LOCAL_MOCK / CI 環境下完全不發送任何 AWS 請求
 * - 回傳**合法 JSON**，讓 composers 的「Bedrock accepted」路徑在本地被真正走過
 * - 介面與 BedrockAdapter 完全相同（同實作 BedrockInvoker）
 *
 * ⚠️ 為什麼要回傳合法 JSON：
 * 舊版固定回傳一段純文字，所有 composer 的 `JSON.parse` 都會失敗 →
 * 每次都走 template fallback。後果有兩個：
 * (1) LOCAL_MOCK 下 Dashboard 永遠顯示「（本報告由決定性模板產生，Bedrock 不可用）」
 * (2) SchemaValidator 通過後的分支從來沒有在本地被執行過，
 *     等於把整條 accepted 路徑留到上雲才第一次跑
 *
 * 邊界（§9）：mock 只填**允許的文字欄位**。
 * 它不會、也不能產生 ETE、分級、SOP 觸發結果等 LLM-prohibited 欄位——
 * 就算它嘗試，SchemaValidator 也會擋下來。
 *
 * @module rag/mock_bedrock_adapter
 */

import type { ConfigProvider, EnvironmentProfile } from '@city-commander/config';
import type { BedrockInvoker, BedrockInvokeOptions, BedrockResult } from './bedrock_adapter.js';

// ─── Mock 文字前綴 ──────────────────────────────────────────────────────────

/**
 * 所有 mock 生成文字的前綴。
 *
 * 讓任何看到這段文字的人（開發者、Demo 觀眾、測試斷言）
 * 立刻知道它不是真的 Bedrock 輸出。
 */
const MOCK_PREFIX = '[MOCK-BEDROCK]';

// ─── Prompt → 回應形狀的判別 ────────────────────────────────────────────────

/**
 * 依 prompt 內容判斷呼叫端要的是哪一種 payload。
 *
 * 判別依據是各 composer prompt 中「請回傳 JSON，只包含以下欄位」所列的欄位名，
 * 這些名稱同時也是 SchemaValidator 的白名單鍵，因此判別與驗證天然對齊。
 *
 * 順序有意義：REPORT 的 prompt 同時提到 report_text 與 cms_explanation_text，
 * 因此先比對更專屬的鍵。
 */
type MockShape = 'public_alert' | 'explanation' | 'report' | 'scenario_parser' | 'unknown';

function detectShape(prompt: string): MockShape {
  if (prompt.includes('public_alert_text')) return 'public_alert';
  if (prompt.includes('"assumptions"')) return 'scenario_parser';
  if (prompt.includes('report_text')) return 'report';
  if (prompt.includes('explanation_text')) return 'explanation';
  return 'unknown';
}

/**
 * 從 PUBLIC_ALERT prompt 中抽出被要求的語言鍵。
 *
 * 語言集合是決定性真值（`resolveLanguages` 決定，LLM-prohibited），
 * mock 只是照抄 prompt 要求的語言，不自行增減——
 * 與真實 Bedrock 應有的行為一致，也讓
 * `filterToRequiredLanguages` 的過濾邏輯在本地被走到。
 */
function extractRequestedLanguages(prompt: string): readonly string[] {
  const found = new Set<string>();
  for (const match of prompt.matchAll(/"(zh|en|ja|ko)"/g)) {
    found.add(match[1]);
  }
  // 找不到時退回 zh：語言下限至少含 zh，不會產生空 map
  return found.size > 0 ? [...found] : ['zh'];
}

/** 依 shape 組裝合法的 mock JSON 回應 */
function buildMockResponse(prompt: string): string {
  switch (detectShape(prompt)) {
    case 'public_alert': {
      const languages = extractRequestedLanguages(prompt);
      const textByLang: Record<string, string> = {};
      for (const lang of languages) {
        textByLang[lang] = `${MOCK_PREFIX} (${lang}) 模擬民眾警示文字，實際內容由 Bedrock 生成。`;
      }
      return JSON.stringify({ public_alert_text: textByLang });
    }

    case 'report':
      return JSON.stringify({
        report_text:
          `${MOCK_PREFIX} 模擬交控中心建議書。所有數值、路線與 SOP 觸發結果均來自` +
          '決定性引擎，本段僅為措辭示範。',
        cms_explanation_text: `${MOCK_PREFIX} 模擬 CMS 補充說明（不改動 cms_core_text）。`,
      });

    case 'explanation':
      return JSON.stringify({
        explanation_text:
          `${MOCK_PREFIX} 模擬決策解釋。分級、ETE 與路線選擇皆由決定性引擎產生，` +
          '本段僅解釋這些既有事實。',
      });

    case 'scenario_parser':
      // What-if stage 1 是真正的自然語言解析，mock 不假裝做得到。
      // 回 clarification 讓 §14.5「不猜測」的路徑在本地被走到。
      return JSON.stringify({
        status: 'clarification_required',
        reason: `${MOCK_PREFIX} LOCAL_MOCK 不進行自然語言解析，請在 AWS 環境測試 What-if 問句。`,
      });

    case 'unknown':
    default:
      // 未知 prompt 形狀 → 回一個不含任何白名單欄位的物件，
      // 讓呼叫端走 SchemaValidator 拒絕 → template fallback 的路徑。
      return JSON.stringify({ mock_note: `${MOCK_PREFIX} unrecognized prompt shape` });
  }
}

// ─── MockBedrockAdapter ────────────────────────────────────────────────────

/**
 * LOCAL_MOCK 環境的 Bedrock adapter。
 *
 * - 永遠回傳 `outcome: 'success'`，內容為依 prompt 形狀組裝的合法 JSON
 * - 完全不 import 或呼叫 @aws-sdk/client-bedrock-runtime
 * - 供 composers 在 CI / LOCAL_MOCK 下注入使用
 *
 * 要測試 Bedrock **失敗**的降級路徑，請注入回傳 `use_template` 的 stub，
 * 不要依賴本 adapter。
 */
export class MockBedrockAdapter implements BedrockInvoker {
  // usedModelId 固定為 'mock'，方便測試斷言
  private static readonly MOCK_MODEL_ID = 'mock';

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async invoke(prompt: string, _opts?: BedrockInvokeOptions): Promise<BedrockResult> {
    return {
      outcome: 'success',
      text: buildMockResponse(prompt),
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
