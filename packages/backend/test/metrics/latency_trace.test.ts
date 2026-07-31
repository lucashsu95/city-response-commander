/**
 * TASK-104 — LatencyTrace unit tests.
 *
 * Time is injected, so nothing sleeps. Verifies the two thresholds are measured
 * SEPARATELY (5s Fast Path TEAM_TARGET vs 60s end-to-end OFFICIAL), boundary
 * behaviour at exactly the threshold, and the CloudWatch-friendly log shape.
 */

import { describe, it, expect } from 'vitest';
import {
  LatencyTrace,
  LatencyTraceUsageError,
  FAST_PATH_TARGET_MS,
  OFFICIAL_DEADLINE_MS,
} from '../../src/index.js';

const DECISION = 'DEC_TPE_2026_ACC_001_abcdef123456';
const TRACE = 'trace-abc-123';
const T0 = 1_800_000_000_000;

function newTrace(startedAtMs = T0): LatencyTrace {
  return new LatencyTrace({ decisionId: DECISION, traceId: TRACE, startedAtMs });
}

describe('thresholds', () => {
  it('uses 5s for the Fast Path team target', () => {
    expect(FAST_PATH_TARGET_MS).toBe(5_000);
  });

  it('uses 60s for the official end-to-end deadline', () => {
    expect(OFFICIAL_DEADLINE_MS).toBe(60_000);
  });

  it('carries both thresholds in the snapshot so a consumer cannot drift', () => {
    const snapshot = newTrace().snapshot();

    expect(snapshot.fast_path_target_ms).toBe(5_000);
    expect(snapshot.official_deadline_ms).toBe(60_000);
  });
});

describe('stage measurement', () => {
  it('records a stage duration', () => {
    const trace = newTrace();

    trace.begin('rule_engine', T0 + 100);
    const measurement = trace.end('rule_engine', T0 + 450);

    expect(measurement).toEqual({
      stage: 'rule_engine',
      started_at: T0 + 100,
      ended_at: T0 + 450,
      duration_ms: 350,
    });
  });

  it('records stages in completion order', () => {
    const trace = newTrace();

    trace.begin('ingestion', T0);
    trace.end('ingestion', T0 + 50);
    trace.begin('rule_engine', T0 + 50);
    trace.end('rule_engine', T0 + 200);

    expect(trace.snapshot().stages.map((s) => s.stage)).toEqual(['ingestion', 'rule_engine']);
  });

  it('rejects ending a stage that was never started', () => {
    const trace = newTrace();

    expect(() => trace.end('rule_engine', T0)).toThrow(LatencyTraceUsageError);
  });

  it('rejects opening the same stage twice', () => {
    const trace = newTrace();
    trace.begin('rule_engine', T0);

    expect(() => trace.begin('rule_engine', T0 + 10)).toThrow(LatencyTraceUsageError);
  });

  it('exposes stages left open so they are not silently dropped', () => {
    const trace = newTrace();
    trace.begin('enrichment', T0);

    expect(trace.openStages).toEqual(['enrichment']);
  });

  it('rejects a non-finite start time', () => {
    expect(
      () => new LatencyTrace({ decisionId: DECISION, traceId: TRACE, startedAtMs: Number.NaN }),
    ).toThrow(LatencyTraceUsageError);
  });
});

describe('measure()', () => {
  it('times a successful block', async () => {
    const trace = newTrace();
    let clock = T0;
    const now = (): number => clock;

    const result = await trace.measure('core_persistence', now, async () => {
      clock += 120;
      return 'ok';
    });

    expect(result).toBe('ok');
    expect(trace.snapshot().stages[0]).toMatchObject({
      stage: 'core_persistence',
      duration_ms: 120,
    });
  });

  it('still records the stage when the block throws (it consumed budget)', async () => {
    const trace = newTrace();
    let clock = T0;
    const now = (): number => clock;

    await expect(
      trace.measure('enrichment', now, async () => {
        clock += 400;
        throw new Error('bedrock timeout');
      }),
    ).rejects.toThrow('bedrock timeout');

    expect(trace.snapshot().stages[0]).toMatchObject({ stage: 'enrichment', duration_ms: 400 });
    expect(trace.openStages).toEqual([]);
  });
});

