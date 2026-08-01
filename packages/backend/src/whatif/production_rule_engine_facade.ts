/**
 * Production RuleEngineWhatIfFacade — the single ownership boundary for
 * What-if deterministic work in the demo Lambda composition.
 *
 * Responsibilities:
 *  1. `loadBaseline` — re-runs the verified ingestion (manifest hash check)
 *     once at cold-start and derives the entity catalog (road segment IDs +
 *     base station IDs) present in the loaded baseline. Reused on every
 *     request; never mutated by reruns.
 *  2. `rerun` — deep-clones the baseline, applies only the validated
 *     assumptions to the clone (no mutation of the original), and re-runs
 *     the full deterministic decision pipeline against the modified facts.
 *
 * The synthetic scenario we feed the pipeline:
 *  - For BS_* assumptions → a Crowd_Surge_Injury incident pinned to the
 *    target station.
 *  - For RD_* assumptions → a Road_Collapse_Accident incident pinned to the
 *    target road segment.
 *  - User_Count / Growth_Rate / Roaming_User_Pct override the latest current
 *    reading at the target station before the pipeline runs.
 *
 * The pipeline recomputes Article 1..6 thresholds and ETE from the modified
 * facts. The returned `triggered_articles` / `applied_formula_articles` /
 * `expected_actions` therefore come exclusively from
 * `runDeterministicDecision`, never from the baseline.
 *
 * Immutability contract:
 *  - `baseline.inputSnapshot` (the IngestionResult) is deep-cloned on every
 *    rerun. The original baseline object is never modified.
 *
 * @module backend/whatif/production_rule_engine_facade
 */

import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import type { Incident, RawCrowdRecord, RawTrafficRecord } from '@city-commander/shared-schemas';
import {
  IncidentStatus,
  IncidentType,
  Severity,
  ROAD_SEGMENT_PREFIX,
  BASE_STATION_PREFIX,
} from '@city-commander/shared-schemas';

import {
  ingestData,
  runDeterministicDecision,
  type DataSourceProvider,
  type IngestionResult,
  type SOPLoadResult,
} from '@city-commander/domain';

import type {
  RuleEngineWhatIfBaseline,
  RuleEngineWhatIfFacts,
  RuleEngineWhatIfFacade,
} from './recompute.js';
import type { WhatIfAssumption } from './whatif_types.js';
import type { LoadedEntityCatalog } from './validators.js';

// ─── Field handling ──────────────────────────────────────────────────

type ModifiableField = 'User_Count' | 'Growth_Rate' | 'Roaming_User_Pct' | 'Saturation_Score';

type EntityModificationMap = ReadonlyMap<string, ReadonlyMap<ModifiableField, number>>;

// ─── Internal mutable record shapes (clone-side only) ────────────────

interface MutableCrowdRecord {
  timestamp_raw: string;
  BS_ID: string;
  Location_Name: string;
  User_Count: number;
  Stay_Time_Avg: number;
  Growth_Rate: number;
  Roaming_User_Pct: string;
  roaming_pct_value: number;
}

interface MutableTrafficRecord {
  timestamp_raw: string;
  Segment_ID: string;
  Road_Name: string;
  Avg_Speed: number;
  Vehicle_Count: number;
  Saturation_Score: number;
  Lane_Status: string;
}

// ─── Internal snapshot ───────────────────────────────────────────────

interface ProductionBaselineSnapshot {
  readonly ingestion: IngestionResult;
  readonly loadedEntities: LoadedEntityCatalog;
}

// ─── Production facade ──────────────────────────────────────────────

/**
 * Production implementation of `RuleEngineWhatIfFacade`.
 *
 * Constructed once at Lambda cold-start with the verified data already loaded
 * into memory from S3. The facade re-uses the snapshot for every request and
 * never mutates it; every rerun() deep-clones the snapshot before applying
 * assumptions.
 */
export class ProductionRuleEngineWhatIfFacade implements RuleEngineWhatIfFacade {
  private readonly snapshot: ProductionBaselineSnapshot;
  private readonly configProvider: ConfigProvider;

