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
