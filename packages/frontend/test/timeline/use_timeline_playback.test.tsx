/**
 * Timeline Playback Controller Tests (TASK-124)
 *
 * Verifies the controller's state machine, concurrency guarantees, and the
 * zero-fabrication boundary using an injected fake transport and deferred
 * promises (no live HTTP, no sleeping, no real timers).
 */

import { describe, it, expect, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useTimelinePlayback } from '../../src/timeline/use_timeline_playback.js';
import type { TimelineTransport } from '../../src/timeline/use_timeline_playback.js';
import type { ApiResult } from '../../src/api/client.js';

// ─── Deferred Fake Transport ────────────────────────────────

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

interface FakeCall {
  readonly deferred: Deferred<ApiResult<unknown>>;
  readonly signal: AbortSignal | undefined;
}

function createFakeTimelineTransport(): TimelineTransport & {
  calls: FakeCall[];
  callCount: () => number;
} {
  const calls: FakeCall[] = [];
  return {
    calls,
    callCount: () => calls.length,
    getTimeline(options) {
      const deferred = createDeferred<ApiResult<unknown>>();
      calls.push({ deferred, signal: options?.signal });
      return deferred.promise;
    },
  };
}

function validTimelinePayload(current: string, timestamps: readonly string[]): unknown {
  // FIX 3: schema_version/trace_id/provisional are now required by the
  // decoder, so every valid fixture must include them.
  return {
    timestamps,
    current,
    schema_version: '1.0',
    trace_id: 'tr-test',
    provisional: true,
  };
}

/** Valid empty-timeline fixture: `current` must be `null` when `timestamps` is empty. */
function emptyTimelinePayload(): unknown {
  return {
    timestamps: [],
    current: null,
    schema_version: '1.0',
    trace_id: 'tr-test',
    provisional: true,
  };
}

async function flush(turns = 20): Promise<void> {
  for (let index = 0; index < turns; index += 1) {
    await Promise.resolve();
  }
}

