/**
 * channels — 模擬 CMS/SMS 發布通道 + 一鍵複製/匯出 (TASK-146)
 *
 * 職責（§10.17, §12）：
 * - 模擬 CMS（電子看板）發布通道：記錄發布行為，不發出實際電信呼叫
 * - 模擬 SMS（簡訊）發布通道：同上
 * - 一鍵複製：產生可供 Dashboard 複製的純文字 payload
 * - 一鍵匯出：產生 JSON 格式的完整發布 payload
 * - channel failure → 回傳 `publish_failed` 理由（呼叫端決定是否 fail 整個發布）
 * - **不**發出任何實際電信 API 呼叫（§17 no-outbound-third-party）
 *
 * 設計限制：
 * - 競賽版 demo-grade：不需真實電信閘道（§10.17）
 * - channels 字串陣列寫入 PublishRecord（由 publish_fn.ts 整合）
 * - 此模組純 domain 邏輯，無 AWS 依賴
 *
 * @module backend/publish/channels
 */

import type { PublishRecord } from '@city-commander/shared-schemas';
import { PublishStatus } from '@city-commander/shared-schemas';

// ─── Channel identifiers ──────────────────────────────────────────────────────

/**
 * 所有支援的發布通道名稱（string enum-like constants）。
 *
 * 寫入 `PublishRecord.channels`，供 Dashboard 顯示已發布的通道清單。
 */
export const CHANNEL = {
  /** 電子看板（CMS）模擬通道 */
  CMS_MOCK: 'CMS_MOCK',
  /** 簡訊（SMS）模擬通道 */
  SMS_MOCK: 'SMS_MOCK',
  /** 一鍵複製（純文字格式） */
  COPY: 'COPY',
  /** 一鍵匯出（JSON 格式） */
  EXPORT_JSON: 'EXPORT_JSON',
} as const;

export type ChannelId = (typeof CHANNEL)[keyof typeof CHANNEL];

// ─── Payload types ────────────────────────────────────────────────────────────

/**
 * 發布 payload 的核心內容。
 *
 * 競賽版從 PublishRecord + cms_core_text 組裝（不依賴完整 DecisionReadModel）。
 * 等 TASK-149 完成後可擴充為 4 source merge。
 */
export interface PublishPayload {
  /** decision_id（唯一識別此次發布） */
  readonly decision_id: string;
  /** 發布時間戳 YYYY-MM-DD HH:MM */
  readonly published_at: string;
  /** 發布者（Cognito actor） */
  readonly published_by: string;
  /** CMS 核心文字（決定性，來自 DecisionCore.cms_core_text） */
  readonly cms_core_text: string;
  /**
   * 多語警示文字（選配，來自 DecisionNarrative PUBLIC_ALERT item）。
   * 競賽版若尚未連接 read model，可為空或設為 pending。
   */
  readonly public_alert_text?: Partial<Record<string, string>>;
  /** 核准者 */
  readonly approved_by?: string;
}

// ─── Channel result ───────────────────────────────────────────────────────────

/**
 * 單一 channel 的執行結果。
 */
export type ChannelResult =
  | { readonly success: true; readonly channelId: ChannelId }
  | { readonly success: false; readonly channelId: ChannelId; readonly reason: string };

/**
 * dispatchChannels 的整體結果。
 */
export interface DispatchChannelsResult {
  /** 成功執行的 channel list（寫入 PublishRecord.channels） */
  readonly succeededChannels: readonly string[];
  /** 失敗的 channel（若 allowPartialSuccess=false 會整體失敗） */
  readonly failedChannels: readonly { readonly channelId: string; readonly reason: string }[];
  /** 本次發布的 payload（供一鍵複製/匯出使用） */
  readonly payload: PublishPayload;
  /** 純文字複製內容 */
  readonly copyText: string;
  /** JSON 匯出內容 */
  readonly exportJson: string;
}

// ─── Payload builder ──────────────────────────────────────────────────────────

