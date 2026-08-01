/**
 * Shared decision-panel test fixtures (TASK-129/130/131/132).
 *
 * `wireDecision()` builds a payload in the *wire* shape (snake_case, as the
 * live `GET /decisions/{decision_id}` handler emits it) so decoder tests
 * exercise the real boundary. `decisionState()` builds an already-decoded
 * controller state for presentation tests.
 *
 * Values follow the ACC_001 walkthrough in design §11.4 / §12.
 */

import { decodeDecisionReadModel } from '../../src/decision/decision_read_model.js';
import type {
  DecisionCoreView,
  DecisionReadModel,
} from '../../src/decision/decision_read_model.js';
import type { DecisionReadModelState } from '../../src/decision/use_decision_read_model.js';

export type WireRecord = Record<string, unknown>;

export function wireEte(overrides: WireRecord = {}): WireRecord {
  return {
    severity: 'Critical',
    base_clearance: 60,
    affected_set: ['RD_TPE_002', 'RD_TPE_004', 'RD_TPE_005'],
    calculation_status: 'computed',
    snapshot_provenance: {
      selection_status: 'common_exact_snapshot',
      event_timestamp: '2026-05-20 22:10',
      common_snapshot_timestamp: '2026-05-20 22:00',
      readings: [
        {
          road_id: 'RD_TPE_002',
          observation_timestamp: '2026-05-20 22:00',
          saturation_score: 1.0,
        },
        {
          road_id: 'RD_TPE_004',
          observation_timestamp: '2026-05-20 22:00',
          saturation_score: 0.78,
        },
        {
          road_id: 'RD_TPE_005',
          observation_timestamp: '2026-05-20 22:00',
          saturation_score: 0.65,
        },
      ],
    },
    manual_confirmation_required: false,
    formula_applicability: 'applicable',
    applicability_note:
      'HG-001 organizer-guided set: incident road, selected primary, and selected secondary evacuation roads.',
    ete_minutes: 78.6,
    congestion_penalty: 18.6,
    avg_saturation: 0.81,
    lower_bound_only: false,
    ...overrides,
  };
}

export function wirePolicy(overrides: WireRecord = {}): WireRecord {
  return {
    classification: 'PROVISIONAL_TEAM_POLICY',
    status: 'AWAITING_HOST_REPLY',
    is_official: false,
    guidance_id: 'HG-001',
    time_alignment: {
      mode: 'GLOBAL_AS_OF_EVENT_CUTOFF_LATEST_PRIOR_PER_ENTITY',
      max_staleness_minutes: 15,
      on_insufficient: 'INSUFFICIENT_DATA',
    },
    affected_road: { role: 'display_only' },
    ete: { affected_set: 'INCIDENT_PRIMARY_AND_SELECTED_SECONDARY' },
    incident_anchor: { mode: 'incident_anchor_from_location_text' },
    affected_intersection_scope: { mode: 'unresolved_manual_confirmation' },
    multilingual_scope: { mode: 'current_snapshot_all_available_stations' },
    saturated_vs_congested: 'PARTIALLY_DEFINED',
    ...overrides,
  };
}

/**
 * One `excluded_candidates[]` entry in the live `RouteCandidate` wire shape
 * (§10.8). `RD_TPE_008` is the ACC_001 capacity failure.
 */
export function wireRouteCandidate(overrides: WireRecord = {}): WireRecord {
  return {
    segment_id: 'RD_TPE_008',
    capacity_vph: 600,
    passes_capacity: false,
    is_direct_intersection: true,
    upstream_or_downstream: 'upstream',
    saturation_at_snapshot: 0.32,
    role: 'excluded',
    exclusion_reason: 'capacity_vph 600 < 1000',
    ...overrides,
  };
}

/** `incident_anchor` in the live wire shape (§10.8a); resolved by default. */
export function wireIncidentAnchor(overrides: WireRecord = {}): WireRecord {
  return {
    affected_road: 'RD_TPE_002',
    anchor_intersection: '忠孝東路四段',
    anchor_index: 1,
    travel_direction: '南下',
    position_relative_to_intersection: 'south',
    resolution_confidence: 'high',
    source_evidence: "location='光復南路與忠孝東路口南側'",
    manual_confirmation_required: false,
    unranked_direct_intersections: [],
    provisional: true,
    ...overrides,
  };
}

export function wireEvidence(overrides: WireRecord = {}): WireRecord {
  return {
    decision_id: 'dec-acc001',
    classification_reasoning: [
      {
        segment_id: 'RD_TPE_002',
        value: 1.0,
        threshold: '>= 0.95',
        conclusion: 'A',
      },
      {
        segment_id: 'RD_TPE_004',
        value: 0.78,
        threshold: '0.85 <= score < 0.95',
        conclusion: 'normal',
      },
    ],
    excluded_routes: [
      { segment_id: 'RD_TPE_008', reason: 'capacity_vph 600 < 1000' },
      { segment_id: 'RD_TPE_006', reason: '不在 RD_TPE_002 的 intersections（非直接相交）' },
    ],
    sop_citations: [
      {
        article_no: 1,
        source_location: 's3://sop/emergency_traffic_sop.txt#article-1',
        content: '第 1 條：壅塞分級與應變措施。',
        score: 0.94,
      },
      {
        article_no: 2,
        source_location: 's3://sop/emergency_traffic_sop.txt#article-2',
        content: '第 2 條：車禍與路障主疏散路徑。',
        score: 0.91,
      },
      {
        article_no: 7,
        source_location: 's3://sop/emergency_traffic_sop.txt#article-7',
        content: '第 7 條：ETE 計算公式。',
        score: 0.88,
      },
    ],
    data_points: [
      {
        source: 'city_traffic_flow.csv',
        field: 'Saturation_Score',
        value: 1.0,
        timestamp: '2026-05-20 22:00',
      },
      {
        source: 'live_incidents.json',
        field: 'severity',
        value: 'Critical',
        timestamp: '2026-05-20 22:10',
      },
    ],
    ...overrides,
  };
}

