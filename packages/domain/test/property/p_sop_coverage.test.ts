import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { resolveSopCoverage } from '../../src/boundary/sop_coverage_resolver.js';
import { IncidentType } from '@city-commander/shared-schemas';

const OFFICIAL_MAPPINGS = [
  [IncidentType.Road_Collapse_Accident, 2],
  [IncidentType.Crowd_Surge_Injury, 3],
  [IncidentType.Power_Failure, 5],
] as const;

describe('SOP coverage properties', () => {
  it('Feature: boundary-snapping-containment, Property BS-SOP-1: every official incident type maps to its authored SOP article', () => {
    fc.assert(
      fc.property(fc.constantFrom(...OFFICIAL_MAPPINGS), ([incidentType, articleNo]) => {
        const result = resolveSopCoverage(incidentType, '一般事件描述');
        expect(result).toMatchObject({
          sop_coverage_status: 'OFFICIAL_SOP_MATCHED',
          sop_authority: 'OFFICIAL_SOP',
          matched_article_nos: [articleNo],
          universal_principles: [],
        });
      }),
      { numRuns: 100 },
    );
  });

  it('Feature: boundary-snapping-containment, Property BS-SOP-2: unknown types use exactly the domain universal policy', () => {
    fc.assert(
      fc.property(fc.hexaString({ minLength: 1 }), (suffix) => {
        const result = resolveSopCoverage(`UNKNOWN_${suffix}`, '一般事件描述');
        expect(result.sop_coverage_status).toBe('UNKNOWN_TYPE_UNIVERSAL_SOP');
        expect(result.sop_authority).toBe('SYSTEM_DEFAULT_PRINCIPLE');
        expect(result.matched_article_nos).toEqual([]);
        expect(result.universal_principles).toHaveLength(3);
      }),
      { numRuns: 100 },
    );
  });
});
