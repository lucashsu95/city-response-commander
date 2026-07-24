/**
 * Unit tests for timestamp_normalizer
 *
 * Validates:
 * - Parsing of "YYYY/M/D HH:MM" (slash, no zero-pad)
 * - Parsing of "YYYY-MM-DD HH:MM" (dash, zero-padded)
 * - timestamp_raw preserved byte-identical
 * - timestamp_display always "YYYY-MM-DD HH:MM"
 * - timestamp_normalized denotes the same instant as raw
 * - Unparseable timestamps throw TimestampParseError
 */

import { describe, it, expect } from 'vitest';
import {
  normalizeTimestamp,
  TimestampParseError,
} from '../../src/ingestion/timestamp_normalizer.js';

describe('normalizeTimestamp', () => {
  describe('slash format (no zero-pad)', () => {
    it('parses "2026/5/20 22:10" correctly', () => {
      const result = normalizeTimestamp('2026/5/20 22:10');

      expect(result.timestamp_raw).toBe('2026/5/20 22:10');
      expect(result.timestamp_display).toBe('2026-05-20 22:10');
      expect(result.timestamp_normalized.getFullYear()).toBe(2026);
      expect(result.timestamp_normalized.getMonth()).toBe(4); // 0-indexed
      expect(result.timestamp_normalized.getDate()).toBe(20);
      expect(result.timestamp_normalized.getHours()).toBe(22);
      expect(result.timestamp_normalized.getMinutes()).toBe(10);
    });

    it('parses "2026/5/20 17:00" correctly', () => {
      const result = normalizeTimestamp('2026/5/20 17:00');

      expect(result.timestamp_raw).toBe('2026/5/20 17:00');
      expect(result.timestamp_display).toBe('2026-05-20 17:00');
      expect(result.timestamp_normalized.getHours()).toBe(17);
      expect(result.timestamp_normalized.getMinutes()).toBe(0);
    });

    it('parses zero-padded slash format "2026/05/20 09:05"', () => {
      const result = normalizeTimestamp('2026/05/20 09:05');

      expect(result.timestamp_raw).toBe('2026/05/20 09:05');
      expect(result.timestamp_display).toBe('2026-05-20 09:05');
    });

    it('parses single-digit month and day "2026/1/3 08:30"', () => {
      const result = normalizeTimestamp('2026/1/3 08:30');

      expect(result.timestamp_raw).toBe('2026/1/3 08:30');
      expect(result.timestamp_display).toBe('2026-01-03 08:30');
      expect(result.timestamp_normalized.getMonth()).toBe(0); // January
      expect(result.timestamp_normalized.getDate()).toBe(3);
    });
  });

  describe('dash format (already normalized)', () => {
    it('parses "2026-05-20 22:10" correctly', () => {
      const result = normalizeTimestamp('2026-05-20 22:10');

      expect(result.timestamp_raw).toBe('2026-05-20 22:10');
      expect(result.timestamp_display).toBe('2026-05-20 22:10');
      expect(result.timestamp_normalized.getFullYear()).toBe(2026);
      expect(result.timestamp_normalized.getMonth()).toBe(4);
      expect(result.timestamp_normalized.getDate()).toBe(20);
      expect(result.timestamp_normalized.getHours()).toBe(22);
      expect(result.timestamp_normalized.getMinutes()).toBe(10);
    });

    it('parses "2026-05-20 21:30" correctly', () => {
      const result = normalizeTimestamp('2026-05-20 21:30');

      expect(result.timestamp_raw).toBe('2026-05-20 21:30');
      expect(result.timestamp_display).toBe('2026-05-20 21:30');
    });
  });

  describe('timestamp_raw immutability', () => {
    it('preserves raw value byte-identical for slash format', () => {
      const raw = '2026/5/20 22:10';
      const result = normalizeTimestamp(raw);
      expect(result.timestamp_raw).toBe(raw);
      expect(result.timestamp_raw).not.toBe(result.timestamp_display);
    });

    it('preserves raw value byte-identical for dash format', () => {
      const raw = '2026-05-20 22:10';
      const result = normalizeTimestamp(raw);
      expect(result.timestamp_raw).toBe(raw);
    });

    it('raw is never modified even when display differs', () => {
      const raw = '2026/5/1 9:05';
      const result = normalizeTimestamp(raw);
      expect(result.timestamp_raw).toBe(raw);
      expect(result.timestamp_display).toBe('2026-05-01 09:05');
    });
  });

  describe('timestamp_display format', () => {
    it('always produces YYYY-MM-DD HH:MM format', () => {
      const cases = [
        '2026/5/20 22:10',
        '2026/1/1 0:00',
        '2026/12/31 23:59',
        '2026-05-20 22:10',
        '2026-01-01 00:00',
      ];

      const displayPattern = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;

      for (const raw of cases) {
        const result = normalizeTimestamp(raw);
        expect(result.timestamp_display).toMatch(displayPattern);
      }
    });
  });

  describe('timestamp_normalized correctness', () => {
    it('normalized Date represents the same instant as raw', () => {
      const result = normalizeTimestamp('2026/5/20 22:10');
      const d = result.timestamp_normalized;

      expect(d.getFullYear()).toBe(2026);
      expect(d.getMonth()).toBe(4); // May = 4 (0-indexed)
      expect(d.getDate()).toBe(20);
      expect(d.getHours()).toBe(22);
      expect(d.getMinutes()).toBe(10);
    });

    it('midnight parses correctly', () => {
      const result = normalizeTimestamp('2026/1/1 0:00');
      expect(result.timestamp_display).toBe('2026-01-01 00:00');
      expect(result.timestamp_normalized.getHours()).toBe(0);
      expect(result.timestamp_normalized.getMinutes()).toBe(0);
    });
  });

  describe('error handling (unparseable → typed error)', () => {
    it('throws TimestampParseError for empty string', () => {
      expect(() => normalizeTimestamp('')).toThrow(TimestampParseError);
    });

    it('throws TimestampParseError for invalid format', () => {
      expect(() => normalizeTimestamp('not a date')).toThrow(TimestampParseError);
    });

    it('throws TimestampParseError for partial format', () => {
      expect(() => normalizeTimestamp('2026/5/20')).toThrow(TimestampParseError);
    });

    it('throws TimestampParseError for invalid month (13)', () => {
      expect(() => normalizeTimestamp('2026/13/20 22:10')).toThrow(TimestampParseError);
    });

    it('throws TimestampParseError for invalid day (32)', () => {
      expect(() => normalizeTimestamp('2026/5/32 22:10')).toThrow(TimestampParseError);
    });

    it('throws TimestampParseError for invalid hour (25)', () => {
      expect(() => normalizeTimestamp('2026/5/20 25:10')).toThrow(TimestampParseError);
    });

    it('throws TimestampParseError for invalid minute (60)', () => {
      expect(() => normalizeTimestamp('2026/5/20 22:60')).toThrow(TimestampParseError);
    });

    it('throws TimestampParseError for Feb 30 (date overflow)', () => {
      expect(() => normalizeTimestamp('2026/2/30 10:00')).toThrow(TimestampParseError);
    });

    it('throws TimestampParseError for month 0', () => {
      expect(() => normalizeTimestamp('2026/0/20 10:00')).toThrow(TimestampParseError);
    });

    it('includes raw value in error', () => {
      try {
        normalizeTimestamp('garbage');
        expect.fail('should have thrown');
      } catch (e) {
        expect(e).toBeInstanceOf(TimestampParseError);
        expect((e as TimestampParseError).rawValue).toBe('garbage');
      }
    });
  });

  describe('trimming handling', () => {
    it('handles leading/trailing whitespace in input', () => {
      const result = normalizeTimestamp('  2026/5/20 22:10  ');
      expect(result.timestamp_raw).toBe('  2026/5/20 22:10  ');
      expect(result.timestamp_display).toBe('2026-05-20 22:10');
    });
  });
});
