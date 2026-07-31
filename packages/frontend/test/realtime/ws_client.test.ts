/**
 * WebSocket Client / Connection State Machine Tests (TASK-122)
 *
 * Covers the §16.4 lifecycle:
 *   connected → (onerror | unexpected close) → polling → reconnect → connected
 *
 * All browser resources are injected: no real WebSocket, HTTP, or timers.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { createRealtimeClient } from '../../src/realtime/ws_client.js';
import type { RealtimeError } from '../../src/realtime/ws_client.js';
import type { RealtimeEventEnvelope } from '../../src/realtime/transport_events.js';
import { createFakeScheduler, createFakeTransport, createSocketRecorder, flush } from './fakes.js';

const WS_ENDPOINT = 'wss://ws.test.invalid/realtime';
const POLLING_INTERVAL_MS = 2000;
const RECONNECT_DELAY_MS = 5000;

/** Default fallback plan targets (§13 unparameterized live-read set). */
const DEFAULT_TARGET_COUNT = 4;

function createHarness() {
  const scheduler = createFakeScheduler();
  const transport = createFakeTransport();
  const sockets = createSocketRecorder();
  const errors: RealtimeError[] = [];
  const messages: RealtimeEventEnvelope[] = [];

  const client = createRealtimeClient({
    wsEndpoint: WS_ENDPOINT,
    transport,
    scheduler,
    socketFactory: sockets.factory,
    pollingIntervalMs: POLLING_INTERVAL_MS,
    reconnectDelayMs: RECONNECT_DELAY_MS,
  });

  client.subscribeError((error) => errors.push(error));
  client.subscribeMessage((envelope) => messages.push(envelope));

  return { client, scheduler, transport, sockets, errors, messages };
}

function fastPathFrame(): string {
  return JSON.stringify({
    schema_version: '1.0',
    event_type: 'decision.fast_path_ready',
    decision_id: 'dec-acc001',
    ready_event_id: 'dec-acc001|decision.fast_path_ready|1',
    occurred_at: '2026-05-20 22:10',
    trace_id: 'tr-abc123',
    provisional: true,
    policy_version: 'prov-2026a',
  });
}

