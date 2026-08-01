/**
 * Containment_Assembler tests (spec: boundary-snapping-containment, R1, R12).
 *
 * TASK-BS-10/11 scope: the STOP-gate short circuit, Entity_Scope_Check → SOP
 * coverage ordering, and the IN_SCOPE / runDeterministicDecision branch. The
 * `snap()` branch for OUT_OF_BOUNDS lands in TASK-BS-12.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  RoadNetworkModel,
  normalizeTimestamp,
  runDeterministicDecision,
} from '@city-commander/domain';
import type {
  IngestionResult,
  PolicyStrategyConfigProvider,
  SOPLoadResult,
} from '@city-commander/domain';
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
import {
  assembleContainment as assembleContainmentWithComposer,
  type AssembleContainmentInput,
  type BedrockComposerClient,
} from '../../src/decision/containment_assembler.js';

const defaultComposer: BedrockComposerClient = {
  generate: async () => '',
};

type TestAssembleInput = Omit<AssembleContainmentInput, 'composer'> & {
  readonly composer?: BedrockComposerClient;
};

function assembleContainment(input: TestAssembleInput) {
  const { composer = defaultComposer, ...deterministicInput } = input;
  return assembleContainmentWithComposer({ ...deterministicInput, composer });
}

/** Matches decision_pipeline.test.ts's fixture — evidence_trace_builder.ts requires a SOP citation for every triggered article. */
function makeSopArticles(): SOPLoadResult {
  const articles = Array.from({ length: 7 }, (_unused, index) => ({
    article_no: index + 1,
    title: `SOP-${index + 1}`,
    text: `SOP article ${index + 1} verbatim text`,
  }));
  const byNo = new Map(articles.map((article) => [article.article_no, article] as const));
  return { articles, getByArticleNo: (articleNo: number) => byNo.get(articleNo) };
}

function incident(overrides: Partial<Incident> = {}): Incident {
  return {
    event_id: 'TPE_2026_ACC_001',
    type: 'Road_Collapse_Accident',
    location: '光復南路與忠孝東路四段南側',
    affected_segment: 'RD_TPE_002',
    status: 'Closed',
    severity: 'Critical',
    description: '路面塌陷',
    timestamp: '2026-05-20 22:10',
    ...overrides,
  } as unknown as Incident;
}

