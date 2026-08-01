import type { SafeContext } from '@city-commander/shared-schemas';
import type { BedrockInvoker } from './bedrock_adapter.js';

/** Build a backend-compatible containment composer from the canonical Bedrock port. */
export function createContainmentComposer(invoker: BedrockInvoker): {
  readonly generate: (context: SafeContext) => Promise<unknown>;
} {
  return {
    generate: async (context) => {
      const result = await invoker.invoke(
        [
          '你是交通應變說明文字產生器。只輸出 JSON：{"explanation_text":"..."}。',
          context.instruction,
          JSON.stringify(context),
        ].join('\n'),
      );
      if (result.outcome !== 'success') {
        throw new Error(`Bedrock containment composition failed: ${result.reason}.`);
      }
      return JSON.parse(result.text) as unknown;
    },
  };
}
