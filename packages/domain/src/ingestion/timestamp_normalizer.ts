/**
 * Timestamp Normalizer
 *
 * Produces `timestamp_normalized` (Date for comparison) and
 * `timestamp_display` (YYYY-MM-DD HH:MM format) while `timestamp_raw`
 * is never overwritten (§10.1/§10.2, R11.5).
 *
 * Supported input formats:
 * - "2026/5/20 22:10" — no zero-pad, slash separator
 * - "2026-05-20 22:10" — already normalized (dash, zero-padded)
 *
 * Unparseable timestamps produce a typed error (no guessing).
 *
 * @module domain/ingestion/timestamp_normalizer
 */

/** Result of timestamp normalization */
export interface NormalizedTimestamp {
  /** Original timestamp string, never modified */
  readonly timestamp_raw: string;
  /** JS Date for comparison and sorting */
  readonly timestamp_normalized: Date;
  /** Formatted display string: "YYYY-MM-DD HH:MM" */
  readonly timestamp_display: string;
}

/** Error for unparseable timestamps */
export class TimestampParseError extends Error {
  constructor(
    message: string,
    public readonly rawValue: string,
  ) {
    super(message);
    this.name = 'TimestampParseError';
  }
}

/**
 * Pattern for "YYYY/M/D HH:MM" or "YYYY/MM/DD HH:MM" (slash separator, optional zero-pad)
 */
const SLASH_PATTERN = /^(\d{4})\/(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})$/;

/**
 * Pattern for "YYYY-MM-DD HH:MM" (dash separator, already normalized)
 */
const DASH_PATTERN = /^(\d{4})-(\d{1,2})-(\d{1,2})\s+(\d{1,2}):(\d{2})$/;

/**
 * Zero-pad a number to at least 2 digits.
 */
function pad2(n: number): string {
  return n < 10 ? `0${n}` : String(n);
}

/**
 * Normalize a raw timestamp string into a NormalizedTimestamp.
 *
 * Guarantees:
 * - `timestamp_raw` is byte-identical to the input (never mutated)
 * - `timestamp_display` is always in "YYYY-MM-DD HH:MM" format
 * - `timestamp_normalized` denotes the same instant as the raw string
 *
 * @param raw - The raw timestamp string from official data
 * @returns NormalizedTimestamp
 * @throws TimestampParseError if the raw string cannot be parsed
 */
export function normalizeTimestamp(raw: string): NormalizedTimestamp {
  const trimmed = raw.trim();

  // Try slash format first (e.g., "2026/5/20 22:10")
  let match = SLASH_PATTERN.exec(trimmed);
  if (!match) {
    // Try dash format (e.g., "2026-05-20 22:10")
    match = DASH_PATTERN.exec(trimmed);
  }

  if (!match) {
    throw new TimestampParseError(
      `Cannot parse timestamp: "${raw}". Expected format "YYYY/M/D HH:MM" or "YYYY-MM-DD HH:MM".`,
      raw,
    );
  }

  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);
  const hour = parseInt(match[4], 10);
  const minute = parseInt(match[5], 10);

  // Validate ranges
  if (month < 1 || month > 12) {
    throw new TimestampParseError(`Invalid month ${month} in timestamp: "${raw}".`, raw);
  }

  if (day < 1 || day > 31) {
    throw new TimestampParseError(`Invalid day ${day} in timestamp: "${raw}".`, raw);
  }

  if (hour < 0 || hour > 23) {
    throw new TimestampParseError(`Invalid hour ${hour} in timestamp: "${raw}".`, raw);
  }

  if (minute < 0 || minute > 59) {
    throw new TimestampParseError(`Invalid minute ${minute} in timestamp: "${raw}".`, raw);
  }

  // Construct a Date object (local time, as no timezone is specified in the data)
  const timestamp_normalized = new Date(year, month - 1, day, hour, minute);

  // Verify the Date constructor didn't roll over (e.g., Feb 30 -> Mar 2)
  if (
    timestamp_normalized.getFullYear() !== year ||
    timestamp_normalized.getMonth() !== month - 1 ||
    timestamp_normalized.getDate() !== day
  ) {
    throw new TimestampParseError(
      `Invalid date in timestamp: "${raw}" (date components overflow).`,
      raw,
    );
  }

  // Format display as "YYYY-MM-DD HH:MM"
  const timestamp_display = `${year}-${pad2(month)}-${pad2(day)} ${pad2(hour)}:${pad2(minute)}`;

  return {
    timestamp_raw: raw,
    timestamp_normalized,
    timestamp_display,
  };
}
