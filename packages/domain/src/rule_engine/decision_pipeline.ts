/**
 * DecisionPipeline — single cohesive deterministic-decision composition facade.
 *
 * Composes the already-exported domain functions (Strategies A–F, the SOP-1..7
 * rule engine, ETE, and the evidence trace) into ONE deterministic call so the
 * backend can obtain the full DecisionCore facts without hand-assembling the
 * individual rule-engine steps.
 *
 * This module ONLY composes existing functions. It never re-implements any rule
 * logic and never fabricates numbers: when ingestion did not reach `ready`
 * (source-hash STOP / missing data), it returns `insufficient_data` with
 * `facts: null` (§21).
 *
 * The composition order mirrors the organizer-guided golden walkthroughs
 * (acc_001, evt_002, evt_003, dome_and_sop6). Identity/workflow fields owned by
 * the backend (decision_id, idempotency_key, injection_run_id,
 * workflow_execution_name, version) are intentionally NOT produced here.
 *
 * @module domain/rule_engine/decision_pipeline
 */

import type {
  AffectedIntersectionScope,
  Art1Measures,
  ArticleTriggerGrounding,
  CascadingRisk,
  ClassificationReasoning,
  CrowdPreWarning,
  EvidenceTrace,
  GroundingCandidate,
  Incident,
  IncidentAnchor,
  PolicyMetadata,
  RouteCandidate,
  SegmentClassification,
  Severity,
  SignalConflict,
  SopCitation,
  SopMatchResult,
  UniversalPrinciple,
} from '@city-commander/shared-schemas';

import type { IngestionDataStatus, IngestionResult } from '../ingestion/data_ingestion_service.js';
import { normalizeTimestamp } from '../ingestion/timestamp_normalizer.js';
import {
  createPolicyStrategyBundle,
  type PolicyStrategyConfigProvider,
} from '../strategies/policy_strategy_bundle.js';
import type { AffectedRoadStrategyResult } from '../strategies/affected_road_strategy.js';
import type { CurrentStationSnapshot } from '../strategies/multilingual_scope_strategy.js';
import type { RoadNetworkModel } from '../road_network/road_network_model.js';
import {
  selectLatestCommonExactSnapshot,
  type EteTrafficReading,
} from '../strategies/ete_affected_set_strategy.js';
import { classifySegments } from './classification_engine.js';
import { evaluateArticle1 } from './article1.js';
import { isArticle2Triggered, qualifyCandidates } from './article2.js';
import { ARTICLE3_STATION_ID, evaluateArticle3 } from './article3.js';
import {
  ARTICLE4_STATION_ID,
  DOME_PEAK_THRESHOLD,
  DOME_GROWTH_THRESHOLD,
  evaluateArticle4,
} from './article4.js';
import { evaluateArticle5, isArticle5Triggered } from './article5.js';
import { evaluateArticle6 } from './article6.js';
import { selectEvacuation } from './evacuation_selector.js';
import { aggregateArticles, type ArticleEvaluationSummary } from './article_aggregation.js';
import { calculateEte, type EteCalculationResult } from '../ete/ete_calculator.js';
import { buildEvidenceTrace } from '../evidence/evidence_trace_builder.js';
import {
  resolveSopMatch,
  selectGroundingCandidates,
  UNIVERSAL_DEFENSE_PRINCIPLES,
} from './universal_defense.js';
import {
  excludeSelfBlockedCandidates,
  diffSelfBlockedExclusions,
  detectPreWarning,
  detectSignalConflicts,
  buildAdjacencyGraph,
  detectCascadingRisk,
  detectSop3UserCountPreWarning,
  detectSop3GrowthRatePreWarning,
  detectSop4GrowthRatePreWarning,
  detectSop6RoamingPreWarning,
  type SaturationHistoryPoint,
  type NumericHistoryPoint,
} from './grey_zone_arbitration.js';

// ─── Public Input / Result Types ───────────────────────────

/**
 * Input for {@link runDeterministicDecision}.
 *
 * The pipeline consumes an already-produced {@link IngestionResult} (so it never
 * re-runs ingestion), the target incident (provided directly or looked up by
 * `event_id` inside `ingestion.incidents`), and a ConfigProvider compatible with
 * {@link createPolicyStrategyBundle} / SnapshotSelector.
 */
