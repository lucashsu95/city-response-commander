/**
 * TASK-099 — DecisionFn + domain pipeline adapter unit tests.
 *
 * The invariant under test is the no-fabrication rule: every missing input path
 * yields `insufficient_data` with a named reason, `buildDecisionCore` is never
 * called from a partial pipeline, and no default value is ever substituted (§21).
 */

import { describe, it, expect, vi } from 'vitest';
import { CoreWriteStatus } from '@city-commander/shared-schemas';
import type { DecisionCore, Incident, SegmentClassification } from '@city-commander/shared-schemas';
import {
  DefaultDomainPipelineAdapter,
  PENDING_PIPELINE_STEPS,
  runDecisionFn,
  TableReadError,
} from '../../src/index.js';
import type {
  DecisionFnPorts,
  DomainPipelineAdapter,
  DomainPipelinePorts,
  PartialDecisionFacts,
} from '../../src/index.js';

const EVENT_ID = 'TPE_2026_ACC_001';
const DECISION = 'DEC_TPE_2026_ACC_001_abcdef123456';
const KEY = 'TPE_2026_ACC_001|2026-05-20 22:10|prov-2026a';
const MANIFEST = 'sha256:MANIFEST';

function incident(overrides: Partial<Incident> = {}): Incident {
  return {
    event_id: EVENT_ID,
    type: 'Road_Collapse_Accident',
    location: '光復南路與忠孝東路口南側',
    affected_segment: 'RD_TPE_002',
    status: 'Closed',
    severity: 'Critical',
    description: '路面塌陷',
    timestamp: '2026-05-20 22:10',
    ...overrides,
  } as unknown as Incident;
}

/** Two segments, two timestamps each: one at the event, one an hour before. */
function trafficRows(): { Segment_ID: string; Saturation_Score: number; timestamp_raw: string }[] {
  return [
    { Segment_ID: 'RD_TPE_002', Saturation_Score: 0.62, timestamp_raw: '2026-05-20 21:10' },
    { Segment_ID: 'RD_TPE_002', Saturation_Score: 0.97, timestamp_raw: '2026-05-20 22:10' },
    { Segment_ID: 'RD_TPE_004', Saturation_Score: 0.55, timestamp_raw: '2026-05-20 21:10' },
    { Segment_ID: 'RD_TPE_004', Saturation_Score: 0.88, timestamp_raw: '2026-05-20 22:10' },
  ];
}

function timestampsFor(
  rows: readonly { timestamp_raw: string }[],
): { timestamp_normalized: Date }[] {
  return rows.map((row) => {
    const [date, time] = row.timestamp_raw.split(' ');
    const [year, month, day] = date.split('-').map(Number);
    const [hour, minute] = time.split(':').map(Number);
    return { timestamp_normalized: new Date(year, month - 1, day, hour, minute) };
  });
}

/** Real Strategy A behaviour: latest row at or before the event, per entity. */
const realSnapshots: DomainPipelinePorts['snapshots'] = {
  select(_entityId, eventTimestamp, records) {
    const eventMs = eventTimestamp.getTime();
    let best: (typeof records)[number] | null = null;
    let bestMs = -Infinity;
    for (const record of records) {
      const ms = record.timestamp_normalized.getTime();
      if (ms <= eventMs && ms > bestMs) {
        best = record;
        bestMs = ms;
      }
    }
    if (best === null) {
      return {
        record: null,
        exact_match: false,
        staleness_minutes: Infinity,
        data_status: 'insufficient_data',
      };
    }
    return {
      record: best,
      exact_match: bestMs === eventMs,
      staleness_minutes: Math.round((eventMs - bestMs) / 60_000),
      data_status: 'ready',
    };
  },
};

