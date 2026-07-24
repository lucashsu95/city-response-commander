/**
 * Crowd CSV Parser — signaling_crowd_density.csv
 *
 * Parses raw CSV string content into typed RawCrowdRecord[].
 * Preserves `timestamp_raw` and `Roaming_User_Pct` verbatim (never overwrites).
 * Derives `roaming_pct_value` via PercentParser (e.g., "30%" -> 0.30).
 * Validates column count, required fields, numeric types, and ranges.
 * Rejects on schema mismatch (no fabrication).
 *
 * @module domain/ingestion/crowd_parser
 */

import type { RawCrowdRecord } from '@city-commander/shared-schemas';
import { parsePercent, PercentParseError } from './percent_parser.js';

/** Error types for crowd parsing failures */
export class CrowdParseError extends Error {
  constructor(
    message: string,
    public readonly code: 'SCHEMA_MISMATCH' | 'INVALID_ROW' | 'EMPTY_DATA' | 'PERCENT_PARSE_ERROR',
    public readonly details?: { row?: number; field?: string; value?: string },
  ) {
    super(message);
    this.name = 'CrowdParseError';
  }
}

/** Expected CSV header columns (after BOM removal) */
const EXPECTED_COLUMNS = [
  'Timestamp',
  'BS_ID',
  'Location_Name',
  'User_Count',
  'Stay_Time_Avg',
  'Growth_Rate',
  'Roaming_User_Pct',
] as const;

const EXPECTED_COLUMN_COUNT = EXPECTED_COLUMNS.length;

/**
 * Remove UTF-8 BOM (U+FEFF) if present at the start of the string.
 */
function stripBom(content: string): string {
  if (content.charCodeAt(0) === 0xfeff) {
    return content.slice(1);
  }
  return content;
}

/**
 * Parse raw CSV content into typed RawCrowdRecord[].
 *
 * @param csvContent - Raw CSV string (may include BOM)
 * @returns Readonly array of RawCrowdRecord
 * @throws CrowdParseError on schema mismatch, invalid rows, or empty data
 */
export function parseCrowdCsv(
  csvContent: string,
): readonly RawCrowdRecord[] {
  const cleaned = stripBom(csvContent);

  // Split by CRLF or LF, filter out empty trailing lines
  const lines = cleaned.split(/\r?\n/).filter((line) => line.trim().length > 0);

  if (lines.length === 0) {
    throw new CrowdParseError(
      'CSV content is empty',
      'EMPTY_DATA',
    );
  }

  // Validate header row
  const headerLine = lines[0];
  const headers = headerLine.split(',');

  if (headers.length !== EXPECTED_COLUMN_COUNT) {
    throw new CrowdParseError(
      `Expected ${EXPECTED_COLUMN_COUNT} columns in header, got ${headers.length}`,
      'SCHEMA_MISMATCH',
      { row: 0 },
    );
  }

  for (let i = 0; i < EXPECTED_COLUMN_COUNT; i++) {
    if (headers[i].trim() !== EXPECTED_COLUMNS[i]) {
      throw new CrowdParseError(
        `Expected column "${EXPECTED_COLUMNS[i]}" at position ${i}, got "${headers[i].trim()}"`,
        'SCHEMA_MISMATCH',
        { row: 0, field: EXPECTED_COLUMNS[i], value: headers[i].trim() },
      );
    }
  }

  if (lines.length < 2) {
    throw new CrowdParseError(
      'CSV has no data rows',
      'EMPTY_DATA',
    );
  }

  // Parse data rows
  const records: RawCrowdRecord[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const fields = line.split(',');

    if (fields.length !== EXPECTED_COLUMN_COUNT) {
      throw new CrowdParseError(
        `Row ${i + 1}: expected ${EXPECTED_COLUMN_COUNT} fields, got ${fields.length}`,
        'INVALID_ROW',
        { row: i + 1 },
      );
    }

    const [
      timestamp_raw,
      BS_ID,
      Location_Name,
      userCountStr,
      stayTimeStr,
      growthRateStr,
      Roaming_User_Pct,
    ] = fields;

    // Validate required string fields are non-empty
    if (!timestamp_raw || timestamp_raw.trim().length === 0) {
      throw new CrowdParseError(
        `Row ${i + 1}: Timestamp is empty`,
        'INVALID_ROW',
        { row: i + 1, field: 'Timestamp' },
      );
    }

    if (!BS_ID || BS_ID.trim().length === 0) {
      throw new CrowdParseError(
        `Row ${i + 1}: BS_ID is empty`,
        'INVALID_ROW',
        { row: i + 1, field: 'BS_ID' },
      );
    }

    if (!Location_Name || Location_Name.trim().length === 0) {
      throw new CrowdParseError(
        `Row ${i + 1}: Location_Name is empty`,
        'INVALID_ROW',
        { row: i + 1, field: 'Location_Name' },
      );
    }

    // Parse and validate User_Count (integer)
    const User_Count = parseInt(userCountStr, 10);
    if (isNaN(User_Count)) {
      throw new CrowdParseError(
        `Row ${i + 1}: User_Count is not a valid integer: "${userCountStr}"`,
        'INVALID_ROW',
        { row: i + 1, field: 'User_Count', value: userCountStr },
      );
    }

    // Parse and validate Stay_Time_Avg (number)
    const Stay_Time_Avg = parseFloat(stayTimeStr);
    if (isNaN(Stay_Time_Avg)) {
      throw new CrowdParseError(
        `Row ${i + 1}: Stay_Time_Avg is not a valid number: "${stayTimeStr}"`,
        'INVALID_ROW',
        { row: i + 1, field: 'Stay_Time_Avg', value: stayTimeStr },
      );
    }

    // Parse and validate Growth_Rate (number)
    const Growth_Rate = parseFloat(growthRateStr);
    if (isNaN(Growth_Rate)) {
      throw new CrowdParseError(
        `Row ${i + 1}: Growth_Rate is not a valid number: "${growthRateStr}"`,
        'INVALID_ROW',
        { row: i + 1, field: 'Growth_Rate', value: growthRateStr },
      );
    }

    // Parse Roaming_User_Pct via PercentParser
    if (!Roaming_User_Pct || Roaming_User_Pct.trim().length === 0) {
      throw new CrowdParseError(
        `Row ${i + 1}: Roaming_User_Pct is empty`,
        'INVALID_ROW',
        { row: i + 1, field: 'Roaming_User_Pct' },
      );
    }

    let roaming_pct_value: number;
    try {
      roaming_pct_value = parsePercent(Roaming_User_Pct);
    } catch (e) {
      if (e instanceof PercentParseError) {
        throw new CrowdParseError(
          `Row ${i + 1}: Roaming_User_Pct parse error: ${e.message}`,
          'PERCENT_PARSE_ERROR',
          { row: i + 1, field: 'Roaming_User_Pct', value: Roaming_User_Pct },
        );
      }
      throw e;
    }

    const record: RawCrowdRecord = {
      timestamp_raw,
      BS_ID,
      Location_Name,
      User_Count,
      Stay_Time_Avg,
      Growth_Rate,
      Roaming_User_Pct,
      roaming_pct_value,
    };

    records.push(record);
  }

  return Object.freeze(records);
}
