/**
 * audit_trail 與 channels 測試 (TASK-146, TASK-147, TASK-152)
 *
 * - audit_trail：append-only、actor 記錄、approved_by/published_by、完整性檢查
 * - channels：payload 組裝、一鍵複製/匯出、模擬通道、失敗判定
 *
 * @module backend/test/publish/audit_trail_and_channels
 */

import { describe, it, expect } from 'vitest';
import type { PublishRecord } from '@city-commander/shared-schemas';
import { PublishStatus } from '@city-commander/shared-schemas';
import {
  appendAuditEntry,
  buildAuditEntry,
  formatAuditTimestamp,
  validateAuditTrailIntegrity,
} from '../../src/publish/audit_trail.js';
import {
  CHANNEL,
  buildPublishPayload,
  formatCopyText,
  formatExportJson,
  dispatchChannels,
  evaluateChannelOutcome,
} from '../../src/publish/channels.js';

const DECISION_ID = 'DEC_AUDIT_001';
const APPROVER = 'cognito-sub-approver';
const PUBLISHER = 'cognito-sub-publisher';

// ─── audit_trail ──────────────────────────────────────────────────────────────

describe('formatAuditTimestamp', () => {
  it('輸出 YYYY-MM-DD HH:MM（UTC，§10.17 格式）', () => {
    expect(formatAuditTimestamp(new Date(Date.UTC(2026, 4, 20, 22, 10, 45)))).toBe(
      '2026-05-20 22:10',
    );
  });

  it('個位數月/日/時/分補零', () => {
    expect(formatAuditTimestamp(new Date(Date.UTC(2026, 0, 2, 3, 4, 0)))).toBe('2026-01-02 03:04');
  });
});

describe('buildAuditEntry', () => {
  it('action 與 to_state 同值，完整記錄 from/to/actor/at', () => {
    const entry = buildAuditEntry(APPROVER, PublishStatus.draft, PublishStatus.approved, '2026-05-20 22:05');
    expect(entry).toEqual({
      actor: APPROVER,
      action: PublishStatus.approved,
      from_state: PublishStatus.draft,
      to_state: PublishStatus.approved,
      at: '2026-05-20 22:05',
    });
  });

  it('首次建立時 from_state 為 null', () => {
    const entry = buildAuditEntry(APPROVER, null, PublishStatus.draft, '2026-05-20 22:00');
    expect(entry.from_state).toBeNull();
  });
});

describe('appendAuditEntry — append-only 與身份記錄', () => {
  function draft(): PublishRecord {
    return appendAuditEntry({
      decisionId: DECISION_ID,
      actor: APPROVER,
      existing: null,
      targetState: PublishStatus.draft,
      failureReason: null,
      now: '2026-05-20 22:00',
    });
  }

  it('首次建立 → version 1、audit_trail 一筆', () => {
    const record = draft();
    expect(record.version).toBe(1);
    expect(record.audit_trail).toHaveLength(1);
    expect(record.publish_state).toBe(PublishStatus.draft);
    expect(record.channels).toEqual([]);
  });

  it('每次轉移 version 遞增且既有 entry 完全保留', () => {
    const d = draft();
    const approved = appendAuditEntry({
      decisionId: DECISION_ID,
      actor: APPROVER,
      existing: d,
      targetState: PublishStatus.approved,
      failureReason: null,
      now: '2026-05-20 22:05',
    });

    expect(approved.version).toBe(2);
    expect(approved.audit_trail).toHaveLength(2);
    // 舊 entry 逐欄位不變（append-only，不可 patch）
    expect(approved.audit_trail[0]).toEqual(d.audit_trail[0]);
  });

  it('不修改傳入的 existing record（純函式）', () => {
    const d = draft();
    const snapshot = JSON.stringify(d);
    appendAuditEntry({
      decisionId: DECISION_ID,
      actor: APPROVER,
      existing: d,
      targetState: PublishStatus.approved,
      failureReason: null,
    });
    expect(JSON.stringify(d)).toBe(snapshot);
  });

  it('approved 記錄 approved_by', () => {
    const approved = appendAuditEntry({
      decisionId: DECISION_ID,
      actor: APPROVER,
      existing: draft(),
      targetState: PublishStatus.approved,
      failureReason: null,
    });
    expect(approved.approved_by).toBe(APPROVER);
    expect(approved.published_by).toBeUndefined();
  });

  it('published 記錄 published_by 並保留前一步的 approved_by（不同人）', () => {
    const approved = appendAuditEntry({
      decisionId: DECISION_ID,
      actor: APPROVER,
      existing: draft(),
      targetState: PublishStatus.approved,
      failureReason: null,
    });
    const published = appendAuditEntry({
      decisionId: DECISION_ID,
      actor: PUBLISHER,
      existing: approved,
      targetState: PublishStatus.published,
      failureReason: null,
    });

    expect(published.approved_by).toBe(APPROVER);
    expect(published.published_by).toBe(PUBLISHER);
  });

  it('publish_failed 記錄 failure_reason', () => {
    const approved = appendAuditEntry({
      decisionId: DECISION_ID,
      actor: APPROVER,
      existing: draft(),
      targetState: PublishStatus.approved,
      failureReason: null,
    });
    const failed = appendAuditEntry({
      decisionId: DECISION_ID,
      actor: PUBLISHER,
      existing: approved,
      targetState: PublishStatus.publish_failed,
      failureReason: 'CMS_MOCK: gateway down',
    });
    expect(failed.failure_reason).toBe('CMS_MOCK: gateway down');
  });

  it('channels 沿用既有值（不被轉移清空）', () => {
    const withChannels: PublishRecord = { ...draft(), channels: ['CMS_MOCK'] };
    const next = appendAuditEntry({
      decisionId: DECISION_ID,
      actor: APPROVER,
      existing: withChannels,
      targetState: PublishStatus.approved,
      failureReason: null,
    });
    expect(next.channels).toEqual(['CMS_MOCK']);
  });
});

