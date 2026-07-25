/**
 * Traffic CSV Parser — city_traffic_flow.csv
 *
 * Parses raw CSV string content into typed RawTrafficRecord[].
 * Preserves `timestamp_raw` verbatim (never overwrites).
 * Validates column count, required fields, and numeric types.
 * Rejects on schema mismatch (no fabrication).
 *
 * @module domain/ingestion/traffic_parser
 */

import type { RawTrafficRecord } from '@city-commander/shared-schemas';
import { LaneStatus } from '@city-commander/shared-schemas';

/** Error types for traffic parsing failures */
export class TrafficParseError extends Error {
  constructor(
    message: string,
    public readonly code: 'SCHEMA_MISMATCH' | 'INVALID_ROW' | 'EMPTY_DATA',
    public readonly details?: { row?: number; field?: string; value?: string },
  ) {
    super(message);
    this.name = 'TrafficParseError';
  }
}

/** Expected CSV header columns (after BOM removal) */
const EXPECTED_COLUMNS = [
  'Timestamp',
  'Segment_ID',
  'Road_Name',
  'Avg_Speed',
  'Vehicle_Count',
  'Saturation_Score',
  'Lane_Status',
] as const;

const EXPECTED_COLUMN_COUNT = EXPECTED_COLUMNS.length;

/** Valid LaneStatus values as a Set for O(1) lookup */
const VALID_LANE_STATUSES = new Set<string>(Object.values(LaneStatus));

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
 * Parse raw CSV content into typed RawTrafficRecord[].
 *
 * @param csvContent - Raw CSV string (may include BOM)
 * @returns Readonly array of RawTrafficRecord
 * @throws TrafficParseError on schema mismatch, invalid rows, or empty data
 */
export function parseTrafficCsv(csvContent: string): readonly RawTrafficRecord[] {
  const cleaned = stripBom(csvContent);

  // Split by CRLF or LF, filter out empty trailing lines
  const lines = cleaned.split(/\r?\n/).filter((line) => line.trim().length > 0);

  if (lines.length === 0) {
    throw new TrafficParseError('CSV content is empty', 'EMPTY_DATA');
  }

  // Validate header row
  const headerLine = lines[0];
  const headers = headerLine.split(',');

  if (headers.length !== EXPECTED_COLUMN_COUNT) {
    throw new TrafficParseError(
      `Expected ${EXPECTED_COLUMN_COUNT} columns in header, got ${headers.length}`,
      'SCHEMA_MISMATCH',
      { row: 0 },
    );
  }

  for (let i = 0; i < EXPECTED_COLUMN_COUNT; i++) {
    if (headers[i].trim() !== EXPECTED_COLUMNS[i]) {
      throw new TrafficParseError(
        `Expected column "${EXPECTED_COLUMNS[i]}" at position ${i}, got "${headers[i].trim()}"`,
        'SCHEMA_MISMATCH',
        { row: 0, field: EXPECTED_COLUMNS[i], value: headers[i].trim() },
      );
    }
  }

  if (lines.length < 2) {
    throw new TrafficParseError('CSV has no data rows', 'EMPTY_DATA');
  }

  // Parse data rows
  const records: RawTrafficRecord[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    const fields = line.split(',');

    if (fields.length !== EXPECTED_COLUMN_COUNT) {
      throw new TrafficParseError(
        `Row ${i + 1}: expected ${EXPECTED_COLUMN_COUNT} fields, got ${fields.length}`,
        'INVALID_ROW',
        { row: i + 1 },
      );
    }

    const [
      timestamp_raw,
      Segment_ID,
      Road_Name,
      avgSpeedStr,
      vehicleCountStr,
      saturationStr,
      laneStatusStr,
    ] = fields;

    // Validate required string fields are non-empty
    if (!timestamp_raw || timestamp_raw.trim().length === 0) {
      throw new TrafficParseError(`Row ${i + 1}: Timestamp is empty`, 'INVALID_ROW', {
        row: i + 1,
        field: 'Timestamp',
      });
    }

    if (!Segment_ID || Segment_ID.trim().length === 0) {
      throw new TrafficParseError(`Row ${i + 1}: Segment_ID is empty`, 'INVALID_ROW', {
        row: i + 1,
        field: 'Segment_ID',
      });
    }

    if (!Road_Name || Road_Name.trim().length === 0) {
      throw new TrafficParseError(`Row ${i + 1}: Road_Name is empty`, 'INVALID_ROW', {
        row: i + 1,
        field: 'Road_Name',
      });
    }

    // Parse and validate numeric fields
    const Avg_Speed = parseFloat(avgSpeedStr);
    if (isNaN(Avg_Speed)) {
      throw new TrafficParseError(
        `Row ${i + 1}: Avg_Speed is not a valid number: "${avgSpeedStr}"`,
        'INVALID_ROW',
        { row: i + 1, field: 'Avg_Speed', value: avgSpeedStr },
      );
    }

    const Vehicle_Count = parseInt(vehicleCountStr, 10);
    if (isNaN(Vehicle_Count)) {
      throw new TrafficParseError(
        `Row ${i + 1}: Vehicle_Count is not a valid integer: "${vehicleCountStr}"`,
        'INVALID_ROW',
        { row: i + 1, field: 'Vehicle_Count', value: vehicleCountStr },
      );
    }

    const Saturation_Score = parseFloat(saturationStr);
    if (isNaN(Saturation_Score)) {
      throw new TrafficParseError(
        `Row ${i + 1}: Saturation_Score is not a valid number: "${saturationStr}"`,
        'INVALID_ROW',
        { row: i + 1, field: 'Saturation_Score', value: saturationStr },
      );
    }

    if (Saturation_Score < 0 || Saturation_Score > 1) {
      throw new TrafficParseError(
        `Row ${i + 1}: Saturation_Score must be in [0, 1], got ${Saturation_Score}`,
        'INVALID_ROW',
        { row: i + 1, field: 'Saturation_Score', value: saturationStr },
      );
    }

    // Validate Lane_Status
    const trimmedLaneStatus = laneStatusStr.trim();
    if (!VALID_LANE_STATUSES.has(trimmedLaneStatus)) {
      throw new TrafficParseError(
        `Row ${i + 1}: Lane_Status "${trimmedLaneStatus}" is not a valid value. ` +
          `Expected one of: ${[...VALID_LANE_STATUSES].join(', ')}`,
        'INVALID_ROW',
        { row: i + 1, field: 'Lane_Status', value: trimmedLaneStatus },
      );
    }

    const record: RawTrafficRecord = {
      timestamp_raw,
      Segment_ID,
      Road_Name,
      Avg_Speed,
      Vehicle_Count,
      Saturation_Score,
      Lane_Status: trimmedLaneStatus as LaneStatus,
    };

    records.push(record);
  }

  return Object.freeze(records);
}
