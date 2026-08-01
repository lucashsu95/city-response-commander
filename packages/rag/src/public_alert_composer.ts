/**
 * PublicAlertComposer — 多語化民眾警示生成器 (TASK-114)
 *
 * 職責（§10.11b, §14.4, competition_quality_floor）：
 * - 讀取 DecisionCore 的決定性多語觸發結果（`multilingual_required`，LLM-prohibited）
 * - 依語言下限決定語言集合（deterministic，不由 LLM 決定）：
 *   - 未觸發 SOP-6 → 只產 `zh`
 *   - 觸發 SOP-6   → 至少 `zh` + `en`
 *   - 觸發 SOP-6 且 bonus 啟用 → `zh` + `en` + `ja` + `ko`
 * - 同一 Bedrock 回應內產出所有語言（不分次呼叫）
 * - SchemaValidator 確保 LLM 只填 `public_alert_text` 語言 map（物件，每個 value 為 string）
 * - Bedrock 失敗 → 決定性多語 template fallback（絕不退化為只有 zh）
 * - 呼叫 `putNarrative` 寫入 PUBLIC_ALERT item（conditional Put）
 *
 * 界線（§9）：
 * - `multilingual_required`（sop6_triggered）和 `languages` 由決定性程式碼決定，LLM-prohibited
 * - LLM 只能生成 `public_alert_text` map 的文字值
 * - 語言集合計算在本模組內完成，不依賴 LLM
 *
 * @module rag/public_alert_composer
 */

import {
  NarrativeType,
  Language,
  type DecisionCore,
  type PublicAlertPayload,
} from '@city-commander/shared-schemas';
import { requiredAlertLanguages, type SupportedLanguage } from '@city-commander/domain';
import { validateBedrockPayload } from './schema_validator.js';
import {
  putNarrative,
  buildReadyEventId,
  type NarrativeTableClient,
  type NarrativePutResult,
} from './narrative_writer.js';
import type { BedrockInvoker } from './bedrock_adapter.js';
import { renderMultilingualTemplates, formatEteForAlert } from './multilingual_templates.js';

// ─── Language floor logic ─────────────────────────────────────────────────────

/**
 * `domain` 的 `SupportedLanguage`（字串）→ shared-schemas 的 `Language` enum。
 *
 * 兩者的值域相同（'zh' | 'en' | 'ja' | 'ko'），此表只做型別轉換，
 * 不參與任何「哪些語言該出現」的判斷。
 */
const DOMAIN_LANGUAGE_TO_ENUM: Record<SupportedLanguage, Language> = {
  zh: Language.ZH,
  en: Language.EN,
  ja: Language.JA,
  ko: Language.KO,
};

/**
 * 依 sop6_triggered 與 bonus flag 決定語言集合。
 *
 * ⚠️ 語言下限是**決定性真值**（§14.4 的下限表、LLM-prohibited），
 * 因此一律委派 `domain` 的 `requiredAlertLanguages()`——
 * 這裡不得再複製一份下限規則。
 * 本模組原本自行維護 LANGUAGES_BASE / SOP6 / BONUS 三個常數，
 * 與 `domain/content/multilingual_template_renderer.ts` 的規則一字不差，
 * 屬於兩個 owner 各持一份真值；修改 SOP-6 下限時必然漏掉一邊。
 *
 * 對照表（由 domain 保證）：
 * - SOP-6 未觸發：僅 zh
 * - SOP-6 觸發：zh + en
 * - SOP-6 觸發且 bonus 啟用：zh + en + ja + ko
 *
 * @internal 僅供 `composePublicAlert` 使用；匯出是為了方便測試。
 *   外部呼叫端應確保傳入的 sop6Triggered 來自 `core.multilingual_required`，
 *   而非任意值，以維持「語言集合為決定性真值」的語意保證。
 */
export function resolveLanguages(
  sop6Triggered: boolean,
  bonusEnabled: boolean,
): readonly Language[] {
  return requiredAlertLanguages(sop6Triggered, bonusEnabled).map(
    (lang) => DOMAIN_LANGUAGE_TO_ENUM[lang],
  );
}

// ─── Input / Output types ─────────────────────────────────────────────────────

