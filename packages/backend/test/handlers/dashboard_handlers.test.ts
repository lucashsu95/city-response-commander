/**
 * TASK-150 — the four public dashboard GET handlers (design §12).
 *
 * ## On status codes
 *
 * These routes describe DATASETS, not addressable resources, so there is no `404`
 * path and these tests assert its absence deliberately. An unverified or empty
 * source set is `200` carrying `data_status=insufficient_data` (§12, §21): the
 * Dashboard has to render "official data unavailable", and a `404` would make that
 * state indistinguishable from a wrong URL. Downstream faults still map to `429` /
 * `500` through the shared envelope, never downgraded to "no data".
 *
 * ## Two themes
 *
 * **No fabrication.** A segment or station with no legal row at the replay position
 * reports `null`, never `0`. A zero saturation score renders as free-flowing
 * traffic, which is the opposite of "unknown".
 *
 * **No client-side derivation.** `level`, `flags`, `stale` and per-entity
 * `data_status` are backend truth. These tests assert they are present and correct
 * so the frontend never has to compare `staleness_minutes` to a literal or
 * re-derive an A/B boundary from `Saturation_Score`.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createGetCrowdHandler,
  createGetIncidentsHandler,
  createGetRoadsHandler,
  createGetTimelineHandler,
} from '../../src/index.js';
import type { DashboardPolicyPort, DashboardPorts, HttpGetEvent } from '../../src/index.js';
import type { PolicyMetadata } from '@city-commander/shared-schemas';

const TRACE = 'req-abc-123';
const MANIFEST = 'sha256:MANIFEST';
const BL17 = 'BS_MRT_BL17';
const CUTOFF = '2026-05-20 22:10';

const event: HttpGetEvent = { requestContext: { requestId: TRACE } };

/** Mirrors `createPolicyStrategyBundle`'s metadata for the default LOCAL_MOCK config. */
const POLICY: PolicyMetadata = {
  classification: 'PROVISIONAL_TEAM_POLICY',
  status: 'AWAITING_HOST_REPLY',
  is_official: false,
  guidance_id: 'HG-001',
  official_golden_answer: false,
  time_alignment: {
    mode: 'exact_or_latest_prior_per_entity',
    max_staleness_minutes: 60,
    on_insufficient: 'insufficient_data',
  },
  affected_road: { role: 'display_only' },
  ete: { affected_set: 'incident_primary_and_selected_secondary' },
  incident_anchor: { mode: 'incident_anchor_from_location_text' },
  affected_intersection_scope: { mode: 'unresolved_manual_confirmation' },
  multilingual_scope: { mode: 'current_snapshot_all_available_stations' },
  saturated_vs_congested: 'PARTIALLY_DEFINED',
};

/** Strategy F default: every current station reading is in scope. */
const policy: DashboardPolicyPort = {
  metadata: POLICY,
  stationsInMultilingualScope: (current) => ({
    mode: 'current_snapshot_all_available_stations',
    stations_in_scope: current,
  }),
};

/** Two segments and two stations, each at 21:10 and 22:10. */
function trafficRows(): Record<string, unknown>[] {
  return [
    {
      Segment_ID: 'RD_TPE_002',
      Road_Name: '光復南路',
      Saturation_Score: 0.62,
      Lane_Status: 'Open',
      timestamp_raw: '2026-05-20 21:10',
    },
    {
      Segment_ID: 'RD_TPE_002',
      Road_Name: '光復南路',
      Saturation_Score: 0.97,
      Lane_Status: 'Closed',
      timestamp_raw: CUTOFF,
    },
    {
      Segment_ID: 'RD_TPE_004',
      Road_Name: '基隆路',
      Saturation_Score: 0.55,
      Lane_Status: 'Open',
      timestamp_raw: '2026-05-20 21:10',
    },
    {
      Segment_ID: 'RD_TPE_004',
      Road_Name: '基隆路',
      Saturation_Score: 0.88,
      Lane_Status: 'Open',
      timestamp_raw: CUTOFF,
    },
  ];
}

