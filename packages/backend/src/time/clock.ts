/**
 * Display-time formatting, pinned to Asia/Taipei (UTC+8).
 *
 * Two decisions are locked here on purpose:
 *
 *  1. **Format** — `YYYY-MM-DD HH:MM`, mandated by SOP art.6 and used for every
 *     `created_at` / `updated_at` / display timestamp.
 *  2. **Timezone** — a FIXED `+08:00` offset. Lambda runs in UTC while a
 *     developer machine runs in local time, so reading the host timezone would
 *     make the same instant render 8 hours apart between the demo laptop and the
 *     deployed stack. Taiwan has observed no DST since 1980, so a fixed offset is
 *     exact rather than an approximation — no timezone database needed, and the
 *     result is identical on every host.
 *
 * All formatting takes an explicit epoch value; nothing here reads the ambient
 * clock except {@link systemInjectionClock}, which exists so handlers have one
 * obvious place to obtain "now".
 *
 * @module backend/time/clock
 */

import type { InjectionClock } from '../inject/first_lease.js';

/** Asia/Taipei offset. Fixed: Taiwan has not observed DST since 1980. */
export const TAIPEI_UTC_OFFSET_MINUTES = 8 * 60;

/** Milliseconds in the Asia/Taipei offset. */
const TAIPEI_OFFSET_MS = TAIPEI_UTC_OFFSET_MINUTES * 60 * 1000;

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/**
 * Format an epoch timestamp as `YYYY-MM-DD HH:MM` in Asia/Taipei.
 *
 * Implemented by shifting the instant by the fixed offset and then reading UTC
 * fields, which keeps the result independent of the host timezone.
 *
 * @throws RangeError when the epoch value is not finite
 *
 * @example
 * ```ts
 * formatTaipeiDisplay(Date.UTC(2026, 4, 20, 14, 10)); // '2026-05-20 22:10'
 * ```
 */
export function formatTaipeiDisplay(epochMs: number): string {
  if (!Number.isFinite(epochMs)) {
    throw new RangeError(`formatTaipeiDisplay requires a finite epoch, got ${String(epochMs)}.`);
  }

  const shifted = new Date(epochMs + TAIPEI_OFFSET_MS);
  const year = shifted.getUTCFullYear();
  const month = pad2(shifted.getUTCMonth() + 1);
  const day = pad2(shifted.getUTCDate());
  const hour = pad2(shifted.getUTCHours());
  const minute = pad2(shifted.getUTCMinutes());

  return `${year}-${month}-${day} ${hour}:${minute}`;
}

/**
 * Parse a `YYYY-MM-DD HH:MM` Asia/Taipei display string back to epoch ms.
 *
 * The inverse of {@link formatTaipeiDisplay} at minute precision. Used where an
 * official timestamp (`Incident.timestamp`, already in this shape) has to be
 * compared as an instant.
 *
 * @returns epoch milliseconds, or `null` when the string does not match
 */
export function parseTaipeiDisplay(display: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(display);
  if (!match) return null;

  const [, year, month, day, hour, minute] = match;
  const asUtc = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
  );
  return asUtc - TAIPEI_OFFSET_MS;
}

/**
 * Build an {@link InjectionClock} for a given instant, with the display string
 * rendered in Asia/Taipei.
 *
 * Prefer this over hand-building a clock so the offset lives in exactly one place.
 */
export function taipeiClockAt(epochMs: number): InjectionClock {
  return { nowEpochMs: epochMs, nowDisplay: formatTaipeiDisplay(epochMs) };
}

/**
 * The ambient clock, in Asia/Taipei.
 *
 * The only function in the module that reads `Date.now()`. Handlers call it once
 * per invocation and pass the result down, which keeps every module below them
 * deterministic and unit-testable.
 */
export function systemInjectionClock(now: () => number = Date.now): InjectionClock {
  return taipeiClockAt(now());
}