describe('useTimelinePlayback', () => {
  it('fetches exactly once on initial mount', () => {
    const transport = createFakeTimelineTransport();
    const view = renderHook(() => useTimelinePlayback({ transport }));

    expect(transport.callCount()).toBe(1);
    expect(view.result.current.state).toBe('loading');

    view.unmount();
  });

  it('produces ready state on a successful fetch', async () => {
    const transport = createFakeTimelineTransport();
    const view = renderHook(() => useTimelinePlayback({ transport }));

    await act(async () => {
      transport.calls[0]?.deferred.resolve({
        ok: true,
        data: validTimelinePayload('2026-05-20 22:10', [
          '2026-05-20 22:00',
          '2026-05-20 22:10',
        ]),
      });
      await flush();
    });

    expect(view.result.current.state).toBe('ready');
    expect(view.result.current.currentTimestamp).toBe('2026-05-20 22:10');
    expect(view.result.current.timestamps).toEqual(['2026-05-20 22:00', '2026-05-20 22:10']);
    expect(view.result.current.selectedTimestamp).toBe('2026-05-20 22:10');
    expect(view.result.current.selectedIndex).toBe(1);

    view.unmount();
  });

  it('produces empty state for an empty timeline', async () => {
    const transport = createFakeTimelineTransport();
    const view = renderHook(() => useTimelinePlayback({ transport }));

    await act(async () => {
      transport.calls[0]?.deferred.resolve({
        ok: true,
        data: emptyTimelinePayload(),
      });
      await flush();
    });

    expect(view.result.current.state).toBe('empty');
    expect(view.result.current.timestamps).toEqual([]);
    expect(view.result.current.selectedTimestamp).toBeNull();

    view.unmount();
  });

  it('produces error state on API failure', async () => {
    const transport = createFakeTimelineTransport();
    const view = renderHook(() => useTimelinePlayback({ transport }));

    await act(async () => {
      transport.calls[0]?.deferred.resolve({
        ok: false,
        error: { code: 'NETWORK_ERROR', message: 'boom' },
      });
      await flush();
    });

    expect(view.result.current.state).toBe('error');
    expect(view.result.current.error?.code).toBe('REQUEST_FAILED');
    // Zero-fabrication: an error must never carry fabricated timeline data.
    expect(view.result.current.timestamps).toEqual([]);
    expect(view.result.current.currentTimestamp).toBeNull();

    view.unmount();
  });

  it('produces error state (not empty) on an invalid/malformed response', async () => {
    const transport = createFakeTimelineTransport();
    const view = renderHook(() => useTimelinePlayback({ transport }));

    await act(async () => {
      transport.calls[0]?.deferred.resolve({
        ok: true,
        data: { timestamps: 'not-an-array' },
      });
      await flush();
    });

    expect(view.result.current.state).toBe('error');
    expect(view.result.current.error?.code).toBe('MISSING_TIMESTAMPS');

    view.unmount();
  });

  it('recovers via refresh() after an error', async () => {
    const transport = createFakeTimelineTransport();
    const view = renderHook(() => useTimelinePlayback({ transport }));

    await act(async () => {
      transport.calls[0]?.deferred.resolve({
        ok: false,
        error: { code: 'NETWORK_ERROR', message: 'boom' },
      });
      await flush();
    });
    expect(view.result.current.state).toBe('error');

    act(() => {
      view.result.current.refresh();
    });
    expect(transport.callCount()).toBe(2);

    await act(async () => {
      transport.calls[1]?.deferred.resolve({
        ok: true,
        data: validTimelinePayload('2026-05-20 22:10', ['2026-05-20 22:10']),
      });
      await flush();
    });

    expect(view.result.current.state).toBe('ready');
    expect(view.result.current.currentTimestamp).toBe('2026-05-20 22:10');

    view.unmount();
  });

  it('coalesces multiple refresh signals during one request into at most one follow-up', async () => {
    const transport = createFakeTimelineTransport();
    const view = renderHook(() => useTimelinePlayback({ transport }));

    expect(transport.callCount()).toBe(1);

    // Several refresh signals arrive while the initial request is in flight.
    act(() => {
      view.result.current.refresh();
      view.result.current.refresh();
      view.result.current.refresh();
    });

    // Still only the one in-flight request; no request fired synchronously
    // for the queued signals.
    expect(transport.callCount()).toBe(1);

    await act(async () => {
      transport.calls[0]?.deferred.resolve({
        ok: true,
        data: validTimelinePayload('2026-05-20 22:00', ['2026-05-20 22:00']),
      });
      await flush();
    });

    // Exactly one coalesced follow-up request, not three.
    expect(transport.callCount()).toBe(2);

    await act(async () => {
      transport.calls[1]?.deferred.resolve({
        ok: true,
        data: validTimelinePayload('2026-05-20 22:10', ['2026-05-20 22:10']),
      });
      await flush();
    });

    expect(transport.callCount()).toBe(2);
    expect(view.result.current.currentTimestamp).toBe('2026-05-20 22:10');

    view.unmount();
  });

  it('never lets a late (stale) response overwrite a newer result', async () => {
    const transport = createFakeTimelineTransport();
    const view = renderHook(() => useTimelinePlayback({ transport }));

    await act(async () => {
      transport.calls[0]?.deferred.resolve({
        ok: true,
        data: validTimelinePayload('2026-05-20 22:00', ['2026-05-20 22:00']),
      });
      await flush();
    });
    expect(view.result.current.currentTimestamp).toBe('2026-05-20 22:00');

    // Start a second, slower request via ingestPolledTimeline (which bumps
    // the generation) racing against a stale in-flight fetch resolution.
    act(() => {
      view.result.current.refresh();
    });
    expect(transport.callCount()).toBe(2);

    // A newer authoritative update arrives out-of-band before the in-flight
    // fetch resolves.
    act(() => {
      view.result.current.ingestPolledTimeline(
        validTimelinePayload('2026-05-20 22:20', ['2026-05-20 22:20']),
      );
    });
    expect(view.result.current.currentTimestamp).toBe('2026-05-20 22:20');

    // The stale in-flight fetch now resolves with older data; it must not
    // overwrite the newer state.
    await act(async () => {
      transport.calls[1]?.deferred.resolve({
        ok: true,
        data: validTimelinePayload('2026-05-20 22:00', ['2026-05-20 22:00']),
      });
      await flush();
    });

    expect(view.result.current.currentTimestamp).toBe('2026-05-20 22:20');

    view.unmount();
  });

  it('produces no state update for an aborted request on unmount, and no unhandled rejection', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);

    const transport = createFakeTimelineTransport();
    const view = renderHook(() => useTimelinePlayback({ transport }));

    const call = transport.calls[0];
    expect(call).toBeDefined();

    view.unmount();
    expect(call?.signal?.aborted).toBe(true);

    await act(async () => {
      call?.deferred.resolve({ ok: false, error: { code: 'ABORTED', message: 'Request was aborted' } });
      await flush();
    });

    await flush();
    expect(unhandled).not.toHaveBeenCalled();
    process.off('unhandledRejection', unhandled);
  });

  it('rejects a user selection that is not one of the authoritative timestamps', async () => {
    const transport = createFakeTimelineTransport();
    const view = renderHook(() => useTimelinePlayback({ transport }));

    await act(async () => {
      transport.calls[0]?.deferred.resolve({
        ok: true,
        data: validTimelinePayload('2026-05-20 22:10', [
          '2026-05-20 22:00',
          '2026-05-20 22:10',
        ]),
      });
      await flush();
    });

    act(() => {
      view.result.current.selectTimestamp('2099-01-01 00:00');
    });

    expect(view.result.current.selectedTimestamp).toBe('2026-05-20 22:10');

    view.unmount();
  });

  it('lets selection move independently of the authoritative current position', async () => {
    const transport = createFakeTimelineTransport();
    const view = renderHook(() => useTimelinePlayback({ transport }));

    await act(async () => {
      transport.calls[0]?.deferred.resolve({
        ok: true,
        data: validTimelinePayload('2026-05-20 22:10', [
          '2026-05-20 22:00',
          '2026-05-20 22:10',
        ]),
      });
      await flush();
    });

    act(() => {
      view.result.current.selectTimestamp('2026-05-20 22:00');
    });

    expect(view.result.current.selectedTimestamp).toBe('2026-05-20 22:00');
    // Selecting is local presentation state only; the authoritative current
    // position must remain untouched.
    expect(view.result.current.currentTimestamp).toBe('2026-05-20 22:10');

    view.unmount();
  });

  it('supports previous/next with boundary no-ops', async () => {
    const transport = createFakeTimelineTransport();
    const view = renderHook(() => useTimelinePlayback({ transport }));

    await act(async () => {
      transport.calls[0]?.deferred.resolve({
        ok: true,
        data: validTimelinePayload('2026-05-20 22:00', [
          '2026-05-20 22:00',
          '2026-05-20 22:10',
          '2026-05-20 22:20',
        ]),
      });
      await flush();
    });

    expect(view.result.current.selectedIndex).toBe(0);

    act(() => {
      view.result.current.selectPrevious();
    });
    expect(view.result.current.selectedIndex).toBe(0); // no-op at start

    act(() => {
      view.result.current.selectNext();
    });
    expect(view.result.current.selectedIndex).toBe(1);

    act(() => {
      view.result.current.selectNext();
    });
    expect(view.result.current.selectedIndex).toBe(2);

    act(() => {
      view.result.current.selectNext();
    });
    expect(view.result.current.selectedIndex).toBe(2); // no-op at end

    view.unmount();
  });

  it('does not reset state across ordinary rerenders', async () => {
    const transport = createFakeTimelineTransport();
    const view = renderHook(() => useTimelinePlayback({ transport }));

    await act(async () => {
      transport.calls[0]?.deferred.resolve({
        ok: true,
        data: validTimelinePayload('2026-05-20 22:10', ['2026-05-20 22:10']),
      });
      await flush();
    });

    view.rerender();
    view.rerender();

    expect(transport.callCount()).toBe(1);
    expect(view.result.current.state).toBe('ready');

    view.unmount();
  });

  it('preserves the last successful timeline while a background refresh is pending', async () => {
    const transport = createFakeTimelineTransport();
    const view = renderHook(() => useTimelinePlayback({ transport }));

    await act(async () => {
      transport.calls[0]?.deferred.resolve({
        ok: true,
        data: validTimelinePayload('2026-05-20 22:10', ['2026-05-20 22:10']),
      });
      await flush();
    });

    act(() => {
      view.result.current.refresh();
    });

    // Existing content must remain visible while the background refresh is
    // in flight.
    expect(view.result.current.state).toBe('ready');
    expect(view.result.current.currentTimestamp).toBe('2026-05-20 22:10');
    expect(view.result.current.refreshStatus).toBe('refreshing');

    view.unmount();
  });

  it('reports a background refresh failure without discarding existing content', async () => {
    const transport = createFakeTimelineTransport();
    const view = renderHook(() => useTimelinePlayback({ transport }));

    await act(async () => {
      transport.calls[0]?.deferred.resolve({
        ok: true,
        data: validTimelinePayload('2026-05-20 22:10', ['2026-05-20 22:10']),
      });
      await flush();
    });

    act(() => {
      view.result.current.refresh();
    });

    await act(async () => {
      transport.calls[1]?.deferred.resolve({
        ok: false,
        error: { code: 'NETWORK_ERROR', message: 'temporary blip' },
      });
      await flush();
    });

    expect(view.result.current.state).toBe('ready');
    expect(view.result.current.currentTimestamp).toBe('2026-05-20 22:10');
    expect(view.result.current.error?.code).toBe('REQUEST_FAILED');

    view.unmount();
  });
});
