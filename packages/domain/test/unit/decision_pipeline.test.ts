import { describe, expect, it } from 'vitest';
import {
  IncidentStatus,
  IncidentType,
  LaneStatus,
  Severity,
  type Incident,
  type RawCrowdRecord,
  type RawTrafficRecord,
  type RoadSegment,
} from '@city-commander/shared-schemas';
import type { IngestionResult } from '../../src/ingestion/data_ingestion_service.js';
import type { SOPLoadResult } from '../../src/ingestion/sop_loader.js';
import { normalizeTimestamp } from '../../src/ingestion/timestamp_normalizer.js';
import { RoadNetworkModel } from '../../src/road_network/road_network_model.js';
import { runDeterministicDecision } from '../../src/rule_engine/decision_pipeline.js';
import { makeIncident, roadNetwork } from '../helpers/domain-fixtures.js';

// ─── ConfigProvider matching the evt_002 golden HG-001 policy set ──

class LocalConfigProvider {
  constructor(private readonly values: Readonly<Record<string, string | number>>) {}
  get(key: string): string | number {
    const value = this.values[key];
    if (value === undefined) throw new Error(`missing ${key}`);
    return value;
  }
}

const config = new LocalConfigProvider({
  'policy.time_alignment.mode': 'exact_or_latest_prior_per_entity',
  'policy.time_alignment.max_staleness_minutes': 30,
  'policy.affected_road.role': 'display_only',
  'policy.ete.affected_set': 'incident_primary_and_selected_secondary',
  'policy.incident_anchor.mode': 'incident_anchor_from_location_text',
  'policy.affected_intersection_scope.mode': 'unresolved_manual_confirmation',
  'policy.multilingual_scope.mode': 'current_snapshot_all_available_stations',
});

// ─── Fixture builders (reuse official data shapes, never fabricate) ──

function makeSopArticles(): SOPLoadResult {
  const articles = Array.from({ length: 7 }, (_unused, index) => ({
    article_no: index + 1,
    title: `SOP-${index + 1}`,
    text: `SOP article ${index + 1} verbatim text`,
  }));
  const byNo = new Map(articles.map((article) => [article.article_no, article] as const));
  return { articles, getByArticleNo: (articleNo: number) => byNo.get(articleNo) };
}

function trafficRecord(
  segmentId: string,
  roadName: string,
  timestampRaw: string,
  saturation: number,
): RawTrafficRecord {
  return {
    timestamp_raw: timestampRaw,
    Segment_ID: segmentId,
    Road_Name: roadName,
    Avg_Speed: 20,
    Vehicle_Count: 100,
    Saturation_Score: saturation,
    Lane_Status: LaneStatus.Congested,
  };
}

function crowdRecord(
  bsId: string,
  timestampRaw: string,
  userCount: number,
  growthRate: number,
  roamingPct: number,
): RawCrowdRecord {
  return {
    timestamp_raw: timestampRaw,
    BS_ID: bsId,
    Location_Name: bsId,
    User_Count: userCount,
    Stay_Time_Avg: 10,
    Growth_Rate: growthRate,
    Roaming_User_Pct: `${Math.round(roamingPct * 100)}%`,
    roaming_pct_value: roamingPct,
  };
}

interface IngestionOverrides {
  readonly data_status?: IngestionResult['data_status'];
  readonly stop_reason?: string | null;
  readonly source_manifest_hash?: string;
  readonly traffic?: readonly RawTrafficRecord[];
  readonly crowd?: readonly RawCrowdRecord[];
  readonly roadNetwork?: RoadNetworkModel;
  readonly incidents?: readonly Incident[];
}

