import { NarrativeType, type ContainmentComposerValidation } from '@city-commander/shared-schemas';
import { validateBedrockPayload } from './schema_validator.js';

/** Validate containment explanation payloads through the canonical RAG schema gate. */
export function validateContainmentComposerOutput(payload: unknown): ContainmentComposerValidation {
  const result = validateBedrockPayload(NarrativeType.EXPLANATION, payload);
  if (result.outcome === 'use_template') return result;
  const text = result.fields['explanation_text'];
  if (text === undefined) {
    return {
      outcome: 'use_template',
      reason: 'non_whitelisted_field',
      offendingFields: ['explanation_text'],
    };
  }
  return { outcome: 'accepted', text };
}

/** Production-ready structural adapter for backend's validator port. */
export const containmentComposerOutputValidator = {
  validate: validateContainmentComposerOutput,
} as const;
