/**
 * Unit tests for RuleEngine Article 1 — SOP-1 trigger segments measures
 *
 * Verifies:
 * - B-level measures: long_green_timing + alternatives_green_plus_pct=25 + police_clear_intersections
 * - A-level measures: all B-level + invokes article2_alternative_route_guidance
 * - A-level alone does NOT add 2 to triggered_articles
 * - Non-trigger segments are ignored
 * - Only [1] is added to triggered_articles when triggered
 */

import { describe, it, expect } from 'vitest';
import type { SegmentClassification } from '@city-commander/shared-schemas';
import {
  evaluateArticle1,
  ARTICLE1_TRIGGER_SEGMENTS,
  ARTICLE2_ALTERNATIVE_ROUTE_GUIDANCE,
} from '../../src/rule_engine/article1.js';

describe('RuleEngine Article 1', () => {
  describe('B-level trigger segment measures', () => {
    it('RD_TPE_001 at B-level produces correct measures', () => {
      const classifications: SegmentClassification[] = [
        { segment_id: 'RD_TPE_001', level: 'B' },
      ];

      const result = evaluateArticle1(classifications);

      expect(result.triggered).toBe(true);
      expect(result.art1_measures).toHaveLength(1);
      expect(result.art1_measures[0]).toEqual({
        level: 'B',
        trigger_segment: 'RD_TPE_001',
        long_green_timing: true,
        alternatives_green_plus_pct: 25,
        police_clear_intersections: true,
        a_level_invokes_article2_alternative_route_guidance: false,
      });
      expect(result.invoked_procedures).toEqual([]);
      expect(result.adds_to_triggered_articles).toEqual([1]);
    });

    it('RD_TPE_002 at B-level produces correct measures', () => {
      const classifications: SegmentClassification[] = [
        { segment_id: 'RD_TPE_002', level: 'B' },
      ];

      const result = evaluateArticle1(classifications);

      expect(result.triggered).toBe(true);
      expect(result.art1_measures).toHaveLength(1);
      expect(result.art1_measures[0]).toEqual({
        level: 'B',
        trigger_segment: 'RD_TPE_002',
        long_green_timing: true,
        alternatives_green_plus_pct: 25,
        police_clear_intersections: true,
        a_level_invokes_article2_alternative_route_guidance: false,
      });
      expect(result.invoked_procedures).toEqual([]);
      expect(result.adds_to_triggered_articles).toEqual([1]);
    });
  });

  describe('A-level trigger segment measures', () => {
    it('RD_TPE_001 at A-level produces B measures + invokes article2 guidance', () => {
      const classifications: SegmentClassification[] = [
        { segment_id: 'RD_TPE_001', level: 'A' },
      ];

      const result = evaluateArticle1(classifications);

      expect(result.triggered).toBe(true);
      expect(result.art1_measures).toHaveLength(1);
      expect(result.art1_measures[0]).toEqual({
        level: 'A',
        trigger_segment: 'RD_TPE_001',
        long_green_timing: true,
        alternatives_green_plus_pct: 25,
        police_clear_intersections: true,
        a_level_invokes_article2_alternative_route_guidance: true,
      });
      expect(result.invoked_procedures).toEqual([ARTICLE2_ALTERNATIVE_ROUTE_GUIDANCE]);
    });

    it('RD_TPE_002 at A-level produces B measures + invokes article2 guidance', () => {
      const classifications: SegmentClassification[] = [
        { segment_id: 'RD_TPE_002', level: 'A' },
      ];

      const result = evaluateArticle1(classifications);

      expect(result.triggered).toBe(true);
      expect(result.art1_measures).toHaveLength(1);
      expect(result.art1_measures[0]).toEqual({
        level: 'A',
        trigger_segment: 'RD_TPE_002',
        long_green_timing: true,
        alternatives_green_plus_pct: 25,
        police_clear_intersections: true,
        a_level_invokes_article2_alternative_route_guidance: true,
      });
      expect(result.invoked_procedures).toEqual([ARTICLE2_ALTERNATIVE_ROUTE_GUIDANCE]);
    });

    it('A-level alone does NOT add 2 to triggered_articles (key invariant)', () => {
      const classifications: SegmentClassification[] = [
        { segment_id: 'RD_TPE_001', level: 'A' },
        { segment_id: 'RD_TPE_002', level: 'A' },
      ];

      const result = evaluateArticle1(classifications);

      // adds_to_triggered_articles should be [1], never [1, 2] or [2]
      expect(result.adds_to_triggered_articles).toEqual([1]);
      expect(result.adds_to_triggered_articles).not.toContain(2);
    });
  });

  describe('non-trigger segments are ignored', () => {
    it('does not trigger for non-trigger segments at A-level', () => {
      const classifications: SegmentClassification[] = [
        { segment_id: 'RD_TPE_003', level: 'A' },
        { segment_id: 'RD_TPE_004', level: 'A' },
        { segment_id: 'RD_TPE_005', level: 'B' },
      ];

      const result = evaluateArticle1(classifications);

      expect(result.triggered).toBe(false);
      expect(result.art1_measures).toHaveLength(0);
      expect(result.invoked_procedures).toEqual([]);
      expect(result.adds_to_triggered_articles).toEqual([]);
    });

    it('only processes RD_TPE_001 and RD_TPE_002 among mixed segments', () => {
      const classifications: SegmentClassification[] = [
        { segment_id: 'RD_TPE_001', level: 'B' },
        { segment_id: 'RD_TPE_003', level: 'A' },
        { segment_id: 'RD_TPE_004', level: 'B' },
        { segment_id: 'RD_TPE_005', level: 'A' },
      ];

      const result = evaluateArticle1(classifications);

      expect(result.triggered).toBe(true);
      expect(result.art1_measures).toHaveLength(1);
      expect(result.art1_measures[0].trigger_segment).toBe('RD_TPE_001');
    });
  });

  describe('null level (no trigger)', () => {
    it('trigger segments with null level do not trigger article 1', () => {
      const classifications: SegmentClassification[] = [
        { segment_id: 'RD_TPE_001', level: null },
        { segment_id: 'RD_TPE_002', level: null },
      ];

      const result = evaluateArticle1(classifications);

      expect(result.triggered).toBe(false);
      expect(result.art1_measures).toHaveLength(0);
      expect(result.invoked_procedures).toEqual([]);
      expect(result.adds_to_triggered_articles).toEqual([]);
    });
  });

  describe('multiple trigger segments', () => {
    it('both trigger segments at B-level produce two measures', () => {
      const classifications: SegmentClassification[] = [
        { segment_id: 'RD_TPE_001', level: 'B' },
        { segment_id: 'RD_TPE_002', level: 'B' },
      ];

      const result = evaluateArticle1(classifications);

      expect(result.triggered).toBe(true);
      expect(result.art1_measures).toHaveLength(2);
      expect(result.art1_measures[0].trigger_segment).toBe('RD_TPE_001');
      expect(result.art1_measures[1].trigger_segment).toBe('RD_TPE_002');
      expect(result.invoked_procedures).toEqual([]);
      expect(result.adds_to_triggered_articles).toEqual([1]);
    });

    it('both trigger segments at A-level only invoke article2 guidance once', () => {
      const classifications: SegmentClassification[] = [
        { segment_id: 'RD_TPE_001', level: 'A' },
        { segment_id: 'RD_TPE_002', level: 'A' },
      ];

      const result = evaluateArticle1(classifications);

      expect(result.triggered).toBe(true);
      expect(result.art1_measures).toHaveLength(2);
      // invoked_procedures should not duplicate the procedure name
      expect(result.invoked_procedures).toEqual([ARTICLE2_ALTERNATIVE_ROUTE_GUIDANCE]);
      expect(result.invoked_procedures).toHaveLength(1);
    });

    it('mixed A and B levels on trigger segments', () => {
      const classifications: SegmentClassification[] = [
        { segment_id: 'RD_TPE_001', level: 'A' },
        { segment_id: 'RD_TPE_002', level: 'B' },
      ];

      const result = evaluateArticle1(classifications);

      expect(result.triggered).toBe(true);
      expect(result.art1_measures).toHaveLength(2);
      expect(result.art1_measures[0]).toEqual({
        level: 'A',
        trigger_segment: 'RD_TPE_001',
        long_green_timing: true,
        alternatives_green_plus_pct: 25,
        police_clear_intersections: true,
        a_level_invokes_article2_alternative_route_guidance: true,
      });
      expect(result.art1_measures[1]).toEqual({
        level: 'B',
        trigger_segment: 'RD_TPE_002',
        long_green_timing: true,
        alternatives_green_plus_pct: 25,
        police_clear_intersections: true,
        a_level_invokes_article2_alternative_route_guidance: false,
      });
      expect(result.invoked_procedures).toEqual([ARTICLE2_ALTERNATIVE_ROUTE_GUIDANCE]);
      expect(result.adds_to_triggered_articles).toEqual([1]);
    });
  });

  describe('empty classifications', () => {
    it('returns not triggered for empty input', () => {
      const result = evaluateArticle1([]);

      expect(result.triggered).toBe(false);
      expect(result.art1_measures).toEqual([]);
      expect(result.invoked_procedures).toEqual([]);
      expect(result.adds_to_triggered_articles).toEqual([]);
    });
  });

  describe('ACC_001 scenario walkthrough', () => {
    it('ACC_001: RD_TPE_002 at A-level (Saturation=1.00) triggers art.1', () => {
      // Per §9.5: RD_TPE_002 at 22:10 has Saturation_Score = 1.00 (A 級)
      // This triggers art.1 with A-level measures and invokes article2 guidance procedure
      const classifications: SegmentClassification[] = [
        { segment_id: 'RD_TPE_001', level: 'A' },  // Also at A (1.00 at 22:10)
        { segment_id: 'RD_TPE_002', level: 'A' },  // The incident segment
        { segment_id: 'RD_TPE_003', level: 'B' },
        { segment_id: 'RD_TPE_004', level: null },
        { segment_id: 'RD_TPE_005', level: null },
      ];

      const result = evaluateArticle1(classifications);

      expect(result.triggered).toBe(true);
      expect(result.art1_measures).toHaveLength(2);
      // Both trigger segments produce measures
      expect(result.art1_measures[0].trigger_segment).toBe('RD_TPE_001');
      expect(result.art1_measures[0].level).toBe('A');
      expect(result.art1_measures[1].trigger_segment).toBe('RD_TPE_002');
      expect(result.art1_measures[1].level).toBe('A');
      // A-level invokes the procedure
      expect(result.invoked_procedures).toContain(ARTICLE2_ALTERNATIVE_ROUTE_GUIDANCE);
      // Key: adds_to_triggered_articles is [1], NOT [1, 2]
      expect(result.adds_to_triggered_articles).toEqual([1]);
      expect(result.adds_to_triggered_articles).not.toContain(2);
    });
  });

  describe('constants', () => {
    it('ARTICLE1_TRIGGER_SEGMENTS contains exactly RD_TPE_001 and RD_TPE_002', () => {
      expect(ARTICLE1_TRIGGER_SEGMENTS).toEqual(['RD_TPE_001', 'RD_TPE_002']);
      expect(ARTICLE1_TRIGGER_SEGMENTS).toHaveLength(2);
    });

    it('ARTICLE2_ALTERNATIVE_ROUTE_GUIDANCE is the correct procedure name', () => {
      expect(ARTICLE2_ALTERNATIVE_ROUTE_GUIDANCE).toBe('article2_alternative_route_guidance');
    });
  });
});
