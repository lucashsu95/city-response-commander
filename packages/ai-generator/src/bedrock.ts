/**
 * Bedrock API 調用封裝
 *
 * @module ai-generator/bedrock
 */

import type { DecisionCore, Disclosure, RecommendationTemplate } from '@city-commander/shared-schemas';

export interface BedrockConfig {
  readonly region: string;
  readonly modelId: string;
}

export class BedrockClient {
  private readonly config: BedrockConfig;

  constructor(config: BedrockConfig) {
    this.config = config;
  }

  async generateText(prompt: string): Promise<string> {
    if (process.env.NODE_ENV === 'local') {
      return `[MOCK] ${prompt.substring(0, 100)}...`;
    }

    // TODO: 實作真實 Bedrock API 調用
    throw new Error('Bedrock API not implemented yet');
  }
}
