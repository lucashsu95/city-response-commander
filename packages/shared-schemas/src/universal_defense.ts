/**
 * Unified Adaptive Reasoning Engine (UARE) — shared types (§UARE-R1, R2, R3, R5).
 *
 * Covers the "SOP type coverage gap" case: an injected incident's `type` /
 * `status` / `severity` combination triggers none of `article1`–`article6`.
 * These types let deterministic code (`packages/domain`) hand off an
 * explicit, whitelisted, real-data-grounded fallback to the LLM composer
 * instead of leaving it with "觸發 SOP 條款: 無" and no legitimate basis to
 * cite.
 *
 * @module shared-schemas/universal_defense
 */

/** The three fixed, non-official defense principles UARE falls back to. */
export type UniversalPrincipleId =
  | 'UPSTREAM_CONTAINMENT'
  | 'PERIMETER_GUIDANCE'
  | 'PUBLIC_NOTIFICATION';

/** A single universal defense principle. Text is decision-core-sourced, never LLM-generated. */
export interface UniversalPrinciple {
  readonly principle_id: UniversalPrincipleId;
  readonly title: string;
  readonly description: string;
}

/** A real, whitelisted road segment offered as a grounding candidate for "peripheral guidance". */
export interface GroundingCandidate {
  readonly segment_id: string;
  readonly road_name: string;
  readonly saturation_score: number;
  readonly capacity_vph: number;
  readonly status_text: '暢通' | '注意' | '壅塞';
}

/** Result of the boolean SOP-coverage judgment derived from `triggered_articles`. */
export interface SopMatchResult {
  readonly sop_matched: boolean;
  readonly sop_authority: 'OFFICIAL_SOP' | 'SYSTEM_DEFAULT_PRINCIPLE';
}
