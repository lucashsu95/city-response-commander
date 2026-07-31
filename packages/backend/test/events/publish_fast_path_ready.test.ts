/**
 * TASK-103 ??decision.fast_path_ready WebSocket push unit tests.
 *
 * Verifies the MARK_CORE_COMMITTED gate, the `ready_event_id` dedup key, that the
 * payload carries deterministic facts only, and that a delivery failure never
 * fails the decision (§13, §16.4).
 */

import { describe, it, expect, vi } from 'vitest';
import type { DecisionCore } from '@city-commander/shared-schemas';
import {
  buildFastPathReadyEvent,
  buildReadyEventId,
  isStaleConnectionError,
  publishFastPathReady,
  FastPathGateNotSatisfiedError,
  FAST_PATH_READY_EVENT,
  LatencyTrace,
  NoopTelemetry,
} from '../../src/index.js';
import type { ConnectionPublisherPort, Telemetry } from '../../src/index.js';

const DECISION = 'DEC_TPE_2026_ACC_001_abcdef123456';
const TRACE = 'trace-abc-123';

function core(overrides: Partial<DecisionCore> = {}): DecisionCore {
  return {
    decision_id: DECISION,
    idempotency_key: 'TPE_2026_ACC_001|2026-05-20 22:10|prov-2026a',
    version: 1,
    source_manifest_hash: 'sha256:AAAA',
    core_hash: 'sha256:CORE-1',
    schema_version: '1.0.0',
    provisional: true,
    event_id: 'TPE_2026_ACC_001',
    occurred_at: '2026-05-20 22:10',
    triggered_articles: [1, 2],
    applied_formula_articles: [7],
    invoked_procedures: ['article2_alternative_route_guidance'],
    primary_evacuation: 'RD_TPE_004',
    secondary_evacuation: ['RD_TPE_005'],
    ete: { ete_minutes: 78.6 },
    cms_core_text: '?�復?�路封�?，�??��? 市�?大�??�段，�?計延�?78.6 ?��?',
    multilingual_required: true,
    ...overrides,
  } as unknown as DecisionCore;
}

interface Publisher extends ConnectionPublisherPort {
  readonly list: ReturnType<typeof vi.fn>;
  readonly post: ReturnType<typeof vi.fn>;
}

function createPublisher(connectionIds: readonly string[] = ['conn-1', 'conn-2']): Publisher {
  const list = vi.fn().mockResolvedValue(connectionIds);
  const post = vi.fn().mockResolvedValue(undefined);
  return { list, post, listConnectionIds: list, postToConnection: post } as unknown as Publisher;
}

function goneError(): Error {
  return Object.assign(new Error('connection gone'), {
    name: 'GoneException',
    $metadata: { httpStatusCode: 410 },
  });
}

const publishInput = {
  core: core(),
  traceId: TRACE,
  policyVersion: 'prov-2026a',
  coreCommittedGate: 'APPLIED',
} as const;

// ?�?�?� ready_event_id ?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�

describe('buildReadyEventId', () => {
  it('builds decision_id|event_type|core_version_ref', () => {
    expect(
      buildReadyEventId({
        decisionId: DECISION,
        eventType: FAST_PATH_READY_EVENT,
        coreVersionRef: 1,
      }),
    ).toBe(`${DECISION}|decision.fast_path_ready|1`);
  });

  it('changes with core_version_ref so a re-decision is not deduped away', () => {
    const v1 = buildReadyEventId({ decisionId: DECISION, eventType: 'x', coreVersionRef: 1 });
    const v2 = buildReadyEventId({ decisionId: DECISION, eventType: 'x', coreVersionRef: 2 });

    expect(v1).not.toBe(v2);
  });

  it('is stable for the same inputs (client dedup depends on it)', () => {
    const args = { decisionId: DECISION, eventType: FAST_PATH_READY_EVENT, coreVersionRef: 3 };

    expect(buildReadyEventId(args)).toBe(buildReadyEventId(args));
  });
});

// ?�?�?� Payload ?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�

describe('buildFastPathReadyEvent', () => {
  it('carries the event type and dedup key', () => {
    const event = buildFastPathReadyEvent({ core: core(), traceId: TRACE, policyVersion: null });

    expect(event.type).toBe(FAST_PATH_READY_EVENT);
    expect(event.ready_event_id).toBe(`${DECISION}|decision.fast_path_ready|1`);
  });

  it('summarizes deterministic facts only (no LLM text)', () => {
    const event = buildFastPathReadyEvent({
      core: core(),
      traceId: TRACE,
      policyVersion: 'prov-2026a',
    });

    expect(event.summary).toEqual({
      triggered_articles: [1, 2],
      applied_formula_articles: [7],
      primary_evacuation: 'RD_TPE_004',
      secondary_evacuation: ['RD_TPE_005'],
      ete_minutes: 78.6,
      multilingual_required: true,
      cms_core_text: '?�復?�路封�?，�??��? 市�?大�??�段，�?計延�?78.6 ?��?',
    });
    // Narrative text arrives later via decision.enriched.
    expect(JSON.stringify(event)).not.toContain('report_text');
  });

  it('carries provenance and provisional markers', () => {
    const event = buildFastPathReadyEvent({
      core: core(),
      traceId: TRACE,
      policyVersion: 'prov-2026a',
    });

    expect(event.source_manifest_hash).toBe('sha256:AAAA');
    expect(event.provisional).toBe(true);
    expect(event.policy_version).toBe('prov-2026a');
    expect(event.occurred_at).toBe('2026-05-20 22:10');
  });

  it('reports a null ETE rather than a zero when none was computed', () => {
    const event = buildFastPathReadyEvent({
      core: core({ ete: undefined }),
      traceId: TRACE,
      policyVersion: null,
    });

    expect(event.summary.ete_minutes).toBeNull();
  });
});

// ?�?�?� MARK_CORE_COMMITTED gate ?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�

describe('MARK_CORE_COMMITTED gate', () => {
  it('publishes when the checkpoint returned APPLIED', async () => {
    const publisher = createPublisher();

    const result = await publishFastPathReady(publisher, publishInput);

    expect(result.delivered).toBe(2);
  });

  it('publishes when the checkpoint returned ALREADY_APPLIED', async () => {
    const publisher = createPublisher();

    const result = await publishFastPathReady(publisher, {
      ...publishInput,
      coreCommittedGate: 'ALREADY_APPLIED',
    });

    expect(result.delivered).toBe(2);
  });

  it('refuses to publish for a fenced execution', async () => {
    const publisher = createPublisher();

    await expect(
      publishFastPathReady(publisher, {
        ...publishInput,
        coreCommittedGate: 'FENCED_STALE_EXECUTION' as unknown as 'APPLIED',
      }),
    ).rejects.toBeInstanceOf(FastPathGateNotSatisfiedError);
    // Nothing was sent, and the connection list was never even read.
    expect(publisher.list).not.toHaveBeenCalled();
    expect(publisher.post).not.toHaveBeenCalled();
  });
});

// ?�?�?� Broadcast ?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�

describe('broadcast', () => {
  it('sends the same serialized payload to every connection', async () => {
    const publisher = createPublisher(['conn-1', 'conn-2', 'conn-3']);

    await publishFastPathReady(publisher, publishInput);

    expect(publisher.post).toHaveBeenCalledTimes(3);
    const payloads = publisher.post.mock.calls.map((call) => call[1] as string);
    expect(new Set(payloads).size).toBe(1);
    expect(JSON.parse(payloads[0]).ready_event_id).toBe(`${DECISION}|decision.fast_path_ready|1`);
  });

  it('handles an empty connection list without error', async () => {
    const publisher = createPublisher([]);

    const result = await publishFastPathReady(publisher, publishInput);

    expect(result.delivered).toBe(0);
    expect(result.failures).toEqual([]);
    expect(publisher.post).not.toHaveBeenCalled();
  });

  it('reports stale connections (410 Gone) for pruning', async () => {
    const publisher = createPublisher(['conn-live', 'conn-gone']);
    publisher.post.mockImplementation(async (connectionId: string) => {
      if (connectionId === 'conn-gone') throw goneError();
    });

    const result = await publishFastPathReady(publisher, publishInput);

    expect(result.delivered).toBe(1);
    expect(result.staleConnectionIds).toEqual(['conn-gone']);
  });

  it('does not fail the decision when a push fails', async () => {
    const publisher = createPublisher(['conn-1']);
    publisher.post.mockRejectedValue(new Error('network down'));

    const result = await publishFastPathReady(publisher, publishInput);

    // Resolves rather than throwing: the core is committed and polling is the
    // documented fallback (§13/§16.4).
    expect(result.delivered).toBe(0);
    expect(result.failures[0]).toMatchObject({
      connectionId: 'conn-1',
      delivered: false,
      stale: false,
    });
  });

  it('keeps delivering to healthy connections when one fails', async () => {
    const publisher = createPublisher(['conn-bad', 'conn-good']);
    publisher.post.mockImplementation(async (connectionId: string) => {
      if (connectionId === 'conn-bad') throw new Error('throttled');
    });

    const result = await publishFastPathReady(publisher, publishInput);

    expect(result.delivered).toBe(1);
    expect(result.failures).toHaveLength(1);
  });

  it('surfaces a connection-list failure (it is not a per-connection error)', async () => {
    const publisher = createPublisher();
    const failure = new Error('connections table unavailable');
    publisher.list.mockRejectedValue(failure);

    await expect(publishFastPathReady(publisher, publishInput)).rejects.toBe(failure);
  });
});