export interface DeterministicDecisionInput {
  /** Result of DataIngestionService.ingestData — never re-ingested here. */
  readonly ingestion: IngestionResult;
  /** ConfigProvider used to resolve provisional Strategies A–F. */
  readonly config: PolicyStrategyConfigProvider;
  /** The target incident. Takes precedence over `event_id` when both are present. */
  readonly incident?: Incident;
  /** Alternatively, the event_id to look up in `ingestion.incidents`. */
  readonly event_id?: string;
}

/**
 * Every deterministic fact required to populate DecisionCore, EXCEPT the
 * identity/workflow fields owned by the backend (decision_id, idempotency_key,
 * injection_run_id, workflow_execution_name, version, core_hash).
 */
export interface DeterministicDecisionFacts {
  readonly source_manifest_hash: string;

  readonly triggered_articles: readonly number[];
  readonly applied_formula_articles: readonly number[];
  readonly invoked_procedures: readonly string[];
  readonly citation_article_set: readonly number[];

  readonly art1_measures: readonly Art1Measures[];
  readonly classifications: readonly SegmentClassification[];

  readonly incident_anchor: IncidentAnchor | null;
  readonly primary_evacuation: string | null;
  readonly secondary_evacuation: readonly string[];
  readonly excluded_candidates: readonly RouteCandidate[];

  /** Strategy B contextual role of a BS-event affected_road (null for RD_ events). */
  readonly affected_road: AffectedRoadStrategyResult | null;

  readonly affected_intersection_scope: AffectedIntersectionScope | null;

  /** ETE (SOP-7). Null when the formula is not applicable (e.g. BS_ events). */
  readonly ete: EteCalculationResult | null;

  readonly multilingual_required: boolean;
  readonly multilingual_scope: {
    readonly mode: string;
    readonly stations_in_scope: readonly string[];
  } | null;

  readonly evidence: EvidenceTrace;
  /** Official CMS core text; only SOP-5 produces one deterministically. */
  readonly cms_core_text: string | null;
  readonly policy: PolicyMetadata;

  /**
   * UARE (Unified Adaptive Reasoning Engine, spec:
   * .kiro/specs/unified-adaptive-reasoning-engine/). `sop_matched` is a pure
   * projection of `triggered_articles` (§UARE-R1) — always populated, never
   * `undefined`, unlike its optional counterpart on `DecisionCore`.
   */
  readonly sop_matched: boolean;
  readonly sop_authority: SopMatchResult['sop_authority'];
  /** Non-empty only when `sop_matched` is `false` (§UARE-R2). */
  readonly universal_principles: readonly UniversalPrinciple[];
  /** Non-empty only when `sop_matched` is `false` and a grounding anchor was resolvable (§UARE-R3, R6). */
  readonly grounding_candidates: readonly GroundingCandidate[];

  /**
   * GZAE (Grey-Zone Arbitration Engine, spec:
   * .kiro/specs/grey-zone-arbitration-engine/). §GZAE-R2: segments in the
   * `[0.80, 0.85)` grey zone with a strictly rising 3-point trend. Never
   * affects `classifications`.
   */
  readonly pre_warning_segments: readonly string[];
  /**
   * GZAE (§GZAE-R2 extension). Same grey-zone trend pre-warning as
   * `pre_warning_segments`, generalized to SOP-3/4/6's crowd thresholds.
   */
  readonly crowd_pre_warnings: readonly CrowdPreWarning[];
  /** GZAE (§GZAE-R3). Cross-article traffic/crowd signal contradictions, advisory-only. */
  readonly signal_conflicts: readonly SignalConflict[];
  /** GZAE (§GZAE-R4). Adjacent, individually-non-escalating incidents; `null` when none detected. */
  readonly cascading_risk: CascadingRisk | null;
  /** GZAE (§GZAE-R1). `segment_id`s excluded because they are themselves blocked by another active incident. */
  readonly self_blocked_exclusions: readonly string[];

