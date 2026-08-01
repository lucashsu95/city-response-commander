/** Deterministic Boundary Snapping & Containment pipeline. */
import type {
  BoundarySnapperConfig,
  ContainmentDecision,
  DataScopeStatus,
  EntityScopeResult,
  Incident,
  MappedAnchorNode,
  SafeContext,
  SopCitation,
  SopCoverageResult,
} from '@city-commander/shared-schemas';
import type { IngestionDataStatus, IngestionResult } from '../ingestion/data_ingestion_service.js';
import type { PolicyStrategyConfigProvider } from '../strategies/policy_strategy_bundle.js';
import {
  evaluateStationBasedArticles,
  runDeterministicDecision,
  type DeterministicDecisionFacts,
} from '../rule_engine/decision_pipeline.js';
import { aggregateArticles } from '../rule_engine/article_aggregation.js';
import { buildEvidenceTrace } from '../evidence/evidence_trace_builder.js';
import { checkEntityScope, snap } from './boundary_snapper.js';
import { partitionByWhitelist } from './whitelist_guard.js';
import { resolveSopCoverage } from './sop_coverage_resolver.js';

export interface ContainmentConfigError {
  readonly error: 'CONFIG_MISSING';
  readonly missing_key: string;
}

export interface DeterministicContainmentResult {
  readonly data_status: IngestionDataStatus;
  readonly stop_reason: string | null;
  readonly source_manifest_hash: string;
  readonly entity_scope: EntityScopeResult | null;
  readonly sop_coverage: SopCoverageResult | null;
  readonly data_scope_status: DataScopeStatus | null;
  readonly mapped_anchor_node: MappedAnchorNode | null;
  readonly safe_context: SafeContext | null;
  readonly composer_allowed: boolean;
  readonly decision: ContainmentDecision;
  readonly facts: DeterministicDecisionFacts | null;
}

export interface RunDeterministicContainmentInput {
  readonly ingestion: IngestionResult;
  readonly incident: Incident;
  readonly config: PolicyStrategyConfigProvider;
}

function readRequired(
  config: PolicyStrategyConfigProvider,
  key: string,
): unknown | ContainmentConfigError {
  try {
    return config.get(key);
  } catch {
    return { error: 'CONFIG_MISSING', missing_key: key };
  }
}

function readContainmentConfig(
  config: PolicyStrategyConfigProvider,
):
  | { readonly snap: BoundarySnapperConfig; readonly universalEnabled: boolean }
  | ContainmentConfigError {
  const maxDistance = readRequired(config, 'boundary_snapping.max_snap_distance_meters');
  if (typeof maxDistance !== 'number' || !Number.isFinite(maxDistance)) {
    return {
      error: 'CONFIG_MISSING',
      missing_key: 'boundary_snapping.max_snap_distance_meters',
    };
  }
  const coordinateEnabled = readRequired(config, 'boundary_snapping.coordinate_path_enabled');
  if (typeof coordinateEnabled !== 'boolean') {
    return { error: 'CONFIG_MISSING', missing_key: 'boundary_snapping.coordinate_path_enabled' };
  }
  if (coordinateEnabled) {
    const gazetteerSource = readRequired(config, 'boundary_snapping.anchor_gazetteer_source');
    if (typeof gazetteerSource !== 'string' || gazetteerSource.trim() === '') {
      return {
        error: 'CONFIG_MISSING',
        missing_key: 'boundary_snapping.anchor_gazetteer_source',
      };
    }
  }
  const universalEnabled = readRequired(config, 'containment.universal_sop_enabled');
  if (typeof universalEnabled !== 'boolean') {
    return { error: 'CONFIG_MISSING', missing_key: 'containment.universal_sop_enabled' };
  }
  return {
    snap: {
      max_snap_distance_meters: maxDistance,
      coordinate_path_enabled: coordinateEnabled,
    },
    universalEnabled,
  };
}

function stopped(ingestion: IngestionResult): DeterministicContainmentResult {
  return {
    data_status: ingestion.data_status,
    stop_reason: ingestion.stop_reason,
    source_manifest_hash: ingestion.source_manifest_hash,
    entity_scope: null,
    sop_coverage: null,
    data_scope_status: null,
    mapped_anchor_node: null,
    safe_context: null,
    composer_allowed: false,
    decision: { reroute_roads: [], perimeter_control: null, ai_reasoning: null },
    facts: null,
  };
}

