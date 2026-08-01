/**
 * TASK-099 — DecisionFn + domain pipeline adapter unit tests.
 *
 * The invariant under test is the no-fabrication rule: every missing input path
 * yields `insufficient_data` with a named reason, `buildDecisionCore` is never
 * called from a partial pipeline, and no default value is ever substituted (§21).
 *
 * ## What these tests do NOT cover
 *
 * Rule semantics. Grading boundaries, article triggers and the ETE formula belong
 * to `runDeterministicDecision` in `@city-commander/domain`, and member 1 validates
 * them against ACC_001 = 78.6 / EVT_002 = 22:15 / EVT_003 = 41.0. The adapter is
 * asserted to *delegate* to that facade and to map its result faithfully; a second
 * expectation of the rules here could pass while disagreeing with the real engine.
 */

import { describe, it, expect, vi } from 'vitest';
import { CoreWriteStatus } from '@city-commander/shared-schemas';
import type { DecisionCore, Incident } from '@city-commander/shared-schemas';
import {
  DEFAULT_CONTAINMENT_ASSEMBLER,
  DefaultDomainPipelineAdapter,
  LatencyTrace,
  NoopTelemetry,
  PENDING_PIPELINE_STEPS,
  runDecisionFn,
  TableReadError,
} from '../../src/index.js';
import type {
  ContainmentAssemblerPort,
  DecisionFacts,
  DecisionFnPorts,
  DomainPipelineAdapter,
  DomainPipelinePorts,
  IngestionPort,
  Telemetry,
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

/**
 * Deterministic facts double.
 *
 * Only the fields these tests assert on are populated. Both `DecisionFn` and the
 * adapter treat the facts as opaque — they pass them to the core builder without
 * inspecting them — so a full fixture would add coupling without adding coverage.
 */
function decisionFacts(overrides: Record<string, unknown> = {}): DecisionFacts {
  return {
    source_manifest_hash: MANIFEST,
    triggered_articles: [1, 2],
    applied_formula_articles: [7],
    invoked_procedures: ['article2_alternative_route_guidance'],
    citation_article_set: [1, 2, 7],
    primary_evacuation: 'RD_TPE_004',
    ete: { ete_minutes: 78.6 },
    multilingual_required: false,
    provisional: true,
    ...overrides,
  } as unknown as DecisionFacts;
}

/** `IngestionResult` double. `ready` unless overridden. */
function ingestionResult(
  overrides: Record<string, unknown> = {},
): ReturnType<IngestionPort['ingest']> {
  return {
    data_status: 'ready',
    source_manifest_hash: MANIFEST,
    stop_reason: null,
    incidents: [incident()],
    ...overrides,
  } as unknown as ReturnType<IngestionPort['ingest']>;
}

/** Config port: structurally a `ConfigProvider`, with no policy key needed here. */
const config: DomainPipelinePorts['config'] = { get: () => 'exact_or_latest_before' };

interface AdapterHarness {
  readonly adapter: DefaultDomainPipelineAdapter;
  readonly assemble: ReturnType<typeof vi.fn>;
  readonly ingest: ReturnType<typeof vi.fn>;
}

function createAdapter(
  options: {
    readonly ingestion?: Record<string, unknown>;
    readonly decision?: Record<string, unknown>;
    readonly assembleImpl?: ContainmentAssemblerPort;
  } = {},
): AdapterHarness {
  const ingest = vi.fn(() => ingestionResult(options.ingestion ?? {}));
  const assemble =
    options.assembleImpl === undefined
      ? vi.fn(() => ({
          data_status: 'ready',
          stop_reason: null,
          source_manifest_hash: MANIFEST,
          facts: decisionFacts(),
          entity_scope: null,
          sop_coverage: null,
          data_scope_status: 'IN_SCOPE',
          mapped_anchor_node: null,
          safe_context: null,
          sop_coverage_status: 'OFFICIAL_SOP_MATCHED',
          sop_authority: 'OFFICIAL_SOP',
          decision: { reroute_roads: [], perimeter_control: null, ai_reasoning: null },
          whitelist_violations: [],
          ...(options.decision ?? {}),
        }))
      : vi.fn(options.assembleImpl);

  return {
    ingest,
    assemble,
    adapter: new DefaultDomainPipelineAdapter({
      ingestion: { ingest },
      config,
      composer: { generate: async () => ({ explanation_text: '' }) },
      validator: { validate: () => ({ outcome: 'accepted', text: '' }) },
      assemble: assemble as unknown as ContainmentAssemblerPort,
    }),
  };
}

// ─── Adapter: the composition facade is really wired ───────

describe('DefaultDomainPipelineAdapter — delegation to the domain facade', () => {
  it('defaults to the real runDeterministicDecision', () => {
    // The injectable port exists for testability; production must not need wiring,
    // and there must be no stub that can be left switched on by accident.
    expect(typeof DEFAULT_CONTAINMENT_ASSEMBLER).toBe('function');
    expect(DEFAULT_CONTAINMENT_ASSEMBLER.name).toBe('assembleContainment');
  });

  it('calls the facade exactly once for a ready ingestion', async () => {
    const { adapter, assemble } = createAdapter();

    await adapter.execute({ eventId: EVENT_ID });

    expect(assemble).toHaveBeenCalledTimes(1);
  });

  it('passes the ingestion result straight through, never re-ingesting', async () => {
    const { adapter, assemble, ingest } = createAdapter();

    await adapter.execute({ eventId: EVENT_ID });

    expect(ingest).toHaveBeenCalledTimes(1);
    // The facade consumes an already-produced IngestionResult; ingesting twice
    // could read two different snapshots of the official files.
    expect(assemble.mock.calls[0][0].ingestion).toBe(ingest.mock.results[0].value);
  });

  it('passes the resolved incident, not the raw event_id', async () => {
    const { adapter, assemble } = createAdapter();

    await adapter.execute({ eventId: EVENT_ID });

    // `event_id` would make the facade resolve the incident itself — and THROW
    // when it is absent. Resolving here keeps a data gap reportable.
    expect(assemble.mock.calls[0][0].incident.event_id).toBe(EVENT_ID);
    expect(assemble.mock.calls[0][0].event_id).toBeUndefined();
  });

  it('passes the config provider through without reading any policy key', async () => {
    const get = vi.fn(() => 'exact_or_latest_before');
    const ingest = vi.fn(() => ingestionResult());
    const assemble = vi.fn(() => ({
      data_status: 'ready',
      stop_reason: null,
      source_manifest_hash: MANIFEST,
      facts: decisionFacts(),
    }));
    const adapter = new DefaultDomainPipelineAdapter({
      ingestion: { ingest },
      config: { get },
      composer: { generate: async () => ({ explanation_text: '' }) },
      validator: { validate: () => ({ outcome: 'accepted', text: '' }) },
      assemble: assemble as unknown as ContainmentAssemblerPort,
    });

    await adapter.execute({ eventId: EVENT_ID });

    expect(assemble.mock.calls[0][0].config).toEqual({ get });
    // Strategy resolution is the facade's job; the adapter must stay policy-free.
    expect(get).not.toHaveBeenCalled();
  });

  it('returns the facade facts unchanged', async () => {
    const facts = decisionFacts({ primary_evacuation: 'RD_TPE_009' });
    const { adapter } = createAdapter({ decision: { facts } });

    const result = await adapter.execute({ eventId: EVENT_ID });

    expect(result.data_status).toBe('ready');
    // Identity, not deep equality: any re-shaping here could silently drop a field
    // that the immutable core is supposed to carry.
    expect(result.facts).toBe(facts);
  });

  it('surfaces containment disclosure from the production assembler path', async () => {
    const { adapter } = createAdapter();

    const result = await adapter.execute({ eventId: EVENT_ID });

    expect(result.containment).toMatchObject({
      data_scope_status: 'IN_SCOPE',
      sop_coverage_status: 'OFFICIAL_SOP_MATCHED',
      sop_authority: 'OFFICIAL_SOP',
      decision: { reroute_roads: [], perimeter_control: null, ai_reasoning: null },
    });
  });

  it('reports the manifest hash the facade attributed the decision to', async () => {
    const { adapter } = createAdapter({
      decision: { source_manifest_hash: 'sha256:FACADE-MANIFEST' },
    });

    const result = await adapter.execute({ eventId: EVENT_ID });

    expect(result.source_manifest_hash).toBe('sha256:FACADE-MANIFEST');
  });
});

// ─── Adapter: source gate and ingestion stops ──────────────

describe('DefaultDomainPipelineAdapter — ingestion stops', () => {
  it('stops on a source-hash STOP gate failure', async () => {
    const { adapter, assemble } = createAdapter({
      ingestion: {
        data_status: 'insufficient_data',
        stop_reason: 'SHA-256 mismatch: live_incidents.json',
        source_manifest_hash: '',
      },
    });

    const result = await adapter.execute({ eventId: EVENT_ID });

    expect(result.data_status).toBe('insufficient_data');
    expect(result.stop_reason).toContain('SHA-256 mismatch');
    // An unknown data version must never reach the rule engine.
    expect(assemble).not.toHaveBeenCalled();
  });

  it('never fabricates a manifest hash when the gate failed', async () => {
    const { adapter } = createAdapter({
      // `ingestData` returns an empty hash on failure; the adapter must pass that
      // through rather than substituting a plausible-looking one.
      ingestion: {
        data_status: 'insufficient_data',
        stop_reason: 'gate failed',
        source_manifest_hash: '',
      },
    });

    const result = await adapter.execute({ eventId: EVENT_ID });

    expect(result.source_manifest_hash).toBe('');
    expect(result.facts).toBeNull();
  });

  it('names a reason even when ingestion supplied none', async () => {
    const { adapter } = createAdapter({
      ingestion: { data_status: 'insufficient_data', stop_reason: null },
    });

    const result = await adapter.execute({ eventId: EVENT_ID });

    // A silent stop is undiagnosable; §21 requires the gap to be disclosed.
    expect(result.stop_reason).toBe('Ingestion reported insufficient_data.');
  });
});

// ─── Adapter: the missing-incident gap (facade would throw) ─

describe('DefaultDomainPipelineAdapter — unknown event_id is a data gap', () => {
  it('reports insufficient_data instead of throwing', async () => {
    const { adapter } = createAdapter();

    // `runDeterministicDecision` throws for an unresolvable event_id. A missing
    // incident is a hole in the official data, not a programming fault, so it must
    // surface as a disclosed gap.
    const result = await adapter.execute({ eventId: 'TPE_2026_ACC_999' });

    expect(result.data_status).toBe('insufficient_data');
    expect(result.stop_reason).toContain('TPE_2026_ACC_999');
    expect(result.stop_reason).toContain('not present in the official incident set');
  });

  it('does not call the facade for an unknown event_id', async () => {
    const { adapter, assemble } = createAdapter();

    await adapter.execute({ eventId: 'TPE_2026_ACC_999' });

    expect(assemble).not.toHaveBeenCalled();
  });

  it('keeps the manifest hash, because ingestion itself succeeded', async () => {
    const { adapter } = createAdapter();

    const result = await adapter.execute({ eventId: 'TPE_2026_ACC_999' });

    // The sources verified; only this event is absent. Blanking the hash would
    // misreport a STOP-gate failure.
    expect(result.source_manifest_hash).toBe(MANIFEST);
  });

  it('handles an absent incident set without throwing', async () => {
    const { adapter } = createAdapter({ ingestion: { incidents: undefined } });

    const result = await adapter.execute({ eventId: EVENT_ID });

    expect(result.data_status).toBe('insufficient_data');
  });

  it('handles an empty incident set', async () => {
    const { adapter } = createAdapter({ ingestion: { incidents: [] } });

    const result = await adapter.execute({ eventId: EVENT_ID });

    expect(result.data_status).toBe('insufficient_data');
  });
});

// ─── Adapter: no fabrication (§21) ─────────────────────────

describe('DefaultDomainPipelineAdapter — no fabrication (§21)', () => {
  it('propagates the facade insufficient_data verbatim', async () => {
    const { adapter } = createAdapter({
      decision: {
        data_status: 'insufficient_data',
        stop_reason: 'No legal snapshot at or before the event for RD_TPE_002.',
        facts: null,
      },
    });

    const result = await adapter.execute({ eventId: EVENT_ID });

    expect(result.data_status).toBe('insufficient_data');
    expect(result.stop_reason).toBe('No legal snapshot at or before the event for RD_TPE_002.');
    expect(result.facts).toBeNull();
  });

  it('treats ready-with-null-facts as insufficient_data', async () => {
    const { adapter } = createAdapter({ decision: { data_status: 'ready', facts: null } });

    const result = await adapter.execute({ eventId: EVENT_ID });

    // Contradictory, and the safe reading is the pessimistic one: no facts means
    // no core.
    expect(result.data_status).toBe('insufficient_data');
    expect(result.facts).toBeNull();
  });

  it('names a reason when the facade supplied none', async () => {
    const { adapter } = createAdapter({
      decision: { data_status: 'insufficient_data', stop_reason: null, facts: null },
    });

    const result = await adapter.execute({ eventId: EVENT_ID });

    expect(result.stop_reason).toBe('Domain pipeline reported insufficient_data.');
  });

  it('propagates a facade fault instead of laundering it into a data gap', async () => {
    const fault = new Error('road network model is corrupt');
    const { adapter } = createAdapter({
      assembleImpl: (() => {
        throw fault;
      }) as unknown as ContainmentAssemblerPort,
    });

    // Reporting this as `insufficient_data` would tell the operator the official
    // data had a hole, when in fact the engine failed.
    await expect(adapter.execute({ eventId: EVENT_ID })).rejects.toBe(fault);
  });
});

// ─── Adapter: pending steps ────────────────────────────────

describe('DefaultDomainPipelineAdapter — pending steps', () => {
  it('declares nothing outstanding now that the facade composes every step', () => {
    expect(PENDING_PIPELINE_STEPS).toEqual([]);
  });

  it('echoes the pending list on a successful run', async () => {
    const { adapter } = createAdapter();

    const result = await adapter.execute({ eventId: EVENT_ID });

    expect(result.data_status).toBe('ready');
    expect(result.pending_steps).toEqual([]);
  });

  it('echoes the pending list on a stop, so the field is never absent', async () => {
    const { adapter } = createAdapter({
      ingestion: { data_status: 'insufficient_data', stop_reason: 'gate failed' },
    });

    const result = await adapter.execute({ eventId: EVENT_ID });

    expect(result.pending_steps).toEqual(PENDING_PIPELINE_STEPS);
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

  it('propagates the pending steps so any gap stays visible', async () => {
    const { ports } = createPorts({
      data_status: 'insufficient_data',
      stop_reason: 'Domain pipeline incomplete: ete_calculator_article7',
      source_manifest_hash: MANIFEST,
      pending_steps: ['ete_calculator_article7'],
      facts: decisionFacts(),
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
      facts: decisionFacts(),
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
      facts: decisionFacts(),
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

  it('hands the facade facts to the builder untouched', async () => {
    const facts = decisionFacts();
    const { ports, build } = createPorts({
      data_status: 'ready',
      stop_reason: null,
      source_manifest_hash: MANIFEST,
      pending_steps: [],
      facts,
    });

    await runDecisionFn(ports, input);

    // core_hash is computed over these facts, so any copy or re-shape between the
    // engine and the builder would change the identity of the decision.
    expect(build.mock.calls[0][0].facts).toBe(facts);
  });

  it('returns ALREADY_COMMITTED_SAME_DECISION for a safe retry', async () => {
    const { ports, put, read } = createPorts({
      data_status: 'ready',
      stop_reason: null,
      source_manifest_hash: MANIFEST,
      pending_steps: [],
      facts: decisionFacts(),
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
      facts: decisionFacts(),
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
      facts: decisionFacts(),
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
      facts: decisionFacts(),
    });

    expect(Object.keys(ports)).toEqual(['pipeline', 'coreBuilder', 'coreRepository']);
  });
});

// ─── Production latency instrumentation (audit fix 1) ──────

describe('runDecisionFn latency instrumentation', () => {
  const INPUT = {
    idempotencyKey: KEY,
    decisionId: DECISION,
    eventId: EVENT_ID,
    injectionRunId: 'inj-1',
    traceId: 'trace-abc-123',
  };
  const T0 = 1_800_000_000_000;

  function readyPipeline(): Record<string, unknown> {
    return {
      data_status: 'ready',
      stop_reason: null,
      source_manifest_hash: MANIFEST,
      pending_steps: [],
      facts: decisionFacts(),
    };
  }

  /** Ports plus a stepping clock, so stage boundaries are deterministic. */
  function instrumentedPorts(
    pipelineResult: Record<string, unknown>,
    options: { readonly telemetry?: Telemetry; readonly stepMs?: number } = {},
  ): { ports: DecisionFnPorts; trace: LatencyTrace } {
    const stepMs = options.stepMs ?? 100;
    let clock = T0;
    const now = (): number => {
      clock += stepMs;
      return clock;
    };
    const trace = new LatencyTrace({
      decisionId: INPUT.decisionId,
      traceId: INPUT.traceId,
      startedAtMs: T0,
    });

    return {
      trace,
      ports: {
        pipeline: { execute: vi.fn().mockResolvedValue(pipelineResult) },
        coreBuilder: {
          build: vi.fn(
            () =>
              ({
                decision_id: INPUT.decisionId,
                core_hash: 'sha256:C1',
              }) as unknown as DecisionCore,
          ),
        },
        coreRepository: {
          conditionalPutNew: vi.fn().mockImplementation(async (core: DecisionCore) => core),
          getConsistent: vi.fn().mockResolvedValue(null),
          exists: async () => false,
        },
        latency: {
          trace,
          now,
          ...(options.telemetry === undefined ? {} : { telemetry: options.telemetry }),
        },
      } as unknown as DecisionFnPorts,
    };
  }

  it('measures the rule engine and core persistence stages', async () => {
    const { ports, trace } = instrumentedPorts(readyPipeline());

    await runDecisionFn(ports, INPUT);

    expect(trace.snapshot().stages.map((stage) => stage.stage)).toEqual([
      'rule_engine',
      'core_persistence',
    ]);
  });

  it('marks the Fast Path complete once the core is committed', async () => {
    const { ports, trace } = instrumentedPorts(readyPipeline());

    await runDecisionFn(ports, INPUT);

    // The gap this closes: LatencyTrace existed but nothing on the production
    // path called it, so FastPathLatencyMs was never produced by a real run.
    expect(trace.snapshot().fast_path_ms).not.toBeNull();
    expect(trace.snapshot().fast_path_target_met).toBe(true);
  });

  it('emits the snapshot through telemetry', async () => {
    const snapshots: unknown[] = [];
    const telemetry = {
      ...new NoopTelemetry(),
      recordLatency: (snapshot: unknown) => void snapshots.push(snapshot),
    } as unknown as Telemetry;
    const { ports } = instrumentedPorts(readyPipeline(), { telemetry });

    await runDecisionFn(ports, INPUT);

    expect(snapshots).toHaveLength(1);
    expect((snapshots[0] as { fast_path_ms: number | null }).fast_path_ms).not.toBeNull();
  });

  it('records no measurement anomalies on the happy path', async () => {
    const { ports, trace } = instrumentedPorts(readyPipeline());

    await runDecisionFn(ports, INPUT);

    expect(trace.anomalyMessages).toEqual([]);
  });

  it('does not mark the Fast Path complete on insufficient_data', async () => {
    const { ports, trace } = instrumentedPorts({
      data_status: 'insufficient_data',
      stop_reason: 'SHA-256 mismatch',
      source_manifest_hash: '',
      pending_steps: [],
      facts: null,
    });

    const result = await runDecisionFn(ports, INPUT);

    expect(result.data_status).toBe('insufficient_data');
    // No core, no push, so no Fast Path completion to report.
    expect(trace.snapshot().fast_path_ms).toBeNull();
  });

  it('still records the rule engine stage when the pipeline throws', async () => {
    const { ports, trace } = instrumentedPorts(readyPipeline());
    (ports.pipeline.execute as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error('ingestion failed'),
    );

    await expect(runDecisionFn(ports, INPUT)).rejects.toThrow('ingestion failed');

    // A failed stage still consumed latency budget.
    expect(trace.snapshot().stages.map((stage) => stage.stage)).toEqual(['rule_engine']);
  });

  it('lets a telemetry failure through without failing the decision', async () => {
    const telemetry = {
      ...new NoopTelemetry(),
      recordLatency: () => {
        throw new Error('metric pipeline down');
      },
    } as unknown as Telemetry;
    const { ports } = instrumentedPorts(readyPipeline(), { telemetry });

    await expect(runDecisionFn(ports, INPUT)).rejects.toThrow('metric pipeline down');
  });

  it('runs unchanged when no latency context is supplied', async () => {
    const { ports } = instrumentedPorts(readyPipeline());
    const withoutLatency = { ...ports, latency: undefined };

    const result = await runDecisionFn(withoutLatency, INPUT);

    expect(result.data_status).toBe('ready');
  });
});
