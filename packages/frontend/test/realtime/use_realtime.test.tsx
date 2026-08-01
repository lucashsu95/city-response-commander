/**
 * Realtime Hook Lifecycle Tests (TASK-122)
 *
 * Verifies that the realtime client follows the component lifecycle: one client
 * per mount, and a full teardown (socket, polling loop, timers) on unmount.
 */

import { describe, it, expect } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useRealtimeConnection } from '../../src/realtime/use_realtime.js';
import { createFakeScheduler, createFakeTransport, createSocketRecorder, flush } from './fakes.js';

const API_ENDPOINT = 'https://api.test.invalid';
const WS_ENDPOINT = 'wss://ws.test.invalid/realtime';
const POLLING_INTERVAL_MS = 2000;
const RECONNECT_DELAY_MS = 5000;

function renderRealtime() {
  const scheduler = createFakeScheduler();
  const transport = createFakeTransport();
  const sockets = createSocketRecorder();

  const view = renderHook(() =>
    useRealtimeConnection({
      apiEndpoint: API_ENDPOINT,
      wsEndpoint: WS_ENDPOINT,
      transport,
      scheduler,
      socketFactory: sockets.factory,
      pollingIntervalMs: POLLING_INTERVAL_MS,
      reconnectDelayMs: RECONNECT_DELAY_MS,
    }),
  );

  return { ...view, scheduler, transport, sockets };
}

describe('useRealtimeConnection', () => {
  it('starts one client and exposes the connected mode', () => {
    const harness = renderRealtime();

    expect(harness.sockets.instances).toHaveLength(1);
    expect(harness.result.current.connectionMode).toBe('disconnected');

    act(() => {
      harness.sockets.at(0).emitOpen();
    });

    expect(harness.result.current.connectionMode).toBe('websocket');
    expect(harness.result.current.operationalMode).toBe('connected');

    harness.unmount();
  });

  it('does not open a new socket when the component re-renders', () => {
    const harness = renderRealtime();
    harness.rerender();
    harness.rerender();

    expect(harness.sockets.instances).toHaveLength(1);

    harness.unmount();
  });

  it('exposes the degraded polling mode and keeps read updates flowing', async () => {
    const harness = renderRealtime();

    act(() => {
      harness.sockets.at(0).emitOpen();
      harness.sockets.at(0).emitError();
    });
    await act(async () => {
      await flush();
    });

    expect(harness.result.current.connectionMode).toBe('polling');
    expect(harness.result.current.operationalMode).toBe('polling');
    expect(harness.result.current.pollingActive).toBe(true);
    expect(harness.result.current.pollingUpdateCount).toBe(1);
    expect(harness.result.current.pollingErrorMessage).toBeNull();

    await act(async () => {
      harness.scheduler.runTimer(POLLING_INTERVAL_MS);
      await flush();
    });
    expect(harness.result.current.pollingUpdateCount).toBe(2);

    harness.unmount();
  });

  it('surfaces a polling failure instead of claiming live data', async () => {
    const harness = renderRealtime();
    harness.transport.failTarget('timeline');

    act(() => {
      harness.sockets.at(0).emitError();
    });
    await act(async () => {
      await flush();
    });

    expect(harness.result.current.connectionMode).toBe('polling');
    expect(harness.result.current.pollingErrorMessage).toContain('/timeline');

    harness.unmount();
  });

  it('stops the realtime client on unmount', async () => {
    const harness = renderRealtime();

    act(() => {
      harness.sockets.at(0).emitError();
    });
    await act(async () => {
      await flush();
    });

    expect(harness.scheduler.pendingCount()).toBe(2);
    const socket = harness.sockets.at(0);

    // Leave one polling cycle in flight so cancellation on unmount is observable.
    harness.transport.hold();
    harness.scheduler.runTimer(POLLING_INTERVAL_MS);
    const inFlightSignals = harness.transport.signals.slice(-4);
    const callsBeforeUnmount = harness.transport.calls.length;

    harness.unmount();

    expect(socket.closeCalls).toBe(1);
    expect(harness.scheduler.pendingCount()).toBe(0);
    expect(inFlightSignals.every((signal) => signal.aborted)).toBe(true);

    harness.transport.release();
    await flush();
    expect(harness.transport.calls.length).toBe(callsBeforeUnmount);
    expect(harness.sockets.instances).toHaveLength(1);
  });
});
