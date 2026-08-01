/**
 * Sop_Coverage_Resolver types — official SOP article matching vs. the
 * system-default universal containment principles
 * (spec: boundary-snapping-containment, R6).
 *
 * DEFAULT_UNIVERSAL_SOP is NOT an amendment to emergency_traffic_sop.txt and
 * is never a runtime official source; sop_authority distinguishes the two
 * (R6 AC6/AC7).
 *
 * @module shared-schemas/sop_coverage
 */

export type SopCoverageStatus = 'OFFICIAL_SOP_MATCHED' | 'UNKNOWN_TYPE_UNIVERSAL_SOP';

export type SopAuthority = 'OFFICIAL_SOP' | 'SYSTEM_DEFAULT_PRINCIPLE';

export type UniversalPrincipleId =
  | 'UPSTREAM_REDUCTION'
  | 'PERIMETER_DISPERSAL'
  | 'PERIMETER_CONTROL';

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

/**
 * DEFAULT_UNIVERSAL_SOP — decision-time containment principles used when an
 * incident `type` has no official SOP article match (R6 AC3/AC4). Exactly
 * these 3 principles; text is decision-time deterministic content, never
 * Bedrock-generated.
 */
export const DEFAULT_UNIVERSAL_SOP: readonly UniversalPrinciple[] = [
  {
    principle_id: 'UPSTREAM_REDUCTION',
    description: '上游減量：於周界錨點上游疏導車流，降低進入未劃設區域之流量',
  },
  {
    principle_id: 'PERIMETER_DISPERSAL',
    description: '周邊擴散：透過 alternatives 分流至周界錨點鄰近之替代路段',
  },
  {
    principle_id: 'PERIMETER_CONTROL',
    description: '周界管制：於周界錨點設立管制點，阻止車流繼續駛向未劃設區域',
  },
] as const;
