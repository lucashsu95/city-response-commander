/**
 * Integration tests for the Grey-Zone Arbitration Engine (GZAE) wired into
 * `runDeterministicDecision` — requirements.md R5 AC4, AC5, AC7, AC8.
 */

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

// ─── ConfigProvider (mirrors decision_pipeline.test.ts) ────────────────────

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

// ─── Fixture builders ───────────────────────────────────────────────────────

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
  readonly traffic?: readonly RawTrafficRecord[];
  readonly crowd?: readonly RawCrowdRecord[];
  readonly roadNetwork?: RoadNetworkModel;
  readonly incidents?: readonly Incident[];
}

function makeIngestion(overrides: IngestionOverrides = {}): IngestionResult {
  const traffic = overrides.traffic ?? [];
  const crowd = overrides.crowd ?? [];
  return {
    data_status: 'ready',
    source_manifest_hash: 'test-manifest-hash',
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

// ─── R5 AC4: no-regression across the 3 official incidents ────────────────

describe('GZAE no-regression — official incidents (R5 AC4)', () => {
  it('ACC_001: triggered_articles/classifications/evacuation unchanged by GZAE', () => {
    const incident = makeIncident({ location: '光復南路與忠孝東路口南側' });
    const ingestion = makeIngestion({
      incidents: [incident],
      traffic: [
        trafficRecord('RD_TPE_002', '光復南路', '2026-05-20 22:00', 1),
        trafficRecord('RD_TPE_004', '市民大道四段', '2026-05-20 22:00', 0.78),
        trafficRecord('RD_TPE_005', '仁愛路四段', '2026-05-20 22:00', 0.65),
        trafficRecord('RD_TPE_006', '敦化南路一段', '2026-05-20 22:00', 0.4),
        trafficRecord('RD_TPE_008', '延吉街', '2026-05-20 22:00', 0.2),
      ],
    });

    const facts = runDeterministicDecision({ ingestion, config, incident }).facts;
    expect(facts).not.toBeNull();
    if (facts === null) return;

    expect(facts.triggered_articles).toEqual([1, 2]);
    expect(facts.classifications).toEqual([{ segment_id: 'RD_TPE_002', level: 'A' }]);
    expect(facts.primary_evacuation).toBe('RD_TPE_004');
    expect(facts.secondary_evacuation).toEqual(['RD_TPE_005']);
    // No other active incidents in this run: GZAE contributes no side effects.
    expect(facts.self_blocked_exclusions).toEqual([]);
    expect(facts.cascading_risk).toBeNull();
  });

  it('EVT_002: triggered_articles unchanged by GZAE', () => {
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
      incidents: [incident],
      crowd: [
        crowdRecord('BS_MRT_BL17', '2026-05-20 22:15', 31_000, 0.2, 0.1),
        crowdRecord('BS_MRT_BL17', '2026-05-20 22:25', 1, 0, 0.1),
      ],
    });

    const facts = runDeterministicDecision({ ingestion, config, incident }).facts;
    expect(facts).not.toBeNull();
    if (facts === null) return;

    expect(facts.triggered_articles).toContain(3);
    expect(facts.triggered_articles).not.toContain(2);
    expect(facts.self_blocked_exclusions).toEqual([]);
    expect(facts.cascading_risk).toBeNull();
  });

  it('EVT_003: triggered_articles/primary_evacuation unchanged by GZAE', () => {
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
      incidents: [incident],
      roadNetwork: RoadNetworkModel.load(segments),
      traffic: [
        trafficRecord('RD_TPE_007', '松高路', '2026-05-20 22:30', 0.85),
        trafficRecord('RD_TPE_011', '市府路', '2026-05-20 22:30', 0.85),
      ],
    });

    const facts = runDeterministicDecision({ ingestion, config, incident }).facts;
    expect(facts).not.toBeNull();
    if (facts === null) return;

    expect(facts.triggered_articles).toContain(5);
    expect(facts.primary_evacuation).toBe('RD_TPE_011');
    expect(facts.self_blocked_exclusions).toEqual([]);
    expect(facts.cascading_risk).toBeNull();
  });

  it('the 3 official incidents together produce cascading_risk: null (not mutually adjacent / ACC_001 already triggers art.2)', () => {
    const acc001 = makeIncident({ location: '光復南路與忠孝東路口南側' });
    const evt002 = makeIncident({
      event_id: 'TPE_2026_EVT_002',
      type: IncidentType.Crowd_Surge_Injury,
      affected_segment: 'BS_MRT_BL17',
      affected_road: 'RD_TPE_001',
      status: IncidentStatus.Restricted,
      severity: Severity.High,
      timestamp: '2026-05-20 22:20',
    });
    const evt003 = makeIncident({
      event_id: 'TPE_2026_EVT_003',
      type: IncidentType.Power_Failure,
      affected_segment: 'RD_TPE_007',
      status: IncidentStatus.Restricted,
      severity: Severity.Medium,
      timestamp: '2026-05-20 22:30',
    });
    const ingestion = makeIngestion({
      incidents: [acc001, evt002, evt003],
      traffic: [trafficRecord('RD_TPE_002', '光復南路', '2026-05-20 22:00', 1)],
    });

    const facts = runDeterministicDecision({ ingestion, config, incident: acc001 }).facts;
    expect(facts).not.toBeNull();
    if (facts === null) return;
    expect(facts.cascading_risk).toBeNull();
  });
});

