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
 * The other theme is no fabrication: a segment or station with no legal row at the
 * replay position reports `null`, never `0`. A zero saturation score renders as
 * free-flowing traffic, which is the opposite of "unknown".
 */

import { describe, it, expect, vi } from 'vitest';
import {
  createGetCrowdHandler,
  createGetIncidentsHandler,
  createGetRoadsHandler,
  createGetTimelineHandler,
} from '../../src/index.js';
import type { DashboardPorts, HttpGetEvent } from '../../src/index.js';

const TRACE = 'req-abc-123';
const MANIFEST = 'sha256:MANIFEST';
const BL17 = 'BS_MRT_BL17';

const event: HttpGetEvent = { requestContext: { requestId: TRACE } };

/** Two segments and two stations, each at 21:10 and 22:10. */
function trafficRows(): Record<string, unknown>[] {
  return [
    {
      Segment_ID: 'RD_TPE_002',
      Saturation_Score: 0.62,
      Lane_Status: 'Open',
      timestamp_raw: '2026-05-20 21:10',
    },
    {
      Segment_ID: 'RD_TPE_002',
      Saturation_Score: 0.97,
      Lane_Status: 'Closed',
      timestamp_raw: '2026-05-20 22:10',
    },
    {
      Segment_ID: 'RD_TPE_004',
      Saturation_Score: 0.55,
      Lane_Status: 'Open',
      timestamp_raw: '2026-05-20 21:10',
    },
    {
      Segment_ID: 'RD_TPE_004',
      Saturation_Score: 0.88,
      Lane_Status: 'Open',
      timestamp_raw: '2026-05-20 22:10',
    },
  ];
}

function crowdRows(): Record<string, unknown>[] {
  return [
    {
      BS_ID: BL17,
      User_Count: 18_000,
      Growth_Rate: 0.08,
      roaming_pct_value: 0.12,
      timestamp_raw: '2026-05-20 21:10',
    },
    {
      BS_ID: BL17,
      User_Count: 31_000,
      Growth_Rate: 0.42,
      roaming_pct_value: 0.34,
      timestamp_raw: '2026-05-20 22:10',
    },
    {
      BS_ID: 'BS_TPE_099',
      User_Count: 900,
      Growth_Rate: 0.01,
      roaming_pct_value: 0.02,
      timestamp_raw: '2026-05-20 22:10',
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
      timestamp: '2026-05-20 22:10',
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
    return best === null
      ? { record: null, data_status: 'insufficient_data' }
      : { record: best, data_status: 'ready' };
  },
};

function createPorts(overrides: Record<string, unknown> = {}): DashboardPorts {
  const traffic = trafficRows();
  const crowd = crowdRows();
  return {
    snapshots,
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
    // §12: every response carries schema_version and trace_id.
    expect(body(result)).toMatchObject({ schema_version: '1.0.0', trace_id: TRACE });
  });

  it.each(handlers)('%s reports insufficient_data as 200, not 404', async (_name, create) => {
    const result = await create(createPorts(stopped))(event);

    // A STOP-gate failure is a state to render, not a missing resource.
    expect(result.statusCode).toBe(200);
    expect(body(result)).toMatchObject({
      data_status: 'insufficient_data',
      stop_reason: 'SHA-256 mismatch: live_incidents.json',
    });
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

      // A response that cannot be correlated to its log line is useless at 3am.
      expect(String(body(result).trace_id)).toContain('trace-unavailable-');
    },
  );

  it.each(handlers)(
    '%s maps a throttled dependency to 429, not to empty data',
    async (_name, create) => {
      const ports: DashboardPorts = {
        snapshots,
        ingestion: {
          ingest: () => {
            throw Object.assign(new Error('Rate exceeded'), {
              name: 'ProvisionedThroughputExceededException',
            });
          },
        },
      };

      const result = await create(ports)(event);

      expect(result.statusCode).toBe(429);
    },
  );

  it.each(handlers)('%s maps an unknown fault to 500', async (_name, create) => {
    const ports: DashboardPorts = {
      snapshots,
      ingestion: {
        ingest: () => {
          throw new Error('parser exploded');
        },
      },
    };

    expect((await create(ports)(event)).statusCode).toBe(500);
  });
});

