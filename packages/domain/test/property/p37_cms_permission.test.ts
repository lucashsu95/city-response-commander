import * as fc from 'fast-check';
import { describe, expect } from 'vitest';
import { validateNarrativePatch } from '../../src/content/decision_content.js';
import { propertyTest } from '../helpers/pbt-helper.js';

describe('CMS permission properties', () => {
  /** Validates: Requirements REQ-015 */
  propertyTest(37, 'renderer may write CMS explanation but never deterministic CMS core', fc.string(), (text) => {
    expect(validateNarrativePatch({ cms_explanation_text: text })).toEqual({ ok: true, rejected_fields: [] });
    expect(validateNarrativePatch({ cms_core_text: text })).toEqual({ ok: false, rejected_fields: ['cms_core_text'] });
  });
});