  /**
   * Deterministic per-article trigger grounding for the crowd-scoped articles
   * (3, 4, 6) — which entity's value actually satisfied the condition, and
   * why. Each of these articles is hard-bound to one specific station
   * (BS_MRT_BL17 for art.3, BS_TPE_DOME for art.4, the roaming-triggering
   * station(s) for art.6); a caller cannot infer that binding from
   * `triggered_articles` alone. Populated only when the article actually
   * triggers; never affects the trigger determination itself.
   */
  readonly trigger_grounding: readonly ArticleTriggerGrounding[];

  readonly provisional: true;
}

/** Result of {@link runDeterministicDecision}. `facts` is null on insufficient data. */
export interface DeterministicDecisionResult {
  readonly data_status: IngestionDataStatus;
  readonly stop_reason: string | null;
  readonly source_manifest_hash: string;
  readonly facts: DeterministicDecisionFacts | null;
}

// ─── Internal helper record shapes (Strategy-A selectable) ──

interface TrafficSelectRecord {
  readonly timestamp_normalized: Date;
  readonly saturation_score: number;
}

interface CrowdSelectRecord {
  readonly timestamp_normalized: Date;
  readonly user_count: number;
  readonly growth_rate: number;
  readonly roaming_pct_value: number;
}

// ─── Facade ────────────────────────────────────────────────

/**
 * Compose the full deterministic decision from ingested official data.
 *
 * Behaviour mirrors the organizer-guided golden walkthroughs and branches by
 * event kind:
 * - RD_ incidents: Strategy-A snapshot → classify → art.1 → anchor (Strategy D)
 *   → qualify candidates → select evacuation → ETE affected-set (Strategy C) →
 *   latest common exact snapshot → ETE (art.7) → art.2 trigger.
 * - Power_Failure / signal-failure incidents: affected-intersection scope
 *   (Strategy E) → art.5.
 * - BS_ incidents: art.3 (BL17) and art.4 (dome) as applicable, affected_road as
 *   Strategy B context; ETE is not applicable.
 * - Multilingual (Strategy F → art.6) is always computed where stations are in scope.
 *
 * @returns Deterministic facts, or `insufficient_data` with `facts: null` when
 *          ingestion did not reach `ready`.
 */
