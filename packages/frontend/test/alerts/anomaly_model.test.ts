/**
 * Anomaly Model Tests (TASK-127)
 *
 * Pure decode/signal-reading tests. No timers, no HTTP, no wall-clock.
 *
 * The truth-boundary cases are the point of this file: contradictory fixtures
 * prove the client follows the backend's verdict and never the raw metric.
 */

import { describe, it, expect } from 'vitest';
import {
  ANOMALY_EVENT_TYPE,
  decodePolledCrowdAnomaly,
  decodePolledRoadsAnomaly,
  decodeRealtimeAnomaly,
} from '../../src/alerts/anomaly_model.js';
import type { RealtimeEventEnvelope } from '../../src/realtime/transport_events.js';

// ─── Fixtures ────────────────────────────────────────────────

function anomalyFrame(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    schema_version: '1.0.0',
    trace_id: 'tr-anomaly-1',
    occurred_at: '2026-05-20 22:10',
    provisional: true,
    policy_version: 'prov-2026a',
    event_type: ANOMALY_EVENT_TYPE,
    anomaly_type: 'ROAD_SATURATION',
    segment_or_station_id: 'RD_TPE_0007',
    threshold: 'SOP-1 A 級',
    value: 0.97,
    summary: '中山北路南下車道已達癱瘓等級，請立即啟動替代動線。',
    ...overrides,
  };
}

function envelope(payload: unknown, eventType = ANOMALY_EVENT_TYPE): RealtimeEventEnvelope {
  return {
    eventType: eventType as RealtimeEventEnvelope['eventType'],
    decisionId: null,
    eventId: null,
    occurredAt: null,
    readyEventId: null,
    payload,
  };
}

/** `saturation_score` is deliberately contradictory in these fixtures. */
function roadsBody(
  segments: readonly Record<string, unknown>[],
  envelopeOverrides: Record<string, unknown> = {},
): unknown {
  return {
    schema_version: '1.0.0',
    trace_id: 'tr-roads-1',
    segments,
    timestamp: '2026-05-20 22:10',
    provisional: false,
    ...envelopeOverrides,
  };
}

function roadSegment(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    segment_id: 'RD_TPE_0007',
    road_name: '中山北路',
    saturation_score: 0.5,
    level: 'A',
    lane_status: 'Congested',
    ...overrides,
  };
}

function crowdBody(
  stations: readonly Record<string, unknown>[],
  envelopeOverrides: Record<string, unknown> = {},
): unknown {
  return {
    schema_version: '1.0.0',
    trace_id: 'tr-crowd-1',
    data_status: 'ready',
    stations,
    decision_cutoff_timestamp: '2026-05-20 22:10',
    provisional: false,
    ...envelopeOverrides,
  };
}

function crowdStation(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    BS_ID: 'BS_0031',
    Location_Name: '台北車站',
    User_Count: 100,
    Growth_Rate: 0.01,
    roaming_pct_value: 0.02,
    Roaming_User_Pct: '2%',
    flags: ['SOP3_CROWD_SURGE'],
    ...overrides,
  };
}

// ─── Realtime ────────────────────────────────────────────────