describe('validateAuditTrailIntegrity — tamper-evident 檢查', () => {
  function chain(): PublishRecord {
    const d = appendAuditEntry({
      decisionId: DECISION_ID,
      actor: APPROVER,
      existing: null,
      targetState: PublishStatus.draft,
      failureReason: null,
    });
    return appendAuditEntry({
      decisionId: DECISION_ID,
      actor: APPROVER,
      existing: d,
      targetState: PublishStatus.approved,
      failureReason: null,
    });
  }

  it('正常鏈 → valid', () => {
    expect(validateAuditTrailIntegrity(chain())).toEqual({ valid: true });
  });

  it('空 audit_trail → invalid', () => {
    const record: PublishRecord = { ...chain(), audit_trail: [] };
    expect(validateAuditTrailIntegrity(record).valid).toBe(false);
  });

  it('publish_state 與最後一筆 to_state 不一致 → invalid', () => {
    const record: PublishRecord = { ...chain(), publish_state: PublishStatus.published };
    const result = validateAuditTrailIntegrity(record);
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.reason).toContain('publish_state');
  });

  it('鏈條斷裂（中間被抽掉一筆）→ invalid', () => {
    const record = chain();
    const tampered: PublishRecord = {
      ...record,
      audit_trail: [
        record.audit_trail[0],
        {
          ...record.audit_trail[1],
          from_state: PublishStatus.published, // 偽造來源
        },
      ],
    };
    const result = validateAuditTrailIntegrity(tampered);
    expect(result.valid).toBe(false);
    if (result.valid) return;
    expect(result.reason).toContain('鏈斷裂');
  });
});

// ─── channels ─────────────────────────────────────────────────────────────────

describe('channels — payload 與一鍵複製/匯出', () => {
  const publishedRecord: PublishRecord = {
    decision_id: DECISION_ID,
    publish_state: PublishStatus.published,
    channels: [],
    approved_by: APPROVER,
    published_by: PUBLISHER,
    audit_trail: [],
    version: 3,
    updated_at: '2026-05-20 22:15',
  };
  const CMS_TEXT = '忠孝東路封閉，請改道 光復南路，預計延誤 78.6 分鐘';
  const PUBLIC_ALERT_TEXT = { zh: '繁中民眾警示' };

  it('payload 取用決定性 cms_core_text，不改寫', () => {
    const payload = buildPublishPayload(publishedRecord, CMS_TEXT, PUBLIC_ALERT_TEXT);
    expect(payload.cms_core_text).toBe(CMS_TEXT);
    expect(payload.decision_id).toBe(DECISION_ID);
    expect(payload.published_by).toBe(PUBLISHER);
    expect(payload.approved_by).toBe(APPROVER);
    expect(payload.published_at).toBe('2026-05-20 22:15');
  });

  it('一鍵複製包含 CMS 訊息與發布資訊', () => {
    const text = formatCopyText(
      buildPublishPayload(publishedRecord, CMS_TEXT, PUBLIC_ALERT_TEXT),
    );
    expect(text).toContain(CMS_TEXT);
    expect(text).toContain(DECISION_ID);
    expect(text).toContain(PUBLISHER);
  });

  it('一鍵複製在有多語警示時逐語言列出', () => {
    const payload = buildPublishPayload(publishedRecord, CMS_TEXT, {
      zh: '中文警示',
      en: 'English alert',
    });
    const text = formatCopyText(payload);
    expect(text).toContain('zh: 中文警示');
    expect(text).toContain('en: English alert');
  });

  it('一鍵匯出為合法 JSON 且可還原 payload', () => {
    const payload = buildPublishPayload(publishedRecord, CMS_TEXT, PUBLIC_ALERT_TEXT);
    expect(JSON.parse(formatExportJson(payload))).toEqual(payload);
  });
});

