import { describe, expect, it } from 'vitest';
import { IncidentStatus, IncidentType, Severity } from '@city-commander/shared-schemas';
import { evaluateArticle5 } from '../../src/rule_engine/article5.js';
import { calculateEte } from '../../src/ete/ete_calculator.js';
import { incidentPrimaryAndSelectedSecondary, selectLatestCommonExactSnapshot } from '../../src/strategies/ete_affected_set_strategy.js';
import { displayOnlyAffectedRoadStrategy } from '../../src/strategies/affected_road_strategy.js';
import { unresolvedManualConfirmation } from '../../src/strategies/affected_intersection_scope_strategy.js';
import { makeIncident } from '../helpers/domain-fixtures.js';

describe('EVT_003 golden', () => {
  it('triggers SOP-5 with exact CMS unresolved police scope and HG-001 ETE 41.0', () => {
    const incident = makeIncident({ event_id: 'TPE_2026_EVT_003', type: IncidentType.Power_Failure, affected_segment: 'RD_TPE_007', status: IncidentStatus.Restricted, severity: Severity.Medium, timestamp: '2026-05-20 22:30' });
    const scope = unresolvedManualConfirmation.resolve(incident, undefined, { mode: 'unresolved_manual_confirmation' });
    const article5 = evaluateArticle5({ incident, affected_road_name: '松高路', affected_intersection_scope: scope });
    const set = incidentPrimaryAndSelectedSecondary.resolve({ incident, affected_road: displayOnlyAffectedRoadStrategy.resolve(incident), selected_primary_evacuation: 'RD_TPE_011' });
    const snapshot = selectLatestCommonExactSnapshot({ affected_set: set.affected_set, event_timestamp: incident.timestamp, traffic_readings: [{ road_id: 'RD_TPE_007', observation_timestamp: incident.timestamp, saturation_score: 0.85 }, { road_id: 'RD_TPE_011', observation_timestamp: incident.timestamp, saturation_score: 0.85 }] });
    const ete = calculateEte({ severity: Severity.Medium, affected_set: set, snapshot_provenance: snapshot });
    expect(article5).toMatchObject({ triggered: true, cms_core_text: '松高路 號誌故障，請依現場指揮通行', affected_intersection_scope: { police_per_intersection: 2, affected_intersection_count: 'unresolved', total_police: 'unresolved', manual_confirmation_required: true, official_golden_answer: false } });
    expect(ete.ete_minutes).toBe(41); expect(ete.applicability_note).toContain('HG-001');
  });
});
