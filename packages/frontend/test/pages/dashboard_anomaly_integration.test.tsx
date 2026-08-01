/**
 * Dashboard Anomaly Integration Tests (TASK-127)
 *
 * Exercises the real `DashboardPage` wiring: the injected `WebSocket` stub and
 * a deterministic `fetch` mock, no live HTTP/WebSocket, no sleeping, no real
 * wall-clock timing.
 *
 * The central claims proved here are the ones a reviewer cannot check from the
 * unit tests alone: the popup opens from a real WebSocket frame with no
 * operator action, the polling fallback path adds no HTTP request, and the
 * TASK-125/126 panels keep receiving their own data.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
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

/**
 * `saturation_score` is deliberately contradictory: 0.10 on an A-level segment
 * and 0.99 on a non-classified one. If the client ever recomputed the SOP-1
 * threshold, these fixtures would produce the opposite result.
 */
function roadsBody(level: string | null, timestamp = '2026-05-20 22:10'): unknown {
  return {
    schema_version: '1.0',
    trace_id: 'tr-roads',
    segments: [
      {
        segment_id: 'RD_POLLED',
        road_name: '中山北路',
        saturation_score: level === null ? 0.99 : 0.1,
        level,
        lane_status: 'Congested',
      },
    ],
    timestamp,
    provisional: true,
  };
}

function crowdBody(flags: readonly string[]): unknown {
  return {
    schema_version: '1.0',
    trace_id: 'tr-crowd',
    data_status: 'ready',
    stations: [
      {
        BS_ID: 'BS_POLLED',
        Location_Name: '台北車站',
        User_Count: flags.length === 0 ? 999_999 : 1,
        Growth_Rate: 0,
        roaming_pct_value: flags.length === 0 ? 0.99 : 0.001,
        Roaming_User_Pct: flags.length === 0 ? '99%' : '0.1%',
        flags,
      },
    ],
    decision_cutoff_timestamp: '2026-05-20 22:10',
    provisional: true,
  };
}

function anomalyFrame(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    schema_version: '1.0',
    trace_id: 'tr-anomaly',
    occurred_at: '2026-05-20 22:10',
    provisional: true,
    policy_version: 'prov-2026a',
    event_type: 'anomaly.detected',
    anomaly_type: 'ROAD_SATURATION',
    segment_or_station_id: 'RD_TPE_0007',
    threshold: 'SOP-1 A 級',
    value: 0.97,
    summary: '後端原文：中山北路南下車道已達癱瘓等級。',
    ...overrides,
  });
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

/** Resolves the initial mount reads so the page reaches a settled state. */
async function settleInitialLoad(fetchMock: FetchMock): Promise<void> {
  await act(async () => {
    fetchMock.timelineCalls[0]?.resolve(
      jsonResponse(timelineBody('2026-05-20 22:00', ['2026-05-20 22:00'])),
    );
    fetchMock.roadsCalls[0]?.resolve(jsonResponse(roadsBody(null)));
    fetchMock.crowdCalls[0]?.resolve(jsonResponse(crowdBody([])));
    await flush();
  });
}

