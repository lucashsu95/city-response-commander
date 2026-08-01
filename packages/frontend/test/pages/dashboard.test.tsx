/**
 * Dashboard Page Realtime Wiring Tests (TASK-122)
 *
 * Exercises the production path: the page builds its realtime client from the
 * validated runtime configuration and the native WebSocket constructor (stubbed
 * here so no real connection is ever opened).
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

function renderDashboard() {
  return render(
    <AppConfigProvider config={CONFIG}>
      <DashboardPage />
    </AppConfigProvider>,
  );
}

describe('DashboardPage realtime wiring', () => {
  beforeEach(() => {
    FakeSocket.reset();
    vi.stubGlobal('WebSocket', FakeSocket);
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new Error('fetch must not be called in this test'))),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    FakeSocket.reset();
  });

  it('opens exactly one WebSocket using the configured endpoint', () => {
    const view = renderDashboard();

    expect(FakeSocket.instances).toHaveLength(1);
    expect(FakeSocket.instances[0]?.url).toBe(CONFIG.wsEndpoint);

    view.unmount();
  });

  it('shows realtime mode once the socket opens', () => {
    const view = renderDashboard();

    act(() => {
      FakeSocket.instances[0]?.emitOpen();
    });

    expect(screen.getByText('即時連線（WebSocket）')).toBeInTheDocument();

    view.unmount();
  });

  it('stops the realtime client when the page unmounts', () => {
    const view = renderDashboard();
    act(() => {
      FakeSocket.instances[0]?.emitOpen();
    });

    const socket = FakeSocket.instances[0];
    view.unmount();

    expect(socket?.closeCalls).toBe(1);
    expect(socket?.isDetached()).toBe(true);
    expect(FakeSocket.instances).toHaveLength(1);
  });

  // ─── FIX 4: stable callback dependencies ────────────────────

  it('does not recreate the realtime connection when timeline state changes across rerenders', async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve({
            timestamps: ['2026-05-20 22:00'],
            current: '2026-05-20 22:00',
            schema_version: '1.0',
            trace_id: 'tr-test',
            provisional: true,
          }),
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const view = renderDashboard();

    act(() => {
      FakeSocket.instances[0]?.emitOpen();
    });
    const socketBeforeStateChange = FakeSocket.instances[0];

    // The timeline controller's mount-time GET /timeline resolves here,
    // driving a real `loading` -> `ready` state transition. Every such
    // transition re-renders DashboardPage with a brand-new `timeline`
    // controller object (its state is spread into a fresh object each
    // render). Before FIX 4, `useCallback` depending on the whole `timeline`
    // object would give `handleRealtimeEvent`/`handlePollingCycle` — and
    // therefore `useRealtimeConnection`'s `onEvent`/`onPollingCycle` props —
    // new identities on every such change.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(document.querySelector('.timeline-panel__current-value')?.textContent).toBe(
      '2026-05-20 22:00',
    );

    // The realtime connection (and its one socket) must not have been
    // recreated by this timeline-state-driven rerender.
    expect(FakeSocket.instances).toHaveLength(1);
    expect(FakeSocket.instances[0]).toBe(socketBeforeStateChange);

    view.unmount();
  });
});