// ?�?�?� Stale detection ?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�?�

describe('isStaleConnectionError', () => {
  it('detects GoneException by name', () => {
    expect(isStaleConnectionError(Object.assign(new Error('x'), { name: 'GoneException' }))).toBe(
      true,
    );
  });

  it('detects HTTP 410 metadata', () => {
    expect(
      isStaleConnectionError(Object.assign(new Error('x'), { $metadata: { httpStatusCode: 410 } })),
    ).toBe(true);
  });

  it('is false for other failures', () => {
    expect(isStaleConnectionError(new Error('throttled'))).toBe(false);
    expect(
      isStaleConnectionError(Object.assign(new Error('x'), { $metadata: { httpStatusCode: 429 } })),
    ).toBe(false);
    expect(isStaleConnectionError(null)).toBe(false);
  });
});

// ?�?�?� Authoritative Fast Path measurement (audit fix 1) ?�?�?�?�?�

describe('publishFastPathReady latency measurement', () => {
  const T0 = 1_800_000_000_000;

  function newTrace(): LatencyTrace {
    return new LatencyTrace({
      decisionId: 'DEC_TPE_2026_ACC_001_abcdef123456',
      traceId: 'trace-abc-123',
      startedAtMs: T0,
    });
  }

  function publisher(connectionIds: readonly string[]): ConnectionPublisherPort {
    return {
      listConnectionIds: async () => [...connectionIds],
      postToConnection: async () => undefined,
    };
  }

  it('marks the Fast Path complete at the push, the authoritative point', async () => {
    const trace = newTrace();

    await publishFastPathReady(publisher(['c1']), {
      core: core(),
      traceId: 'trace-abc-123',
      policyVersion: 'prov-2026a',
      coreCommittedGate: 'APPLIED',
      latency: { trace, now: () => T0 + 4_200 },
    });

    // The budget runs from detection to this push, so a value marked earlier
    // understates it by the checkpoint plus the broadcast.
    expect(trace.snapshot().fast_path_ms).toBe(4_200);
  });

  it('overwrites an earlier DecisionFn mark with the later, accurate value', async () => {
    const trace = newTrace();
    trace.markFastPathReady(T0 + 3_400);

    await publishFastPathReady(publisher(['c1']), {
      core: core(),
      traceId: 'trace-abc-123',
      policyVersion: null,
      coreCommittedGate: 'APPLIED',
      latency: { trace, now: () => T0 + 4_200 },
    });

    expect(trace.snapshot().fast_path_ms).toBe(4_200);
  });

  it('measures even when no dashboard is connected', async () => {
    const trace = newTrace();

    const result = await publishFastPathReady(publisher([]), {
      core: core(),
      traceId: 'trace-abc-123',
      policyVersion: null,
      coreCommittedGate: 'APPLIED',
      latency: { trace, now: () => T0 + 4_200 },
    });

    // Gating the measurement on delivery would drop it exactly when nobody was
    // watching ??which is when the data is most likely to be needed later.
    expect(result.delivered).toBe(0);
    expect(trace.snapshot().fast_path_ms).toBe(4_200);
  });

  it('emits the snapshot through telemetry', async () => {
    const trace = newTrace();
    const snapshots: unknown[] = [];

    await publishFastPathReady(publisher(['c1']), {
      core: core(),
      traceId: 'trace-abc-123',
      policyVersion: null,
      coreCommittedGate: 'APPLIED',
      latency: {
        trace,
        now: () => T0 + 4_200,
        telemetry: {
          ...new NoopTelemetry(),
          recordLatency: (snapshot: unknown) => void snapshots.push(snapshot),
        } as unknown as Telemetry,
      },
    });

    expect(snapshots).toHaveLength(1);
    expect((snapshots[0] as { fast_path_ms: number | null }).fast_path_ms).toBe(4_200);
  });

  it('does not measure when the gate rejects the push', async () => {
    const trace = newTrace();

    await expect(
      publishFastPathReady(publisher(['c1']), {
        core: core(),
        traceId: 'trace-abc-123',
        policyVersion: null,
        coreCommittedGate: 'FENCED_STALE_EXECUTION' as unknown as 'APPLIED',
        latency: { trace, now: () => T0 + 4_200 },
      }),
    ).rejects.toThrow();

    // A fenced execution never announced anything, so it has no Fast Path to time.
    expect(trace.snapshot().fast_path_ms).toBeNull();
  });

  it('runs unchanged without a latency context', async () => {
    const result = await publishFastPathReady(publisher(['c1']), {
      core: core(),
      traceId: 'trace-abc-123',
      policyVersion: null,
      coreCommittedGate: 'APPLIED',
    });

    expect(result.delivered).toBe(1);
  });
});