function makeIngestion(overrides: IngestionOverrides = {}): IngestionResult {
  if (overrides.data_status === 'insufficient_data') {
    return {
      data_status: 'insufficient_data',
      source_manifest_hash: overrides.source_manifest_hash ?? '',
      stop_reason: overrides.stop_reason ?? 'source hash mismatch',
    };
  }
  const traffic = overrides.traffic ?? [];
  const crowd = overrides.crowd ?? [];
  return {
    data_status: 'ready',
    source_manifest_hash: overrides.source_manifest_hash ?? 'test-manifest-hash',
    stop_reason: null,
    traffic,
    trafficTimestamps: traffic.map((record) => normalizeTimestamp(record.timestamp_raw)),
    crowd,
    crowdTimestamps: crowd.map((record) => normalizeTimestamp(record.timestamp_raw)),
    roadNetwork: overrides.roadNetwork ?? roadNetwork(),
    sopArticles: makeSopArticles(),
    incidents: overrides.incidents ?? [],
  };
}

// ─── Tests ─────────────────────────────────────────────────

describe('runDeterministicDecision facade', () => {
  it('reproduces the ACC_001 golden (art.1+2, art.7 ETE 78.6, RD_TPE_004 primary)', () => {
    const incident = makeIncident({ location: '光復南路與忠孝東路口南側' });
    const ingestion = makeIngestion({
      traffic: [
        trafficRecord('RD_TPE_002', '光復南路', '2026-05-20 22:00', 1),
        trafficRecord('RD_TPE_004', '市民大道四段', '2026-05-20 22:00', 0.78),
        trafficRecord('RD_TPE_005', '仁愛路四段', '2026-05-20 22:00', 0.65),
        trafficRecord('RD_TPE_006', '敦化南路一段', '2026-05-20 22:00', 0.4),
        trafficRecord('RD_TPE_008', '延吉街', '2026-05-20 22:00', 0.2),
      ],
    });

    const result = runDeterministicDecision({ ingestion, config, incident });

    expect(result.data_status).toBe('ready');
    const facts = result.facts;
    expect(facts).not.toBeNull();
    if (facts === null) return;

    expect(facts.triggered_articles).toEqual([1, 2]);
    expect(facts.applied_formula_articles).toEqual([7]);
    expect(facts.citation_article_set).toEqual([1, 2, 7]);
    expect(facts.invoked_procedures).toContain('article2_alternative_route_guidance');
    expect(facts.primary_evacuation).toBe('RD_TPE_004');
    expect(facts.secondary_evacuation).toEqual(['RD_TPE_005']);
    expect(
      facts.excluded_candidates.find((route) => route.segment_id === 'RD_TPE_008')
        ?.exclusion_reason,
    ).toContain('600');
    expect(facts.ete?.ete_minutes).toBeCloseTo(78.6, 10);
  });

  it('reproduces the EVT_002 golden (art.3 from BL17, affected_road context-only, no ETE)', () => {
    const incident = makeIncident({
      event_id: 'TPE_2026_EVT_002',
      type: IncidentType.Crowd_Surge_Injury,
      affected_segment: 'BS_MRT_BL17',
      affected_road: 'RD_TPE_001',
      status: IncidentStatus.Restricted,
      severity: Severity.High,
      timestamp: '2026-05-20 22:20',
    });
    const ingestion = makeIngestion({
      crowd: [
        crowdRecord('BS_MRT_BL17', '2026-05-20 22:15', 31_000, 0.2, 0.1),
        crowdRecord('BS_MRT_BL17', '2026-05-20 22:25', 1, 0, 0.1),
      ],
    });

    const result = runDeterministicDecision({ ingestion, config, incident });
    const facts = result.facts;
    expect(facts).not.toBeNull();
    if (facts === null) return;

    // Article 3 is computed from the latest-prior BL17 selection and triggers.
    expect(facts.triggered_articles).toContain(3);
    // Affected_road stays display-only and never satisfies art.2.
    expect(facts.triggered_articles).not.toContain(2);
    expect(facts.affected_road).toMatchObject({
      role: 'display_only',
      affected_road: 'RD_TPE_001',
      include_in_ete_context: false,
      directly_triggers_article2: false,
    });
    // ETE is not applicable for a BS_ event.
    expect(facts.ete).toBeNull();
  });

  it('reproduces the EVT_003 golden (art.5 unresolved police scope, official CMS, ETE 41)', () => {
    const segments: RoadSegment[] = [
      {
        segment_id: 'RD_TPE_007',
        name: '松高路',
        flow_direction: '南北向',
        intersections: ['市府路', '松壽路'],
        capacity_vph: 1500,
        alternatives: ['RD_TPE_011'],
        nearby_stations: [],
      },
      {
        segment_id: 'RD_TPE_011',
        name: '市府路',
        flow_direction: '東西向',
        intersections: ['松高路'],
        capacity_vph: 1800,
        alternatives: [],
        nearby_stations: [],
      },
    ];
    const incident = makeIncident({
      event_id: 'TPE_2026_EVT_003',
      type: IncidentType.Power_Failure,
      location: '松高路與松壽路口',
      affected_segment: 'RD_TPE_007',
      status: IncidentStatus.Restricted,
      severity: Severity.Medium,
      timestamp: '2026-05-20 22:30',
    });
    const ingestion = makeIngestion({
      roadNetwork: RoadNetworkModel.load(segments),
      traffic: [
        trafficRecord('RD_TPE_007', '松高路', '2026-05-20 22:30', 0.85),
        trafficRecord('RD_TPE_011', '市府路', '2026-05-20 22:30', 0.85),
      ],
    });

    const result = runDeterministicDecision({ ingestion, config, incident });
    const facts = result.facts;
    expect(facts).not.toBeNull();
    if (facts === null) return;

    expect(facts.triggered_articles).toContain(5);
    expect(facts.cms_core_text).toBe('松高路 號誌故障，請依現場指揮通行');
    expect(facts.affected_intersection_scope).toMatchObject({
      police_per_intersection: 2,
      affected_intersection_count: 'unresolved',
      manual_confirmation_required: true,
      official_golden_answer: false,
    });
    expect(facts.primary_evacuation).toBe('RD_TPE_011');
    expect(facts.ete?.ete_minutes).toBe(41);
  });

  it('reproduces the DOME + SOP-6 golden (art.4 dispersal linking art.3, multilingual at 35%)', () => {
    const incident = makeIncident({
      event_id: 'TPE_2026_DOME',
      type: IncidentType.Crowd_Surge_Injury,
      affected_segment: 'BS_TPE_DOME',
      status: IncidentStatus.Restricted,
      severity: Severity.High,
      timestamp: '2026-05-20 22:30',
    });
    const ingestion = makeIngestion({
      crowd: [
        crowdRecord('BS_TPE_DOME', '2026-05-20 22:00', 40_000, 0.1, 0.35),
        crowdRecord('BS_TPE_DOME', '2026-05-20 22:30', 27_600, -0.31, 0.35),
      ],
    });

    const result = runDeterministicDecision({ ingestion, config, incident });
    const facts = result.facts;
    expect(facts).not.toBeNull();
    if (facts === null) return;

    expect(facts.triggered_articles).toContain(4);
    expect(facts.invoked_procedures).toContain('article3_mrt_shuttle_mechanism');
    expect(facts.multilingual_required).toBe(true);
    expect(facts.multilingual_scope?.stations_in_scope).toContain('BS_TPE_DOME');
  });

  it('returns insufficient_data with facts:null on a source-hash STOP (never fabricates)', () => {
    const incident = makeIncident();
    const ingestion = makeIngestion({
      data_status: 'insufficient_data',
      stop_reason: 'source manifest hash mismatch',
    });

    const result = runDeterministicDecision({ ingestion, config, incident });

    expect(result.data_status).toBe('insufficient_data');
    expect(result.stop_reason).toContain('mismatch');
    expect(result.facts).toBeNull();
  });
});