function crowdRows(): Record<string, unknown>[] {
  return [
    {
      BS_ID: BL17,
      Location_Name: '捷運國父紀念館站',
      User_Count: 18_000,
      Growth_Rate: 0.08,
      roaming_pct_value: 0.12,
      Roaming_User_Pct: '12%',
      timestamp_raw: '2026-05-20 21:10',
    },
    {
      BS_ID: BL17,
      Location_Name: '捷運國父紀念館站',
      User_Count: 31_000,
      Growth_Rate: 0.42,
      roaming_pct_value: 0.34,
      Roaming_User_Pct: '34%',
      timestamp_raw: CUTOFF,
    },
    {
      BS_ID: 'BS_TPE_099',
      Location_Name: '信義路口',
      User_Count: 900,
      Growth_Rate: 0.01,
      roaming_pct_value: 0.02,
      Roaming_User_Pct: '2%',
      timestamp_raw: CUTOFF,
    },
  ];
}

function instantsFor(rows: readonly Record<string, unknown>[]): { timestamp_normalized: Date }[] {
  return rows.map((row) => {
    const [date, time] = String(row.timestamp_raw).split(' ');
    const [year, month, day] = String(date).split('-').map(Number);
    const [hour, minute] = String(time).split(':').map(Number);
    return { timestamp_normalized: new Date(year, month - 1, day, hour, minute) };
  });
}

function incidents(): Record<string, unknown>[] {
  return [
    {
      event_id: 'TPE_2026_ACC_001',
      affected_segment: 'RD_TPE_002',
      severity: 'Critical',
      timestamp: CUTOFF,
    },
  ];
}

/** Real Strategy A behaviour: latest row at or before the cutoff, per entity. */
const snapshots: DashboardPorts['snapshots'] = {
  select(_entityId, cutoff, records) {
    const cutoffMs = cutoff.getTime();
    let best: (typeof records)[number] | null = null;
    let bestMs = -Infinity;
    for (const record of records) {
      const ms = record.timestamp_normalized.getTime();
      if (ms <= cutoffMs && ms > bestMs) {
        best = record;
        bestMs = ms;
      }
    }
    if (best === null) {
      return {
        record: null,
        exact_match: false,
        staleness_minutes: Infinity,
        data_status: 'insufficient_data',
      };
    }
    const exact = bestMs === cutoffMs;
    return {
      record: best,
      exact_match: exact,
      staleness_minutes: exact ? 0 : Math.round((cutoffMs - bestMs) / 60_000),
      data_status: 'ready',
    };
  },
};

/** A selection that refuses everything, as Strategy A does past the stale window. */
const rejectAll: DashboardPorts['snapshots'] = {
  select: () => ({
    record: null,
    exact_match: false,
    staleness_minutes: Infinity,
    data_status: 'insufficient_data',
  }),
};

function createPorts(overrides: Record<string, unknown> = {}): DashboardPorts {
  const traffic = trafficRows();
  const crowd = crowdRows();
  return {
    snapshots,
    policy,
    ingestion: {
      ingest: () =>
        ({
          data_status: 'ready',
          source_manifest_hash: MANIFEST,
          stop_reason: null,
          traffic,
          trafficTimestamps: instantsFor(traffic),
          crowd,
          crowdTimestamps: instantsFor(crowd),
          incidents: incidents(),
          ...overrides,
        }) as never,
    },
  };
}

const stopped: Record<string, unknown> = {
  data_status: 'insufficient_data',
  stop_reason: 'SHA-256 mismatch: live_incidents.json',
  source_manifest_hash: '',
  traffic: undefined,
  trafficTimestamps: undefined,
  crowd: undefined,
  crowdTimestamps: undefined,
  incidents: undefined,
};

function body(result: { body: string }): Record<string, unknown> {
  return JSON.parse(result.body) as Record<string, unknown>;
}

function rows(result: { body: string }, key: 'segments' | 'stations'): Record<string, unknown>[] {
  return body(result)[key] as Record<string, unknown>[];
}

// ─── Envelope, shared by all four routes ───────────────────

