/**
 * Timeline Read Model Decoder Tests (TASK-124)
 *
 * Exercises the frontend-owned runtime boundary decoder for `GET /timeline`.
 * No canonical `GetTimelineResponse` exists yet, so this validates the
 * decoder's fail-closed behavior against unvalidated `unknown` JSON.
 */

import { describe, it, expect } from 'vitest';
import {
  decodeTimelineResponse,
  formatTimelineTimestamp,
  isValidTimelineTimestamp,
} from '../../src/timeline/timeline_model.js';

/** Standard envelope fields every valid fixture must carry (FIX 3). */
const VALID_ENVELOPE = {
  schema_version: '1.0',
  trace_id: 'tr-1',
  provisional: true,
};

describe('isValidTimelineTimestamp', () => {
  it('accepts a well-formed YYYY-MM-DD HH:MM value', () => {
    expect(isValidTimelineTimestamp('2026-05-20 22:10')).toBe(true);
  });

  it.each([
    '2026-05-20T22:10',
    '2026-05-20 22:10:00',
    '2026-5-20 22:10',
    '2026-05-20 22:10Z',
    '2026-05-20',
    '',
    'not-a-date',
    '2026-13-01 00:00',
    '2026-05-32 00:00',
    '2026-05-01 24:00',
    '2026-05-01 00:60',
  ])('rejects malformed value %s', (value) => {
    expect(isValidTimelineTimestamp(value)).toBe(false);
  });

  // Optional low-cost quality fix: calendar-impossible dates must be
  // rejected using a pure days-in-month/leap-year rule, never Date/Date.parse.
  it.each([
    '2026-02-31 00:00', // February never has 31 days
    '2026-04-31 00:00', // April has 30 days
    '2026-02-29 00:00', // 2026 is not a leap year
  ])('rejects calendar-impossible date %s', (value) => {
    expect(isValidTimelineTimestamp(value)).toBe(false);
  });

  it('accepts February 29 in a leap year', () => {
    expect(isValidTimelineTimestamp('2028-02-29 00:00')).toBe(true);
  });
});

describe('formatTimelineTimestamp', () => {
  it('passes through a valid timestamp unchanged', () => {
    const result = formatTimelineTimestamp('2026-05-20 22:10');
    expect(result).toEqual({ ok: true, text: '2026-05-20 22:10' });
  });

  it('never shifts the value (no timezone conversion)', () => {
    // A value that would be reinterpreted if run through `Date` in the
    // browser's local timezone must still come back byte-for-byte identical.
    const result = formatTimelineTimestamp('2026-01-01 00:00');
    expect(result).toEqual({ ok: true, text: '2026-01-01 00:00' });
  });

  it('reports unavailable for null', () => {
    expect(formatTimelineTimestamp(null)).toEqual({ ok: false });
  });

  it('reports unavailable for malformed input instead of repairing it', () => {
    expect(formatTimelineTimestamp('garbage')).toEqual({ ok: false });
  });
});

