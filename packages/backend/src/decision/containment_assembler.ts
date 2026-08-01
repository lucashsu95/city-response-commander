/**
 * Containment_Assembler — the entry point for the Boundary Snapping &
 * Containment Protocol (spec: boundary-snapping-containment, R1, R12).
 *
 * This is a Layer 2 orchestrator: it calls Layer 1 deterministic domain
 * functions (`checkEntityScope`, `resolveSopCoverage`, and — from
 * TASK-BS-11/12 onward — `snap` / `runDeterministicDecision`) but contains
 * no rule semantics of its own, mirroring `DefaultDomainPipelineAdapter`'s
 * existing split of responsibility.
 *
 * ## Scope of this revision (TASK-BS-10)
 *
 * Only the sequence up to and including Entity_Scope_Check + SOP coverage
 * resolution is wired here (design.md §3.1, steps 1-2). The branch to
 * `runDeterministicDecision` for `IN_SCOPE`/`IN_SCOPE_BY_INTERSECTION`
 * (TASK-BS-11), the `snap()` branch for `OUT_OF_BOUNDS` (TASK-BS-12),
 * Safe_Context construction (TASK-BS-13), and the Bedrock/Whitelist_Guard
 * call (TASK-BS-14) are NOT yet wired — {@link ContainmentAssemblerResult}
 * is intentionally narrower than design.md §6's full `ContainmentResult`
 * until those land.
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

import { checkEntityScope, resolveSopCoverage } from '@city-commander/domain';
import type { IngestionDataStatus, IngestionResult } from '@city-commander/domain';
import type { EntityScopeResult, Incident, SopCoverageResult } from '@city-commander/shared-schemas';

export interface AssembleContainmentInput {
  readonly ingestion: IngestionResult;
  readonly incident: Incident;
}

/**
 * Result of the Entity_Scope_Check + SOP coverage stage only (TASK-BS-10
 * scope). Superseded by the full `ContainmentResult` shape (design.md §6)
 * once TASK-BS-11 through TASK-BS-14 land.
 */
export interface ContainmentAssemblerResult {
  readonly data_status: IngestionDataStatus;
  /** Verbatim from `ingestion.stop_reason`. `null` only when `data_status === 'ready'`. */
  readonly stop_reason: string | null;
  readonly source_manifest_hash: string;
  /** `null` only when `data_status !== 'ready'` (R12 AC2). */
  readonly entity_scope: EntityScopeResult | null;
  /** `null` only when `data_status !== 'ready'` (R12 AC2). */
  readonly sop_coverage: SopCoverageResult | null;
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
  };
}

/**
 * Run Entity_Scope_Check and SOP coverage resolution for an incident,
 * short-circuiting on the existing ingestion-level STOP gate first (R1 AC1,
 * R12 AC1/AC2).
 *
 * @example
 * ```ts
 * const result = assembleContainment({ ingestion: ingestedResult, incident });
 * if (result.data_status !== 'ready') return result; // unchanged insufficient_data path
 * // result.entity_scope.coverage_status is one of IN_SCOPE / IN_SCOPE_BY_INTERSECTION / OUT_OF_BOUNDS
 * ```
 */
export function assembleContainment(input: AssembleContainmentInput): ContainmentAssemblerResult {
  const { ingestion, incident } = input;

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
  // order, before any call to runDeterministicDecision or snap() (wired in
  // TASK-BS-11/TASK-BS-12).
  const entityScope = checkEntityScope(incident, ingestion.roadNetwork);
  const sopCoverage = resolveSopCoverage(incident.type, incident.description);

  return {
    data_status: 'ready',
    stop_reason: null,
    source_manifest_hash: ingestion.source_manifest_hash,
    entity_scope: entityScope,
    sop_coverage: sopCoverage,
  };
}
