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
import { checkEntityScope, snap } from '../../src/boundary/boundary_snapper.js';
import { roadNetwork, makeIncident } from '../helpers/domain-fixtures.js';
import type { AnchorGazetteerEntry } from '@city-commander/shared-schemas';

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

// ─── snap() properties (R4/R5) ──────────────────────────────

const validCoordinateArbitrary: fc.Arbitrary<AnchorGazetteerEntry> = fc.record({
  lat: fc.double({ min: -90, max: 90, noNaN: true }),
  lon: fc.double({ min: -180, max: 180, noNaN: true }),
});

const invalidCoordinateArbitrary: fc.Arbitrary<AnchorGazetteerEntry> = fc.record({
  lat: fc.double({ min: -1000, max: 1000, noNaN: true }).filter((lat) => lat < -90 || lat > 90),
  lon: fc.double({ min: -1000, max: 1000, noNaN: true }),
});

const snapConfigArbitrary = fc.record({
  max_snap_distance_meters: fc.integer({ min: 0, max: 100_000 }),
  coordinate_path_enabled: fc.boolean(),
  eventCoordinate: fc.option(fc.oneof(validCoordinateArbitrary, invalidCoordinateArbitrary), {
    nil: undefined,
  }),
  gazetteerPresent: fc.boolean(),
});

describe('Boundary_Snapper.snap property tests', () => {
  it('P-B1: snap() never returns an anchor whose segment_id is outside Road_Whitelist (R14.2)', () => {
    const network = roadNetwork();
    const roadWhitelist = new Set(network.getAllSegments().map((segment) => segment.segment_id));
    // This fixture's only Perimeter_Anchor is on RD_TPE_002 — see
    // perimeter_anchor_derivation.test.ts's golden fixture assertion.
    const anchorSegmentId = 'RD_TPE_002';

    fc.assert(
      fc.property(snapConfigArbitrary, (params) => {
        const gazetteer = params.gazetteerPresent
          ? new Map([[anchorSegmentId, { lat: 25.0, lon: 121.5 }]])
          : undefined;
        const result = snap(
          makeIncident(),
          network,
          {
            max_snap_distance_meters: params.max_snap_distance_meters,
            coordinate_path_enabled: params.coordinate_path_enabled,
            anchor_gazetteer: gazetteer,
          },
          params.eventCoordinate,
        );
        if ('error' in result) return; // config-missing branch not exercised by this arbitrary
        if (result.anchor !== null) {
          expect(roadWhitelist.has(result.anchor.segment_id)).toBe(true);
        }
      }),
      { numRuns: 100 },
    );
  });

  it('P-B3: coverage_status OUT_OF_JURISDICTION implies anchor is null (R14.4)', () => {
    const network = roadNetwork();
    fc.assert(
      fc.property(snapConfigArbitrary, (params) => {
        const gazetteer = params.gazetteerPresent
          ? new Map([['RD_TPE_002', { lat: 25.0, lon: 121.5 }]])
          : undefined;
        const result = snap(
          makeIncident(),
          network,
          {
            max_snap_distance_meters: params.max_snap_distance_meters,
            coordinate_path_enabled: params.coordinate_path_enabled,
            anchor_gazetteer: gazetteer,
          },
          params.eventCoordinate,
        );
        if ('error' in result) return;
        if (result.coverage_status === 'OUT_OF_JURISDICTION') {
          expect(result.anchor).toBeNull();
        }
      }),
      { numRuns: 100 },
    );
  });

  it('snap() is a pure function — repeated calls with the same input yield identical output', () => {
    const network = roadNetwork();
    fc.assert(
      fc.property(snapConfigArbitrary, (params) => {
        const gazetteer = params.gazetteerPresent
          ? new Map([['RD_TPE_002', { lat: 25.0, lon: 121.5 }]])
          : undefined;
        const config = {
          max_snap_distance_meters: params.max_snap_distance_meters,
          coordinate_path_enabled: params.coordinate_path_enabled,
          anchor_gazetteer: gazetteer,
        };
        const first = snap(makeIncident(), network, config, params.eventCoordinate);
        const second = snap(makeIncident(), network, config, params.eventCoordinate);
        expect(first).toEqual(second);
      }),
      { numRuns: 100 },
    );
  });
});
