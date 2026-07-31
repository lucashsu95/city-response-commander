/**
 * multilingual_templates — 決定性多語模板渲染器 (TASK-117)
 *
 * 職責（§14.4, §21.3, §22.1 P36）：
 * - 提供 zh / en / ja / ko 四種語言的已核准警示模板
 * - 當 Bedrock 失敗時，依語言集合渲染 template fallback
 * - 語言下限由外部（resolveLanguages）決定，此模組只負責渲染
 * - 只插入決定性事實（primary_evacuation / ete_minutes / timestamp_display）
 * - 絕不退化為只有 zh：若傳入語言集合含 en，必定產出 en template
 *
 * 設計原則（§9）：
 * - 所有模板字串為決定性程式碼，非 LLM 生成
 * - 不使用任何 LLM，不依賴 Bedrock
 * - 此模組為 pure function，無副作用，無 AWS 依賴
 *
 * ⚠️ 語言純度（P36 的實質要求）：
 * 每個語言的模板**只能**包含該語言的文字。插入的決定性事實若本身帶有
 * 語言（例如 ETE 的「預計延誤 N 分鐘」），必須逐語言在地化；
 * 把中文字串塞進 en/ja/ko 模板，等同於多語通報失效。
 *
 * @module rag/multilingual_templates
 */

import { Language, type PublicAlertPayload } from '@city-commander/shared-schemas';
import type { DecisionCore } from '@city-commander/shared-schemas';

// ─── ETE localization ─────────────────────────────────────────────────────────

/**
 * 各語言的 ETE 措辭。
 *
 * - `computed(minutes)`：ETE 已算出時的句子（不含句尾標點，由模板負責）
 * - `pending`：`insufficient_common_snapshot`（資料不足，需人工確認）時的句子
 *
 * 數值本身由決定性引擎計算，本表只負責「同一個數值在四種語言怎麼說」。
 */
const ETE_PHRASES: Record<Language, { computed: (minutes: number) => string; pending: string }> = {
  [Language.ZH]: {
    computed: (m) => `預計延誤 ${m} 分鐘`,
    pending: '延誤時間待確認',
  },
  [Language.EN]: {
    computed: (m) => `Estimated delay: ${m} minutes`,
    pending: 'Delay time to be confirmed',
  },
  [Language.JA]: {
    computed: (m) => `遅延見込み ${m} 分`,
    pending: '遅延時間は確認中',
  },
  [Language.KO]: {
    computed: (m) => `예상 지연 ${m}분`,
    pending: '지연 시간 확인 중',
  },
};

/**
 * 以指定語言格式化 ETE（供 template 使用）。
 *
 * - `computed` → 該語言的「預計延誤 N 分鐘」
 * - `insufficient_common_snapshot` → 該語言的「延誤時間待確認」
 * - 無 ete → 空字串（呼叫端省略整個句子）
 *
 * 此函式為決定性，不依賴 LLM；回傳值**不含**句尾標點，
 * 由各語言模板依自身標點規則補上。
 */
export function formatEteForLanguage(core: DecisionCore, lang: Language): string {
  if (!core.ete) return '';
  const phrases = ETE_PHRASES[lang];
  if (core.ete.calculation_status === 'computed') {
    return phrases.computed(core.ete.ete_minutes);
  }
  return phrases.pending;
}

/**
 * 以繁體中文格式化 ETE。
 *
 * 供 `public_alert_composer` 組裝**中文 prompt** 時使用
 * （prompt 本身是中文，此處用中文正確）。
 * 模板渲染請改用 `formatEteForLanguage`，避免中文洩漏到其他語言。
 */
export function formatEteForAlert(core: DecisionCore): string {
  return formatEteForLanguage(core, Language.ZH);
}

// ─── Template definitions ─────────────────────────────────────────────────────

/**
 * 組裝單一語言的警示模板字串。
 *
 * 所有模板只插入決定性事實：
 * - `occurred`：`core.occurred_at`
 * - `primaryRoute`：主疏散路段（無時顯示該語言的備援文字）
 * - `eteText`：已在地化的 ETE 句子（空字串代表無 ETE，整句省略）
 *
 * 每個模板都涵蓋 P25 要求的四個元素：
 * 事故位置、改道指引、預計延誤時間、求援/避開提醒。
 *
 * 模板為已核准的固定格式（§21.3）；如需修改需同步更新所有語言。
 */
