/**
 * 決策建議書生成器
 *
 * 根據 DecisionCore 產出交控中心建議書，
 * 確保每次產出都包含揭露區塊。
 *
 * @module ai-generator/recommendation-generator
 */

import type {
  DecisionCore,
  Disclosure,
  RecommendationTemplate,
} from '@city-commander/shared-schemas';
import { BedrockClient } from './bedrock.js';

export class RecommendationGenerator {
  private readonly bedrock: BedrockClient;

  constructor(bedrock: BedrockClient) {
    this.bedrock = bedrock;
  }

  /**
   * 生成建議書文案
   *
   * 根據主辦單位回覆，評分重點在於 AI 推理過程是否嚴謹、
   * 是否正確引用 SOP 條款，而非唯一的運算結果。
   *
   * 因此建議書必須包含揭露區塊，確保評審可完整追溯決策依據。
   */
  async generate(core: DecisionCore): Promise<string> {
    const disclosure = core.disclosure;

    const prompt = this.buildPrompt(core, disclosure);
    const result = await this.bedrock.generateText(prompt);

    return result;
  }

  private buildPrompt(core: DecisionCore, disclosure: Disclosure): string {
    const triggeredSops = core.triggered_articles.join(', ');
    const roadSet = disclosure.road_set_definition;
    const eteFormula = disclosure.ete_formula;
    const assumptions = disclosure.assumptions.join('\n- ');

    return `你是一位交通指揮中心的 AI 助手，請根據以下決策核心資料，產出一份交控中心建議書。

## 事件資訊
- 事件 ID: ${core.event_id}
- 事件類型: ${core.incident_type}
- 受影響路段: ${core.affected_segment}
- 嚴重度: ${core.severity}
- 觸發的 SOP 條款: ${triggeredSops}

## 疏散路徑
- 主疏散路徑: ${core.primary_evacuation?.road_name || '無'}
- 次要疏散路徑: ${              core.secondary_evacuation?.map((r: { road_name: string }) => r.road_name).join(', ') || '無'}

## ETE 計算
- ETE: ${core.ete?.ete_minutes || '無'} 分鐘
- 公式: ${eteFormula}
- 輸入值: base_clearance=${disclosure.ete_inputs.base_clearance}, congestion_penalty=${disclosure.ete_inputs.congestion_penalty}

## 決策揭露（確保評審可完整追溯決策依據）
- 使用的資料時間: ${disclosure.data_timestamp.display}
- 使用的路段集合: ${roadSet}
- 時間對齊策略: ${disclosure.time_alignment_note}
- 團隊採用的實作假設:
- ${assumptions}

請產出建議書文案，格式如下：
【事件】...
【級別】...
【時間】...
【預估恢復】...

【處置建議】
1. ...
2. ...

【判定依據】
- ...引用 SOP 條款...

【決策揭露】
- 使用的資料時間: ...
- 使用的路段集合: ...
- 計算公式: ...
- 輸入值: ...
- 實作假設: ...`;
  }
}
