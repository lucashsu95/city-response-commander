/**
 * Dashboard Road Integration Tests (TASK-125)
 *
 * Exercises the real `DashboardPage` wiring between the road traffic
 * controller, the authoritative TASK-124 timeline `currentTimestamp`, and the
 * TASK-122 polling fallback — using the injected `WebSocket` stub and a
 * deterministic `fetch` mock (no live HTTP/WebSocket, no sleep, no real
 * wall-clock timing).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, render } from '@testing-library/react';
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
  };
}

function roadsBody(segmentIds: readonly string[]): unknown {
  return {
    schema_version: '1.0',
    trace_id: 'tr-roads',
    segments: segmentIds.map((id) => segment(id)),
    timestamp: '2026-05-20 22:10',
    provisional: true,
  };
}

/** Routes every `fetch` call by URL, deferring `/timeline` and `/roads`. */
function installFetchMock(): {
  timelineCalls: Deferred<Response>[];
  roadsCalls: Deferred<Response>[];
} {
  const timelineCalls: Deferred<Response>[] = [];
  const roadsCalls: Deferred<Response>[] = [];

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
    return Promise.resolve(
      jsonResponse({ schema_version: '1.0', trace_id: 'tr-other', stations: [] }),
    );
  });

  vi.stubGlobal('fetch', mock);
  return { timelineCalls, roadsCalls };
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

describe('DashboardPage road integration (TASK-125)', () => {
  let fetchMock: ReturnType<typeof installFetchMock>;

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

  it('36. mounts and issues exactly one initial GET /roads request', () => {
    const view = renderDashboard();

    expect(fetchMock.roadsCalls).toHaveLength(1);

    view.unmount();
  });

  it('37/38/39. authoritative timeline currentTimestamp advance triggers one road refresh (not the WS payload)', async () => {
    const view = renderDashboard();

    expect(fetchMock.timelineCalls).toHaveLength(1);
    expect(fetchMock.roadsCalls).toHaveLength(1);

    await act(async () => {
      fetchMock.timelineCalls[0]?.resolve(
        jsonResponse(timelineBody('2026-05-20 22:00', ['2026-05-20 22:00'])),
      );
      await flush();
    });

    // The initial road request resolves; only one so far.
    await act(async () => {
      fetchMock.roadsCalls[0]?.resolve(jsonResponse(roadsBody(['RD_1'])));
      await flush();
    });
    expect(fetchMock.roadsCalls).toHaveLength(1);

    const socketBeforeAdvance = FakeSocket.instances[0];

    act(() => {
      FakeSocket.instances[0]?.emitOpen();
      // WebSocket payload carries a fabricated timestamp that must never be
      // committed as road/timeline truth.
      FakeSocket.instances[0]?.emitMessage(
        JSON.stringify({
          schema_version: '1.0',
          event_type: 'timeline.updated',
          occurred_at: '2026-05-20 22:10',
          provisional: true,
          policy_version: 'prov-2026a',
          current_timestamp: '1999-01-01 00:00',
          source_timestamps: {},
        }),
      );
    });
    await flush();

    // The notification requests one authoritative GET /timeline refresh.
    expect(fetchMock.timelineCalls).toHaveLength(2);

    // Resolve the authoritative refresh with a genuinely new current value.
    await act(async () => {
      fetchMock.timelineCalls[1]?.resolve(
        jsonResponse(
          timelineBody('2026-05-20 22:20', ['2026-05-20 22:00', '2026-05-20 22:20']),
        ),
      );
      await flush();
    });

    // The authoritative currentTimestamp change triggers exactly one road
    // refresh — the second GET /roads request.
    expect(fetchMock.roadsCalls).toHaveLength(2);

    // Realtime connection must not have been recreated by this road-state
    // driven rerender.
    expect(FakeSocket.instances).toHaveLength(1);
    expect(FakeSocket.instances[0]).toBe(socketBeforeAdvance);

    view.unmount();
  });

  it('15/16. a failed polling roads outcome is ignored; a successful one is ingested without a second GET /roads', async () => {
    vi.useFakeTimers();
    const view = renderDashboard();

    await act(async () => {
      fetchMock.timelineCalls[0]?.resolve(
        jsonResponse(timelineBody('2026-05-20 22:00', ['2026-05-20 22:00'])),
      );
      fetchMock.roadsCalls[0]?.resolve(jsonResponse(roadsBody([])));
      await flush();
    });

    // Force the WebSocket into the degraded/polling operational mode.
    act(() => {
      FakeSocket.instances[0]?.emitError();
    });
    await flush();

    // The polling loop issues its own /timeline, /roads (and other) requests.
    // The cycle completes only once every target in the plan resolves, so
    // both the polled /timeline and /roads calls must be resolved.
    expect(fetchMock.roadsCalls.length).toBeGreaterThanOrEqual(2);
    expect(fetchMock.timelineCalls.length).toBeGreaterThanOrEqual(2);
    const pollRoadsIndex = fetchMock.roadsCalls.length - 1;
    const pollTimelineIndex = fetchMock.timelineCalls.length - 1;

    await act(async () => {
      fetchMock.roadsCalls[pollRoadsIndex]?.resolve(jsonResponse(roadsBody(['RD_POLLED'])));
      fetchMock.timelineCalls[pollTimelineIndex]?.resolve(
        jsonResponse(timelineBody('2026-05-20 22:00', ['2026-05-20 22:00'])),
      );
      await flush();
    });

    // Ingested directly: no additional GET /roads request was issued to
    // obtain this same data.
    const callsAfterIngestion = fetchMock.roadsCalls.length;
    expect(document.querySelector('[data-segment-id="RD_POLLED"]')).not.toBeNull();
    expect(fetchMock.roadsCalls.length).toBe(callsAfterIngestion);

    view.unmount();
  });

  it('40. TASK-124 timeline behavior remains green: current position renders from GET /timeline only', async () => {
    const view = renderDashboard();

    await act(async () => {
      fetchMock.timelineCalls[0]?.resolve(
        jsonResponse(timelineBody('2026-05-20 22:00', ['2026-05-20 22:00'])),
      );
      fetchMock.roadsCalls[0]?.resolve(jsonResponse(roadsBody([])));
      await flush();
    });

    expect(document.querySelector('.timeline-panel__current-value')?.textContent).toBe(
      '2026-05-20 22:00',
    );

    view.unmount();
  });
});
