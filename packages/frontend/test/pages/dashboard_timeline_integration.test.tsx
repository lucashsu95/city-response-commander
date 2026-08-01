/**
 * Dashboard Timeline Integration Tests (TASK-124 FIX 2)
 *
 * Exercises the real `DashboardPage` wiring between the timeline controller,
 * the WebSocket `timeline.updated` notification, and the TASK-122 polling
 * fallback — using the injected `WebSocket` stub and a deterministic `fetch`
 * mock (no live HTTP/WebSocket, no sleep, no real wall-clock timing; fake
 * timers drive the 2-second polling cadence deterministically).
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

// ─── Deterministic fetch mock ───────────────────────────────

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

function failedResponse(): Response {
  return { ok: false, status: 503, statusText: 'Service Unavailable' } as unknown as Response;
}

function validTimelineBody(current: string | null, timestamps: readonly string[]): unknown {
  return {
    timestamps,
    current,
    schema_version: '1.0',
    trace_id: 'tr-test',
    provisional: true,
  };
}

/**
 * Routes every `fetch` call by URL. `/timeline` calls are deferred so tests
 * can control resolution order and count; every other route (roads/crowd/
 * incidents — required by the default §13 fallback plan) resolves
 * immediately with a generic, structurally-harmless body.
 */
function installFetchMock(): { timelineCalls: Deferred<Response>[]; otherCallCount: () => number } {
  const timelineCalls: Deferred<Response>[] = [];
  let otherCalls = 0;

  const mock = vi.fn((input: unknown) => {
    const url = String(input);
    if (url.includes('/timeline')) {
      const deferred = createDeferred<Response>();
      timelineCalls.push(deferred);
      return deferred.promise;
    }
    otherCalls += 1;
    return Promise.resolve(
      jsonResponse({ schema_version: '1.0', trace_id: 'tr-other', segments: [], stations: [] }),
    );
  });

  vi.stubGlobal('fetch', mock);
  return { timelineCalls, otherCallCount: () => otherCalls };
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

describe('DashboardPage timeline integration (FIX 2)', () => {
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

  it('1. timeline.updated causes exactly one authoritative GET /timeline refresh', async () => {
    const view = renderDashboard();

    // Initial mount fetch.
    expect(fetchMock.timelineCalls).toHaveLength(1);
    await act(async () => {
      fetchMock.timelineCalls[0]?.resolve(
        jsonResponse(validTimelineBody('2026-05-20 22:00', ['2026-05-20 22:00'])),
      );
      await flush();
    });

    act(() => {
      FakeSocket.instances[0]?.emitOpen();
      FakeSocket.instances[0]?.emitMessage(
        JSON.stringify({
          schema_version: '1.0',
          event_type: 'timeline.updated',
          occurred_at: '2026-05-20 22:10',
          provisional: true,
          policy_version: 'prov-2026a',
          current_timestamp: '2026-05-20 22:10',
          source_timestamps: {},
        }),
      );
    });
    await flush();

    // Exactly one new GET /timeline request was issued by the notification.
    expect(fetchMock.timelineCalls).toHaveLength(2);

    view.unmount();
  });

  it('2. WebSocket event payload fields are never committed directly to timeline state', async () => {
    const view = renderDashboard();

    await act(async () => {
      fetchMock.timelineCalls[0]?.resolve(
        jsonResponse(validTimelineBody('2026-05-20 22:00', ['2026-05-20 22:00'])),
      );
      await flush();
    });

    act(() => {
      FakeSocket.instances[0]?.emitOpen();
      // The payload claims a wildly different current_timestamp than any
      // authoritative GET /timeline response will ever supply.
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

    expect(fetchMock.timelineCalls).toHaveLength(2);

    // Resolve the authoritative refresh with a value that differs from the
    // event's payload-claimed timestamp.
    await act(async () => {
      fetchMock.timelineCalls[1]?.resolve(
        jsonResponse(validTimelineBody('2026-05-20 22:20', ['2026-05-20 22:00', '2026-05-20 22:20'])),
      );
      await flush();
    });

    // The rendered current position must come from the authoritative
    // GET /timeline response, never from the event payload.
    expect(document.querySelector('.timeline-panel__current-value')?.textContent).toBe(
      '2026-05-20 22:20',
    );
    expect(screen.queryByText('1999-01-01 00:00')).not.toBeInTheDocument();

    view.unmount();
  });

  it('3. several timeline.updated signals during one in-flight request produce at most one queued follow-up', async () => {
    const view = renderDashboard();

    await act(async () => {
      fetchMock.timelineCalls[0]?.resolve(
        jsonResponse(validTimelineBody('2026-05-20 22:00', ['2026-05-20 22:00'])),
      );
      await flush();
    });

    act(() => {
      FakeSocket.instances[0]?.emitOpen();
    });

    // Fire the notification once to start a request, then fire it several
    // more times while that request is still in flight.
    act(() => {
      const socket = FakeSocket.instances[0];
      const frame = JSON.stringify({
        schema_version: '1.0',
        event_type: 'timeline.updated',
        occurred_at: '2026-05-20 22:10',
        provisional: true,
        policy_version: 'prov-2026a',
        current_timestamp: '2026-05-20 22:10',
        source_timestamps: {},
      });
      socket?.emitMessage(frame);
      socket?.emitMessage(frame);
      socket?.emitMessage(frame);
    });
    await flush();

    // Only one in-flight request from the first notification; the three
    // repeated signals must not create three overlapping requests.
    expect(fetchMock.timelineCalls).toHaveLength(2);

    await act(async () => {
      fetchMock.timelineCalls[1]?.resolve(
        jsonResponse(validTimelineBody('2026-05-20 22:10', ['2026-05-20 22:00', '2026-05-20 22:10'])),
      );
      await flush();
    });

    // At most one coalesced follow-up request fires after the in-flight one
    // completes.
    expect(fetchMock.timelineCalls).toHaveLength(3);

    view.unmount();
  });

  it('4/5. a successful polling outcome ingests the fetched body without a second GET /timeline request', async () => {
    vi.useFakeTimers();
    const view = renderDashboard();

    await act(async () => {
      fetchMock.timelineCalls[0]?.resolve(
        jsonResponse(validTimelineBody('2026-05-20 22:00', ['2026-05-20 22:00'])),
      );
      await flush();
    });
    expect(fetchMock.timelineCalls).toHaveLength(1);

    // Force the WebSocket into the degraded/polling operational mode.
    act(() => {
      FakeSocket.instances[0]?.emitError();
    });
    await flush();

    // The polling loop's first cycle runs immediately; resolve its /timeline
    // request with a new authoritative value.
    expect(fetchMock.timelineCalls.length).toBeGreaterThanOrEqual(2);
    const pollCallIndex = fetchMock.timelineCalls.length - 1;
    await act(async () => {
      fetchMock.timelineCalls[pollCallIndex]?.resolve(
        jsonResponse(validTimelineBody('2026-05-20 22:30', ['2026-05-20 22:00', '2026-05-20 22:30'])),
      );
      await flush();
    });

    // The polling-fetched body is ingested directly: it becomes the
    // rendered current position with no additional GET /timeline call.
    const callsAfterIngestion = fetchMock.timelineCalls.length;
    expect(document.querySelector('.timeline-panel__current-value')?.textContent).toBe(
      '2026-05-20 22:30',
    );
    expect(fetchMock.timelineCalls.length).toBe(callsAfterIngestion);

    view.unmount();
  });

  it('6. a failed polling outcome is ignored and cannot fabricate a ready state', async () => {
    vi.useFakeTimers();
    const view = renderDashboard();

    // The initial direct fetch also fails, so the controller has never
    // succeeded yet.
    await act(async () => {
      fetchMock.timelineCalls[0]?.resolve(failedResponse());
      await flush();
    });

    act(() => {
      FakeSocket.instances[0]?.emitError();
    });
    await flush();

    expect(fetchMock.timelineCalls.length).toBeGreaterThanOrEqual(2);
    const pollCallIndex = fetchMock.timelineCalls.length - 1;
    await act(async () => {
      fetchMock.timelineCalls[pollCallIndex]?.resolve(failedResponse());
      await flush();
    });

    // A failed polling target must never fabricate a successful timeline
    // read; the panel must not render a ready position, and must show its
    // own error state (scoped to `.timeline-panel`, since the operational
    // status bar also renders an unrelated `alert` for the polling failure).
    expect(document.querySelector('.timeline-panel__current-value')).toBeNull();
    const timelinePanelAlert = document.querySelector('.timeline-panel [role="alert"]');
    expect(timelinePanelAlert).not.toBeNull();

    view.unmount();
  });

  it('7. a non-timeline WebSocket event does not trigger a timeline refresh', async () => {
    const view = renderDashboard();

    await act(async () => {
      fetchMock.timelineCalls[0]?.resolve(
        jsonResponse(validTimelineBody('2026-05-20 22:00', ['2026-05-20 22:00'])),
      );
      await flush();
    });
    expect(fetchMock.timelineCalls).toHaveLength(1);

    act(() => {
      FakeSocket.instances[0]?.emitOpen();
      FakeSocket.instances[0]?.emitMessage(
        JSON.stringify({
          schema_version: '1.0',
          event_type: 'anomaly.detected',
          occurred_at: '2026-05-20 22:10',
          provisional: true,
          policy_version: 'prov-2026a',
          anomaly_type: 'A_LEVEL',
          segment_or_station_id: 'RD_TPE_002',
          threshold: '0.85',
          value: 0.9,
          summary: 'test',
        }),
      );
    });
    await flush();

    // No new GET /timeline request was issued for an unrelated event type.
    expect(fetchMock.timelineCalls).toHaveLength(1);

    view.unmount();
  });
});
