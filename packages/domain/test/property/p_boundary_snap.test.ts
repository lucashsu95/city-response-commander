/**
 * Boundary_Snapper property tests (spec: boundary-snapping-containment, §10).
 *
 * Property IDs here (P-B1..P-B4) are this spec's own catalogue, distinct
 * from the main project's official P1-P37 (design.md §22.1) — do not reuse
 * those numbers via `propertyTest`'s "Property N" labeling to avoid
 * colliding with an already-catalogued official property.
 */
import * as fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import { checkEntityScope } from '../../src/boundary/boundary_snapper.js';
import { roadNetwork, makeIncident } from '../helpers/domain-fixtures.js';

const incidentArbitrary = fc
  .record({
    affected_segment: fc.oneof(
      fc.constantFrom('RD_TPE_002', 'RD_TPE_004', 'RD_TPE_099', 'BS_MRT_BL17'),
      fc.string({ minLength: 1, maxLength: 10 }),
    ),
    affected_road: fc.option(
      fc.oneof(fc.constantFrom('RD_TPE_002', 'RD_TPE_099'), fc.string({ minLength: 1, maxLength: 10 })),
      { nil: undefined },
    ),
    location: fc.oneof(
      fc.constantFrom(
        '光復南路與忠孝東路四段南側',
        '市民大道四段口',
        '完全不相關的地點文字',
        '',
      ),
      fc.string({ minLength: 0, maxLength: 30 }),
    ),
  })
  .map((partial) => makeIncident(partial));

describe('Boundary_Snapper property tests', () => {
  it('P-B2: checkEntityScope is a pure function — repeated calls with the same input yield identical output (R14.3)', () => {
    const network = roadNetwork();
    fc.assert(
      fc.property(incidentArbitrary, (incident) => {
        const first = checkEntityScope(incident, network);
        const second = checkEntityScope(incident, network);
        expect(first).toEqual(second);
      }),
      { numRuns: 100 },
    );
  });

  it('P-B2b: decision_anchor_segment_id is null only for OUT_OF_BOUNDS, and non-null otherwise', () => {
    const network = roadNetwork();
    fc.assert(
      fc.property(incidentArbitrary, (incident) => {
        const result = checkEntityScope(incident, network);
        if (result.coverage_status === 'OUT_OF_BOUNDS') {
          expect(result.decision_anchor_segment_id).toBeNull();
        } else {
          expect(result.decision_anchor_segment_id).not.toBeNull();
        }
      }),
      { numRuns: 100 },
    );
  });
});
