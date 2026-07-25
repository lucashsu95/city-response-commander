import * as fc from 'fast-check';
import { describe, expect } from 'vitest';
import { renderApprovedMultilingualFallback } from '../../src/content/multilingual_template_renderer.js';
import { propertyTest } from '../helpers/pbt-helper.js';

describe('Bonus language properties', () => {
  /** Validates: Requirements REQ-031 */
  propertyTest(29, 'triggered bonus alerts include Japanese and Korean in the same response', fc.integer({ min: 0, max: 300 }), (delay) => {
    const result = renderApprovedMultilingualFallback({ location: '台北', primary_evacuation: '仁愛路', delay_minutes: delay, timestamp_display: '2026-05-20 22:10' }, true, true);
    expect(result.languages).toEqual(['zh', 'en', 'ja', 'ko']); expect(result.text.ja).toContain(String(delay)); expect(result.text.ko).toContain(String(delay));
  });
});