function renderTemplate(
  lang: Language,
  occurred: string,
  primaryRoute: string,
  eteText: string,
): string {
  switch (lang) {
    case Language.ZH:
      return (
        `【交通警示 ${occurred}】道路封閉，請改道 ${primaryRoute}。` +
        (eteText ? `${eteText}。` : '') +
        `請注意安全，避開事故路段。`
      );
    case Language.EN:
      return (
        `[Traffic Alert ${occurred}] Road closure. Please use alternate route: ${primaryRoute}.` +
        (eteText ? ` ${eteText}.` : '') +
        ` Stay safe and avoid the affected area.`
      );
    case Language.JA:
      return (
        `【交通警報 ${occurred}】道路閉鎖。迂回路：${primaryRoute}。` +
        (eteText ? `${eteText}。` : '') +
        `安全にご注意ください。`
      );
    case Language.KO:
      return (
        `[교통 경보 ${occurred}] 도로 폐쇄. 우회로: ${primaryRoute}.` +
        (eteText ? ` ${eteText}.` : '') +
        ` 안전에 유의하시기 바랍니다.`
      );
    default: {
      // exhaustiveness guard：新增語言 enum 值時，TypeScript 會在此報錯
      const _exhaustive: never = lang;
      throw new Error(`Unsupported language: ${_exhaustive}`);
    }
  }
}

/**
 * 各語言在「查無合規替代路段」時的備援文字。
 *
 * 與 ETE 同理：這是要顯示給民眾看的字，不能四種語言共用中文。
 */
const NO_ROUTE_FALLBACK: Record<Language, string> = {
  [Language.ZH]: '（查無合規替代路段）',
  [Language.EN]: '(no compliant alternate route available)',
  [Language.JA]: '（適合する迂回路なし）',
  [Language.KO]: '(적합한 우회로 없음)',
};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * `renderMultilingualTemplates()` 的輸入。
 *
 * - `core`：已提交的 DecisionCore（read-only）
 * - `languages`：由 `resolveLanguages()` 決定的語言集合（LLM-prohibited）
 */
export interface MultilingualTemplateInput {
  readonly core: DecisionCore;
  readonly languages: readonly Language[];
}

/**
 * 依語言集合渲染決定性多語模板，產出 PUBLIC_ALERT payload。
 *
 * 此函式是 Bedrock 失敗時的決定性 fallback（§21.3）。
 *
 * 保證（P36）：
 * - 若 `languages` 含 `en`，輸出一定含 `en`（絕不退化）
 * - 每種語言的 value 均為非空字串，且**只含該語言的文字**
 * - 只插入 `occurred_at` / `primary_evacuation` / ETE 等決定性事實
 * - 不虛構任何道路名稱或數值
 *
 * @param input - MultilingualTemplateInput（core + languages）
 * @returns PublicAlertPayload，每個 language value 為非空 string
 *
 * @example
 * // SOP-6 triggered, bonus disabled → zh + en
 * const payload = renderMultilingualTemplates({
 *   core,
 *   languages: [Language.ZH, Language.EN],
 * });
 * // payload.public_alert_text.zh !== ''
 * // payload.public_alert_text.en !== ''
 */
export function renderMultilingualTemplates(
  input: MultilingualTemplateInput,
): PublicAlertPayload {
  const { core, languages } = input;
  const occurred = core.occurred_at;

  const alertTextMap: Partial<Record<Language, string>> = {};
  for (const lang of languages) {
    const primaryRoute = core.primary_evacuation ?? NO_ROUTE_FALLBACK[lang];
    alertTextMap[lang] = renderTemplate(
      lang,
      occurred,
      primaryRoute,
      formatEteForLanguage(core, lang),
    );
  }

  return { type: 'PUBLIC_ALERT', public_alert_text: alertTextMap };
}
