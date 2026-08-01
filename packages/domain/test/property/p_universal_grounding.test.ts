/**
 * Property tests for UARE's selectGroundingCandidates (TASK-UARE-07).
 *
 * Spec: .kiro/specs/unified-adaptive-reasoning-engine/requirements.md R9.3, R9.4
 *
 * These are not part of the numbered global property registry (design.md
 * §22.1 of impl1) — UARE is a separate spec — so they use fast-check + vitest
 * directly rather than the `propertyTest` numbered-label helper.
 */

import * as fc from 'fast-check';
import { describe, it, expect } from 'vitest';
import { selectGroundingCandidates } from '../../src/rule_engine/universal_defense.js';
import { RoadNetworkModel } from '../../src/road_network/road_network_model.js';
import { roadSegments } from '../helpers/domain-fixtures.js';
import { DEFAULT_NUM_RUNS } from '../helpers/pbt-helper.js';

const network = () => RoadNetworkModel.load(roadSegments());
const allSegmentIds = roadSegments().map((s) => s.segment_id);
const whitelist = new Set(allSegmentIds);

/** Arbitrary anchor segment id, plus an arbitrary saturation value (or null) per alternative. */
const arbCase = fc.record({
  anchorSegmentId: fc.constantFrom(...allSegmentIds),
  saturationValues: fc.dictionary(
    fc.constantFrom(...allSegmentIds),
    fc.option(fc.double({ min: 0, max: 1.5, noNaN: true }), { nil: null }),
  ),
});

describe('selectGroundingCandidates properties', () => {
  it('P-U1: every returned segment_id is a member of the Road_Whitelist', () => {
    fc.assert(
      fc.property(arbCase, ({ anchorSegmentId, saturationValues }) => {
        const result = selectGroundingCandidates(
          anchorSegmentId,
          network(),
          (id) => saturationValues[id] ?? null,
        );
        for (const candidate of result.candidates) {
          expect(whitelist.has(candidate.segment_id)).toBe(true);
        }
      }),
      { numRuns: DEFAULT_NUM_RUNS },
    );
  });

  it('P-U2: identical inputs produce identical output (pure function)', () => {
    fc.assert(
      fc.property(arbCase, ({ anchorSegmentId, saturationValues }) => {
        const saturationOf = (id: string): number | null => saturationValues[id] ?? null;
        const a = selectGroundingCandidates(anchorSegmentId, network(), saturationOf);
        const b = selectGroundingCandidates(anchorSegmentId, network(), saturationOf);
        expect(a).toEqual(b);
      }),
      { numRuns: DEFAULT_NUM_RUNS },
    );
  });
});
