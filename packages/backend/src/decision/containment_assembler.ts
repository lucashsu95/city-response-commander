/**
 * Containment_Assembler — the entry point for the Boundary Snapping &
 * Containment Protocol (spec: boundary-snapping-containment, R1, R12).
 *
 * This is a Layer 2 orchestrator: it calls Layer 1 deterministic domain
 * functions (`checkEntityScope`, `resolveSopCoverage`, `runDeterministicDecision`,
 * `evaluateStationBasedArticles`, and `snap`) but contains no rule semantics
 * of its own, mirroring `DefaultDomainPipelineAdapter`'s existing split of
 * responsibility.
 *
 * ## Scope of this revision (TASK-BS-10 through TASK-BS-12)
 *
 * Wired so far (design.md §3.1, steps 1-2 plus the `IN_SCOPE`/
 * `IN_SCOPE_BY_INTERSECTION` branch of step "existing pipeline"):
 * - The STOP-gate short circuit (TASK-BS-10).
 * - Entity_Scope_Check + SOP coverage resolution (TASK-BS-10).
 * - For `IN_SCOPE`/`IN_SCOPE_BY_INTERSECTION`: call `runDeterministicDecision`
 *   exactly as `DefaultDomainPipelineAdapter` does today, with no parameter
 *   changes (TASK-BS-11, R12 AC3/AC6/AC7 — proven by
 *   `containment_assembler.test.ts`'s no-regression cases against the same
 *   golden fixtures `decision_pipeline.test.ts` uses).
 * - For `OUT_OF_BOUNDS`: call `snap()`, skip the existing RD_ sub-pipeline,
 *   and retain only the shared SOP-3/4/6 station evaluations (TASK-BS-12).
 * - Build a branch-specific Safe_Context whose road action space is a proven
 *   subset of Road_Whitelist (TASK-BS-13).
 *
 * NOT yet wired: the Bedrock/Whitelist_Guard call (TASK-BS-14).
 *
 * ## The STOP-gate short circuit (R12 AC2)
 *
 * `IngestionResult.roadNetwork` / `.sopArticles` are only present when
 * `data_status === 'ready'` (data_ingestion_service.ts). When ingestion did
 * not reach `ready`, this function returns the existing `insufficient_data`
 * / `stop_reason` verbatim — unchanged from `DefaultDomainPipelineAdapter`'s
 * behavior — and never calls `checkEntityScope` or `resolveSopCoverage`,
 * since there is no road network or SOP corpus to check against.
 *
 * @module backend/decision/containment_assembler
 */

import {
  aggregateArticles,
  buildEvidenceTrace,
  checkEntityScope,
  evaluateStationBasedArticles,
  partitionByWhitelist,
  resolveSopCoverage,
  runDeterministicDecision,
  snap,
} from '@city-commander/domain';
import type {
  DeterministicDecisionFacts,
  IngestionDataStatus,
  IngestionResult,
  PolicyStrategyConfigProvider,
} from '@city-commander/domain';
import type {
  BoundarySnapperConfig,
  DataScopeStatus,
  EntityScopeResult,
  Incident,
  MappedAnchorNode,
  SopCitation,
  SopCoverageResult,
  UniversalPrinciple,
} from '@city-commander/shared-schemas';

export interface AssembleContainmentInput {
  readonly ingestion: IngestionResult;
  readonly incident: Incident;
  readonly config: PolicyStrategyConfigProvider;
}

/** Restricted prompt context handed to Bedrock_Composer starting in TASK-BS-14. */
export interface SafeContext {
  readonly allowed_road_whitelist: readonly string[];
  readonly official_sop_text: readonly SopCitation[] | null;
  readonly universal_principles: readonly UniversalPrinciple[] | null;
  readonly scope_disclosure: string | null;
  readonly instruction: string;
}

/**
 * Result through the deterministic TASK-BS-12 stage. Superseded by the full
 * `ContainmentResult` shape (design.md §6) once TASK-BS-13/14 add Safe_Context,
 * Bedrock composition, and whitelist auditing.
 */