/**
 * `composePublicAlert()` 所需的輸入。
 *
 * - `core`：已提交的 DecisionCore（read-only；`multilingual_required` 為 LLM-prohibited）
 * - `bonusLanguagesEnabled`：是否啟用 ja/ko 加分語言（從 config `multilingual.bonus_languages_enabled` 讀取）
 * - `narrativeClient`：NarrativeTableClient
 * - `bedrockInvoker`：BedrockInvoker
 */
export interface PublicAlertComposerInput {
  readonly core: DecisionCore;
  readonly bonusLanguagesEnabled: boolean;
  readonly narrativeClient: NarrativeTableClient;
  readonly bedrockInvoker: BedrockInvoker;
}

/** `composePublicAlert()` 成功（首次或重試安全） */
export interface PublicAlertComposeSuccess {
  readonly outcome: 'committed' | 'branch_already_completed';
  /**
   * Dashboard dedup key（`decision_id|public_alert.ready|core_version_ref`）。
   * 供上層推送 `public_alert.ready` WebSocket 事件使用。
   */
  readonly ready_event_id: string;
  /** 實際寫入的語言集合（LLM-prohibited，由決定性程式碼決定） */
  readonly languages: readonly Language[];
  /** 文字來源 */
  readonly text_source: 'bedrock' | 'template';
}

/** `composePublicAlert()` 底層 DDB 錯誤 */
export interface PublicAlertComposeFailed {
  readonly outcome: 'failed';
  readonly error: string;
}

export type PublicAlertComposeResult = PublicAlertComposeSuccess | PublicAlertComposeFailed;

// ─── Main function ────────────────────────────────────────────────────────────

/**
 * 生成多語化民眾警示並寫入 DecisionNarrativeTable 的 PUBLIC_ALERT item。
 *
 * 流程（§14.4, Figure 11）：
 * ```
 * resolveLanguages(sop6_triggered, bonusEnabled)  ← LLM-prohibited
 *   → buildPublicAlertPrompt(core, languages)
 *   → BedrockInvoker.invoke()  ← 同一回應產出所有語言
 *     ↓ success → JSON.parse（非 JSON → warn + fallback）
 *       → validateBedrockPayload(PUBLIC_ALERT, raw)
 *         ↓ accepted    → use validation.alertTextMap（語言 map，每個 value 為 string）
 *                          只保留 requiredLanguages 內的語言（LLM 不可增加語言）
 *         ↓ use_template → buildTemplatePublicAlert(core, languages)
 *     ↓ use_template → buildTemplatePublicAlert(core, languages)
 *   → putNarrative(PUBLIC_ALERT, ...)
 * ```
 */