export function runDeterministicDecision(
  input: DeterministicDecisionInput,
): DeterministicDecisionResult {
  const { ingestion, config } = input;

  // §21 STOP gate — never fabricate on missing/unverified data.
  if (ingestion.data_status !== 'ready') {
    return {
      data_status: 'insufficient_data',
      stop_reason: ingestion.stop_reason ?? 'insufficient_data',
      source_manifest_hash: ingestion.source_manifest_hash,
      facts: null,
    };
  }

  const incident = resolveIncident(input);
  const bundle = createPolicyStrategyBundle(config);
  const roadNetwork = ingestion.roadNetwork;
  const eventDate = normalizeTimestamp(incident.timestamp).timestamp_normalized;

  // GZAE (§GZAE-R1, R4): other incidents from the same ingested set, excluding
  // the one being decided. Reuses `ingestion.incidents` — no new input surface.
  const otherActiveIncidents: readonly Incident[] = (ingestion.incidents ?? []).filter(
    (candidate) => candidate.event_id !== incident.event_id,
  );

  const trafficByStation = groupTraffic(ingestion);
  const crowdByStation = groupCrowd(ingestion);

  const evaluations: ArticleEvaluationSummary[] = [];
  const saturationBySegment = new Map<string, number>();

  let art1Measures: readonly Art1Measures[] = [];
  let classifications: readonly SegmentClassification[] = [];
  let incidentAnchor: IncidentAnchor | null = null;
  let primaryEvacuation: string | null = null;
  let secondaryEvacuation: readonly string[] = [];
  let excludedCandidates: readonly RouteCandidate[] = [];
  let affectedRoad: AffectedRoadStrategyResult | null = null;
  let affectedIntersectionScope: AffectedIntersectionScope | null = null;
  let ete: EteCalculationResult | null = null;
  let cmsCoreText: string | null = null;

  // GZAE (§GZAE-R1..R4) outputs — additive except self_blocked_exclusions,
  // which reflects R1's post-hoc correction of `candidates`/`excludedCandidates`.
  let preWarningSegments: readonly string[] = [];
  const crowdPreWarnings: CrowdPreWarning[] = [];
  let selfBlockedExclusions: readonly string[] = [];
  const crowdTriggeredStationIds = new Set<string>();
  // Which entity's value actually satisfied each triggered crowd article
  // (3/4/6) — see DeterministicDecisionFacts.trigger_grounding.
  const triggerGrounding: ArticleTriggerGrounding[] = [];

  const isRoadEvent = incident.affected_segment.startsWith('RD_');

  const selectSaturation = (segmentId: string): number | null => {
    const records = trafficByStation.get(segmentId);
    if (records === undefined || records.length === 0) return null;
    const selected = bundle.timeAlignment.select(segmentId, eventDate, records);
    return selected.record?.saturation_score ?? null;
  };

  // ─── RD_ path: classification, art.1, anchor, evacuation, ETE, art.2 ──
  if (isRoadEvent && roadNetwork !== undefined) {
    const incidentSaturation = selectSaturation(incident.affected_segment);
    if (incidentSaturation !== null) {
      saturationBySegment.set(incident.affected_segment, incidentSaturation);
    }

    classifications = classifySegments([
      { segment_id: incident.affected_segment, saturation_score: incidentSaturation },
    ]);

    const article1 = evaluateArticle1(classifications);
    art1Measures = article1.art1_measures;
    if (article1.triggered) {
      evaluations.push({
        article: 1,
        triggered: true,
        invoked_procedures: article1.invoked_procedures,
      });
    }

    const anchor = bundle.incidentAnchor.resolve(incident, roadNetwork, {
      mode: bundle.metadata.incident_anchor.mode,
    });
    incidentAnchor = anchor;

    const saturationMap = new Map<string, number>();
    for (const alternativeId of roadNetwork.alternativesOf(incident.affected_segment)) {
      saturationMap.set(alternativeId, selectSaturation(alternativeId) ?? 0);
    }

    // An unresolved anchor must not be treated as a positional reference.
    const anchorIntersection = anchor.manual_confirmation_required
      ? null
      : anchor.anchor_intersection;

    const candidatesBeforeGzae = qualifyCandidates(
      incident.affected_segment,
      anchorIntersection,
      roadNetwork,
      saturationMap,
    );
    // GZAE §GZAE-R1: exclude candidates that are themselves blocked by another
    // active incident. Runs strictly after the existing 3-AND qualification
    // above and never upgrades an already-excluded candidate.
    const candidates = excludeSelfBlockedCandidates(
      candidatesBeforeGzae,
      incident.event_id,
      otherActiveIncidents,
    );
    selfBlockedExclusions = diffSelfBlockedExclusions(candidatesBeforeGzae, candidates);

    const evacuation = selectEvacuation(candidates);
    primaryEvacuation = evacuation.primary_evacuation;
    secondaryEvacuation = evacuation.secondary_evacuation;
    excludedCandidates = evacuation.excluded_candidates;

    if (isArticle2Triggered(incident)) {
      evaluations.push({ article: 2, triggered: true });
    }

    // GZAE §GZAE-R2: threshold-boundary trend pre-warning for the incident's
    // own segment. Additive-only — never changes `classifications.level`.
    if (incidentSaturation !== null) {
      const history = recentSaturationHistoryBefore(
        trafficByStation.get(incident.affected_segment) ?? [],
        eventDate,
      );
      if (detectPreWarning(incidentSaturation, history)) {
        preWarningSegments = [incident.affected_segment];
      }
    }

    // ETE affected-set (Strategy C) + latest common exact snapshot + art.7.
    affectedRoad = bundle.affectedRoad.resolve(incident);
    const affectedSet = bundle.eteAffectedSet.resolve({
      incident,
      affected_road: affectedRoad,
      selected_primary_evacuation: primaryEvacuation,
      selected_secondary_evacuation: secondaryEvacuation,
    });
    const snapshotProvenance = selectLatestCommonExactSnapshot({
      affected_set: affectedSet.affected_set,
      event_timestamp: incident.timestamp,
      traffic_readings: buildEteTrafficReadings(ingestion, affectedSet.affected_set),
    });
    ete = calculateEte({
      severity: incident.severity as Severity,
      affected_set: affectedSet,
      snapshot_provenance: snapshotProvenance,
    });
  } else if (!isRoadEvent) {
    // BS_ event: affected_road is contextual only (Strategy B); ETE not applicable.
    affectedRoad = bundle.affectedRoad.resolve(incident);
  }

  // ─── SOP-5 signal failure (Strategy E) ──
  if (isArticle5Triggered(incident)) {
    const segment = roadNetwork?.getSegment(incident.affected_segment);
    const scope = bundle.affectedIntersectionScope.resolve(incident, segment, {
      mode: bundle.metadata.affected_intersection_scope.mode,
    });
    affectedIntersectionScope = scope;
    const affectedRoadName = segment?.name ?? incident.affected_road ?? incident.affected_segment;
    const article5 = evaluateArticle5({
      incident,
      affected_road_name: affectedRoadName,
      affected_intersection_scope: scope,
    });
    if (article5.triggered) {
      evaluations.push({ article: 5, triggered: true });
      cmsCoreText = article5.cms_core_text;
    }
  }

  // ─── SOP-3 (BL17) as applicable ──
  const bl17Records = crowdByStation.get(ARTICLE3_STATION_ID);
  if (bl17Records !== undefined && bl17Records.length > 0) {
    const selected = bundle.timeAlignment.select(ARTICLE3_STATION_ID, eventDate, bl17Records);
    const record = selected.record;
    const article3 = evaluateArticle3({
      bs_id: ARTICLE3_STATION_ID,
      user_count: record?.user_count ?? null,
      growth_rate: record?.growth_rate ?? null,
    });
    if (article3.triggered) {
      evaluations.push({ article: 3, triggered: true });
      crowdTriggeredStationIds.add(ARTICLE3_STATION_ID);
      triggerGrounding.push({
        article: 3,
        entity_id: ARTICLE3_STATION_ID,
        reason: article3.trigger_reason ?? 'Growth_Rate or User_Count threshold met',
      });
    }

    // GZAE §GZAE-R2 extension: User_Count / Growth_Rate grey-zone trend
    // pre-warning. Additive-only — never affects article3's own trigger.
    if (record !== null && record !== undefined) {
      const userCountWarning = detectSop3UserCountPreWarning(
        ARTICLE3_STATION_ID,
        record.user_count,
        recentCrowdHistoryBefore(bl17Records, eventDate, (r) => r.user_count),
      );
      if (userCountWarning !== null) crowdPreWarnings.push(userCountWarning);

      const growthRateWarning = detectSop3GrowthRatePreWarning(
        ARTICLE3_STATION_ID,
        record.growth_rate,
        recentCrowdHistoryBefore(bl17Records, eventDate, (r) => r.growth_rate),
      );
      if (growthRateWarning !== null) crowdPreWarnings.push(growthRateWarning);
    }
  }

  // ─── SOP-4 (dome dispersal, links SOP-3) as applicable ──
  const domeRecords = crowdByStation.get(ARTICLE4_STATION_ID);
  if (domeRecords !== undefined && domeRecords.length > 0) {
    const selected = bundle.timeAlignment.select(ARTICLE4_STATION_ID, eventDate, domeRecords);
    const current = selected.record;
    const article4 = evaluateArticle4({
      bs_id: ARTICLE4_STATION_ID,
      current_observed_at: current?.timestamp_normalized ?? eventDate,
      historical_observations: domeRecords.map((record) => ({
        observed_at: record.timestamp_normalized,
        user_count: record.user_count,
      })),
      current_growth_rate: current?.growth_rate ?? null,
    });
    if (article4.triggered) {
      evaluations.push({
        article: 4,
        triggered: true,
        invoked_procedures: article4.invoked_procedures,
      });
      crowdTriggeredStationIds.add(ARTICLE4_STATION_ID);
      triggerGrounding.push({
        article: 4,
        entity_id: ARTICLE4_STATION_ID,
        reason: `Historical_peak ${article4.historical_peak} >= ${DOME_PEAK_THRESHOLD} AND Growth_Rate ${current?.growth_rate ?? 'null'} <= ${DOME_GROWTH_THRESHOLD}`,
      });
    }

    // GZAE §GZAE-R2 extension: Growth_Rate grey-zone trend pre-warning,
    // gated on the historical-peak precondition already being met.
    if (current !== null && current !== undefined) {
      const growthRateWarning = detectSop4GrowthRatePreWarning(
        ARTICLE4_STATION_ID,
        article4.historical_peak !== null && article4.historical_peak >= DOME_PEAK_THRESHOLD,
        current.growth_rate,
        recentCrowdHistoryBefore(domeRecords, eventDate, (r) => r.growth_rate),
      );
      if (growthRateWarning !== null) crowdPreWarnings.push(growthRateWarning);
    }
  }

  // ─── SOP-6 multilingual trigger (Strategy F) — always where in scope ──
  const currentStations: CurrentStationSnapshot[] = [];
  for (const [bsId, records] of crowdByStation) {
    const selected = bundle.timeAlignment.select(bsId, eventDate, records);
    currentStations.push({
      bs_id: bsId,
      roaming_pct_value: selected.record?.roaming_pct_value ?? null,
    });

    // GZAE §GZAE-R2 extension: Roaming_User_Pct grey-zone trend pre-warning,
    // per in-scope station (mirrors this loop's existing per-station scope).
    const roamingRecord = selected.record;
    if (roamingRecord !== null && roamingRecord !== undefined) {
      const roamingWarning = detectSop6RoamingPreWarning(
        bsId,
        roamingRecord.roaming_pct_value,
        recentCrowdHistoryBefore(records, eventDate, (r) => r.roaming_pct_value),
      );
      if (roamingWarning !== null) crowdPreWarnings.push(roamingWarning);
    }
  }
  const multilingualScopeResult = bundle.multilingualScope.stationsInScope(currentStations, {
    mode: bundle.metadata.multilingual_scope.mode,
  });
  const article6 = evaluateArticle6(multilingualScopeResult);
  if (article6.triggered) {
    evaluations.push({ article: 6, triggered: true });
    for (const stationId of article6.triggering_station_ids) {
      crowdTriggeredStationIds.add(stationId);
    }
    triggerGrounding.push({
      article: 6,
      entity_id: article6.triggering_station_ids.join(', '),
      reason: `Roaming_User_Pct >= 30% at station(s): ${article6.triggering_station_ids.join(', ')}`,
    });
  }

  // GZAE §GZAE-R3: cross-article traffic (art.1) vs crowd (art.3/4/6) signal
  // contradiction, keyed by the existing `nearby_stations` field. Additive-only.
  const signalConflicts: readonly SignalConflict[] =
    roadNetwork !== undefined
      ? detectSignalConflicts(
          classifications,
          (segmentId) => roadNetwork.nearbyStations(segmentId),
          crowdTriggeredStationIds,
        )
      : [];

  // GZAE §GZAE-R4: adjacent, individually-non-escalating incidents. Additive-only.
  const cascadingRisk: CascadingRisk | null =
    roadNetwork !== undefined
      ? detectCascadingRisk(
          [incident, ...otherActiveIncidents],
          buildAdjacencyGraph(roadNetwork.getAllSegments()),
        )
      : null;

  // ─── Aggregate the three distinct article sets (art.7 stays a formula) ──
  const appliedFormulaArticles = ete !== null ? [...ete.applied_formula_articles] : [];
  const articles = aggregateArticles({
    evaluations,
    applied_formula_articles: appliedFormulaArticles,
  });

  // ─── UARE: SOP-match judgment + grounding candidates when no article triggered ──
  // (spec: .kiro/specs/unified-adaptive-reasoning-engine/, design.md §3, §5.2, §5.3)
  const sopMatch = resolveSopMatch(articles.triggered_articles);
  let universalPrinciples: readonly UniversalPrinciple[] = [];
  let groundingCandidates: readonly GroundingCandidate[] = [];
  if (!sopMatch.sop_matched) {
    universalPrinciples = UNIVERSAL_DEFENSE_PRINCIPLES;
    const anchorSegmentId = resolveGroundingAnchor(incident, roadNetwork);
    if (anchorSegmentId !== null && roadNetwork !== undefined) {
      groundingCandidates = selectGroundingCandidates(
        anchorSegmentId,
        roadNetwork,
        selectSaturation,
      ).candidates;
    }
    // anchorSegmentId === null (neither affected_segment nor affected_road is in
    // Road_Whitelist) → groundingCandidates stays [] per design.md §5.3; this is
    // NOT insufficient_data (R6 AC3) — the caller (backend prompt layer) is
    // expected to fall back to a route-free universal advisory.
  }

  // ─── Evidence trace (deterministic facts only) ──
  const classificationReasoning: ClassificationReasoning[] = classifications
    .filter((classification) => saturationBySegment.has(classification.segment_id))
    .map((classification) => ({
      segment_id: classification.segment_id,
      value: saturationBySegment.get(classification.segment_id) ?? 0,
      threshold: 'A>=0.95, B>=0.85',
      conclusion:
        classification.level === 'A' ? 'A 級' : classification.level === 'B' ? 'B 級' : '正常',
    }));

  const sopCitations: SopCitation[] = [];
  const sopArticles = ingestion.sopArticles;
  if (sopArticles !== undefined) {
    for (const articleNo of articles.citation_article_set) {
      const chunk = sopArticles.getByArticleNo(articleNo);
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
    classification_reasoning: classificationReasoning,
    excluded_candidates: excludedCandidates,
    citation_article_set: articles.citation_article_set,
    sop_citations: sopCitations,
    data_points: [],
  });

  const facts: DeterministicDecisionFacts = {
    source_manifest_hash: ingestion.source_manifest_hash,
    triggered_articles: articles.triggered_articles,
    applied_formula_articles: articles.applied_formula_articles,
    invoked_procedures: articles.invoked_procedures,
    citation_article_set: articles.citation_article_set,
    art1_measures: art1Measures,
    classifications,
    incident_anchor: incidentAnchor,
    primary_evacuation: primaryEvacuation,
    secondary_evacuation: secondaryEvacuation,
    excluded_candidates: excludedCandidates,
    affected_road: affectedRoad,
    affected_intersection_scope: affectedIntersectionScope,
    ete,
    multilingual_required: article6.multilingual_required,
    multilingual_scope: article6.multilingual_scope,
    evidence,
    cms_core_text: cmsCoreText,
    policy: bundle.metadata,
    sop_matched: sopMatch.sop_matched,
    sop_authority: sopMatch.sop_authority,
    universal_principles: universalPrinciples,
    grounding_candidates: groundingCandidates,
    pre_warning_segments: preWarningSegments,
    crowd_pre_warnings: crowdPreWarnings,
    signal_conflicts: signalConflicts,
    cascading_risk: cascadingRisk,
    self_blocked_exclusions: selfBlockedExclusions,
    trigger_grounding: triggerGrounding,
    provisional: true,
  };

  return {
    data_status: 'ready',
    stop_reason: null,
    source_manifest_hash: ingestion.source_manifest_hash,
    facts,
  };
}