export interface ContainmentAssemblerResult {
  readonly data_status: IngestionDataStatus;
  /** Verbatim from `ingestion.stop_reason` (or the decision pipeline's, for `IN_SCOPE*`). `null` only when `data_status === 'ready'`. */
  readonly stop_reason: string | null;
  readonly source_manifest_hash: string;
  /** `null` only when `data_status !== 'ready'` (R12 AC2). */
  readonly entity_scope: EntityScopeResult | null;
  /** `null` only when `data_status !== 'ready'` (R12 AC2). */
  readonly sop_coverage: SopCoverageResult | null;
  /**
   * `null` only when `data_status !== 'ready'`; otherwise the final scope after
   * Entity_Scope_Check and, when needed, Boundary_Snapper (R10 AC1).
   */
  readonly data_scope_status: DataScopeStatus | null;
  /**
   * Populated only for `OUT_OF_BOUNDS_SNAPPED`; `IN_SCOPE*` never snaps and
   * `OUT_OF_JURISDICTION` has no valid anchor (R10 AC9).
   */
  readonly mapped_anchor_node: MappedAnchorNode | null;
  /** `null` only on a STOP path; otherwise assembled deterministically (R8). */
  readonly safe_context: SafeContext | null;
  /**
   * `IN_SCOPE*` receives the unchanged full deterministic facts. Coverage-gap
   * facts contain only SOP-3/4/6 station outcomes; every RD_-specific field is
   * empty/null because that sub-pipeline is deliberately skipped (R12 AC4-AC6).
   */
  readonly facts: DeterministicDecisionFacts | null;
}

function stoppedFromIngestion(ingestion: {
  readonly data_status: IngestionDataStatus;
  readonly stop_reason: string | null;
  readonly source_manifest_hash: string;
}): ContainmentAssemblerResult {
  return {
    data_status: ingestion.data_status,
    stop_reason: ingestion.stop_reason,
    source_manifest_hash: ingestion.source_manifest_hash,
    entity_scope: null,
    sop_coverage: null,
    data_scope_status: null,
    mapped_anchor_node: null,
    safe_context: null,
    facts: null,
  };
}

function isInScope(
  status: EntityScopeResult['coverage_status'],
): status is Extract<DataScopeStatus, 'IN_SCOPE' | 'IN_SCOPE_BY_INTERSECTION'> {
  return status === 'IN_SCOPE' || status === 'IN_SCOPE_BY_INTERSECTION';
}

function readBoundarySnapperConfig(config: PolicyStrategyConfigProvider): BoundarySnapperConfig {
  const maxDistance = config.get('boundary_snapping.max_snap_distance_meters');
  const coordinatePathEnabled = config.get('boundary_snapping.coordinate_path_enabled');

  if (typeof maxDistance !== 'number' || !Number.isFinite(maxDistance)) {
    throw new Error('boundary_snapping.max_snap_distance_meters must be a finite number.');
  }
  if (typeof coordinatePathEnabled !== 'boolean') {
    throw new Error('boundary_snapping.coordinate_path_enabled must be a boolean.');
  }

  return {
    max_snap_distance_meters: maxDistance,
    coordinate_path_enabled: coordinatePathEnabled,
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
  if (ingestion.sopArticles !== undefined) {
    for (const articleNo of articles.citation_article_set) {
      const chunk = ingestion.sopArticles.getByArticleNo(articleNo);
      if (chunk !== undefined) {
        sopCitations.push({
          article_no: articleNo,
          source_location: `emergency_traffic_sop.txt#article-${articleNo}`,
          content: chunk.text,
        });
      }
    }
  }

  const evidence = buildEvidenceTrace({
    decision_id: '',
    classification_reasoning: [],
    excluded_candidates: [],
    citation_article_set: articles.citation_article_set,
    sop_citations: sopCitations,
    data_points: [],
  });

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
    evidence,
    cms_core_text: null,
    policy: stationArticles.policy,
    provisional: true,
  };
}

