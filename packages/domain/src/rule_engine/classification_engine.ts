/**
 * ClassificationEngine — A/B grading per SOP-1 (§9.4 art.1)
 *
 * Deterministic grading applied identically to all 15 segments:
 * - A 級 (癱瘓 / 紅燈): Saturation_Score >= 0.95
 * - B 級 (壅擠 / 黃燈): 0.85 <= Saturation_Score < 0.95
 * - Normal (no level):   Saturation_Score < 0.85 or missing data
 *
 * @module domain/rule_engine/classification_engine
 */

import type { SegmentClassification } from '@city-commander/shared-schemas';

/**
 * Input for classification: one entry per segment at the event snapshot.
 */
export interface SegmentSnapshot {
  readonly segment_id: string;
  readonly saturation_score: number | null;
}

/**
 * Classify all segments by their saturation score.
 *
 * - saturation_score >= 0.95 → level = 'A'
 * - 0.85 <= saturation_score < 0.95 → level = 'B'
 * - saturation_score < 0.85 → level = null
 * - saturation_score is null (missing/insufficient_data) → level = null
 *
 * The grading is boundary-exact:
 * - 0.85 is inclusive for B (0.85 → 'B')
 * - 0.95 is inclusive for A (0.95 → 'A')
 */
export function classifySegments(
  snapshots: readonly SegmentSnapshot[],
): readonly SegmentClassification[] {
  return snapshots.map((snapshot) => classifySingleSegment(snapshot));
}

/**
 * Classify a single segment by its saturation score.
 */
function classifySingleSegment(snapshot: SegmentSnapshot): SegmentClassification {
  const { segment_id, saturation_score } = snapshot;

  // Missing saturation → insufficient_data for that segment (no guess)
  if (saturation_score === null) {
    return { segment_id, level: null };
  }

  // A 級: Saturation_Score >= 0.95
  if (saturation_score >= 0.95) {
    return { segment_id, level: 'A' };
  }

  // B 級: 0.85 <= Saturation_Score < 0.95
  if (saturation_score >= 0.85) {
    return { segment_id, level: 'B' };
  }

  // Normal: Saturation_Score < 0.85
  return { segment_id, level: null };
}
