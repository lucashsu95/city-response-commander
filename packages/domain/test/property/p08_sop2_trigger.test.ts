import * as fc from 'fast-check';
import { describe, expect } from 'vitest';
import { IncidentStatus, Severity } from '@city-commander/shared-schemas';
import { isArticle2Triggered } from '../../src/rule_engine/article2.js';
import { makeIncident } from '../helpers/domain-fixtures.js';
import { propertyTest } from '../helpers/pbt-helper.js';

describe('SOP-2 trigger properties', () => {
  /** Validates: Requirements REQ-012 */
  propertyTest(8, 'article 2 triggers iff all three official conditions hold', fc.record({
    status: fc.constantFrom(...Object.values(IncidentStatus)), severity: fc.constantFrom(...Object.values(Severity)), road: fc.boolean(),
  }), ({ status, severity, road }) => {
    const expected = [IncidentStatus.Closed, IncidentStatus.Blocked, IncidentStatus.Restricted].includes(status) && [Severity.High, Severity.Critical].includes(severity) && road;
    expect(isArticle2Triggered(makeIncident({ status, severity, affected_segment: road ? 'RD_X' : 'BS_X' }))).toBe(expected);
  });
});