describe('decodeTimelineResponse', () => {
  it('accepts a minimal valid response and preserves timestamp order', () => {
    const raw = {
      timestamps: ['2026-05-20 22:00', '2026-05-20 22:10', '2026-05-20 22:20'],
      current: '2026-05-20 22:10',
      ...VALID_ENVELOPE,
    };

    const result = decodeTimelineResponse(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.model.timestamps).toEqual([
        '2026-05-20 22:00',
        '2026-05-20 22:10',
        '2026-05-20 22:20',
      ]);
      expect(result.model.current).toBe('2026-05-20 22:10');
    }
  });

  it('preserves server order even when timestamps are not sorted', () => {
    const raw = {
      timestamps: ['2026-05-20 22:20', '2026-05-20 22:00', '2026-05-20 22:10'],
      current: '2026-05-20 22:00',
      ...VALID_ENVELOPE,
    };

    const result = decodeTimelineResponse(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Exactly as received — the decoder must never sort.
      expect(result.model.timestamps).toEqual([
        '2026-05-20 22:20',
        '2026-05-20 22:00',
        '2026-05-20 22:10',
      ]);
    }
  });

  it('accepts an empty timeline with current: null', () => {
    const result = decodeTimelineResponse({ timestamps: [], current: null, ...VALID_ENVELOPE });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.model.timestamps).toEqual([]);
      expect(result.model.current).toBeNull();
    }
  });

  it('preserves the required envelope fields exactly as received', () => {
    const raw = {
      timestamps: ['2026-05-20 22:00'],
      current: '2026-05-20 22:00',
      schema_version: '1.0',
      trace_id: 'tr-1',
      provisional: true,
    };
    const result = decodeTimelineResponse(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.model.schemaVersion).toBe('1.0');
      expect(result.model.traceId).toBe('tr-1');
      expect(result.model.provisional).toBe(true);
    }
  });

  it('decodes HG-001 timing evidence verbatim when present', () => {
    const raw = {
      timestamps: ['2026-05-20 22:10'],
      current: '2026-05-20 22:10',
      ...VALID_ENVELOPE,
      event_timestamp: '2026-05-20 22:15',
      decision_cutoff_timestamp: '2026-05-20 22:15',
      observation_timestamp: '2026-05-20 22:10',
      staleness_minutes: 5,
      selection_mode: 'GLOBAL_AS_OF_EVENT_CUTOFF_LATEST_PRIOR_PER_ENTITY',
      guidance_id: 'HG-001',
    };
    const result = decodeTimelineResponse(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.model.timing).toEqual({
        eventTimestamp: '2026-05-20 22:15',
        decisionCutoffTimestamp: '2026-05-20 22:15',
        observationTimestamp: '2026-05-20 22:10',
        stalenessMinutes: 5,
        selectionMode: 'GLOBAL_AS_OF_EVENT_CUTOFF_LATEST_PRIOR_PER_ENTITY',
        guidanceId: 'HG-001',
      });
    }
  });

  it('reports HG-001 fields as unavailable (null) when omitted, never fabricated', () => {
    const raw = {
      timestamps: ['2026-05-20 22:10'],
      current: '2026-05-20 22:10',
      ...VALID_ENVELOPE,
    };
    const result = decodeTimelineResponse(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.model.timing).toEqual({
        eventTimestamp: null,
        decisionCutoffTimestamp: null,
        observationTimestamp: null,
        stalenessMinutes: null,
        selectionMode: null,
        guidanceId: null,
      });
    }
  });

  it('rejects a non-object response', () => {
    const result = decodeTimelineResponse('not-an-object');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('NOT_AN_OBJECT');
    }
  });

  it('rejects a response with missing timestamps', () => {
    const result = decodeTimelineResponse({ current: null, ...VALID_ENVELOPE });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('MISSING_TIMESTAMPS');
    }
  });

  it('rejects a response where timestamps is not an array', () => {
    const result = decodeTimelineResponse({
      timestamps: 'oops',
      current: null,
      ...VALID_ENVELOPE,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('MISSING_TIMESTAMPS');
    }
  });

  it('rejects a response with a non-string timestamp element', () => {
    const result = decodeTimelineResponse({
      timestamps: ['2026-05-20 22:00', 42],
      current: '2026-05-20 22:00',
      ...VALID_ENVELOPE,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_TIMESTAMPS');
    }
  });

  it('rejects a response with a malformed timestamp string', () => {
    const result = decodeTimelineResponse({
      timestamps: ['2026-05-20 22:00', 'not-a-date'],
      current: '2026-05-20 22:00',
      ...VALID_ENVELOPE,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_TIMESTAMP_FORMAT');
    }
  });

  it('rejects a response missing current', () => {
    const result = decodeTimelineResponse({
      timestamps: ['2026-05-20 22:00'],
      ...VALID_ENVELOPE,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('MISSING_CURRENT');
    }
  });

  it('rejects current: null when timestamps is non-empty (never infers a position)', () => {
    const result = decodeTimelineResponse({
      timestamps: ['2026-05-20 22:00'],
      current: null,
      ...VALID_ENVELOPE,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_CURRENT');
    }
  });

  it('rejects a current value not present in timestamps (never fabricates position)', () => {
    const result = decodeTimelineResponse({
      timestamps: ['2026-05-20 22:00', '2026-05-20 22:10'],
      current: '2026-05-20 23:00',
      ...VALID_ENVELOPE,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('CURRENT_NOT_IN_TIMESTAMPS');
    }
  });

  it('rejects a non-string, non-null current', () => {
    const result = decodeTimelineResponse({ timestamps: [], current: 42, ...VALID_ENVELOPE });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_CURRENT');
    }
  });

  // ─── FIX 3: required standard response envelope ────────────

  it('rejects a response missing schema_version', () => {
    const result = decodeTimelineResponse({
      timestamps: [],
      current: null,
      trace_id: 'tr-1',
      provisional: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('MISSING_SCHEMA_VERSION');
    }
  });

  it('rejects a response missing trace_id', () => {
    const result = decodeTimelineResponse({
      timestamps: [],
      current: null,
      schema_version: '1.0',
      provisional: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('MISSING_TRACE_ID');
    }
  });

  it('rejects a response missing provisional', () => {
    const result = decodeTimelineResponse({
      timestamps: [],
      current: null,
      schema_version: '1.0',
      trace_id: 'tr-1',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('MISSING_PROVISIONAL');
    }
  });

  it('rejects an empty schema_version', () => {
    const result = decodeTimelineResponse({
      timestamps: [],
      current: null,
      schema_version: '',
      trace_id: 'tr-1',
      provisional: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_SCHEMA_VERSION');
    }
  });

  it('rejects an empty trace_id', () => {
    const result = decodeTimelineResponse({
      timestamps: [],
      current: null,
      schema_version: '1.0',
      trace_id: '   ',
      provisional: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_TRACE_ID');
    }
  });

  it('rejects wrong-typed schema_version instead of silently ignoring it', () => {
    const result = decodeTimelineResponse({
      timestamps: [],
      current: null,
      schema_version: 42,
      trace_id: 'tr-1',
      provisional: true,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_SCHEMA_VERSION');
    }
  });

  it('rejects wrong-typed provisional instead of silently ignoring it', () => {
    const result = decodeTimelineResponse({
      timestamps: [],
      current: null,
      schema_version: '1.0',
      trace_id: 'tr-1',
      provisional: 'true',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_PROVISIONAL');
    }
  });

  it('preserves a valid envelope exactly (no fabricated defaults)', () => {
    const result = decodeTimelineResponse({
      timestamps: [],
      current: null,
      schema_version: '2.3',
      trace_id: 'tr-xyz',
      provisional: false,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.model.schemaVersion).toBe('2.3');
      expect(result.model.traceId).toBe('tr-xyz');
      expect(result.model.provisional).toBe(false);
    }
  });

  it('rejects wrong-typed HG-001 staleness_minutes instead of silently ignoring it', () => {
    const result = decodeTimelineResponse({
      timestamps: ['2026-05-20 22:00'],
      current: '2026-05-20 22:00',
      ...VALID_ENVELOPE,
      staleness_minutes: 'five',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('MALFORMED_OPTIONAL_FIELD');
    }
  });

  it('rejects a malformed HG-001 timestamp field', () => {
    const result = decodeTimelineResponse({
      timestamps: ['2026-05-20 22:00'],
      current: '2026-05-20 22:00',
      ...VALID_ENVELOPE,
      event_timestamp: 'not-a-timestamp',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('MALFORMED_OPTIONAL_FIELD');
    }
  });

  it('never fabricates data on an invalid response (result carries no model)', () => {
    const result = decodeTimelineResponse({ timestamps: [1, 2, 3] });
    expect(result.ok).toBe(false);
    // TypeScript's discriminated union already guarantees no `.model` exists
    // on the error branch; this assertion documents that guarantee.
    expect('model' in result).toBe(false);
  });
});
