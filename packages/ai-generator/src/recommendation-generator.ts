/**
 * 決策建議書生成器
 *
 * 根據 DecisionCore 產出交控中心建議書，並保留可稽核的政策與資料揭露。
 *
 * @module ai-generator/recommendation-generator
 */

import type { DecisionCore } from '@city-commander/shared-schemas';
import type { TextGenerator } from './bedrock.js';

function formatOptional(value: string | number | null | undefined): string {
  return value === null || value === undefined || value === '' ? '無' : String(value);
}

/**
 * UARE (Unified Adaptive Reasoning Engine, spec: .kiro/specs/unified-adaptive-
 * reasoning-engine/, design.md §6) — the `sop_matched: false` prompt branch.
 *
 * Replaces the old fixed "觸發 SOP 條款: 無" line, which paired with the
 * prompt's closing "不得補造缺失資訊" instruction left the AI with no
 * legitimate basis to cite — pushing it toward either refusal or fabrication
 * (requirements.md §Requirement 4 note, [VERIFIED_GAP]). All content here is
 * sourced from `core.universal_principles` / `core.grounding_candidates` —
 * both decision-core fields written only by the deterministic pipeline
 * (TASK-UARE-08) — never a literal road name or principle text authored in
 * this file.
 */
function buildUniversalDefenseSection(core: DecisionCore): string {
  const principles = (core.universal_principles ?? [])
    .map((principle) => `  - ${principle.title}：${principle.description}`)
    .join('\n');
  const candidates = core.grounding_candidates ?? [];
  const routes =
    candidates.length > 0
      ? candidates
          .map(
            (candidate) =>
              `  - ${candidate.road_name}（${candidate.status_text}，即時壅塞度 ${candidate.saturation_score}）`,
          )
          .join('\n')
      : '  - （無可用替代路段，僅能提供不依賴具體道路之通用處置建議）';

  return `- 本事件類型未於 emergency_traffic_sop.txt 查得對應條款（sop_matched: false）
- 請依下列通用防禦性交通處置原則進行應變推理，不得回覆「無法判斷」、「查無資料」或語意相近之拒答語句：
${principles}
- 僅得使用下列候選路段之名稱，禁止提及清單以外之任何路名或地點：
${routes}
- 請於【判定依據】段落載明：「本事件無預設 SOP 條款，已啟動動態通用防衛模式，依據即時車流分析完成調度」`;
}

/** Build the text-only prompt without changing any deterministic core fact. */
export function buildRecommendationPrompt(core: DecisionCore): string {
  const facts = core.event_facts;
  const ete = core.ete;
  const eteValue =
    ete?.calculation_status === 'computed'
      ? `${ete.ete_minutes} 分鐘`
      : '資料不足，僅可確認基準下限';
  const eteSnapshot = ete?.snapshot_provenance.common_snapshot_timestamp ?? '無共同精確快照';
  const evidenceTimestamps = core.evidence.data_points
    .map((point) => `${point.source}.${point.field} @ ${point.timestamp}`)
    .join('\n- ');
  // sop_matched is optional (undefined for read models built before UARE
  // wiring, TASK-UARE-02) — undefined falls back to the unchanged behavior
  // below, exactly like sop_matched:true, so no legacy core changes shape.
  const sopSection =
    core.sop_matched === false
      ? buildUniversalDefenseSection(core)
      : `- 觸發 SOP 條款: ${core.triggered_articles.join(', ') || '無'}`;

  return `你是一位交通指揮中心的 AI 助手。只能依下列不可變的 DecisionCore 事實撰寫文字，不得重算或更改級別、SOP、道路、ETE、CMS 核心文字或任何數值。

## 事件資訊
- 事件 ID: ${core.event_id}
- 事件類型: ${formatOptional(facts?.type)}
- 位置: ${formatOptional(facts?.location)}
- 受影響路段: ${formatOptional(facts?.affected_segment)}
- 嚴重度: ${formatOptional(facts?.severity)}
- 事件時間/決策截止: ${facts?.timestamp ?? core.occurred_at}
${sopSection}
- 套用公式條款: ${core.applied_formula_articles.join(', ') || '無'}
- 啟用程序: ${core.invoked_procedures.join(', ') || '無'}

## 疏散與正式文字
- 主疏散路徑 ID: ${formatOptional(core.primary_evacuation)}
- 次要疏散路徑 ID: ${core.secondary_evacuation.join(', ') || '無'}
- CMS 核心文字（逐字保留，不得改寫）: ${core.cms_core_text}

## ETE 計算
- 狀態: ${ete?.calculation_status ?? '不適用'}
- ETE: ${eteValue}
- 公式: base_clearance + max(0, (avg_saturation - 0.5) * 60)
- base_clearance: ${formatOptional(ete?.base_clearance)}
- congestion_penalty: ${formatOptional(ete?.congestion_penalty)}
- 受影響集合: ${ete?.affected_set.join(', ') || '無'}
- 共同精確快照: ${eteSnapshot}
- 需人工確認: ${ete?.manual_confirmation_required ?? false}

## 決策揭露
- guidance_id: ${core.policy.guidance_id ?? '無'}
- 政策分類: ${core.policy.classification}
- 時間對齊策略: ${core.policy.time_alignment.mode}
- ETE 集合策略: ${core.policy.ete.affected_set}
- 事故錨點策略: ${core.policy.incident_anchor.mode}
- 多語範圍策略: ${core.policy.multilingual_scope.mode}
- 資料證據時間:
- ${evidenceTimestamps || '無'}

請產出下列章節，所有判定依據必須引用上述 SOP 條款與資料證據，不得補造缺失資訊：
【事件】
【級別】
【時間】
【預估恢復】
【處置建議】
【判定依據】
【決策揭露】`;
}

export class RecommendationGenerator {
  private readonly textGenerator: TextGenerator;

  constructor(textGenerator: TextGenerator) {
    this.textGenerator = textGenerator;
  }

  async generate(core: DecisionCore): Promise<string> {
    return this.textGenerator.generateText(buildRecommendationPrompt(core));
  }
}