// ─── R5 AC5: R1 self-blocked candidate exclusion ───────────────────────────

describe('GZAE R1 integration — self-blocked candidate exclusion (R5 AC5)', () => {
  it('excludes RD_TPE_004 when a second incident blocks it, leaves RD_TPE_005 unaffected', () => {
    const incident = makeIncident({ location: '光復南路與忠孝東路口南側' });
    const blocker: Incident = {
      event_id: 'TPE_2026_EVT_099',
      type: IncidentType.Road_Collapse_Accident,
      location: '市民大道四段',
      affected_segment: 'RD_TPE_004',
      status: IncidentStatus.Closed,
      severity: Severity.Critical,
      description: '另一起獨立事故封閉市民大道四段',
      timestamp: '2026-05-20 22:05',
    };
    const ingestion = makeIngestion({
      incidents: [incident, blocker],
      traffic: [
        trafficRecord('RD_TPE_002', '光復南路', '2026-05-20 22:00', 1),
        trafficRecord('RD_TPE_004', '市民大道四段', '2026-05-20 22:00', 0.78),
        trafficRecord('RD_TPE_005', '仁愛路四段', '2026-05-20 22:00', 0.65),
        trafficRecord('RD_TPE_006', '敦化南路一段', '2026-05-20 22:00', 0.4),
        trafficRecord('RD_TPE_008', '延吉街', '2026-05-20 22:00', 0.2),
      ],
    });

    const facts = runDeterministicDecision({ ingestion, config, incident }).facts;
    expect(facts).not.toBeNull();
    if (facts === null) return;

    expect(facts.self_blocked_exclusions).toEqual(['RD_TPE_004']);
    // RD_TPE_004 was the only role=primary candidate; EvacuationSelector
    // (evacuation_selector.ts) selects primary only from role=primary
    // candidates at call time and never promotes a role=secondary one, so
    // excluding it here correctly yields no_candidate_note, not a fallback.
    expect(facts.primary_evacuation).toBeNull();
    // RD_TPE_005 (role=secondary, downstream) is untouched by this exclusion.
    expect(facts.secondary_evacuation).toEqual(['RD_TPE_005']);
    expect(
      facts.excluded_candidates.find((route) => route.segment_id === 'RD_TPE_004')
        ?.exclusion_reason,
    ).toBe('候選路段本身正被事件 TPE_2026_EVT_099 封鎖（status: Closed）');
  });
});

// ─── R5 AC7: R3 signal conflict flagging ───────────────────────────────────

