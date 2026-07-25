import {
  IncidentStatus,
  IncidentType,
  Severity,
  type Incident,
  type RoadSegment,
} from '@city-commander/shared-schemas';
import type { DecisionCoreBuildInput } from '../../src/decision/decision_core_builder.js';
import { RoadNetworkModel } from '../../src/road_network/road_network_model.js';

export function makeIncident(overrides: Partial<Incident> = {}): Incident {
  return {
    event_id: 'TPE_2026_ACC_001',
    type: IncidentType.Road_Collapse_Accident,
    location: '光復南路與忠孝東路四段南側',
    affected_segment: 'RD_TPE_002',
    status: IncidentStatus.Closed,
    severity: Severity.Critical,
    description: '路面坍塌',
    timestamp: '2026-05-20 22:10',
    ...overrides,
  };
}

export function roadSegments(): RoadSegment[] {
  return [
    { segment_id: 'RD_TPE_002', name: '光復南路', flow_direction: '南北向', intersections: ['市民大道四段', '忠孝東路四段', '仁愛路四段'], capacity_vph: 1500, alternatives: ['RD_TPE_004', 'RD_TPE_005', 'RD_TPE_006', 'RD_TPE_008'], nearby_stations: [] },
    { segment_id: 'RD_TPE_004', name: '市民大道四段', flow_direction: '東西向', intersections: ['光復南路'], capacity_vph: 2500, alternatives: [], nearby_stations: [] },
    { segment_id: 'RD_TPE_005', name: '仁愛路四段', flow_direction: '東西向', intersections: ['光復南路'], capacity_vph: 1800, alternatives: [], nearby_stations: [] },
    { segment_id: 'RD_TPE_006', name: '敦化南路一段', flow_direction: '南北向', intersections: [], capacity_vph: 2000, alternatives: [], nearby_stations: [] },
    { segment_id: 'RD_TPE_008', name: '延吉街', flow_direction: '南北向', intersections: [], capacity_vph: 600, alternatives: [], nearby_stations: [] },
  ];
}

export function roadNetwork(): RoadNetworkModel {
  return RoadNetworkModel.load(roadSegments());
}

export function baseCoreInput(): DecisionCoreBuildInput {
  const incident = makeIncident({ event_id: 'evt-1' });
  return {
    decision_id: 'dec-1', idempotency_key: 'evt-1|2026-05-20 22:10|policy-1', injection_run_id: 'inj-1', workflow_execution_name: 'execution-1',
    version: 1, source_manifest_hash: 'manifest-hash', event_id: incident.event_id, occurred_at: incident.timestamp,
    event_facts: {
      type: incident.type, location: incident.location, affected_segment: incident.affected_segment,
      affected_road: incident.affected_road, status: incident.status, severity: incident.severity,
      description: incident.description, timestamp: incident.timestamp,
    },
    triggered_articles: [1, 2], applied_formula_articles: [7], invoked_procedures: ['article2_alternative_route_guidance'],
    classifications: [{ segment_id: 'RD_TPE_002', level: 'A' }], primary_evacuation: 'RD_TPE_004', secondary_evacuation: ['RD_TPE_005'], excluded_candidates: [], multilingual_required: false,
    ete: {
      severity: Severity.Critical, base_clearance: 60, affected_set: ['RD_TPE_002'], calculation_status: 'computed',
      snapshot_provenance: { selection_status: 'common_exact_snapshot', event_timestamp: incident.timestamp, common_snapshot_timestamp: incident.timestamp, readings: [{ road_id: 'RD_TPE_002', observation_timestamp: incident.timestamp, saturation_score: 1 }] },
      manual_confirmation_required: false, formula_applicability: 'applicable', ete_minutes: 90,
      congestion_penalty: 30, avg_saturation: 1, lower_bound_only: false,
    },
    evidence: { decision_id: 'dec-1', classification_reasoning: [], excluded_routes: [], sop_citations: [], data_points: [] },
    policy: {
      classification: 'PROVISIONAL_TEAM_POLICY', status: 'AWAITING_HOST_REPLY', is_official: false, guidance_id: 'HG-001', official_golden_answer: false,
      time_alignment: { mode: 'exact_or_latest_prior_per_entity', max_staleness_minutes: 10, on_insufficient: 'insufficient_data' },
      affected_road: { role: 'display_only' }, ete: { affected_set: 'incident_primary_and_selected_secondary' }, incident_anchor: { mode: 'incident_anchor_from_location_text' },
      affected_intersection_scope: { mode: 'unresolved_manual_confirmation' }, multilingual_scope: { mode: 'current_snapshot_all_available_stations' }, saturated_vs_congested: 'PARTIALLY_DEFINED',
    },
    cms_core_text: '光復南路封閉，請改道 市民大道四段，預計延誤 78.6 分鐘', provisional: true, schema_version: '1.0.0',
  };
}
