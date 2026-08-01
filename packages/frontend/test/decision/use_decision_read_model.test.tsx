/**
 * Decision read-model controller tests (TASK-132).
 *
 * Covers the full state machine (idle / loading / ready / partial /
 * insufficient_data / error), the background-refresh contract, request
 * coalescing, decision switching, unmount abort, and the pushed-body path used
 * by the TASK-123 dedup reconciler.
 */

import { describe, expect, it, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useDecisionReadModel } from '../../src/decision/use_decision_read_model.js';
import type { DecisionTransport } from '../../src/decision/use_decision_read_model.js';
import type { ApiResult } from '../../src/api/client.js';
import { wireDecision } from './fixtures.js';

function okResult(body: unknown): ApiResult<unknown> {
  return { ok: true, data: body };
}

function failResult(message = '網路錯誤'): ApiResult<unknown> {
  return { ok: false, error: { code: 'NETWORK_ERROR', message } };
}

function transportOf(responses: readonly ApiResult<unknown>[]): {
  readonly transport: DecisionTransport;
  readonly paths: string[];
} {
  const paths: string[] = [];
  let index = 0;
  const transport: DecisionTransport = {
    getReadOnlyJson: (path) => {
      paths.push(path);
      const response = responses[Math.min(index, responses.length - 1)];
      index += 1;
      return Promise.resolve(response ?? failResult('no response configured'));
    },
  };
  return { transport, paths };
}

describe('useDecisionReadModel — state machine', () => {
  it('stays idle and issues no request without a decision id', async () => {
    const { transport, paths } = transportOf([okResult(wireDecision())]);
    const { result } = renderHook(() => useDecisionReadModel({ transport, decisionId: null }));

    expect(result.current.state).toBe('idle');
    expect(paths).toEqual([]);
    await waitFor(() => expect(result.current.state).toBe('idle'));
  });

  it('loads and reaches ready with the percent-encoded route', async () => {
    const { transport, paths } = transportOf([okResult(wireDecision())]);
    const { result } = renderHook(() =>
      useDecisionReadModel({ transport, decisionId: 'dec/acc 001' }),
    );

    await waitFor(() => expect(result.current.state).toBe('ready'));
    expect(paths).toEqual(['decisions/dec%2Facc%20001']);
    expect(result.current.core?.primaryEvacuation).toBe('RD_TPE_004');
    expect(result.current.report?.reportText).toBeTypeOf('string');
  });

  it('exposes partial as a first-class state', async () => {
    const { transport } = transportOf([
      okResult(
        wireDecision({
          data_status: 'partial',
          narratives: [],
          missing_narrative_types: ['REPORT', 'PUBLIC_ALERT', 'EXPLANATION'],
        }),
      ),
    ]);
    const { result } = renderHook(() =>
      useDecisionReadModel({ transport, decisionId: 'dec-acc001' }),
    );

    await waitFor(() => expect(result.current.state).toBe('partial'));
    expect(result.current.report).toBeNull();
    expect(result.current.missingNarrativeTypes).toHaveLength(3);
  });

  it('exposes insufficient_data as a STOP, not an error', async () => {
    const { transport } = transportOf([
      okResult(
        wireDecision({
          data_status: 'insufficient_data',
          core: null,
          narratives: [],
          missing_narrative_types: ['REPORT', 'PUBLIC_ALERT', 'EXPLANATION'],
        }),
      ),
    ]);
    const { result } = renderHook(() =>
      useDecisionReadModel({ transport, decisionId: 'dec-acc001' }),
    );

    await waitFor(() => expect(result.current.state).toBe('insufficient_data'));
    expect(result.current.core).toBeNull();
    expect(result.current.error).toBeNull();
  });

  it('reports a transport failure as error before any success', async () => {
    const { transport } = transportOf([failResult('連線中斷')]);
    const { result } = renderHook(() =>
      useDecisionReadModel({ transport, decisionId: 'dec-acc001' }),
    );

    await waitFor(() => expect(result.current.state).toBe('error'));
    expect(result.current.error?.code).toBe('REQUEST_FAILED');
    expect(result.current.error?.message).toBe('連線中斷');
    expect(result.current.decisionId).toBe('dec-acc001');
  });

  it('reports a decode failure with the decoder error code', async () => {
    const { transport } = transportOf([okResult({ schema_version: '1.0' })]);
    const { result } = renderHook(() =>
      useDecisionReadModel({ transport, decisionId: 'dec-acc001' }),
    );

    await waitFor(() => expect(result.current.state).toBe('error'));
    expect(result.current.error?.code).toBe('MISSING_TRACE_ID');
  });

  it('keeps the last successful model when a background refresh fails', async () => {
    const { transport } = transportOf([okResult(wireDecision()), failResult('暫時失敗')]);
    const { result } = renderHook(() =>
      useDecisionReadModel({ transport, decisionId: 'dec-acc001' }),
    );

    await waitFor(() => expect(result.current.state).toBe('ready'));
    act(() => {
      result.current.refresh();
    });

    await waitFor(() => expect(result.current.error?.message).toBe('暫時失敗'));
    expect(result.current.state).toBe('ready');
    expect(result.current.core?.primaryEvacuation).toBe('RD_TPE_004');
    expect(result.current.refreshStatus).toBe('idle');
  });

  it('ignores an aborted result without entering the error state', async () => {
    const transport: DecisionTransport = {
      getReadOnlyJson: () =>
        Promise.resolve({ ok: false, error: { code: 'ABORTED', message: 'aborted' } }),
    };
    const { result } = renderHook(() =>
      useDecisionReadModel({ transport, decisionId: 'dec-acc001' }),
    );

    await waitFor(() => expect(result.current.state).toBe('loading'));
    expect(result.current.error).toBeNull();
  });

  it('never produces an unhandled rejection when the transport throws', async () => {
    const transport: DecisionTransport = {
      getReadOnlyJson: () => Promise.reject(new Error('boom')),
    };
    const { result } = renderHook(() =>
      useDecisionReadModel({ transport, decisionId: 'dec-acc001' }),
    );

    await waitFor(() => expect(result.current.state).toBe('error'));
    expect(result.current.error?.code).toBe('REQUEST_FAILED');
  });
});