// ─── Internal helpers ──────────────────────────────────────

function resolveIncident(input: DeterministicDecisionInput): Incident {
  if (input.incident !== undefined) return input.incident;
  if (input.event_id !== undefined) {
    const found = (input.ingestion.incidents ?? []).find(
      (candidate) => candidate.event_id === input.event_id,
    );
    if (found === undefined) {
      throw new Error(`Incident with event_id "${input.event_id}" not found in ingestion result.`);
    }
    return found;
  }
  throw new Error('runDeterministicDecision requires either `incident` or `event_id`.');
}

/**
 * UARE anchor precedence (design.md §5.1): prefer `affected_segment` when it is
 * in the Road_Whitelist, else `affected_road`, else `null` (no legal anchor —
 * caller must not call `selectGroundingCandidates`, design.md §5.3).
 */
function resolveGroundingAnchor(
  incident: Incident,
  roadNetwork: RoadNetworkModel | undefined,
): string | null {
  if (roadNetwork === undefined) return null;
  if (roadNetwork.getSegment(incident.affected_segment) !== undefined) {
    return incident.affected_segment;
  }
  if (
    incident.affected_road !== undefined &&
    roadNetwork.getSegment(incident.affected_road) !== undefined
  ) {
    return incident.affected_road;
  }
  return null;
}

