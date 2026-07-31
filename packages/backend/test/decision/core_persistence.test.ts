/**
 * TASK-100 / TASK-101 — DecisionCore persistence and identity classification.
 *
 * Locks the §15.2 three-way contract: COMMITTED /
 * ALREADY_COMMITTED_SAME_DECISION / CORE_IDENTITY_CONFLICT, with the canonical
 * `core_hash` (FIX 4) as the deciding field, and no overwrite on conflict.
 */

import { describe, it, expect, vi } from 'vitest';
import { CoreWriteStatus } from '@city-commander/shared-schemas';
import type { DecisionCore } from '@city-commander/shared-schemas';
import {
  classifyCoreIdentity,
  persistDecisionCore,
  CORE_IDENTITY_FIELDS,
  DecisionCoreAlreadyExistsError,
  TableReadError,
} from '../../src/index.js';
import type { DecisionCorePort } from '../../src/index.js';

const DECISION = 'DEC_TPE_2026_ACC_001_abcdef123456';
const KEY = 'TPE_2026_ACC_001|2026-05-20 22:10|prov-2026a';

function core(overrides: Partial<DecisionCore> = {}): DecisionCore {
  return {
    decision_id: DECISION,
    idempotency_key: KEY,
    source_manifest_hash: 'sha256:AAAA',
    core_hash: 'sha256:CORE-HASH-1',
    schema_version: '1.0.0',
    // Execution-volatile metadata: excluded from the canonical hash (FIX 4),
    // so it must never influence the classification.
    injection_run_id: 'inj-1',
    workflow_execution_name: 'exec-name-1',
    version: 1,
    ...overrides,
  } as unknown as DecisionCore;
}

interface Ports extends DecisionCorePort {
  readonly put: ReturnType<typeof vi.fn>;
  readonly read: ReturnType<typeof vi.fn>;
}

function createRepository(options?: { stored?: DecisionCore | null }): Ports {
  const put = vi.fn().mockImplementation(async (item: DecisionCore) => item);
  const read = vi.fn().mockResolvedValue(options?.stored ?? null);

  return {
    put,
    read,
    conditionalPutNew: put,
    getConsistent: read,
    exists: async (id: string) => (await read(id)) !== null,
  } as unknown as Ports;
}

// ─── classifyCoreIdentity ──────────────────────────────────

describe('classifyCoreIdentity (TASK-101)', () => {
  it('compares exactly the five immutable identity fields', () => {
    expect([...CORE_IDENTITY_FIELDS]).toEqual([
      'decision_id',
      'idempotency_key',
      'source_manifest_hash',
      'core_hash',
      'schema_version',
    ]);
  });

  it('reports ALREADY_COMMITTED_SAME_DECISION when all five match', () => {
    const result = classifyCoreIdentity(core(), core());

    expect(result.status).toBe(CoreWriteStatus.ALREADY_COMMITTED_SAME_DECISION);
    expect(result.mismatches).toEqual([]);
  });

  it('ignores execution-volatile metadata (FIX 4)', () => {
    // Different run id, execution name and version — same decision facts.
    const result = classifyCoreIdentity(
      core({ injection_run_id: 'inj-1', workflow_execution_name: 'exec-a', version: 1 }),
      core({ injection_run_id: 'inj-2', workflow_execution_name: 'exec-b', version: 9 }),
    );

    expect(result.status).toBe(CoreWriteStatus.ALREADY_COMMITTED_SAME_DECISION);
  });

  it.each([...CORE_IDENTITY_FIELDS])('flags a conflict when %s differs', (field) => {
    const result = classifyCoreIdentity(
      core(),
      core({ [field]: 'DIFFERENT' } as Partial<DecisionCore>),
    );

    expect(result.status).toBe(CoreWriteStatus.CORE_IDENTITY_CONFLICT);
    expect(result.mismatches.map((m) => m.field)).toContain(field);
  });

  it('treats a changed core_hash as a conflict (any changed decision fact)', () => {
    const result = classifyCoreIdentity(core(), core({ core_hash: 'sha256:CORE-HASH-2' }));

    expect(result.status).toBe(CoreWriteStatus.CORE_IDENTITY_CONFLICT);
    expect(result.mismatches).toEqual([
      { field: 'core_hash', expected: 'sha256:CORE-HASH-1', actual: 'sha256:CORE-HASH-2' },
    ]);
  });

  it('treats a changed source_manifest_hash as a conflict (different official data)', () => {
    const result = classifyCoreIdentity(core(), core({ source_manifest_hash: 'sha256:BBBB' }));

    expect(result.status).toBe(CoreWriteStatus.CORE_IDENTITY_CONFLICT);
  });

  it('reports every mismatching field, not just the first', () => {
    const result = classifyCoreIdentity(
      core(),
      core({ core_hash: 'sha256:X', schema_version: '2.0.0' }),
    );

    expect(result.mismatches.map((m) => m.field).sort()).toEqual(['core_hash', 'schema_version']);
  });
});

