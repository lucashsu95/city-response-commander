/**
 * TASK-UARE-09 — backend-level integration tests for the Unified Adaptive
 * Reasoning Engine (UARE).
 *
 * Spec: .kiro/specs/unified-adaptive-reasoning-engine/requirements.md R9.2, R9.5
 *
 * Unlike decision_fn.test.ts (which deliberately mocks `decide` to keep rule
 * semantics out of the adapter's own test surface), these tests run the REAL
 * `DEFAULT_DECISION_COMPOSER` (`runDeterministicDecision`) through the real
 * `DefaultDomainPipelineAdapter`, against a real `RoadNetworkModel`. The point
 * is to prove that ≥3 genuinely novel incident types — the exact scenario the
 * UARE spec exists for ("無人機墜落橋樑", unknown gas leaks, etc.) — reach the
 * backend boundary with `sop_matched: false` and grounding candidates that are
 * always real, whitelisted road segments; and that an incident whose location
 * can't be resolved at all still doesn't get misreported as insufficient_data.
 */

import { describe, it, expect } from 'vitest';
import type { Incident, RawTrafficRecord, RoadSegment } from '@city-commander/shared-schemas';
import { IncidentStatus, LaneStatus, Severity } from '@city-commander/shared-schemas';
import {
  RoadNetworkModel,
  normalizeTimestamp,
  type IngestionResult,
} from '@city-commander/domain';
import { DefaultDomainPipelineAdapter } from '../../src/index.js';
import type { IngestionPort } from '../../src/index.js';

// ─── Fixtures (real road network shape, never fabricated field names) ─────

const ROAD_SEGMENTS: RoadSegment[] = [
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
    capacity_vph: 600, // below CAPACITY_THRESHOLD — must never appear in grounding_candidates
    alternatives: [],
    nearby_stations: [],
  },
];

const ROAD_WHITELIST = new Set(ROAD_SEGMENTS.map((s) => s.segment_id));

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

function makeIncident(overrides: Partial<Incident> = {}): Incident {
  return {
    event_id: 'TEST_EVENT',
    type: 'Road_Collapse_Accident',
    location: '測試地點',
    affected_segment: 'RD_TPE_002',
    status: IncidentStatus.Caution,
    severity: Severity.Medium,
    description: '測試事件',
    timestamp: '2026-05-20 22:10',
    ...overrides,
  } as Incident;
}

/** Minimal 7-article SOP stub — content is irrelevant to these tests, only shape/count matters. */
function makeSopArticles(): {
  articles: readonly { article_no: number; title: string; text: string }[];
  getByArticleNo: (articleNo: number) => { article_no: number; title: string; text: string } | undefined;
} {
  const articles = Array.from({ length: 7 }, (_unused, index) => ({
    article_no: index + 1,
    title: `SOP-${index + 1}`,
    text: `SOP article ${index + 1} verbatim text`,
  }));
  const byNo = new Map(articles.map((article) => [article.article_no, article] as const));
  return { articles, getByArticleNo: (articleNo: number) => byNo.get(articleNo) };
}

/** Config port matching PolicyStrategyConfigProvider's required keys. */
const config = {
  get(key: string): string | number {
    const values: Record<string, string | number> = {
      'policy.time_alignment.mode': 'exact_or_latest_prior_per_entity',
      'policy.time_alignment.max_staleness_minutes': 30,
      'policy.affected_road.role': 'display_only',
      'policy.ete.affected_set': 'incident_primary_and_selected_secondary',
      'policy.incident_anchor.mode': 'incident_anchor_from_location_text',
      'policy.affected_intersection_scope.mode': 'unresolved_manual_confirmation',
      'policy.multilingual_scope.mode': 'current_snapshot_all_available_stations',
    };
    const value = values[key];
    if (value === undefined) throw new Error(`missing config key: ${key}`);
    return value;
  },
};

function makeIngestion(
  incident: Incident,
  traffic: readonly RawTrafficRecord[] = [],
): IngestionResult {
  return {
    data_status: 'ready',
    source_manifest_hash: 'test-manifest-hash',
    stop_reason: null,
    traffic,
    trafficTimestamps: traffic.map((record) => normalizeTimestamp(record.timestamp_raw)),
    crowd: [],
    crowdTimestamps: [],
    roadNetwork: RoadNetworkModel.load(ROAD_SEGMENTS),
    sopArticles: makeSopArticles(),
    incidents: [incident],
  } as unknown as IngestionResult;
}