function createRuleEngine(): DomainPipelinePorts['ruleEngine'] & {
  classify: ReturnType<typeof vi.fn>;
} {
  const classify = vi.fn(
    (
      snapshots: readonly { segment_id: string; saturation_score: number | null }[],
    ): readonly SegmentClassification[] =>
      snapshots.map(({ segment_id, saturation_score }) => ({
        segment_id,
        level:
          saturation_score === null
            ? null
            : saturation_score >= 0.95
              ? 'A'
              : saturation_score >= 0.85
                ? 'B'
                : null,
      })),
  );

  return {
    classify,
    classifySegments: classify,
    evaluateArticle1: (classifications) => ({
      triggered: classifications.some((c) => c.level !== null),
      invoked_procedures: classifications.some((c) => c.level === 'A')
        ? ['article2_alternative_route_guidance']
        : [],
    }),
    isArticle2Triggered: () => true,
    aggregateArticles: (input) => {
      const triggered = input.evaluations.filter((e) => e.triggered).map((e) => e.article);
      const invoked = input.evaluations.flatMap((e) => e.invoked_procedures ?? []);
      return {
        triggered_articles: triggered,
        applied_formula_articles: input.applied_formula_articles,
        invoked_procedures: invoked,
        citation_article_set: [...new Set([...triggered, ...input.applied_formula_articles])],
      };
    },
  } as unknown as DomainPipelinePorts['ruleEngine'] & { classify: ReturnType<typeof vi.fn> };
}

function createIngestion(
  overrides: Partial<ReturnType<DomainPipelinePorts['ingestion']['ingest']>> = {},
): DomainPipelinePorts['ingestion'] {
  const rows = trafficRows();
  return {
    ingest: () => ({
      data_status: 'ready',
      source_manifest_hash: MANIFEST,
      stop_reason: null,
      traffic: rows,
      trafficTimestamps: timestampsFor(rows),
      incidents: [incident()],
      ...overrides,
    }),
  } as unknown as DomainPipelinePorts['ingestion'];
}

function createAdapter(
  ingestion = createIngestion(),
  ruleEngine = createRuleEngine(),
): { adapter: DefaultDomainPipelineAdapter; ruleEngine: ReturnType<typeof createRuleEngine> } {
  return {
    adapter: new DefaultDomainPipelineAdapter({
      ingestion,
      snapshots: realSnapshots,
      ruleEngine,
    }),
    ruleEngine,
  };
}

// ─── Adapter: source gate and ingestion stops ──────────────

describe('DefaultDomainPipelineAdapter — ingestion stops', () => {
  it('stops when the source-hash gate fails, with the gate reason', async () => {
    const { adapter } = createAdapter(
      createIngestion({
        data_status: 'insufficient_data',
        source_manifest_hash: '',
        stop_reason: 'SHA-256 mismatch: city_traffic_flow.csv',
        traffic: undefined,
        trafficTimestamps: undefined,
        incidents: undefined,
      }),
    );

    const result = await adapter.execute({ eventId: EVENT_ID });

    expect(result.data_status).toBe('insufficient_data');
    expect(result.stop_reason).toContain('SHA-256 mismatch');
    expect(result.facts).toBeNull();
  });

  it('does not run the rule engine when ingestion stopped', async () => {
    const ruleEngine = createRuleEngine();
    const { adapter } = createAdapter(
      createIngestion({
        data_status: 'insufficient_data',
        stop_reason: 'gate failed',
        traffic: undefined,
        trafficTimestamps: undefined,
        incidents: undefined,
      }),
      ruleEngine,
    );

    await adapter.execute({ eventId: EVENT_ID });

    expect(ruleEngine.classify).not.toHaveBeenCalled();
  });

  it('stops when ingestion claims ready but exposes no datasets', async () => {
    const { adapter } = createAdapter(
      createIngestion({ traffic: undefined, trafficTimestamps: undefined, incidents: undefined }),
    );

    const result = await adapter.execute({ eventId: EVENT_ID });

    expect(result.stop_reason).toContain('did not expose traffic/incident datasets');
  });

  it('stops when rows and normalized timestamps are misaligned (never pairs by guess)', async () => {
    const rows = trafficRows();
    const { adapter } = createAdapter(
      createIngestion({ traffic: rows, trafficTimestamps: timestampsFor(rows).slice(0, 2) }),
    );

    const result = await adapter.execute({ eventId: EVENT_ID });

    expect(result.stop_reason).toContain('misaligned');
  });

  it('stops when the requested event is not an official incident', async () => {
    const { adapter } = createAdapter();

    const result = await adapter.execute({ eventId: 'NOT_AN_OFFICIAL_EVENT' });

    expect(result.stop_reason).toContain('not present in the official incident set');
  });

  it('stops when the incident timestamp cannot be resolved to an instant', async () => {
    const { adapter } = createAdapter(
      createIngestion({ incidents: [incident({ timestamp: 'not-a-timestamp' })] }),
    );

    const result = await adapter.execute({ eventId: EVENT_ID });

    expect(result.stop_reason).toContain('could not be resolved to an instant');
  });
});

