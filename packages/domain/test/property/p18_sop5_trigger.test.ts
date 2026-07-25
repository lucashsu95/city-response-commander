import * as fc from 'fast-check';
import { describe, expect } from 'vitest';
import { IncidentType } from '@city-commander/shared-schemas';
import { isArticle5Triggered } from '../../src/rule_engine/article5.js';
import { makeIncident } from '../helpers/domain-fixtures.js';
import { propertyTest } from '../helpers/pbt-helper.js';

describe('SOP-5 trigger properties', () => {
  /** Validates: Requirements REQ-018 */
  propertyTest(18, 'article 5 triggers exactly for power failure or signal-failure keywords', fc.record({ power: fc.boolean(), keyword: fc.constantFrom('none', '號誌失效', '故障') }), ({ power, keyword }) => {
    const incident = makeIncident({ type: power ? IncidentType.Power_Failure : IncidentType.Road_Collapse_Accident, description: keyword === 'none' ? '道路事件' : `發生${keyword}` });
    expect(isArticle5Triggered(incident)).toBe(power || keyword !== 'none');
  });
});