export function wireCore(overrides: WireRecord = {}): WireRecord {
  return {
    decision_id: 'dec-acc001',
    idempotency_key: 'TPE_2026_ACC_001|2026-05-20 22:10|prov-2026a',
    injection_run_id: 'inj-7f3a',
    version: 1,
    core_hash: 'sha256:ab34',
    source_manifest_hash: 'sha256:9c1f',
    immutable_after_commit: true,
    event_id: 'TPE_2026_ACC_001',
    occurred_at: '2026-05-20 22:10',
    event_facts: {
      type: 'Road_Collapse_Accident',
      location: '光復南路與忠孝東路口南側',
      affected_segment: 'RD_TPE_002',
      status: 'Closed',
      severity: 'Critical',
      description: '路面塌陷事故',
      timestamp: '2026-05-20 22:10',
    },
    triggered_articles: [1, 2],
    applied_formula_articles: [7],
    invoked_procedures: ['article2_alternative_route_guidance'],
    classifications: [
      { segment_id: 'RD_TPE_002', level: 'A' },
      { segment_id: 'RD_TPE_004', level: 'B' },
    ],
    primary_evacuation: 'RD_TPE_004',
    secondary_evacuation: ['RD_TPE_005'],
    excluded_candidates: [],
    ete: wireEte(),
    multilingual_required: true,
    evidence: wireEvidence(),
    policy: wirePolicy(),
    cms_core_text: 'RD_TPE_002 封閉，請改道 RD_TPE_004，預計延誤 78.6 分鐘',
    provisional: true,
    schema_version: '1.0',
    ...overrides,
  };
}

export function wireNarrative(
  narrativeType: string,
  payload: WireRecord,
  overrides: WireRecord = {},
): WireRecord {
  return {
    decision_id: 'dec-acc001',
    narrative_type: narrativeType,
    core_version_ref: 1,
    ready_event_id: `dec-acc001|${narrativeType}|1`,
    payload,
    ...overrides,
  };
}

export function wireDecision(overrides: WireRecord = {}): WireRecord {
  return {
    schema_version: '1.0',
    trace_id: 'tr-abc123',
    decision_id: 'dec-acc001',
    data_status: 'ready',
    core: wireCore(),
    narratives: [
      wireNarrative('REPORT', {
        type: 'REPORT',
        report_text: '交控中心建議書內文（AI 生成）',
        cms_explanation_text: 'AI 補充：建議提前引導車流。',
        citations_presentation: 'inline',
      }),
      wireNarrative('PUBLIC_ALERT', {
        type: 'PUBLIC_ALERT',
        public_alert_text: {
          zh: '光復南路封閉，請改道 RD_TPE_004。',
          en: 'Road closed. Detour via RD_TPE_004.',
        },
      }),
      wireNarrative('EXPLANATION', {
        type: 'EXPLANATION',
        explanation_text: '判定為 A 級並排除低容量候選。',
      }),
    ],
    missing_narrative_types: [],
    publish: {
      decision_id: 'dec-acc001',
      publish_state: 'draft',
      channels: ['CMS', 'SMS'],
      audit_trail: [
        {
          actor: 'commander-1',
          action: 'create_draft',
          from_state: null,
          to_state: 'draft',
          at: '2026-05-20 22:11',
        },
      ],
      version: 1,
      updated_at: '2026-05-20 22:11',
    },
    execution: { status: 'completed', last_error: null, retryable: false, attempt_count: 1 },
    policy_version: 'prov-2026a',
    provisional: true,
    source_manifest_hash: 'sha256:9c1f',
    ...overrides,
  };
}

/** Decodes a wire fixture, failing the fixture loudly if it is not valid. */
export function decodedModel(overrides: WireRecord = {}): DecisionReadModel {
  const result = decodeDecisionReadModel(wireDecision(overrides));
  if (!result.ok) {
    throw new Error(`fixture failed to decode: ${result.error.code} ${result.error.message}`);
  }
  return result.model;
}

export function coreView(overrides: WireRecord = {}): DecisionCoreView {
  const core = decodedModel({ core: wireCore(overrides) }).core;
  if (core === null) throw new Error('fixture produced a null core');
  return core;
}

/** An already-decoded controller state for presentation tests. */
export function decisionState(
  overrides: Partial<DecisionReadModelState> = {},
  wireOverrides: WireRecord = {},
): DecisionReadModelState {
  const model = decodedModel(wireOverrides);
  return {
    state: 'ready',
    decisionId: model.decisionId,
    dataStatus: model.dataStatus,
    core: model.core,
    report: model.report,
    alert: model.alert,
    explanation: model.explanation,
    missingNarrativeTypes: model.missingNarrativeTypes,
    publish: model.publish,
    execution: model.execution,
    policyVersion: model.policyVersion,
    provisional: model.provisional,
    schemaVersion: model.schemaVersion,
    traceId: model.traceId,
    sourceManifestHash: model.sourceManifestHash,
    refreshStatus: 'idle',
    error: null,
    ...overrides,
  };
}

export function noop(): void {
  // intentionally empty
}
