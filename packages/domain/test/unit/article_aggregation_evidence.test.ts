import { describe, expect, it } from 'vitest';
import { RouteCandidateRole, UpstreamDownstream } from '@city-commander/shared-schemas';
import { aggregateArticles } from '../../src/rule_engine/article_aggregation.js';
import { buildEvidenceTrace } from '../../src/evidence/evidence_trace_builder.js';

describe('Article aggregation and EvidenceTraceBuilder', () => {
  it('separates triggers, applied formulas, invoked procedures, and citation union', () => {
    const result = aggregateArticles({
      evaluations: [
        { article: 1, triggered: true, invoked_procedures: ['article2_alternative_route_guidance'] },
        { article: 2, triggered: true },
        { article: 3, triggered: false },
      ],
      applied_formula_articles: [7],
    });
    expect(result).toEqual({
      triggered_articles: [1, 2],
      applied_formula_articles: [7],
      invoked_procedures: ['article2_alternative_route_guidance'],
      citation_article_set: [1, 2, 7],
    });
  });

  it('rejects Article 7 as a triggered article', () => {
    expect(() => aggregateArticles({ evaluations: [{ article: 7, triggered: true }], applied_formula_articles: [] })).toThrow('Article 7');
  });

  it('builds deterministic classification, exclusion, citation, and data-point facts', () => {
    const evidence = buildEvidenceTrace({
      decision_id: 'dec-1',
      classification_reasoning: [{ segment_id: 'RD_TPE_002', value: 1, threshold: '>= 0.95', conclusion: 'A' }],
      excluded_candidates: [{
        segment_id: 'RD_TPE_008', capacity_vph: 600, passes_capacity: false, is_direct_intersection: true,
        upstream_or_downstream: UpstreamDownstream.upstream, saturation_at_snapshot: 0.4,
        role: RouteCandidateRole.excluded, exclusion_reason: 'capacity_vph 600 < 1000',
      }],
      citation_article_set: [1, 2, 7],
      sop_citations: [1, 2, 7].map((article_no) => ({ article_no, source_location: `sop:${article_no}`, content: 'source' })),
      data_points: [{ source: 'city_traffic_flow.csv', field: 'Saturation_Score', value: 1, timestamp: '2026-05-20 22:10' }],
    });
    expect(evidence.excluded_routes).toEqual([{ segment_id: 'RD_TPE_008', reason: 'capacity_vph 600 < 1000' }]);
    expect(evidence.sop_citations.map((citation) => citation.article_no)).toEqual([1, 2, 7]);
  });

  it('rejects an excluded candidate without a reason', () => {
    expect(() => buildEvidenceTrace({
      decision_id: 'dec-1', classification_reasoning: [], citation_article_set: [], sop_citations: [], data_points: [],
      excluded_candidates: [{
        segment_id: 'RD_X', capacity_vph: 0, passes_capacity: false, is_direct_intersection: false,
        upstream_or_downstream: UpstreamDownstream.downstream, saturation_at_snapshot: 0,
        role: RouteCandidateRole.excluded,
      }],
    })).toThrow('non-empty reason');
  });
});