/**
 * 從 PublishRecord 和額外資訊組裝 PublishPayload。
 *
 * 競賽版不依賴完整 DecisionReadModel（TASK-149）：
 * - cms_core_text 由呼叫端傳入（來自 DecisionCore 唯讀讀取）
 * - public_alert_text 選配，等 TASK-149 完成後可填充
 *
 * @param record - 已達 `published` 狀態的 PublishRecord
 * @param cmsCoreText - 決定性 CMS 文字（來自 DecisionCore.cms_core_text）
 * @param publicAlertText - 多語警示文字（選配）
 */
export function buildPublishPayload(
  record: PublishRecord,
  cmsCoreText: string,
  publicAlertText?: Partial<Record<string, string>>,
): PublishPayload {
  return {
    decision_id: record.decision_id,
    published_at: record.updated_at,
    published_by: record.published_by ?? record.approved_by ?? 'unknown',
    cms_core_text: cmsCoreText,
    ...(publicAlertText && { public_alert_text: publicAlertText }),
    ...(record.approved_by && { approved_by: record.approved_by }),
  };
}

// ─── Copy/export formatters ───────────────────────────────────────────────────

/**
 * 產生純文字複製內容（一鍵複製，供 Dashboard clipboard API 使用）。
 *
 * 格式（§10.17 可讀性要求）：
 * ```
 * 【城市應變 AI 指揮台 — 一鍵發布】
 * 發布 ID：{decision_id}
 * 發布時間：{published_at}
 * 發布者：{published_by}
 *
 * [CMS 訊息]
 * {cms_core_text}
 *
 * [多語警示] （如有）
 * zh: ...
 * en: ...
 * ```
 */
export function formatCopyText(payload: PublishPayload): string {
  const lines: string[] = [
    '【城市應變 AI 指揮台 — 一鍵發布】',
    `發布 ID：${payload.decision_id}`,
    `發布時間：${payload.published_at}`,
    `發布者：${payload.published_by}`,
    '',
    '[CMS 訊息]',
    payload.cms_core_text,
  ];

  if (payload.public_alert_text && Object.keys(payload.public_alert_text).length > 0) {
    lines.push('', '[多語警示]');
    for (const [lang, text] of Object.entries(payload.public_alert_text)) {
      if (text) lines.push(`${lang}: ${text}`);
    }
  }

  return lines.join('\n');
}

/**
 * 產生 JSON 匯出內容（一鍵匯出，供 Dashboard 下載）。
 */
export function formatExportJson(payload: PublishPayload): string {
  return JSON.stringify(payload, null, 2);
}

// ─── Mock channel simulators ──────────────────────────────────────────────────

/**
 * 模擬 CMS（電子看板）發布。
 *
 * 競賽版：記錄 CMS 訊息到日誌（不發實際 API 呼叫）。
 * 生產版：可替換為真實 CMS API 呼叫。
 *
 * @param payload - 發布 payload
 * @param logger - 選配的 logger（預設 console.log）
 */
