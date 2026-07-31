/**
 * Realtime Hook + Dedup Integration Tests (TASK-123)
 *
 * Proves the presentation boundary: raw `ws_client` duplicates are forwarded
 * twice (Layer 1, TASK-122), but `useRealtimeConnection` commits a repeated
 * `ready_event_id` exactly once (Layer 2, TASK-123) via authoritative
 * `GET /decisions/{id}` reconciliation — never from the raw WebSocket payload.
 *
 * Also covers the F-01/F-02 repair: a missing `onReadyEvent` presenter must
 * never let the coordinator commit a silent no-op, and every dedup outcome
 * must be observable through `onReadyEventOutcome`.
 */

import { describe, it, expect, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useRealtimeConnection } from '../../src/realtime/use_realtime.js';
import type {
  ReadyEventCommit,
  ReadyEventOutcomeEvent,
  UseRealtimeConnectionOptions,
} from '../../src/realtime/use_realtime.js';
import { createFakeScheduler, createFakeTransport, createSocketRecorder, flush } from './fakes.js';
import type { FakeTransport } from './fakes.js';

const API_ENDPOINT = 'https://api.test.invalid';
const WS_ENDPOINT = 'wss://ws.test.invalid/realtime';
const POLLING_INTERVAL_MS = 2000;
const RECONNECT_DELAY_MS = 5000;

function fastPathFrame(readyEventId: string, decisionId = 'dec-acc001'): string {
  return JSON.stringify({
    schema_version: '1.0',
    event_type: 'decision.fast_path_ready',
    decision_id: decisionId,
    ready_event_id: readyEventId,
    occurred_at: '2026-05-20 22:10',
    trace_id: 'tr-abc123',
    provisional: true,
    policy_version: 'prov-2026a',
  });
}

type RenderOverrides = Partial<
  Pick<UseRealtimeConnectionOptions, 'onReadyEvent' | 'onReadyEventOutcome'>
>;

/**
 * Renders the hook with an initial set of TASK-123 callbacks. Returns
 * `rerender(overrides)` so tests can change callback identity across renders
 * without unmounting — the scenario F-01/F-02 tests need.
 */
function renderRealtime(initial: RenderOverrides = {}, transport: FakeTransport = createFakeTransport()) {
  const scheduler = createFakeScheduler();
  const sockets = createSocketRecorder();

  const view = renderHook(
    (overrides: RenderOverrides) =>
      useRealtimeConnection({
        apiEndpoint: API_ENDPOINT,
        wsEndpoint: WS_ENDPOINT,
        transport,
        scheduler,
        socketFactory: sockets.factory,
        pollingIntervalMs: POLLING_INTERVAL_MS,
        reconnectDelayMs: RECONNECT_DELAY_MS,
        ...overrides,
      }),
    { initialProps: initial },
  );

  return { ...view, scheduler, transport, sockets };
}

