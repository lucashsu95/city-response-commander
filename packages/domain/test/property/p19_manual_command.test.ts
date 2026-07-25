import * as fc from 'fast-check';
import { describe, expect } from 'vitest';
import { IncidentType } from '@city-commander/shared-schemas';
import { evaluateArticle5 } from '../../src/rule_engine/article5.js';
import { explicitHostSet, unresolvedManualConfirmation } from '../../src/strategies/affected_intersection_scope_strategy.js';
import { makeIncident } from '../helpers/domain-fixtures.js';
import { propertyTest } from '../helpers/pbt-helper.js';

describe('SOP-5 manual command properties', () => {
  /** Validates: Requirements REQ-018 */
  propertyTest(19, 'police total is two per confirmed intersection and unresolved otherwise', fc.option(fc.integer({ min: 0, max: 20 }), { nil: undefined }), (count) => {
    const incident = makeIncident({ type: IncidentType.Power_Failure });
    const scope = count === undefined
      ? unresolvedManualConfirmation.resolve(incident, undefined, { mode: 'unresolved_manual_confirmation' })
      : explicitHostSet.resolve(incident, undefined, { mode: 'explicit_host_set', explicit_intersections: Array.from({ length: count }, (_, i) => `I${i}`) });
    const result = evaluateArticle5({ incident, affected_road_name: '松高路', affected_intersection_scope: scope });
    expect(scope.police_per_intersection).toBe(2);
    expect(scope.total_police).toBe(count === undefined ? 'unresolved' : count * 2);
    expect(result.cms_core_text).toBe('松高路 號誌故障，請依現場指揮通行');
  });
});
