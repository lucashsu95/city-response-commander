/**
 * TASK-093 — RecoveryGateFn unit tests.
 *
 * Covers both recovery paths (FULL_WORKFLOW / ENRICHMENT_ONLY), the table-miss
 * boundaries, the strong-consistency contract, the `effective_core_committed` OR
 * rule, and the zero-write invariant (design §10.11e, §15.2, §18).
 */

import { describe, it, expect, vi } from 'vitest';
import {
  IdempotencyStatus,
  NarrativeType,
  RecoveryMode,
  RecoveryStage,
} from '@city-commander/shared-schemas';
import type {
  DecisionCore,
  DecisionNarrative,
  IdempotencyRecord,
} from '@city-commander/shared-schemas';
import {
  evaluateRecoveryGate,
  RecommendedRecoveryMode,
  RecoveryGate,
  ReaderUsageError,
  TableReadError,
  IdempotencyRepositoryError,
  REQUIRED_NARRATIVE_TYPES,
  splitNarrativeTypes,
} from '../../src/index.js';
import type { RecoveryGatePorts } from '../../src/index.js';

const KEY = 'TPE_2026_ACC_001|2026-05-20 22:10|policy-v1';
const DECISION = 'DEC_ACC_001';
const EXEC = 'arn:aws:states:::execution:city-commander:exec-1';

// ─── Fixtures ──────────────────────────────────────────────

function record(overrides: Partial<IdempotencyRecord> = {}): IdempotencyRecord {
  return {
    idempotency_key: KEY,
    decision_id: DECISION,
    status: IdempotencyStatus.running,
    attempt_count: 2,
    lease_owner: 'req-aaa',
    lease_expires_at: 1_800_000_060_000,
    last_error: null,
    retryable: true,
    workflow_execution_arn: EXEC,
    running_started_at: 1_800_000_000_000,
    running_deadline_at: 1_800_000_030_000,
    completed_execution_arn: null,
    completed_attempt_count: null,
    last_transition_execution_arn: EXEC,
    last_transition_attempt_count: 2,
    evidence_source: null,
    core_committed: false,
    // shared-schemas currently exposes a different member set than design
    // §10.11e; the gate never reads these fields.
    recovery_stage: RecoveryStage.detect,
    recovery_mode: RecoveryMode.FIRST_RUN,
    previous_last_error: null,
    created_at: '2026-05-20 22:10',
    updated_at: '2026-05-20 22:10',
    expires_at: 1_800_086_400,
    ...overrides,
  };
}

/** Minimal DecisionCore — the gate only cares that the row exists. */
function core(): DecisionCore {
  return { decision_id: DECISION } as unknown as DecisionCore;
}

function narrative(type: NarrativeType): DecisionNarrative {
  return { decision_id: DECISION, narrative_type: type } as unknown as DecisionNarrative;
}

interface Ports extends RecoveryGatePorts {
  readonly readIdempotency: ReturnType<typeof vi.fn>;
  readonly readCore: ReturnType<typeof vi.fn>;
  readonly queryNarratives: ReturnType<typeof vi.fn>;
}

function createPorts(options?: {
  idempotency?: IdempotencyRecord | null;
  core?: DecisionCore | null;
  narratives?: readonly DecisionNarrative[];
}): Ports {
  const readIdempotency = vi.fn().mockResolvedValue(options?.idempotency ?? null);
  const readCore = vi.fn().mockResolvedValue(options?.core ?? null);
  const queryNarratives = vi.fn().mockResolvedValue(options?.narratives ?? []);

  return {
    readIdempotency,
    readCore,
    queryNarratives,
    idempotency: { getConsistent: readIdempotency },
    decisionCore: {
      getConsistent: readCore,
      exists: async (id: string) => (await readCore(id)) !== null,
    },
    decisionNarrative: { queryConsistent: queryNarratives },
  } as unknown as Ports;
}

// ─── FULL_WORKFLOW path ────────────────────────────────────

