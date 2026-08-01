/**
 * EvidenceTrace boundary decoder + citation coverage tests (TASK-129).
 *
 * Pins the fail-closed rules, the optional §10.10 HG-001 blocks, the blank
 * exclusion reason surfaced as a contract breach, and the citation set defined
 * by §14.2 as `triggered ∪ applied_formula`.
 */

import { describe, expect, it } from 'vitest';
import { citationCoverage, decodeEvidenceTrace } from '../../src/decision/evidence_model.js';
import type { SopCitationView } from '../../src/decision/evidence_model.js';
import { evidenceViewOf } from '../../src/decision/use_evidence_view.js';
import { coreView, wireEvidence } from './fixtures.js';

function decode(raw: unknown) {
  return decodeEvidenceTrace(raw);
}

function expectError(raw: unknown, code: string): void {
  const result = decode(raw);
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error.code).toBe(code);
}

function citation(articleNo: number): SopCitationView {
  return {
    articleNo,
    sourceLocation: `s3://sop#article-${articleNo}`,
    content: `第 ${articleNo} 條`,
    score: 0.9,
  };
}

describe('decodeEvidenceTrace — live contract', () => {
  it('decodes the five fields the live backend emits', () => {
    const result = decode(wireEvidence());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const evidence = result.evidence;
    expect(evidence.decisionId).toBe('dec-acc001');
    expect(evidence.classificationReasoning).toEqual([
      { segmentId: 'RD_TPE_002', value: 1.0, threshold: '>= 0.95', conclusion: 'A' },
      {
        segmentId: 'RD_TPE_004',
        value: 0.78,
        threshold: '0.85 <= score < 0.95',
        conclusion: 'normal',
      },
    ]);
    expect(evidence.excludedRoutes).toEqual([
      { segmentId: 'RD_TPE_008', reason: 'capacity_vph 600 < 1000' },
      { segmentId: 'RD_TPE_006', reason: '不在 RD_TPE_002 的 intersections（非直接相交）' },
    ]);
    expect(evidence.sopCitations.map((entry) => entry.articleNo)).toEqual([1, 2, 7]);
    expect(evidence.dataPoints[0]?.value).toBe(1.0);
    expect(evidence.dataPoints[1]?.value).toBe('Critical');
  });

  it('reports the four §10.10 HG-001 blocks as null when the backend omits them', () => {
    const result = decode(wireEvidence());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.evidence.observationSelection).toBeNull();
    expect(result.evidence.affectedSetConstruction).toBeNull();
    expect(result.evidence.formulaSubstitution).toBeNull();
    expect(result.evidence.policyProvenance).toBeNull();
  });

  it('never re-thresholds a value: the conclusion is carried through verbatim', () => {
    // 0.97 would be A level under SOP-1; the backend concluded B.
    const result = decode(
      wireEvidence({
        classification_reasoning: [
          { segment_id: 'RD_TPE_002', value: 0.97, threshold: '>= 0.95', conclusion: 'B' },
        ],
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.evidence.classificationReasoning[0]?.conclusion).toBe('B');
    expect(result.evidence.classificationReasoning[0]?.value).toBe(0.97);
  });

  it('surfaces a blank exclusion reason as null rather than dropping the route', () => {
    const result = decode(
      wireEvidence({ excluded_routes: [{ segment_id: 'RD_TPE_008', reason: '   ' }] }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.evidence.excludedRoutes).toEqual([{ segmentId: 'RD_TPE_008', reason: null }]);
  });

  it.each([
    ['a non-object block', null, 'NOT_AN_OBJECT'],
    ['a string block', 'evidence', 'NOT_AN_OBJECT'],
    [
      'string reasoning value',
      wireEvidence({
        classification_reasoning: [{ segment_id: 'RD_TPE_002', value: '1.0' }],
      }),
      'INVALID_CLASSIFICATION_REASONING',
    ],
    [
      'reasoning without segment_id',
      wireEvidence({ classification_reasoning: [{ value: 1.0 }] }),
      'INVALID_CLASSIFICATION_REASONING',
    ],
    [
      'non-array excluded_routes',
      wireEvidence({ excluded_routes: 'RD_TPE_008' }),
      'INVALID_EXCLUDED_ROUTES',
    ],
    [
      'citation without article_no',
      wireEvidence({ sop_citations: [{ content: '第 1 條' }] }),
      'INVALID_SOP_CITATIONS',
    ],
    [
      'object-valued data point',
      wireEvidence({
        data_points: [{ source: 's', field: 'f', value: { nested: 1 }, timestamp: 't' }],
      }),
      'INVALID_DATA_POINTS',
    ],
    [
      'non-array observation_selection',
      wireEvidence({ observation_selection: 'RD_TPE_002' }),
      'INVALID_OBSERVATION_SELECTION',
    ],
    [
      'string staleness',
      wireEvidence({ observation_selection: [{ entity_id: 'RD_TPE_002', staleness: '10' }] }),
      'INVALID_OBSERVATION_SELECTION',
    ],
    [
      'affected_set_construction without segment_id',
      wireEvidence({ affected_set_construction: [{ role: 'INCIDENT' }] }),
      'INVALID_AFFECTED_SET_CONSTRUCTION',
    ],
    [
      'string formula sum',
      wireEvidence({ formula_substitution: { sum: '2.43' } }),
      'INVALID_FORMULA_SUBSTITUTION',
    ],
    [
      'non-object policy_provenance',
      wireEvidence({ policy_provenance: 'HG-001' }),
      'INVALID_POLICY_PROVENANCE',
    ],
  ])('fails closed on %s', (_label, raw, code) => {
    expectError(raw, code as string);
  });
});

describe('decodeEvidenceTrace — §10.10 HG-001 blocks when supplied', () => {
  it('decodes observation selection verbatim', () => {
    const result = decode(
      wireEvidence({
        observation_selection: [
          {
            entity_id: 'RD_TPE_002',
            cutoff: '2026-05-20 22:10',
            observation_timestamp: '2026-05-20 22:00',
            staleness: 10,
            exact_match: false,
            mode: 'GLOBAL_AS_OF_EVENT_CUTOFF_LATEST_PRIOR_PER_ENTITY',
          },
        ],
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.evidence.observationSelection).toEqual([
      {
        entityId: 'RD_TPE_002',
        cutoff: '2026-05-20 22:10',
        observationTimestamp: '2026-05-20 22:00',
        staleness: 10,
        exactMatch: false,
        mode: 'GLOBAL_AS_OF_EVENT_CUTOFF_LATEST_PRIOR_PER_ENTITY',
      },
    ]);
  });

  it('decodes affected-set roles verbatim', () => {
    const result = decode(
      wireEvidence({
        affected_set_construction: [
          { segment_id: 'RD_TPE_002', role: 'INCIDENT', included: true, reason: '事故路段' },
          { segment_id: 'RD_TPE_009', role: 'CONTEXT', included: false, reason: 'BS 事件背景' },
        ],
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.evidence.affectedSetConstruction?.[0]?.role).toBe('INCIDENT');
    expect(result.evidence.affectedSetConstruction?.[1]?.included).toBe(false);
  });

  it('accepts both documented formula-substitution spellings', () => {
    const designNames = decode(
      wireEvidence({
        formula_substitution: {
          sum: 2.43,
          count: 3,
          average: 0.81,
          base: 60,
          penalty: 18.6,
          ETE: 78.6,
        },
      }),
    );
    expect(designNames.ok).toBe(true);
    if (designNames.ok) {
      expect(designNames.evidence.formulaSubstitution).toEqual({
        sum: 2.43,
        count: 3,
        average: 0.81,
        base: 60,
        penalty: 18.6,
        ete: 78.6,
      });
    }

    const eteBlockNames = decode(
      wireEvidence({
        formula_substitution: {
          saturation_sum: 2.43,
          road_count: 3,
          avg_saturation: 0.81,
          base_clearance: 60,
          congestion_penalty: 18.6,
          ete_minutes: 78.6,
        },
      }),
    );
    expect(eteBlockNames.ok).toBe(true);
    if (eteBlockNames.ok) {
      expect(eteBlockNames.evidence.formulaSubstitution?.sum).toBe(2.43);
      expect(eteBlockNames.evidence.formulaSubstitution?.ete).toBe(78.6);
    }
  });

  it('never computes a missing substitution quantity', () => {
    const result = decode(
      wireEvidence({ formula_substitution: { average: 0.81, base: 60, ETE: 78.6 } }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.evidence.formulaSubstitution?.sum).toBeNull();
    expect(result.evidence.formulaSubstitution?.count).toBeNull();
    expect(result.evidence.formulaSubstitution?.penalty).toBeNull();
  });
});

describe('citationCoverage — §14.2 citation_article_set', () => {
  it('is the union of triggered and applied-formula articles, art.7 included', () => {
    const coverage = citationCoverage([1, 2], [7], [citation(1), citation(2), citation(7)]);

    expect(coverage.rows.map((row) => row.articleNo)).toEqual([1, 2, 7]);
    expect(coverage.rows[2]).toMatchObject({
      articleNo: 7,
      triggered: false,
      appliedFormula: true,
    });
    expect(coverage.missingArticles).toEqual([]);
    expect(coverage.extraneousArticles).toEqual([]);
  });

  it('reports an article in the set with no citation', () => {
    const coverage = citationCoverage([1, 2], [7], [citation(1), citation(7)]);

    expect(coverage.missingArticles).toEqual([2]);
  });

  it('reports a citation outside the set', () => {
    const coverage = citationCoverage([1], [7], [citation(1), citation(7), citation(4)]);

    expect(coverage.extraneousArticles).toEqual([4]);
  });

  it('deduplicates an article that both triggered and supplied a formula', () => {
    const coverage = citationCoverage([7], [7], [citation(7)]);

    expect(coverage.rows).toHaveLength(1);
    expect(coverage.rows[0]).toMatchObject({ triggered: true, appliedFormula: true });
  });

  it('groups multiple citations under one article', () => {
    const coverage = citationCoverage([1], [], [citation(1), citation(1)]);

    expect(coverage.rows[0]?.citations).toHaveLength(2);
  });

  it('produces an empty set when the backend reported no articles', () => {
    const coverage = citationCoverage([], [], []);

    expect(coverage.rows).toEqual([]);
    expect(coverage.missingArticles).toEqual([]);
  });
});

describe('evidenceViewOf', () => {
  it('reports absent when there is no core', () => {
    expect(evidenceViewOf(null)).toEqual({ kind: 'absent' });
  });

  it('reports ok for a valid evidence block', () => {
    const view = evidenceViewOf(coreView());
    expect(view.kind).toBe('ok');
  });

  it('reports error when the mandatory evidence block is missing', () => {
    const view = evidenceViewOf(coreView({ evidence: null }));
    expect(view.kind).toBe('error');
    if (view.kind === 'error') expect(view.error.code).toBe('NOT_AN_OBJECT');
  });
});
