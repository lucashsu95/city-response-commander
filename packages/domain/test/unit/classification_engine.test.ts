/**
 * Unit tests for ClassificationEngine — A/B grading boundary tests
 *
 * Tests the exact boundary values from the spec:
 * TC-SAT-001: 0.8499 → null (not B)
 * TC-SAT-002: 0.85   → 'B'
 * TC-SAT-003: 0.9499 → 'B'
 * TC-SAT-004: 0.95   → 'A'
 *
 * Plus additional cases for null/missing saturation and consistency across segments.
 */

import { describe, it, expect } from 'vitest';
import { classifySegments, type SegmentSnapshot } from '../../src/rule_engine/classification_engine.js';

describe('ClassificationEngine', () => {
  describe('boundary values (TC-SAT-001..004)', () => {
    it('TC-SAT-001: 0.8499 → null (not B)', () => {
      const result = classifySegments([{ segment_id: 'RD_TPE_001', saturation_score: 0.8499 }]);
      expect(result[0].level).toBe(null);
    });

    it('TC-SAT-002: 0.85 → B (inclusive lower bound)', () => {
      const result = classifySegments([{ segment_id: 'RD_TPE_001', saturation_score: 0.85 }]);
      expect(result[0].level).toBe('B');
    });

    it('TC-SAT-003: 0.9499 → B (still below A threshold)', () => {
      const result = classifySegments([{ segment_id: 'RD_TPE_001', saturation_score: 0.9499 }]);
      expect(result[0].level).toBe('B');
    });

    it('TC-SAT-004: 0.95 → A (inclusive lower bound)', () => {
      const result = classifySegments([{ segment_id: 'RD_TPE_001', saturation_score: 0.95 }]);
      expect(result[0].level).toBe('A');
    });
  });

  describe('additional boundary cases', () => {
    it('0.0 → null', () => {
      const result = classifySegments([{ segment_id: 'RD_TPE_001', saturation_score: 0.0 }]);
      expect(result[0].level).toBe(null);
    });

    it('0.84 → null', () => {
      const result = classifySegments([{ segment_id: 'RD_TPE_001', saturation_score: 0.84 }]);
      expect(result[0].level).toBe(null);
    });

    it('0.90 → B', () => {
      const result = classifySegments([{ segment_id: 'RD_TPE_001', saturation_score: 0.90 }]);
      expect(result[0].level).toBe('B');
    });

    it('1.0 → A', () => {
      const result = classifySegments([{ segment_id: 'RD_TPE_001', saturation_score: 1.0 }]);
      expect(result[0].level).toBe('A');
    });

    it('0.99 → A', () => {
      const result = classifySegments([{ segment_id: 'RD_TPE_001', saturation_score: 0.99 }]);
      expect(result[0].level).toBe('A');
    });
  });

  describe('missing saturation (insufficient_data)', () => {
    it('null saturation_score → level null (no guess)', () => {
      const result = classifySegments([{ segment_id: 'RD_TPE_001', saturation_score: null }]);
      expect(result[0].level).toBe(null);
    });
  });

  describe('consistency for all 15 segments', () => {
    it('applies the same grading rule to all segments identically', () => {
      const segments: SegmentSnapshot[] = [
        { segment_id: 'RD_TPE_001', saturation_score: 1.0 },
        { segment_id: 'RD_TPE_002', saturation_score: 0.95 },
        { segment_id: 'RD_TPE_003', saturation_score: 0.94 },
        { segment_id: 'RD_TPE_004', saturation_score: 0.85 },
        { segment_id: 'RD_TPE_005', saturation_score: 0.84 },
        { segment_id: 'RD_TPE_006', saturation_score: 0.70 },
        { segment_id: 'RD_TPE_007', saturation_score: 0.50 },
        { segment_id: 'RD_TPE_008', saturation_score: 0.30 },
        { segment_id: 'RD_TPE_009', saturation_score: 0.10 },
        { segment_id: 'RD_TPE_010', saturation_score: 0.0 },
        { segment_id: 'RD_TPE_011', saturation_score: null },
        { segment_id: 'RD_TPE_012', saturation_score: 0.8499 },
        { segment_id: 'RD_TPE_013', saturation_score: 0.9499 },
        { segment_id: 'RD_TPE_014', saturation_score: 0.88 },
        { segment_id: 'RD_TPE_015', saturation_score: 0.97 },
      ];

      const result = classifySegments(segments);

      expect(result).toHaveLength(15);
      expect(result[0]).toEqual({ segment_id: 'RD_TPE_001', level: 'A' });
      expect(result[1]).toEqual({ segment_id: 'RD_TPE_002', level: 'A' });
      expect(result[2]).toEqual({ segment_id: 'RD_TPE_003', level: 'B' });
      expect(result[3]).toEqual({ segment_id: 'RD_TPE_004', level: 'B' });
      expect(result[4]).toEqual({ segment_id: 'RD_TPE_005', level: null });
      expect(result[5]).toEqual({ segment_id: 'RD_TPE_006', level: null });
      expect(result[6]).toEqual({ segment_id: 'RD_TPE_007', level: null });
      expect(result[7]).toEqual({ segment_id: 'RD_TPE_008', level: null });
      expect(result[8]).toEqual({ segment_id: 'RD_TPE_009', level: null });
      expect(result[9]).toEqual({ segment_id: 'RD_TPE_010', level: null });
      expect(result[10]).toEqual({ segment_id: 'RD_TPE_011', level: null });
      expect(result[11]).toEqual({ segment_id: 'RD_TPE_012', level: null });
      expect(result[12]).toEqual({ segment_id: 'RD_TPE_013', level: 'B' });
      expect(result[13]).toEqual({ segment_id: 'RD_TPE_014', level: 'B' });
      expect(result[14]).toEqual({ segment_id: 'RD_TPE_015', level: 'A' });
    });

    it('returns an empty array for empty input', () => {
      const result = classifySegments([]);
      expect(result).toEqual([]);
    });

    it('preserves segment_id from input', () => {
      const result = classifySegments([
        { segment_id: 'RD_CUSTOM_SEGMENT', saturation_score: 0.90 },
      ]);
      expect(result[0].segment_id).toBe('RD_CUSTOM_SEGMENT');
    });
  });
});
