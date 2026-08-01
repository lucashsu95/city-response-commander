/**
 * TASK-118 — ENRICHMENT_ONLY recovery unit tests.
 *
 * Verifies: only the gate's `missing_narrative_types` are re-rendered, the
 * core-missing / wrong-mode guards, that `decision.enriched` is only emitted
 * once a fresh strongly-consistent read confirms all three narrative items
 * are present, and that DecisionCore is never mutated.
 */

import { describe, it, expect, vi } from 'vitest';
import { NarrativeType, RecoveryMode } from '@city-commander/shared-schemas';
import type { DecisionCore, DecisionNarrative } from '@city-commander/shared-schemas';
import type { NarrativeTableClient, NarrativeItem, BedrockInvoker, BedrockResult } from '@city-commander/rag';
import {
  recoverMissingNarratives,
  EnrichmentRecoveryCoreMissingError,
  EnrichmentRecoveryWrongModeError,
  type EnrichmentRecoveryInput,
} from '../../src/recovery/enrichment_recovery.js';
import type { RecoveryGateResult } from '../../src/recovery/recovery_gate.js';
import type { DecisionNarrativeReadPort } from '../../src/repository/decision_narrative_reader.js';
import type { ConnectionPublisherPort } from '../../src/events/publish_fast_path_ready.js';
import type { Telemetry } from '../../src/metrics/telemetry_facade.js';

const DECISION = 'DEC_TPE_2026_ACC_001';

function gate(overrides: Partial<RecoveryGateResult> = {}): RecoveryGateResult {
  return {
    idempotency_key: 'TPE_2026_ACC_001|2026-05-20 22:10|policy-v1',
    decision_id: DECISION,
    idempotency_record_exists: true,
    core_exists: true,
    idempotency_core_committed: true,
    effective_core_committed: true,
    existing_narrative_types: [NarrativeType.REPORT],
    missing_narrative_types: [NarrativeType.PUBLIC_ALERT, NarrativeType.EXPLANATION],
    recommended_recovery_mode: RecoveryMode.ENRICHMENT_ONLY,
    expected_stale_execution_arn: null,
    expected_attempt: null,
    observed_running_deadline_at: null,
    ...overrides,
  };
}

function makeCore(): DecisionCore {
  return {
    decision_id: DECISION,
    version: 1,
    event_id: 'ACC_001',
    occurred_at: '2026-05-20 22:10',
    primary_evacuation: 'RD_TPE_004',
    secondary_evacuation: [],
    triggered_articles: [1, 2],
    applied_formula_articles: [7],
    invoked_procedures: [],
    classifications: [],
    excluded_candidates: [],
    multilingual_required: false,
    ete: undefined,
    evidence: {
      decision_id: DECISION,
      classification_reasoning: [],
      excluded_routes: [],
      sop_citations: [],
      data_points: [],
    },
    idempotency_key: 'k',
    injection_run_id: 'inj',
    core_hash: 'h',
    source_manifest_hash: 'sh',
    immutable_after_commit: true,
    cms_core_text: 'CMS text',
    provisional: false,
    schema_version: '1.0.0',
    policy: {} as DecisionCore['policy'],
  } as unknown as DecisionCore;
}

function narrativeTableClient(): NarrativeTableClient & { readonly put: ReturnType<typeof vi.fn> } {
  const put = vi.fn(async () => 'committed' as const);
  return { put, conditionalPut: put };
}

function narrativeReader(
  existingTypes: readonly NarrativeType[],
): DecisionNarrativeReadPort & { readonly query: ReturnType<typeof vi.fn> } {
  const rows: readonly DecisionNarrative[] = existingTypes.map(
    (t) => ({ decision_id: DECISION, narrative_type: t }) as unknown as DecisionNarrative,
  );
  const query = vi.fn().mockResolvedValue(rows);
  return { query, queryConsistent: query };
}

function bedrockFailure(): BedrockInvoker {
  return {
    invoke: vi.fn(async (): Promise<BedrockResult> => ({
      outcome: 'use_template',
      reason: 'timeout',
      message: 'timed out',
    })),
  };
}

interface Publisher extends ConnectionPublisherPort {
  readonly list: ReturnType<typeof vi.fn>;
  readonly post: ReturnType<typeof vi.fn>;
}

function connectionPublisher(connectionIds: readonly string[] = ['conn-1']): Publisher {
  const list = vi.fn().mockResolvedValue(connectionIds);
  const post = vi.fn().mockResolvedValue(undefined);
  return { list, post, listConnectionIds: list, postToConnection: post } as unknown as Publisher;
}