// ─── persistDecisionCore ───────────────────────────────────

describe('persistDecisionCore (TASK-100)', () => {
  it('returns COMMITTED on the first write', async () => {
    const repository = createRepository();

    const outcome = await persistDecisionCore(repository, core());

    expect(outcome.status).toBe(CoreWriteStatus.COMMITTED);
    expect(repository.put).toHaveBeenCalledTimes(1);
  });

  it('does not re-read when the write succeeds', async () => {
    const repository = createRepository();

    await persistDecisionCore(repository, core());

    expect(repository.read).not.toHaveBeenCalled();
  });

  it('re-reads with strong consistency after a conditional failure', async () => {
    const repository = createRepository({ stored: core() });
    repository.put.mockRejectedValue(new DecisionCoreAlreadyExistsError(DECISION));

    await persistDecisionCore(repository, core());

    expect(repository.read).toHaveBeenCalledTimes(1);
    expect(repository.read).toHaveBeenCalledWith(DECISION);
  });

  it('returns ALREADY_COMMITTED_SAME_DECISION for a safe retry', async () => {
    const stored = core();
    const repository = createRepository({ stored });
    repository.put.mockRejectedValue(new DecisionCoreAlreadyExistsError(DECISION));

    const outcome = await persistDecisionCore(
      repository,
      // Same decision facts, different execution metadata.
      core({ injection_run_id: 'inj-retry', workflow_execution_name: 'exec-retry' }),
    );

    expect(outcome.status).toBe(CoreWriteStatus.ALREADY_COMMITTED_SAME_DECISION);
    if (outcome.status !== CoreWriteStatus.ALREADY_COMMITTED_SAME_DECISION) {
      throw new Error('unreachable');
    }
    // The STORED core is returned: it is the committed truth.
    expect(outcome.core).toBe(stored);
  });

  it('never rewrites the core on a safe retry', async () => {
    const repository = createRepository({ stored: core() });
    repository.put.mockRejectedValue(new DecisionCoreAlreadyExistsError(DECISION));

    await persistDecisionCore(repository, core());

    expect(repository.put).toHaveBeenCalledTimes(1);
  });

  it('returns CORE_IDENTITY_CONFLICT when the stored decision differs', async () => {
    const stored = core({ core_hash: 'sha256:OTHER' });
    const repository = createRepository({ stored });
    repository.put.mockRejectedValue(new DecisionCoreAlreadyExistsError(DECISION));

    const outcome = await persistDecisionCore(repository, core());

    expect(outcome.status).toBe(CoreWriteStatus.CORE_IDENTITY_CONFLICT);
    if (outcome.status !== CoreWriteStatus.CORE_IDENTITY_CONFLICT) throw new Error('unreachable');
    expect(outcome.storedCore).toBe(stored);
    expect(outcome.mismatches.map((m) => m.field)).toEqual(['core_hash']);
  });

  it('does not overwrite the stored core on conflict', async () => {
    const repository = createRepository({ stored: core({ core_hash: 'sha256:OTHER' }) });
    repository.put.mockRejectedValue(new DecisionCoreAlreadyExistsError(DECISION));

    await persistDecisionCore(repository, core());

    // Exactly one Put attempt, which failed. No second write of any kind.
    expect(repository.put).toHaveBeenCalledTimes(1);
  });

  it('fails closed when the Put says exists but the consistent read says absent', async () => {
    const repository = createRepository({ stored: null });
    repository.put.mockRejectedValue(new DecisionCoreAlreadyExistsError(DECISION));

    const outcome = await persistDecisionCore(repository, core());

    expect(outcome.status).toBe(CoreWriteStatus.CORE_IDENTITY_CONFLICT);
  });

  it('propagates a non-conditional write failure instead of classifying it', async () => {
    const repository = createRepository();
    const failure = new TableReadError('throttled', 'DecisionCoreTable', 'GetItem', DECISION);
    repository.put.mockRejectedValue(failure);

    await expect(persistDecisionCore(repository, core())).rejects.toBe(failure);
    expect(repository.read).not.toHaveBeenCalled();
  });

  it('propagates a failure raised by the identity re-read', async () => {
    const repository = createRepository();
    repository.put.mockRejectedValue(new DecisionCoreAlreadyExistsError(DECISION));
    const readFailure = new TableReadError('throttled', 'DecisionCoreTable', 'GetItem', DECISION);
    repository.read.mockRejectedValue(readFailure);

    await expect(persistDecisionCore(repository, core())).rejects.toBe(readFailure);
  });

  it('never writes IdempotencyTable (the port has no such method, FIX 2)', () => {
    const repository = createRepository();

    expect(Object.keys(repository)).toEqual([
      'put',
      'read',
      'conditionalPutNew',
      'getConsistent',
      'exists',
    ]);
  });
});
