/**
 * Incident JSON Parser — live_incidents.json
 *
 * Parses raw JSON content into typed Incident[].
 * Validates severity ∈ {Critical, High, Medium}.
 * Keeps `affected_road` optional — only present where provided in data.
 * Does not infer semantics of `affected_road` (deferred to Strategy B).
 *
 * @module domain/ingestion/incident_parser
 */

import type { Incident } from '@city-commander/shared-schemas';
import { IncidentType, IncidentStatus, IncidentSeverity } from '@city-commander/shared-schemas';

/** Error types for incident parsing failures */
export class IncidentParseError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'INVALID_JSON'
      | 'NOT_ARRAY'
      | 'INVALID_RECORD'
      | 'UNKNOWN_SEVERITY'
      | 'UNKNOWN_TYPE'
      | 'UNKNOWN_STATUS'
      | 'EMPTY_DATA',
    public readonly details?: { index?: number; field?: string; value?: string },
  ) {
    super(message);
    this.name = 'IncidentParseError';
  }
}

/** Valid IncidentType values as a Set for O(1) lookup */
const VALID_TYPES = new Set<string>(Object.values(IncidentType));

/** Valid IncidentStatus values as a Set for O(1) lookup */
const VALID_STATUSES = new Set<string>(Object.values(IncidentStatus));

/** Valid IncidentSeverity values as a Set for O(1) lookup */
const VALID_SEVERITIES = new Set<string>(Object.values(IncidentSeverity));

/**
 * Parse raw JSON content into typed Incident[].
 *
 * @param jsonContent - Raw JSON string representing an array of incident objects
 * @returns Readonly array of Incident
 * @throws IncidentParseError on invalid JSON, schema mismatch, or unknown severity
 */
export function parseIncidentsJson(jsonContent: string): readonly Incident[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonContent);
  } catch {
    throw new IncidentParseError('Failed to parse JSON content', 'INVALID_JSON');
  }

  if (!Array.isArray(parsed)) {
    throw new IncidentParseError('Expected JSON content to be an array', 'NOT_ARRAY');
  }

  if (parsed.length === 0) {
    throw new IncidentParseError('Incidents array is empty', 'EMPTY_DATA');
  }

  const records: Incident[] = [];

  for (let i = 0; i < parsed.length; i++) {
    const item = parsed[i];

    if (typeof item !== 'object' || item === null) {
      throw new IncidentParseError(
        `Index ${i}: expected an object, got ${typeof item}`,
        'INVALID_RECORD',
        { index: i },
      );
    }

    const obj = item as Record<string, unknown>;

    // Validate required string fields
    const requiredStringFields = [
      'event_id',
      'type',
      'location',
      'affected_segment',
      'status',
      'severity',
      'description',
      'timestamp',
    ] as const;

    for (const field of requiredStringFields) {
      if (typeof obj[field] !== 'string' || (obj[field] as string).trim().length === 0) {
        throw new IncidentParseError(
          `Index ${i}: field "${field}" must be a non-empty string`,
          'INVALID_RECORD',
          { index: i, field, value: String(obj[field] ?? 'undefined') },
        );
      }
    }

    const typeValue = obj['type'] as string;
    const statusValue = obj['status'] as string;
    const severityValue = obj['severity'] as string;

    // Validate type ∈ IncidentType enum
    if (!VALID_TYPES.has(typeValue)) {
      throw new IncidentParseError(
        `Index ${i}: unknown incident type "${typeValue}". ` +
          `Expected one of: ${[...VALID_TYPES].join(', ')}`,
        'UNKNOWN_TYPE',
        { index: i, field: 'type', value: typeValue },
      );
    }

    // Validate status ∈ IncidentStatus enum
    if (!VALID_STATUSES.has(statusValue)) {
      throw new IncidentParseError(
        `Index ${i}: unknown incident status "${statusValue}". ` +
          `Expected one of: ${[...VALID_STATUSES].join(', ')}`,
        'UNKNOWN_STATUS',
        { index: i, field: 'status', value: statusValue },
      );
    }

    // Validate severity ∈ {Critical, High, Medium}
    if (!VALID_SEVERITIES.has(severityValue)) {
      throw new IncidentParseError(
        `Index ${i}: unknown severity "${severityValue}". ` +
          `Expected one of: ${[...VALID_SEVERITIES].join(', ')}`,
        'UNKNOWN_SEVERITY',
        { index: i, field: 'severity', value: severityValue },
      );
    }

    // Handle optional `affected_road`
    let affected_road: string | undefined;
    if (obj['affected_road'] !== undefined && obj['affected_road'] !== null) {
      if (typeof obj['affected_road'] !== 'string') {
        throw new IncidentParseError(
          `Index ${i}: field "affected_road" must be a string if present`,
          'INVALID_RECORD',
          { index: i, field: 'affected_road', value: String(obj['affected_road']) },
        );
      }
      affected_road = obj['affected_road'] as string;
    }

    const record: Incident = {
      event_id: obj['event_id'] as string,
      type: typeValue as IncidentType,
      location: obj['location'] as string,
      affected_segment: obj['affected_segment'] as string,
      ...(affected_road !== undefined ? { affected_road } : {}),
      status: statusValue as IncidentStatus,
      severity: severityValue as IncidentSeverity,
      description: obj['description'] as string,
      timestamp: obj['timestamp'] as string,
    };

    records.push(record);
  }

  return Object.freeze(records);
}