describe('RecoveryGate — FULL_WORKFLOW', () => {
  it('recommends FULL_WORKFLOW when no core is committed', async () => {
    const ports = createPorts({ idempotency: record({ core_committed: false }), core: null });

    const result = await evaluateRecoveryGate(ports, { idempotencyKey: KEY });

    expect(result.core_exists).toBe(false);
    expect(result.idempotency_core_committed).toBe(false);
    expect(result.effective_core_committed).toBe(false);
    expect(result.recommended_recovery_mode).toBe(RecommendedRecoveryMode.FULL_WORKFLOW);
  });

  it('reports all three narrative types as missing when none exist', async () => {
    const ports = createPorts({ idempotency: record(), core: null, narratives: [] });

    const result = await evaluateRecoveryGate(ports, { idempotencyKey: KEY });

    expect(result.existing_narrative_types).toEqual([]);
    expect(result.missing_narrative_types).toEqual([
      NarrativeType.REPORT,
      NarrativeType.PUBLIC_ALERT,
      NarrativeType.EXPLANATION,
    ]);
  });

  it('stays FULL_WORKFLOW even when narratives exist without a core', async () => {
    // Pathological but must not be misread: narratives without a core cannot be
    // an enrichment recovery, because there is no core to enrich.
    const ports = createPorts({
      idempotency: record({ core_committed: false }),
      core: null,
      narratives: [narrative(NarrativeType.REPORT)],
    });

    const result = await evaluateRecoveryGate(ports, { idempotencyKey: KEY });

    expect(result.recommended_recovery_mode).toBe(RecommendedRecoveryMode.FULL_WORKFLOW);
  });
});

// ─── ENRICHMENT_ONLY path ──────────────────────────────────

describe('RecoveryGate — ENRICHMENT_ONLY', () => {
  it('recommends ENRICHMENT_ONLY when the core row exists', async () => {
    const ports = createPorts({ idempotency: record({ core_committed: false }), core: core() });

    const result = await evaluateRecoveryGate(ports, { idempotencyKey: KEY });

    expect(result.core_exists).toBe(true);
    expect(result.effective_core_committed).toBe(true);
    expect(result.recommended_recovery_mode).toBe(RecommendedRecoveryMode.ENRICHMENT_ONLY);
  });

  it('recommends ENRICHMENT_ONLY when only the checkpoint flag is set', async () => {
    // core_committed=true but the core row read came back empty: still treated as
    // committed, because the flag is written only by MARK_CORE_COMMITTED.
    const ports = createPorts({ idempotency: record({ core_committed: true }), core: null });

    const result = await evaluateRecoveryGate(ports, { idempotencyKey: KEY });

    expect(result.idempotency_core_committed).toBe(true);
    expect(result.core_exists).toBe(false);
    expect(result.effective_core_committed).toBe(true);
    expect(result.recommended_recovery_mode).toBe(RecommendedRecoveryMode.ENRICHMENT_ONLY);
  });

  it('computes effective_core_committed as a strict OR', async () => {
    const cases: readonly { flag: boolean; row: boolean; expected: boolean }[] = [
      { flag: false, row: false, expected: false },
      { flag: true, row: false, expected: true },
      { flag: false, row: true, expected: true },
      { flag: true, row: true, expected: true },
    ];

    for (const testCase of cases) {
      const ports = createPorts({
        idempotency: record({ core_committed: testCase.flag }),
        core: testCase.row ? core() : null,
      });

      const result = await evaluateRecoveryGate(ports, { idempotencyKey: KEY });

      expect(result.effective_core_committed).toBe(testCase.expected);
    }
  });

  it('lists only the missing narrative types for a partial enrichment', async () => {
    const ports = createPorts({
      idempotency: record({ core_committed: true }),
      core: core(),
      narratives: [narrative(NarrativeType.REPORT), narrative(NarrativeType.EXPLANATION)],
    });

    const result = await evaluateRecoveryGate(ports, { idempotencyKey: KEY });

    expect(result.existing_narrative_types).toEqual([
      NarrativeType.REPORT,
      NarrativeType.EXPLANATION,
    ]);
    expect(result.missing_narrative_types).toEqual([NarrativeType.PUBLIC_ALERT]);
  });

  it('reports nothing missing when all three narratives are committed', async () => {
    const ports = createPorts({
      idempotency: record({ core_committed: true }),
      core: core(),
      narratives: REQUIRED_NARRATIVE_TYPES.map(narrative),
    });

    const result = await evaluateRecoveryGate(ports, { idempotencyKey: KEY });

    expect(result.missing_narrative_types).toEqual([]);
    expect(result.existing_narrative_types).toEqual([...REQUIRED_NARRATIVE_TYPES]);
  });
});