function buildCoverageGapFacts(
  ingestion: IngestionResult,
  incident: Incident,
  config: PolicyStrategyConfigProvider,
): DeterministicDecisionFacts {
  const stationArticles = evaluateStationBasedArticles({
    ingestion,
    config,
    event_timestamp: incident.timestamp,
  });
  const articles = aggregateArticles({
    evaluations: stationArticles.evaluations,
    applied_formula_articles: [],
  });
  const sopCitations: SopCitation[] = [];
  for (const articleNo of articles.citation_article_set) {
    const chunk = ingestion.sopArticles?.getByArticleNo(articleNo);
    if (chunk !== undefined) {
      sopCitations.push({
        article_no: articleNo,
        source_location: `emergency_traffic_sop.txt#article-${articleNo}`,
        content: chunk.text,
      });
    }
  }
  return {
    source_manifest_hash: ingestion.source_manifest_hash,
    triggered_articles: articles.triggered_articles,
    applied_formula_articles: articles.applied_formula_articles,
    invoked_procedures: articles.invoked_procedures,
    citation_article_set: articles.citation_article_set,
    art1_measures: [],
    classifications: [],
    incident_anchor: null,
    primary_evacuation: null,
    secondary_evacuation: [],
    excluded_candidates: [],
    affected_road: null,
    affected_intersection_scope: null,
    ete: null,
    multilingual_required: stationArticles.multilingual_required,
    multilingual_scope: stationArticles.multilingual_scope,
    evidence: buildEvidenceTrace({
      decision_id: '',
      classification_reasoning: [],
      excluded_candidates: [],
      citation_article_set: articles.citation_article_set,
      sop_citations: sopCitations,
      data_points: [],
    }),
    cms_core_text: null,
    policy: stationArticles.policy,
    provisional: true,
  };
}

function allowedRoads(
  ingestion: IngestionResult,
  facts: DeterministicDecisionFacts,
  status: DataScopeStatus,
  anchor: MappedAnchorNode | null,
): readonly string[] {
  const network = ingestion.roadNetwork;
  if (network === undefined) return [];
  const whitelist = new Set(network.getAllSegments().map((segment) => segment.segment_id));
  const candidates =
    status === 'OUT_OF_BOUNDS_SNAPPED' && anchor !== null
      ? [anchor.segment_id, ...network.alternativesOf(anchor.segment_id)]
      : [
          ...(facts.primary_evacuation === null ? [] : [facts.primary_evacuation]),
          ...facts.secondary_evacuation,
          ...facts.excluded_candidates.map((candidate) => candidate.segment_id),
        ];
  return [...partitionByWhitelist(candidates, whitelist).allowed].sort();
}

function officialSopText(
  ingestion: IngestionResult,
  coverage: SopCoverageResult,
): readonly SopCitation[] {
  if (coverage.sop_coverage_status !== 'OFFICIAL_SOP_MATCHED') return [];
  return coverage.matched_article_nos.flatMap((articleNo) => {
    const chunk = ingestion.sopArticles?.getByArticleNo(articleNo);
    return chunk === undefined
      ? []
      : [
          {
            article_no: articleNo,
            source_location: `emergency_traffic_sop.txt#article-${articleNo}`,
            content: chunk.text,
          },
        ];
  });
}

function buildSafeContext(input: {
  readonly ingestion: IngestionResult;
  readonly incident: Incident;
  readonly coverage: SopCoverageResult;
  readonly status: DataScopeStatus;
  readonly anchor: MappedAnchorNode | null;
  readonly facts: DeterministicDecisionFacts;
}): SafeContext {
  const universal = input.coverage.sop_coverage_status === 'UNKNOWN_TYPE_UNIVERSAL_SOP';
  return {
    allowed_road_whitelist: allowedRoads(input.ingestion, input.facts, input.status, input.anchor),
    official_sop_text: universal ? null : officialSopText(input.ingestion, input.coverage),
    universal_principles: universal ? input.coverage.universal_principles : null,
    scope_disclosure:
      input.status === 'OUT_OF_BOUNDS_SNAPPED' && input.anchor !== null
        ? `原始地點「${input.incident.location}」未落於已劃設涵蓋範圍；系統已對齊至周界錨點「${input.anchor.gateway_intersection}」（${input.anchor.segment_id}）。`
        : null,
    instruction: `只可使用 allowed_road_whitelist 內的 road id，不得新增或推測其他道路。${universal ? '請依 DEFAULT_UNIVERSAL_SOP 提出周界管制與 Buffer Zone 建議，不得回覆無法判斷或拒絕提供建議。' : ''}`,
  };
}

