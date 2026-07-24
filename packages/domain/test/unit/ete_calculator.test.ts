import { describe, expect, it } from 'vitest';
import { IncidentStatus, IncidentType, Severity } from '@city-commander/shared-schemas';
import { aggregateArticles } from '../../src/rule_engine/article_aggregation.js';
import { calculateEte } from '../../src/rule_engine/ete_calculator.js';
import {
  incidentPrimaryAndSelectedSecondary,
  selectLatestCommonExactSnapshot,
} from '../../src/strategies/ete_affected_set_strategy.js';

const incident = {
  event_id: 'TPE_2026_ACC_001',
  type: IncidentType.Road_Collapse_Accident,
  location: '光復南路與忠孝東路口南側',
  affected_segment: 'RD_TPE_002',
  status: IncidentStatus.Closed,
  severity: Severity.Critical,
  description: 'accident',
  timestamp: '2026-05-20 22:10',
};

const affectedRoad = {
  role: 'display_only' as const,
  affected_road: null,
  include_in_ete_context: false,
  directly_triggers_article2: false as const,
  requires_article2_revalidation: false,
};

const affectedSet = incidentPrimaryAndSelectedSecondary.resolve({
  incident,
  affected_road: affectedRoad,
  selected_primary_evacuation: 'RD_TPE_004',
  selected_secondary_evacuation: ['RD_TPE_005'],
});

describe('ETECalculator and HG-001 Strategy C', () => {
  it('uses the latest shared exact snapshot and calculates ACC_001 as 78.6 minutes', () => {
    const snapshot = selectLatestCommonExactSnapshot({
      affected_set: affectedSet.affected_set,
      event_timestamp: incident.timestamp,
      traffic_readings: [
        { road_id: 'RD_TPE_002', observation_timestamp: '2026-05-20 22:10', saturation_score: 1 },
        { road_id: 'RD_TPE_002', observation_timestamp: '2026-05-20 22:00', saturation_score: 1 },
        { road_id: 'RD_TPE_004', observation_timestamp: '2026-05-20 22:00', saturation_score: 0.78 },
        { road_id: 'RD_TPE_005', observation_timestamp: '2026-05-20 22:00', saturation_score: 0.65 },
      ],
    });

    const result = calculateEte({ severity: Severity.Critical, affected_set: affectedSet, snapshot_provenance: snapshot });

    expect(snapshot).toMatchObject({
      selection_status: 'common_exact_snapshot',
      common_snapshot_timestamp: '2026-05-20 22:00',
    });
    expect(result).toMatchObject({
      affected_set: ['RD_TPE_002', 'RD_TPE_004', 'RD_TPE_005'],
      avg_saturation: 0.81,
      base_clearance: 60,
      congestion_penalty: 18.6,
      ete_minutes: 78.6,
      calculation_status: 'computed',
      manual_confirmation_required: false,
      lower_bound_only: false,
      applied_formula_articles: [7],
    });
  });

  it('uses a stable unique affected set when primary or secondary IDs repeat the incident road', () => {
    const result = incidentPrimaryAndSelectedSecondary.resolve({
      incident,
      affected_road: affectedRoad,
      selected_primary_evacuation: 'RD_TPE_002',
      selected_secondary_evacuation: ['RD_TPE_004', 'RD_TPE_004', 'RD_TPE_002'],
    });

    expect(result.affected_set).toEqual(['RD_TPE_002', 'RD_TPE_004']);
  });

  it('returns an explicit manual-confirmation lower bound when no common snapshot exists', () => {
    const snapshot = selectLatestCommonExactSnapshot({
      affected_set: affectedSet.affected_set,
      event_timestamp: incident.timestamp,
      traffic_readings: [
        { road_id: 'RD_TPE_002', observation_timestamp: '2026-05-20 22:10', saturation_score: 1 },
        { road_id: 'RD_TPE_004', observation_timestamp: '2026-05-20 22:05', saturation_score: 0.78 },
        { road_id: 'RD_TPE_005', observation_timestamp: '2026-05-20 22:00', saturation_score: 0.65 },
      ],
    });

    const result = calculateEte({ severity: Severity.Critical, affected_set: affectedSet, snapshot_provenance: snapshot });

    expect(result).toMatchObject({
      calculation_status: 'insufficient_common_snapshot',
      ete_minutes: null,
      ete_lower_bound_minutes: 60,
      congestion_penalty: null,
      avg_saturation: null,
      manual_confirmation_required: true,
      lower_bound_only: true,
    });
    expect(result.snapshot_provenance).toMatchObject({
      selection_status: 'insufficient_common_snapshot',
      common_snapshot_timestamp: null,
      readings: [],
    });
  });

  it('keeps Article 7 applied-only when the ETE formula is used', () => {
    const articles = aggregateArticles({
      evaluations: [{ article: 2, triggered: true }],
      applied_formula_articles: [7],
    });

    expect(articles.triggered_articles).toEqual([2]);
    expect(articles.applied_formula_articles).toEqual([7]);
    expect(articles.citation_article_set).toEqual([2, 7]);
  });
});