describe('useDecisionReadModel — concurrency and identity', () => {
  it('coalesces refreshes issued while a request is in flight', async () => {
    let resolveFirst: ((value: ApiResult<unknown>) => void) | null = null;
    const paths: string[] = [];
    const transport: DecisionTransport = {
      getReadOnlyJson: (path) => {
        paths.push(path);
        if (resolveFirst === null) {
          return new Promise<ApiResult<unknown>>((resolve) => {
            resolveFirst = resolve;
          });
        }
        return Promise.resolve(okResult(wireDecision()));
      },
    };

    const { result } = renderHook(() =>
      useDecisionReadModel({ transport, decisionId: 'dec-acc001' }),
    );
    await waitFor(() => expect(paths).toHaveLength(1));

    act(() => {
      result.current.refresh();
      result.current.refresh();
      result.current.refresh();
    });
    expect(paths).toHaveLength(1);

    await act(async () => {
      resolveFirst?.(okResult(wireDecision()));
    });

    await waitFor(() => expect(paths).toHaveLength(2));
    expect(paths).toHaveLength(2);
  });

  it('drops the previous decision content when the decision id changes', async () => {
    const { transport } = transportOf([
      okResult(wireDecision()),
      okResult(
        wireDecision({
          decision_id: 'dec-two',
          core: null,
          data_status: 'insufficient_data',
          narratives: [],
        }),
      ),
    ]);
    const { result, rerender } = renderHook(
      (props: { decisionId: string }) =>
        useDecisionReadModel({ transport, decisionId: props.decisionId }),
      { initialProps: { decisionId: 'dec-acc001' } },
    );

    await waitFor(() => expect(result.current.state).toBe('ready'));

    rerender({ decisionId: 'dec-two' });
    await waitFor(() => expect(result.current.decisionId).toBe('dec-two'));
    await waitFor(() => expect(result.current.state).toBe('insufficient_data'));
    expect(result.current.core).toBeNull();
  });

  it('returns to idle when the decision id becomes null', async () => {
    const { transport } = transportOf([okResult(wireDecision())]);
    const { result, rerender } = renderHook(
      (props: { decisionId: string | null }) =>
        useDecisionReadModel({ transport, decisionId: props.decisionId }),
      { initialProps: { decisionId: 'dec-acc001' as string | null } },
    );

    await waitFor(() => expect(result.current.state).toBe('ready'));
    rerender({ decisionId: null });
    await waitFor(() => expect(result.current.state).toBe('idle'));
    expect(result.current.core).toBeNull();
  });

  it('aborts the in-flight request on unmount', async () => {
    const abort = vi.fn();
    const transport: DecisionTransport = {
      getReadOnlyJson: (_path, options) => {
        options?.signal?.addEventListener('abort', abort);
        return new Promise<ApiResult<unknown>>(() => {
          /* never settles */
        });
      },
    };

    const { unmount, result } = renderHook(() =>
      useDecisionReadModel({ transport, decisionId: 'dec-acc001' }),
    );
    await waitFor(() => expect(result.current.state).toBe('loading'));

    unmount();
    expect(abort).toHaveBeenCalledTimes(1);
  });
});

describe('useDecisionReadModel — ingestDecisionPayload (TASK-123 reconciler path)', () => {
  it('applies an already-fetched authoritative body without a second request', async () => {
    const { transport, paths } = transportOf([failResult('尚未取得')]);
    const { result } = renderHook(() =>
      useDecisionReadModel({ transport, decisionId: 'dec-acc001' }),
    );
    await waitFor(() => expect(result.current.state).toBe('error'));
    const requestsBefore = paths.length;

    act(() => {
      result.current.ingestDecisionPayload(wireDecision());
    });

    await waitFor(() => expect(result.current.state).toBe('ready'));
    expect(paths).toHaveLength(requestsBefore);
    expect(result.current.core?.eventId).toBe('TPE_2026_ACC_001');
  });

  it('still validates a pushed body', async () => {
    const { transport } = transportOf([okResult(wireDecision())]);
    const { result } = renderHook(() =>
      useDecisionReadModel({ transport, decisionId: 'dec-acc001' }),
    );
    await waitFor(() => expect(result.current.state).toBe('ready'));

    act(() => {
      result.current.ingestDecisionPayload({ schema_version: '1.0', trace_id: 'tr-1' });
    });

    await waitFor(() => expect(result.current.error?.code).toBe('MISSING_DECISION_ID'));
    // A malformed push must not blank out the good content already displayed.
    expect(result.current.state).toBe('ready');
    expect(result.current.core?.eventId).toBe('TPE_2026_ACC_001');
  });
});
