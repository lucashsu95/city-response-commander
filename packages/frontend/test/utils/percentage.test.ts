/**
 * Percentage Utility Tests
 *
 * Tests for formatRatioAsPercent, roamingBarWidth, calculateAverageRatio.
 *
 * @module frontend/test/utils/percentage.test
 */

import { describe, it, expect } from 'vitest';
import {
  formatRatioAsPercent,
  roamingBarWidth,
  calculateAverageRatio,
} from '../../src/utils/percentage.js';

// ─── formatRatioAsPercent ────────────────────────────────────────

describe('formatRatioAsPercent', () => {
  it('0.1 → 10.0%', () => {
    expect(formatRatioAsPercent(0.1)).toBe('10.0%');
  });

  it('0.3 → 30.0%', () => {
    expect(formatRatioAsPercent(0.3)).toBe('30.0%');
  });

  it('0 → 0.0%', () => {
    expect(formatRatioAsPercent(0)).toBe('0.0%');
  });

  it('undefined → 無資料', () => {
    expect(formatRatioAsPercent(undefined)).toBe('無資料');
  });

  it('null → 無資料', () => {
    expect(formatRatioAsPercent(null)).toBe('無資料');
  });

  it('NaN → 無資料', () => {
    expect(formatRatioAsPercent(NaN)).toBe('無資料');
  });

  it('rounds to specified fraction digits', () => {
    expect(formatRatioAsPercent(0.333, 2)).toBe('33.30%');
    expect(formatRatioAsPercent(0.333, 0)).toBe('33%');
  });

  it('0.05 (5%) displays as 5.0%', () => {
    expect(formatRatioAsPercent(0.05)).toBe('5.0%');
  });

  it('0.30 (30%) displays as 30.0%', () => {
    expect(formatRatioAsPercent(0.30)).toBe('30.0%');
  });
});

// ─── roamingBarWidth ─────────────────────────────────────────────

describe('roamingBarWidth', () => {
  it('0.1 → 10', () => {
    expect(roamingBarWidth(0.1)).toBe(10);
  });

  it('0.3 → 30', () => {
    expect(roamingBarWidth(0.3)).toBe(30);
  });

  it('0 → 0', () => {
    expect(roamingBarWidth(0)).toBe(0);
  });

  it('undefined → 0', () => {
    expect(roamingBarWidth(undefined)).toBe(0);
  });

  it('clamps values above 100%', () => {
    expect(roamingBarWidth(1.5)).toBe(100);
    expect(roamingBarWidth(1.0)).toBe(100);
  });

  it('0.05 → 5 (5% bar width)', () => {
    expect(roamingBarWidth(0.05)).toBe(5);
  });
});

// ─── calculateAverageRatio ───────────────────────────────────────

describe('calculateAverageRatio', () => {
  it('[0.1, 0.2, 0.3] → 0.2', () => {
    expect(calculateAverageRatio([0.1, 0.2, 0.3])).toBeCloseTo(0.2);
  });

  it('ignores invalid values in denominator', () => {
    expect(calculateAverageRatio([0.1, null, undefined, 0.3])).toBeCloseTo(0.2);
  });

  it('empty array → null', () => {
    expect(calculateAverageRatio([])).toBeNull();
    expect(calculateAverageRatio([null, undefined])).toBeNull();
  });

  it('single value', () => {
    expect(calculateAverageRatio([0.5])).toBeCloseTo(0.5);
  });

  it('[0.05, 0.08, 0.15] → ~0.093', () => {
    expect(calculateAverageRatio([0.05, 0.08, 0.15])).toBeCloseTo(0.0933, 3);
  });
});