  constructor(provider: DataSourceProvider, configProvider?: ConfigProvider) {
    this.configProvider = configProvider ?? defaultConfigProvider();

    // Verify + parse all 5 official files at construction time.
    // ingestData runs the manifest gate; on hash mismatch it returns
    // insufficient_data, which we surface as a hard error so the Lambda
    // never silently serves unverified data.
    const ingestion = ingestData(provider);
    if (ingestion.data_status !== 'ready') {
      throw new Error(`What-if baseline ingestion failed: ${ingestion.stop_reason ?? 'unknown'}`);
    }
    this.snapshot = Object.freeze({
      ingestion,
      loadedEntities: buildEntityCatalog(ingestion),
    });
  }

  // ─── Facade methods ───────────────────────────────────────────────

  async loadBaseline(_event: APIGatewayProxyEventV2): Promise<RuleEngineWhatIfBaseline> {
    // The snapshot is loaded once at cold-start; subsequent requests reuse it.
    // We return a frozen RuleEngineWhatIfBaseline that wraps the same snapshot
    // in a fresh top-level object so callers cannot mutate the facade's
    // internal state via the returned reference.
    return Object.freeze({
      inputSnapshot: this.snapshot.ingestion,
      loadedEntities: this.snapshot.loadedEntities,
    });
  }

  rerun(input: {
    baseline: RuleEngineWhatIfBaseline;
    assumptions: readonly WhatIfAssumption[];
  }): RuleEngineWhatIfFacts {
    // 1. Deep-clone the baseline ingestion result so the original is never
    //    mutated. We JSON-round-trip the mutable records to break identity.
    const originalIngestion = input.baseline.inputSnapshot as IngestionResult;
    const clonedIngestion = deepCloneIngestion(originalIngestion);

    // 2. Apply validated assumptions to the clone only.
    const modifications = buildModificationMap(input.assumptions);

    applyModificationsToCrowd(clonedIngestion, modifications);
    applyModificationsToTraffic(clonedIngestion, modifications);

    // 3. Build a synthetic incident that points to the requested entity so
    //    the deterministic pipeline runs end-to-end.
    const incident = synthesizeScenarioIncident(input.assumptions, clonedIngestion);

    // 4. Re-run the full deterministic decision pipeline.
    const result = runDeterministicDecision({
      ingestion: clonedIngestion,
      config: this.configProvider,
      incident,
    });

    // 5. Project deterministic facts back to the facade shape.
    const triggered_articles = result.facts?.triggered_articles ?? [];
    const applied_formula_articles = result.facts?.applied_formula_articles ?? [];
    const expected_actions = buildExpectedActions(
      triggered_articles,
      applied_formula_articles,
      result.facts?.invoked_procedures ?? [],
    );
    const eteMinutesRaw =
      result.facts?.ete !== null && result.facts?.ete !== undefined
        ? result.facts.ete.ete_minutes
        : undefined;
    const ete_minutes =
      eteMinutesRaw !== null && eteMinutesRaw !== undefined && Number.isFinite(eteMinutesRaw)
        ? eteMinutesRaw
        : undefined;

    const out: RuleEngineWhatIfFacts = {
      triggered_articles,
      applied_formula_articles,
      expected_actions,
    };
    if (ete_minutes !== undefined && Number.isFinite(ete_minutes)) {
      return { ...out, ete_minutes };
    }
    return out;
  }
}

// ─── Helpers: entity catalog ─────────────────────────────────────────

function buildEntityCatalog(ingestion: IngestionResult): LoadedEntityCatalog {
  const roadSegmentIds = new Set<string>();
  const baseStationIds = new Set<string>();

  for (const record of ingestion.traffic ?? []) {
    roadSegmentIds.add(record.Segment_ID);
  }
  for (const record of ingestion.crowd ?? []) {
    baseStationIds.add(record.BS_ID);
  }
  return Object.freeze({ roadSegmentIds, baseStationIds });
}

// ─── Helpers: assumption application ─────────────────────────────────

