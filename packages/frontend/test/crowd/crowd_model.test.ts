/**
 * Crowd Read Model Decoder Tests (TASK-126)
 *
 * Verifies the `GET /crowd` boundary decoder: required envelope/station fields,
 * fail-closed behaviour for malformed values, and the zero-fabrication rule
 * (absent evidence decodes to `null`, never to a substituted value).
 */

import { describe, it, expect } from 'vitest';
import { decodeCrowdResponse } from '../../src/crowd/crowd_model.js';

function stationPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    BS_ID: 'BS_MRT_BL17',
    Location_Name: '捷運 BL17 站',
    User_Count: 31000,
    Growth_Rate: 0.42,
    roaming_pct_value: 0.45,
    Roaming_User_Pct: '45%',
    flags: ['SOP3_MRT_SHUTTLE'],
    in_multilingual_scope: true,
    observation_timestamp: '2026-05-20 22:15',
    exact_match: false,
    staleness_minutes: 5,
    stale: true,
    data_status: 'ready',
    ...overrides,
  };
}

function crowdPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_version: '1.0',
    trace_id: 'tr-crowd-1',
    data_status: 'ready',
    decision_cutoff_timestamp: '2026-05-20 22:20',
    provisional: true,
    policy: {
      classification: 'PROVISIONAL_TEAM_POLICY',
      status: 'AWAITING_HOST_REPLY',
      is_official: false,
      guidance_id: 'HG-001',
      multilingual_scope: { mode: 'current_snapshot_all_available_stations' },
    },
    stations: [stationPayload()],
    multilingual: {
      triggered: true,
      multilingual_required: true,
      triggering_station_ids: ['BS_MRT_BL17'],
      data_status: 'ready',
      scope_mode: 'current_snapshot_all_available_stations',
      stations_in_scope: ['BS_MRT_BL17'],
    },
    ...overrides,
  };
}

