import { describe, expect, it, vi } from 'vitest';
import { NarrativeType } from '@city-commander/shared-schemas';
import {
  buildDecisionEnrichedReadyEventId,
  decisionEnrichedPollingFallback,
  emitDecisionEnrichedIfComplete,
} from '../../src/realtime/decision_enriched.js';

const input = {
  decisionId: 'DEC_001',
  coreVersionRef: 4,
  traceId: 'trace-1',
  policyVersion: 'v1',
  occurredAt: '2026-07-31T15:00:00.000Z',
};

describe('decision.enriched completion gate', () => {
  it('does not emit before all three narratives are committed', async () => {
    const publish = vi.fn();
    const result = await emitDecisionEnrichedIfComplete(
      { readCommittedTypes: async () => [NarrativeType.REPORT, NarrativeType.PUBLIC_ALERT] },
      { publish },
      input,
    );
    expect(result).toEqual({ outcome: 'not_ready', missing: [NarrativeType.EXPLANATION] });
    expect(publish).not.toHaveBeenCalled();
  });

  it('emits the shared-schema event only after the complete set exists', async () => {
    const publish = vi.fn(async () => undefined);
    const result = await emitDecisionEnrichedIfComplete(
      { readCommittedTypes: async () => [
        NarrativeType.EXPLANATION,
        NarrativeType.REPORT,
        NarrativeType.PUBLIC_ALERT,
      ] },
      { publish },
      input,
    );
    expect(result.outcome).toBe('emitted');
    expect(publish).toHaveBeenCalledWith(expect.objectContaining({
      event_type: 'decision.enriched',
      ready_event_id: 'DEC_001|decision.enriched|4',
    }));
  });

  it('repeated completion checks use the same dedup ID and define polling separately', () => {
    expect(buildDecisionEnrichedReadyEventId('DEC_001', 4)).toBe(
      buildDecisionEnrichedReadyEventId('DEC_001', 4),
    );
    expect(decisionEnrichedPollingFallback('DEC_001')).toBe('/decisions/DEC_001');
  });
});