function roadNetwork(): RoadNetworkModel {
  return RoadNetworkModel.load([
    {
      segment_id: 'RD_TPE_001',
      name: '忠孝東路四段',
      flow_direction: '東西向',
      intersections: ['光復南路'],
      capacity_vph: 2400,
      alternatives: [],
      nearby_stations: ['BS_MRT_BL17'],
    },
    {
      segment_id: 'RD_TPE_002',
      name: '光復南路',
      flow_direction: '南北向',
      intersections: ['市民大道四段', '忠孝東路四段', '仁愛路四段'],
      capacity_vph: 1800,
      alternatives: ['RD_TPE_004'],
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
  ]);
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

interface ReadyIngestionOverrides {
  readonly traffic?: readonly RawTrafficRecord[];
  readonly crowd?: readonly RawCrowdRecord[];
  readonly roadNetwork?: RoadNetworkModel;
}

function readyIngestion(overrides: ReadyIngestionOverrides = {}): IngestionResult {
  const traffic = overrides.traffic ?? [];
  const crowd = overrides.crowd ?? [];
  return {
    data_status: 'ready',
    stop_reason: null,
    source_manifest_hash: 'sha256:abc',
    traffic,
    trafficTimestamps: traffic.map((record) => normalizeTimestamp(record.timestamp_raw)),
    crowd,
    crowdTimestamps: crowd.map((record) => normalizeTimestamp(record.timestamp_raw)),
    roadNetwork: overrides.roadNetwork ?? roadNetwork(),
    sopArticles: makeSopArticles(),
    incidents: [],
  };
}

/** ConfigProvider matching the HG-001 provisional policy set (same values decision_pipeline.test.ts uses). */
class LocalConfigProvider implements PolicyStrategyConfigProvider {
  private readonly values: Readonly<Record<string, string | number | boolean>> = {
    'policy.time_alignment.mode': 'exact_or_latest_prior_per_entity',
    'policy.time_alignment.max_staleness_minutes': 30,
    'policy.affected_road.role': 'display_only',
    'policy.ete.affected_set': 'incident_primary_and_selected_secondary',
    'policy.incident_anchor.mode': 'incident_anchor_from_location_text',
    'policy.affected_intersection_scope.mode': 'unresolved_manual_confirmation',
    'policy.multilingual_scope.mode': 'current_snapshot_all_available_stations',
    'boundary_snapping.max_snap_distance_meters': 5_000,
    'boundary_snapping.coordinate_path_enabled': false,
  };
  get(key: string): string | number | boolean {
    const value = this.values[key];
    if (value === undefined) throw new Error(`missing ${key}`);
    return value;
  }
}
const config = new LocalConfigProvider();

describe('assembleContainment', () => {
  describe('R12 AC2 — STOP-gate short circuit', () => {
    it('returns the ingestion insufficient_data/stop_reason verbatim without touching roadNetwork', async () => {
      const ingestion = {
        data_status: 'insufficient_data',
        stop_reason: 'Source manifest hash mismatch for road_network_geometry.json.',
        source_manifest_hash: '',
        get roadNetwork(): RoadNetworkModel {
          throw new Error('roadNetwork must not be accessed when data_status !== ready (R12 AC2)');
        },
      } as unknown as IngestionResult;

      const result = await assembleContainment({ ingestion, incident: incident(), config });

      expect(result).toEqual({
        data_status: 'insufficient_data',
        stop_reason: 'Source manifest hash mismatch for road_network_geometry.json.',
        source_manifest_hash: '',
        entity_scope: null,
        sop_coverage: null,
        data_scope_status: null,
        mapped_anchor_node: null,
        safe_context: null,
        sop_coverage_status: null,
        sop_authority: null,
        decision: {
          reroute_roads: [],
          perimeter_control: null,
          ai_reasoning: null,
        },
        whitelist_violations: [],
        facts: null,
      });
    });

    it('is byte-identical to the existing insufficient_data shape backend handlers already rely on', async () => {
      const ingestion: IngestionResult = {
        data_status: 'insufficient_data',
        stop_reason: 'Domain pipeline reported insufficient_data.',
        source_manifest_hash: '',
      };
      const result = await assembleContainment({ ingestion, incident: incident(), config });
      expect(result.data_status).toBe(ingestion.data_status);
      expect(result.stop_reason).toBe(ingestion.stop_reason);
      expect(result.source_manifest_hash).toBe(ingestion.source_manifest_hash);
    });

    it('guards against a ready ingestion missing roadNetwork (invariant violation) without throwing', async () => {
      const ingestion = {
        data_status: 'ready',
        stop_reason: null,
        source_manifest_hash: 'sha256:abc',
        // roadNetwork intentionally absent despite data_status='ready'
      } as unknown as IngestionResult;

      await expect(
        assembleContainment({ ingestion, incident: incident(), config }),
      ).resolves.toBeDefined();
      const result = await assembleContainment({ ingestion, incident: incident(), config });
      expect(result.data_status).toBe('insufficient_data');
      expect(result.entity_scope).toBeNull();
      expect(result.sop_coverage).toBeNull();
      expect(result.facts).toBeNull();
    });
  });

  describe('R1 AC1 — Entity_Scope_Check then SOP coverage resolution', () => {
    it('resolves and snaps an incident outside both the network and the SOP table', async () => {
      const ingestion = readyIngestion();
      const outOfBoundsIncident = incident({
        affected_segment: 'RD_TPE_099',
        affected_road: undefined,
        location: '完全不在路網範圍內的地點',
        type: 'Unknown_Chemical_Leak' as unknown as Incident['type'],
        description: '未知化學氣體洩漏',
        timestamp: '2026-05-20 22:30',
      });
      const result = await assembleContainment({
        ingestion,
        incident: outOfBoundsIncident,
        config,
      });

      expect(result.entity_scope?.coverage_status).toBe('OUT_OF_BOUNDS');
      expect(result.sop_coverage?.sop_coverage_status).toBe('UNKNOWN_TYPE_UNIVERSAL_SOP');
      expect(result.sop_coverage?.universal_principles.length).toBeGreaterThan(0);
      expect(result.data_scope_status).toBe('OUT_OF_BOUNDS_SNAPPED');
      expect(result.mapped_anchor_node).toEqual({
        segment_id: 'RD_TPE_002',
        gateway_intersection: '仁愛路四段',
        capacity_vph: 1800,
        distance_meters: null,
      });
      expect(result.safe_context).toMatchObject({
        allowed_road_whitelist: ['RD_TPE_002', 'RD_TPE_004'],
        official_sop_text: null,
        universal_principles: result.sop_coverage?.universal_principles,
      });
      expect(result.safe_context?.scope_disclosure).toContain('完全不在路網範圍內的地點');
      expect(result.safe_context?.scope_disclosure).toContain('仁愛路四段');
      expect(result.safe_context?.instruction).toContain('不得回覆無法判斷');
    });
  });

  describe('R12 AC4-AC6 — coverage-gap RD_ short circuit', () => {
    const outsideIncident = (): Incident =>
      incident({
        affected_segment: 'RD_TPE_099',
        affected_road: undefined,
        location: '完全不在路網範圍內的地點',
        type: 'Unknown_Chemical_Leak' as unknown as Incident['type'],
        description: '未知化學氣體洩漏',
        timestamp: '2026-05-20 22:30',
      });

    it('returns snapped perimeter facts without Strategy D, evacuation, classification, or ETE', async () => {
      const result = await assembleContainment({
        ingestion: readyIngestion(),
        incident: outsideIncident(),
        config,
      });

      expect(result.data_scope_status).toBe('OUT_OF_BOUNDS_SNAPPED');
      expect(result.mapped_anchor_node).not.toBeNull();
      expect(result.facts).not.toBeNull();
      expect(result.facts).toMatchObject({
        classifications: [],
        incident_anchor: null,
        primary_evacuation: null,
        secondary_evacuation: [],
        excluded_candidates: [],
        ete: null,
      });
      expect(result.facts?.incident_anchor !== null && result.mapped_anchor_node !== null).toBe(
        false,
      );
    });

    it('returns OUT_OF_JURISDICTION with no mapped anchor when the network has no perimeter gateway', async () => {
      const closedNetwork = RoadNetworkModel.load([
        {
          segment_id: 'RD_TPE_010',
          name: '封閉測試路段',
          flow_direction: '南北向',
          intersections: [],
          capacity_vph: 1_000,
          alternatives: [],
          nearby_stations: [],
        },
      ]);
      const result = await assembleContainment({
        ingestion: readyIngestion({ roadNetwork: closedNetwork }),
        incident: outsideIncident(),
        config,
      });

      expect(result.data_scope_status).toBe('OUT_OF_JURISDICTION');
      expect(result.mapped_anchor_node).toBeNull();
      expect(result.safe_context?.allowed_road_whitelist).toEqual([]);
      expect(result.safe_context?.scope_disclosure).toBeNull();
      expect(result.facts?.incident_anchor).toBeNull();
      expect(result.facts?.primary_evacuation).toBeNull();
    });

    it('keeps SOP-3/4/6 station evaluations while the RD_ sub-pipeline stays skipped', async () => {
      const ingestion = readyIngestion({
        crowd: [
          crowdRecord('BS_MRT_BL17', '2026-05-20 22:25', 31_000, 0.2, 0.1),
          crowdRecord('BS_TPE_DOME', '2026-05-20 22:00', 40_000, 0.1, 0.35),
          crowdRecord('BS_TPE_DOME', '2026-05-20 22:30', 27_600, -0.31, 0.35),
        ],
      });
      const testIncident = outsideIncident();
      const result = await assembleContainment({ ingestion, incident: testIncident, config });

      expect(result.facts?.triggered_articles).toEqual([3, 4, 6]);
      expect(result.facts?.invoked_procedures).toContain('article3_mrt_shuttle_mechanism');
      expect(result.facts?.multilingual_required).toBe(true);
      expect(result.facts?.incident_anchor).toBeNull();
      expect(result.facts?.primary_evacuation).toBeNull();
      expect(result.facts?.ete).toBeNull();
    });
  });

  describe('R8 — Safe_Context action-space restriction', () => {
    it('keeps every in-scope evacuation candidate inside Road_Whitelist and uses official SOP text only', async () => {
      const ingestion = readyIngestion();
      const result = await assembleContainment({ ingestion, incident: incident(), config });
      const roadWhitelist = new Set(
        ingestion.roadNetwork?.getAllSegments().map((segment) => segment.segment_id),
      );

      expect(result.safe_context).not.toBeNull();
      for (const roadId of result.safe_context?.allowed_road_whitelist ?? []) {
        expect(roadWhitelist.has(roadId)).toBe(true);
      }
      expect(
        result.safe_context?.official_sop_text?.map((citation) => citation.article_no),
      ).toEqual([2]);
      expect(result.safe_context?.universal_principles).toBeNull();
      expect(result.safe_context?.scope_disclosure).toBeNull();
      expect(result.safe_context?.instruction).toContain('只可使用 allowed_road_whitelist');
    });

    it('uses exactly anchor plus one-way whitelisted alternatives for a snapped incident', async () => {
      const ingestion = readyIngestion();
      const result = await assembleContainment({
        ingestion,
        incident: incident({
          affected_segment: 'RD_TPE_099',
          affected_road: undefined,
          location: '完全不在路網範圍內的地點',
          type: 'Unknown_Chemical_Leak' as unknown as Incident['type'],
          description: '未知化學氣體洩漏',
          timestamp: '2026-05-20 22:30',
        }),
        config,
      });
      const roadWhitelist = new Set(
        ingestion.roadNetwork?.getAllSegments().map((segment) => segment.segment_id),
      );

      expect(result.safe_context?.allowed_road_whitelist).toEqual(['RD_TPE_002', 'RD_TPE_004']);
      for (const roadId of result.safe_context?.allowed_road_whitelist ?? []) {
        expect(roadWhitelist.has(roadId)).toBe(true);
      }
      expect(result.safe_context?.official_sop_text).toBeNull();
      expect(result.safe_context?.universal_principles).toHaveLength(3);
    });
  });

  describe('R12 AC3/AC6/AC7 — IN_SCOPE runs runDeterministicDecision unchanged (no-regression)', () => {
    const goldenCases: readonly {
      readonly eventId: string;
      readonly build: () => { readonly ingestion: IngestionResult; readonly incident: Incident };
    }[] = [
      {
        eventId: 'TPE_2026_ACC_001',
        build: () => ({
          incident: incident({ location: '光復南路與忠孝東路口南側' }),
          ingestion: readyIngestion({
            roadNetwork: RoadNetworkModel.load([
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
            ]),
            traffic: [
              trafficRecord('RD_TPE_002', '光復南路', '2026-05-20 22:00', 1),
              trafficRecord('RD_TPE_004', '市民大道四段', '2026-05-20 22:00', 0.78),
              trafficRecord('RD_TPE_005', '仁愛路四段', '2026-05-20 22:00', 0.65),
              trafficRecord('RD_TPE_006', '敦化南路一段', '2026-05-20 22:00', 0.4),
              trafficRecord('RD_TPE_008', '延吉街', '2026-05-20 22:00', 0.2),
            ],
          }),
        }),
      },
      {
        eventId: 'TPE_2026_EVT_002',
        build: () => ({
          incident: incident({
            event_id: 'TPE_2026_EVT_002',
            type: IncidentType.Crowd_Surge_Injury,
            location: '捷運國父紀念館站 5 號出口',
            affected_segment: 'BS_MRT_BL17',
            affected_road: 'RD_TPE_001',
            status: IncidentStatus.Restricted,
            severity: Severity.High,
            timestamp: '2026-05-20 22:20',
          }),
          ingestion: readyIngestion({
            crowd: [
              crowdRecord('BS_MRT_BL17', '2026-05-20 22:15', 31_000, 0.2, 0.1),
              crowdRecord('BS_MRT_BL17', '2026-05-20 22:25', 1, 0, 0.1),
            ],
          }),
        }),
      },
      {
        eventId: 'TPE_2026_EVT_003',
        build: () => {
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
          return {
            incident: incident({
              event_id: 'TPE_2026_EVT_003',
              type: IncidentType.Power_Failure,
              location: '松高路與松壽路口',
              affected_segment: 'RD_TPE_007',
              status: IncidentStatus.Restricted,
              severity: Severity.Medium,
              timestamp: '2026-05-20 22:30',
            }),
            ingestion: readyIngestion({
              roadNetwork: RoadNetworkModel.load(segments),
              traffic: [
                trafficRecord('RD_TPE_007', '松高路', '2026-05-20 22:30', 0.85),
                trafficRecord('RD_TPE_011', '市府路', '2026-05-20 22:30', 0.85),
              ],
            }),
          };
        },
      },
    ];

    it.each(goldenCases)(
      '$eventId facts deep-equal a direct runDeterministicDecision call',
      async ({ build }) => {
        const { ingestion, incident: testIncident } = build();

        const direct = runDeterministicDecision({ ingestion, config, incident: testIncident });
        const viaAssembler = await assembleContainment({
          ingestion,
          incident: testIncident,
          config,
        });

        expect(direct.data_status).toBe('ready');
        expect(direct.facts).not.toBeNull();
        expect(viaAssembler.facts).toEqual(direct.facts);
        expect(viaAssembler.data_status).toBe('ready');
        expect(viaAssembler.stop_reason).toBeNull();
        expect(viaAssembler.source_manifest_hash).toBe(direct.source_manifest_hash);
        expect(viaAssembler.data_scope_status).toBe('IN_SCOPE');
        expect(viaAssembler.mapped_anchor_node).toBeNull();
      },
    );

    it('sets data_scope_status to the resolved Entity_Scope_Check status and mapped_anchor_node to null (R10 AC9)', async () => {
      const ingestion = readyIngestion();
      const result = await assembleContainment({ ingestion, incident: incident(), config });

      expect(result.data_scope_status).toBe('IN_SCOPE');
      expect(result.mapped_anchor_node).toBeNull();
    });

    it('also proves the IN_SCOPE_BY_INTERSECTION path runs runDeterministicDecision unchanged', async () => {
      const ingestion = readyIngestion();
      // Not directly in the whitelist, but '光復南路' appears in RD_TPE_004's intersections.
      const byIntersectionIncident = incident({
        affected_segment: 'RD_TPE_099',
        affected_road: undefined,
        location: '光復南路口發生事故',
      });

      const direct = runDeterministicDecision({
        ingestion,
        config,
        incident: byIntersectionIncident,
      });
      const viaAssembler = await assembleContainment({
        ingestion,
        incident: byIntersectionIncident,
        config,
      });

      expect(viaAssembler.data_scope_status).toBe('IN_SCOPE_BY_INTERSECTION');
      expect(viaAssembler.facts).toEqual(direct.facts);
      expect(viaAssembler.mapped_anchor_node).toBeNull();
    });
  });

  describe('R14 AC8 — full containment response matrix', () => {
    const outsideIncident = (): Incident =>
      incident({
        affected_segment: 'RD_TPE_099',
        affected_road: undefined,
        location: '完全不在路網範圍內的地點',
        type: 'Unknown_Chemical_Leak' as unknown as Incident['type'],
        description: '未知化學氣體洩漏',
        timestamp: '2026-05-20 22:30',
      });

    it('Case A: keeps the existing deterministic facts for an IN_SCOPE incident', async () => {
      const result = await assembleContainment({
        ingestion: readyIngestion(),
        incident: incident(),
        config,
      });

      expect(result.data_status).toBe('ready');
      expect(result.data_scope_status).toBe('IN_SCOPE');
      expect(result.mapped_anchor_node).toBeNull();
      expect(result.facts).not.toBeNull();
      expect(result.facts?.incident_anchor).not.toBeNull();
    });

    it('Case B: returns a snapped anchor and only whitelisted reroutes without an incident anchor', async () => {
      const result = await assembleContainment({
        ingestion: readyIngestion(),
        incident: outsideIncident(),
        config,
        composer: { generate: async () => '建議改道 RD_TPE_004。' },
      });
      const allowed = new Set(result.safe_context?.allowed_road_whitelist ?? []);

      expect(result.data_scope_status).toBe('OUT_OF_BOUNDS_SNAPPED');
      expect(result.mapped_anchor_node).not.toBeNull();
      expect(result.facts?.incident_anchor).toBeNull();
      expect(result.decision.reroute_roads).not.toHaveLength(0);
      expect(result.decision.reroute_roads.every((roadId) => allowed.has(roadId))).toBe(true);
    });

    it('Case C: skips Bedrock and emits only the static out-of-jurisdiction explanation', async () => {
      const generate = vi.fn<BedrockComposerClient['generate']>();
      const closedNetwork = RoadNetworkModel.load([
        {
          segment_id: 'RD_TPE_010',
          name: '封閉測試路段',
          flow_direction: '南北向',
          intersections: [],
          capacity_vph: 1_000,
          alternatives: [],
          nearby_stations: [],
        },
      ]);
      const result = await assembleContainment({
        ingestion: readyIngestion({ roadNetwork: closedNetwork }),
        incident: outsideIncident(),
        config,
        composer: { generate },
      });

      expect(result.data_scope_status).toBe('OUT_OF_JURISDICTION');
      expect(result.mapped_anchor_node).toBeNull();
      expect(result.facts?.incident_anchor).toBeNull();
      expect(generate).not.toHaveBeenCalled();
      expect(result.decision).toEqual({
        reroute_roads: [],
        perimeter_control: null,
        ai_reasoning: '事件超出本系統路網轄區，未執行道路吸附或 AI 指揮建議生成。',
      });
    });

    it('Case D: preserves the STOP response when insufficient data and an out-of-bounds incident coexist', async () => {
      const generate = vi.fn<BedrockComposerClient['generate']>();
      const ingestion: IngestionResult = {
        data_status: 'insufficient_data',
        stop_reason: 'Source manifest hash mismatch for road_network_geometry.json.',
        source_manifest_hash: '',
      };
      const result = await assembleContainment({
        ingestion,
        incident: outsideIncident(),
        config,
        composer: { generate },
      });

      expect(generate).not.toHaveBeenCalled();
      expect(result).toEqual({
        data_status: 'insufficient_data',
        stop_reason: 'Source manifest hash mismatch for road_network_geometry.json.',
        source_manifest_hash: '',
        entity_scope: null,
        sop_coverage: null,
        data_scope_status: null,
        mapped_anchor_node: null,
        safe_context: null,
        sop_coverage_status: null,
        sop_authority: null,
        decision: {
          reroute_roads: [],
          perimeter_control: null,
          ai_reasoning: null,
        },
        whitelist_violations: [],
        facts: null,
      });
    });
  });

  describe('R9 — Bedrock output whitelist audit and fallback', () => {
    const outsideIncident = (): Incident =>
      incident({
        affected_segment: 'RD_TPE_099',
        affected_road: undefined,
        location: '完全不在路網範圍內的地點',
        type: 'Unknown_Chemical_Leak' as unknown as Incident['type'],
        description: '未知化學氣體洩漏',
        timestamp: '2026-05-20 22:30',
      });

    it('records fabricated road ids with occurrence counts and excludes them from reroutes and reasoning', async () => {
      const generate = vi
        .fn<BedrockComposerClient['generate']>()
        .mockResolvedValue('請改道 RD_TPE_004，禁止使用 RD_TPE_999；RD_TPE_999 不存在。');
      const result = await assembleContainment({
        ingestion: readyIngestion(),
        incident: outsideIncident(),
        config,
        composer: { generate },
      });

      expect(generate).toHaveBeenCalledOnce();
      expect(result.decision.reroute_roads).toEqual(['RD_TPE_004']);
      expect(result.whitelist_violations).toEqual([{ road_id: 'RD_TPE_999', occurrences: 2 }]);
      expect(result.decision.ai_reasoning).not.toContain('RD_TPE_999');
      expect(result.decision.ai_reasoning).toContain('[已阻擋非白名單道路]');
      expect(result.decision.perimeter_control?.target_gate).toBe('RD_TPE_002');
    });

    it('falls back to deterministic reroutes and marks AI reasoning unavailable on composer failure', async () => {
      const generate = vi
        .fn<BedrockComposerClient['generate']>()
        .mockRejectedValue(new Error('Bedrock timeout'));
      const result = await assembleContainment({
        ingestion: readyIngestion(),
        incident: outsideIncident(),
        config,
        composer: { generate },
      });

      expect(generate).toHaveBeenCalledOnce();
      expect(result.decision.reroute_roads).toEqual(['RD_TPE_004']);
      expect(result.decision.ai_reasoning).toBeNull();
      expect(result.whitelist_violations).toEqual([]);
      expect(result.decision.perimeter_control?.target_gate).toBe('RD_TPE_002');
    });

    it('skips composer entirely and returns only the static explanation when out of jurisdiction', async () => {
      const generate = vi.fn<BedrockComposerClient['generate']>();
      const closedNetwork = RoadNetworkModel.load([
        {
          segment_id: 'RD_TPE_010',
          name: '封閉測試路段',
          flow_direction: '南北向',
          intersections: [],
          capacity_vph: 1_000,
          alternatives: [],
          nearby_stations: [],
        },
      ]);
      const result = await assembleContainment({
        ingestion: readyIngestion({ roadNetwork: closedNetwork }),
        incident: outsideIncident(),
        config,
        composer: { generate },
      });

      expect(generate).not.toHaveBeenCalled();
      expect(result.decision.reroute_roads).toEqual([]);
      expect(result.decision.perimeter_control).toBeNull();
      expect(result.decision.ai_reasoning).toContain('超出本系統路網轄區');
      expect(result.whitelist_violations).toEqual([]);
    });
  });

  describe('purity / determinism', () => {
    it('returns equal results for repeated calls with the same input', async () => {
      const ingestion = readyIngestion();
      const first = await assembleContainment({ ingestion, incident: incident(), config });
      const second = await assembleContainment({ ingestion, incident: incident(), config });
      expect(first).toEqual(second);
    });
  });
});