describe('decodeCrowdResponse', () => {
  it('decodes a full payload verbatim', () => {
    const result = decodeCrowdResponse(crowdPayload());

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.model.schemaVersion).toBe('1.0');
    expect(result.model.traceId).toBe('tr-crowd-1');
    expect(result.model.dataStatus).toBe('ready');
    expect(result.model.decisionCutoffTimestamp).toBe('2026-05-20 22:20');
    expect(result.model.provisional).toBe(true);
    expect(result.model.policy?.multilingualScopeMode).toBe(
      'current_snapshot_all_available_stations',
    );
    expect(result.model.multilingual?.triggered).toBe(true);

    const [station] = result.model.stations;
    expect(station?.bsId).toBe('BS_MRT_BL17');
    expect(station?.userCount).toBe(31000);
    expect(station?.growthRate).toBe(0.42);
    expect(station?.roamingPctValue).toBe(0.45);
    expect(station?.roamingPctDisplay).toBe('45%');
    expect(station?.flags).toEqual(['SOP3_MRT_SHUTTLE']);
    expect(station?.observationTimestamp).toBe('2026-05-20 22:15');
    expect(station?.stalenessMinutes).toBe(5);
    expect(station?.stale).toBe(true);
    expect(station?.exactMatch).toBe(false);
    expect(station?.inMultilingualScope).toBe(true);
    expect(station?.dataStatus).toBe('ready');
  });

  it('rejects a non-object body', () => {
    const result = decodeCrowdResponse('not-json-object');
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('NOT_AN_OBJECT');
  });

  it.each([
    ['schema_version', 'MISSING_SCHEMA_VERSION'],
    ['trace_id', 'MISSING_TRACE_ID'],
    ['data_status', 'MISSING_DATA_STATUS'],
  ])('fails when the required envelope field %s is missing', (field, expectedCode) => {
    const payload = crowdPayload();
    delete payload[field];

    const result = decodeCrowdResponse(payload);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe(expectedCode);
  });

  it('fails when data_status is not one of the two backend values', () => {
    const result = decodeCrowdResponse(crowdPayload({ data_status: 'READY' }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INVALID_DATA_STATUS');
  });

  it('fails when stations is missing rather than assuming an empty list', () => {
    const payload = crowdPayload();
    delete payload['stations'];

    const result = decodeCrowdResponse(payload);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('MISSING_STATIONS');
  });

  it('fails when a station omits flags, so no SOP verdict is inferred client-side', () => {
    const station = stationPayload();
    delete station['flags'];

    const result = decodeCrowdResponse(crowdPayload({ stations: [station] }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('MISSING_STATION_FLAGS');
  });

  it('fails when a station omits BS_ID', () => {
    const station = stationPayload();
    delete station['BS_ID'];

    const result = decodeCrowdResponse(crowdPayload({ stations: [station] }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('MISSING_STATION_ID');
  });

  it('fails a malformed observation timestamp instead of repairing it', () => {
    const result = decodeCrowdResponse(
      crowdPayload({ stations: [stationPayload({ observation_timestamp: '2026/05/20 22:15' })] }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INVALID_STATION_FIELD');
  });

  it('fails a wrong-typed station reading instead of coercing it', () => {
    const result = decodeCrowdResponse(
      crowdPayload({ stations: [stationPayload({ User_Count: '31000' })] }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INVALID_STATION_FIELD');
  });

  it('reports null readings as null, never as zero', () => {
    const result = decodeCrowdResponse(
      crowdPayload({
        stations: [
          stationPayload({
            User_Count: null,
            Growth_Rate: null,
            roaming_pct_value: null,
            Roaming_User_Pct: null,
            Location_Name: null,
            observation_timestamp: null,
            staleness_minutes: null,
            flags: [],
            data_status: 'insufficient_data',
          }),
        ],
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const [station] = result.model.stations;
    expect(station?.userCount).toBeNull();
    expect(station?.growthRate).toBeNull();
    expect(station?.roamingPctValue).toBeNull();
    expect(station?.roamingPctDisplay).toBeNull();
    expect(station?.observationTimestamp).toBeNull();
    expect(station?.stalenessMinutes).toBeNull();
    expect(station?.flags).toEqual([]);
    expect(station?.dataStatus).toBe('insufficient_data');
  });

  it('decodes the insufficient_data envelope with its stop_reason', () => {
    const result = decodeCrowdResponse(
      crowdPayload({
        data_status: 'insufficient_data',
        stop_reason: 'source manifest hash mismatch',
        stations: [],
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.dataStatus).toBe('insufficient_data');
    expect(result.model.stopReason).toBe('source manifest hash mismatch');
    expect(result.model.stations).toEqual([]);
  });

  it('reports absent optional evidence as null instead of inventing it', () => {
    const payload = crowdPayload();
    delete payload['policy'];
    delete payload['multilingual'];
    delete payload['provisional'];
    delete payload['decision_cutoff_timestamp'];

    const result = decodeCrowdResponse(payload);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.policy).toBeNull();
    expect(result.model.multilingual).toBeNull();
    expect(result.model.provisional).toBeNull();
    expect(result.model.decisionCutoffTimestamp).toBeNull();
  });

  it('fails a malformed multilingual block', () => {
    const result = decodeCrowdResponse(
      crowdPayload({ multilingual: { triggered: 'yes', multilingual_required: true } }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INVALID_MULTILINGUAL');
  });

  it('fails a malformed policy block', () => {
    const result = decodeCrowdResponse(crowdPayload({ policy: { is_official: 'false' } }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INVALID_POLICY');
  });

  it('preserves unknown flag codes rather than dropping backend truth', () => {
    const result = decodeCrowdResponse(
      crowdPayload({ stations: [stationPayload({ flags: ['SOP9_FUTURE_RULE'] })] }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.stations[0]?.flags).toEqual(['SOP9_FUTURE_RULE']);
  });

  it('preserves station order exactly as received', () => {
    const result = decodeCrowdResponse(
      crowdPayload({
        stations: [
          stationPayload({ BS_ID: 'BS_XY_ATT' }),
          stationPayload({ BS_ID: 'BS_MRT_BL17' }),
        ],
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.model.stations.map((station) => station.bsId)).toEqual([
      'BS_XY_ATT',
      'BS_MRT_BL17',
    ]);
  });
});
