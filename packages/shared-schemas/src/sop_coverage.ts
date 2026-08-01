/**
 * Sop_Coverage_Resolver types — official SOP article matching vs. the
 * system-default universal containment principles
 * (spec: boundary-snapping-containment, R6).
 *
 * @module shared-schemas/sop_coverage
 */

export type SopCoverageStatus = 'OFFICIAL_SOP_MATCHED' | 'UNKNOWN_TYPE_UNIVERSAL_SOP';

export type SopAuthority = 'OFFICIAL_SOP' | 'SYSTEM_DEFAULT_PRINCIPLE';

export type UniversalPrincipleId =
  'UPSTREAM_REDUCTION' | 'PERIMETER_DISPERSAL' | 'PERIMETER_CONTROL';

export interface UniversalPrinciple {
  readonly principle_id: UniversalPrincipleId;
  readonly description: string;
}

export interface SopCoverageResult {
  readonly sop_coverage_status: SopCoverageStatus;
  readonly sop_authority: SopAuthority;
  /** Non-empty only when sop_coverage_status === 'OFFICIAL_SOP_MATCHED'. */
  readonly matched_article_nos: readonly number[];
  /** Non-empty only when sop_coverage_status === 'UNKNOWN_TYPE_UNIVERSAL_SOP'. */
  readonly universal_principles: readonly UniversalPrinciple[];
}