// ─── Adapter: no fabrication ───────────────────────────────

describe('DefaultDomainPipelineAdapter — no fabrication (§21)', () => {
  it('grades every segment present in the official data, not a hard-coded list', async () => {
    const { adapter, ruleEngine } = createAdapter();

    const result = await adapter.execute({ eventId: EVENT_ID });

    expect(result.facts?.classifications.map((c) => c.segment_id)).toEqual([
      'RD_TPE_002',
      'RD_TPE_004',
    ]);
    expect(ruleEngine.classify).toHaveBeenCalledTimes(1);
  });

  it('uses the row at or before the event, never a post-event row', async () => {
    const { adapter } = createAdapter();

    const result = await adapter.execute({ eventId: EVENT_ID });

    // 22:10 rows are 0.97 (A) and 0.88 (B); the 21:10 rows would grade differently.
    expect(result.facts?.classifications).toEqual([
      { segment_id: 'RD_TPE_002', level: 'A' },
      { segment_id: 'RD_TPE_004', level: 'B' },
    ]);
    expect(result.facts?.segment_alignment.every((a) => a.exact_match)).toBe(true);
  });

  it('passes null saturation — not a default — when no legal row exists', async () => {
    const rows = [
      // Only a post-event row: Strategy A must refuse it.
      { Segment_ID: 'RD_TPE_009', Saturation_Score: 0.99, timestamp_raw: '2026-05-20 23:10' },
    ];
    const { adapter, ruleEngine } = createAdapter(
      createIngestion({ traffic: rows, trafficTimestamps: timestampsFor(rows) }),
    );

    const result = await adapter.execute({ eventId: EVENT_ID });

    const snapshots = ruleEngine.classify.mock.calls[0][0] as readonly {
      segment_id: string;
      saturation_score: number | null;
    }[];
    expect(snapshots).toEqual([{ segment_id: 'RD_TPE_009', saturation_score: null }]);
    // No default was substituted, so the segment carries no level.
    expect(result.facts?.classifications).toEqual([{ segment_id: 'RD_TPE_009', level: null }]);
  });

  it('reports per-segment alignment diagnostics for disclosure', async () => {
    const rows = [
      { Segment_ID: 'RD_TPE_002', Saturation_Score: 0.62, timestamp_raw: '2026-05-20 21:10' },
    ];
    const { adapter } = createAdapter(
      createIngestion({ traffic: rows, trafficTimestamps: timestampsFor(rows) }),
    );

    const result = await adapter.execute({ eventId: EVENT_ID });

    expect(result.facts?.segment_alignment[0]).toMatchObject({
      segment_id: 'RD_TPE_002',
      data_status: 'ready',
      exact_match: false,
      staleness_minutes: 60,
      selected_timestamp_raw: '2026-05-20 21:10',
    });
  });

  it('never places art.7 in triggered_articles (it is an applied formula, §9.5)', async () => {
    const { adapter } = createAdapter();

    const result = await adapter.execute({ eventId: EVENT_ID });

    expect(result.facts?.triggered_articles).not.toContain(7);
  });

  it('omits art.7 from applied_formula_articles while the ETE step is unwired', async () => {
    const { adapter } = createAdapter();

    const result = await adapter.execute({ eventId: EVENT_ID });

    // Asserting art.7 applied without computing an ETE would be a fabrication.
    expect(result.facts?.applied_formula_articles).toEqual([]);
  });
});

// ─── Adapter: pending steps ────────────────────────────────

