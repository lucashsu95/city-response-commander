/**
 * TASK-119 — `decision.enriched` WebSocket push unit tests.
 *
 * Verifies the completeness gate (all three narrative types required), the
 * `ready_event_id` dedup key (shared with the EXPLANATION composer), and that
 * a delivery failure never throws (§13, §16.4).
 */

import { describe, it, expect, vi } from 'vitest';
import { NarrativeType } from '@city-commander/shared-schemas';
import { buildReadyEventId } from '@city-commander/rag';
import {
  buildDecisionEnrichedEvent,
  isNarrativeSetComplete,
  missingNarrativeTypes,
  publishDecisionEnriched,
  NarrativeSetNotCompleteError,
} from '../../src/realtime/decision_enriched.js';
import type { ConnectionPublisherPort } from '../../src/events/publish_fast_path_ready.js';
import type { Telemetry } from '../../src/metrics/telemetry_facade.js';

const DECISION = 'DEC_TPE_2026_ACC_001';
const TRACE = 'trace-abc-123';

const ALL_THREE: readonly NarrativeType[] = [
  NarrativeType.REPORT,
  NarrativeType.PUBLIC_ALERT,
  NarrativeType.EXPLANATION,
];

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

const baseInput = {
  decisionId: DECISION,
  coreVersionRef: 1,
  traceId: TRACE,
  policyVersion: 'prov-2026a',
  occurredAt: '2026-05-20 22:10',
  provisional: false,
} as const;

// ─── Completeness ──────────────────────────────────────────────────────────

describe('isNarrativeSetComplete / missingNarrativeTypes', () => {
  it('false / non-empty when EXPLANATION is missing', () => {
    const existing = [NarrativeType.REPORT, NarrativeType.PUBLIC_ALERT];
    expect(isNarrativeSetComplete(existing)).toBe(false);
    expect(missingNarrativeTypes(existing)).toEqual([NarrativeType.EXPLANATION]);
  });

  it('true / empty when all three are present, regardless of order', () => {
    const existing = [NarrativeType.EXPLANATION, NarrativeType.REPORT, NarrativeType.PUBLIC_ALERT];
    expect(isNarrativeSetComplete(existing)).toBe(true);
    expect(missingNarrativeTypes(existing)).toEqual([]);
  });

  it('false when the narrative set is empty', () => {
    expect(isNarrativeSetComplete([])).toBe(false);
  });
});

// ─── Event payload ─────────────────────────────────────────────────────────

describe('buildDecisionEnrichedEvent', () => {
  it('reuses the EXPLANATION composer dedup key format', () => {
    const event = buildDecisionEnrichedEvent(baseInput);
    expect(event.ready_event_id).toBe(
      buildReadyEventId(DECISION, NarrativeType.EXPLANATION, 1),
    );
    expect(event.ready_event_id).toBe(`${DECISION}|decision.enriched|1`);
    expect(event.event_type).toBe('decision.enriched');
    expect(event.decision_id).toBe(DECISION);
  });

  it('changes ready_event_id with core_version_ref so a re-decision is not deduped away', () => {
    const v1 = buildDecisionEnrichedEvent(baseInput).ready_event_id;
    const v2 = buildDecisionEnrichedEvent({ ...baseInput, coreVersionRef: 2 }).ready_event_id;
    expect(v1).not.toBe(v2);
  });
});

// ─── publishDecisionEnriched ───────────────────────────────────────────────

