/** Deterministic EvidenceTrace builder (§10.10). */

import type {
  ClassificationReasoning,
  DataPoint,
  EvidenceTrace,
  RouteCandidate,
  SopCitation,
} from '@city-commander/shared-schemas';

export interface EvidenceTraceInput {
  readonly decision_id: string;
  readonly classification_reasoning: readonly ClassificationReasoning[];
  readonly excluded_candidates: readonly RouteCandidate[];
  readonly citation_article_set: readonly number[];
  readonly sop_citations: readonly SopCitation[];
  readonly data_points: readonly DataPoint[];
}

/** Builds only deterministic facts and rejects excluded routes without a reason. */
export function buildEvidenceTrace(input: EvidenceTraceInput): EvidenceTrace {
  const excluded_routes = input.excluded_candidates.map((candidate) => {
    if (candidate.role !== 'excluded') {
      throw new Error(`Candidate ${candidate.segment_id} is not excluded.`);
    }
    if (candidate.exclusion_reason === undefined || candidate.exclusion_reason.trim() === '') {
      throw new Error(`Excluded candidate ${candidate.segment_id} requires a non-empty reason.`);
    }
    return { segment_id: candidate.segment_id, reason: candidate.exclusion_reason };
  });

  const citedArticles = new Set(input.citation_article_set);
  for (const citation of input.sop_citations) {
    if (!citedArticles.has(citation.article_no)) {
      throw new Error(`Citation article ${citation.article_no} is outside citation_article_set.`);
    }
  }
  for (const article of citedArticles) {
    if (!input.sop_citations.some((citation) => citation.article_no === article)) {
      throw new Error(`citation_article_set article ${article} has no SOP citation.`);
    }
  }

  return {
    decision_id: input.decision_id,
    classification_reasoning: input.classification_reasoning,
    excluded_routes,
    sop_citations: input.sop_citations,
    data_points: input.data_points,
  };
}
