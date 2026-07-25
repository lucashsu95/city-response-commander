import * as fc from 'fast-check';
import { describe, expect } from 'vitest';
import { assembleCommandCenterReport } from '../../src/content/decision_content.js';
import { propertyTest } from '../helpers/pbt-helper.js';

describe('Command-center report properties', () => {
  /** Validates: Requirements REQ-021 */
  propertyTest(24, 'report includes event clauses grading routes exclusions signal cross-system and ETE facts', fc.record({ art3: fc.boolean(), art5: fc.boolean(), saturation: fc.double({ min: 0, max: 1, noNaN: true }), delay: fc.integer({ min: 0, max: 300 }) }), (v) => {
    const report = assembleCommandCenterReport({ event_id: 'EVT', triggered_articles: [1, ...(v.art3 ? [3] : []), ...(v.art5 ? [5] : [])], applied_formula_articles: [7], classification: { level: 'A', saturation: v.saturation }, primary_evacuation: 'RD_P', secondary_evacuation: ['RD_S'], excluded_routes: [{ segment_id: 'RD_X', reason: 'capacity' }], signal_timing: { alternatives_green_plus_pct: 25 }, article3_triggered: v.art3, article5_triggered: v.art5, ete: { minutes: v.delay, basis: 'official formula' }, cms_core_text: 'core' });
    expect(report.event_identification).toMatchObject({ event_id: 'EVT' });
    expect(report.event_identification.sop_articles).toContain(7);
    expect(report.classification_section.saturation).toBe(v.saturation);
    expect(report.route_section).toMatchObject({ primary: 'RD_P', secondary: ['RD_S'] });
    expect(report.route_section.exclusions[0].reason).toBeTruthy();
    expect(report.signal_timing_section?.alternatives_green_plus_pct).toBe(25);
    expect(report.ete_section.basis).toBeTruthy();
    expect(report.cross_system_requests.includes('mrt')).toBe(v.art3);
    expect(report.cross_system_requests.includes('police')).toBe(v.art5);
  });
});
