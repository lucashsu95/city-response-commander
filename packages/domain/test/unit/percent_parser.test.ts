import { describe, it, expect } from 'vitest';
import { parsePercent, PercentParseError } from '../../src/ingestion/percent_parser.js';

describe('parsePercent', () => {
  describe('valid percent strings', () => {
    it('parses "5%" to 0.05', () => {
      expect(parsePercent('5%')).toBe(0.05);
    });

    it('parses "30%" to 0.30', () => {
      expect(parsePercent('30%')).toBeCloseTo(0.30, 10);
    });

    it('parses "45%" to 0.45', () => {
      expect(parsePercent('45%')).toBeCloseTo(0.45, 10);
    });

    it('parses "100%" to 1.00', () => {
      expect(parsePercent('100%')).toBe(1.00);
    });

    it('parses "0%" to 0.00', () => {
      expect(parsePercent('0%')).toBe(0.00);
    });

    it('parses "8%" to 0.08', () => {
      expect(parsePercent('8%')).toBeCloseTo(0.08, 10);
    });

    it('parses "40%" to 0.40', () => {
      expect(parsePercent('40%')).toBeCloseTo(0.40, 10);
    });

    it('handles decimal percentages like "12.5%"', () => {
      expect(parsePercent('12.5%')).toBeCloseTo(0.125, 10);
    });

    it('handles whitespace around the string', () => {
      expect(parsePercent('  30%  ')).toBeCloseTo(0.30, 10);
    });
  });

  describe('invalid percent strings', () => {
    it('throws INVALID_FORMAT for string without %', () => {
      expect(() => parsePercent('30')).toThrow(PercentParseError);
      try {
        parsePercent('30');
      } catch (e) {
        expect(e).toBeInstanceOf(PercentParseError);
        expect((e as PercentParseError).code).toBe('INVALID_FORMAT');
        expect((e as PercentParseError).value).toBe('30');
      }
    });

    it('throws INVALID_FORMAT for empty string', () => {
      expect(() => parsePercent('')).toThrow(PercentParseError);
      try {
        parsePercent('');
      } catch (e) {
        expect((e as PercentParseError).code).toBe('INVALID_FORMAT');
      }
    });

    it('throws NON_NUMERIC for "%" alone', () => {
      expect(() => parsePercent('%')).toThrow(PercentParseError);
      try {
        parsePercent('%');
      } catch (e) {
        expect((e as PercentParseError).code).toBe('NON_NUMERIC');
      }
    });

    it('throws NON_NUMERIC for "abc%"', () => {
      expect(() => parsePercent('abc%')).toThrow(PercentParseError);
      try {
        parsePercent('abc%');
      } catch (e) {
        expect((e as PercentParseError).code).toBe('NON_NUMERIC');
        expect((e as PercentParseError).value).toBe('abc%');
      }
    });

    it('throws INVALID_FORMAT for "30percent"', () => {
      expect(() => parsePercent('30percent')).toThrow(PercentParseError);
      try {
        parsePercent('30percent');
      } catch (e) {
        expect((e as PercentParseError).code).toBe('INVALID_FORMAT');
      }
    });

    it('throws INVALID_FORMAT for string with % in the middle', () => {
      expect(() => parsePercent('30%5')).toThrow(PercentParseError);
      try {
        parsePercent('30%5');
      } catch (e) {
        expect((e as PercentParseError).code).toBe('INVALID_FORMAT');
      }
    });
  });
});
