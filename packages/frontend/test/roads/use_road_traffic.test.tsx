/**
 * Road Traffic Controller Tests (TASK-125)
 *
 * Verifies the controller's state machine, concurrency guarantees, and the
 * zero-fabrication/zero-recompute boundary using an injected fake transport
 * and deferred promises (no live HTTP, no sleeping, no real timers).
 */

import { describe, it, expect, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useRoadTraffic } from '../../src/roads/use_road_traffic.js';
import type { RoadTransport } from '../../src/roads/use_road_traffic.js';
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

function createFakeRoadTransport(): RoadTransport & {
  calls: FakeCall[];
  callCount: () => number;
} {
  const calls: FakeCall[] = [];
  return {
    calls,
    callCount: () => calls.length,
    getRoads(options) {
      const deferred = createDeferred<ApiResult<unknown>>();
      calls.push({ deferred, signal: options?.signal });
      return deferred.promise;
    },
  };
}

function segment(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    segment_id: 'RD_TPE_001',
    road_name: '市民大道',
    saturation_score: 0.5,
    level: 'A',
    lane_status: 'normal',
    ...overrides,
  };
}

function roadsPayload(
  segments: readonly Record<string, unknown>[],
  overrides: Partial<Record<string, unknown>> = {},
): unknown {
  return {
    schema_version: '1.0',
    trace_id: 'tr-roads',
    segments,
    timestamp: '2026-05-20 22:10',
    provisional: true,
    ...overrides,
  };
}

async function flush(turns = 20): Promise<void> {
  for (let index = 0; index < turns; index += 1) {
    await Promise.resolve();
  }
}