// ─── External fencing outputs (FIX 3) ──────────────────────

describe('RecoveryGate — stale execution fencing metadata (FIX 3)', () => {
  it('surfaces the fencing terms observed on the record', async () => {
    const ports = createPorts({
      idempotency: record({
        workflow_execution_arn: EXEC,
        attempt_count: 2,
        running_deadline_at: 1_800_000_030_000,
      }),
    });

    const result = await evaluateRecoveryGate(ports, { idempotencyKey: KEY });

    expect(result.expected_stale_execution_arn).toBe(EXEC);
    expect(result.expected_attempt).toBe(2);
    expect(result.observed_running_deadline_at).toBe(1_800_000_030_000);
  });

  it('returns null fencing terms when the record has none yet', async () => {
    const ports = createPorts({
      idempotency: record({ workflow_execution_arn: null, running_deadline_at: null }),
    });

    const result = await evaluateRecoveryGate(ports, { idempotencyKey: KEY });

    expect(result.expected_stale_execution_arn).toBeNull();
    expect(result.observed_running_deadline_at).toBeNull();
    // attempt_count is always present on a real record.
    expect(result.expected_attempt).toBe(2);
  });
});

// ─── Table-miss boundaries ─────────────────────────────────

describe('RecoveryGate — table-miss boundaries', () => {
  it('falls back to the workflow INPUT decision_id when the record is gone', async () => {
    const ports = createPorts({ idempotency: null, core: core() });

    const result = await evaluateRecoveryGate(ports, {
      idempotencyKey: KEY,
      decisionId: DECISION,
    });

    expect(result.idempotency_record_exists).toBe(false);
    expect(result.decision_id).toBe(DECISION);
    expect(result.core_exists).toBe(true);
    expect(result.recommended_recovery_mode).toBe(RecommendedRecoveryMode.ENRICHMENT_ONLY);
    expect(result.expected_stale_execution_arn).toBeNull();
    expect(result.expected_attempt).toBeNull();
  });

  it('prefers the INPUT decision_id over the record value', async () => {
    const ports = createPorts({ idempotency: record({ decision_id: 'DEC_FROM_RECORD' }) });

    const result = await evaluateRecoveryGate(ports, {
      idempotencyKey: KEY,
      decisionId: 'DEC_FROM_INPUT',
    });

    expect(result.decision_id).toBe('DEC_FROM_INPUT');
    expect(ports.readCore).toHaveBeenCalledWith('DEC_FROM_INPUT');
  });

  it('reports FULL_WORKFLOW without reading tables when nothing can be resolved', async () => {
    const ports = createPorts({ idempotency: null });

    const result = await evaluateRecoveryGate(ports, { idempotencyKey: KEY });

    expect(result.idempotency_record_exists).toBe(false);
    expect(result.decision_id).toBe('');
    expect(result.core_exists).toBe(false);
    expect(result.effective_core_committed).toBe(false);
    expect(result.recommended_recovery_mode).toBe(RecommendedRecoveryMode.FULL_WORKFLOW);
    expect(result.missing_narrative_types).toEqual([]);
    // Nothing to look up: no core / narrative read is attempted.
    expect(ports.readCore).not.toHaveBeenCalled();
    expect(ports.queryNarratives).not.toHaveBeenCalled();
  });

  it('treats an empty narrative query as "nothing committed", not an error', async () => {
    const ports = createPorts({
      idempotency: record({ core_committed: true }),
      core: core(),
      narratives: [],
    });

    const result = await evaluateRecoveryGate(ports, { idempotencyKey: KEY });

    expect(result.missing_narrative_types).toEqual([...REQUIRED_NARRATIVE_TYPES]);
  });
});

// ─── Read contract ─────────────────────────────────────────

