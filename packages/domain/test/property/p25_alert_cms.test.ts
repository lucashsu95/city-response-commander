import * as fc from 'fast-check';
import { describe, expect } from 'vitest';
import { assemblePublicAlert, buildSop2CmsCoreText } from '../../src/content/decision_content.js';
import { propertyTest } from '../helpers/pbt-helper.js';

describe('Public alert and CMS properties', () => {
  /** Validates: Requirements REQ-015, REQ-022 */
  propertyTest(25, 'public alert and SOP-2 CMS retain location reroute delay and avoidance facts', fc.record({ delay: fc.integer({ min: 0, max: 300 }), suffix: fc.string({ minLength: 1, maxLength: 8 }) }), ({ delay, suffix }) => {
    const location = `Incident-${suffix}`;
    const route = `Route-${suffix}`;
    const reminder = `Avoid-${suffix}`;
    const alert = assemblePublicAlert({ location, reroute: route, delay_minutes: delay, avoidance_reminder: reminder, sop6_triggered: true });
    expect(alert.text).toContain(location);
    expect(alert.text).toContain(route);
    expect(alert.text).toContain(String(delay));
    expect(alert.text).toContain(reminder);

    const cms = buildSop2CmsCoreText({ incident_road: location, primary_evacuation: route, ete_minutes: delay });
    expect(cms).toContain(location);
    expect(cms).toContain(route);
    expect(cms).toContain(`${delay} 分鐘`);
  });
});
