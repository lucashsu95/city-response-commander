import { describe, expect, it } from 'vitest';
import { validateContainmentComposerOutput } from '../src/containment_output_validator.js';

describe('validateContainmentComposerOutput', () => {
  it('accepts only the explanation text from a valid Bedrock payload', () => {
    expect(validateContainmentComposerOutput({ explanation_text: '請依核准路線疏導。' })).toEqual({
      outcome: 'accepted',
      text: '請依核准路線疏導。',
    });
  });

  it('rejects containment fields reserved for deterministic code', () => {
    expect(
      validateContainmentComposerOutput({
        explanation_text: '嘗試覆寫',
        decision: { reroute_roads: ['RD_TPE_999'] },
      }),
    ).toMatchObject({
      outcome: 'use_template',
      reason: 'prohibited_field_overwrite',
      offendingFields: ['decision.reroute_roads'],
    });
  });
});
