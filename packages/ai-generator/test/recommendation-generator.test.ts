import type { DecisionCore } from '@city-commander/shared-schemas';
import { describe, expect, it } from 'vitest';
import { buildRecommendationPrompt } from '../src/recommendation-generator.js';

function decisionFixture(): DecisionCore {
  return {
    event_id: 'TPE_2026_ACC_001',
    occurred_at: '2026-05-20 22:10',
    event_facts: {
      type: 'Road_Collapse',
      location: '光復南路與忠孝東路口南側',
      affected_segment: 'RD_TPE_002',
      status: 'Closed',
      severity: 'Critical',
      description: 'test fixture',
      timestamp: '2026-05-20 22:10',
    },
    triggered_articles: [1, 2],
    applied_formula_articles: [7],
    invoked_procedures: ['article2_alternative_route_guidance'],
    primary_evacuation: 'RD_TPE_004',
    secondary_evacuation: ['RD_TPE_005'],
    cms_core_text: '光復南路封閉，請改道市民大道四段，預計延誤 78.6 分鐘',
    ete: {
      calculation_status: 'computed',
      severity: 'Critical',
      base_clearance: 60,
      affected_set: ['RD_TPE_002', 'RD_TPE_004', 'RD_TPE_005'],
      snapshot_provenance: {
        selection_status: 'common_exact_snapshot',
        event_timestamp: '2026-05-20 22:10',
        common_snapshot_timestamp: '2026-05-20 22:00',
        readings: [],
      },
      manual_confirmation_required: false,
      formula_applicability: 'applicable',
      ete_minutes: 78.6,
      congestion_penalty: 18.6,
      avg_saturation: 0.81,
      lower_bound_only: false,
    },
    policy: {
      classification: 'PROVISIONAL_TEAM_POLICY',
      status: 'AWAITING_HOST_REPLY',
      is_official: false,
      guidance_id: 'HG-001',
      time_alignment: {
        mode: 'GLOBAL_AS_OF_EVENT_CUTOFF_LATEST_PRIOR_PER_ENTITY',
        max_staleness_minutes: 30,
        on_insufficient: 'manual_confirmation',
      },
      affected_road: { role: 'display_only' },
      ete: { affected_set: 'INCIDENT_PRIMARY_AND_SELECTED_SECONDARY' },
      incident_anchor: { mode: 'incident_anchor_from_location_text' },
      affected_intersection_scope: { mode: 'unresolved_manual_confirmation' },
      multilingual_scope: { mode: 'current_snapshot_all_available_stations' },
      saturated_vs_congested: 'PARTIALLY_DEFINED',
    },
    evidence: {
      decision_id: 'decision-1',
      classification_reasoning: [],
      excluded_routes: [],
      sop_citations: [],
      data_points: [
        {
          source: 'city_traffic_flow.csv',
          field: 'Saturation_Score',
          value: 1,
          timestamp: '2026-05-20 22:00',
        },
      ],
    },
    decision_id: 'decision-1',
    idempotency_key: 'key-1',
    injection_run_id: 'run-1',
    version: 1,
    core_hash: 'hash',
    source_manifest_hash: 'manifest-hash',
    immutable_after_commit: true,
    classifications: [],
    excluded_candidates: [],
    multilingual_required: false,
    provisional: true,
    schema_version: '1.0',
  };
}

describe('buildRecommendationPrompt', () => {
  it('renders current DecisionCore facts and audit disclosures', () => {
    const prompt = buildRecommendationPrompt(decisionFixture());

    expect(prompt).toContain('事件類型: Road_Collapse');
    expect(prompt).toContain('主疏散路徑 ID: RD_TPE_004');
    expect(prompt).toContain('ETE: 78.6 分鐘');
    expect(prompt).toContain('共同精確快照: 2026-05-20 22:00');
    expect(prompt).toContain('guidance_id: HG-001');
    expect(prompt).toContain('city_traffic_flow.csv.Saturation_Score @ 2026-05-20 22:00');
  });

  it('does not render legacy object routes or disclosure fields', () => {
    const prompt = buildRecommendationPrompt(decisionFixture());

    expect(prompt).not.toContain('[object Object]');
    expect(prompt).not.toContain('road_set_definition');
  });
});

// ─── UARE (TASK-UARE-10): sop_matched:false prompt branch ──────────────────
// Spec: .kiro/specs/unified-adaptive-reasoning-engine/requirements.md R4, R9.6

