import * as fc from 'fast-check';
import { describe, expect } from 'vitest';
import { classifySegments } from '../../src/rule_engine/classification_engine.js';
import { propertyTest } from '../helpers/pbt-helper.js';

describe('Classification properties', () => {
  /** Validates: Requirements REQ-011 */
  propertyTest(4, 'A and B classification matches exact saturation boundaries', fc.double({ min: 0, max: 1, noNaN: true }), (saturation) => {
    const level = classifySegments([{ segment_id: 'RD_X', saturation_score: saturation }])[0].level;
    expect(level).toBe(saturation >= 0.95 ? 'A' : saturation >= 0.85 ? 'B' : null);
  });
});