describe('decodeRealtimeAnomaly (TASK-127)', () => {
  it('4. decodes a canonical anomaly.detected frame and keeps the server summary verbatim', () => {
    const result = decodeRealtimeAnomaly(envelope(anomalyFrame()));

    expect(result.kind).toBe('anomaly');
    if (result.kind !== 'anomaly') return;

    expect(result.presentation.summary).toBe(
      '中山北路南下車道已達癱瘓等級，請立即啟動替代動線。',
    );
    expect(result.presentation.source).toBe('realtime');
    expect(result.presentation.category).toBe('ROAD_SATURATION');
    expect(result.presentation.entityId).toBe('RD_TPE_0007');
    expect(result.presentation.observedAt).toBe('2026-05-20 22:10');
    expect(result.presentation.provisional).toBe(true);
    // No staleness verdict exists on this contract; it must not be invented.
    expect(result.presentation.stale).toBeNull();
    expect(result.presentation.dataStatus).toBeNull();
    // Backend threshold/value are display-only passthrough.
    expect(result.presentation.thresholdLabel).toBe('SOP-1 A 級');
    expect(result.presentation.valueLabel).toBe('0.97');
  });

  it('ignores every other §13 event type without inspecting its payload', () => {
    const result = decodeRealtimeAnomaly(envelope({ anything: true }, 'timeline.updated'));
    expect(result.kind).toBe('ignored');
  });

  it('builds a channel-agnostic identity from entity id + observation instant', () => {
    const result = decodeRealtimeAnomaly(envelope(anomalyFrame()));
    expect(result.kind).toBe('anomaly');
    if (result.kind !== 'anomaly') return;
    expect(result.presentation.identity).toBe('RD_TPE_0007@2026-05-20 22:10');
  });

  it('treats an empty server summary as "no text supplied" rather than a blank alert', () => {
    const result = decodeRealtimeAnomaly(envelope(anomalyFrame({ summary: '   ' })));
    expect(result.kind).toBe('anomaly');
    if (result.kind !== 'anomaly') return;
    expect(result.presentation.summary).toBeNull();
  });

  it('5. fails closed on every malformed variant of the canonical frame', () => {
    const malformed: readonly [string, unknown][] = [
      ['not an object', 'anomaly'],
      ['null payload', null],
      ['array payload', []],
      ['event_type mismatch', anomalyFrame({ event_type: 'timeline.updated' })],
      ['missing schema_version', anomalyFrame({ schema_version: undefined })],
      ['missing trace_id', anomalyFrame({ trace_id: '' })],
      ['missing policy_version', anomalyFrame({ policy_version: undefined })],
      ['missing occurred_at', anomalyFrame({ occurred_at: null })],
      ['missing anomaly_type', anomalyFrame({ anomaly_type: '  ' })],
      ['missing segment_or_station_id', anomalyFrame({ segment_or_station_id: undefined })],
      ['non-string summary', anomalyFrame({ summary: 42 })],
      ['non-string threshold', anomalyFrame({ threshold: 0.95 })],
      ['non-numeric value', anomalyFrame({ value: '0.97' })],
      ['non-finite value', anomalyFrame({ value: Number.NaN })],
      ['non-boolean provisional', anomalyFrame({ provisional: 'true' })],
    ];

    for (const [label, payload] of malformed) {
      const result = decodeRealtimeAnomaly(envelope(payload));
      expect(result.kind, `expected malformed for: ${label}`).toBe('malformed');
    }
  });
});

// ─── Roads truth boundary ────────────────────────────────────

