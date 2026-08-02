/**
 * Demo API Handler — POST /demo/incidents integration tests.
 *
 * `handleIncident` used to hand-assemble classification/article/evacuation
 * logic that had drifted from the real Rule Engine: it never evaluated
 * art.4/5/6 and never surfaced any GZAE annotation. It now delegates to
 * `runDeterministicDecision` (the same composition the production pipeline
 * uses), so these tests exercise that integration end-to-end through the
 * HTTP handler — including the SOP-3/4/6 crowd_pre_warnings extension.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  IncidentStatus,
  IncidentType,
  Severity,
  LaneStatus,
  type Incident,
  type RawCrowdRecord,
  type RawTrafficRecord,
} from '@city-commander/shared-schemas';
import { RoadNetworkModel, normalizeTimestamp } from '@city-commander/domain';
import type { SOPLoadResult } from '@city-commander/domain';
import {
  setDemoData,
  createDemoApiHandler,
  type DemoDataSet,
} from '../../src/demo/demo_api_handler.js';

const handler = createDemoApiHandler();

// ─── Fixture builders (mirrors packages/domain/test/integration/grey_zone_arbitration_pipeline.test.ts) ──

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

function makeSopArticles(): SOPLoadResult {
  const articles = Array.from({ length: 7 }, (_unused, index) => ({
    article_no: index + 1,
    title: `SOP-${index + 1}`,
    text: `SOP article ${index + 1} verbatim text`,
  }));
  const byNo = new Map(articles.map((article) => [article.article_no, article] as const));
  return { articles, getByArticleNo: (articleNo: number) => byNo.get(articleNo) };
}

function makeDataSet(overrides: Partial<DemoDataSet> = {}): DemoDataSet {
  const traffic = overrides.traffic ?? [];
  const crowd = overrides.crowd ?? [];
  return {
    traffic,
    trafficTimestamps: traffic.map((record) => normalizeTimestamp(record.timestamp_raw)),
    crowd,
    crowdTimestamps: crowd.map((record) => normalizeTimestamp(record.timestamp_raw)),
    roadNetwork: overrides.roadNetwork ?? RoadNetworkModel.load([]),
    sopArticles: overrides.sopArticles ?? makeSopArticles(),
    incidents: overrides.incidents ?? [],
  };
}

function incidentEvent(eventId: string) {
  return {
    rawPath: '/demo/incidents',
    requestContext: { http: { method: 'POST', path: '/demo/incidents' } },
    body: JSON.stringify({ event_id: eventId }),
  };
}

describe('Demo API Handler — POST /demo/incidents', () => {
  beforeEach(() => {
    setDemoData(makeDataSet());
  });

  it('evaluates SOP-3 through the real Rule Engine (previously the hand-rolled path only supported this via a duplicated SnapshotSelector call)', async () => {
    const incident: Incident = {
      event_id: 'TPE_2026_EVT_002',
      type: IncidentType.Crowd_Surge_Injury,
      location: '捷運國父紀念館站',
      affected_segment: 'BS_MRT_BL17',
      status: IncidentStatus.Restricted,
      severity: Severity.High,
      description: '人潮擁擠通報',
      timestamp: '2026-05-20 22:20',
    };
    setDemoData(
      makeDataSet({
        incidents: [incident],
        crowd: [crowdRecord('BS_MRT_BL17', '2026-05-20 22:15', 31_000, 0.2, 0.1)],
      }),
    );

    const result = await handler(incidentEvent('TPE_2026_EVT_002'));
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body) as Record<string, unknown>;

    expect(body.data_status).toBe('ready');
    expect(body.triggered_articles).toContain(3);
  });

  it('surfaces GZAE crowd_pre_warnings (SOP-3/4/6 extension) end-to-end — the gap the hand-rolled path never computed', async () => {
    const incident: Incident = {
      event_id: 'TPE_2026_EVT_PW1',
      type: IncidentType.Crowd_Surge_Injury,
      location: '捷運國父紀念館站',
      affected_segment: 'BS_MRT_BL17',
      status: IncidentStatus.Caution,
      severity: Severity.Medium,
      description: '例行巡查',
      timestamp: '2026-05-20 22:20',
    };
    setDemoData(
      makeDataSet({
        incidents: [incident],
        crowd: [
          crowdRecord('BS_MRT_BL17', '2026-05-20 22:00', 23_800, 0.1, 0.1),
          crowdRecord('BS_MRT_BL17', '2026-05-20 22:10', 23_900, 0.1, 0.1),
          crowdRecord('BS_MRT_BL17', '2026-05-20 22:20', 24_000, 0.1, 0.1),
        ],
      }),
    );

    const result = await handler(incidentEvent('TPE_2026_EVT_PW1'));
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body) as Record<string, unknown>;

    expect(body.triggered_articles).not.toContain(3);
    expect(body.crowd_pre_warnings).toEqual([
      {
        bs_id: 'BS_MRT_BL17',
        article: 3,
        field: 'User_Count',
        advisory_text: expect.stringContaining('SOP 第 3 條門檻（25,000 人）'),
      },
    ]);
  });

  it('resolves evacuation candidates for a road incident via the real anchor/qualification strategies', async () => {
    // Mirrors the proven ACC_001 fixture from
    // packages/domain/test/integration/grey_zone_arbitration_pipeline.test.ts
    // (anchor-text resolution depends on exact intersection-name matching,
    // so this reuses the fixture already verified to resolve correctly
    // rather than a hand-rolled minimal network).
    const roadNetwork = RoadNetworkModel.load([
      {
        segment_id: 'RD_TPE_002',
        name: '光復南路',
        flow_direction: '南北向',
        intersections: ['市民大道四段', '忠孝東路四段', '仁愛路四段'],
        capacity_vph: 1500,
        alternatives: ['RD_TPE_004', 'RD_TPE_005', 'RD_TPE_006', 'RD_TPE_008'],
        nearby_stations: [],
      },
      {
        segment_id: 'RD_TPE_004',
        name: '市民大道四段',
        flow_direction: '東西向',
        intersections: ['光復南路'],
        capacity_vph: 2500,
        alternatives: [],
        nearby_stations: [],
      },
      {
        segment_id: 'RD_TPE_005',
        name: '仁愛路四段',
        flow_direction: '東西向',
        intersections: ['光復南路'],
        capacity_vph: 1800,
        alternatives: [],
        nearby_stations: [],
      },
      {
        segment_id: 'RD_TPE_006',
        name: '敦化南路一段',
        flow_direction: '南北向',
        intersections: [],
        capacity_vph: 2000,
        alternatives: [],
        nearby_stations: [],
      },
      {
        segment_id: 'RD_TPE_008',
        name: '延吉街',
        flow_direction: '南北向',
        intersections: [],
        capacity_vph: 600,
        alternatives: [],
        nearby_stations: [],
      },
    ]);
    const incident: Incident = {
      event_id: 'TPE_2026_ACC_001',
      type: IncidentType.Road_Collapse_Accident,
      location: '光復南路與忠孝東路口南側',
      affected_segment: 'RD_TPE_002',
      status: IncidentStatus.Closed,
      severity: Severity.Critical,
      description: '路面坍塌',
      timestamp: '2026-05-20 22:10',
    };
    setDemoData(
      makeDataSet({
        incidents: [incident],
        roadNetwork,
        traffic: [
          trafficRecord('RD_TPE_002', '光復南路', '2026-05-20 22:00', 1),
          trafficRecord('RD_TPE_004', '市民大道四段', '2026-05-20 22:00', 0.78),
          trafficRecord('RD_TPE_005', '仁愛路四段', '2026-05-20 22:00', 0.65),
          trafficRecord('RD_TPE_006', '敦化南路一段', '2026-05-20 22:00', 0.4),
          trafficRecord('RD_TPE_008', '延吉街', '2026-05-20 22:00', 0.2),
        ],
      }),
    );

    const result = await handler(incidentEvent('TPE_2026_ACC_001'));
    expect(result.statusCode).toBe(200);
    const body = JSON.parse(result.body) as Record<string, unknown>;

    expect(body.triggered_articles).toContain(1);
    expect(body.primary_evacuation).toBe('RD_TPE_004');
    expect(body.secondary_evacuation).toEqual(['RD_TPE_005']);
  });

  it('returns 404 for an unknown event_id', async () => {
    const result = await handler(incidentEvent('NOT_A_REAL_EVENT'));
    expect(result.statusCode).toBe(404);
  });
});