describe('DefaultDomainPipelineAdapter — unwired steps are disclosed', () => {
  it('reports insufficient_data while any domain step is unwired', async () => {
    const { adapter } = createAdapter();

    const result = await adapter.execute({ eventId: EVENT_ID });

    expect(result.data_status).toBe('insufficient_data');
    expect(result.pending_steps).toEqual(PENDING_PIPELINE_STEPS);
    expect(result.stop_reason).toContain('Domain pipeline incomplete');
  });

  it('names the specific unwired steps (ETE, evacuation, evidence)', async () => {
    const { adapter } = createAdapter();

    const result = await adapter.execute({ eventId: EVENT_ID });

    expect(result.stop_reason).toContain('ete_calculator_article7');
    expect(result.stop_reason).toContain('evacuation_selector');
    expect(result.stop_reason).toContain('evidence_trace_builder');
  });

  it('still returns the facts it did compute, for disclosure', async () => {
    const { adapter } = createAdapter();

    const result = await adapter.execute({ eventId: EVENT_ID });

    expect(result.facts).not.toBeNull();
    expect(result.facts?.incident.event_id).toBe(EVENT_ID);
    expect(result.source_manifest_hash).toBe(MANIFEST);
  });
});

// ─── DecisionFn ────────────────────────────────────────────

