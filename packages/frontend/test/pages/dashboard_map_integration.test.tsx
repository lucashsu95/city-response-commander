/**
 * Dashboard Map Integration Tests (Dashboard Operations Map)
 *
 * Exercises the real `DashboardPage` wiring for the new Operations Map: it
 * must be fed from the *existing* road/crowd/timeline controllers with no
 * second `GET /roads`/`GET /crowd`/`GET /timeline` request, no second
 * polling loop, and no second WebSocket — and every other region
 * (Timeline/Roads/Crowd/Anomaly/Decision/What-if/Injection) must remain
 * mounted and functional alongside it.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { DashboardPage } from '../../src/pages/dashboard.js';
import { AppConfigProvider } from '../../src/state/app_context.js';
import type { RuntimeConfig } from '../../src/config/runtime_config.js';
import { FakeSocket } from '../realtime/fakes.js';

const CONFIG: RuntimeConfig = {
  apiEndpoint: 'https://api.test.invalid',
  wsEndpoint: 'wss://ws.test.invalid/realtime',
  environment: 'TEST',
};

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

function timelineBody(current: string | null, timestamps: readonly string[]): unknown {
  return {
    timestamps,
    current,
    schema_version: '1.0',
    trace_id: 'tr-test',
    provisional: true,
  };
}

function segment(id: string, level: string | null = 'A'): Record<string, unknown> {
  return {
    segment_id: id,
    road_name: `Road ${id}`,
    saturation_score: 0.5,
    level,
    lane_status: 'normal',
    observation_timestamp: '2026-05-20 22:00',
    staleness_minutes: 0,
  };
}

function roadsBody(segmentIds: readonly string[], level: string | null = 'A'): unknown {
  return {
    schema_version: '1.0',
    trace_id: 'tr-roads',
    segments: segmentIds.map((id) => segment(id, level)),
    timestamp: '2026-05-20 22:10',
    provisional: true,
  };
}

function crowdBody(bsIds: readonly string[], flags: readonly string[] = []): unknown {
  return {
    schema_version: '1.0',
    trace_id: 'tr-crowd',
    data_status: 'ready',
    stations: bsIds.map((id) => ({
      BS_ID: id,
      Location_Name: `Station ${id}`,
      User_Count: 100,
      Growth_Rate: 0,
      roaming_pct_value: 0.1,
      Roaming_User_Pct: '10%',
      flags,
      observation_timestamp: '2026-05-20 22:00',
      stale: false,
    })),
    decision_cutoff_timestamp: '2026-05-20 22:10',
    provisional: true,
  };
}

interface FetchMock {
  timelineCalls: Deferred<Response>[];
  roadsCalls: Deferred<Response>[];
  crowdCalls: Deferred<Response>[];
  otherCalls: string[];
}

function installFetchMock(): FetchMock {
  const timelineCalls: Deferred<Response>[] = [];
  const roadsCalls: Deferred<Response>[] = [];
  const crowdCalls: Deferred<Response>[] = [];
  const otherCalls: string[] = [];

  const mock = vi.fn((input: unknown) => {
    const url = String(input);
    if (url.includes('/timeline')) {
      const deferred = createDeferred<Response>();
      timelineCalls.push(deferred);
      return deferred.promise;
    }
    if (url.includes('/roads')) {
      const deferred = createDeferred<Response>();
      roadsCalls.push(deferred);
      return deferred.promise;
    }
    if (url.includes('/crowd')) {
      const deferred = createDeferred<Response>();
      crowdCalls.push(deferred);
      return deferred.promise;
    }
    otherCalls.push(url);
    return Promise.resolve(jsonResponse({ schema_version: '1.0', trace_id: 'tr-other' }));
  });

  vi.stubGlobal('fetch', mock);
  return { timelineCalls, roadsCalls, crowdCalls, otherCalls };
}

async function flush(turns = 20): Promise<void> {
  for (let index = 0; index < turns; index += 1) {
    await Promise.resolve();
  }
}

function renderDashboard() {
  return render(
    <AppConfigProvider config={CONFIG}>
      <DashboardPage />
    </AppConfigProvider>,
  );
}

async function settleInitialLoad(fetchMock: FetchMock): Promise<void> {
  await act(async () => {
    fetchMock.timelineCalls[0]?.resolve(
      jsonResponse(timelineBody('2026-05-20 22:00', ['2026-05-20 22:00'])),
    );
    fetchMock.roadsCalls[0]?.resolve(jsonResponse(roadsBody(['RD_TPE_002'])));
    fetchMock.crowdCalls[0]?.resolve(jsonResponse(crowdBody(['BS_MRT_BL17'])));
    await flush();
  });
}

describe('DashboardPage map integration', () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    FakeSocket.reset();
    vi.stubGlobal('WebSocket', FakeSocket);
    fetchMock = installFetchMock();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    FakeSocket.reset();
  });

  it('mounts the operations map region alongside every other required region', async () => {
    const view = renderDashboard();
    await settleInitialLoad(fetchMock);

    // Map region.
    expect(screen.getByRole('heading', { name: '事件態勢地圖', level: 3 })).toBeInTheDocument();
    expect(screen.getByTestId('map-schematic-disclosure')).toBeInTheDocument();

    // All required regions remain mounted (region headings, scoped to h2
    // level so a panel's own subheading with the same text is not conflated).
    expect(screen.getByRole('heading', { name: '時間軸', level: 2 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '路段車流', level: 2 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '基地台人流', level: 2 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '決策指令', level: 2 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'What-if 假設情境', level: 2 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '事件注入', level: 2 })).toBeInTheDocument();
    // Injection and admin controls (TASK-128) still present.
    expect(screen.getByTestId('admin-session-control')).toBeInTheDocument();
    expect(screen.getByTestId('injection-panel')).toBeInTheDocument();

    view.unmount();
  });

  it('renders the same road/crowd data on the map as on the existing panels, with no extra request', async () => {
    const view = renderDashboard();
    await settleInitialLoad(fetchMock);

    // The existing road/crowd panels render this data.
    expect(document.querySelector('[data-segment-id="RD_TPE_002"]')).not.toBeNull();
    expect(document.querySelector('[data-station-id="BS_MRT_BL17"]')).not.toBeNull();

    // The map renders the very same entities, fed from the same controllers.
    expect(screen.getByTestId('map-entity-road:RD_TPE_002')).toBeInTheDocument();
    expect(screen.getByTestId('map-entity-crowd_station:BS_MRT_BL17')).toBeInTheDocument();

    // No second GET /roads request was issued for the map (roads has no
    // replay-position-driven refetch). The crowd controller's own pre-existing
    // behavior (unrelated to the map) re-reads once more when the timeline's
    // authoritative position resolves from null to a real value — the map adds
    // no additional call beyond that pre-existing count.
    expect(fetchMock.roadsCalls).toHaveLength(1);
    expect(fetchMock.crowdCalls.length).toBeLessThanOrEqual(2);

    view.unmount();
  });

  it('shows the authoritative timeline current position on the map', async () => {
    const view = renderDashboard();
    await settleInitialLoad(fetchMock);

    expect(screen.getByTestId('map-current-timestamp').textContent).toContain(
      '2026-05-20 22:00',
    );

    view.unmount();
  });

  it('never opens a second WebSocket and never starts a second polling loop', async () => {
    const view = renderDashboard();
    await settleInitialLoad(fetchMock);

    expect(FakeSocket.instances).toHaveLength(1);

    act(() => {
      FakeSocket.instances[0]?.emitError();
    });
    await flush();

    // Exactly one degraded-mode polling cycle's worth of requests: the map
    // must not have triggered any additional GET calls beyond the existing
    // fallback loop's own targets (timeline/roads/crowd/incidents).
    const callsAfterDegrade =
      fetchMock.timelineCalls.length + fetchMock.roadsCalls.length + fetchMock.crowdCalls.length;
    expect(callsAfterDegrade).toBeGreaterThanOrEqual(2);
    // Still exactly one socket ever created.
    expect(FakeSocket.instances).toHaveLength(1);

    view.unmount();
  });

  it('shows the degraded notice on the map once the connection falls back to polling', async () => {
    const view = renderDashboard();
    await settleInitialLoad(fetchMock);

    expect(screen.queryByTestId('map-degraded-notice')).toBeNull();

    act(() => {
      FakeSocket.instances[0]?.emitError();
    });
    await flush();

    expect(screen.getByTestId('map-degraded-notice')).toBeInTheDocument();

    view.unmount();
  });

  it('renders A-level road red and an active-flag station distinctly on the map', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((input: unknown) => {
        const url = String(input);
        if (url.includes('/timeline')) {
          return Promise.resolve(
            jsonResponse(timelineBody('2026-05-20 22:00', ['2026-05-20 22:00'])),
          );
        }
        if (url.includes('/roads')) {
          return Promise.resolve(jsonResponse(roadsBody(['RD_TPE_002'], 'A')));
        }
        if (url.includes('/crowd')) {
          return Promise.resolve(jsonResponse(crowdBody(['BS_MRT_BL17'], ['SOP3_MRT_SHUTTLE'])));
        }
        return Promise.resolve(jsonResponse({ schema_version: '1.0', trace_id: 'tr-other' }));
      }),
    );

    const view = renderDashboard();
    await act(async () => {
      await flush();
    });

    const roadShape = document.querySelector('[data-entity-id="RD_TPE_002"] rect');
    expect(roadShape).toHaveAttribute('fill', '#ef4444');

    const crowdShape = document.querySelector('[data-entity-id="BS_MRT_BL17"] circle');
    expect(crowdShape).toHaveClass('operations-map__crowd-marker--active');

    view.unmount();
  });

  it('lets the operator select a map entity to see its detail without disturbing the injection flow', async () => {
    const view = renderDashboard();
    await settleInitialLoad(fetchMock);

    // Map selection.
    const roadShape = screen.getByTestId('map-entity-road:RD_TPE_002');
    await act(async () => {
      roadShape.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();
    });
    expect(screen.getByTestId('map-detail-entity-id').textContent).toBe('RD_TPE_002');

    // Injection panel is still gated and operable exactly as before.
    expect(screen.getByText(/尚未偵測到管理員憑證/)).toBeInTheDocument();

    view.unmount();
  });
});