describe('createRealtimeClient — state machine', () => {
  let harness: ReturnType<typeof createHarness>;

  beforeEach(() => {
    harness = createHarness();
  });

  it('start creates exactly one WebSocket', () => {
    harness.client.start();

    expect(harness.sockets.instances).toHaveLength(1);
    expect(harness.sockets.at(0).url).toBe(WS_ENDPOINT);
    expect(harness.client.getStatus().state).toBe('connecting');

    // Repeated start must not open a second socket.
    harness.client.start();
    expect(harness.sockets.instances).toHaveLength(1);

    harness.client.stop();
  });

  it('open changes mode to connected', () => {
    harness.client.start();
    harness.sockets.at(0).emitOpen();

    const status = harness.client.getStatus();
    expect(status.state).toBe('connected');
    expect(status.mode).toBe('connected');
    expect(status.pollingActive).toBe(false);

    harness.client.stop();
  });

  it('socket error changes mode to polling and starts fallback polling', async () => {
    harness.client.start();
    harness.sockets.at(0).emitOpen();
    harness.sockets.at(0).emitError();

    const status = harness.client.getStatus();
    expect(status.state).toBe('polling');
    expect(status.mode).toBe('polling');
    expect(status.pollingActive).toBe(true);
    expect(harness.transport.calls).toHaveLength(DEFAULT_TARGET_COUNT);
    expect(harness.errors.some((entry) => entry.source === 'transport')).toBe(true);

    await flush();
    harness.client.stop();
  });

  it('unexpected close changes mode to polling', async () => {
    harness.client.start();
    harness.sockets.at(0).emitOpen();
    harness.sockets.at(0).emitClose(1006);

    const status = harness.client.getStatus();
    expect(status.state).toBe('polling');
    expect(status.mode).toBe('polling');
    expect(status.pollingActive).toBe(true);
    expect(
      harness.errors.some(
        (entry) => entry.source === 'transport' && entry.error.code === 'UNEXPECTED_CLOSE',
      ),
    ).toBe(true);

    await flush();
    harness.client.stop();
  });

  it('repeated error and close do not start duplicate polling or reconnect loops', async () => {
    harness.client.start();
    harness.sockets.at(0).emitOpen();

    harness.sockets.at(0).emitError();
    harness.sockets.at(0).emitError();
    harness.sockets.at(0).emitClose(1006);

    await flush();

    // One immediate cycle only, then exactly one polling timer + one reconnect timer.
    expect(harness.transport.calls).toHaveLength(DEFAULT_TARGET_COUNT);
    expect(harness.scheduler.pendingCount()).toBe(2);
    expect([...harness.scheduler.pendingDelays()].sort((a, b) => a - b)).toEqual([
      POLLING_INTERVAL_MS,
      RECONNECT_DELAY_MS,
    ]);
    expect(harness.sockets.instances).toHaveLength(1);
    expect(harness.sockets.at(0).isDetached()).toBe(true);

    harness.client.stop();
  });

  it('polling remains active while reconnect attempts occur', async () => {
    harness.client.start();
    harness.sockets.at(0).emitError();
    await flush();

    // Reconnect attempt fires; polling must keep running.
    expect(harness.scheduler.runTimer(RECONNECT_DELAY_MS)).toBe(true);
    expect(harness.sockets.instances).toHaveLength(2);
    expect(harness.client.getStatus().state).toBe('polling');
    expect(harness.client.getStatus().pollingActive).toBe(true);

    // Polling cycle continues on its own cadence during the reconnect attempt.
    expect(harness.scheduler.runTimer(POLLING_INTERVAL_MS)).toBe(true);
    await flush();
    expect(harness.transport.calls.length).toBe(DEFAULT_TARGET_COUNT * 2);

    // A failed reconnect schedules another attempt without duplicating polling.
    harness.sockets.at(1).emitError();
    await flush();
    expect(harness.client.getStatus().pollingActive).toBe(true);
    expect(harness.scheduler.pendingDelays()).toContain(RECONNECT_DELAY_MS);

    harness.client.stop();
  });

  it('reconnect open changes mode back to connected and stops polling', async () => {
    harness.client.start();
    harness.sockets.at(0).emitError();
    await flush();

    harness.scheduler.runTimer(RECONNECT_DELAY_MS);
    harness.sockets.at(1).emitOpen();
    await flush();

    const status = harness.client.getStatus();
    expect(status.state).toBe('connected');
    expect(status.mode).toBe('connected');
    expect(status.pollingActive).toBe(false);
    expect(status.reconnectScheduled).toBe(false);
    expect(harness.scheduler.pendingCount()).toBe(0);

    const callsAfterReconnect = harness.transport.calls.length;
    await flush();
    expect(harness.transport.calls.length).toBe(callsAfterReconnect);

    harness.client.stop();
  });

  it('stop cancels polling, reconnect scheduling, and closes the active socket', async () => {
    harness.client.start();
    harness.sockets.at(0).emitError();
    await flush();

    expect(harness.scheduler.pendingCount()).toBe(2);
    harness.scheduler.runTimer(RECONNECT_DELAY_MS);
    const socket = harness.sockets.at(1);

    // Leave one polling cycle in flight so cancellation can be observed.
    harness.transport.hold();
    harness.scheduler.runTimer(POLLING_INTERVAL_MS);
    const inFlightSignals = harness.transport.signals.slice(-DEFAULT_TARGET_COUNT);
    expect(inFlightSignals).toHaveLength(DEFAULT_TARGET_COUNT);

    harness.client.stop();

    const status = harness.client.getStatus();
    expect(status.state).toBe('stopped');
    expect(status.mode).toBeNull();
    expect(status.pollingActive).toBe(false);
    expect(status.reconnectScheduled).toBe(false);
    expect(harness.scheduler.pendingCount()).toBe(0);
    expect(socket.closeCalls).toBe(1);
    expect(socket.isDetached()).toBe(true);
    expect(inFlightSignals.every((signal) => signal.aborted)).toBe(true);

    const callsAfterStop = harness.transport.calls.length;
    harness.transport.release();
    await flush();
    expect(harness.transport.calls.length).toBe(callsAfterStop);
    expect(harness.scheduler.pendingCount()).toBe(0);
  });

  it('stop is idempotent and prevents any later restart', async () => {
    harness.client.start();
    harness.sockets.at(0).emitOpen();

    harness.client.stop();
    harness.client.stop();
    harness.client.start();

    expect(harness.sockets.instances).toHaveLength(1);
    expect(harness.sockets.at(0).closeCalls).toBe(1);
    expect(harness.client.getStatus().state).toBe('stopped');
    expect(harness.scheduler.pendingCount()).toBe(0);
    await flush();
  });

  it('ignores stale callbacks from a replaced socket', async () => {
    harness.client.start();
    const stale = harness.sockets.at(0);
    stale.emitError();
    await flush();

    harness.scheduler.runTimer(RECONNECT_DELAY_MS);
    harness.sockets.at(1).emitOpen();
    await flush();
    expect(harness.client.getStatus().state).toBe('connected');

    // Late callbacks from the replaced socket must not mutate the new state.
    stale.onclose?.({ type: 'close', code: 1006, reason: '', wasClean: false });
    stale.onerror?.({ type: 'error' });
    stale.onmessage?.({ data: fastPathFrame() });

    const status = harness.client.getStatus();
    expect(status.state).toBe('connected');
    expect(status.pollingActive).toBe(false);
    expect(harness.messages).toHaveLength(0);

    harness.client.stop();
  });

  it('invalid JSON produces a typed transport error without crashing', () => {
    harness.client.start();
    harness.sockets.at(0).emitOpen();

    expect(() => harness.sockets.at(0).emitMessage('{not-json')).not.toThrow();

    const transportErrors = harness.errors.filter((entry) => entry.source === 'transport');
    expect(transportErrors).toHaveLength(1);
    expect(transportErrors[0]?.error.code).toBe('INVALID_JSON');
    expect(transportErrors[0]?.error.message).not.toContain('{not-json');
    expect(harness.messages).toHaveLength(0);
    expect(harness.client.getStatus().state).toBe('connected');

    harness.client.stop();
  });

  it('reports a typed error for a frame with an unknown or missing event type', () => {
    harness.client.start();
    harness.sockets.at(0).emitOpen();

    harness.sockets.at(0).emitMessage(JSON.stringify({ event_type: 'not.a.contract.event' }));
    harness.sockets.at(0).emitMessage(JSON.stringify({ schema_version: '1.0' }));
    harness.sockets.at(0).emitMessage(42);

    const codes = harness.errors
      .filter((entry) => entry.source === 'transport')
      .map((entry) => entry.error.code);
    expect(codes).toEqual(['UNKNOWN_EVENT_TYPE', 'INVALID_ENVELOPE', 'UNSUPPORTED_MESSAGE_FORMAT']);
    expect(harness.messages).toHaveLength(0);

    harness.client.stop();
  });

  it('forwards a valid message with its transport envelope preserved', () => {
    harness.client.start();
    harness.sockets.at(0).emitOpen();
    harness.sockets.at(0).emitMessage(fastPathFrame());

    expect(harness.messages).toHaveLength(1);
    const envelope = harness.messages[0];
    expect(envelope?.eventType).toBe('decision.fast_path_ready');
    expect(envelope?.decisionId).toBe('dec-acc001');
    expect(envelope?.occurredAt).toBe('2026-05-20 22:10');
    expect(envelope?.readyEventId).toBe('dec-acc001|decision.fast_path_ready|1');
    expect(envelope?.payload).toEqual(JSON.parse(fastPathFrame()));

    harness.client.stop();
  });

  it('forwards duplicate messages twice because dedup belongs to TASK-123', () => {
    harness.client.start();
    harness.sockets.at(0).emitOpen();

    harness.sockets.at(0).emitMessage(fastPathFrame());
    harness.sockets.at(0).emitMessage(fastPathFrame());

    expect(harness.messages).toHaveLength(2);
    expect(harness.messages[0]?.readyEventId).toBe(harness.messages[1]?.readyEventId);

    harness.client.stop();
  });

  it('one throwing status subscriber does not block another subscriber', async () => {
    const scheduler = createFakeScheduler();
    const transport = createFakeTransport();
    const sockets = createSocketRecorder();
    const client = createRealtimeClient({
      wsEndpoint: WS_ENDPOINT,
      transport,
      scheduler,
      socketFactory: sockets.factory,
      pollingIntervalMs: POLLING_INTERVAL_MS,
      reconnectDelayMs: RECONNECT_DELAY_MS,
    });

    let throwingCalls = 0;
    const healthy: string[] = [];
    client.subscribeStatus(() => {
      throwingCalls += 1;
      throw new Error('status subscriber fault');
    });
    client.subscribeStatus((status) => healthy.push(status.state));

    expect(() => client.start()).not.toThrow();
    expect(() => sockets.at(0).emitOpen()).not.toThrow();
    expect(() => sockets.at(0).emitError()).not.toThrow();
    await flush();

    // The healthy subscriber saw every transition; the state machine survived.
    expect(throwingCalls).toBeGreaterThanOrEqual(3);
    expect(healthy).toContain('connecting');
    expect(healthy).toContain('connected');
    expect(healthy).toContain('polling');
    expect(client.getStatus().state).toBe('polling');
    expect(client.getStatus().pollingActive).toBe(true);
    // Reconnect scheduling and cleanup still work.
    expect(client.getStatus().reconnectScheduled).toBe(true);

    client.stop();
    expect(scheduler.pendingCount()).toBe(0);
    expect(sockets.at(0).closeCalls).toBe(1);
  });

  it('one throwing error subscriber does not block another subscriber', async () => {
    const scheduler = createFakeScheduler();
    const transport = createFakeTransport();
    const sockets = createSocketRecorder();
    const client = createRealtimeClient({
      wsEndpoint: WS_ENDPOINT,
      transport,
      scheduler,
      socketFactory: sockets.factory,
      pollingIntervalMs: POLLING_INTERVAL_MS,
      reconnectDelayMs: RECONNECT_DELAY_MS,
    });

    let throwingCalls = 0;
    const healthy: RealtimeError[] = [];
    client.subscribeError(() => {
      throwingCalls += 1;
      throw new Error('error subscriber fault');
    });
    client.subscribeError((error) => healthy.push(error));

    client.start();
    sockets.at(0).emitOpen();
    expect(() => sockets.at(0).emitError()).not.toThrow();
    await flush();

    expect(throwingCalls).toBeGreaterThanOrEqual(1);
    expect(healthy.some((entry) => entry.source === 'transport')).toBe(true);
    // A throwing error subscriber must not cause a recursive transport error.
    const transportErrors = healthy.filter((entry) => entry.source === 'transport');
    expect(transportErrors).toHaveLength(1);
    expect(client.getStatus().state).toBe('polling');

    client.stop();
    expect(scheduler.pendingCount()).toBe(0);
  });

  it('one throwing message subscriber does not block another subscriber', () => {
    const scheduler = createFakeScheduler();
    const transport = createFakeTransport();
    const sockets = createSocketRecorder();
    const client = createRealtimeClient({
      wsEndpoint: WS_ENDPOINT,
      transport,
      scheduler,
      socketFactory: sockets.factory,
    });

    let throwingCalls = 0;
    const healthy: RealtimeEventEnvelope[] = [];
    client.subscribeMessage(() => {
      throwingCalls += 1;
      throw new Error('message subscriber fault');
    });
    client.subscribeMessage((envelope) => healthy.push(envelope));

    client.start();
    sockets.at(0).emitOpen();
    expect(() => sockets.at(0).emitMessage(fastPathFrame())).not.toThrow();
    expect(() => sockets.at(0).emitMessage(fastPathFrame())).not.toThrow();

    expect(throwingCalls).toBe(2);
    // Both deliveries reached the healthy subscriber; still no dedup (TASK-123).
    expect(healthy).toHaveLength(2);
    expect(client.getStatus().state).toBe('connected');

    client.stop();
  });

  it('one throwing polling-cycle subscriber does not block another subscriber', async () => {
    const scheduler = createFakeScheduler();
    const transport = createFakeTransport();
    const sockets = createSocketRecorder();
    const client = createRealtimeClient({
      wsEndpoint: WS_ENDPOINT,
      transport,
      scheduler,
      socketFactory: sockets.factory,
      pollingIntervalMs: POLLING_INTERVAL_MS,
      reconnectDelayMs: RECONNECT_DELAY_MS,
    });

    let throwingCalls = 0;
    const healthy: number[] = [];
    client.subscribePollingCycle(() => {
      throwingCalls += 1;
      throw new Error('cycle subscriber fault');
    });
    client.subscribePollingCycle((result) => healthy.push(result.cycle));

    client.start();
    sockets.at(0).emitError();
    await flush();

    expect(throwingCalls).toBe(1);
    expect(healthy).toEqual([1]);

    // Polling survives the subscriber fault and keeps cycling.
    expect(scheduler.runTimer(POLLING_INTERVAL_MS)).toBe(true);
    await flush();
    expect(healthy).toEqual([1, 2]);
    expect(client.getStatus().pollingActive).toBe(true);

    client.stop();
    expect(client.getStatus().pollingActive).toBe(false);
    expect(scheduler.pendingCount()).toBe(0);
  });

  it('degrades to polling without reconnect looping when the endpoint is unusable', async () => {
    const scheduler = createFakeScheduler();
    const transport = createFakeTransport();
    const sockets = createSocketRecorder();
    const errors: RealtimeError[] = [];

    const client = createRealtimeClient({
      wsEndpoint: 'https://api.test.invalid',
      transport,
      scheduler,
      socketFactory: sockets.factory,
      pollingIntervalMs: POLLING_INTERVAL_MS,
      reconnectDelayMs: RECONNECT_DELAY_MS,
    });
    client.subscribeError((error) => errors.push(error));
    client.start();

    expect(sockets.instances).toHaveLength(0);
    expect(client.getStatus().state).toBe('polling');
    expect(client.getStatus().pollingActive).toBe(true);
    expect(errors[0]?.error.code).toBe('INVALID_ENDPOINT');

    await flush();
    client.stop();
  });

  it('rejects a WebSocket endpoint carrying embedded credentials', async () => {
    const scheduler = createFakeScheduler();
    const transport = createFakeTransport();
    const sockets = createSocketRecorder();
    const errors: RealtimeError[] = [];

    const client = createRealtimeClient({
      wsEndpoint: 'wss://user:secret@ws.test.invalid/realtime',
      transport,
      scheduler,
      socketFactory: sockets.factory,
    });
    client.subscribeError((error) => errors.push(error));
    client.start();

    expect(sockets.instances).toHaveLength(0);
    expect(errors[0]?.error.code).toBe('INVALID_ENDPOINT');
    expect(errors[0]?.error.message).not.toContain('secret');

    await flush();
    client.stop();
  });
});
