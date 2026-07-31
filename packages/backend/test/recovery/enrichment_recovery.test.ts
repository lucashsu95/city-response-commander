import { describe, expect, it, vi } from 'vitest';
import { NarrativeType } from '@city-commander/shared-schemas';
import {
  recoverMissingNarratives,
  type EnrichmentRecoveryPorts,
} from '../../src/recovery/enrichment_recovery.js';

function ports(): EnrichmentRecoveryPorts & { calls: Record<NarrativeType, ReturnType<typeof vi.fn>> } {
  const calls = {
    [NarrativeType.REPORT]: vi.fn(async () => ({ outcome: 'committed' as const })),
    [NarrativeType.PUBLIC_ALERT]: vi.fn(async () => ({ outcome: 'committed' as const })),
    [NarrativeType.EXPLANATION]: vi.fn(async () => ({ outcome: 'branch_already_completed' as const })),
  };
  return { composers: calls, calls };
}

describe('ENRICHMENT_ONLY missing_narrative_types recovery', () => {
  it('retries only missing composers', async () => {
    const p = ports();
    const result = await recoverMissingNarratives(p, {
      coreExists: true,
      missingNarrativeTypes: [NarrativeType.PUBLIC_ALERT, NarrativeType.EXPLANATION],
    });

    expect(result.outcome).toBe('completed');
    expect(p.calls.REPORT).not.toHaveBeenCalled();
    expect(p.calls.PUBLIC_ALERT).toHaveBeenCalledTimes(1);
    expect(p.calls.EXPLANATION).toHaveBeenCalledTimes(1);
  });

  it('deduplicates RecoveryGate input and keeps required-set order', async () => {
    const p = ports();
    const result = await recoverMissingNarratives(p, {
      coreExists: true,
      missingNarrativeTypes: [NarrativeType.EXPLANATION, NarrativeType.REPORT, NarrativeType.REPORT],
    });
    expect(result.outcome === 'completed' ? result.recovered : []).toEqual([
      NarrativeType.REPORT,
      NarrativeType.EXPLANATION,
    ]);
    expect(p.calls.REPORT).toHaveBeenCalledTimes(1);
  });

  it('fails closed without invoking composers when core is missing', async () => {
    const p = ports();
    const result = await recoverMissingNarratives(p, {
      coreExists: false,
      missingNarrativeTypes: [NarrativeType.REPORT],
    });
    expect(result).toEqual({ outcome: 'recovery_core_missing', error_code: 'RECOVERY_CORE_MISSING' });
    expect(p.calls.REPORT).not.toHaveBeenCalled();
  });
});
