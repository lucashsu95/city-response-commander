/**
 * Bedrock API 調用封裝
 *
 * @module ai-generator/bedrock
 */

export interface BedrockConfig {
  readonly region: string;
  readonly modelId: string;
}

/** Text-only generation boundary shared by the real and LOCAL_MOCK adapters. */
export interface TextGenerator {
  generateText(prompt: string): Promise<string>;
}

export class BedrockClient implements TextGenerator {
  private readonly config: BedrockConfig;

  constructor(config: BedrockConfig) {
    this.config = config;
  }

  async generateText(prompt: string): Promise<string> {
    if (process.env.CITY_COMMANDER_ENV === 'LOCAL_MOCK' || process.env.NODE_ENV === 'local') {
      return `[MOCK] ${prompt.substring(0, 100)}...`;
    }

    // Keep the selected model configuration attached to this adapter until the
    // real Bedrock implementation lands; no network fallback is permitted.
    throw new Error(
      `Bedrock API not implemented for model ${this.config.modelId}; use CITY_COMMANDER_ENV=LOCAL_MOCK`,
    );
  }
}