describe('fast path measurement (TEAM_TARGET)', () => {
  it('is null before the Fast Path completes', () => {
    const snapshot = newTrace().snapshot();

    expect(snapshot.fast_path_ms).toBeNull();
    expect(snapshot.fast_path_target_met).toBeNull();
  });

  it('measures from detection to the fast_path_ready push', () => {
    const trace = newTrace();

    trace.markFastPathReady(T0 + 3_200);

    expect(trace.snapshot().fast_path_ms).toBe(3_200);
  });

  it('meets the target under 5s', () => {
    const trace = newTrace();
    trace.markFastPathReady(T0 + 4_999);

    expect(trace.snapshot().fast_path_target_met).toBe(true);
  });

  it('meets the target exactly at 5s (inclusive)', () => {
    const trace = newTrace();
    trace.markFastPathReady(T0 + 5_000);

    expect(trace.snapshot().fast_path_target_met).toBe(true);
  });

  it('misses the target above 5s', () => {
    const trace = newTrace();
    trace.markFastPathReady(T0 + 5_001);

    expect(trace.snapshot().fast_path_target_met).toBe(false);
  });
});

describe('end-to-end measurement (OFFICIAL)', () => {
  it('is null before enrichment completes', () => {
    const trace = newTrace();
    trace.markFastPathReady(T0 + 3_000);

    expect(trace.snapshot().end_to_end_ms).toBeNull();
    expect(trace.snapshot().official_deadline_met).toBeNull();
  });

  it('measures from detection to the enriched push', () => {
    const trace = newTrace();
    trace.markEnriched(T0 + 42_000);

    expect(trace.snapshot().end_to_end_ms).toBe(42_000);
  });

  it('meets the deadline exactly at 60s (inclusive)', () => {
    const trace = newTrace();
    trace.markEnriched(T0 + 60_000);

    expect(trace.snapshot().official_deadline_met).toBe(true);
  });

  it('misses the deadline above 60s', () => {
    const trace = newTrace();
    trace.markEnriched(T0 + 60_001);

    expect(trace.snapshot().official_deadline_met).toBe(false);
  });

  it('keeps the two budgets independent: Fast Path can pass while end-to-end fails', () => {
    const trace = newTrace();
    // Bedrock hung for a minute; the deterministic Fast Path still landed in 3s.
    trace.markFastPathReady(T0 + 3_000);
    trace.markEnriched(T0 + 70_000);

    const snapshot = trace.snapshot();
    expect(snapshot.fast_path_target_met).toBe(true);
    expect(snapshot.official_deadline_met).toBe(false);
  });
});

describe('toLogRecord (CloudWatch Insights)', () => {
  it('tags the record type for querying', () => {
    expect(newTrace().toLogRecord().log_type).toBe('latency_trace');
  });

  it('flattens stage durations for aggregation queries', () => {
    const trace = newTrace();
    trace.begin('ingestion', T0);
    trace.end('ingestion', T0 + 40);
    trace.begin('rule_engine', T0 + 40);
    trace.end('rule_engine', T0 + 240);

    expect(trace.toLogRecord().stage_durations_ms).toEqual({
      ingestion: 40,
      rule_engine: 200,
    });
  });

  it('sums a repeated stage instead of overwriting it', () => {
    const trace = newTrace();
    trace.begin('enrichment', T0);
    trace.end('enrichment', T0 + 100);
    trace.begin('enrichment', T0 + 100);
    trace.end('enrichment', T0 + 350);

    expect(trace.toLogRecord().stage_durations_ms.enrichment).toBe(350);
  });

  it('carries the correlation ids and both budgets', () => {
    const trace = newTrace();
    trace.markFastPathReady(T0 + 2_000);
    trace.markEnriched(T0 + 30_000);

    expect(trace.toLogRecord()).toMatchObject({
      decision_id: DECISION,
      trace_id: TRACE,
      fast_path_ms: 2_000,
      end_to_end_ms: 30_000,
      fast_path_target_met: true,
      official_deadline_met: true,
    });
  });
});
