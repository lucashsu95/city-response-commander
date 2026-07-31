/**
 * `ready_event_id` Dedup Coordinator Tests (TASK-123)
 *
 * Pure coordinator tests: no WebSocket, no HTTP, no timers. Reconciliation and
 * presentation commit are represented by controlled deferreds so concurrency
 * and failure paths are deterministic.
 */

import { describe, it, expect, vi } from 'vitest';
import { createReadyEventDedupCoordinator, isReadyEventIdBearingType } from '../../src/realtime/dedup.js';

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(reason: unknown): void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function notification(readyEventId: string | null | undefined) {
  return { readyEventId };
}

describe('createReadyEventDedupCoordinator', () => {
  it('commits the first valid ready_event_id exactly once', async () => {
    const dedup = createReadyEventDedupCoordinator();
    const reconcile = vi.fn(async () => 'authoritative-state');
    const commit = vi.fn();

    const result = await dedup.processNotification(notification('id-1'), reconcile, commit);

    expect(result.outcome).toBe('committed');
    expect(result.readyEventId).toBe('id-1');
    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledWith('authoritative-state', notification('id-1'));
  });

  it('drops a duplicate delivered after commit', async () => {
    const dedup = createReadyEventDedupCoordinator();
    const reconcile = vi.fn(async () => 'state');
    const commit = vi.fn();

    await dedup.processNotification(notification('id-1'), reconcile, commit);
    const second = await dedup.processNotification(notification('id-1'), reconcile, commit);

    expect(second.outcome).toBe('duplicate_committed');
    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('renders once when the same ready_event_id is delivered 10 times', async () => {
    const dedup = createReadyEventDedupCoordinator();
    const reconcile = vi.fn(async () => 'state');
    const commit = vi.fn();

    const results = [];
    for (let index = 0; index < 10; index += 1) {
      results.push(await dedup.processNotification(notification('id-1'), reconcile, commit));
    }

    expect(commit).toHaveBeenCalledTimes(1);
    expect(reconcile).toHaveBeenCalledTimes(1);
    expect(results[0]?.outcome).toBe('committed');
    expect(results.slice(1).every((result) => result.outcome === 'duplicate_committed')).toBe(true);
  });

  it('commits two different ready_event_ids independently', async () => {
    const dedup = createReadyEventDedupCoordinator();
    const reconcile = vi.fn(async () => 'state');
    const commit = vi.fn();

    const first = await dedup.processNotification(notification('id-1'), reconcile, commit);
    const second = await dedup.processNotification(notification('id-2'), reconcile, commit);

    expect(first.outcome).toBe('committed');
    expect(second.outcome).toBe('committed');
    expect(reconcile).toHaveBeenCalledTimes(2);
    expect(commit).toHaveBeenCalledTimes(2);
  });

  it('treats ready_event_id as an opaque string, never parsing its structure', async () => {
    const dedup = createReadyEventDedupCoordinator();
    const opaque = 'dec-acc001|decision.fast_path_ready|1';
    const reconcile = vi.fn(async (notified: { readyEventId: string | null | undefined }) => {
      // The coordinator must hand back the identity verbatim, unsplit.
      expect(notified.readyEventId).toBe(opaque);
      return 'state';
    });
    const commit = vi.fn();

    const result = await dedup.processNotification(notification(opaque), reconcile, commit);

    expect(result.readyEventId).toBe(opaque);
    expect(result.outcome).toBe('committed');
  });

  it('rejects a missing ready_event_id', async () => {
    const dedup = createReadyEventDedupCoordinator();
    const reconcile = vi.fn(async () => 'state');
    const commit = vi.fn();

    const result = await dedup.processNotification(notification(undefined), reconcile, commit);

    expect(result.outcome).toBe('rejected_missing_ready_event_id');
    expect(result.readyEventId).toBeNull();
    expect(reconcile).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
  });

  it('rejects an empty ready_event_id', async () => {
    const dedup = createReadyEventDedupCoordinator();
    const reconcile = vi.fn(async () => 'state');
    const commit = vi.fn();

    const result = await dedup.processNotification(notification(''), reconcile, commit);

    expect(result.outcome).toBe('rejected_missing_ready_event_id');
    expect(reconcile).not.toHaveBeenCalled();
  });

  it('rejects a whitespace-only ready_event_id', async () => {
    const dedup = createReadyEventDedupCoordinator();
    const reconcile = vi.fn(async () => 'state');
    const commit = vi.fn();

    const result = await dedup.processNotification(notification('   '), reconcile, commit);

    expect(result.outcome).toBe('rejected_missing_ready_event_id');
    expect(reconcile).not.toHaveBeenCalled();
  });

  it('never synthesizes a fallback identity for a rejected notification', async () => {
    const dedup = createReadyEventDedupCoordinator();
    const reconcile = vi.fn(async () => 'state');
    const commit = vi.fn();

    const missing = await dedup.processNotification(notification(null), reconcile, commit);
    const validAfter = await dedup.processNotification(notification('id-1'), reconcile, commit);

    // The rejected call must not have reserved or committed any identity that
    // a later valid delivery could collide with.
    expect(missing.readyEventId).toBeNull();
    expect(validAfter.outcome).toBe('committed');
  });

  it('launches exactly one reconciliation when a duplicate arrives while in flight', async () => {
    const dedup = createReadyEventDedupCoordinator();
    const gate = createDeferred<string>();
    const reconcile = vi.fn(async () => gate.promise);
    const commit = vi.fn();

    const first = dedup.processNotification(notification('id-1'), reconcile, commit);
    const second = await dedup.processNotification(notification('id-1'), reconcile, commit);

    expect(second.outcome).toBe('duplicate_in_flight');
    expect(reconcile).toHaveBeenCalledTimes(1);

    gate.resolve('state');
    const firstResult = await first;
    expect(firstResult.outcome).toBe('committed');
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('launches exactly one presentation commit when duplicates arrive during in-flight work', async () => {
    const dedup = createReadyEventDedupCoordinator();
    const commitGate = createDeferred<void>();
    const reconcile = vi.fn(async () => 'state');
    const commit = vi.fn(async () => commitGate.promise);

    const first = dedup.processNotification(notification('id-1'), reconcile, commit);
    // Let reconciliation resolve and commit begin before sending duplicates.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    const second = await dedup.processNotification(notification('id-1'), reconcile, commit);
    const third = await dedup.processNotification(notification('id-1'), reconcile, commit);

    expect(second.outcome).toBe('duplicate_in_flight');
    expect(third.outcome).toBe('duplicate_in_flight');
    expect(commit).toHaveBeenCalledTimes(1);

    commitGate.resolve();
    const firstResult = await first;
    expect(firstResult.outcome).toBe('committed');
  });

  it('gives every concurrent duplicate caller a deterministic outcome', async () => {
    const dedup = createReadyEventDedupCoordinator();
    const gate = createDeferred<string>();
    const reconcile = vi.fn(async () => gate.promise);
    const commit = vi.fn();

    // Calls are issued synchronously in the same tick. The first call reserves
    // the id and suspends on the gate; the rest see `in_flight` before ever
    // reaching an await point, so they resolve to a duplicate outcome without
    // waiting on the gate at all.
    const calls = Array.from({ length: 5 }, () =>
      dedup.processNotification(notification('id-1'), reconcile, commit),
    );

    const duplicateOutcomes = await Promise.all(calls.slice(1).map((call) => call.then((r) => r.outcome)));
    expect(duplicateOutcomes).toEqual(Array(4).fill('duplicate_in_flight'));
    expect(reconcile).toHaveBeenCalledTimes(1);

    gate.resolve('state');
    const firstOutcome = (await calls[0])?.outcome;

    expect(firstOutcome).toBe('committed');
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('releases the reservation when reconciliation fails', async () => {
    const dedup = createReadyEventDedupCoordinator();
    const reconcile = vi.fn(async () => {
      throw new Error('reconciliation failed');
    });
    const commit = vi.fn();

    const result = await dedup.processNotification(notification('id-1'), reconcile, commit);

    expect(result.outcome).toBe('failed');
    expect(commit).not.toHaveBeenCalled();
  });

  it('allows a retry to succeed after a reconciliation failure', async () => {
    const dedup = createReadyEventDedupCoordinator();
    let attempt = 0;
    const reconcile = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) {
        throw new Error('transient failure');
      }
      return 'state';
    });
    const commit = vi.fn();

    const first = await dedup.processNotification(notification('id-1'), reconcile, commit);
    const second = await dedup.processNotification(notification('id-1'), reconcile, commit);

    expect(first.outcome).toBe('failed');
    expect(second.outcome).toBe('committed');
    expect(reconcile).toHaveBeenCalledTimes(2);
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('releases the reservation when the presentation commit fails', async () => {
    const dedup = createReadyEventDedupCoordinator();
    const reconcile = vi.fn(async () => 'state');
    const commit = vi.fn(async () => {
      throw new Error('commit failed');
    });

    const result = await dedup.processNotification(notification('id-1'), reconcile, commit);

    expect(result.outcome).toBe('failed');
  });

  it('allows a retry to succeed after a commit failure', async () => {
    const dedup = createReadyEventDedupCoordinator();
    const reconcile = vi.fn(async () => 'state');
    let commitAttempt = 0;
    const commit = vi.fn(async () => {
      commitAttempt += 1;
      if (commitAttempt === 1) {
        throw new Error('transient commit failure');
      }
    });

    const first = await dedup.processNotification(notification('id-1'), reconcile, commit);
    const second = await dedup.processNotification(notification('id-1'), reconcile, commit);

    expect(first.outcome).toBe('failed');
    expect(second.outcome).toBe('committed');
    expect(reconcile).toHaveBeenCalledTimes(2);
    expect(commit).toHaveBeenCalledTimes(2);
  });

  it('keeps committed ids deduped across a disconnect/reconnect cycle (same coordinator)', async () => {
    const dedup = createReadyEventDedupCoordinator();
    const reconcile = vi.fn(async () => 'state');
    const commit = vi.fn();

    await dedup.processNotification(notification('id-1'), reconcile, commit);
    // Simulated reconnect: the coordinator itself is untouched (no dispose),
    // matching the use_realtime.ts integration where reconnect never disposes
    // the mounted dedup coordinator.
    const afterReconnect = await dedup.processNotification(notification('id-1'), reconcile, commit);

    expect(afterReconnect.outcome).toBe('duplicate_committed');
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('does not clear dedup state across a simulated polling-mode transition', async () => {
    const dedup = createReadyEventDedupCoordinator();
    const reconcile = vi.fn(async () => 'state');
    const commit = vi.fn();

    await dedup.processNotification(notification('id-1'), reconcile, commit);
    // A connected → polling → connected transition never calls dispose(); the
    // same coordinator instance keeps tracking ids.
    const duringPolling = await dedup.processNotification(notification('id-1'), reconcile, commit);

    expect(duringPolling.outcome).toBe('duplicate_committed');
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('prevents a late reconciliation from committing after dispose', async () => {
    const dedup = createReadyEventDedupCoordinator();
    const gate = createDeferred<string>();
    const reconcile = vi.fn(async () => gate.promise);
    const commit = vi.fn();

    const pending = dedup.processNotification(notification('id-1'), reconcile, commit);
    dedup.dispose();
    gate.resolve('state');

    const result = await pending;

    expect(result.outcome).toBe('disposed');
    expect(commit).not.toHaveBeenCalled();
  });

  it('clears session tracking on dispose', async () => {
    const dedup = createReadyEventDedupCoordinator();
    const reconcile = vi.fn(async () => 'state');
    const commit = vi.fn();

    await dedup.processNotification(notification('id-1'), reconcile, commit);
    dedup.dispose();

    // Post-dispose calls resolve to `disposed`, never re-triggering work and
    // never reporting a duplicate against cleared tracking.
    const afterDispose = await dedup.processNotification(notification('id-1'), reconcile, commit);
    expect(afterDispose.outcome).toBe('disposed');
    expect(reconcile).toHaveBeenCalledTimes(1);
  });

  it('produces no unhandled rejection when reconciliation and commit both throw across many calls', async () => {
    const dedup = createReadyEventDedupCoordinator();
    const reconcile = vi.fn(async () => {
      throw new Error('boom');
    });
    const commit = vi.fn();

    const unhandled: unknown[] = [];
    const onUnhandledRejection = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', onUnhandledRejection);

    try {
      const results = await Promise.all(
        Array.from({ length: 5 }, (_, index) =>
          dedup.processNotification(notification(`id-${index}`), reconcile, commit),
        ),
      );
      await Promise.resolve();
      await Promise.resolve();

      expect(results.every((result) => result.outcome === 'failed')).toBe(true);
      expect(unhandled).toHaveLength(0);
    } finally {
      process.off('unhandledRejection', onUnhandledRejection);
    }
  });

  it('identifies the ready_event_id-bearing §13 event types without inventing others', () => {
    expect(isReadyEventIdBearingType('decision.fast_path_ready')).toBe(true);
    expect(isReadyEventIdBearingType('decision.enriched')).toBe(true);
    expect(isReadyEventIdBearingType('public_alert.ready')).toBe(true);
    expect(isReadyEventIdBearingType('report.ready')).toBe(true);
    expect(isReadyEventIdBearingType('timeline.updated')).toBe(false);
    expect(isReadyEventIdBearingType('anomaly.detected')).toBe(false);
    expect(isReadyEventIdBearingType('incident.injected')).toBe(false);
    expect(isReadyEventIdBearingType('publish.status_changed')).toBe(false);
    expect(isReadyEventIdBearingType('processing.failed')).toBe(false);
  });
});
