/**
 * Unit tests for ete_calculator.ts
 *
 * Verifies:
 * - ACC_001 gold standard: ETE = 64.4
 * - Missing inputs → result_minutes=null, missing_inputs populated
 * - Formula substitution string is correct
 * - Recovery_at computed correctly
 */

import { describe, it, expect } from 'vitest';
import { computeEte, SOP7_FORMULA, BASE_CLEARANCE_TABLE, DEFAULT_TIMEZONE } from '../../src/reasoning/ete_calculator.js';

describe('computeEte', () => {
  describe('ACC_001 gold standard (64.4 minutes)', () => {
    it('Critical severity + avg_saturation=0.5733 → ETE≈64.4', () => {
      const result = computeEte({
        severity: 'Critical',
        avgSaturation: 0.5733,
        baseTimestamp: '2026-05-20 22:10',
        timezone: DEFAULT_TIMEZONE,
      });

      expect(result.result_minutes).toBeCloseTo(64.4, 1);
      expect(result.substitution).toMatch(/^60 \+ 4\.\d+ = 64\.\d+$/);
      expect(result.source_article).toBe(7);
      expect(result.formula).toBeTruthy();
      expect(result.missing_inputs).toEqual([]);
    });

    it('Critical severity + avg_saturation=0.5 → ETE=60 (no congestion penalty)', () => {
      const result = computeEte({
        severity: 'Critical',
        avgSaturation: 0.5,
        baseTimestamp: '2026-05-20 22:10',
        timezone: DEFAULT_TIMEZONE,
      });

      expect(result.result_minutes).toBeCloseTo(60, 2);
      expect(result.substitution).toContain('60 + 0 = 60');
    });

    it('High severity + avg_saturation=0.9 → ETE=64 (40 + 24)', () => {
      // (0.9 - 0.5) * 60 = 24; 40 + 24 = 64
      const result = computeEte({
        severity: 'High',
        avgSaturation: 0.9,
        baseTimestamp: '2026-05-20 22:10',
        timezone: DEFAULT_TIMEZONE,
      });

      expect(result.result_minutes).toBe(64);
      expect(result.substitution).toContain('40 + 24 = 64');
    });
  });

  describe('missing inputs', () => {
    it('null severity → result_minutes=null, base_clearance in missing_inputs', () => {
      const result = computeEte({
        severity: null,
        avgSaturation: 0.8,
        baseTimestamp: '2026-05-20 22:10',
        timezone: DEFAULT_TIMEZONE,
      });

      expect(result.result_minutes).toBeNull();
      expect(result.missing_inputs).toContain('base_clearance (severity missing or unknown)');
      expect(result.substitution).toContain('無法計算');
    });

    it('null avgSaturation → result_minutes=null, avg_saturation and congestion_penalty in missing_inputs', () => {
      const result = computeEte({
        severity: 'High',
        avgSaturation: null,
        baseTimestamp: '2026-05-20 22:10',
        timezone: DEFAULT_TIMEZONE,
      });

      expect(result.result_minutes).toBeNull();
      expect(result.missing_inputs).toContain('avg_saturation');
      expect(result.missing_inputs).toContain('congestion_penalty');
    });

    it('both null → multiple missing_inputs', () => {
      const result = computeEte({
        severity: null,
        avgSaturation: null,
        baseTimestamp: '2026-05-20 22:10',
        timezone: DEFAULT_TIMEZONE,
      });

      expect(result.result_minutes).toBeNull();
      expect(result.missing_inputs.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe('recovery_at', () => {
    it('recovery_at = base_timestamp + result_minutes', () => {
      const result = computeEte({
        severity: 'Critical',
        avgSaturation: 0.5,
        baseTimestamp: '2026-05-20 22:10',
        timezone: DEFAULT_TIMEZONE,
      });

      expect(result.recovery_at).toBe('2026-05-20 23:10'); // +60 minutes
    });

    it('recovery_at null when result_minutes null', () => {
      const result = computeEte({
        severity: null,
        avgSaturation: 0.5,
        baseTimestamp: '2026-05-20 22:10',
        timezone: DEFAULT_TIMEZONE,
      });

      expect(result.recovery_at).toBeNull();
    });

    it('cross-midnight recovery_at calculation', () => {
      const result = computeEte({
        severity: 'Medium', // 20 minutes
        avgSaturation: 0.5,
        baseTimestamp: '2026-05-20 22:50',
        timezone: DEFAULT_TIMEZONE,
      });

      expect(result.recovery_at).toBe('2026-05-20 23:10'); // +20 minutes
    });
  });

  describe('variables array', () => {
    it('contains all formula variables with correct sources', () => {
      const result = computeEte({
        severity: 'Critical',
        avgSaturation: 0.6,
        baseTimestamp: '2026-05-20 22:10',
        timezone: DEFAULT_TIMEZONE,
      });

      const varNames = result.variables.map((v) => v.name);
      expect(varNames).toContain('base_clearance');
      expect(varNames).toContain('avg_saturation');
      expect(varNames).toContain('congestion_penalty');
      expect(varNames).toContain('ETE_minutes');

      const baseVar = result.variables.find((v) => v.name === 'base_clearance');
      expect(baseVar!.value).toBe(60);
      expect(baseVar!.unit).toBe('分鐘');
      expect(baseVar!.source).toBe('incident.severity=Critical');

      const satVar = result.variables.find((v) => v.name === 'avg_saturation');
      expect(satVar!.value).toBe(0.6);
      expect(satVar!.source).toBe('traffic.saturation_score');
    });

    it('missing severity variable has source=missing', () => {
      const result = computeEte({
        severity: null,
        avgSaturation: 0.5,
        baseTimestamp: '2026-05-20 22:10',
        timezone: DEFAULT_TIMEZONE,
      });

      const baseVar = result.variables.find((v) => v.name === 'base_clearance');
      expect(baseVar!.source).toBe('missing');
      expect(baseVar!.value).toBe(0);
    });
  });

  describe('base_clearance table', () => {
    it('Critical=60, High=40, Medium=20', () => {
      for (const [severity, clearance] of BASE_CLEARANCE_TABLE.entries()) {
        const result = computeEte({
          severity,
          avgSaturation: 0.5,
          baseTimestamp: '2026-05-20 22:10',
          timezone: DEFAULT_TIMEZONE,
        });
        expect(result.result_minutes).toBe(clearance);
      }
    });

    it('unknown severity → result_minutes=null', () => {
      const result = computeEte({
        severity: 'Unknown',
        avgSaturation: 0.5,
        baseTimestamp: '2026-05-20 22:10',
        timezone: DEFAULT_TIMEZONE,
      });

      expect(result.result_minutes).toBeNull();
    });
  });

  describe('timezone', () => {
    it('uses UTC timezone', () => {
      const result = computeEte({
        severity: 'Critical',
        avgSaturation: 0.5,
        baseTimestamp: '2026-05-20 22:10',
        timezone: 'UTC',
      });

      expect(result.timezone).toBe('UTC');
      expect(result.recovery_at).toBe('2026-05-20 23:10');
    });
  });
});
