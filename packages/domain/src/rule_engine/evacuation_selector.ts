/**
 * EvacuationSelector — Select primary/secondary evacuation from qualified candidates
 *
 * Logic (§9.4 art.2, §11.7, R6):
 * 1. Filter candidates where role === 'primary' — these passed all 3 qualifications
 * 2. If no primary candidates → primary_evacuation=null, no_candidate_note="查無合規替代路段"
 * 3. If primaries exist → select the one with lowest saturation_at_snapshot
 *    (stable: first one wins on tie)
 * 4. If selected primary has saturation_at_snapshot >= 0.85:
 *    maintain it, set long_green_timing_for_primary=true,
 *    public_transit_recommended=true,
 *    congestion_note="主疏散路段已壅塞，建議併行大眾運輸"
 * 5. Secondary evacuation = candidates with role === 'secondary' → list their segment_ids
 * 6. Excluded = candidates with role === 'excluded'
 *
 * IMPORTANT:
 * - Saturation is NOT a qualification filter (not a 4th condition)
 * - No roads are fabricated — only roads from the incident's alternatives can appear
 * - OQ-008 disclosure stays configurable
 *
 * @module domain/rule_engine/evacuation_selector
 */

import type { RouteCandidate } from '@city-commander/shared-schemas';
import { RouteCandidateRole } from '@city-commander/shared-schemas';

// ─── Constants ─────────────────────────────────────────────

/** Congestion threshold for the primary evacuation route */
const CONGESTION_THRESHOLD = 0.85;

/** Note recorded when no candidate qualifies */
const NO_CANDIDATE_NOTE = '查無合規替代路段';

/** Note recorded when primary is congested */
const CONGESTION_NOTE = '主疏散路段已壅塞，建議併行大眾運輸';

// ─── Result Interface ──────────────────────────────────────

/**
 * Result of the evacuation selection process.
 */
export interface EvacuationResult {
  /** The selected primary evacuation route segment_id, or null if none qualifies */
  readonly primary_evacuation: string | null;
  /** Downstream direct intersection segments for secondary evacuation */
  readonly secondary_evacuation: readonly string[];
  /** All excluded candidates with their reasons */
  readonly excluded_candidates: readonly RouteCandidate[];
  /** Whether primary route is congested (saturation >= 0.85) */
  readonly primary_congested: boolean;
  /** Long-green timing activated for congested primary */
  readonly long_green_timing_for_primary: boolean;
  /** Public transit recommendation for congested primary */
  readonly public_transit_recommended: boolean;
  /** Note about congestion if primary is congested */
  readonly congestion_note: string | null;
  /** "查無合規替代路段" when no candidate qualifies */
  readonly no_candidate_note: string | null;
}

// ─── Selection ─────────────────────────────────────────────

/**
 * Select the primary and secondary evacuation routes from qualified candidates.
 *
 * Among candidates with role=primary (passed all 3 qualifications),
 * pick the one with the lowest saturation_at_snapshot as THE primary.
 * If multiple have the same saturation, pick the first one (stable sort).
 *
 * Downstream candidates (role=secondary) are listed as secondary evacuation.
 * Excluded candidates are collected with their reasons.
 *
 * If no candidate has role=primary, record "查無合規替代路段" and
 * include no non-alternative roads (never fabricate).
 *
 * If the selected primary has saturation >= 0.85:
 * - Maintain the route (do NOT discard it)
 * - Activate long-green timing
 * - Recommend public transit
 * - Record congestion note
 *
 * @param candidates - The RouteCandidate[] produced by qualifyCandidates (article2.ts)
 * @returns EvacuationResult with primary/secondary/excluded and congestion handling
 */
export function selectEvacuation(candidates: readonly RouteCandidate[]): EvacuationResult {
  // Partition candidates by role
  const primaryCandidates: RouteCandidate[] = [];
  const secondaryCandidates: RouteCandidate[] = [];
  const excludedCandidates: RouteCandidate[] = [];

  for (const candidate of candidates) {
    switch (candidate.role) {
      case RouteCandidateRole.primary:
        primaryCandidates.push(candidate);
        break;
      case RouteCandidateRole.secondary:
        secondaryCandidates.push(candidate);
        break;
      case RouteCandidateRole.excluded:
        excludedCandidates.push(candidate);
        break;
      // unranked_direct_intersection: not selected as primary or secondary
      // They don't appear in primary/secondary lists
      default:
        break;
    }
  }

  // Case: No candidate qualifies
  if (primaryCandidates.length === 0) {
    return {
      primary_evacuation: null,
      secondary_evacuation: secondaryCandidates.map((c) => c.segment_id),
      excluded_candidates: excludedCandidates,
      primary_congested: false,
      long_green_timing_for_primary: false,
      public_transit_recommended: false,
      congestion_note: null,
      no_candidate_note: NO_CANDIDATE_NOTE,
    };
  }

  // Select the primary with lowest saturation_at_snapshot
  // Stable: first one wins on equal saturation (preserve input order)
  let selectedPrimary = primaryCandidates[0];
  for (let i = 1; i < primaryCandidates.length; i++) {
    if (primaryCandidates[i].saturation_at_snapshot < selectedPrimary.saturation_at_snapshot) {
      selectedPrimary = primaryCandidates[i];
    }
  }

  // Check if primary is congested (saturation >= 0.85)
  const primaryCongested = selectedPrimary.saturation_at_snapshot >= CONGESTION_THRESHOLD;

  return {
    primary_evacuation: selectedPrimary.segment_id,
    secondary_evacuation: secondaryCandidates.map((c) => c.segment_id),
    excluded_candidates: excludedCandidates,
    primary_congested: primaryCongested,
    long_green_timing_for_primary: primaryCongested,
    public_transit_recommended: primaryCongested,
    congestion_note: primaryCongested ? CONGESTION_NOTE : null,
    no_candidate_note: null,
  };
}