describe('GZAE R3 integration — cross-article signal conflicts (R5 AC7)', () => {
  it('flags crowd_heavy_traffic_light for RD_TPE_001 when traffic is free but BL17 crowd triggers', () => {
    const segments: RoadSegment[] = [
      {
        segment_id: 'RD_TPE_001',
        name: '忠孝東路四段',
        flow_direction: '東西向',
        intersections: [],
        capacity_vph: 3000,
        alternatives: [],
        nearby_stations: ['BS_MRT_BL17'],
      },
    ];
    const incident = makeIncident({
      affected_segment: 'RD_TPE_001',
      status: IncidentStatus.Caution,
      severity: Severity.Medium,
      description: '一般巡查通報',
    });
    const ingestion = makeIngestion({
      incidents: [incident],
      roadNetwork: RoadNetworkModel.load(segments),
      traffic: [trafficRecord('RD_TPE_001', '忠孝東路四段', '2026-05-20 22:10', 0.3)],
      crowd: [crowdRecord('BS_MRT_BL17', '2026-05-20 22:05', 30_000, 0.4, 0.1)],
    });

    const facts = runDeterministicDecision({ ingestion, config, incident }).facts;
    expect(facts).not.toBeNull();
    if (facts === null) return;

    expect(facts.signal_conflicts).toEqual([
      {
        segment_id: 'RD_TPE_001',
        conflict_type: 'crowd_heavy_traffic_light',
        advisory_text: '車道彈性縮減並限速，優先保障行人通行',
      },
    ]);
  });

  it('flags traffic_heavy_crowd_light for RD_TPE_002 when traffic is A-level but nearby crowd is quiet', () => {
    const segments: RoadSegment[] = [
      {
        segment_id: 'RD_TPE_002',
        name: '光復南路',
        flow_direction: '南北向',
        intersections: ['市民大道四段', '忠孝東路四段', '仁愛路四段'],
        capacity_vph: 1500,
        alternatives: ['RD_TPE_004', 'RD_TPE_005', 'RD_TPE_006', 'RD_TPE_008'],
        nearby_stations: ['BS_TPE_DOME'],
      },
      ...['RD_TPE_004', 'RD_TPE_005', 'RD_TPE_006', 'RD_TPE_008'].map((id, i) => ({
        segment_id: id,
        name: `alt-${i}`,
        flow_direction: '東西向',
        intersections: [],
        capacity_vph: 2000,
        alternatives: [],
        nearby_stations: [],
      })),
    ];
    const incident = makeIncident({ location: '光復南路與忠孝東路口南側' });
    const ingestion = makeIngestion({
      incidents: [incident],
      roadNetwork: RoadNetworkModel.load(segments),
      traffic: [trafficRecord('RD_TPE_002', '光復南路', '2026-05-20 22:00', 1)],
      crowd: [crowdRecord('BS_TPE_DOME', '2026-05-20 22:00', 5_000, 0.05, 0.1)],
    });

    const facts = runDeterministicDecision({ ingestion, config, incident }).facts;
    expect(facts).not.toBeNull();
    if (facts === null) return;

    expect(facts.signal_conflicts).toEqual([
      {
        segment_id: 'RD_TPE_002',
        conflict_type: 'traffic_heavy_crowd_light',
        advisory_text: '維持既有車流疏導措施，暫緩人流相關資源調度',
      },
    ]);
  });
});

// ─── R5 AC8: R4 cascading risk detection ───────────────────────────────────

describe('GZAE R4 integration — cascading micro-incident risk (R5 AC8)', () => {
  it('flags cascading_risk for two adjacent, non-escalated incidents without affecting either triggered_articles', () => {
    const segments: RoadSegment[] = [
      {
        segment_id: 'RD_TPE_001',
        name: '忠孝東路四段',
        flow_direction: '東西向',
        intersections: [],
        capacity_vph: 3000,
        alternatives: ['RD_TPE_004'],
        nearby_stations: [],
      },
      {
        segment_id: 'RD_TPE_004',
        name: '市民大道四段',
        flow_direction: '東西向',
        intersections: [],
        capacity_vph: 2500,
        alternatives: [],
        nearby_stations: [],
      },
    ];
    const incidentA = makeIncident({
      event_id: 'TPE_2026_EVT_A',
      affected_segment: 'RD_TPE_001',
      status: IncidentStatus.Caution,
      severity: Severity.Medium,
      description: '單一機車擦撞，現場排除中',
    });
    const incidentB: Incident = {
      event_id: 'TPE_2026_EVT_B',
      type: IncidentType.Road_Collapse_Accident,
      location: '市民大道四段',
      affected_segment: 'RD_TPE_004',
      status: IncidentStatus.Caution,
      severity: Severity.Medium,
      description: '違停車輛佔用車道',
      timestamp: '2026-05-20 22:12',
    };
    const ingestion = makeIngestion({
      incidents: [incidentA, incidentB],
      roadNetwork: RoadNetworkModel.load(segments),
      traffic: [
        trafficRecord('RD_TPE_001', '忠孝東路四段', '2026-05-20 22:10', 0.3),
        trafficRecord('RD_TPE_004', '市民大道四段', '2026-05-20 22:10', 0.3),
      ],
    });

    const facts = runDeterministicDecision({ ingestion, config, incident: incidentA }).facts;
    expect(facts).not.toBeNull();
    if (facts === null) return;

    expect(facts.cascading_risk).not.toBeNull();
    expect(facts.cascading_risk?.event_ids.sort()).toEqual(['TPE_2026_EVT_A', 'TPE_2026_EVT_B']);
    expect(facts.cascading_risk?.advisory_text).toContain('2 起鄰近未達 SOP 第 2 條門檻之事件');
    // Neither incident individually triggers art.2 (Caution/Medium fails the 3-AND).
    expect(facts.triggered_articles).not.toContain(2);
  });
});