function buildSafeContext(input: {
  readonly ingestion: IngestionResult;
  readonly incident: Incident;
  readonly sopCoverage: SopCoverageResult;
  readonly dataScopeStatus: DataScopeStatus;
  readonly mappedAnchorNode: MappedAnchorNode | null;
  readonly facts: DeterministicDecisionFacts;
}): SafeContext {
  const roadNetwork = input.ingestion.roadNetwork;
  if (roadNetwork === undefined) {
    throw new Error('Safe_Context requires a ready ingestion with roadNetwork.');
  }

  const roadWhitelist = new Set(roadNetwork.getAllSegments().map((segment) => segment.segment_id));
  let candidateIds: readonly string[] = [];

  if (
    input.dataScopeStatus === 'IN_SCOPE' ||
    input.dataScopeStatus === 'IN_SCOPE_BY_INTERSECTION'
  ) {
    candidateIds = [
      ...(input.facts.primary_evacuation === null ? [] : [input.facts.primary_evacuation]),
      ...input.facts.secondary_evacuation,
      ...input.facts.excluded_candidates.map((candidate) => candidate.segment_id),
    ];
  } else if (input.dataScopeStatus === 'OUT_OF_BOUNDS_SNAPPED' && input.mappedAnchorNode !== null) {
    candidateIds = [
      input.mappedAnchorNode.segment_id,
      ...roadNetwork.alternativesOf(input.mappedAnchorNode.segment_id),
    ];
  }

  const allowedRoadIds = [...partitionByWhitelist(candidateIds, roadWhitelist).allowed].sort();
  const officialSopText: SopCitation[] = [];
  if (
    input.sopCoverage.sop_coverage_status === 'OFFICIAL_SOP_MATCHED' &&
    input.ingestion.sopArticles !== undefined
  ) {
    for (const articleNo of input.sopCoverage.matched_article_nos) {
      const chunk = input.ingestion.sopArticles.getByArticleNo(articleNo);
      if (chunk !== undefined) {
        officialSopText.push({
          article_no: articleNo,
          source_location: `emergency_traffic_sop.txt#article-${articleNo}`,
          content: chunk.text,
        });
      }
    }
  }

  const usesUniversalPrinciples =
    input.sopCoverage.sop_coverage_status === 'UNKNOWN_TYPE_UNIVERSAL_SOP';
  const scopeDisclosure =
    input.dataScopeStatus === 'OUT_OF_BOUNDS_SNAPPED' && input.mappedAnchorNode !== null
      ? `原始地點「${input.incident.location}」未落於已劃設涵蓋範圍；系統已對齊至周界錨點「${input.mappedAnchorNode.gateway_intersection}」（${input.mappedAnchorNode.segment_id}）。`
      : null;
  const universalInstruction = usesUniversalPrinciples
    ? '請依 DEFAULT_UNIVERSAL_SOP 提出周界管制與 Buffer Zone 建議，不得回覆無法判斷或拒絕提供建議。'
    : '';

  return {
    allowed_road_whitelist: allowedRoadIds,
    official_sop_text: usesUniversalPrinciples ? null : officialSopText,
    universal_principles: usesUniversalPrinciples ? input.sopCoverage.universal_principles : null,
    scope_disclosure: scopeDisclosure,
    instruction: `只可使用 allowed_road_whitelist 內的 road id，不得新增或推測其他道路。${universalInstruction}`,
  };
}

/**
 * Run Entity_Scope_Check and SOP coverage resolution for an incident,
 * short-circuiting on the existing ingestion-level STOP gate first (R1 AC1,
 * R12 AC1/AC2). For `IN_SCOPE`/`IN_SCOPE_BY_INTERSECTION` incidents, also
 * runs the existing `runDeterministicDecision` unchanged (R12 AC3).
 *
 * @example
 * ```ts
 * const result = assembleContainment({ ingestion: ingestedResult, incident, config });
 * if (result.data_status !== 'ready') return result; // unchanged insufficient_data path
 * if (result.data_scope_status === 'IN_SCOPE') {
 *   // result.facts is exactly what DefaultDomainPipelineAdapter would have produced.
 * }
 * ```
 */