function buildModificationMap(assumptions: readonly WhatIfAssumption[]): EntityModificationMap {
  const result = new Map<string, Map<ModifiableField, number>>();
  for (const a of assumptions) {
    const field = a.field as ModifiableField;
    let perEntity = result.get(a.entity_id);
    if (perEntity === undefined) {
      perEntity = new Map<ModifiableField, number>();
      result.set(a.entity_id, perEntity);
    }
    perEntity.set(field, a.value);
  }
  return result;
}

function applyModificationsToCrowd(ingestion: IngestionResult, mods: EntityModificationMap): void {
  const crowd = ingestion.crowd as unknown as MutableCrowdRecord[] | undefined;
  if (crowd === undefined) return;

  // Apply the assumption to every record of the target entity. The time
  // alignment strategy may pick any one of them depending on the event
  // timestamp; to guarantee the modified value reaches the pipeline we
  // rewrite every row the selector could choose.
  for (const [entityId, perEntity] of mods.entries()) {
    for (let i = 0; i < crowd.length; i++) {
      const r = crowd[i];
      if (r.BS_ID !== entityId) continue;
      for (const [field, value] of perEntity.entries()) {
        assignCrowdField(r, field, value);
      }
    }
  }
}

function applyModificationsToTraffic(
  ingestion: IngestionResult,
  mods: EntityModificationMap,
): void {
  const traffic = ingestion.traffic as unknown as MutableTrafficRecord[] | undefined;
  if (traffic === undefined) return;

  for (const [entityId, perEntity] of mods.entries()) {
    if (!entityId.startsWith(ROAD_SEGMENT_PREFIX)) continue;
    for (let i = 0; i < traffic.length; i++) {
      const r = traffic[i];
      if (r.Segment_ID !== entityId) continue;
      for (const [field, value] of perEntity.entries()) {
        assignTrafficField(r, field, value);
      }
    }
  }
}

function assignCrowdField(record: MutableCrowdRecord, field: ModifiableField, value: number): void {
  switch (field) {
    case 'User_Count':
      record.User_Count = value;
      break;
    case 'Growth_Rate':
      record.Growth_Rate = value;
      break;
    case 'Roaming_User_Pct':
      record.roaming_pct_value = value;
      record.Roaming_User_Pct = `${(value * 100).toFixed(2)}%`;
      break;
    case 'Saturation_Score':
      // Not applicable to crowd records — ignored.
      break;
  }
}

function assignTrafficField(
  record: MutableTrafficRecord,
  field: ModifiableField,
  value: number,
): void {
  switch (field) {
    case 'Saturation_Score':
      record.Saturation_Score = value;
      break;
    case 'User_Count':
    case 'Growth_Rate':
    case 'Roaming_User_Pct':
      // Not applicable to traffic records — ignored.
      break;
  }
}

// ─── Helpers: scenario incident ─────────────────────────────────────