describe('runDecisionFn', () => {
  const input = {
    idempotencyKey: KEY,
    decisionId: DECISION,
    eventId: EVENT_ID,
    injectionRunId: 'inj-1',
    workflowExecutionName: 'exec-name-1',
    traceId: 'trace-1',
  };

  function facts(): PartialDecisionFacts {
    return {
      incident: incident(),
      classifications: [{ segment_id: 'RD_TPE_002', level: 'A' }],
      triggered_articles: [1, 2],
      applied_formula_articles: [7],
      invoked_procedures: ['article2_alternative_route_guidance'],
      citation_article_set: [1, 2, 7],
      segment_alignment: [],
    };
  }

  function createPorts(pipelineResult: Awaited<ReturnType<DomainPipelineAdapter['execute']>>): {
    ports: DecisionFnPorts;
    build: ReturnType<typeof vi.fn>;
    put: ReturnType<typeof vi.fn>;
    read: ReturnType<typeof vi.fn>;
  } {
    const build = vi.fn(
      () => ({ decision_id: DECISION, core_hash: 'sha256:CORE-1' }) as unknown as DecisionCore,
    );
    const put = vi.fn().mockImplementation(async (core: DecisionCore) => core);
    const read = vi.fn().mockResolvedValue(null);

    return {
      build,
      put,
      read,
      ports: {
        pipeline: { execute: vi.fn().mockResolvedValue(pipelineResult) },
        coreBuilder: { build },
        coreRepository: {
          conditionalPutNew: put,
          getConsistent: read,
          exists: async () => false,
        },
      } as unknown as DecisionFnPorts,
    };
  }

  it('returns insufficient_data verbatim and never builds a core', async () => {
    const { ports, build, put } = createPorts({
      data_status: 'insufficient_data',
      stop_reason: 'SHA-256 mismatch: live_incidents.json',
      source_manifest_hash: '',
      pending_steps: PENDING_PIPELINE_STEPS,
      facts: null,
    });

    const result = await runDecisionFn(ports, input);

    expect(result.data_status).toBe('insufficient_data');
    if (result.data_status !== 'insufficient_data') throw new Error('unreachable');
    expect(result.stop_reason).toContain('SHA-256 mismatch');
    // The two writes that must not happen.
    expect(build).not.toHaveBeenCalled();
    expect(put).not.toHaveBeenCalled();
  });

  it('propagates the pending steps so the gap is visible', async () => {
    const { ports } = createPorts({
      data_status: 'insufficient_data',
      stop_reason: 'Domain pipeline incomplete: ete_calculator_article7',
      source_manifest_hash: MANIFEST,
      pending_steps: ['ete_calculator_article7'],
      facts: facts(),
    });

    const result = await runDecisionFn(ports, input);

    if (result.data_status !== 'insufficient_data') throw new Error('unreachable');
    expect(result.pending_steps).toEqual(['ete_calculator_article7']);
    // Facts computed before the stop are still disclosed.
    expect(result.facts?.triggered_articles).toEqual([1, 2]);
  });

  it('refuses to build a core when facts are null even if status says ready', async () => {
    const { ports, build } = createPorts({
      data_status: 'ready',
      stop_reason: null,
      source_manifest_hash: MANIFEST,
      pending_steps: [],
      facts: null,
    });

    const result = await runDecisionFn(ports, input);

    expect(result.data_status).toBe('insufficient_data');
    expect(build).not.toHaveBeenCalled();
  });

  it('builds and persists the core when the pipeline is complete', async () => {
    const { ports, build, put } = createPorts({
      data_status: 'ready',
      stop_reason: null,
      source_manifest_hash: MANIFEST,
      pending_steps: [],
      facts: facts(),
    });

    const result = await runDecisionFn(ports, input);

    expect(result.data_status).toBe('ready');
    if (result.data_status !== 'ready') throw new Error('unreachable');
    expect(result.core_write_status).toBe(CoreWriteStatus.COMMITTED);
    expect(build).toHaveBeenCalledTimes(1);
    expect(put).toHaveBeenCalledTimes(1);
  });

  it('passes the execution metadata and manifest hash to the builder', async () => {
    const { ports, build } = createPorts({
      data_status: 'ready',
      stop_reason: null,
      source_manifest_hash: MANIFEST,
      pending_steps: [],
      facts: facts(),
    });

    await runDecisionFn(ports, input);

    expect(build.mock.calls[0][0]).toMatchObject({
      decisionId: DECISION,
      idempotencyKey: KEY,
      injectionRunId: 'inj-1',
      workflowExecutionName: 'exec-name-1',
      sourceManifestHash: MANIFEST,
    });
  });

  it('returns ALREADY_COMMITTED_SAME_DECISION for a safe retry', async () => {
    const { ports, put, read } = createPorts({
      data_status: 'ready',
      stop_reason: null,
      source_manifest_hash: MANIFEST,
      pending_steps: [],
      facts: facts(),
    });
    const { DecisionCoreAlreadyExistsError } = await import('../../src/index.js');
    put.mockRejectedValue(new DecisionCoreAlreadyExistsError(DECISION));
    read.mockResolvedValue({ decision_id: DECISION, core_hash: 'sha256:CORE-1' } as DecisionCore);

    const result = await runDecisionFn(ports, input);

    if (result.data_status !== 'ready') throw new Error('unreachable');
    expect(result.core_write_status).toBe(CoreWriteStatus.ALREADY_COMMITTED_SAME_DECISION);
  });

  it('surfaces CORE_IDENTITY_CONFLICT to the Choice Gate', async () => {
    const { ports, put, read } = createPorts({
      data_status: 'ready',
      stop_reason: null,
      source_manifest_hash: MANIFEST,
      pending_steps: [],
      facts: facts(),
    });
    const { DecisionCoreAlreadyExistsError } = await import('../../src/index.js');
    put.mockRejectedValue(new DecisionCoreAlreadyExistsError(DECISION));
    read.mockResolvedValue({ decision_id: DECISION, core_hash: 'sha256:OTHER' } as DecisionCore);

    const result = await runDecisionFn(ports, input);

    if (result.data_status !== 'ready') throw new Error('unreachable');
    expect(result.core_write_status).toBe(CoreWriteStatus.CORE_IDENTITY_CONFLICT);
  });

  it('propagates a DynamoDB fault rather than reporting insufficient_data', async () => {
    const { ports, put } = createPorts({
      data_status: 'ready',
      stop_reason: null,
      source_manifest_hash: MANIFEST,
      pending_steps: [],
      facts: facts(),
    });
    const failure = new TableReadError('throttled', 'DecisionCoreTable', 'GetItem', DECISION);
    put.mockRejectedValue(failure);

    await expect(runDecisionFn(ports, input)).rejects.toBe(failure);
  });

  it('exposes no IdempotencyTable writer (FIX 2)', async () => {
    const { ports } = createPorts({
      data_status: 'ready',
      stop_reason: null,
      source_manifest_hash: MANIFEST,
      pending_steps: [],
      facts: facts(),
    });

    expect(Object.keys(ports)).toEqual(['pipeline', 'coreBuilder', 'coreRepository']);
  });
});
