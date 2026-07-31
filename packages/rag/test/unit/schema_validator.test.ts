/**
 * SchemaValidator — unit tests (TASK-111)
 *
 * 驗證 §9 boundary enforcement：
 * - LLM-prohibited field 觸發全拒
 * - 非白名單欄位觸發全拒
 * - REPORT / EXPLANATION：值必須是 string
 * - PUBLIC_ALERT：public_alert_text 必須是語言 map（物件，每個 value 非空 string）
 * - 通過時只回傳白名單欄位（strip 多餘 key）
 */

import { describe, it, expect } from 'vitest';
import { validateBedrockPayload } from '../../src/schema_validator.js';
import { NarrativeType } from '@city-commander/shared-schemas';

// ─── REPORT ────────────────────────────────────────────────────────────────

describe('validateBedrockPayload — REPORT', () => {
  it('accepts valid report_text', () => {
    const result = validateBedrockPayload(NarrativeType.REPORT, {
      report_text: '建議書內容',
    });
    expect(result.outcome).toBe('accepted');
    if (result.outcome === 'accepted') {
      expect(result.fields['report_text']).toBe('建議書內容');
    }
  });

  it('accepts all three whitelisted fields', () => {
    const result = validateBedrockPayload(NarrativeType.REPORT, {
      report_text: 'text',
      cms_explanation_text: 'cms',
      citations_presentation: 'cite',
    });
    expect(result.outcome).toBe('accepted');
    if (result.outcome === 'accepted') {
      expect(result.fields['report_text']).toBe('text');
      expect(result.fields['cms_explanation_text']).toBe('cms');
      expect(result.fields['citations_presentation']).toBe('cite');
    }
  });

  it('rejects if report_text value is number', () => {
    const result = validateBedrockPayload(NarrativeType.REPORT, { report_text: 42 });
    expect(result.outcome).toBe('use_template');
    if (result.outcome === 'use_template') {
      expect(result.reason).toBe('non_string_value');
    }
  });

  it('rejects on LLM-prohibited field: decision_id', () => {
    const result = validateBedrockPayload(NarrativeType.REPORT, {
      report_text: 'ok',
      decision_id: 'injected',
    });
    expect(result.outcome).toBe('use_template');
    if (result.outcome === 'use_template') {
      expect(result.reason).toBe('prohibited_field_overwrite');
      expect(result.offendingFields).toContain('decision_id');
    }
  });

  it('rejects on LLM-prohibited field: primary_evacuation', () => {
    const result = validateBedrockPayload(NarrativeType.REPORT, {
      report_text: 'ok',
      primary_evacuation: 'RD_TPE_004',
    });
    expect(result.outcome).toBe('use_template');
    if (result.outcome === 'use_template') {
      expect(result.reason).toBe('prohibited_field_overwrite');
    }
  });

  it('rejects on non-whitelisted field', () => {
    const result = validateBedrockPayload(NarrativeType.REPORT, {
      report_text: 'ok',
      extra_field: 'sneaky',
    });
    expect(result.outcome).toBe('use_template');
    if (result.outcome === 'use_template') {
      expect(result.reason).toBe('non_whitelisted_field');
    }
  });

  it('rejects non-object input (string)', () => {
    const result = validateBedrockPayload(NarrativeType.REPORT, 'plain text');
    expect(result.outcome).toBe('use_template');
    if (result.outcome === 'use_template') {
      expect(result.reason).toBe('not_a_plain_object');
    }
  });

  it('rejects null input', () => {
    const result = validateBedrockPayload(NarrativeType.REPORT, null);
    expect(result.outcome).toBe('use_template');
  });

  it('rejects array input', () => {
    const result = validateBedrockPayload(NarrativeType.REPORT, [{ report_text: 'x' }]);
    expect(result.outcome).toBe('use_template');
  });

  it('strips extra whitelisted keys that are absent from payload (empty object ok)', () => {
    // empty object → accepted with empty fields (no required field)
    const result = validateBedrockPayload(NarrativeType.REPORT, {});
    expect(result.outcome).toBe('accepted');
    if (result.outcome === 'accepted') {
      expect(result.fields).toEqual({});
    }
  });
});

// ─── EXPLANATION ────────────────────────────────────────────────────────────

describe('validateBedrockPayload — EXPLANATION', () => {
  it('accepts valid explanation_text', () => {
    const result = validateBedrockPayload(NarrativeType.EXPLANATION, {
      explanation_text: '決策解釋',
    });
    expect(result.outcome).toBe('accepted');
    if (result.outcome === 'accepted') {
      expect(result.fields['explanation_text']).toBe('決策解釋');
    }
  });

  it('rejects report_text in EXPLANATION (non-whitelisted)', () => {
    const result = validateBedrockPayload(NarrativeType.EXPLANATION, {
      explanation_text: 'ok',
      report_text: 'injected',
    });
    expect(result.outcome).toBe('use_template');
    if (result.outcome === 'use_template') {
      expect(result.reason).toBe('non_whitelisted_field');
    }
  });

  it('rejects LLM-prohibited field: ete', () => {
    const result = validateBedrockPayload(NarrativeType.EXPLANATION, {
      explanation_text: 'ok',
      ete: 99,
    });
    expect(result.outcome).toBe('use_template');
    if (result.outcome === 'use_template') {
      expect(result.reason).toBe('prohibited_field_overwrite');
    }
  });
});

// ─── PUBLIC_ALERT ──────────────────────────────────────────────────────────

describe('validateBedrockPayload — PUBLIC_ALERT', () => {
  it('accepts valid language map', () => {
    const result = validateBedrockPayload(NarrativeType.PUBLIC_ALERT, {
      public_alert_text: { zh: '中文警示', en: 'English alert' },
    });
    expect(result.outcome).toBe('accepted');
    if (result.outcome === 'accepted') {
      expect(result.alertTextMap?.['zh']).toBe('中文警示');
      expect(result.alertTextMap?.['en']).toBe('English alert');
      // fields 為空（PUBLIC_ALERT 無其他 string 欄位）
      expect(result.fields).toEqual({});
    }
  });

  it('rejects when public_alert_text is a string (not a map)', () => {
    const result = validateBedrockPayload(NarrativeType.PUBLIC_ALERT, {
      public_alert_text: '直接字串',
    });
    expect(result.outcome).toBe('use_template');
    if (result.outcome === 'use_template') {
      expect(result.reason).toBe('public_alert_text_map_invalid');
    }
  });

  it('rejects when a language value is empty string', () => {
    const result = validateBedrockPayload(NarrativeType.PUBLIC_ALERT, {
      public_alert_text: { zh: '', en: 'ok' },
    });
    expect(result.outcome).toBe('use_template');
    if (result.outcome === 'use_template') {
      expect(result.reason).toBe('public_alert_text_map_invalid');
    }
  });

  it('rejects when a language value is number', () => {
    const result = validateBedrockPayload(NarrativeType.PUBLIC_ALERT, {
      public_alert_text: { zh: 123 },
    });
    expect(result.outcome).toBe('use_template');
  });

  it('rejects LLM-prohibited field alongside public_alert_text', () => {
    const result = validateBedrockPayload(NarrativeType.PUBLIC_ALERT, {
      public_alert_text: { zh: '警示' },
      cms_core_text: 'injected',
    });
    expect(result.outcome).toBe('use_template');
    if (result.outcome === 'use_template') {
      expect(result.reason).toBe('prohibited_field_overwrite');
    }
  });
});