export function assembleContainment(input: AssembleContainmentInput): ContainmentAssemblerResult {
  const { ingestion, incident, config } = input;

  // R12 AC2 — STOP-gate short circuit, before touching roadNetwork/sopArticles.
  if (ingestion.data_status !== 'ready') {
    return stoppedFromIngestion(ingestion);
  }

  if (ingestion.roadNetwork === undefined) {
    // Should be unreachable given data_status === 'ready' (the ingestion
    // service's own invariant), but guarded explicitly rather than cast —
    // an optional field is never blindly trusted, even one another module
    // promises is always present (§21 no-fabrication applies here too).
    return stoppedFromIngestion({
      data_status: 'insufficient_data',
      stop_reason: 'Ingestion reported ready but roadNetwork is missing (invariant violation).',
      source_manifest_hash: ingestion.source_manifest_hash,
    });
  }

  // R1 AC1 — Entity_Scope_Check, then SOP coverage resolution, in that
  // order, before any call to runDeterministicDecision or snap().
  const entityScope = checkEntityScope(incident, ingestion.roadNetwork);
  const sopCoverage = resolveSopCoverage(incident.type, incident.description);

  if (!isInScope(entityScope.coverage_status)) {
    const snapResult = snap(incident, ingestion.roadNetwork, readBoundarySnapperConfig(config));
    if ('error' in snapResult) {
      throw new Error(`Boundary_Snapper configuration error: ${snapResult.missing_key}.`);
    }

    const mappedAnchorNode =
      snapResult.anchor === null
        ? null
        : {
            ...snapResult.anchor,
            distance_meters: snapResult.distance_meters,
          };
    const coverageGapFacts = buildCoverageGapFacts(ingestion, incident, config);
    const safeContext = buildSafeContext({
      ingestion,
      incident,
      sopCoverage,
      dataScopeStatus: snapResult.coverage_status,
      mappedAnchorNode,
      facts: coverageGapFacts,
    });

    // R12 AC4-AC6 — no call to runDeterministicDecision's RD_ branch. Only
    // the extracted BS_ID-keyed SOP-3/4/6 subset remains available in facts.
    return {
      data_status: 'ready',
      stop_reason: null,
      source_manifest_hash: ingestion.source_manifest_hash,
      entity_scope: entityScope,
      sop_coverage: sopCoverage,
      data_scope_status: snapResult.coverage_status,
      mapped_anchor_node: mappedAnchorNode,
      safe_context: safeContext,
      facts: coverageGapFacts,
    };
  }

  // R12 AC3 — IN_SCOPE / IN_SCOPE_BY_INTERSECTION: run the existing
  // deterministic pipeline exactly as DefaultDomainPipelineAdapter does,
  // with no parameter changes.
  const decision = runDeterministicDecision({ ingestion, config, incident });

  if (decision.data_status !== 'ready' || decision.facts === null) {
    // Unreachable in practice: `ingestion` is already known `ready` here, and
    // `runDeterministicDecision`'s own STOP gate only fires on
    // `ingestion.data_status !== 'ready'` (decision_pipeline.ts §21). Guarded
    // anyway, mirroring DefaultDomainPipelineAdapter's own belt-and-suspenders
    // check — a fault must never be laundered into a fabricated decision.
    return {
      data_status: 'insufficient_data',
      stop_reason: decision.stop_reason ?? 'Domain pipeline reported insufficient_data.',
      source_manifest_hash: decision.source_manifest_hash,
      entity_scope: entityScope,
      sop_coverage: sopCoverage,
      data_scope_status: null,
      mapped_anchor_node: null,
      safe_context: null,
      facts: null,
    };
  }

  return {
    data_status: 'ready',
    stop_reason: null,
    source_manifest_hash: decision.source_manifest_hash,
    entity_scope: entityScope,
    sop_coverage: sopCoverage,
    data_scope_status: entityScope.coverage_status,
    mapped_anchor_node: null, // R10 AC9 — IN_SCOPE* never snaps.
    safe_context: buildSafeContext({
      ingestion,
      incident,
      sopCoverage,
      dataScopeStatus: entityScope.coverage_status,
      mappedAnchorNode: null,
      facts: decision.facts,
    }),
    facts: decision.facts,
  };
}