describe('publishDecisionEnriched', () => {
  it('throws NarrativeSetNotCompleteError when a narrative type is missing', async () => {
    const publisher = createPublisher();
    await expect(
      publishDecisionEnriched(publisher, {
        ...baseInput,
        existingNarrativeTypes: [NarrativeType.REPORT, NarrativeType.PUBLIC_ALERT],
      }),
    ).rejects.toThrow(NarrativeSetNotCompleteError);
    expect(publisher.list).not.toHaveBeenCalled();
  });

  it('broadcasts to every connection once all three are present', async () => {
    const publisher = createPublisher(['conn-1', 'conn-2']);
    const result = await publishDecisionEnriched(publisher, {
      ...baseInput,
      existingNarrativeTypes: ALL_THREE,
    });
    expect(result.delivered).toBe(2);
    expect(publisher.post).toHaveBeenCalledTimes(2);
    expect(result.event.event_type).toBe('decision.enriched');
  });

  it('a delivery failure does not throw and is reported in failures/staleConnectionIds', async () => {
    const publisher = createPublisher(['conn-1', 'conn-2']);
    publisher.post.mockImplementationOnce(() => Promise.reject(goneError()));
    const result = await publishDecisionEnriched(publisher, {
      ...baseInput,
      existingNarrativeTypes: ALL_THREE,
    });
    expect(result.delivered).toBe(1);
    expect(result.staleConnectionIds).toEqual(['conn-1']);
    expect(result.failures).toHaveLength(1);
  });

  it('order of existingNarrativeTypes does not matter', async () => {
    const publisher = createPublisher([]);
    await expect(
      publishDecisionEnriched(publisher, {
        ...baseInput,
        existingNarrativeTypes: [...ALL_THREE].reverse(),
      }),
    ).resolves.not.toThrow();
  });
});

// ─── Latency instrumentation (TASK-170) ────────────────────────────────────

describe('publishDecisionEnriched — latency instrumentation', () => {
  it('marks EndToEndLatencyMs from occurredAt, unconditionally, after the fan-out', async () => {
    const publisher = createPublisher(['conn-1']);
    const recordLatency = vi.fn();
    const occurredAtMs = Date.parse(baseInput.occurredAt);
    const now = vi.fn().mockReturnValue(occurredAtMs + 12_000);

    await publishDecisionEnriched(publisher, {
      ...baseInput,
      existingNarrativeTypes: ALL_THREE,
      latency: { now, telemetry: { recordLatency } as unknown as Telemetry },
    });

    expect(recordLatency).toHaveBeenCalledTimes(1);
    const trace = recordLatency.mock.calls[0]?.[0] as { snapshot(): { end_to_end_ms: number | null } };
    expect(trace.snapshot().end_to_end_ms).toBe(12_000);
  });

  it('still marks latency when zero connections are live (not gated on delivered > 0)', async () => {
    const publisher = createPublisher([]);
    const recordLatency = vi.fn();
    const now = vi.fn().mockReturnValue(Date.parse(baseInput.occurredAt) + 5_000);

    await publishDecisionEnriched(publisher, {
      ...baseInput,
      existingNarrativeTypes: ALL_THREE,
      latency: { now, telemetry: { recordLatency } as unknown as Telemetry },
    });

    expect(recordLatency).toHaveBeenCalledTimes(1);
  });

  it('does not throw when occurredAt is unparseable', async () => {
    const publisher = createPublisher(['conn-1']);
    const recordLatency = vi.fn();
    const now = vi.fn().mockReturnValue(0);

    await expect(
      publishDecisionEnriched(publisher, {
        ...baseInput,
        occurredAt: 'not-a-date',
        existingNarrativeTypes: ALL_THREE,
        latency: { now, telemetry: { recordLatency } as unknown as Telemetry },
      }),
    ).resolves.not.toThrow();
    expect(recordLatency).not.toHaveBeenCalled();
  });

  it('never throws before the completeness check even when latency is present', async () => {
    const publisher = createPublisher();
    const recordLatency = vi.fn();
    await expect(
      publishDecisionEnriched(publisher, {
        ...baseInput,
        existingNarrativeTypes: [NarrativeType.REPORT],
        latency: { now: () => 0, telemetry: { recordLatency } as unknown as Telemetry },
      }),
    ).rejects.toThrow(NarrativeSetNotCompleteError);
    expect(recordLatency).not.toHaveBeenCalled();
  });
});