describe('decodePolledRoadsAnomaly (TASK-127 truth boundary)', () => {
  it('16. server level A with a low saturation_score still reports active', () => {
    const result = decodePolledRoadsAnomaly(
      roadsBody([roadSegment({ level: 'A', saturation_score: 0.1 })]),
    );

    expect(result.kind).toBe('reading');
    if (result.kind !== 'reading') return;
    expect(result.reading.signal).toBe('active');
    expect(result.reading.presentation?.category).toBe('A');
    expect(result.reading.presentation?.entityId).toBe('RD_TPE_0007');
    expect(result.reading.presentation?.serverSignals).toEqual(['A']);
  });

  it('17. server level NONE with a high saturation_score reports inactive', () => {
    const result = decodePolledRoadsAnomaly(
      roadsBody([roadSegment({ level: 'NONE', saturation_score: 0.99 })]),
    );

    expect(result.kind).toBe('reading');
    if (result.kind !== 'reading') return;
    expect(result.reading.signal).toBe('inactive');
    expect(result.reading.presentation).toBeNull();
  });

  it('17b. a null level with a high saturation_score also reports inactive', () => {
    const result = decodePolledRoadsAnomaly(
      roadsBody([roadSegment({ level: null, saturation_score: 0.99 })]),
    );

    expect(result.kind).toBe('reading');
    if (result.kind !== 'reading') return;
    expect(result.reading.signal).toBe('inactive');
  });

  it('level B is an active backend verdict', () => {
    const result = decodePolledRoadsAnomaly(
      roadsBody([roadSegment({ level: 'B', saturation_score: 0.2 })]),
    );

    expect(result.kind).toBe('reading');
    if (result.kind !== 'reading') return;
    expect(result.reading.signal).toBe('active');
  });

  it('prefers an explicit active verdict over an unrecognized classification', () => {
    const result = decodePolledRoadsAnomaly(
      roadsBody([
        roadSegment({ segment_id: 'RD_TPE_0001', level: 'FUTURE_LEVEL' }),
        roadSegment({ segment_id: 'RD_TPE_0002', level: 'A' }),
      ]),
    );

    expect(result.kind).toBe('reading');
    if (result.kind !== 'reading') return;
    expect(result.reading.signal).toBe('active');
    expect(result.reading.presentation?.entityId).toBe('RD_TPE_0002');
  });

  it('reports unknown for an unrecognized classification with no active verdict', () => {
    const result = decodePolledRoadsAnomaly(
      roadsBody([roadSegment({ level: 'FUTURE_LEVEL', saturation_score: 0.99 })]),
    );

    expect(result.kind).toBe('reading');
    if (result.kind !== 'reading') return;
    expect(result.reading.signal).toBe('unknown');
  });

  it('22. insufficient_data with no active verdict reports unknown, never inactive', () => {
    const result = decodePolledRoadsAnomaly(
      roadsBody([], { data_status: 'insufficient_data' }),
    );

    expect(result.kind).toBe('reading');
    if (result.kind !== 'reading') return;
    expect(result.reading.signal).toBe('unknown');
  });

  it('22b. an explicit active verdict wins even alongside insufficient_data', () => {
    const result = decodePolledRoadsAnomaly(
      roadsBody([roadSegment({ level: 'A' })], { data_status: 'insufficient_data' }),
    );

    expect(result.kind).toBe('reading');
    if (result.kind !== 'reading') return;
    expect(result.reading.signal).toBe('active');
  });

  it('15. a malformed roads payload is malformed, never inactive', () => {
    for (const body of [null, 'roads', {}, roadsBody([{ segment_id: 'RD_1' }])]) {
      const result = decodePolledRoadsAnomaly(body);
      expect(result.kind).toBe('malformed');
    }
  });

  it('never fabricates a staleness verdict the roads contract does not carry', () => {
    const result = decodePolledRoadsAnomaly(
      roadsBody([roadSegment({ level: 'A', staleness_minutes: 45 })]),
    );

    expect(result.kind).toBe('reading');
    if (result.kind !== 'reading') return;
    expect(result.reading.presentation?.stale).toBeNull();
  });

  it('prefers the per-segment observation instant over the envelope timestamp', () => {
    const result = decodePolledRoadsAnomaly(
      roadsBody([roadSegment({ level: 'A', observation_timestamp: '2026-05-20 21:55' })]),
    );

    expect(result.kind).toBe('reading');
    if (result.kind !== 'reading') return;
    expect(result.reading.presentation?.identity).toBe('RD_TPE_0007@2026-05-20 21:55');
  });
});

// ─── Crowd truth boundary ────────────────────────────────────

