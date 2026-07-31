import * as fc from 'fast-check';
import { describe, expect } from 'vitest';
import type { RouteCandidate } from '@city-commander/shared-schemas';
import { buildEvidenceTrace } from '../../src/evidence/evidence_trace_builder.js';
import { propertyTest } from '../helpers/pbt-helper.js';

describe('Evidence-chain properties', () => {
  /** Validates: Requirements REQ-008 */
  propertyTest(26, 'evidence contains reasoning data and non-empty reason for every excluded route', fc.uniqueArray(fc.string({ minLength: 1, maxLength: 10 }), { maxLength: 8 }), (ids) => {
    const excluded: RouteCandidate[] = ids.map((id) => ({ segment_id: id, capacity_vph: 0, passes_capacity: false, is_direct_intersection: false, upstream_or_downstream: 'downstream', saturation_at_snapshot: 0, role: 'excluded', exclusion_reason: `reason-${id}` }));
    const trace = buildEvidenceTrace({ decision_id: 'D', classification_reasoning: [{ segment_id: 'RD', saturation_score: 0.95, threshold: '>=0.95', conclusion: 'A' }], excluded_candidates: excluded, citation_article_set: [1], sop_citations: [{ article_no: 1, source_location: 'sop#1', text: 'rule' }], data_points: [{ source: 'traffic', field: 'saturation', value: 0.95, timestamp: '2026-05-20 22:10' }] });
    expect(trace.classification_reasoning.length).toBeGreaterThan(0); expect(trace.data_points.length).toBeGreaterThan(0);
    expect(trace.excluded_routes.every((route) => route.reason.trim().length > 0)).toBe(true);
  });
});
