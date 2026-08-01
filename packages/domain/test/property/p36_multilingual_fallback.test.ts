import * as fc from 'fast-check';
import { describe, expect } from 'vitest';
import { requiredAlertLanguages } from '../../src/content/multilingual_template_renderer.js';
import { propertyTest } from '../helpers/pbt-helper.js';

describe('Multilingual fallback properties', () => {
  /**
   * Validates: Requirements REQ-010, REQ-019
   *
   * This tests the deterministic language-floor decision only (never zh-only
   * once SOP-6 is triggered). Template text rendering for the Bedrock-failure
   * path is real production code owned by `packages/rag/src/multilingual_templates.ts`
   * and is covered there (see its own Property 36 test).
   */
  propertyTest(36, 'SOP-6 trigger preserves the multilingual language floor regardless of bonus languages', fc.boolean(), (bonus) => {
    const languages = requiredAlertLanguages(true, bonus);
    expect(languages).toContain('zh');
    expect(languages).toContain('en');
    expect(languages.length).toBe(bonus ? 4 : 2);
  });
});
