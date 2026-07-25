import * as fc from 'fast-check';
import { describe, expect } from 'vitest';
import { aggregateArticles } from '../../src/rule_engine/article_aggregation.js';
import { propertyTest } from '../helpers/pbt-helper.js';

describe('Citation coverage properties', () => {
  /** Validates: Requirements REQ-008, REQ-021 */
  propertyTest(27, 'citation set covers triggered and applied-formula articles', fc.record({ triggered: fc.uniqueArray(fc.integer({ min: 1, max: 6 })), applied: fc.uniqueArray(fc.integer({ min: 1, max: 7 })) }), ({ triggered, applied }) => {
    const result = aggregateArticles({ evaluations: triggered.map((article) => ({ article, triggered: true })), applied_formula_articles: applied });
    for (const article of [...triggered, ...applied]) expect(result.citation_article_set).toContain(article);
    expect(result.triggered_articles).not.toContain(7);
  });
});