describe('useRoadTraffic', () => {
  it('1. fetches exactly once on initial mount', () => {
    const transport = createFakeRoadTransport();
    const view = renderHook(() => useRoadTraffic({ transport }));

    expect(transport.callCount()).toBe(1);
    expect(view.result.current.state).toBe('loading');

    view.unmount();
  });

  it('3. produces ready state on a successful response', async () => {
    const transport = createFakeRoadTransport();
    const view = renderHook(() => useRoadTraffic({ transport }));

    await act(async () => {
      transport.calls[0]?.deferred.resolve({
        ok: true,
        data: roadsPayload([segment()]),
      });
      await flush();
    });

    expect(view.result.current.state).toBe('ready');
    expect(view.result.current.model?.segments).toHaveLength(1);

    view.unmount();
  });

  it('4. produces empty state for zero segments', async () => {
    const transport = createFakeRoadTransport();
    const view = renderHook(() => useRoadTraffic({ transport }));

    await act(async () => {
      transport.calls[0]?.deferred.resolve({ ok: true, data: roadsPayload([]) });
      await flush();
    });

    expect(view.result.current.state).toBe('empty');
    expect(view.result.current.model?.segments).toEqual([]);

    view.unmount();
  });

  it('5. produces insufficient state for backend data_status=insufficient_data', async () => {
    const transport = createFakeRoadTransport();
    const view = renderHook(() => useRoadTraffic({ transport }));

    await act(async () => {
      transport.calls[0]?.deferred.resolve({
        ok: true,
        data: roadsPayload([], { data_status: 'insufficient_data' }),
      });
      await flush();
    });

    expect(view.result.current.state).toBe('insufficient');
    expect(view.result.current.model?.dataStatus).toBe('insufficient_data');

    view.unmount();
  });

  it('6. produces error state on API failure', async () => {
    const transport = createFakeRoadTransport();
    const view = renderHook(() => useRoadTraffic({ transport }));

    await act(async () => {
      transport.calls[0]?.deferred.resolve({
        ok: false,
        error: { code: 'NETWORK_ERROR', message: 'boom' },
      });
      await flush();
    });

    expect(view.result.current.state).toBe('error');
    expect(view.result.current.error?.code).toBe('REQUEST_FAILED');
    expect(view.result.current.model).toBeNull();

    view.unmount();
  });

  it('produces error state (not empty) for a malformed response', async () => {
    const transport = createFakeRoadTransport();
    const view = renderHook(() => useRoadTraffic({ transport }));

    await act(async () => {
      transport.calls[0]?.deferred.resolve({ ok: true, data: { segments: 'not-an-array' } });
      await flush();
    });

    expect(view.result.current.state).toBe('error');
    expect(view.result.current.error?.code).toBe('MISSING_SCHEMA_VERSION');

    view.unmount();
  });

  it('7. recovers via refresh() after an error', async () => {
    const transport = createFakeRoadTransport();
    const view = renderHook(() => useRoadTraffic({ transport }));

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
      transport.calls[1]?.deferred.resolve({ ok: true, data: roadsPayload([segment()]) });
      await flush();
    });

    expect(view.result.current.state).toBe('ready');

    view.unmount();
  });

  it('9. same-effect signal does not trigger duplicate requests without an explicit refresh() call', async () => {
    const transport = createFakeRoadTransport();
    const view = renderHook(() => useRoadTraffic({ transport }));

    await act(async () => {
      transport.calls[0]?.deferred.resolve({ ok: true, data: roadsPayload([segment()]) });
      await flush();
    });

    view.rerender();
    view.rerender();

    expect(transport.callCount()).toBe(1);

    view.unmount();
  });

  it('10/11. coalesces multiple refresh signals during one request into at most one follow-up', async () => {
    const transport = createFakeRoadTransport();
    const view = renderHook(() => useRoadTraffic({ transport }));

    expect(transport.callCount()).toBe(1);

    act(() => {
      view.result.current.refresh();
      view.result.current.refresh();
      view.result.current.refresh();
    });

    expect(transport.callCount()).toBe(1);

    await act(async () => {
      transport.calls[0]?.deferred.resolve({ ok: true, data: roadsPayload([segment()]) });
      await flush();
    });

    // Exactly one coalesced follow-up request, not three.
    expect(transport.callCount()).toBe(2);

    await act(async () => {
      transport.calls[1]?.deferred.resolve({ ok: true, data: roadsPayload([segment()]) });
      await flush();
    });

    expect(transport.callCount()).toBe(2);

    view.unmount();
  });

  it('12. never lets a late (stale) response overwrite a newer result', async () => {
    const transport = createFakeRoadTransport();
    const view = renderHook(() => useRoadTraffic({ transport }));

    await act(async () => {
      transport.calls[0]?.deferred.resolve({
        ok: true,
        data: roadsPayload([segment({ segment_id: 'OLD' })]),
      });
      await flush();
    });
    expect(view.result.current.model?.segments[0]?.segmentId).toBe('OLD');

    act(() => {
      view.result.current.refresh();
    });
    expect(transport.callCount()).toBe(2);

    // Newer authoritative data arrives out-of-band via direct ingestion.
    act(() => {
      view.result.current.ingestPolledRoads(roadsPayload([segment({ segment_id: 'NEW' })]));
    });
    expect(view.result.current.model?.segments[0]?.segmentId).toBe('NEW');

    // Stale in-flight fetch resolves afterward; must not overwrite newer state.
    await act(async () => {
      transport.calls[1]?.deferred.resolve({
        ok: true,
        data: roadsPayload([segment({ segment_id: 'STALE' })]),
      });
      await flush();
    });

    expect(view.result.current.model?.segments[0]?.segmentId).toBe('NEW');

    view.unmount();
  });

  it('13. aborts the in-flight request on unmount with no unhandled rejection', async () => {
    const unhandled = vi.fn();
    process.on('unhandledRejection', unhandled);

    const transport = createFakeRoadTransport();
    const view = renderHook(() => useRoadTraffic({ transport }));

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

  it('14. preserves the last successful segments while a background refresh is pending', async () => {
    const transport = createFakeRoadTransport();
    const view = renderHook(() => useRoadTraffic({ transport }));

    await act(async () => {
      transport.calls[0]?.deferred.resolve({ ok: true, data: roadsPayload([segment()]) });
      await flush();
    });

    act(() => {
      view.result.current.refresh();
    });

    expect(view.result.current.state).toBe('ready');
    expect(view.result.current.model?.segments).toHaveLength(1);
    expect(view.result.current.refreshStatus).toBe('refreshing');

    view.unmount();
  });

  it('reports a background refresh failure without discarding existing content', async () => {
    const transport = createFakeRoadTransport();
    const view = renderHook(() => useRoadTraffic({ transport }));

    await act(async () => {
      transport.calls[0]?.deferred.resolve({ ok: true, data: roadsPayload([segment()]) });
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
    expect(view.result.current.model?.segments).toHaveLength(1);
    expect(view.result.current.error?.code).toBe('REQUEST_FAILED');

    view.unmount();
  });

  it('16. ingestPolledRoads applies a successful polled body without a second HTTP request', async () => {
    const transport = createFakeRoadTransport();
    const view = renderHook(() => useRoadTraffic({ transport }));

    await act(async () => {
      transport.calls[0]?.deferred.resolve({ ok: true, data: roadsPayload([]) });
      await flush();
    });
    expect(transport.callCount()).toBe(1);

    act(() => {
      view.result.current.ingestPolledRoads(roadsPayload([segment({ segment_id: 'POLLED' })]));
    });

    expect(transport.callCount()).toBe(1);
    expect(view.result.current.state).toBe('ready');
    expect(view.result.current.model?.segments[0]?.segmentId).toBe('POLLED');

    view.unmount();
  });

  it('23/24. renders all returned segments (15) in original order without fabrication', async () => {
    const transport = createFakeRoadTransport();
    const view = renderHook(() => useRoadTraffic({ transport }));

    const segments = Array.from({ length: 15 }, (_, index) =>
      segment({ segment_id: `RD_${index}` }),
    );

    await act(async () => {
      transport.calls[0]?.deferred.resolve({ ok: true, data: roadsPayload(segments) });
      await flush();
    });

    expect(view.result.current.model?.segments).toHaveLength(15);
    expect(view.result.current.model?.segments.map((entry) => entry.segmentId)).toEqual(
      segments.map((entry) => entry.segment_id),
    );

    view.unmount();
  });

  it('20/21. preserves an inconsistent saturation/level fixture verbatim (no recompute)', async () => {
    const transport = createFakeRoadTransport();
    const view = renderHook(() => useRoadTraffic({ transport }));

    await act(async () => {
      transport.calls[0]?.deferred.resolve({
        ok: true,
        data: roadsPayload([
          segment({ segment_id: 'LOW_SAT_A', saturation_score: 0.1, level: 'A' }),
          segment({ segment_id: 'HIGH_SAT_B', saturation_score: 0.99, level: 'B' }),
        ]),
      });
      await flush();
    });

    const segments = view.result.current.model?.segments ?? [];
    expect(segments[0]?.level).toBe('A');
    expect(segments[0]?.saturationScore).toBe(0.1);
    expect(segments[1]?.level).toBe('B');
    expect(segments[1]?.saturationScore).toBe(0.99);

    view.unmount();
  });

  it('26/27/28. preserves per-segment provenance verbatim and reports unavailable when absent', async () => {
    const transport = createFakeRoadTransport();
    const view = renderHook(() => useRoadTraffic({ transport }));

    await act(async () => {
      transport.calls[0]?.deferred.resolve({
        ok: true,
        data: roadsPayload([
          segment({
            segment_id: 'WITH_PROVENANCE',
            observation_timestamp: '2026-05-20 22:00',
            staleness_minutes: 12,
          }),
          segment({ segment_id: 'NO_PROVENANCE' }),
        ]),
      });
      await flush();
    });

    const segments = view.result.current.model?.segments ?? [];
    expect(segments[0]?.observationTimestamp).toBe('2026-05-20 22:00');
    expect(segments[0]?.stalenessMinutes).toBe(12);
    expect(segments[1]?.observationTimestamp).toBeNull();
    expect(segments[1]?.stalenessMinutes).toBeNull();

    view.unmount();
  });
});
