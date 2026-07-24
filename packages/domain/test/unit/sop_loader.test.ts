/**
 * Unit tests for SOP Loader — emergency_traffic_sop.txt
 *
 * Verifies:
 * - Exactly 7 article chunks parsed
 * - Correct article_no (1-7) and titles
 * - Verbatim text preservation per article
 * - Lookup by article_no works
 * - Error on article count != 7
 * - Error on empty content
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parseSOPText, SOPLoadError } from '../../src/ingestion/sop_loader.js';

// Load the actual SOP file for integration-like unit tests
const SOP_PATH = path.resolve(
  __dirname,
  '../../../../中華電信資料集/emergency_traffic_sop.txt',
);

const sopContent = fs.readFileSync(SOP_PATH, 'utf-8');

describe('parseSOPText', () => {
  describe('with official SOP file', () => {
    it('should produce exactly 7 article chunks', () => {
      const result = parseSOPText(sopContent);
      expect(result.articles).toHaveLength(7);
    });

    it('should have correct article_no values 1-7', () => {
      const result = parseSOPText(sopContent);
      for (let i = 0; i < 7; i++) {
        expect(result.articles[i].article_no).toBe(i + 1);
      }
    });

    it('should have correct titles for all 7 articles', () => {
      const result = parseSOPText(sopContent);
      const expectedTitles = [
        '交通擁塞級別判定',
        '車禍與路障應變',
        '捷運與接駁分流',
        '大巨蛋散場啟動',
        '號誌故障應變',
        '數位通報與多語化',
        '預計恢復時間 (ETE) 計算',
      ];

      for (let i = 0; i < 7; i++) {
        expect(result.articles[i].title).toBe(expectedTitles[i]);
      }
    });

    it('should preserve verbatim text per article (non-empty)', () => {
      const result = parseSOPText(sopContent);
      for (const article of result.articles) {
        expect(article.text.length).toBeGreaterThan(0);
      }
    });

    it('article 1 text should contain key SOP-1 content', () => {
      const result = parseSOPText(sopContent);
      const art1 = result.articles[0];
      expect(art1.text).toContain('B 級 (壅擠 / 黃燈)');
      expect(art1.text).toContain('A 級 (癱瘓 / 紅燈)');
      expect(art1.text).toContain('0.85 <= Saturation_Score < 0.95');
      expect(art1.text).toContain('Saturation_Score >= 0.95');
      expect(art1.text).toContain('RD_TPE_001');
      expect(art1.text).toContain('RD_TPE_002');
    });

    it('article 2 text should contain key SOP-2 content', () => {
      const result = parseSOPText(sopContent);
      const art2 = result.articles[1];
      expect(art2.text).toContain('capacity_vph >= 1000');
      expect(art2.text).toContain('Saturation_Score');
      expect(art2.text).toContain('CMS');
    });

    it('article 3 text should contain key SOP-3 content', () => {
      const result = parseSOPText(sopContent);
      const art3 = result.articles[2];
      expect(art3.text).toContain('BS_MRT_BL17');
      expect(art3.text).toContain('Growth_Rate > 0.30');
      expect(art3.text).toContain('User_Count > 25,000');
      expect(art3.text).toContain('BS_MRT_BL18');
    });

    it('article 7 text should contain ETE formula', () => {
      const result = parseSOPText(sopContent);
      const art7 = result.articles[6];
      expect(art7.text).toContain('ETE_minutes = base_clearance + congestion_penalty');
      expect(art7.text).toContain('Critical = 60');
      expect(art7.text).toContain('High = 40');
      expect(art7.text).toContain('Medium = 20');
    });

    it('getByArticleNo should return the correct article', () => {
      const result = parseSOPText(sopContent);
      const art5 = result.getByArticleNo(5);
      expect(art5).toBeDefined();
      expect(art5!.article_no).toBe(5);
      expect(art5!.title).toBe('號誌故障應變');
      expect(art5!.text).toContain('Power_Failure');
    });

    it('getByArticleNo should return undefined for out-of-range article', () => {
      const result = parseSOPText(sopContent);
      expect(result.getByArticleNo(0)).toBeUndefined();
      expect(result.getByArticleNo(8)).toBeUndefined();
      expect(result.getByArticleNo(-1)).toBeUndefined();
    });

    it('articles should be readonly (frozen)', () => {
      const result = parseSOPText(sopContent);
      expect(Object.isFrozen(result.articles)).toBe(true);
      for (const article of result.articles) {
        expect(Object.isFrozen(article)).toBe(true);
      }
    });
  });

  describe('error handling', () => {
    it('should throw SOPLoadError with EMPTY_CONTENT on empty string', () => {
      expect(() => parseSOPText('')).toThrow(SOPLoadError);
      try {
        parseSOPText('');
      } catch (e) {
        expect(e).toBeInstanceOf(SOPLoadError);
        expect((e as SOPLoadError).code).toBe('EMPTY_CONTENT');
      }
    });

    it('should throw SOPLoadError with EMPTY_CONTENT on whitespace-only', () => {
      expect(() => parseSOPText('   \n  \n  ')).toThrow(SOPLoadError);
      try {
        parseSOPText('   \n  \n  ');
      } catch (e) {
        expect(e).toBeInstanceOf(SOPLoadError);
        expect((e as SOPLoadError).code).toBe('EMPTY_CONTENT');
      }
    });

    it('should throw SOPLoadError with ARTICLE_COUNT_MISMATCH on fewer than 7 articles', () => {
      const partialSop = `交通應變標準程序

==========================================================
1. 交通擁塞級別判定
==========================================================
Some content here.

==========================================================
2. 車禍與路障應變
==========================================================
More content.
`;
      expect(() => parseSOPText(partialSop)).toThrow(SOPLoadError);
      try {
        parseSOPText(partialSop);
      } catch (e) {
        expect(e).toBeInstanceOf(SOPLoadError);
        expect((e as SOPLoadError).code).toBe('ARTICLE_COUNT_MISMATCH');
        expect((e as SOPLoadError).details?.expected).toBe(7);
        expect((e as SOPLoadError).details?.actual).toBe(2);
      }
    });

    it('should throw SOPLoadError with ARTICLE_COUNT_MISMATCH if no articles found', () => {
      const noArticles = 'Just some text without any separator patterns or article headers.';
      expect(() => parseSOPText(noArticles)).toThrow(SOPLoadError);
      try {
        parseSOPText(noArticles);
      } catch (e) {
        expect(e).toBeInstanceOf(SOPLoadError);
        expect((e as SOPLoadError).code).toBe('ARTICLE_COUNT_MISMATCH');
        expect((e as SOPLoadError).details?.actual).toBe(0);
      }
    });
  });
});
