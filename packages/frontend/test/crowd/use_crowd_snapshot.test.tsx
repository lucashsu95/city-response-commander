/**
 * Crowd Snapshot Controller Tests (TASK-126)
 *
 * Uses an injected fake transport with deferred promises (no live HTTP, no
 * timers) to verify the state machine, the timeline-advance refresh signal, and
 * that a failed read never fabricates crowd data.
 */

import { describe, it, expect } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { useCrowdSnapshot } from '../../src/crowd/use_crowd_snapshot.js';
import type { CrowdTransport } from '../../src/crowd/use_crowd_snapshot.js';
import type { ApiResult } from '../../src/api/client.js';

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

interface FakeCall {
  readonly path: string;
  readonly deferred: Deferred<ApiResult<unknown>>;
}

function createFakeTransport(): CrowdTransport & { readonly calls: FakeCall[] } {
  const calls: FakeCall[] = [];
  return {
    calls,
    getReadOnlyJson(path) {
      const deferred = createDeferred<ApiResult<unknown>>();
      calls.push({ path, deferred });
      return deferred.promise;
    },
  };
}

function crowdPayload(stationIds: readonly string[], dataStatus = 'ready'): unknown {
  return {
    schema_version: '1.0',
    trace_id: 'tr-crowd',
    data_status: dataStatus,
    decision_cutoff_timestamp: '2026-05-20 22:20',
    provisional: true,
    stations: stationIds.map((bsId) => ({
      BS_ID: bsId,
      Location_Name: bsId,
      User_Count: 100,
      Growth_Rate: 0.1,
      roaming_pct_value: 0.1,
      Roaming_User_Pct: '10%',
      flags: [],
      in_multilingual_scope: true,
      observation_timestamp: '2026-05-20 22:15',
      exact_match: false,
      staleness_minutes: 5,
      stale: true,
      data_status: 'ready',
    })),
    multilingual: {
      triggered: false,
      multilingual_required: false,
      triggering_station_ids: [],
      data_status: 'ready',
      scope_mode: 'current_snapshot_all_available_stations',
      stations_in_scope: stationIds,
    },
  };
}

async function flush(turns = 20): Promise<void> {
  for (let index = 0; index < turns; index += 1) {
    await Promise.resolve();
  }
}

