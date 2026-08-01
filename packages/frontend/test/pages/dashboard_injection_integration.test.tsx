/**
 * Dashboard Injection Integration Tests (§12, §17, TASK-128, gap coverage per
 * TASK-135)
 *
 * Exercises the real `DashboardPage` wiring for the injection panel: no
 * dedicated test previously exercised `AdminSessionControl` + `InjectionPanel`
 * mounted together inside the actual dashboard, driven through the same
 * injected `WebSocket` stub and deterministic `fetch` mock used by the other
 * dashboard integration suites.
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

function timelineBody(): unknown {
  return {
    timestamps: ['2026-05-20 22:00'],
    current: '2026-05-20 22:00',
    schema_version: '1.0',
    trace_id: 'tr-test',
    provisional: true,
  };
}

function roadsBody(): unknown {
  return {
    schema_version: '1.0',
    trace_id: 'tr-roads',
    segments: [],
    timestamp: '2026-05-20 22:10',
    provisional: true,
  };
}

function crowdBody(): unknown {
  return {
    schema_version: '1.0',
    trace_id: 'tr-crowd',
    data_status: 'ready',
    stations: [],
    decision_cutoff_timestamp: '2026-05-20 22:10',
    provisional: true,
  };
}

interface FetchMock {
  timelineCalls: Deferred<Response>[];
  roadsCalls: Deferred<Response>[];
  crowdCalls: Deferred<Response>[];
  injectCalls: { url: string; init: RequestInit; resolveWith: (status: number, body: unknown) => void }[];
}

/** Routes GET calls by URL and captures POST /incidents/.../inject calls directly. */
function installFetchMock(): FetchMock {
  const timelineCalls: Deferred<Response>[] = [];
  const roadsCalls: Deferred<Response>[] = [];
  const crowdCalls: Deferred<Response>[] = [];
  const injectCalls: FetchMock['injectCalls'] = [];

  const mock = vi.fn((input: unknown, init?: RequestInit) => {
    const url = String(input);
    if (init?.method === 'POST' && url.includes('/inject')) {
      return new Promise<Response>((resolve) => {
        injectCalls.push({
          url,
          init: init ?? {},
          resolveWith: (status: number, body: unknown) => {
            resolve({
              ok: status >= 200 && status < 300,
              status,
              json: () => Promise.resolve(body),
            } as unknown as Response);
          },
        });
      });
    }
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
    return Promise.resolve(jsonResponse({ schema_version: '1.0', trace_id: 'tr-other' }));
  });

  vi.stubGlobal('fetch', mock);
  return { timelineCalls, roadsCalls, crowdCalls, injectCalls };
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
    fetchMock.timelineCalls[0]?.resolve(jsonResponse(timelineBody()));
    fetchMock.roadsCalls[0]?.resolve(jsonResponse(roadsBody()));
    fetchMock.crowdCalls[0]?.resolve(jsonResponse(crowdBody()));
    await flush();
  });
}

