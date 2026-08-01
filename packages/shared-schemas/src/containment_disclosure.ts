/**
 * Containment_Assembler API disclosure types (spec: boundary-snapping-containment,
 * R10) and this feature's LLM-prohibited field registry (R13).
 *
 * Deliberately a type SEPARATE from DecisionCore (design.md §7): this data's
 * provenance is Boundary_Snapper / Sop_Coverage_Resolver, not
 * runDeterministicDecision + backend identity fields, and
 * core_hash/immutable_after_commit semantics do not apply to it.
 * packages/rag/src/schema_validator.ts enforces CONTAINMENT_PROHIBITED_PATHS
 * as a second explicit check alongside the existing LLM_PROHIBITED_FIELDS
 * check for DecisionCore (see llm_boundary.ts).
 *
 * @module shared-schemas/containment_disclosure
 */

import type { DataScopeStatus, PerimeterAnchor } from './boundary_snapping.js';
import type { SopAuthority, SopCoverageStatus } from './sop_coverage.js';

export interface MappedAnchorNode extends PerimeterAnchor {
  readonly distance_meters: number | null;
}

export interface PerimeterControl {
  readonly action: string;
  readonly target_gate: string;
  readonly reason: string;
}

export interface WhitelistViolation {
  readonly road_id: string;
  readonly occurrences: number;
}

export interface ContainmentDecision {
  readonly reroute_roads: readonly string[];
  /** null when data_scope_status is not OUT_OF_BOUNDS_SNAPPED (R10 AC4). */
  readonly perimeter_control: PerimeterControl | null;
  readonly ai_reasoning: string | null;
}

/**
 * Containment_Assembler's API-facing disclosure fields (R10). Present
 * alongside — not merged into — DecisionCore.
 */
export interface ContainmentDisclosure {
  /** null only when data_status !== 'ready' (R12 AC2). */
  readonly data_scope_status: DataScopeStatus | null;
  /** null unless data_scope_status === 'OUT_OF_BOUNDS_SNAPPED' (R10 AC9). */
  readonly mapped_anchor_node: MappedAnchorNode | null;
  readonly sop_coverage_status: SopCoverageStatus | null;
  readonly sop_authority: SopAuthority | null;
  readonly decision: ContainmentDecision;
  readonly whitelist_violations: readonly WhitelistViolation[];
}

/**
 * LLM-prohibited top-level keys on ContainmentDisclosure (R13 AC1).
 * Typed against `keyof ContainmentDisclosure` so a field rename fails the
 * build here first — mirrors the pattern in llm_boundary.ts.
 */
const CONTAINMENT_PROHIBITED_KEY_LIST: readonly (keyof ContainmentDisclosure)[] = [
  'data_scope_status',
  'mapped_anchor_node',
  'sop_coverage_status',
  'sop_authority',
];

export const CONTAINMENT_PROHIBITED_KEYS: ReadonlySet<string> = new Set(
  CONTAINMENT_PROHIBITED_KEY_LIST,
);

/**
 * Dotted-path form of CONTAINMENT_PROHIBITED_KEYS plus the nested `decision.*`
 * fields that are LLM-prohibited but are not top-level keys (R13 AC1, R10 AC8).
 */
export const CONTAINMENT_PROHIBITED_PATHS: ReadonlySet<string> = new Set<string>([
  ...CONTAINMENT_PROHIBITED_KEY_LIST,
  'decision.reroute_roads',
  'decision.perimeter_control',
]);