describe('RecoveryGate — read contract', () => {
  it('reads all three sources exactly once', async () => {
    const ports = createPorts({ idempotency: record(), core: core() });

    await evaluateRecoveryGate(ports, { idempotencyKey: KEY });

    expect(ports.readIdempotency).toHaveBeenCalledTimes(1);
    expect(ports.readIdempotency).toHaveBeenCalledWith(KEY);
    expect(ports.readCore).toHaveBeenCalledTimes(1);
    expect(ports.readCore).toHaveBeenCalledWith(DECISION);
    expect(ports.queryNarratives).toHaveBeenCalledTimes(1);
    expect(ports.queryNarratives).toHaveBeenCalledWith(DECISION);
  });

  it('accepts read-only ports only (no writer is reachable)', async () => {
    const ports = createPorts({ idempotency: record(), core: core() });

    await evaluateRecoveryGate(ports, { idempotencyKey: KEY });

    // The idempotency port exposes exactly one method: the consistent read.
    expect(Object.keys(ports.idempotency)).toEqual(['getConsistent']);
  });

  it('propagates an idempotency read failure instead of assuming absence', async () => {
    const ports = createPorts({ idempotency: record() });
    const failure = new IdempotencyRepositoryError('throttled', 'getConsistent', KEY);
    ports.readIdempotency.mockRejectedValue(failure);

    await expect(evaluateRecoveryGate(ports, { idempotencyKey: KEY })).rejects.toBe(failure);
  });

  it('propagates a core read failure instead of reporting core_exists=false', async () => {
    const ports = createPorts({ idempotency: record() });
    const failure = new TableReadError('throttled', 'DecisionCoreTable', 'GetItem', DECISION);
    ports.readCore.mockRejectedValue(failure);

    await expect(evaluateRecoveryGate(ports, { idempotencyKey: KEY })).rejects.toBe(failure);
  });

  it('propagates a narrative read failure instead of reporting all missing', async () => {
    const ports = createPorts({ idempotency: record(), core: core() });
    const failure = new TableReadError('throttled', 'DecisionNarrativeTable', 'Query', DECISION);
    ports.queryNarratives.mockRejectedValue(failure);

    await expect(evaluateRecoveryGate(ports, { idempotencyKey: KEY })).rejects.toBe(failure);
  });

  it('rejects an empty idempotencyKey before reading anything', async () => {
    const ports = createPorts({ idempotency: record() });

    await expect(evaluateRecoveryGate(ports, { idempotencyKey: '' })).rejects.toBeInstanceOf(
      ReaderUsageError,
    );
    expect(ports.readIdempotency).not.toHaveBeenCalled();
  });
});

// ─── Class wrapper ─────────────────────────────────────────

describe('RecoveryGate class', () => {
  it('evaluates with the ports bound at construction', async () => {
    const ports = createPorts({ idempotency: record({ core_committed: true }), core: core() });
    const gate = new RecoveryGate(ports);

    const result = await gate.evaluate({ idempotencyKey: KEY });

    expect(result.recommended_recovery_mode).toBe(RecommendedRecoveryMode.ENRICHMENT_ONLY);
  });
});

// ─── splitNarrativeTypes ───────────────────────────────────

describe('splitNarrativeTypes', () => {
  it('returns required-set order regardless of item order', () => {
    const { existing, missing } = splitNarrativeTypes([
      narrative(NarrativeType.EXPLANATION),
      narrative(NarrativeType.REPORT),
    ]);

    expect(existing).toEqual([NarrativeType.REPORT, NarrativeType.EXPLANATION]);
    expect(missing).toEqual([NarrativeType.PUBLIC_ALERT]);
  });

  it('deduplicates repeated items', () => {
    const { existing, missing } = splitNarrativeTypes([
      narrative(NarrativeType.REPORT),
      narrative(NarrativeType.REPORT),
    ]);

    expect(existing).toEqual([NarrativeType.REPORT]);
    expect(missing).toEqual([NarrativeType.PUBLIC_ALERT, NarrativeType.EXPLANATION]);
  });

  it('ignores an unknown narrative_type rather than counting it as satisfied', () => {
    const rogue = {
      decision_id: DECISION,
      narrative_type: 'ROGUE',
    } as unknown as DecisionNarrative;

    const { existing, missing } = splitNarrativeTypes([rogue]);

    expect(existing).toEqual([]);
    expect(missing).toEqual([...REQUIRED_NARRATIVE_TYPES]);
  });
});