describe('every dashboard response carries the §12 envelope', () => {
  const handlers = [
    ['timeline', createGetTimelineHandler],
    ['roads', createGetRoadsHandler],
    ['crowd', createGetCrowdHandler],
    ['incidents', createGetIncidentsHandler],
  ] as const;

  it.each(handlers)('%s returns 200 with schema_version and trace_id', async (_name, create) => {
    const result = await create(createPorts())(event);

    expect(result.statusCode).toBe(200);
    expect(result.headers['content-type']).toBe('application/json');
    expect(body(result)).toMatchObject({ schema_version: '1.0.0', trace_id: TRACE });
  });

  it.each(handlers)('%s carries the active policy and provisional badge', async (_name, create) => {
    const result = await create(createPorts())(event);

    // TASK-150: every response carries policy + provisional so the Dashboard can
    // show the provisional badge without knowing which strategies exist.
    expect(body(result)).toMatchObject({
      provisional: true,
      policy: { classification: 'PROVISIONAL_TEAM_POLICY', guidance_id: 'HG-001' },
    });
  });

  it.each(handlers)(
    '%s reports the replay position staleness is measured against',
    async (_name, create) => {
      const result = await create(createPorts())(event);

      expect(body(result).decision_cutoff_timestamp).toBe(CUTOFF);
    },
  );

  it.each(handlers)('%s reports insufficient_data as 200, not 404', async (_name, create) => {
    const result = await create(createPorts(stopped))(event);

    // A STOP-gate failure is a state to render, not a missing resource.
    expect(result.statusCode).toBe(200);
    expect(body(result)).toMatchObject({
      data_status: 'insufficient_data',
      stop_reason: 'SHA-256 mismatch: live_incidents.json',
      decision_cutoff_timestamp: null,
    });
  });

  it.each(handlers)('%s still carries policy when the STOP gate failed', async (_name, create) => {
    const result = await create(createPorts(stopped))(event);

    // The provisional badge must not vanish on the error path.
    expect(body(result)).toMatchObject({ provisional: true, policy: { is_official: false } });
  });

  it.each(handlers)('%s never returns 404', async (_name, create) => {
    for (const ports of [createPorts(), createPorts(stopped)]) {
      expect((await create(ports)(event)).statusCode).not.toBe(404);
    }
  });

  it.each(handlers)(
    '%s synthesises a trace_id when the request has none',
    async (_name, create) => {
      const result = await create(createPorts())({});

      expect(String(body(result).trace_id)).toContain('trace-unavailable-');
    },
  );

  it.each(handlers)(
    '%s maps a throttled dependency to 429, not to empty data',
    async (_name, create) => {
      const ports: DashboardPorts = {
        snapshots,
        policy,
        ingestion: {
          ingest: () => {
            throw Object.assign(new Error('Rate exceeded'), {
              name: 'ProvisionedThroughputExceededException',
            });
          },
        },
      };

      expect((await create(ports)(event)).statusCode).toBe(429);
    },
  );

  it.each(handlers)('%s maps an unknown fault to 500', async (_name, create) => {
    const ports: DashboardPorts = {
      snapshots,
      policy,
      ingestion: {
        ingest: () => {
          throw new Error('parser exploded');
        },
      },
    };

    expect((await create(ports)(event)).statusCode).toBe(500);
  });

  it.each(handlers)('%s ingests once per request', async (_name, create) => {
    const ports = createPorts();
    const spy = vi.spyOn(ports.ingestion, 'ingest');

    await create(ports)(event);

    // Two reads could straddle a source change and report two different truths.
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

// ─── GET /timeline ─────────────────────────────────────────

describe('GET /timeline', () => {
  it('returns distinct official instants in ascending order', async () => {
    const result = await createGetTimelineHandler(createPorts())(event);

    expect(body(result).timestamps).toEqual(['2026-05-20 21:10', CUTOFF]);
  });

  it('preserves the raw official timestamp format verbatim (§10.1)', async () => {
    const result = await createGetTimelineHandler(createPorts())(event);

    // The Dashboard uses these as opaque replay keys; reformatting would break it
    // and would also violate the "never normalize the official string" rule.
    expect(body(result).current).toBe(CUTOFF);
  });

  it('reports current as null for an empty dataset', async () => {
    const ports = createPorts({
      traffic: [],
      trafficTimestamps: [],
      crowd: [],
      crowdTimestamps: [],
    });

    const result = await createGetTimelineHandler(ports)(event);

    expect(body(result)).toMatchObject({ timestamps: [], current: null, data_status: 'ready' });
  });

  it('returns an empty timeline when the STOP gate failed', async () => {
    const result = await createGetTimelineHandler(createPorts(stopped))(event);

    expect(body(result)).toMatchObject({ timestamps: [], current: null });
  });
});

// ─── GET /roads ────────────────────────────────────────────

describe('GET /roads', () => {
  it('returns the §12 segment shape plus HG-001 provenance', async () => {
    const result = await createGetRoadsHandler(createPorts())(event);

    expect(Object.keys(rows(result, 'segments')[0] ?? {}).sort()).toEqual([
      'Lane_Status',
      'Road_Name',
      'Saturation_Score',
      'Segment_ID',
      'data_status',
      'exact_match',
      'level',
      'observation_timestamp',
      'stale',
      'staleness_minutes',
    ]);
  });

  it('selects the row at the replay position, not a later one', async () => {
    const result = await createGetRoadsHandler(createPorts())(event);

    expect(rows(result, 'segments').find((s) => s.Segment_ID === 'RD_TPE_002')).toMatchObject({
      Saturation_Score: 0.97,
      Lane_Status: 'Closed',
      Road_Name: '光復南路',
    });
  });

  it('grades via the domain engine (0.97 → A, 0.88 → B)', async () => {
    const result = await createGetRoadsHandler(createPorts())(event);
    const segments = rows(result, 'segments');

    // The thresholds live in classifySegments; this asserts delegation, not a
    // second copy of the boundary.
    expect(segments.find((s) => s.Segment_ID === 'RD_TPE_002')?.level).toBe('A');
    expect(segments.find((s) => s.Segment_ID === 'RD_TPE_004')?.level).toBe('B');
  });

  it('grades every segment present in the data, sorted', async () => {
    const result = await createGetRoadsHandler(createPorts())(event);

    expect(rows(result, 'segments').map((s) => s.Segment_ID)).toEqual(['RD_TPE_002', 'RD_TPE_004']);
  });

  it('reports an exact-match row as not stale, with the observation timestamp', async () => {
    const result = await createGetRoadsHandler(createPorts())(event);

    expect(rows(result, 'segments').find((s) => s.Segment_ID === 'RD_TPE_002')).toMatchObject({
      observation_timestamp: CUTOFF,
      exact_match: true,
      staleness_minutes: 0,
      stale: false,
      data_status: 'ready',
    });
  });

  it('marks a latest-prior row stale with its own observation timestamp', async () => {
    // RD_TPE_004 has no row at 22:10 here, so Strategy A falls back to 21:10.
    const traffic = trafficRows().filter(
      (row) => !(row.Segment_ID === 'RD_TPE_004' && row.timestamp_raw === CUTOFF),
    );
    const ports = createPorts({ traffic, trafficTimestamps: instantsFor(traffic) });

    const result = await createGetRoadsHandler(ports)(event);

    // The frontend must not derive this from a literal window: the window is
    // policy.time_alignment.max_staleness_minutes, which is configuration.
    expect(rows(result, 'segments').find((s) => s.Segment_ID === 'RD_TPE_004')).toMatchObject({
      observation_timestamp: '2026-05-20 21:10',
      exact_match: false,
      staleness_minutes: 60,
      stale: true,
      data_status: 'ready',
    });
  });

  it('reports null, never 0, when Strategy A rejects the only candidate', async () => {
    const ports: DashboardPorts = {
      ...createPorts(),
      snapshots: {
        select: (entityId, cutoff, records) =>
          entityId === 'RD_TPE_002'
            ? rejectAll.select(entityId, cutoff, records)
            : snapshots.select(entityId, cutoff, records),
      },
    };

    const result = await createGetRoadsHandler(ports)(event);
    const segments = rows(result, 'segments');
    const gap = segments.find((s) => s.Segment_ID === 'RD_TPE_002');

    // 0.0 renders as free-flowing traffic — the opposite of "unknown".
    expect(gap).toMatchObject({
      Saturation_Score: null,
      level: null,
      Lane_Status: null,
      Road_Name: null,
      observation_timestamp: null,
      data_status: 'insufficient_data',
      stale: false,
    });
    // The healthy segment is unaffected.
    expect(segments.find((s) => s.Segment_ID === 'RD_TPE_004')?.level).toBe('B');
  });

  it('serialises an unmeasurable staleness as null, not as a coerced value', async () => {
    const ports: DashboardPorts = { ...createPorts(), snapshots: rejectAll };

    const result = await createGetRoadsHandler(ports)(event);

    // Strategy A returns Infinity when no legal row exists; JSON.stringify would
    // coerce that to null silently, so it is mapped explicitly.
    expect(rows(result, 'segments')[0]?.staleness_minutes).toBeNull();
  });

  it('drops surplus rows rather than pairing them with the wrong instant', async () => {
    const traffic = trafficRows();
    const ports = createPorts({
      traffic,
      // One instant short: pairing by index anyway would misalign everything after.
      trafficTimestamps: instantsFor(traffic).slice(0, 3),
      crowd: [],
      crowdTimestamps: [],
    });

    const result = await createGetRoadsHandler(ports)(event);

    expect(result.statusCode).toBe(200);
    expect(rows(result, 'segments').length).toBeGreaterThan(0);
  });

  it('returns no segments when the STOP gate failed', async () => {
    const result = await createGetRoadsHandler(createPorts(stopped))(event);

    expect(body(result).segments).toEqual([]);
  });
});

// ─── GET /crowd ────────────────────────────────────────────

describe('GET /crowd', () => {
  it('returns the §12 station shape plus flags, scope and provenance', async () => {
    const result = await createGetCrowdHandler(createPorts())(event);

    expect(Object.keys(rows(result, 'stations')[0] ?? {}).sort()).toEqual([
      'BS_ID',
      'Growth_Rate',
      'Location_Name',
      'Roaming_User_Pct',
      'User_Count',
      'data_status',
      'exact_match',
      'flags',
      'in_multilingual_scope',
      'observation_timestamp',
      'roaming_pct_value',
      'stale',
      'staleness_minutes',
    ]);
  });

  it('selects the current-state row at the replay position', async () => {
    const result = await createGetCrowdHandler(createPorts())(event);

    expect(rows(result, 'stations').find((s) => s.BS_ID === BL17)).toMatchObject({
      User_Count: 31_000,
      Growth_Rate: 0.42,
      roaming_pct_value: 0.34,
      Location_Name: '捷運國父紀念館站',
    });
  });

  it('carries the official raw percent string so the UI never reformats', async () => {
    const result = await createGetCrowdHandler(createPorts())(event);

    expect(rows(result, 'stations').find((s) => s.BS_ID === BL17)?.Roaming_User_Pct).toBe('34%');
  });

  it('raises the SOP-3 flag for BL17 via the domain evaluator', async () => {
    const result = await createGetCrowdHandler(createPorts())(event);

    // 31 000 users and +42% growth both exceed the art.3 thresholds, which live in
    // evaluateArticle3 — not here.
    expect(rows(result, 'stations').find((s) => s.BS_ID === BL17)?.flags).toContain(
      'SOP3_MRT_SHUTTLE',
    );
  });

  it('raises the SOP-6 flag on the station that crossed the roaming threshold', async () => {
    const result = await createGetCrowdHandler(createPorts())(event);
    const stations = rows(result, 'stations');

    // 34% ≥ 30% for BL17; 2% for BS_TPE_099. The 30% boundary lives in
    // evaluateMultilingualTrigger, so this asserts attribution, not a re-check.
    expect(stations.find((s) => s.BS_ID === BL17)?.flags).toContain('SOP6_MULTILINGUAL');
    expect(stations.find((s) => s.BS_ID === 'BS_TPE_099')?.flags).not.toContain(
      'SOP6_MULTILINGUAL',
    );
  });

  it('reports scope-level SOP-6 truth so the popup fallback needs no threshold', async () => {
    const result = await createGetCrowdHandler(createPorts())(event);

    // REQ-002's polling fallback compares thresholds; giving it the deterministic
    // trigger means the frontend never recomputes 30% from roaming_pct_value.
    expect(body(result).multilingual).toMatchObject({
      triggered: true,
      multilingual_required: true,
      triggering_station_ids: [BL17],
      data_status: 'ready',
      scope_mode: 'current_snapshot_all_available_stations',
    });
  });

  it('reports the Strategy F station scope (OQ-005) alongside membership', async () => {
    const result = await createGetCrowdHandler(createPorts())(event);
    const multilingual = body(result).multilingual as Record<string, unknown>;

    expect(multilingual.stations_in_scope).toEqual([BL17, 'BS_TPE_099']);
    expect(rows(result, 'stations').every((s) => s.in_multilingual_scope === true)).toBe(true);
  });

  it('reports SOP-6 as insufficient_data when an in-scope reading is missing', async () => {
    const ports: DashboardPorts = {
      ...createPorts(),
      snapshots: {
        select: (entityId, cutoff, records) =>
          entityId === BL17
            ? rejectAll.select(entityId, cutoff, records)
            : snapshots.select(entityId, cutoff, records),
      },
    };

    const result = await createGetCrowdHandler(ports)(event);

    // An unknown reading could meet the inclusive threshold, so `false` is not a
    // conclusive answer and must not be presented as one.
    expect(body(result).multilingual).toMatchObject({
      triggered: false,
      data_status: 'insufficient_data',
    });
  });

  it('raises no flag for a station the SOP does not name', async () => {
    const result = await createGetCrowdHandler(createPorts())(event);

    // There is no art.3/art.4 rule for this station and it is below the roaming
    // threshold; inventing a flag would be fabrication.
    expect(rows(result, 'stations').find((s) => s.BS_ID === 'BS_TPE_099')?.flags).toEqual([]);
  });

  it('raises no SOP-3 flag when BL17 is below the thresholds', async () => {
    const crowd = [
      {
        BS_ID: BL17,
        Location_Name: '捷運國父紀念館站',
        User_Count: 900,
        Growth_Rate: 0.01,
        roaming_pct_value: 0.02,
        Roaming_User_Pct: '2%',
        timestamp_raw: CUTOFF,
      },
    ];
    const ports = createPorts({
      crowd,
      crowdTimestamps: instantsFor(crowd),
      traffic: [],
      trafficTimestamps: [],
    });

    const result = await createGetCrowdHandler(ports)(event);

    expect(rows(result, 'stations')[0]?.flags).toEqual([]);
  });

  it('reports null, never 0, when Strategy A rejects the only candidate', async () => {
    const ports: DashboardPorts = {
      ...createPorts(),
      snapshots: {
        select: (entityId, cutoff, records) =>
          entityId === BL17
            ? rejectAll.select(entityId, cutoff, records)
            : snapshots.select(entityId, cutoff, records),
      },
    };

    const result = await createGetCrowdHandler(ports)(event);
    const gap = rows(result, 'stations').find((s) => s.BS_ID === BL17);

    expect(gap).toMatchObject({
      User_Count: null,
      Growth_Rate: null,
      roaming_pct_value: null,
      Roaming_User_Pct: null,
      Location_Name: null,
      observation_timestamp: null,
      data_status: 'insufficient_data',
    });
  });

  it('raises no SOP-3 flag from a rejected snapshot', async () => {
    const ports: DashboardPorts = { ...createPorts(), snapshots: rejectAll };

    const result = await createGetCrowdHandler(ports)(event);

    // No legal observation means no trigger. Treating a missing count as 0 would
    // be fabrication; treating it as "triggered" would be worse.
    expect(rows(result, 'stations').find((s) => s.BS_ID === BL17)?.flags).toEqual([]);
  });

  it('returns no stations and a scoped multilingual block when the STOP gate failed', async () => {
    const result = await createGetCrowdHandler(createPorts(stopped))(event);

    expect(body(result).stations).toEqual([]);
    expect(body(result).multilingual).toMatchObject({
      triggered: false,
      data_status: 'insufficient_data',
    });
  });
});

// ─── GET /incidents ────────────────────────────────────────

describe('GET /incidents', () => {
  it('returns the official incident list unmodified', async () => {
    const result = await createGetIncidentsHandler(createPorts())(event);

    // Official input, passed through: this endpoint does not enrich or reinterpret.
    expect(body(result).incidents).toEqual(incidents());
  });

  it('returns an empty list rather than null when there are no incidents', async () => {
    const result = await createGetIncidentsHandler(createPorts({ incidents: [] }))(event);

    expect(body(result).incidents).toEqual([]);
  });

  it('returns an empty list when ingestion exposed no incident set', async () => {
    const result = await createGetIncidentsHandler(createPorts({ incidents: undefined }))(event);

    expect(body(result)).toMatchObject({ incidents: [], data_status: 'ready' });
  });
});
