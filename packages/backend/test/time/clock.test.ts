/**
 * Asia/Taipei (UTC+8) display-time unit tests.
 *
 * The property that matters: the same instant renders identically regardless of
 * the host timezone, so a demo laptop (UTC+8) and a Lambda (UTC) never disagree
 * by 8 hours. Format is `YYYY-MM-DD HH:MM` (SOP art.6).
 */

import { describe, it, expect } from 'vitest';
import {
  formatTaipeiDisplay,
  parseTaipeiDisplay,
  systemInjectionClock,
  taipeiClockAt,
  TAIPEI_UTC_OFFSET_MINUTES,
} from '../../src/index.js';

describe('TAIPEI_UTC_OFFSET_MINUTES', () => {
  it('is a fixed +480 minutes (no DST in Taiwan since 1980)', () => {
    expect(TAIPEI_UTC_OFFSET_MINUTES).toBe(480);
  });
});

describe('formatTaipeiDisplay', () => {
  it('renders UTC 14:10 as Taipei 22:10', () => {
    expect(formatTaipeiDisplay(Date.UTC(2026, 4, 20, 14, 10))).toBe('2026-05-20 22:10');
  });

  it('always emits YYYY-MM-DD HH:MM', () => {
    expect(formatTaipeiDisplay(Date.UTC(2026, 0, 2, 1, 5))).toBe('2026-01-02 09:05');
  });

  it('zero-pads month, day, hour and minute', () => {
    const display = formatTaipeiDisplay(Date.UTC(2026, 8, 9, 0, 1));

    expect(display).toBe('2026-09-09 08:01');
    expect(display).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });

  it('rolls the date forward across the UTC+8 day boundary', () => {
    // 2026-05-20 17:00 UTC is already 2026-05-21 01:00 in Taipei.
    expect(formatTaipeiDisplay(Date.UTC(2026, 4, 20, 17, 0))).toBe('2026-05-21 01:00');
  });

  it('handles the UTC midnight boundary', () => {
    expect(formatTaipeiDisplay(Date.UTC(2026, 4, 20, 0, 0))).toBe('2026-05-20 08:00');
  });

  it('handles a year boundary', () => {
    expect(formatTaipeiDisplay(Date.UTC(2025, 11, 31, 16, 30))).toBe('2026-01-01 00:30');
  });

  it('never applies daylight saving (July and January share the offset)', () => {
    const january = formatTaipeiDisplay(Date.UTC(2026, 0, 15, 12, 0));
    const july = formatTaipeiDisplay(Date.UTC(2026, 6, 15, 12, 0));

    expect(january).toBe('2026-01-15 20:00');
    expect(july).toBe('2026-07-15 20:00');
  });

  it('is independent of the host timezone (no local-time reads)', () => {
    // Same instant expressed two ways; a local-time implementation would drift.
    const epoch = Date.UTC(2026, 4, 20, 14, 10);

    expect(formatTaipeiDisplay(epoch)).toBe(formatTaipeiDisplay(new Date(epoch).getTime()));
  });

  it('rejects a non-finite epoch', () => {
    expect(() => formatTaipeiDisplay(Number.NaN)).toThrow(RangeError);
    expect(() => formatTaipeiDisplay(Number.POSITIVE_INFINITY)).toThrow(RangeError);
  });
});

describe('parseTaipeiDisplay', () => {
  it('inverts formatTaipeiDisplay at minute precision', () => {
    const epoch = Date.UTC(2026, 4, 20, 14, 10);

    expect(parseTaipeiDisplay(formatTaipeiDisplay(epoch))).toBe(epoch);
  });

  it('parses the official ACC_001 incident timestamp', () => {
    // live_incidents.json carries '2026-05-20 22:10' (Taipei local).
    expect(parseTaipeiDisplay('2026-05-20 22:10')).toBe(Date.UTC(2026, 4, 20, 14, 10));
  });

  it('round-trips across a day boundary', () => {
    const epoch = Date.UTC(2026, 4, 20, 17, 0);

    expect(parseTaipeiDisplay(formatTaipeiDisplay(epoch))).toBe(epoch);
  });

  it('returns null for a malformed string', () => {
    expect(parseTaipeiDisplay('2026/5/20 22:10')).toBeNull();
    expect(parseTaipeiDisplay('2026-05-20')).toBeNull();
    expect(parseTaipeiDisplay('2026-05-20 22:10:30')).toBeNull();
    expect(parseTaipeiDisplay('')).toBeNull();
  });
});

describe('taipeiClockAt', () => {
  it('pairs the epoch with its Taipei display string', () => {
    const epoch = Date.UTC(2026, 4, 20, 14, 10);

    expect(taipeiClockAt(epoch)).toEqual({
      nowEpochMs: epoch,
      nowDisplay: '2026-05-20 22:10',
    });
  });
});

describe('systemInjectionClock', () => {
  it('uses the injected now() and formats it in Taipei', () => {
    const epoch = Date.UTC(2026, 4, 20, 14, 10);

    expect(systemInjectionClock(() => epoch)).toEqual({
      nowEpochMs: epoch,
      nowDisplay: '2026-05-20 22:10',
    });
  });

  it('defaults to the ambient clock', () => {
    const clock = systemInjectionClock();

    expect(clock.nowEpochMs).toBeGreaterThan(0);
    expect(clock.nowDisplay).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
  });
});