describe('buildRecommendationPrompt — UARE sop_matched branch', () => {
  it('R9.6 no-regression: sop_matched:true renders the exact pre-UARE line, byte-identical prompt', () => {
    const matchedCore: DecisionCore = { ...decisionFixture(), sop_matched: true };
    const unmatchedFieldCore = decisionFixture(); // sop_matched left undefined, as all pre-UARE cores are

    const promptWithTrue = buildRecommendationPrompt(matchedCore);
    const promptWithUndefined = buildRecommendationPrompt(unmatchedFieldCore);

    // Both must produce the exact same line the pre-UARE template always did.
    expect(promptWithTrue).toContain('- 觸發 SOP 條款: 1, 2');
    expect(promptWithUndefined).toContain('- 觸發 SOP 條款: 1, 2');
    // sop_matched:true and sop_matched:undefined must render identically —
    // the branch condition is specifically `=== false`, not a truthiness check.
    expect(promptWithTrue).toBe(promptWithUndefined);
    // Neither must ever mention the UARE universal-defense section.
    expect(promptWithTrue).not.toContain('通用防禦性交通處置原則');
  });

  it('sop_matched:false with grounding candidates: anti-refusal instruction, only whitelisted road names, principle text', () => {
    const core: DecisionCore = {
      ...decisionFixture(),
      triggered_articles: [],
      sop_matched: false,
      sop_authority: 'SYSTEM_DEFAULT_PRINCIPLE',
      universal_principles: [
        { principle_id: 'UPSTREAM_CONTAINMENT', title: '上游截流', description: '上游截流說明' },
        { principle_id: 'PERIMETER_GUIDANCE', title: '周邊引導', description: '周邊引導說明' },
        { principle_id: 'PUBLIC_NOTIFICATION', title: '資訊通報', description: '資訊通報說明' },
      ],
      grounding_candidates: [
        {
          segment_id: 'RD_TPE_004',
          road_name: '市民大道四段',
          saturation_score: 0.2,
          capacity_vph: 2500,
          status_text: '暢通',
        },
        {
          segment_id: 'RD_TPE_005',
          road_name: '仁愛路四段',
          saturation_score: 0.9,
          capacity_vph: 1800,
          status_text: '注意',
        },
      ],
    };

    const prompt = buildRecommendationPrompt(core);

    expect(prompt).toContain('本事件類型未於 emergency_traffic_sop.txt 查得對應條款');
    expect(prompt).toContain('不得回覆「無法判斷」、「查無資料」或語意相近之拒答語句');
    expect(prompt).toContain('上游截流：上游截流說明');
    expect(prompt).toContain('周邊引導：周邊引導說明');
    expect(prompt).toContain('資訊通報：資訊通報說明');
    expect(prompt).toContain('市民大道四段（暢通');
    expect(prompt).toContain('仁愛路四段（注意');
    expect(prompt).toContain('本事件無預設 SOP 條款，已啟動動態通用防衛模式');
    // Must never leak the old, now-superseded line for this branch.
    expect(prompt).not.toContain('觸發 SOP 條款:');
    // Zero-hallucination guard at the prompt level: no out-of-whitelist road
    // name is ever introduced by this file itself.
    expect(prompt).not.toContain('逸仙路');
  });

  it('sop_matched:false with no grounding candidates forbids naming any specific road (R6)', () => {
    const core: DecisionCore = {
      ...decisionFixture(),
      triggered_articles: [],
      // Realistic for this scenario: only SOP-5 ever sets cms_core_text, and
      // no article triggered here — this also isolates the assertion below to
      // the universal-defense section itself, not an unrelated deterministic field.
      cms_core_text: null as unknown as string,
      primary_evacuation: null,
      secondary_evacuation: [],
      sop_matched: false,
      sop_authority: 'SYSTEM_DEFAULT_PRINCIPLE',
      universal_principles: [
        { principle_id: 'UPSTREAM_CONTAINMENT', title: '上游截流', description: '上游截流說明' },
        { principle_id: 'PERIMETER_GUIDANCE', title: '周邊引導', description: '周邊引導說明' },
        { principle_id: 'PUBLIC_NOTIFICATION', title: '資訊通報', description: '資訊通報說明' },
      ],
      grounding_candidates: [],
    };

    const prompt = buildRecommendationPrompt(core);

    expect(prompt).toContain('無可用替代路段，僅能提供不依賴具體道路之通用處置建議');
    expect(prompt).not.toContain('市民大道四段');
  });
});
