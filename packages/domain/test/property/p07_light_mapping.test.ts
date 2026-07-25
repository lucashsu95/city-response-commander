import * as fc from 'fast-check';
import { describe, expect } from 'vitest';
import { trafficLightFor } from '../../src/presentation/traffic_light.js';
import { propertyTest } from '../helpers/pbt-helper.js';

describe('Traffic light properties', () => {
  /** Validates: Requirements REQ-011 */
  propertyTest(7, 'traffic level maps deterministically to dashboard light color', fc.constantFrom<'A' | 'B' | null>('A', 'B', null), (level) => {
    expect(trafficLightFor(level)).toBe(level === 'A' ? 'red' : level === 'B' ? 'yellow' : 'green');
  });
});
