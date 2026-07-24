/**
 * RuleEngine Article 1 — SOP-1 Trigger Segments Measures & Invoked Procedures
 *
 * Deterministic encoding of SOP-1 for the trigger segments RD_TPE_001 (忠孝東路)
 * and RD_TPE_002 (光復南路).
 *
 * When these segments reach B 級:
 * - Notify traffic control center
 * - Initiate 長綠燈時制 (long green timing)
 * - Add 25% green time to that segment's alternatives
 * - Dispatch police to clear intersections
 *
 * When these segments reach A 級:
 * - All B-level measures above
 * - Additionally invoke the alternative route guidance procedure (article 2)
 *   recorded in invoked_procedures
 *
 * IMPORTANT: A-level invokes the PROCEDURE from art.2 but does NOT mean art.2's
 * trigger conditions (3-AND) are met. A-level alone does NOT add 2 to
 * triggered_articles.
 *
 * @module domain/rule_engine/article1
 */

import type { Art1Measures, SegmentClassification } from '@city-commander/shared-schemas';

/**
 * The two trigger segments for SOP-1 city response measures.
 */
export const ARTICLE1_TRIGGER_SEGMENTS = ['RD_TPE_001', 'RD_TPE_002'] as const;

/**
 * The procedure name invoked by A-level trigger segments.
 */
export const ARTICLE2_ALTERNATIVE_ROUTE_GUIDANCE = 'article2_alternative_route_guidance';

/**
 * Result of Article 1 evaluation.
 */
export interface Article1Result {
  /** Article 1 is triggered when RD_TPE_001 or RD_TPE_002 reaches B or A level */
  readonly triggered: boolean;
  /** Art.1 measures (one per triggered segment, may be multiple) */
  readonly art1_measures: readonly Art1Measures[];
  /** Procedures invoked by A-level (e.g., ['article2_alternative_route_guidance']) */
  readonly invoked_procedures: readonly string[];
  /** Art.1 adds 1 to triggered_articles when any trigger segment reaches B/A */
  readonly adds_to_triggered_articles: readonly number[];
}

/**
 * Evaluate Article 1 (SOP-1) based on segment classifications.
 *
 * For each trigger segment (RD_TPE_001, RD_TPE_002) that has reached B or A level:
 * - B level: long_green_timing + alternatives_green_plus_pct=25 + police_clear_intersections
 * - A level: all B-level measures + invokes article2_alternative_route_guidance
 *
 * Key invariant: adds_to_triggered_articles is [1] when triggered, NEVER [2].
 * Art.2 triggered_articles is determined independently by art.2's own 3-AND conditions.
 *
 * @param classifications - The A/B grading results from ClassificationEngine
 * @returns Article1Result with measures and invoked procedures
 */
export function evaluateArticle1(
  classifications: readonly SegmentClassification[],
): Article1Result {
  const art1_measures: Art1Measures[] = [];
  const invoked_procedures_set = new Set<string>();

  for (const classification of classifications) {
    // Only process trigger segments
    if (!isTriggerSegment(classification.segment_id)) {
      continue;
    }

    // Only process if level is A or B
    if (classification.level === null) {
      continue;
    }

    // Build the measures for this trigger segment
    const measures: Art1Measures = {
      level: classification.level,
      trigger_segment: classification.segment_id,
      long_green_timing: true,
      alternatives_green_plus_pct: 25,
      police_clear_intersections: true,
      a_level_invokes_article2_alternative_route_guidance: classification.level === 'A',
    };

    art1_measures.push(measures);

    // A-level additionally invokes article2_alternative_route_guidance
    if (classification.level === 'A') {
      invoked_procedures_set.add(ARTICLE2_ALTERNATIVE_ROUTE_GUIDANCE);
    }
  }

  const triggered = art1_measures.length > 0;

  return {
    triggered,
    art1_measures,
    invoked_procedures: Array.from(invoked_procedures_set),
    // Art.1 is always [1] when triggered, NEVER adds 2
    // Art.2 trigger is determined independently by its own 3-AND conditions
    adds_to_triggered_articles: triggered ? [1] : [],
  };
}

/**
 * Check if a segment_id is one of the Article 1 trigger segments.
 */
function isTriggerSegment(segmentId: string): boolean {
  return (ARTICLE1_TRIGGER_SEGMENTS as readonly string[]).includes(segmentId);
}