export async function composePublicAlert(
  input: PublicAlertComposerInput,
): Promise<PublicAlertComposeResult> {
  const { core, bonusLanguagesEnabled, narrativeClient, bedrockInvoker } = input;

  // ── 1. 決定語言集合（LLM-prohibited，deterministic）────────────────────
  const languages = resolveLanguages(core.multilingual_required, bonusLanguagesEnabled);

  // ── 2. Invoke Bedrock（同一回應產出所有語言）───────────────────────────
  const prompt = buildPublicAlertPrompt(core, languages);
  const bedrockResult = await bedrockInvoker.invoke(prompt);

  let alertPayload: PublicAlertPayload;
  let textSource: 'bedrock' | 'template';

  if (bedrockResult.outcome === 'success') {
    // ── 3. Parse Bedrock text as JSON ──────────────────────────────────────
    let rawParsed: unknown = null;
    try {
      rawParsed = JSON.parse(bedrockResult.text);
    } catch {
      console.warn(
        '[PublicAlertComposer] Bedrock returned non-JSON text; falling back to template.',
        { decision_id: core.decision_id, model: bedrockResult.usedModelId },
      );
    }

    // ── 4. SchemaValidator：PUBLIC_ALERT 的 public_alert_text 為語言 map ─
    const validation = validateBedrockPayload(NarrativeType.PUBLIC_ALERT, rawParsed);

    if (validation.outcome === 'accepted' && validation.alertTextMap !== undefined) {
      // 只保留 requiredLanguages 內的語言（LLM 不可增加語言，LLM-prohibited）
      const filteredMap = filterToRequiredLanguages(validation.alertTextMap, languages);

      if (filteredMap !== null) {
        alertPayload = { type: 'PUBLIC_ALERT', public_alert_text: filteredMap };
        textSource = 'bedrock';
      } else {
        // 必要語言有缺漏 → fallback
        alertPayload = renderMultilingualTemplates({ core, languages });
        textSource = 'template';
      }
    } else {
      alertPayload = renderMultilingualTemplates({ core, languages });
      textSource = 'template';
    }
  } else {
    alertPayload = renderMultilingualTemplates({ core, languages });
    textSource = 'template';
  }

  // ── 5. putNarrative → PUBLIC_ALERT item conditional Put ───────────────
  let putResult: NarrativePutResult;
  try {
    putResult = await putNarrative(
      narrativeClient,
      core.decision_id,
      NarrativeType.PUBLIC_ALERT,
      core.version,
      alertPayload,
    );
  } catch (err) {
    return {
      outcome: 'failed',
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const ready_event_id = buildReadyEventId(
    core.decision_id,
    NarrativeType.PUBLIC_ALERT,
    core.version,
  );

  return { outcome: putResult.outcome, ready_event_id, languages, text_source: textSource };
}

// ─── Prompt builder ───────────────────────────────────────────────────────────

/**
 * 組裝多語化民眾警示的 Bedrock prompt。
 * 明確要求 Bedrock 在同一回應內產出所有語言（§14.4）。
 * 語言集合由決定性程式碼傳入，Bedrock 無法改變。
 * ETE 格式化委派給 `formatEteForAlert`（multilingual_templates）。
 */
function buildPublicAlertPrompt(core: DecisionCore, languages: readonly Language[]): string {
  const primaryRoute = core.primary_evacuation ?? '（查無合規替代路段）';
  const languageNames: Record<Language, string> = {
    [Language.ZH]: '繁體中文',
    [Language.EN]: 'English',
    [Language.JA]: '日本語',
    [Language.KO]: '한국어',
  };
  const requiredKeys = languages.map((l) => `"${l}"`).join(', ');
  const eteText = formatEteForAlert(core);

  return `你是城市交通應變 AI 指揮台的民眾警示生成模組。請依下列事實，**在同一回應內**產出所有指定語言的民眾警示簡訊。

## 事件資訊（決定性事實，不可改動）
- 事件時間：${core.occurred_at}
- 主要封閉路段：${primaryRoute}
- CMS 核心訊息：${core.cms_core_text}
${eteText ? `- ${eteText}` : ''}

## 指示
請回傳一個 JSON 物件，格式如下：
{
  "public_alert_text": {
    ${languages.map((l) => `"${l}": "<${languageNames[l]}警示文字>"`).join(',\n    ')}
  }
}

必須包含的語言鍵：${requiredKeys}

每種語言的警示文字必須包含：
1. 事故位置與封閉路段
2. 改道指引（主疏散路段：${primaryRoute}）
3. 預計延誤時間${eteText ? `（${eteText}）` : ''}
4. 避險或求援提醒

禁止事項：
- 不可改動路段名稱或 ETE 數值
- 不可虛構路段或指引
- 不可回傳 public_alert_text 以外的任何欄位
- 不可只回傳部分語言（必須包含 ${requiredKeys}）`;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * 從 Bedrock alertTextMap 中只保留決定性語言集合內的語言。
 *
 * LLM 不可增加語言（LLM-prohibited）。
 * 若任何必要語言缺漏或值為空，回傳 null 讓呼叫端走 template fallback。
 */
function filterToRequiredLanguages(
  alertTextMap: Readonly<Record<string, string>>,
  requiredLanguages: readonly Language[],
): Partial<Record<Language, string>> | null {
  const result: Partial<Record<Language, string>> = {};

  for (const lang of requiredLanguages) {
    const value = alertTextMap[lang];
    if (typeof value !== 'string' || value.trim() === '') {
      return null; // 必要語言缺漏 → fallback
    }
    result[lang] = value;
  }

  return result;
}
