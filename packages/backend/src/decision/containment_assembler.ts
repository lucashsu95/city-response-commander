/**
 * Containment_Assembler — the entry point for the Boundary Snapping &
 * Containment Protocol (spec: boundary-snapping-containment, R1, R12).
 *
 * This is a Layer 2 orchestrator: it calls Layer 1 deterministic domain
 * functions (`checkEntityScope`, `resolveSopCoverage`, `runDeterministicDecision`,
 * and — from TASK-BS-12 onward — `snap`) but contains no rule semantics of
 * its own, mirroring `DefaultDomainPipelineAdapter`'s existing split of
 * responsibility.
 *
 * ## Scope of this revision (TASK-BS-10 + TASK-BS-11)
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
 *
 * NOT yet wired: the `snap()` branch for `OUT_OF_BOUNDS` (TASK-BS-12), Safe_Context
 * construction (TASK-BS-13), and the Bedrock/Whitelist_Guard call (TASK-BS-14).
 * `mapped_anchor_node` is therefore always `null` for now, even though it will
 * be populated for `OUT_OF_BOUNDS_SNAPPED` once TASK-BS-12 lands.
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
  checkEntityScope,
  resolveSopCoverage,
  runDeterministicDecision,
} from '@city-commander/domain';
import type {
  DeterministicDecisionFacts,
  IngestionDataStatus,
  IngestionResult,
  PolicyStrategyConfigProvider,
} from '@city-commander/domain';
import type {
  DataScopeStatus,
  EntityScopeResult,
  Incident,
  MappedAnchorNode,
  SopCoverageResult,
} from '@city-commander/shared-schemas';

export interface AssembleContainmentInput {
  readonly ingestion: IngestionResult;
  readonly incident: Incident;
  readonly config: PolicyStrategyConfigProvider;
}

/**
 * Result of the Entity_Scope_Check + SOP coverage + (for `IN_SCOPE*`)
 * `runDeterministicDecision` stage (TASK-BS-10/11 scope). Superseded by the
 * full `ContainmentResult` shape (design.md §6) once TASK-BS-12 through
 * TASK-BS-14 land — `mapped_anchor_node` in particular stays `null` for
 * `OUT_OF_BOUNDS` incidents until TASK-BS-12 wires `snap()`.
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
   * `null` when `data_status !== 'ready'`, or when coverage is `OUT_OF_BOUNDS`
   * and TASK-BS-12 has not yet resolved it to `OUT_OF_BOUNDS_SNAPPED` /
   * `OUT_OF_JURISDICTION`. Otherwise mirrors `entity_scope.coverage_status`
   * (R10 AC1).
   */
  readonly data_scope_status: DataScopeStatus | null;
  /**
   * Always `null` until TASK-BS-12 wires `snap()` (R10 AC9 — also `null` for
   * `IN_SCOPE`/`IN_SCOPE_BY_INTERSECTION`, which never snap at all).
   */
  readonly mapped_anchor_node: MappedAnchorNode | null;
  /**
   * Deterministic facts from `runDeterministicDecision`, unchanged from
   * `DefaultDomainPipelineAdapter`'s existing output — populated only for
   * `IN_SCOPE`/`IN_SCOPE_BY_INTERSECTION` (R12 AC3, AC6). `null` for
   * `OUT_OF_BOUNDS` until TASK-BS-12 assembles a Coverage_Gap decision from
   * `Boundary_Snapper` output instead (R12 AC4 — the RD_ branch is skipped
   * entirely there, not just its `facts` omitted).
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
    facts: null,
  };
}

function isInScope(
  status: EntityScopeResult['coverage_status'],
): status is Extract<DataScopeStatus, 'IN_SCOPE' | 'IN_SCOPE_BY_INTERSECTION'> {
  return status === 'IN_SCOPE' || status === 'IN_SCOPE_BY_INTERSECTION';
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
    // OUT_OF_BOUNDS — snap() branch not wired until TASK-BS-12. Deliberately
    // does NOT call runDeterministicDecision here (R12 AC4): that RD_ branch
    // would only produce degraded nulls for a segment outside Road_Whitelist,
    // and its `incident_anchor.manual_confirmation_required` output must never
    // coexist with a `mapped_anchor_node` for the same incident (R12 AC6).
    return {
      data_status: 'ready',
      stop_reason: null,
      source_manifest_hash: ingestion.source_manifest_hash,
      entity_scope: entityScope,
      sop_coverage: sopCoverage,
      data_scope_status: null,
      mapped_anchor_node: null,
      facts: null,
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
    facts: decision.facts,
  };
}