function makeInput(overrides: Partial<EnrichmentRecoveryInput> = {}): EnrichmentRecoveryInput {
  return {
    gate: gate(),
    core: makeCore(),
    citations: [],
    bonusLanguagesEnabled: false,
    narrativeClient: narrativeTableClient(),
    narrativeReader: narrativeReader([NarrativeType.REPORT, NarrativeType.PUBLIC_ALERT, NarrativeType.EXPLANATION]),
    bedrockInvoker: bedrockFailure(),
    connectionPublisher: connectionPublisher(),
    traceId: 'trace-abc',
    policyVersion: 'prov-2026a',
    ...overrides,
  };
}

// ─── Guards ────────────────────────────────────────────────────────────────

describe('recoverMissingNarratives — guards', () => {
  it('throws EnrichmentRecoveryCoreMissingError when core_exists is false', async () => {
    await expect(
      recoverMissingNarratives(makeInput({ gate: gate({ core_exists: false }) })),
    ).rejects.toThrow(EnrichmentRecoveryCoreMissingError);
  });

  it('throws EnrichmentRecoveryWrongModeError when mode is FULL_WORKFLOW', async () => {
    await expect(
      recoverMissingNarratives(
        makeInput({ gate: gate({ recommended_recovery_mode: RecoveryMode.FULL_WORKFLOW }) }),
      ),
    ).rejects.toThrow(EnrichmentRecoveryWrongModeError);
  });
});

// ─── Rendering only the missing branches ──────────────────────────────────

describe('recoverMissingNarratives — renders only missing_narrative_types', () => {
  it('writes exactly the missing narrative types, not the already-existing one', async () => {
    const client = narrativeTableClient();
    const input = makeInput({
      gate: gate({
        existing_narrative_types: [NarrativeType.REPORT],
        missing_narrative_types: [NarrativeType.PUBLIC_ALERT, NarrativeType.EXPLANATION],
      }),
      narrativeClient: client,
    });

    const result = await recoverMissingNarratives(input);

    expect(client.put).toHaveBeenCalledTimes(2);
    const writtenTypes = client.put.mock.calls.map(
      (call: unknown[]) => (call[0] as NarrativeItem).narrative_type,
    );
    expect(writtenTypes).toContain(NarrativeType.PUBLIC_ALERT);
    expect(writtenTypes).toContain(NarrativeType.EXPLANATION);
    expect(writtenTypes).not.toContain(NarrativeType.REPORT);

    expect(result.renderedTypes[NarrativeType.PUBLIC_ALERT]).toBe('committed');
    expect(result.renderedTypes[NarrativeType.EXPLANATION]).toBe('committed');
    expect(result.renderedTypes[NarrativeType.REPORT]).toBeUndefined();
  });

  it('renders zero branches when missing_narrative_types is empty', async () => {
    const client = narrativeTableClient();
    await recoverMissingNarratives(
      makeInput({
        gate: gate({
          existing_narrative_types: [NarrativeType.REPORT, NarrativeType.PUBLIC_ALERT, NarrativeType.EXPLANATION],
          missing_narrative_types: [],
        }),
        narrativeClient: client,
      }),
    );
    expect(client.put).not.toHaveBeenCalled();
  });
});

// ─── decision.enriched gating ──────────────────────────────────────────────

describe('recoverMissingNarratives — decision.enriched gate', () => {
  it('emits decision.enriched when a fresh read confirms all three are present', async () => {
    const publisher = connectionPublisher(['conn-1']);
    const result = await recoverMissingNarratives(
      makeInput({
        narrativeReader: narrativeReader([
          NarrativeType.REPORT,
          NarrativeType.PUBLIC_ALERT,
          NarrativeType.EXPLANATION,
        ]),
        connectionPublisher: publisher,
      }),
    );

    expect(result.enrichedEmitted).toBe(true);
    expect(publisher.post).toHaveBeenCalledTimes(1);
    expect(result.enrichedPublishResult?.event.event_type).toBe('decision.enriched');
  });

  it('does not emit decision.enriched when the fresh read still shows a gap', async () => {
    const publisher = connectionPublisher(['conn-1']);
    // Simulate: PUBLIC_ALERT render "succeeded" per composer outcome, but the
    // authoritative re-read (e.g. a concurrent execution's condition-check
    // race) still does not show EXPLANATION — the gate must not guess.
    const result = await recoverMissingNarratives(
      makeInput({
        narrativeReader: narrativeReader([NarrativeType.REPORT, NarrativeType.PUBLIC_ALERT]),
        connectionPublisher: publisher,
      }),
    );

    expect(result.enrichedEmitted).toBe(false);
    expect(publisher.post).not.toHaveBeenCalled();
    expect(result.enrichedPublishResult).toBeUndefined();
  });

  it('a decision.enriched delivery failure does not fail the recovery call', async () => {
    const publisher = connectionPublisher(['conn-1']);
    publisher.post.mockRejectedValueOnce(new Error('ws down'));
    const result = await recoverMissingNarratives(
      makeInput({
        narrativeReader: narrativeReader([
          NarrativeType.REPORT,
          NarrativeType.PUBLIC_ALERT,
          NarrativeType.EXPLANATION,
        ]),
        connectionPublisher: publisher,
      }),
    );
    // publishDecisionEnriched itself swallows per-connection failures into
    // `failures`, so this still resolves successfully with enrichedEmitted=true.
    expect(result.enrichedEmitted).toBe(true);
  });
});