function deterministicDecision(
  status: DataScopeStatus,
  anchor: MappedAnchorNode | null,
  safeContext: SafeContext | null,
  facts: DeterministicDecisionFacts,
): ContainmentDecision {
  const allowed = new Set(safeContext?.allowed_road_whitelist ?? []);
  const rerouteCandidates =
    status === 'OUT_OF_BOUNDS_SNAPPED'
      ? [...allowed].filter((roadId) => roadId !== anchor?.segment_id)
      : [
          ...(facts.primary_evacuation === null ? [] : [facts.primary_evacuation]),
          ...facts.secondary_evacuation,
        ].filter((roadId) => allowed.has(roadId));
  return {
    reroute_roads: [...new Set(rerouteCandidates)].sort(),
    perimeter_control:
      status === 'OUT_OF_BOUNDS_SNAPPED' && anchor !== null
        ? {
            action: '於周界錨點實施車流管制',
            target_gate: anchor.segment_id,
            reason: '事件位於既有路網涵蓋範圍外，於已驗證的周界錨點阻止車流繼續外溢。',
          }
        : null,
    ai_reasoning: null,
  };
}

/** Execute every deterministic containment decision behind one domain seam. */
export function runDeterministicContainment(
  input: RunDeterministicContainmentInput,
): DeterministicContainmentResult | ContainmentConfigError {
  if (input.ingestion.data_status !== 'ready') {
    return stopped(input.ingestion);
  }
  if (input.ingestion.roadNetwork === undefined) {
    return {
      ...stopped(input.ingestion),
      data_status: 'insufficient_data',
      stop_reason: 'Ingestion reported ready but roadNetwork is missing (invariant violation).',
    };
  }
  const settings = readContainmentConfig(input.config);
  if ('error' in settings) return settings;

  const entityScope = checkEntityScope(input.incident, input.ingestion.roadNetwork);
  const coverage = resolveSopCoverage(input.incident.type, input.incident.description);
  let status: DataScopeStatus;
  let anchor: MappedAnchorNode | null = null;
  let facts: DeterministicDecisionFacts;

  if (entityScope.coverage_status === 'OUT_OF_BOUNDS') {
    const snapped = snap(input.ingestion.roadNetwork, settings.snap);
    if ('error' in snapped) return snapped;
    status = snapped.coverage_status;
    anchor =
      snapped.anchor === null
        ? null
        : { ...snapped.anchor, distance_meters: snapped.distance_meters };
    facts = buildCoverageGapFacts(input.ingestion, input.incident, input.config);
  } else {
    status = entityScope.coverage_status;
    const decision = runDeterministicDecision(input);
    if (decision.data_status !== 'ready' || decision.facts === null) {
      return stopped(input.ingestion);
    }
    facts = decision.facts;
  }

  const universalDisabled =
    coverage.sop_coverage_status === 'UNKNOWN_TYPE_UNIVERSAL_SOP' && !settings.universalEnabled;
  const composerAllowed = status !== 'OUT_OF_JURISDICTION' && !universalDisabled;
  const safeContext = universalDisabled
    ? null
    : buildSafeContext({
        ingestion: input.ingestion,
        incident: input.incident,
        coverage,
        status,
        anchor,
        facts,
      });

  return {
    data_status: 'ready',
    stop_reason: null,
    source_manifest_hash: input.ingestion.source_manifest_hash,
    entity_scope: entityScope,
    sop_coverage: coverage,
    data_scope_status: status,
    mapped_anchor_node: anchor,
    safe_context: safeContext,
    composer_allowed: composerAllowed,
    decision: deterministicDecision(status, anchor, safeContext, facts),
    facts,
  };
}