// ─── GET /timeline ─────────────────────────────────────────

describe('GET /timeline', () => {
  it('returns distinct official instants in ascending order', async () => {
    const result = await createGetTimelineHandler(createPorts())(event);

    expect(body(result).timestamps).toEqual(['2026-05-20 21:10', '2026-05-20 22:10']);
  });

  it('preserves the raw official timestamp format verbatim (§10.1)', async () => {
    const result = await createGetTimelineHandler(createPorts())(event);

    // The Dashboard uses these as opaque replay keys; reformatting would break it
    // and would also violate the "never normalize the official string" rule.
    expect(body(result).current).toBe('2026-05-20 22:10');
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
  it('returns the §12 segment shape', async () => {
    const result = await createGetRoadsHandler(createPorts())(event);
    const segments = body(result).segments as Record<string, unknown>[];

    expect(Object.keys(segments[0] ?? {}).sort()).toEqual([
      'Lane_Status',
      'Saturation_Score',
      'Segment_ID',
      'level',
    ]);
  });

  it('selects the row at the replay position, not a later one', async () => {
    const result = await createGetRoadsHandler(createPorts())(event);
    const segments = body(result).segments as Record<string, unknown>[];

    expect(segments.find((s) => s.Segment_ID === 'RD_TPE_002')).toMatchObject({
      Saturation_Score: 0.97,
      Lane_Status: 'Closed',
    });
  });

  it('grades via the domain engine (0.97 → A, 0.88 → B)', async () => {
    const result = await createGetRoadsHandler(createPorts())(event);
    const segments = body(result).segments as Record<string, unknown>[];

    // The thresholds live in classifySegments; this asserts delegation, not a
    // second copy of the boundary.
    expect(segments.find((s) => s.Segment_ID === 'RD_TPE_002')?.level).toBe('A');
    expect(segments.find((s) => s.Segment_ID === 'RD_TPE_004')?.level).toBe('B');
  });

  it('grades every segment present in the data, sorted', async () => {
    const result = await createGetRoadsHandler(createPorts())(event);
    const segments = body(result).segments as Record<string, unknown>[];

    expect(segments.map((s) => s.Segment_ID)).toEqual(['RD_TPE_002', 'RD_TPE_004']);
  });

  it('reports null, never 0, when Strategy A rejects the only candidate', async () => {
    // The reachable gap: every entity in the data has SOME row at or before the
    // cutoff (the cutoff is the latest instant overall), so the null path is
    // reached when Strategy A refuses the row it found — which is what the real
    // SnapshotSelector does when staleness exceeds the allowed window (§30).
    const ports: DashboardPorts = {
      ...createPorts(),
      snapshots: {
        select: (entityId, _cutoff, _records) =>
          entityId === 'RD_TPE_002'
            ? { record: null, data_status: 'insufficient_data' }
            : snapshots.select(entityId, _cutoff, _records),
      },
    };

    const result = await createGetRoadsHandler(ports)(event);
    const segments = body(result).segments as Record<string, unknown>[];
    const gap = segments.find((s) => s.Segment_ID === 'RD_TPE_002');

    // 0.0 renders as free-flowing traffic — the opposite of "unknown".
    expect(gap?.Saturation_Score).toBeNull();
    expect(gap?.level).toBeNull();
    expect(gap?.Lane_Status).toBeNull();
    // The healthy segment is unaffected.
    expect(segments.find((s) => s.Segment_ID === 'RD_TPE_004')?.level).toBe('B');
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
    expect((body(result).segments as unknown[]).length).toBeGreaterThan(0);
  });
});

// ─── GET /crowd ────────────────────────────────────────────

describe('GET /crowd', () => {
  it('returns the §12 station shape', async () => {
    const result = await createGetCrowdHandler(createPorts())(event);
    const stations = body(result).stations as Record<string, unknown>[];

    expect(Object.keys(stations[0] ?? {}).sort()).toEqual([
      'BS_ID',
      'Growth_Rate',
      'User_Count',
      'flags',
      'roaming_pct_value',
    ]);
  });

  it('selects the current-state row at the replay position', async () => {
    const result = await createGetCrowdHandler(createPorts())(event);
    const stations = body(result).stations as Record<string, unknown>[];

    expect(stations.find((s) => s.BS_ID === BL17)).toMatchObject({
      User_Count: 31_000,
      Growth_Rate: 0.42,
      roaming_pct_value: 0.34,
    });
  });

  it('raises the SOP-3 flag for BL17 via the domain evaluator', async () => {
    const result = await createGetCrowdHandler(createPorts())(event);
    const stations = body(result).stations as Record<string, unknown>[];

    // 31 000 users and +42% growth both exceed the art.3 thresholds, which live in
    // evaluateArticle3 — not here.
    expect(stations.find((s) => s.BS_ID === BL17)?.flags).toContain('SOP3_MRT_SHUTTLE');
  });

  it('raises no flag for a station the SOP does not name', async () => {
    const result = await createGetCrowdHandler(createPorts())(event);
    const stations = body(result).stations as Record<string, unknown>[];

    // There is no official rule for this station; inventing one would be
    // fabrication, so the array is empty rather than guessed.
    expect(stations.find((s) => s.BS_ID === 'BS_TPE_099')?.flags).toEqual([]);
  });

  it('raises no SOP-3 flag when BL17 is below the thresholds', async () => {
    const crowd = [
      {
        BS_ID: BL17,
        User_Count: 900,
        Growth_Rate: 0.01,
        roaming_pct_value: 0.02,
        timestamp_raw: '2026-05-20 22:10',
      },
    ];
    const ports = createPorts({
      crowd,
      crowdTimestamps: instantsFor(crowd),
      traffic: [],
      trafficTimestamps: [],
    });

    const result = await createGetCrowdHandler(ports)(event);
    const stations = body(result).stations as Record<string, unknown>[];

    expect(stations[0]?.flags).toEqual([]);
  });

  it('reports null, never 0, when Strategy A rejects the only candidate', async () => {
    const ports: DashboardPorts = {
      ...createPorts(),
      snapshots: {
        select: (entityId, cutoff, records) =>
          entityId === BL17
            ? { record: null, data_status: 'insufficient_data' }
            : snapshots.select(entityId, cutoff, records),
      },
    };

    const result = await createGetCrowdHandler(ports)(event);
    const stations = body(result).stations as Record<string, unknown>[];
    const gap = stations.find((s) => s.BS_ID === BL17);

    expect(gap?.User_Count).toBeNull();
    expect(gap?.Growth_Rate).toBeNull();
    expect(gap?.roaming_pct_value).toBeNull();
  });

  it('raises no SOP-3 flag from a rejected snapshot', async () => {
    const ports: DashboardPorts = {
      ...createPorts(),
      snapshots: { select: () => ({ record: null, data_status: 'insufficient_data' }) },
    };

    const result = await createGetCrowdHandler(ports)(event);
    const stations = body(result).stations as Record<string, unknown>[];

    // No legal observation means no trigger. Treating a missing count as 0 would
    // be fabrication; treating it as "triggered" would be worse.
    expect(stations.find((s) => s.BS_ID === BL17)?.flags).toEqual([]);
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

  it('ingests once per request', async () => {
    const ports = createPorts();
    const spy = vi.spyOn(ports.ingestion, 'ingest');

    await createGetIncidentsHandler(ports)(event);

    // Two reads could straddle a source change and report two different truths.
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