function synthesizeScenarioIncident(
  assumptions: readonly WhatIfAssumption[],
  ingestion: IngestionResult,
): Incident {
  let targetEntity: string | undefined;
  for (const a of assumptions) {
    if (
      a.entity_id.startsWith(BASE_STATION_PREFIX) ||
      a.entity_id.startsWith(ROAD_SEGMENT_PREFIX)
    ) {
      targetEntity = a.entity_id;
      break;
    }
  }

  if (targetEntity === undefined) {
    const stations = ingestion.crowd ?? [];
    targetEntity = stations.length > 0 ? (stations[0] as RawCrowdRecord).BS_ID : 'BS_MRT_BL17';
  }

  const isBs = targetEntity.startsWith(BASE_STATION_PREFIX);

  let timestamp = '2026-05-20 18:00';
  if (isBs) {
    const records = (ingestion.crowd ?? []) as RawCrowdRecord[];
    for (let i = records.length - 1; i >= 0; i--) {
      const r = records[i];
      if (r.BS_ID === targetEntity) {
        timestamp = String(r.timestamp_raw).replace(/\//g, '-');
        break;
      }
    }
  } else {
    const records = (ingestion.traffic ?? []) as RawTrafficRecord[];
    for (let i = records.length - 1; i >= 0; i--) {
      const r = records[i];
      if (r.Segment_ID === targetEntity) {
        timestamp = String(r.timestamp_raw).replace(/\//g, '-');
        break;
      }
    }
  }

  const incident: Incident = {
    event_id: `whatif-scenario-${targetEntity}`,
    type: isBs ? IncidentType.Crowd_Surge_Injury : IncidentType.Road_Collapse_Accident,
    status: isBs ? IncidentStatus.Open : IncidentStatus.Blocked,
    severity: Severity.Critical,
    timestamp,
    location: isBs ? `${targetEntity} 站區` : `${targetEntity} 路段`,
    affected_segment: targetEntity,
    affected_road: isBs ? undefined : targetEntity,
    description: 'What-if scenario assumption applied by ProductionRuleEngineWhatIfFacade.',
  };

  return Object.freeze(incident);
}

// ─── Helpers: expected actions ──────────────────────────────────────

function buildExpectedActions(
  triggeredArticles: readonly number[],
  appliedFormulaArticles: readonly number[],
  invokedProcedures: readonly string[],
): readonly string[] {
  const set = new Set<string>();

  if (triggeredArticles.includes(3)) {
    set.add('建議北捷「過站不停」(MRT express skip-stop)');
    set.add('通知公車處調度接駁專車');
    set.add('引導群眾步行至 BS_MRT_BL18');
  }
  if (triggeredArticles.includes(4)) {
    set.add('啟動巨蛋周邊分流疏導');
  }
  if (triggeredArticles.includes(2)) {
    set.add('發布替代道路指引');
  }
  if (triggeredArticles.includes(1)) {
    set.add('調整號誌燈時');
  }
  if (triggeredArticles.includes(5)) {
    set.add('派遣員警指揮交通');
  }
  if (triggeredArticles.includes(6)) {
    set.add('發布多語言廣播');
  }
  if (appliedFormulaArticles.includes(7)) {
    set.add('套用 SOP-7 ETE 計算公式');
  }

  for (const proc of invokedProcedures) {
    set.add(proc);
  }

  return [...set];
}

// ─── Helpers: deep clone ────────────────────────────────────────────

function deepCloneIngestion(original: IngestionResult): IngestionResult {
  const trafficJson = JSON.stringify(original.traffic ?? []);
  const trafficCloned = JSON.parse(trafficJson) as RawTrafficRecord[];

  const crowdJson = JSON.stringify(original.crowd ?? []);
  const crowdCloned = JSON.parse(crowdJson) as RawCrowdRecord[];

  const incidentsJson = JSON.stringify(original.incidents ?? []);
  const incidentsCloned = JSON.parse(incidentsJson) as Incident[];

  const cloned: IngestionResult = {
    data_status: original.data_status,
    source_manifest_hash: original.source_manifest_hash,
    stop_reason: original.stop_reason,
    traffic: trafficCloned,
    trafficTimestamps: original.trafficTimestamps,
    crowd: crowdCloned,
    crowdTimestamps: original.crowdTimestamps,
    roadNetwork: original.roadNetwork,
    sopArticles: original.sopArticles as SOPLoadResult | undefined,
    incidents: incidentsCloned,
  };
  return cloned;
}

// ─── Helpers: default ConfigProvider ─────────────────────────────────

function defaultConfigProvider(): ConfigProvider {
  const defaults: Record<string, string | number> = {
    'policy.time_alignment.mode': 'exact_or_latest_prior_per_entity',
    'policy.time_alignment.max_staleness_minutes': 30,
    'policy.affected_road.role': 'display_only',
    'policy.ete.affected_set': 'incident_primary_and_selected_secondary',
    'policy.incident_anchor.mode': 'incident_anchor_from_location_text',
    'policy.affected_intersection_scope.mode': 'unresolved_manual_confirmation',
    'policy.multilingual_scope.mode': 'current_snapshot_all_available_stations',
  };
  return {
    get(key: string): string | number {
      const v = defaults[key];
      if (v === undefined) {
        throw new Error(`missing config key: ${key}`);
      }
      return v;
    },
  };
}

interface ConfigProvider {
  get(key: string): string | number;
}
