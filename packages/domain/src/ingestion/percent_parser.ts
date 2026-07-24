/**
 * PercentParser — Parses percent strings to normalized decimals
 *
 * Converts strings like "30%" to 0.30, "5%" to 0.05, "100%" to 1.00.
 * Rejects strings without % suffix or non-numeric values.
 * The original string is kept immutable; only the normalized value is derived.
 *
 * @module domain/ingestion/percent_parser
 */

/** Error type for percent parsing failures */
export class PercentParseError extends Error {
  constructor(
    message: string,
    public readonly code: 'INVALID_FORMAT' | 'NON_NUMERIC',
    public readonly value: string,
  ) {
    super(message);
    this.name = 'PercentParseError';
  }
}

/**
 * Parse a percent string (e.g., "30%") to a normalized decimal (0.30).
 *
 * @param percentStr - Raw percent string from CSV (e.g., "5%", "30%", "45%")
 * @returns Normalized decimal value (e.g., 0.05, 0.30, 0.45)
 * @throws PercentParseError if the string doesn't end with % or contains non-numeric content
 */
export function parsePercent(percentStr: string): number {
  const trimmed = percentStr.trim();

  if (!trimmed.endsWith('%')) {
    throw new PercentParseError(
      `Expected percent string ending with "%", got "${trimmed}"`,
      'INVALID_FORMAT',
      trimmed,
    );
  }

  const numericPart = trimmed.slice(0, -1);

  if (numericPart.length === 0) {
    throw new PercentParseError(
      `Percent string has no numeric part: "${trimmed}"`,
      'NON_NUMERIC',
      trimmed,
    );
  }

  const numericValue = parseFloat(numericPart);

  if (isNaN(numericValue)) {
    throw new PercentParseError(
      `Non-numeric value in percent string: "${trimmed}"`,
      'NON_NUMERIC',
      trimmed,
    );
  }

  return numericValue / 100;
}