describe('DashboardPage injection integration (§12, §17)', () => {
  let fetchMock: FetchMock;

  beforeEach(() => {
    FakeSocket.reset();
    vi.stubGlobal('WebSocket', FakeSocket);
    fetchMock = installFetchMock();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    FakeSocket.reset();
  });

  it('mounts the admin session control and injection panel, gated with no admin token', async () => {
    const view = renderDashboard();
    await settleInitialLoad(fetchMock);

    expect(screen.getByTestId('admin-session-control')).toBeInTheDocument();
    expect(screen.getByTestId('injection-panel')).toBeInTheDocument();
    expect(screen.queryByTestId('injection-event-id-input')).toBeNull();
    expect(screen.getByText(/尚未偵測到管理員憑證/)).toBeInTheDocument();

    view.unmount();
  });

  it('loading an admin token through the real control unlocks the real injection form', async () => {
    const view = renderDashboard();
    await settleInitialLoad(fetchMock);

    fireEvent.change(screen.getByTestId('admin-jwt-input'), {
      target: { value: 'admin.jwt.value' },
    });
    fireEvent.click(screen.getByTestId('admin-session-load-button'));

    expect(screen.getByTestId('admin-session-status').textContent).toBe('目前狀態：已載入憑證');
    expect(screen.getByTestId('injection-event-id-input')).toBeInTheDocument();

    view.unmount();
  });

  it('operator can inject an event end-to-end from the real dashboard, and it carries the admin header', async () => {
    const view = renderDashboard();
    await settleInitialLoad(fetchMock);

    fireEvent.change(screen.getByTestId('admin-jwt-input'), {
      target: { value: 'admin.jwt.value' },
    });
    fireEvent.click(screen.getByTestId('admin-session-load-button'));

    fireEvent.change(screen.getByTestId('injection-event-id-input'), {
      target: { value: 'TPE_2026_ACC_001' },
    });
    fireEvent.click(screen.getByTestId('injection-submit-button'));
    expect(screen.getByTestId('injection-confirm-group')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByTestId('injection-confirm-button'));
      await flush();
    });

    expect(fetchMock.injectCalls).toHaveLength(1);
    const call = fetchMock.injectCalls[0];
    expect(call?.url).toContain('incidents/TPE_2026_ACC_001/inject');
    const headers = call?.init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer admin.jwt.value');

    await act(async () => {
      call?.resolveWith(202, { decision_id: 'DEC_1', trace_id: 'tr-1' });
      await flush();
    });

    expect(screen.getByTestId('injection-accepted')).toBeInTheDocument();

    view.unmount();
  });

  it('clearing the admin token re-locks the injection form', async () => {
    const view = renderDashboard();
    await settleInitialLoad(fetchMock);

    fireEvent.change(screen.getByTestId('admin-jwt-input'), {
      target: { value: 'admin.jwt.value' },
    });
    fireEvent.click(screen.getByTestId('admin-session-load-button'));
    expect(screen.getByTestId('injection-event-id-input')).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('admin-session-clear-button'));

    expect(screen.queryByTestId('injection-event-id-input')).toBeNull();
    expect(screen.getByText(/尚未偵測到管理員憑證/)).toBeInTheDocument();

    view.unmount();
  });

  it('a 409 terminal conflict from the real dashboard offers no retry', async () => {
    const view = renderDashboard();
    await settleInitialLoad(fetchMock);

    fireEvent.change(screen.getByTestId('admin-jwt-input'), {
      target: { value: 'admin.jwt.value' },
    });
    fireEvent.click(screen.getByTestId('admin-session-load-button'));

    fireEvent.change(screen.getByTestId('injection-event-id-input'), {
      target: { value: 'TPE_2026_ACC_001' },
    });
    fireEvent.click(screen.getByTestId('injection-submit-button'));

    await act(async () => {
      fireEvent.click(screen.getByTestId('injection-confirm-button'));
      await flush();
    });

    await act(async () => {
      fetchMock.injectCalls[0]?.resolveWith(409, {
        decision_id: 'DEC_1',
        status: 'processing_failed',
        error_code: 'CORE_IDENTITY_CONFLICT',
        retryable: false,
      });
      await flush();
    });

    expect(screen.getByTestId('injection-terminal-conflict')).toBeInTheDocument();
    expect(screen.queryByTestId('injection-retry-button')).toBeNull();

    view.unmount();
  });

  it('injection does not disturb the road/crowd/timeline panels already mounted', async () => {
    const view = renderDashboard();
    await settleInitialLoad(fetchMock);

    const roadsCallsBefore = fetchMock.roadsCalls.length;
    const crowdCallsBefore = fetchMock.crowdCalls.length;
    const timelineCallsBefore = fetchMock.timelineCalls.length;

    fireEvent.change(screen.getByTestId('admin-jwt-input'), {
      target: { value: 'admin.jwt.value' },
    });
    fireEvent.click(screen.getByTestId('admin-session-load-button'));
    fireEvent.change(screen.getByTestId('injection-event-id-input'), {
      target: { value: 'TPE_2026_ACC_001' },
    });
    fireEvent.click(screen.getByTestId('injection-submit-button'));

    await act(async () => {
      fireEvent.click(screen.getByTestId('injection-confirm-button'));
      await flush();
    });

    expect(fetchMock.roadsCalls.length).toBe(roadsCallsBefore);
    expect(fetchMock.crowdCalls.length).toBe(crowdCallsBefore);
    expect(fetchMock.timelineCalls.length).toBe(timelineCallsBefore);

    view.unmount();
  });
});
