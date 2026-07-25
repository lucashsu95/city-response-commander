import * as fc from 'fast-check';
import { describe, expect } from 'vitest';
import { evaluateArticle1 } from '../../src/rule_engine/article1.js';
import { propertyTest } from '../helpers/pbt-helper.js';

describe('Article 1 mapping properties', () => {
  /** Validates: Requirements REQ-011 */
  propertyTest(5, 'trigger segments map levels to official measures without triggering article 2', fc.constantFrom<'A' | 'B'>('A', 'B'), (level) => {
    const result = evaluateArticle1([{ segment_id: 'RD_TPE_001', level }]);
    expect(result.adds_to_triggered_articles).toEqual([1]);
    expect(result.adds_to_triggered_articles).not.toContain(2);
    expect(result.art1_measures[0]).toMatchObject({ long_green_timing: true, alternatives_green_plus_pct: 25, police_clear_intersections: true });
    expect(result.invoked_procedures.includes('article2_alternative_route_guidance')).toBe(level === 'A');
  });
});