describe('useRealtimeConnection — ready_event_id dedup integration', () => {
  it('commits a duplicate ready_event_id frame once even though the socket forwards it twice', async () => {
    const commits: ReadyEventCommit[] = [];
    const harness = renderRealtime({ onReadyEvent: (commit) => commits.push(commit) });

    act(() => {
      harness.sockets.at(0).emitOpen();
    });

    await act(async () => {
      harness.sockets.at(0).emitMessage(fastPathFrame('dec-acc001|decision.fast_path_ready|1'));
      harness.sockets.at(0).emitMessage(fastPathFrame('dec-acc001|decision.fast_path_ready|1'));
      await flush();
    });

    expect(commits).toHaveLength(1);
    expect(commits[0]?.envelope.readyEventId).toBe('dec-acc001|decision.fast_path_ready|1');
    expect(harness.transport.callsFor('decisions/dec-acc001')).toBe(1);

    harness.unmount();
  });

  it('commits a new ready_event_id as a separate rendered update', async () => {
    const commits: ReadyEventCommit[] = [];
    const harness = renderRealtime({ onReadyEvent: (commit) => commits.push(commit) });

    act(() => {
      harness.sockets.at(0).emitOpen();
    });

    await act(async () => {
      harness.sockets.at(0).emitMessage(fastPathFrame('dec-acc001|decision.fast_path_ready|1'));
      await flush();
    });
    await act(async () => {
      harness.sockets.at(0).emitMessage(fastPathFrame('dec-acc001|decision.fast_path_ready|2'));
      await flush();
    });

    expect(commits).toHaveLength(2);
    expect(commits.map((commit) => commit.envelope.readyEventId)).toEqual([
      'dec-acc001|decision.fast_path_ready|1',
      'dec-acc001|decision.fast_path_ready|2',
    ]);

    harness.unmount();
  });

  it('calls authoritative reconciliation (GET /decisions/{id}) before the commit callback', async () => {
    const order: string[] = [];
    const harness = renderRealtime({ onReadyEvent: () => order.push('commit') });
    const originalGetDecision = harness.transport.getDecision.bind(harness.transport);
    harness.transport.getDecision = (id, opts) => {
      order.push('reconcile');
      return originalGetDecision(id, opts);
    };

    act(() => {
      harness.sockets.at(0).emitOpen();
    });
    await act(async () => {
      harness.sockets.at(0).emitMessage(fastPathFrame('dec-acc001|decision.fast_path_ready|1'));
      await flush();
    });

    expect(order).toEqual(['reconcile', 'commit']);

    harness.unmount();
  });

  it('does not present raw WebSocket data as success when reconciliation fails', async () => {
    const commits: ReadyEventCommit[] = [];
    const harness = renderRealtime({ onReadyEvent: (commit) => commits.push(commit) });
    harness.transport.failTarget('decisions/dec-acc001');

    act(() => {
      harness.sockets.at(0).emitOpen();
    });
    await act(async () => {
      harness.sockets.at(0).emitMessage(fastPathFrame('dec-acc001|decision.fast_path_ready|1'));
      await flush();
    });

    expect(commits).toHaveLength(0);

    // A later redelivery of the same id may retry once reconciliation can
    // succeed (release the reservation on failure).
    harness.transport.clearFailures();
    await act(async () => {
      harness.sockets.at(0).emitMessage(fastPathFrame('dec-acc001|decision.fast_path_ready|1'));
      await flush();
    });
    expect(commits).toHaveLength(1);

    harness.unmount();
  });

  it('a React rerender does not reset the dedup store', async () => {
    const commits: ReadyEventCommit[] = [];
    const harness = renderRealtime({ onReadyEvent: (commit) => commits.push(commit) });

    act(() => {
      harness.sockets.at(0).emitOpen();
    });
    await act(async () => {
      harness.sockets.at(0).emitMessage(fastPathFrame('dec-acc001|decision.fast_path_ready|1'));
      await flush();
    });
    expect(commits).toHaveLength(1);

    harness.rerender({ onReadyEvent: (commit) => commits.push(commit) });
    harness.rerender({ onReadyEvent: (commit) => commits.push(commit) });

    await act(async () => {
      harness.sockets.at(0).emitMessage(fastPathFrame('dec-acc001|decision.fast_path_ready|1'));
      await flush();
    });

    expect(commits).toHaveLength(1);
    expect(harness.sockets.instances).toHaveLength(1);

    harness.unmount();
  });

  it('disposes the coordinator on unmount, and a late reconciliation cannot commit afterward', async () => {
    const commits: ReadyEventCommit[] = [];
    const harness = renderRealtime({ onReadyEvent: (commit) => commits.push(commit) });
    harness.transport.hold();

    act(() => {
      harness.sockets.at(0).emitOpen();
    });
    act(() => {
      harness.sockets.at(0).emitMessage(fastPathFrame('dec-acc001|decision.fast_path_ready|1'));
    });

    harness.unmount();
    harness.transport.release();
    await flush();

    expect(commits).toHaveLength(0);
  });

  it('supports a StrictMode-style mount, cleanup, and remount without double-committing stale work', async () => {
    const firstCommits: ReadyEventCommit[] = [];
    const first = renderRealtime({ onReadyEvent: (commit) => firstCommits.push(commit) });

    act(() => {
      first.sockets.at(0).emitOpen();
    });
    await act(async () => {
      first.sockets.at(0).emitMessage(fastPathFrame('dec-acc001|decision.fast_path_ready|1'));
      await flush();
    });
    expect(firstCommits).toHaveLength(1);

    // Simulate the mount/cleanup/remount cycle by disposing the first
    // instance and creating a brand-new one, as a full unmount + remount does.
    first.unmount();

    const secondCommits: ReadyEventCommit[] = [];
    const second = renderRealtime({ onReadyEvent: (commit) => secondCommits.push(commit) });
    act(() => {
      second.sockets.at(0).emitOpen();
    });
    await act(async () => {
      // A fresh mounted session starts a new session-scoped store, so the
      // same id is legitimately reconciled again for the new session.
      second.sockets.at(0).emitMessage(fastPathFrame('dec-acc001|decision.fast_path_ready|1'));
      await flush();
    });

    expect(secondCommits).toHaveLength(1);
    second.unmount();
  });

  it('reconnect does not create a second presentation commit for the same id', async () => {
    const commits: ReadyEventCommit[] = [];
    const harness = renderRealtime({ onReadyEvent: (commit) => commits.push(commit) });

    act(() => {
      harness.sockets.at(0).emitOpen();
    });
    await act(async () => {
      harness.sockets.at(0).emitMessage(fastPathFrame('dec-acc001|decision.fast_path_ready|1'));
      await flush();
    });
    expect(commits).toHaveLength(1);

    // Drop and reconnect.
    act(() => {
      harness.sockets.at(0).emitError();
    });
    await act(async () => {
      await flush();
    });
    act(() => {
      harness.scheduler.runTimer(RECONNECT_DELAY_MS);
    });
    act(() => {
      harness.sockets.at(1).emitOpen();
    });

    // Server resends the same ready_event_id after reconnect.
    await act(async () => {
      harness.sockets.at(1).emitMessage(fastPathFrame('dec-acc001|decision.fast_path_ready|1'));
      await flush();
    });

    expect(commits).toHaveLength(1);

    harness.unmount();
  });

  // ─── F-01 / F-02 repair coverage ──────────────────────────

  it('reports missing_presentation_handler and performs zero work when no onReadyEvent is mounted', async () => {
    const outcomes: ReadyEventOutcomeEvent[] = [];
    const harness = renderRealtime({ onReadyEventOutcome: (event) => outcomes.push(event) });

    act(() => {
      harness.sockets.at(0).emitOpen();
    });
    await act(async () => {
      harness.sockets.at(0).emitMessage(fastPathFrame('dec-acc001|decision.fast_path_ready|1'));
      await flush();
    });

    expect(harness.transport.callsFor('decisions/dec-acc001')).toBe(0);
    expect(outcomes).toEqual([
      { outcome: 'missing_presentation_handler', readyEventId: 'dec-acc001|decision.fast_path_ready|1' },
    ]);

    harness.unmount();
  });

  it('lets a redelivery commit once onReadyEvent is provided on a later rerender', async () => {
    const outcomes: ReadyEventOutcomeEvent[] = [];
    const commits: ReadyEventCommit[] = [];
    const harness = renderRealtime({ onReadyEventOutcome: (event) => outcomes.push(event) });

    act(() => {
      harness.sockets.at(0).emitOpen();
    });
    await act(async () => {
      harness.sockets.at(0).emitMessage(fastPathFrame('dec-acc001|decision.fast_path_ready|1'));
      await flush();
    });
    expect(outcomes).toEqual([
      { outcome: 'missing_presentation_handler', readyEventId: 'dec-acc001|decision.fast_path_ready|1' },
    ]);
    expect(commits).toHaveLength(0);

    harness.rerender({
      onReadyEvent: (commit) => commits.push(commit),
      onReadyEventOutcome: (event) => outcomes.push(event),
    });

    await act(async () => {
      harness.sockets.at(0).emitMessage(fastPathFrame('dec-acc001|decision.fast_path_ready|1'));
      await flush();
    });

    expect(harness.transport.callsFor('decisions/dec-acc001')).toBe(1);
    expect(commits).toHaveLength(1);
    expect(outcomes[1]).toEqual({ outcome: 'committed', readyEventId: 'dec-acc001|decision.fast_path_ready|1' });

    harness.unmount();
  });

  it('one commit and one duplicate_committed outcome for one commit followed by a duplicate', async () => {
    const outcomes: ReadyEventOutcomeEvent[] = [];
    const commits: ReadyEventCommit[] = [];
    const harness = renderRealtime({
      onReadyEvent: (commit) => commits.push(commit),
      onReadyEventOutcome: (event) => outcomes.push(event),
    });

    act(() => {
      harness.sockets.at(0).emitOpen();
    });
    await act(async () => {
      harness.sockets.at(0).emitMessage(fastPathFrame('dec-acc001|decision.fast_path_ready|1'));
      await flush();
    });
    await act(async () => {
      harness.sockets.at(0).emitMessage(fastPathFrame('dec-acc001|decision.fast_path_ready|1'));
      await flush();
    });

    expect(commits).toHaveLength(1);
    expect(harness.transport.callsFor('decisions/dec-acc001')).toBe(1);
    expect(outcomes.map((event) => event.outcome)).toEqual(['committed', 'duplicate_committed']);

    harness.unmount();
  });

  it('concurrent duplicates produce one reconciliation, one commit, and deterministic outcomes', async () => {
    const outcomes: ReadyEventOutcomeEvent[] = [];
    const commits: ReadyEventCommit[] = [];
    const transport = createFakeTransport();
    transport.hold();
    const harness = renderRealtime(
      {
        onReadyEvent: (commit) => commits.push(commit),
        onReadyEventOutcome: (event) => outcomes.push(event),
      },
      transport,
    );

    act(() => {
      harness.sockets.at(0).emitOpen();
    });
    act(() => {
      harness.sockets.at(0).emitMessage(fastPathFrame('dec-acc001|decision.fast_path_ready|1'));
      harness.sockets.at(0).emitMessage(fastPathFrame('dec-acc001|decision.fast_path_ready|1'));
      harness.sockets.at(0).emitMessage(fastPathFrame('dec-acc001|decision.fast_path_ready|1'));
    });

    await act(async () => {
      await flush();
    });

    // Duplicates coalesce synchronously; the first request is still in flight.
    expect(harness.transport.callsFor('decisions/dec-acc001')).toBe(1);
    expect(commits).toHaveLength(0);
    expect(outcomes.map((event) => event.outcome)).toEqual([
      'duplicate_in_flight',
      'duplicate_in_flight',
    ]);

    await act(async () => {
      transport.release();
      await flush();
    });

    expect(commits).toHaveLength(1);
    expect(harness.transport.callsFor('decisions/dec-acc001')).toBe(1);
    expect(outcomes.map((event) => event.outcome)).toEqual([
      'duplicate_in_flight',
      'duplicate_in_flight',
      'committed',
    ]);

    harness.unmount();
  });

  it('reports a visible rejected outcome for a missing ready_event_id', async () => {
    const outcomes: ReadyEventOutcomeEvent[] = [];
    const harness = renderRealtime({
      onReadyEvent: () => undefined,
      onReadyEventOutcome: (event) => outcomes.push(event),
    });

    act(() => {
      harness.sockets.at(0).emitOpen();
    });
    await act(async () => {
      harness.sockets.at(0).emitMessage(
        JSON.stringify({
          schema_version: '1.0',
          event_type: 'decision.fast_path_ready',
          decision_id: 'dec-acc001',
          occurred_at: '2026-05-20 22:10',
          trace_id: 'tr-abc123',
          provisional: true,
          policy_version: 'prov-2026a',
        }),
      );
      await flush();
    });

    // No ready_event_id present: the coordinator's own validation applies
    // (the hook still routes decision.fast_path_ready through dedup).
    expect(outcomes).toEqual([{ outcome: 'rejected_missing_ready_event_id', readyEventId: null }]);
    expect(harness.transport.callsFor('decisions/dec-acc001')).toBe(0);

    harness.unmount();
  });

  it('reports a visible rejected outcome for a whitespace-only ready_event_id', async () => {
    const outcomes: ReadyEventOutcomeEvent[] = [];
    const harness = renderRealtime({
      onReadyEvent: () => undefined,
      onReadyEventOutcome: (event) => outcomes.push(event),
    });

    act(() => {
      harness.sockets.at(0).emitOpen();
    });
    await act(async () => {
      harness.sockets.at(0).emitMessage(
        JSON.stringify({
          schema_version: '1.0',
          event_type: 'decision.fast_path_ready',
          decision_id: 'dec-acc001',
          ready_event_id: '   ',
          occurred_at: '2026-05-20 22:10',
          trace_id: 'tr-abc123',
          provisional: true,
          policy_version: 'prov-2026a',
        }),
      );
      await flush();
    });

    expect(outcomes).toEqual([{ outcome: 'rejected_missing_ready_event_id', readyEventId: null }]);

    harness.unmount();
  });

  it('reports a visible failed outcome when decision_id is missing', async () => {
    const outcomes: ReadyEventOutcomeEvent[] = [];
    const harness = renderRealtime({
      onReadyEvent: () => undefined,
      onReadyEventOutcome: (event) => outcomes.push(event),
    });

    act(() => {
      harness.sockets.at(0).emitOpen();
    });
    await act(async () => {
      harness.sockets.at(0).emitMessage(
        JSON.stringify({
          schema_version: '1.0',
          event_type: 'decision.fast_path_ready',
          ready_event_id: 'no-decision-id|decision.fast_path_ready|1',
          occurred_at: '2026-05-20 22:10',
          trace_id: 'tr-abc123',
          provisional: true,
          policy_version: 'prov-2026a',
        }),
      );
      await flush();
    });

    expect(outcomes).toEqual([{ outcome: 'failed', readyEventId: 'no-decision-id|decision.fast_path_ready|1' }]);
    expect(harness.transport.callsFor('decisions/dec-acc001')).toBe(0);

    harness.unmount();
  });

  it('http reconciliation failure produces a visible failed outcome, then the same id retries successfully', async () => {
    const outcomes: ReadyEventOutcomeEvent[] = [];
    const commits: ReadyEventCommit[] = [];
    const harness = renderRealtime({
      onReadyEvent: (commit) => commits.push(commit),
      onReadyEventOutcome: (event) => outcomes.push(event),
    });
    harness.transport.failTarget('decisions/dec-acc001');

    act(() => {
      harness.sockets.at(0).emitOpen();
    });
    await act(async () => {
      harness.sockets.at(0).emitMessage(fastPathFrame('dec-acc001|decision.fast_path_ready|1'));
      await flush();
    });

    expect(outcomes).toEqual([{ outcome: 'failed', readyEventId: 'dec-acc001|decision.fast_path_ready|1' }]);
    expect(commits).toHaveLength(0);

    harness.transport.clearFailures();
    await act(async () => {
      harness.sockets.at(0).emitMessage(fastPathFrame('dec-acc001|decision.fast_path_ready|1'));
      await flush();
    });

    expect(commits).toHaveLength(1);
    expect(outcomes[1]).toEqual({ outcome: 'committed', readyEventId: 'dec-acc001|decision.fast_path_ready|1' });

    harness.unmount();
  });

  it('a throwing onReadyEvent presenter produces failed, releases the reservation, and permits a successful retry', async () => {
    const outcomes: ReadyEventOutcomeEvent[] = [];
    let attempt = 0;
    const harness = renderRealtime({
      onReadyEvent: () => {
        attempt += 1;
        if (attempt === 1) {
          throw new Error('presenter fault');
        }
      },
      onReadyEventOutcome: (event) => outcomes.push(event),
    });

    act(() => {
      harness.sockets.at(0).emitOpen();
    });
    await act(async () => {
      expect(() => harness.sockets.at(0).emitMessage(fastPathFrame('dec-acc001|decision.fast_path_ready|1'))).not.toThrow();
      await flush();
    });

    expect(outcomes).toEqual([{ outcome: 'failed', readyEventId: 'dec-acc001|decision.fast_path_ready|1' }]);

    await act(async () => {
      harness.sockets.at(0).emitMessage(fastPathFrame('dec-acc001|decision.fast_path_ready|1'));
      await flush();
    });

    expect(outcomes[1]).toEqual({ outcome: 'committed', readyEventId: 'dec-acc001|decision.fast_path_ready|1' });
    expect(attempt).toBe(2);

    harness.unmount();
  });

  it('a throwing onReadyEventOutcome observer does not block later commits or break unmount', async () => {
    const commits: ReadyEventCommit[] = [];
    const throwingObserver = vi.fn(() => {
      throw new Error('observer fault');
    });
    const harness = renderRealtime({
      onReadyEvent: (commit) => commits.push(commit),
      onReadyEventOutcome: throwingObserver,
    });

    const unhandled: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandledRejection);

    try {
      act(() => {
        harness.sockets.at(0).emitOpen();
      });
      await act(async () => {
        harness.sockets.at(0).emitMessage(fastPathFrame('dec-acc001|decision.fast_path_ready|1'));
        await flush();
      });
      await act(async () => {
        harness.sockets.at(0).emitMessage(fastPathFrame('dec-acc001|decision.fast_path_ready|2'));
        await flush();
      });

      expect(throwingObserver).toHaveBeenCalledTimes(2);
      expect(commits).toHaveLength(2);
      expect(unhandled).toHaveLength(0);
      expect(() => harness.unmount()).not.toThrow();
    } finally {
      process.off('unhandledRejection', onUnhandledRejection);
    }
  });

  it('a changed onReadyEvent identity on rerender does not recreate the coordinator or redeliver committed ids', async () => {
    const firstCommits: ReadyEventCommit[] = [];
    const secondCommits: ReadyEventCommit[] = [];
    const harness = renderRealtime({ onReadyEvent: (commit) => firstCommits.push(commit) });

    act(() => {
      harness.sockets.at(0).emitOpen();
    });
    await act(async () => {
      harness.sockets.at(0).emitMessage(fastPathFrame('dec-acc001|decision.fast_path_ready|1'));
      await flush();
    });
    expect(firstCommits).toHaveLength(1);

    // Genuinely new callback identity.
    harness.rerender({ onReadyEvent: (commit) => secondCommits.push(commit) });

    await act(async () => {
      harness.sockets.at(0).emitMessage(fastPathFrame('dec-acc001|decision.fast_path_ready|1'));
      await flush();
    });

    // No socket was reopened (same coordinator instance, same connection).
    expect(harness.sockets.instances).toHaveLength(1);
    // The already-committed id is dropped; neither the old nor the new
    // presenter receives a second commit for it.
    expect(firstCommits).toHaveLength(1);
    expect(secondCommits).toHaveLength(0);

    harness.unmount();
  });

  it('unmount during in-flight reconciliation produces no late commit and no unhandled rejection', async () => {
    const commits: ReadyEventCommit[] = [];
    const outcomes: ReadyEventOutcomeEvent[] = [];
    const transport = createFakeTransport();
    transport.hold();
    const harness = renderRealtime(
      {
        onReadyEvent: (commit) => commits.push(commit),
        onReadyEventOutcome: (event) => outcomes.push(event),
      },
      transport,
    );

    const unhandled: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandledRejection);

    try {
      act(() => {
        harness.sockets.at(0).emitOpen();
      });
      act(() => {
        harness.sockets.at(0).emitMessage(fastPathFrame('dec-acc001|decision.fast_path_ready|1'));
      });

      harness.unmount();
      transport.release();
      await flush();

      expect(commits).toHaveLength(0);
      // The outcome pipeline is torn down on unmount, so no outcome event
      // reaches this observer for work that resolved after teardown.
      expect(outcomes).toHaveLength(0);
      expect(unhandled).toHaveLength(0);
    } finally {
      process.off('unhandledRejection', onUnhandledRejection);
    }
  });
});