describe('DashboardPage anomaly integration (TASK-127)', () => {
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

  it('1. renders no anomaly dialog in the ordinary dashboard state', async () => {
    const view = renderDashboard();
    await settleInitialLoad(fetchMock);

    expect(screen.queryByRole('alertdialog')).toBeNull();

    view.unmount();
  });

  it('2/3/4. an anomaly.detected frame auto-opens the popup with no click and no extra request', async () => {
    const view = renderDashboard();
    await settleInitialLoad(fetchMock);

    const roadsBefore = fetchMock.roadsCalls.length;
    const crowdBefore = fetchMock.crowdCalls.length;
    const timelineBefore = fetchMock.timelineCalls.length;

    act(() => {
      FakeSocket.instances[0]?.emitOpen();
      FakeSocket.instances[0]?.emitMessage(anomalyFrame());
    });
    await flush();

    // Auto-opened: no operator interaction happened between emit and assert.
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(screen.getByTestId('anomaly-popup-description').textContent).toBe(
      '後端原文：中山北路南下車道已達癱瘓等級。',
    );

    // No follow-up query of any kind was needed to render it.
    expect(fetchMock.roadsCalls.length).toBe(roadsBefore);
    expect(fetchMock.crowdCalls.length).toBe(crowdBefore);
    expect(fetchMock.timelineCalls.length).toBe(timelineBefore);

    view.unmount();
  });

  it('5. a malformed anomaly frame fails closed and never opens a dialog', async () => {
    const view = renderDashboard();
    await settleInitialLoad(fetchMock);

    act(() => {
      FakeSocket.instances[0]?.emitOpen();
      // Valid §13 event_type, but the canonical payload fields are missing.
      FakeSocket.instances[0]?.emitMessage(
        JSON.stringify({ event_type: 'anomaly.detected', summary: 'partial' }),
      );
      FakeSocket.instances[0]?.emitMessage('not json at all');
    });
    await flush();

    expect(screen.queryByRole('alertdialog')).toBeNull();

    view.unmount();
  });

  it('6/7. a resent frame does not reopen the popup after dismissal', async () => {
    const view = renderDashboard();
    await settleInitialLoad(fetchMock);

    act(() => {
      FakeSocket.instances[0]?.emitOpen();
      FakeSocket.instances[0]?.emitMessage(anomalyFrame());
    });
    await flush();
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('anomaly-popup-close'));
    expect(screen.queryByRole('alertdialog')).toBeNull();

    act(() => {
      FakeSocket.instances[0]?.emitMessage(anomalyFrame());
    });
    await flush();

    expect(screen.queryByRole('alertdialog')).toBeNull();

    view.unmount();
  });

  it('8. a new backend identity reopens the popup', async () => {
    const view = renderDashboard();
    await settleInitialLoad(fetchMock);

    act(() => {
      FakeSocket.instances[0]?.emitOpen();
      FakeSocket.instances[0]?.emitMessage(anomalyFrame());
    });
    await flush();
    fireEvent.click(screen.getByTestId('anomaly-popup-close'));

    act(() => {
      FakeSocket.instances[0]?.emitMessage(anomalyFrame({ occurred_at: '2026-05-20 22:30' }));
    });
    await flush();

    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByTestId('anomaly-popup-observed-at').textContent).toBe('2026-05-20 22:30');

    view.unmount();
  });

  it('23. Escape closes the auto-opened popup', async () => {
    const view = renderDashboard();
    await settleInitialLoad(fetchMock);

    act(() => {
      FakeSocket.instances[0]?.emitOpen();
      FakeSocket.instances[0]?.emitMessage(anomalyFrame());
    });
    await flush();
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(screen.queryByRole('alertdialog')).toBeNull();

    view.unmount();
  });

  it('24. focus enters the popup when it auto-opens', async () => {
    const view = renderDashboard();
    await settleInitialLoad(fetchMock);

    act(() => {
      FakeSocket.instances[0]?.emitOpen();
      FakeSocket.instances[0]?.emitMessage(anomalyFrame());
    });
    await flush();

    expect(document.activeElement).toBe(screen.getByTestId('anomaly-popup-close'));

    view.unmount();
  });

  it('9/16/26. an active roads polling sample opens the popup and still feeds the road panel, with no second GET /roads', async () => {
    vi.useFakeTimers();
    const view = renderDashboard();
    await settleInitialLoad(fetchMock);

    // Force the degraded/polling operational mode.
    act(() => {
      FakeSocket.instances[0]?.emitError();
    });
    await flush();

    expect(fetchMock.roadsCalls.length).toBeGreaterThanOrEqual(2);
    expect(fetchMock.crowdCalls.length).toBeGreaterThanOrEqual(2);
    expect(fetchMock.timelineCalls.length).toBeGreaterThanOrEqual(2);

    const polledRoads = fetchMock.roadsCalls.length - 1;
    const polledCrowd = fetchMock.crowdCalls.length - 1;
    const polledTimeline = fetchMock.timelineCalls.length - 1;

    await act(async () => {
      // Server verdict: level A. Raw saturation_score is 0.10.
      fetchMock.roadsCalls[polledRoads]?.resolve(jsonResponse(roadsBody('A')));
      fetchMock.crowdCalls[polledCrowd]?.resolve(jsonResponse(crowdBody([])));
      fetchMock.timelineCalls[polledTimeline]?.resolve(
        jsonResponse(timelineBody('2026-05-20 22:00', ['2026-05-20 22:00'])),
      );
      await flush();
    });

    const roadsAfterIngest = fetchMock.roadsCalls.length;

    // The popup opened from the polled body.
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByTestId('anomaly-popup-source').textContent).toContain('GET /roads');
    expect(screen.getByTestId('anomaly-popup-category').textContent).toBe('A');

    // TASK-125 still received the very same payload.
    expect(document.querySelector('[data-segment-id="RD_POLLED"]')).not.toBeNull();

    // And no extra GET /roads was issued to obtain any of it.
    expect(fetchMock.roadsCalls.length).toBe(roadsAfterIngest);

    view.unmount();
  });

  it('17. an inactive roads verdict with a high saturation_score never opens the popup', async () => {
    vi.useFakeTimers();
    const view = renderDashboard();
    await settleInitialLoad(fetchMock);

    act(() => {
      FakeSocket.instances[0]?.emitError();
    });
    await flush();

    const polledRoads = fetchMock.roadsCalls.length - 1;
    const polledCrowd = fetchMock.crowdCalls.length - 1;
    const polledTimeline = fetchMock.timelineCalls.length - 1;

    await act(async () => {
      // level null, saturation_score 0.99 — the client must not classify.
      fetchMock.roadsCalls[polledRoads]?.resolve(jsonResponse(roadsBody(null)));
      fetchMock.crowdCalls[polledCrowd]?.resolve(jsonResponse(crowdBody([])));
      fetchMock.timelineCalls[polledTimeline]?.resolve(
        jsonResponse(timelineBody('2026-05-20 22:00', ['2026-05-20 22:00'])),
      );
      await flush();
    });

    expect(screen.queryByRole('alertdialog')).toBeNull();

    view.unmount();
  });

  it('18/27. an active crowd flag opens the popup without any extra GET /crowd', async () => {
    vi.useFakeTimers();
    const view = renderDashboard();
    await settleInitialLoad(fetchMock);

    act(() => {
      FakeSocket.instances[0]?.emitError();
    });
    await flush();

    const polledRoads = fetchMock.roadsCalls.length - 1;
    const polledCrowd = fetchMock.crowdCalls.length - 1;
    const polledTimeline = fetchMock.timelineCalls.length - 1;

    await act(async () => {
      fetchMock.roadsCalls[polledRoads]?.resolve(jsonResponse(roadsBody(null)));
      // Server flag present, raw metrics minimal.
      fetchMock.crowdCalls[polledCrowd]?.resolve(
        jsonResponse(crowdBody(['SOP3_CROWD_SURGE'])),
      );
      fetchMock.timelineCalls[polledTimeline]?.resolve(
        jsonResponse(timelineBody('2026-05-20 22:00', ['2026-05-20 22:00'])),
      );
      await flush();
    });

    const crowdAfterIngest = fetchMock.crowdCalls.length;

    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByTestId('anomaly-popup-source').textContent).toContain('GET /crowd');
    expect(screen.getByTestId('anomaly-popup-entity').textContent).toBe('BS_POLLED');

    expect(fetchMock.crowdCalls.length).toBe(crowdAfterIngest);

    view.unmount();
  });

  it('25. the anomaly popup state change never recreates the realtime connection', async () => {
    const view = renderDashboard();
    await settleInitialLoad(fetchMock);

    act(() => {
      FakeSocket.instances[0]?.emitOpen();
    });
    await flush();

    expect(FakeSocket.instances).toHaveLength(1);
    const socketBefore = FakeSocket.instances[0];

    act(() => {
      FakeSocket.instances[0]?.emitMessage(anomalyFrame());
    });
    await flush();
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('anomaly-popup-close'));
    await flush();

    act(() => {
      FakeSocket.instances[0]?.emitMessage(anomalyFrame({ occurred_at: '2026-05-20 23:00' }));
    });
    await flush();

    // Opening, dismissing, and reopening are ordinary rerenders.
    expect(FakeSocket.instances).toHaveLength(1);
    expect(FakeSocket.instances[0]).toBe(socketBefore);

    view.unmount();
  });

  it('28. unmounting while an anomaly is on screen produces no error', async () => {
    const view = renderDashboard();
    await settleInitialLoad(fetchMock);

    act(() => {
      FakeSocket.instances[0]?.emitOpen();
      FakeSocket.instances[0]?.emitMessage(anomalyFrame());
    });
    await flush();
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();

    expect(() => {
      view.unmount();
    }).not.toThrow();

    await flush();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });
});