describe('decodePolledCrowdAnomaly (TASK-127 truth boundary)', () => {
  it('18. a server flag with low raw metrics still reports active', () => {
    const result = decodePolledCrowdAnomaly(
      crowdBody([
        crowdStation({
          flags: ['SOP3_CROWD_SURGE'],
          User_Count: 1,
          Growth_Rate: 0.0,
          roaming_pct_value: 0.001,
          Roaming_User_Pct: '0.1%',
        }),
      ]),
    );

    expect(result.kind).toBe('reading');
    if (result.kind !== 'reading') return;
    expect(result.reading.signal).toBe('active');
    expect(result.reading.presentation?.entityId).toBe('BS_0031');
    expect(result.reading.presentation?.category).toBe('SOP3_CROWD_SURGE');
  });

  it('19. no server flag with very high raw metrics reports inactive', () => {
    const result = decodePolledCrowdAnomaly(
      crowdBody([
        crowdStation({
          flags: [],
          User_Count: 999_999,
          Growth_Rate: 5.0,
          roaming_pct_value: 0.99,
          Roaming_User_Pct: '99%',
        }),
      ]),
    );

    expect(result.kind).toBe('reading');
    if (result.kind !== 'reading') return;
    expect(result.reading.signal).toBe('inactive');
    expect(result.reading.presentation).toBeNull();
  });

  it('carries the full backend flag set through verbatim', () => {
    const result = decodePolledCrowdAnomaly(
      crowdBody([crowdStation({ flags: ['SOP3_CROWD_SURGE', 'SOP4_GROWTH'] })]),
    );

    expect(result.kind).toBe('reading');
    if (result.kind !== 'reading') return;
    expect(result.reading.presentation?.serverSignals).toEqual([
      'SOP3_CROWD_SURGE',
      'SOP4_GROWTH',
    ]);
  });

  it('21. passes the backend stale verdict through for an explicit active signal', () => {
    const result = decodePolledCrowdAnomaly(
      crowdBody([crowdStation({ flags: ['SOP3_CROWD_SURGE'], stale: true })]),
    );

    expect(result.kind).toBe('reading');
    if (result.kind !== 'reading') return;
    expect(result.reading.signal).toBe('active');
    expect(result.reading.presentation?.stale).toBe(true);
  });

  it('22c. envelope insufficient_data with no flag reports unknown', () => {
    const result = decodePolledCrowdAnomaly(
      crowdBody([crowdStation({ flags: [] })], { data_status: 'insufficient_data' }),
    );

    expect(result.kind).toBe('reading');
    if (result.kind !== 'reading') return;
    expect(result.reading.signal).toBe('unknown');
  });

  it('22d. an explicit flag wins even alongside insufficient_data', () => {
    const result = decodePolledCrowdAnomaly(
      crowdBody([crowdStation({ flags: ['SOP3_CROWD_SURGE'] })], {
        data_status: 'insufficient_data',
      }),
    );

    expect(result.kind).toBe('reading');
    if (result.kind !== 'reading') return;
    expect(result.reading.signal).toBe('active');
  });

  it('15b. a malformed crowd payload is malformed, never inactive', () => {
    for (const body of [
      null,
      'crowd',
      {},
      crowdBody([{ BS_ID: 'BS_1' }]),
      crowdBody([], { data_status: 'nonsense' }),
    ]) {
      const result = decodePolledCrowdAnomaly(body);
      expect(result.kind).toBe('malformed');
    }
  });

  it('a multilingual scope trigger alone is not treated as an anomaly signal', () => {
    const result = decodePolledCrowdAnomaly(
      crowdBody([crowdStation({ flags: [] })], {
        multilingual: {
          triggered: true,
          multilingual_required: true,
          data_status: 'ready',
          scope_mode: 'STRATEGY_F',
          triggering_station_ids: ['BS_0031'],
          stations_in_scope: ['BS_0031'],
        },
      }),
    );

    expect(result.kind).toBe('reading');
    if (result.kind !== 'reading') return;
    expect(result.reading.signal).toBe('inactive');
  });

  it('20. produces the same identity as the realtime channel for one occurrence', () => {
    const realtime = decodeRealtimeAnomaly(
      envelope(
        anomalyFrame({
          segment_or_station_id: 'BS_0031',
          occurred_at: '2026-05-20 22:10',
        }),
      ),
    );
    const polled = decodePolledCrowdAnomaly(
      crowdBody([
        crowdStation({ flags: ['SOP3_CROWD_SURGE'], observation_timestamp: '2026-05-20 22:10' }),
      ]),
    );

    expect(realtime.kind).toBe('anomaly');
    expect(polled.kind).toBe('reading');
    if (realtime.kind !== 'anomaly' || polled.kind !== 'reading') return;

    expect(polled.reading.presentation?.identity).toBe(realtime.presentation.identity);
  });
});