describe('useCrowdSnapshot', () => {
  it('reads the crowd route once on mount and reports loading first', async () => {
    const transport = createFakeTransport();
    const { result } = renderHook(() => useCrowdSnapshot({ transport }));

    expect(transport.calls).toHaveLength(1);
    expect(transport.calls[0]?.path).toBe('crowd');
    expect(result.current.state).toBe('loading');

    await act(async () => {
      transport.calls[0]?.deferred.resolve({ ok: true, data: crowdPayload(['BS_MRT_BL17']) });
      await flush();
    });

    expect(result.current.state).toBe('ready');
    expect(result.current.stations.map((station) => station.bsId)).toEqual(['BS_MRT_BL17']);
    expect(result.current.decisionCutoffTimestamp).toBe('2026-05-20 22:20');
    expect(result.current.provisional).toBe(true);
  });

  it('maps a ready response with no stations to the empty state', async () => {
    const transport = createFakeTransport();
    const { result } = renderHook(() => useCrowdSnapshot({ transport }));

    await act(async () => {
      transport.calls[0]?.deferred.resolve({ ok: true, data: crowdPayload([]) });
      await flush();
    });

    expect(result.current.state).toBe('empty');
    expect(result.current.stations).toEqual([]);
  });

  it('maps the backend STOP to insufficient_data, not to an error', async () => {
    const transport = createFakeTransport();
    const { result } = renderHook(() => useCrowdSnapshot({ transport }));

    await act(async () => {
      transport.calls[0]?.deferred.resolve({
        ok: true,
        data: {
          ...(crowdPayload([], 'insufficient_data') as object),
          stop_reason: 'hash mismatch',
        },
      });
      await flush();
    });

    expect(result.current.state).toBe('insufficient_data');
    expect(result.current.stopReason).toBe('hash mismatch');
    expect(result.current.error).toBeNull();
  });

  it('re-reads the route when the replay position advances', async () => {
    const transport = createFakeTransport();
    const { result, rerender } = renderHook(
      ({ replayPosition }: { replayPosition: string | null }) =>
        useCrowdSnapshot({ transport, replayPosition }),
      { initialProps: { replayPosition: '2026-05-20 22:10' } },
    );

    await act(async () => {
      transport.calls[0]?.deferred.resolve({ ok: true, data: crowdPayload(['BS_A']) });
      await flush();
    });
    expect(result.current.stations[0]?.bsId).toBe('BS_A');

    await act(async () => {
      rerender({ replayPosition: '2026-05-20 22:20' });
      await flush();
    });
    expect(transport.calls).toHaveLength(2);

    await act(async () => {
      transport.calls[1]?.deferred.resolve({ ok: true, data: crowdPayload(['BS_B']) });
      await flush();
    });
    expect(result.current.stations[0]?.bsId).toBe('BS_B');
  });

  it('does not re-read when the replay position is unchanged across rerenders', async () => {
    const transport = createFakeTransport();
    const { rerender } = renderHook(
      ({ replayPosition }: { replayPosition: string | null }) =>
        useCrowdSnapshot({ transport, replayPosition }),
      { initialProps: { replayPosition: '2026-05-20 22:10' } },
    );

    await act(async () => {
      transport.calls[0]?.deferred.resolve({ ok: true, data: crowdPayload(['BS_A']) });
      await flush();
    });

    await act(async () => {
      rerender({ replayPosition: '2026-05-20 22:10' });
      await flush();
    });

    expect(transport.calls).toHaveLength(1);
  });

  it('reports a transport failure as error without fabricating stations', async () => {
    const transport = createFakeTransport();
    const { result } = renderHook(() => useCrowdSnapshot({ transport }));

    await act(async () => {
      transport.calls[0]?.deferred.resolve({
        ok: false,
        error: { code: 'NETWORK_ERROR', message: 'offline' },
      });
      await flush();
    });

    expect(result.current.state).toBe('error');
    expect(result.current.error?.code).toBe('REQUEST_FAILED');
    expect(result.current.stations).toEqual([]);
    expect(result.current.multilingual).toBeNull();
  });

  it('reports a malformed payload as a decode error', async () => {
    const transport = createFakeTransport();
    const { result } = renderHook(() => useCrowdSnapshot({ transport }));

    await act(async () => {
      transport.calls[0]?.deferred.resolve({ ok: true, data: { stations: [] } });
      await flush();
    });

    expect(result.current.state).toBe('error');
    expect(result.current.error?.code).toBe('MISSING_SCHEMA_VERSION');
  });

  it('keeps the previous snapshot when a background refresh fails', async () => {
    const transport = createFakeTransport();
    const { result } = renderHook(() => useCrowdSnapshot({ transport }));

    await act(async () => {
      transport.calls[0]?.deferred.resolve({ ok: true, data: crowdPayload(['BS_A']) });
      await flush();
    });

    await act(async () => {
      result.current.refresh();
      await flush();
    });
    expect(result.current.refreshStatus).toBe('refreshing');

    await act(async () => {
      transport.calls[1]?.deferred.resolve({
        ok: false,
        error: { code: 'NETWORK_ERROR', message: 'blip' },
      });
      await flush();
    });

    expect(result.current.state).toBe('ready');
    expect(result.current.stations[0]?.bsId).toBe('BS_A');
    expect(result.current.error?.message).toBe('blip');
    expect(result.current.refreshStatus).toBe('idle');
  });

  it('coalesces refresh signals arriving while a read is in flight', async () => {
    const transport = createFakeTransport();
    const { result } = renderHook(() => useCrowdSnapshot({ transport }));

    await act(async () => {
      result.current.refresh();
      result.current.refresh();
      await flush();
    });

    expect(transport.calls).toHaveLength(1);

    await act(async () => {
      transport.calls[0]?.deferred.resolve({ ok: true, data: crowdPayload(['BS_A']) });
      await flush();
    });

    // Exactly one coalesced follow-up, regardless of how many signals arrived.
    expect(transport.calls).toHaveLength(2);
  });

  it('ignores an aborted request instead of showing an error', async () => {
    const transport = createFakeTransport();
    const { result } = renderHook(() => useCrowdSnapshot({ transport }));

    await act(async () => {
      transport.calls[0]?.deferred.resolve({
        ok: false,
        error: { code: 'ABORTED', message: 'Request was aborted' },
      });
      await flush();
    });

    expect(result.current.state).toBe('loading');
    expect(result.current.error).toBeNull();
  });
});