function makeAdapter(ingestion: IngestionResult): DefaultDomainPipelineAdapter {
  const port: IngestionPort = { ingest: () => ingestion };
  return new DefaultDomainPipelineAdapter({ ingestion: port, config });
}

// ─── R9.2: ≥3 genuinely novel incident types ───────────────────────────────

describe('UARE integration — novel incident types reach sop_matched:false at the backend boundary', () => {
  const groundedTraffic = [
    trafficRecord('RD_TPE_002', '光復南路', '2026-05-20 22:00', 0.3),
    trafficRecord('RD_TPE_004', '市民大道四段', '2026-05-20 22:00', 0.2),
    trafficRecord('RD_TPE_005', '仁愛路四段', '2026-05-20 22:00', 0.5),
    trafficRecord('RD_TPE_006', '敦化南路一段', '2026-05-20 22:00', 0.4),
    trafficRecord('RD_TPE_008', '延吉街', '2026-05-20 22:00', 0.1),
  ];

  const scenarios: Array<{ readonly name: string; readonly incident: Incident }> = [
    {
      name: '無人機墜落橋樑（unknown type, RD_ anchor)',
      incident: makeIncident({
        event_id: 'TEST_DRONE_001',
        type: '無人機墜落橋樑',
        affected_segment: 'RD_TPE_002',
        description: '無人機墜落於橋面，暫無人員傷亡通報',
      }),
    },
    {
      name: '未知毒氣外洩（unknown type, no gas/signal keyword)',
      incident: makeIncident({
        event_id: 'TEST_GAS_002',
        type: '未知毒氣外洩',
        affected_segment: 'RD_TPE_002',
        description: '偵測到不明化學氣味，來源不明',
      }),
    },
    {
      name: '地基下陷疑慮（unknown type, low severity so no article trigger)',
      incident: makeIncident({
        event_id: 'TEST_SINKHOLE_003',
        type: '地基下陷疑慮',
        affected_segment: 'RD_TPE_002',
        status: IncidentStatus.Open,
        severity: Severity.Medium,
        description: '路面出現不明凹陷，尚未封閉',
      }),
    },
  ];

  for (const { name, incident } of scenarios) {
    it(`${name} → sop_matched:false, SYSTEM_DEFAULT_PRINCIPLE, grounded in the road whitelist only`, async () => {
      const adapter = makeAdapter(makeIngestion(incident, groundedTraffic));

      const result = await adapter.execute({ eventId: incident.event_id });

      expect(result.data_status).toBe('ready');
      const facts = result.facts;
      expect(facts).not.toBeNull();
      if (facts === null) return;

      expect(facts.triggered_articles).toEqual([]);
      expect(facts.sop_matched).toBe(false);
      expect(facts.sop_authority).toBe('SYSTEM_DEFAULT_PRINCIPLE');
      expect(facts.universal_principles).toHaveLength(3);
      expect(facts.grounding_candidates.length).toBeGreaterThan(0);
      // Zero-hallucination: every road offered is a real, whitelisted segment.
      for (const candidate of facts.grounding_candidates) {
        expect(ROAD_WHITELIST.has(candidate.segment_id)).toBe(true);
      }
      // RD_TPE_008 fails the capacity floor and must never be offered.
      expect(facts.grounding_candidates.map((c) => c.segment_id)).not.toContain('RD_TPE_008');
    });
  }
});

// ─── R9.5: neither affected_segment nor affected_road resolves ────────────

describe('UARE integration — unresolvable location (R6)', () => {
  it('reports empty recommended routes without misreporting insufficient_data', async () => {
    const incident = makeIncident({
      event_id: 'TEST_UNRESOLVABLE_004',
      type: '未知事件類型',
      affected_segment: 'RD_TPE_UNKNOWN_999',
      description: '地點資訊不足，尚待現場確認',
    });
    const adapter = makeAdapter(makeIngestion(incident, []));

    const result = await adapter.execute({ eventId: incident.event_id });

    // R6 AC3: an unresolvable grounding anchor must never be reported as a
    // data-ingestion gap — that would misattribute the cause to missing
    // official source data instead of an out-of-whitelist location.
    expect(result.data_status).toBe('ready');
    const facts = result.facts;
    expect(facts).not.toBeNull();
    if (facts === null) return;

    expect(facts.sop_matched).toBe(false);
    expect(facts.universal_principles).toHaveLength(3);
    expect(facts.grounding_candidates).toEqual([]);
  });
});
