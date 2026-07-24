import { describe, expect, it } from 'vitest';
import { IncidentStatus, IncidentType, Severity } from '@city-commander/shared-schemas';
import { evaluateArticle5, isArticle5Triggered } from '../../src/rule_engine/article5.js';
import { unresolvedManualConfirmation } from '../../src/strategies/affected_intersection_scope_strategy.js';

const incident = (type: IncidentType, description: string) => ({
  event_id: 'TPE_2026_EVT_003', type, description, location: '松高路', affected_segment: 'RD_TPE_007',
  status: IncidentStatus.Restricted, severity: Severity.Medium, timestamp: '2026-05-20 22:30',
});
const unresolvedScope = unresolvedManualConfirmation.resolve(incident(IncidentType.Power_Failure, ''), undefined, { mode: 'unresolved_manual_confirmation' });

describe('RuleEngine Article 5 and Strategy E', () => {
  it.each([
    incident(IncidentType.Power_Failure, '一般通報'),
    incident(IncidentType.Road_Collapse_Accident, '路口號誌失效'),
    incident(IncidentType.Road_Collapse_Accident, '設備故障'),
  ])('triggers for each official OR condition', (event) => expect(isArticle5Triggered(event)).toBe(true));

  it('keeps scope and total police unresolved by default while producing official CMS text', () => {
    const result = evaluateArticle5({ incident: incident(IncidentType.Power_Failure, '號誌故障'), affected_road_name: '松高路', affected_intersection_scope: unresolvedScope });
    expect(result).toMatchObject({ triggered: true, adds_to_triggered_articles: [5], cms_core_text: '松高路 號誌故障，請依現場指揮通行' });
    expect(result.affected_intersection_scope).toMatchObject({ police_per_intersection: 2, affected_intersection_count: 'unresolved', total_police: 'unresolved', manual_confirmation_required: true });
  });

  it('marks any configured demonstration count provisional rather than official', () => {
    const scope = unresolvedManualConfirmation.resolve(incident(IncidentType.Power_Failure, ''), undefined, { mode: 'unresolved_manual_confirmation' });
    expect(scope.official_golden_answer).toBe(false);
  });
});