describe('dispatchChannels — 模擬通道', () => {
  const publishedRecord: PublishRecord = {
    decision_id: DECISION_ID,
    publish_state: PublishStatus.published,
    channels: [],
    audit_trail: [],
    version: 3,
    updated_at: '2026-05-20 22:15',
  };

  it('published 狀態 → 四個通道全部成功', () => {
    const logs: string[] = [];
    const result = dispatchChannels({
      record: publishedRecord,
      cmsCoreText: 'cms text',
      publicAlertText: { zh: '繁中民眾警示' },
      logger: (m) => logs.push(m),
    });

    expect(result.succeededChannels).toEqual([
      CHANNEL.CMS_MOCK,
      CHANNEL.SMS_MOCK,
      CHANNEL.COPY,
      CHANNEL.EXPORT_JSON,
    ]);
    expect(result.failedChannels).toEqual([]);
    // §17：不得發出任何真實電信呼叫，只留下日誌
    expect(logs.some((m) => m.includes('[CMS_MOCK]'))).toBe(true);
    expect(logs.some((m) => m.includes('[SMS_MOCK]'))).toBe(true);
  });

  it('SMS 內容截斷至 160 字元', () => {
    const logs: string[] = [];
    dispatchChannels({
      record: publishedRecord,
      cmsCoreText: 'CMS 核心文字',
      publicAlertText: { zh: '長'.repeat(500) },
      logger: (m) => logs.push(m),
    });
    const smsLog = logs.find((m) => m.includes('[SMS_MOCK]'))!;
    const smsText = /sms_text="([^"]*)"/.exec(smsLog)![1];
    expect(smsText).toHaveLength(160);
  });

  it('SMS 逐語言發布 PublicAlert，且不使用 CMS 核心文字', () => {
    const logs: string[] = [];
    dispatchChannels({
      record: publishedRecord,
      cmsCoreText: 'CMS 核心文字',
      publicAlertText: {
        zh: '多語 PublicAlert 繁中通報',
        en: 'English public alert',
      },
      logger: (m) => logs.push(m),
    });
    const smsLogs = logs.filter((m) => m.includes('[SMS_MOCK]'));

    expect(smsLogs).toHaveLength(2);
    expect(smsLogs.some((m) => m.includes('language=zh') && m.includes('多語 PublicAlert 繁中通報'))).toBe(true);
    expect(smsLogs.some((m) => m.includes('language=en') && m.includes('English public alert'))).toBe(true);
    expect(smsLogs.every((m) => !m.includes('CMS 核心文字'))).toBe(true);
  });

  it('PublicAlert 無可用文字時 SMS fail-closed，不退回 CMS', () => {
    const logs: string[] = [];
    const result = dispatchChannels({
      record: publishedRecord,
      cmsCoreText: '不可退回的 CMS 核心文字',
      publicAlertText: {},
      logger: (m) => logs.push(m),
    });

    expect(result.failedChannels).toContainEqual({
      channelId: CHANNEL.SMS_MOCK,
      reason: 'PUBLIC_ALERT_NOT_READY',
    });
    expect(logs.some((m) => m.includes('[SMS_MOCK]'))).toBe(false);
  });

  it('非 published 狀態 → 防禦性拒絕，不執行任何通道', () => {
    const result = dispatchChannels({
      record: { ...publishedRecord, publish_state: PublishStatus.approved },
      cmsCoreText: 'cms',
      publicAlertText: { zh: '繁中民眾警示' },
    });
    expect(result.succeededChannels).toEqual([]);
    expect(result.failedChannels[0].channelId).toBe('ALL');
    expect(evaluateChannelOutcome(result).failed).toBe(true);
  });
});

describe('evaluateChannelOutcome', () => {
  const base = {
    payload: {
      decision_id: DECISION_ID,
      published_at: '2026-05-20 22:15',
      published_by: PUBLISHER,
      cms_core_text: 'cms',
      public_alert_text: { zh: '繁中民眾警示' },
    },
    copyText: '',
    exportJson: '',
  };

  it('全部成功 → 不失敗', () => {
    expect(
      evaluateChannelOutcome({ ...base, succeededChannels: ['CMS_MOCK'], failedChannels: [] }),
    ).toEqual({ failed: false });
  });

  it('部分成功（預設允許）→ 不失敗', () => {
    const result = evaluateChannelOutcome({
      ...base,
      succeededChannels: ['CMS_MOCK'],
      failedChannels: [{ channelId: 'SMS_MOCK', reason: 'timeout' }],
    });
    expect(result.failed).toBe(false);
  });

  it('部分成功但 allowPartialSuccess=false → 失敗並列出原因', () => {
    const result = evaluateChannelOutcome(
      {
        ...base,
        succeededChannels: ['CMS_MOCK'],
        failedChannels: [{ channelId: 'SMS_MOCK', reason: 'timeout' }],
      },
      false,
    );
    expect(result.failed).toBe(true);
    if (!result.failed) return;
    expect(result.reason).toContain('SMS_MOCK: timeout');
  });

  it('無任何成功通道 → 一律失敗（不論 allowPartialSuccess）', () => {
    const result = evaluateChannelOutcome({
      ...base,
      succeededChannels: [],
      failedChannels: [{ channelId: 'CMS_MOCK', reason: 'down' }],
    });
    expect(result.failed).toBe(true);
    if (!result.failed) return;
    expect(result.reason).toContain('所有發布通道均失敗');
  });
});
