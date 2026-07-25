import * as fc from 'fast-check';
import { describe, expect } from 'vitest';
import { renderApprovedMultilingualFallback } from '../../src/content/multilingual_template_renderer.js';
import { propertyTest } from '../helpers/pbt-helper.js';

describe('Multilingual fallback properties', () => {
  /** Validates: Requirements REQ-010, REQ-019 */
  propertyTest(36, 'Bedrock failure preserves the multilingual language floor with approved templates', fc.record({ bonus: fc.boolean(), delay: fc.integer({ min: 0, max: 300 }) }), ({ bonus, delay }) => {
    const result = renderApprovedMultilingualFallback({ location: 'L', primary_evacuation: 'R', delay_minutes: delay, timestamp_display: '2026-05-20 22:10' }, true, bonus);
    expect(result.fallback_used).toBe(true); expect(result.languages).toContain('zh'); expect(result.languages).toContain('en');
    expect(result.languages.length).toBe(bonus ? 4 : 2); for (const language of result.languages) expect(result.text[language]).toContain(String(delay));
  });
});
