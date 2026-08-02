/**
 * Percentage / Ratio Utilities
 *
 * Canonical representation: all internal values are ratios in [0, 1].
 * The UI multiplies by 100 only at display time.
 *
 * SOP thresholds (domain):
 *   Art.6 — Roaming_User_Pct >= 0.30 triggers multilingual alert
 *
 * Canonical rules:
 *   - domain / backend / API use ratio (0 to 1)
 *   - UI display multiplies by 100
 *   - average roaming = sum(valid ratios) / count(valid stations)
 *
 * @module frontend/utils/percentage
 */

/**
 * Formats a roaming ratio (0 to 1) for display as a percentage string.
 *
 * @param value - Ratio in [0, 1], or null/undefined/NaN for missing data
 * @param fractionDigits - Number of decimal places (default 1)
 * @returns e.g. "10.0%", "30.0%", "0.0%", or "無資料"
 */
export function formatRatioAsPercent(value: number | null | undefined, fractionDigits = 1): string {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return '無資料';
  }
  return `${(value * 100).toFixed(fractionDigits)}%`;
}

/**
 * Formats a roaming ratio for display as a numeric percentage (no % sign).
 *
 * @param value - Ratio in [0, 1], or null/undefined/NaN
 * @param fractionDigits - Number of decimal places (default 1)
 * @returns e.g. "10.0", "30.0", "0.0", or null for missing data
 */
export function formatRatioAsPercentNumber(
  value: number | null | undefined,
  fractionDigits = 1,
): string | null {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return null;
  }
  return (value * 100).toFixed(fractionDigits);
}

/**
 * Computes the bar width percentage (0 to 100) from a roaming ratio.
 * Clamps to [0, 100].
 *
 * @param value - Ratio in [0, 1], or null/undefined/NaN
 * @returns Width percentage for CSS (0 to 100), or 0 for missing data
 */
export function roamingBarWidth(value: number | null | undefined): number {
  if (value === null || value === undefined || !Number.isFinite(value)) {
    return 0;
  }
  return Math.min(100, value * 100);
}

/**
 * Computes the average roaming ratio across a list of station ratios.
 *
 * @param ratios - Array of roaming ratios (each in [0, 1]), may contain null/undefined
 * @returns Average ratio, or null if no valid values
 */
export function calculateAverageRatio(ratios: (number | null | undefined)[]): number | null {
  const valid = ratios.filter(
    (r): r is number => r !== null && r !== undefined && Number.isFinite(r),
  );
  if (valid.length === 0) return null;
  const sum = valid.reduce((acc, r) => acc + r, 0);
  return sum / valid.length;
}
