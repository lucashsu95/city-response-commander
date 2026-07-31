import { describe, expect, it } from 'vitest';
import { Severity } from '@city-commander/shared-schemas';
import { classifySegments } from '../../src/rule_engine/classification_engine.js';
import { evaluateArticle1 } from '../../src/rule_engine/article1.js';
import { isArticle2Triggered, qualifyCandidates } from '../../src/rule_engine/article2.js';
import { selectEvacuation } from '../../src/rule_engine/evacuation_selector.js';
import { aggregateArticles } from '../../src/rule_engine/article_aggregation.js';
import { incidentAnchorFromLocationText } from '../../src/strategies/incident_anchor_resolution_strategy.js';
import { displayOnlyAffectedRoadStrategy } from '../../src/strategies/affected_road_strategy.js';
import { incidentPrimaryAndSelectedSecondary, selectLatestCommonExactSnapshot } from '../../src/strategies/ete_affected_set_strategy.js';
import { calculateEte } from '../../src/ete/ete_calculator.js';
import { buildDecisionCore } from '../../src/decision/decision_core_builder.js';
import { baseCoreInput, makeIncident, roadNetwork } from '../helpers/domain-fixtures.js';

describe('ACC_001 deterministic golden', () => {
  it('matches the HG-001 organizer-guided walkthrough without presenting it as an official answer', () => {
    const incident = makeIncident({ location: '光復南路與忠孝東路口南側' });
    const classifications = classifySegments([{ segment_id: 'RD_TPE_002', saturation_score: 1 }]);
    const article1 = evaluateArticle1(classifications);
    expect(isArticle2Triggered(incident)).toBe(true);
    const anchor = incidentAnchorFromLocationText.resolve(incident, roadNetwork(), { mode: 'incident_anchor_from_location_text' });
    const candidates = qualifyCandidates(incident.affected_segment, anchor.anchor_intersection, roadNetwork(), new Map([['RD_TPE_004', 0.78], ['RD_TPE_005', 0.65], ['RD_TPE_006', 0.4], ['RD_TPE_008', 0.2]]));
    const evacuation = selectEvacuation(candidates);
    const articles = aggregateArticles({ evaluations: [{ article: 1, triggered: article1.triggered, invoked_procedures: article1.invoked_procedures }, { article: 2, triggered: true }], applied_formula_articles: [7] });
    const affectedSet = incidentPrimaryAndSelectedSecondary.resolve({ incident, affected_road: displayOnlyAffectedRoadStrategy.resolve(incident), selected_primary_evacuation: evacuation.primary_evacuation, selected_secondary_evacuation: evacuation.secondary_evacuation });
    const snapshot = selectLatestCommonExactSnapshot({ affected_set: affectedSet.affected_set, event_timestamp: incident.timestamp, traffic_readings: [
      { road_id: 'RD_TPE_002', observation_timestamp: '2026-05-20 22:00', saturation_score: 1 }, { road_id: 'RD_TPE_004', observation_timestamp: '2026-05-20 22:00', saturation_score: 0.78 }, { road_id: 'RD_TPE_005', observation_timestamp: '2026-05-20 22:00', saturation_score: 0.65 },
    ] });
    const ete = calculateEte({ severity: Severity.Critical, affected_set: affectedSet, snapshot_provenance: snapshot });
    const base = baseCoreInput();
    const core = buildDecisionCore({ ...base, triggered_articles: articles.triggered_articles, invoked_procedures: articles.invoked_procedures, applied_formula_articles: articles.applied_formula_articles, classifications, incident_anchor: anchor, primary_evacuation: evacuation.primary_evacuation, secondary_evacuation: evacuation.secondary_evacuation, excluded_candidates: evacuation.excluded_candidates, ete, policy: { ...base.policy, guidance_id: 'HG-001', official_golden_answer: false }, cms_core_text: `光復南路封閉，請改道 市民大道四段，預計延誤 ${ete.ete_minutes} 分鐘` });
    expect(articles).toMatchObject({ triggered_articles: [1, 2], invoked_procedures: ['article2_alternative_route_guidance'], applied_formula_articles: [7], citation_article_set: [1, 2, 7] });
    expect(core.primary_evacuation).toBe('RD_TPE_004'); expect(core.secondary_evacuation).toEqual(['RD_TPE_005']);
    expect(core.excluded_candidates.find((route) => route.segment_id === 'RD_TPE_006')?.exclusion_reason).toContain('非直接相交');
    expect(core.excluded_candidates.find((route) => route.segment_id === 'RD_TPE_008')?.exclusion_reason).toContain('600');
    expect(core.ete?.ete_minutes).toBeCloseTo(78.6, 10);
    expect(core.policy).toMatchObject({ classification: 'PROVISIONAL_TEAM_POLICY', guidance_id: 'HG-001', official_golden_answer: false, is_official: false });
  });
});
