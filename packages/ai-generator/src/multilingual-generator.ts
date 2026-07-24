/**
 * 多語通報生成器
 *
 * 根據事件資訊產出中英日韓 4 種語言的通報文案。
 *
 * @module ai-generator/multilingual-generator
 */

import { Language } from '@city-commander/shared-schemas';
import { BedrockClient } from './bedrock.js';

export interface MultilingualAlertInput {
  readonly event_id: string;
  readonly event_type: string;
  readonly location: string;
  readonly severity: string;
  readonly primary_route?: string;
  readonly secondary_routes?: readonly string[];
  readonly ete_minutes?: number;
  readonly triggered_sops: readonly number[];
}

export class MultilingualGenerator {
  private readonly bedrock: BedrockClient;

  constructor(bedrock: BedrockClient) {
    this.bedrock = bedrock;
  }

  async generate(input: MultilingualAlertInput): Promise<Record<Language, string>> {
    const results: Partial<Record<Language, string>> = {};

    for (const lang of [Language.ZH, Language.EN, Language.JA, Language.KO]) {
      const prompt = this.buildPrompt(input, lang);
      results[lang] = await this.bedrock.generateText(prompt);
    }

    return results as Record<Language, string>;
  }

  private buildPrompt(input: MultilingualAlertInput, lang: Language): string {
    const langNames: Record<Language, string> = {
      [Language.ZH]: '中文',
      [Language.EN]: 'English',
      [Language.JA]: '日本語',
      [Language.KO]: '한국어',
    };

    const routes = [
      input.primary_route,
      ...(input.secondary_routes || []),
    ].filter(Boolean).join('、');

    return `你是一位交通指揮中心的 AI 助手，請用${langNames[lang]}產出一份交通警示通報。

## 事件資訊
- 事件類型: ${input.event_type}
- 位置: ${input.location}
- 嚴重度: ${input.severity}
- 建議路線: ${routes}
- 預計恢復時間: ${input.ete_minutes || '未知'} 分鐘

請產出簡潔的警示通報，格式如下：
【交通警示】...
建議路線：...
預計恢復時間：...`;
  }
}