function simulateCmsChannel(
  payload: PublishPayload,
  logger: (msg: string) => void = console.log,
): ChannelResult {
  try {
    logger(
      `[CMS_MOCK] 發布至電子看板 | decision_id=${payload.decision_id} | ` +
        `cms_text="${payload.cms_core_text}" | at=${payload.published_at}`,
    );
    return { success: true, channelId: CHANNEL.CMS_MOCK };
  } catch (err) {
    return {
      success: false,
      channelId: CHANNEL.CMS_MOCK,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

/**
 * 模擬 SMS（簡訊）發布。
 *
 * 競賽版：記錄 SMS 訊息到日誌（不發實際電信呼叫）。
 * 生產版：可替換為 AWS SNS / 真實電信 API。
 */
function simulateSmsChannel(
  payload: PublishPayload,
  logger: (msg: string) => void = console.log,
): ChannelResult {
  try {
    // SMS 通常比 CMS 更短，取前 160 字元
    const smsText = payload.cms_core_text.slice(0, 160);
    logger(
      `[SMS_MOCK] 發布簡訊 | decision_id=${payload.decision_id} | ` +
        `sms_text="${smsText}" | at=${payload.published_at}`,
    );
    return { success: true, channelId: CHANNEL.SMS_MOCK };
  } catch (err) {
    return {
      success: false,
      channelId: CHANNEL.SMS_MOCK,
      reason: err instanceof Error ? err.message : String(err),
    };
  }
}

// ─── Main dispatch function ───────────────────────────────────────────────────

/**
 * dispatchChannels 的輸入參數。
 */
export interface DispatchChannelsInput {
  /** 已達 `published` 狀態的 PublishRecord */
  readonly record: PublishRecord;
  /** 決定性 CMS 文字（來自 DecisionCore.cms_core_text，唯讀讀取） */
  readonly cmsCoreText: string;
  /** 多語警示文字（選配，來自 DecisionNarrative，等 TASK-149 完成後填充） */
  readonly publicAlertText?: Partial<Record<string, string>>;
  /** 選配 logger（測試時可注入 mock） */
  readonly logger?: (msg: string) => void;
}

/**
 * 執行所有發布通道（CMS_MOCK + SMS_MOCK + COPY + EXPORT_JSON）。
 *
 * 呼叫時機：publish_fn.ts 寫入 published 狀態後呼叫，用結果更新 PublishRecord.channels。
 *
 * 通道執行順序：CMS_MOCK → SMS_MOCK → COPY → EXPORT_JSON
 *
 * 此函式**不**直接寫 DynamoDB，channels 由呼叫端附加至 PublishRecord 後再寫入。
 *
 * @returns DispatchChannelsResult（succeededChannels 寫入 PublishRecord.channels）
 */
export function dispatchChannels(input: DispatchChannelsInput): DispatchChannelsResult {
  const { record, cmsCoreText, publicAlertText, logger } = input;

  // 防禦：只在 published 狀態時執行通道（呼叫端應保證，但此處二次確認）
  if (record.publish_state !== PublishStatus.published) {
    return {
      succeededChannels: [],
      failedChannels: [
        {
          channelId: 'ALL',
          reason: `dispatchChannels 只應在 published 狀態下呼叫，當前狀態為 ${record.publish_state}。`,
        },
      ],
      payload: buildPublishPayload(record, cmsCoreText, publicAlertText),
      copyText: '',
      exportJson: '',
    };
  }

  const payload = buildPublishPayload(record, cmsCoreText, publicAlertText);
  const copyText = formatCopyText(payload);
  const exportJson = formatExportJson(payload);

  // 執行各 channel
  const results: ChannelResult[] = [
    simulateCmsChannel(payload, logger),
    simulateSmsChannel(payload, logger),
    // COPY 與 EXPORT_JSON 為純產出，不會失敗
    { success: true, channelId: CHANNEL.COPY },
    { success: true, channelId: CHANNEL.EXPORT_JSON },
  ];

  const succeeded = results.filter((r) => r.success).map((r) => r.channelId);
  const failed = results
    .filter((r): r is Extract<ChannelResult, { success: false }> => !r.success)
    .map((r) => ({ channelId: r.channelId, reason: r.reason }));

  return {
    succeededChannels: succeeded,
    failedChannels: failed,
    payload,
    copyText,
    exportJson,
  };
}

/**
 * 判斷 dispatchChannels 結果是否導致 publish_failed。
 *
 * 規則：
 * - `allowPartialSuccess=true`（預設）：只要有任一 channel 成功，整體不失敗
 * - `allowPartialSuccess=false`：任一 channel 失敗 → publish_failed
 * - 完全無 succeeded channels → 永遠視為失敗（不管 allowPartialSuccess）
 *
 * @param result - dispatchChannels 的回傳值
 * @param allowPartialSuccess - 是否允許部分成功
 * @returns `{ failed: false }` 或 `{ failed: true; reason: string }`
 */
export function evaluateChannelOutcome(
  result: DispatchChannelsResult,
  allowPartialSuccess = true,
): { readonly failed: false } | { readonly failed: true; readonly reason: string } {
  if (result.succeededChannels.length === 0) {
    const reasons = result.failedChannels.map((f) => `${f.channelId}: ${f.reason}`).join('; ');
    return { failed: true, reason: `所有發布通道均失敗：${reasons}` };
  }

  if (!allowPartialSuccess && result.failedChannels.length > 0) {
    const reasons = result.failedChannels.map((f) => `${f.channelId}: ${f.reason}`).join('; ');
    return { failed: true, reason: `部分發布通道失敗：${reasons}` };
  }

  return { failed: false };
}
