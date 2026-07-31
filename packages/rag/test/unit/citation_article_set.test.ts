/**
 * citation_article_set — unit + property tests (TASK-110, TASK-048 P27)
 *
 * P27（§22.1）：citation_article_set ⊇ triggered_articles ∪ applied_formula_articles
 * - 無重複條款號
 * - 遞增排序
 * - 超出 1–7 範圍的條款號拋出 Error
 */

import * as fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import {
  buildCitationArticleSet,
  findMissingCitations,
} from '../../src/citation_article_set.js';
import type { DecisionCore } from '@city-commander/shared-schemas';

// ─── Minimal DecisionCore stub ─────────────────────────────────────────────

function makeCore(
  triggered: number[],
  applied: number[],
): Pick<DecisionCore, 'triggered_articles' | 'applied_formula_articles'> &
  Partial<DecisionCore> {
  return {
    triggered_articles: triggered,
    applied_formula_articles: applied,
  } as unknown as DecisionCore;
}

// ─── Unit tests ────────────────────────────────────────────────────────────

describe('buildCitationArticleSet', () => {
  it('ACC_001 golden: triggered=[1,2] applied=[7] → [1,2,7]', () => {
    expect(buildCitationArticleSet(makeCore([1, 2], [7]) as DecisionCore)).toEqual([1, 2, 7]);
  });

  it('deduplicates overlap: triggered=[1,2] applied=[2,7] → [1,2,7]', () => {
    expect(buildCitationArticleSet(makeCore([1, 2], [2, 7]) as DecisionCore)).toEqual([1, 2, 7]);
  });

  it('empty inputs → empty array', () => {
    expect(buildCitationArticleSet(makeCore([], []) as DecisionCore)).toEqual([]);
  });

  it('returns sorted output regardless of input order', () => {
    expect(buildCitationArticleSet(makeCore([3, 1], [2]) as DecisionCore)).toEqual([1, 2, 3]);
  });

  it('single article in both lists → one entry', () => {
    expect(buildCitationArticleSet(makeCore([5], [5]) as DecisionCore)).toEqual([5]);
  });

  it('throws on article_no = 0 (out of range)', () => {
    expect(() => buildCitationArticleSet(makeCore([0, 1], []) as DecisionCore)).toThrow();
  });

  it('throws on article_no = 8 (out of range)', () => {
    expect(() => buildCitationArticleSet(makeCore([1], [8]) as DecisionCore)).toThrow();
  });

  it('throws on non-integer article_no', () => {
    expect(() => buildCitationArticleSet(makeCore([1.5], []) as DecisionCore)).toThrow();
  });
});

// ─── P27 property test ─────────────────────────────────────────────────────

const validArticle = fc.integer({ min: 1, max: 7 });

describe('P27: citation_article_set ⊇ triggered ∪ applied_formula', () => {
  it(
    'Feature: city-response-commander, Property 27: buildCitationArticleSet covers all triggered and applied articles',
    () => {
      fc.assert(
        fc.property(
          fc.array(validArticle, { minLength: 0, maxLength: 5 }),
          fc.array(validArticle, { minLength: 0, maxLength: 3 }),
          (triggered, applied) => {
            const core = makeCore(triggered, applied) as DecisionCore;
            const result = buildCitationArticleSet(core);

            // 必須涵蓋所有 triggered
            for (const a of triggered) {
              expect(result).toContain(a);
            }
            // 必須涵蓋所有 applied_formula
            for (const a of applied) {
              expect(result).toContain(a);
            }
            // 無重複
            expect(new Set(result).size).toBe(result.length);
            // 遞增排序
            for (let i = 1; i < result.length; i++) {
              expect(result[i]).toBeGreaterThan(result[i - 1]!);
            }
          },
        ),
        { numRuns: 100 },
      );
    },
  );
});

// ─── findMissingCitations ──────────────────────────────────────────────────

describe('findMissingCitations', () => {
  it('no missing when citationSet covers all', () => {
    expect(findMissingCitations([1, 2, 7], [1, 2], [7])).toEqual([]);
  });

  it('detects missing triggered article', () => {
    expect(findMissingCitations([2, 7], [1, 2], [7])).toEqual([1]);
  });

  it('detects missing applied_formula article', () => {
    expect(findMissingCitations([1, 2], [1, 2], [7])).toEqual([7]);
  });

  it('returns sorted missing list', () => {
    expect(findMissingCitations([], [3, 1], [2])).toEqual([1, 2, 3]);
  });
});
