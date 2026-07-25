import * as fc from 'fast-check';
import { describe, expect } from 'vitest';
import { incidentAnchorFromLocationText } from '../../src/strategies/incident_anchor_resolution_strategy.js';
import { makeIncident, roadNetwork } from '../helpers/domain-fixtures.js';
import { propertyTest } from '../helpers/pbt-helper.js';

describe('Incident anchor properties', () => {
  /** Validates: Requirements REQ-013, REQ-028 */
  propertyTest(30, 'unique anchors resolve by geometry while non-unique anchors require confirmation', fc.boolean(), (ambiguous) => {
    const location = ambiguous ? '市民大道四段與忠孝東路四段之間' : '忠孝東路四段南側';
    const result = incidentAnchorFromLocationText.resolve(makeIncident({ location }), roadNetwork(), { mode: 'incident_anchor_from_location_text' });
    if (ambiguous) {
      expect(result.manual_confirmation_required).toBe(true);
      expect(result.anchor_intersection).toBe('');
      expect(result.position_relative_to_intersection).toBe('');
      expect(result.unranked_direct_intersections).toEqual(['市民大道四段', '忠孝東路四段']);
    } else {
      expect(result.manual_confirmation_required).toBe(false);
      expect(result.anchor_intersection).toBe('忠孝東路四段');
      expect(result.anchor_index).toBe(1);
    }
  });
});