function groupTraffic(ingestion: IngestionResult): ReadonlyMap<string, TrafficSelectRecord[]> {
  const byStation = new Map<string, TrafficSelectRecord[]>();
  const traffic = ingestion.traffic ?? [];
  const timestamps = ingestion.trafficTimestamps ?? [];
  traffic.forEach((record, index) => {
    const normalized = timestamps[index];
    if (normalized === undefined) return;
    const list = byStation.get(record.Segment_ID) ?? [];
    list.push({
      timestamp_normalized: normalized.timestamp_normalized,
      saturation_score: record.Saturation_Score,
    });
    byStation.set(record.Segment_ID, list);
  });
  return byStation;
}

/**
 * GZAE §GZAE-R2: the most recent 3 raw saturation observations at or before
 * `cutoff`, time-ascending. Reuses `groupTraffic`'s already-in-memory,
 * per-segment array (design.md §4) — no new data-read path. Returns fewer
 * than 3 points (including zero) when history is insufficient; never
 * interpolates or defaults a missing point.
 */
function recentSaturationHistoryBefore(
  records: readonly TrafficSelectRecord[],
  cutoff: Date,
): readonly SaturationHistoryPoint[] {
  return records
    .filter((record) => record.timestamp_normalized.getTime() <= cutoff.getTime())
    .sort((a, b) => a.timestamp_normalized.getTime() - b.timestamp_normalized.getTime())
    .slice(-3)
    .map((record) => ({ saturation_score: record.saturation_score }));
}