// ─── Latency instrumentation (TASK-170) ────────────────────────────────────

describe('recoverMissingNarratives — latency instrumentation (TASK-170)', () => {
  it('marks EndToEndLatencyMs from core.occurred_at once decision.enriched is emitted', async () => {
    const core = makeCore(); // occurred_at: '2026-05-20 22:10'
    const nowMs = Date.parse(core.occurred_at) + 41_000;
    const recordLatency = vi.fn();
    const now = vi.fn().mockReturnValue(nowMs);

    const result = await recoverMissingNarratives(
      makeInput({
        core,
        narrativeReader: narrativeReader([
          NarrativeType.REPORT,
          NarrativeType.PUBLIC_ALERT,
          NarrativeType.EXPLANATION,
        ]),
        latency: { now, telemetry: { recordLatency } as unknown as Telemetry },
      }),
    );

    expect(result.enrichedEmitted).toBe(true);
    expect(recordLatency).toHaveBeenCalledTimes(1);
    const trace = recordLatency.mock.calls[0]?.[0] as { snapshot(): { end_to_end_ms: number | null; official_deadline_met: boolean | null } };
    const snapshot = trace.snapshot();
    expect(snapshot.end_to_end_ms).toBe(41_000);
    expect(snapshot.official_deadline_met).toBe(true);
  });

  it('marks latency even when there are zero live connections (not gated on delivered > 0)', async () => {
    const core = makeCore();
    const recordLatency = vi.fn();
    const now = vi.fn().mockReturnValue(Date.parse(core.occurred_at) + 1_000);

    await recoverMissingNarratives(
      makeInput({
        core,
        connectionPublisher: connectionPublisher([]),
        narrativeReader: narrativeReader([
          NarrativeType.REPORT,
          NarrativeType.PUBLIC_ALERT,
          NarrativeType.EXPLANATION,
        ]),
        latency: { now, telemetry: { recordLatency } as unknown as Telemetry },
      }),
    );

    expect(recordLatency).toHaveBeenCalledTimes(1);
  });

  it('never marks latency when the narrative set is still incomplete', async () => {
    const recordLatency = vi.fn();
    const now = vi.fn().mockReturnValue(Date.now());

    const result = await recoverMissingNarratives(
      makeInput({
        narrativeReader: narrativeReader([NarrativeType.REPORT, NarrativeType.PUBLIC_ALERT]),
        latency: { now, telemetry: { recordLatency } as unknown as Telemetry },
      }),
    );

    expect(result.enrichedEmitted).toBe(false);
    expect(recordLatency).not.toHaveBeenCalled();
  });

  it('is a no-op (no throw) when latency is omitted entirely', async () => {
    await expect(
      recoverMissingNarratives(
        makeInput({
          narrativeReader: narrativeReader([
            NarrativeType.REPORT,
            NarrativeType.PUBLIC_ALERT,
            NarrativeType.EXPLANATION,
          ]),
        }),
      ),
    ).resolves.toMatchObject({ enrichedEmitted: true });
  });
});

// ─── Never mutates DecisionCore ────────────────────────────────────────────

describe('recoverMissingNarratives — never mutates DecisionCore', () => {
  it('core is unchanged after recovery', async () => {
    const core = makeCore();
    const before = JSON.stringify(core);
    await recoverMissingNarratives(makeInput({ core }));
    expect(JSON.stringify(core)).toBe(before);
  });
});
