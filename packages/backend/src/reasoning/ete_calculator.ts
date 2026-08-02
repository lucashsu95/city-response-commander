/**
 * ETE Calculator — deterministic SOP-7 formula parser and calculation trace builder.
 *
 * Extracts the actual ETE formula from the SOP Article 7 text:
 *   ETE_minutes = base_clearance + congestion_penalty
 *   congestion_penalty = max(0, (avg_saturation - 0.5) × 60)
 *   base_clearance: Critical=60, High=40, Medium=20
 *
 * Guarantees:
 *  - result_minutes is NOT fabricated when inputs are missing
 *  - recovery_at = base_timestamp + result_minutes (when result is available)
 *  - No LLM call — purely arithmetic
 *
 * @module backend/reasoning/ete_calculator
 */

import type { EteCalculationTrace, EteCalculationVariable } from '@city-commander/shared-schemas';

/** Canonical SOP-7 formula text */
export const SOP7_FORMULA = 'ETE_minutes = base_clearance + congestion_penalty';

/** SOP-7 congestion_penalty sub-formula */
export const SOP7_CONGESTION_PENALTY = 'congestion_penalty = max(0, (avg_saturation - 0.5) × 60)';

/** base_clearance table */
export const BASE_CLEARANCE_TABLE: ReadonlyMap<string, number> = new Map([
  ['Critical', 60],
  ['High', 40],
  ['Medium', 20],
]);

/** Standard timezone for demo data (Asia/Taipei = UTC+8) */
export const DEFAULT_TIMEZONE = 'Asia/Taipei';

/**
 * Input values required to compute the ETE formula.
 * Any missing value results in `missing_inputs` in the trace.
 */
export interface EteCalculationInputs {
  readonly severity: string | null;
  /** Average saturation score across affected road segments (0.0-1.0) */
  readonly avgSaturation: number | null;
  /** Event timestamp or assumption timestamp used as base for recovery_at */
  readonly baseTimestamp: string;
  readonly timezone?: string;
}

/**
 * Compute ETE and build a complete `EteCalculationTrace`.
 *
 * When `severity` or `avgSaturation` is null, `result_minutes` is null
 * and the missing inputs are listed in `missing_inputs`.
 *
 * @param inputs — required formula inputs (nullable for missing data)
 * @param article7Text — verbatim SOP Article 7 text (used to validate formula)
 * @returns EteCalculationTrace (deterministic — no LLM call)
 */
export function computeEte(
  inputs: EteCalculationInputs,
  article7Text?: string,
): EteCalculationTrace {
  const { severity, avgSaturation, baseTimestamp, timezone = DEFAULT_TIMEZONE } = inputs;

  const variables: EteCalculationVariable[] = [];
  const missingInputs: string[] = [];

  // ── base_clearance ──────────────────────────────────────────
  let baseClearance: number | null = null;
  if (severity !== null && BASE_CLEARANCE_TABLE.has(severity)) {
    baseClearance = BASE_CLEARANCE_TABLE.get(severity)!;
    variables.push({
      name: 'base_clearance',
      value: baseClearance,
      unit: '分鐘',
      source: `incident.severity=${severity}`,
    });
  } else {
    missingInputs.push('base_clearance (severity missing or unknown)');
    variables.push({
      name: 'base_clearance',
      value: 0,
      unit: '分鐘',
      source: 'missing',
    });
  }

  // ── avg_saturation ──────────────────────────────────────────
  let avgSat: number | null = null;
  if (avgSaturation !== null && Number.isFinite(avgSaturation)) {
    avgSat = avgSaturation;
    variables.push({
      name: 'avg_saturation',
      value: avgSat,
      unit: 'ratio',
      source: 'traffic.saturation_score',
    });
  } else {
    missingInputs.push('avg_saturation');
    variables.push({
      name: 'avg_saturation',
      value: 0,
      unit: 'ratio',
      source: 'missing',
    });
  }

  // ── congestion_penalty ─────────────────────────────────────
  let congestionPenalty: number | null = null;
  if (avgSat !== null) {
    congestionPenalty = Math.max(0, (avgSat - 0.5) * 60);
    variables.push({
      name: 'congestion_penalty',
      value: congestionPenalty,
      unit: '分鐘',
      source: 'computed',
    });
  } else {
    missingInputs.push('congestion_penalty');
    variables.push({
      name: 'congestion_penalty',
      value: 0,
      unit: '分鐘',
      source: 'missing',
    });
  }

  // ── ETE result ─────────────────────────────────────────────
  let resultMinutes: number | null = null;
  let substitution = '';
  if (baseClearance !== null && congestionPenalty !== null) {
    resultMinutes = baseClearance + congestionPenalty;
    substitution = `${baseClearance} + ${congestionPenalty} = ${resultMinutes}`;
    variables.push({
      name: 'ETE_minutes',
      value: resultMinutes,
      unit: '分鐘',
      source: 'computed',
    });
  } else {
    substitution = '無法計算（缺少必要輸入）';
  }

  // ── recovery_at ────────────────────────────────────────────
  let recoveryAt: string | null = null;
  if (resultMinutes !== null) {
    recoveryAt = addMinutesToTimestamp(baseTimestamp, resultMinutes, timezone);
  }

  // ── formula text ───────────────────────────────────────────
  const formulaText = article7Text ? extractFormulaFromArticle7(article7Text) : SOP7_FORMULA;

  return Object.freeze({
    source_article: 7,
    formula: formulaText,
    variables: Object.freeze(variables),
    substitution,
    result_minutes: resultMinutes,
    base_timestamp: baseTimestamp,
    timezone,
    recovery_at: recoveryAt,
    missing_inputs: Object.freeze([...missingInputs]),
  });
}

/**
 * Extract the ETE formula text from SOP Article 7 verbatim content.
 * Returns the canonical formula if extraction fails.
 */
function extractFormulaFromArticle7(text: string): string {
  // The formula is on the first line of the article: "ETE_minutes = ..."
  const lines = text.split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('ETE_minutes')) {
      return trimmed;
    }
  }
  return SOP7_FORMULA;
}

/**
 * Add `minutes` to `timestamp` (YYYY-MM-DD HH:MM format) in the given timezone.
 * Uses simple calendar arithmetic (assumes UTC+8, no DST for demo data).
 */
function addMinutesToTimestamp(timestamp: string, minutes: number, timezone: string): string {
  // Parse YYYY-MM-DD HH:MM
  const match = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/.exec(timestamp);
  if (!match) return `${timestamp} (解析失敗)`;

  const [, year, month, day, hour, minute] = match.map(Number);

  // Build a Date in local time (UTC offset assumed for timezone)
  const tzOffsetMinutes = getTzOffsetMinutes(timezone);
  const totalMs =
    Date.UTC(year, month - 1, day, hour, minute, 0, 0) +
    tzOffsetMinutes * 60_000 +
    minutes * 60_000;

  const d = new Date(totalMs);
  const adj = new Date(d.getTime() - tzOffsetMinutes * 60_000);

  const yyyy = adj.getUTCFullYear();
  const mm = String(adj.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(adj.getUTCDate()).padStart(2, '0');
  const hh = String(adj.getUTCHours()).padStart(2, '0');
  const min = String(adj.getUTCMinutes()).padStart(2, '0');

  return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
}

function getTzOffsetMinutes(tz: string): number {
  switch (tz) {
    case 'Asia/Taipei':
    case 'UTC+8':
      return 8 * 60;
    case 'UTC':
    case 'UTC+0':
      return 0;
    default:
      return 8 * 60; // Default to Taipei
  }
}