/**
 * GZAE §GZAE-R2 extension: the most recent 3 raw crowd observations at or
 * before `cutoff`, time-ascending, projected through `valueOf` to the field
 * being trended (User_Count / Growth_Rate / Roaming_User_Pct). Mirrors
 * `recentSaturationHistoryBefore` — reuses `groupCrowd`'s already-in-memory,
 * per-station array; never interpolates or defaults a missing point.
 */
function recentCrowdHistoryBefore(
  records: readonly CrowdSelectRecord[],
  cutoff: Date,
  valueOf: (record: CrowdSelectRecord) => number,
): readonly NumericHistoryPoint[] {
  return records
    .filter((record) => record.timestamp_normalized.getTime() <= cutoff.getTime())
    .sort((a, b) => a.timestamp_normalized.getTime() - b.timestamp_normalized.getTime())
    .slice(-3)
    .map((record) => ({ value: valueOf(record) }));
}

function groupCrowd(ingestion: IngestionResult): ReadonlyMap<string, CrowdSelectRecord[]> {
  const byStation = new Map<string, CrowdSelectRecord[]>();
  const crowd = ingestion.crowd ?? [];
  const timestamps = ingestion.crowdTimestamps ?? [];
  crowd.forEach((record, index) => {
    const normalized = timestamps[index];
    if (normalized === undefined) return;
    const list = byStation.get(record.BS_ID) ?? [];
    list.push({
      timestamp_normalized: normalized.timestamp_normalized,
      user_count: record.User_Count,
      growth_rate: record.Growth_Rate,
      roaming_pct_value: record.roaming_pct_value,
    });
    byStation.set(record.BS_ID, list);
  });
  return byStation;
}

function buildEteTrafficReadings(
  ingestion: IngestionResult,
  affectedSet: readonly string[],
): readonly EteTrafficReading[] {
  const affected = new Set(affectedSet);
  return (ingestion.traffic ?? [])
    .filter((record) => affected.has(record.Segment_ID))
    .map((record) => ({
      road_id: record.Segment_ID,
      observation_timestamp: record.timestamp_raw,
      saturation_score: record.Saturation_Score,
    }));
}
