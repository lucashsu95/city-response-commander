import { describe, expect, it, vi } from 'vitest';
import type { SafeContext } from '@city-commander/shared-schemas';
import { createContainmentComposer } from '../src/containment_composer.js';

const context: SafeContext = {
  allowed_road_whitelist: ['RD_TPE_004'],
  official_sop_text: [],
  universal_principles: null,
  scope_disclosure: null,
  instruction: '只可使用白名單道路。',
};

describe('createContainmentComposer', () => {
  it('parses the Bedrock JSON payload for downstream schema validation', async () => {
    const invoke = vi.fn(async () => ({
      outcome: 'success' as const,
      text: '{"explanation_text":"改道 RD_TPE_004"}',
      usedModelId: 'mock-model',
    }));

    await expect(createContainmentComposer({ invoke }).generate(context)).resolves.toEqual({
      explanation_text: '改道 RD_TPE_004',
    });
    expect(invoke).toHaveBeenCalledOnce();
  });

  it('fails closed when Bedrock requests template fallback', async () => {
    const invoke = vi.fn(async () => ({
      outcome: 'use_template' as const,
      reason: 'timeout' as const,
      message: 'timed out',
    }));

    await expect(createContainmentComposer({ invoke }).generate(context)).rejects.toThrow(
      'Bedrock containment composition failed: timeout.',
    );
  });
});
