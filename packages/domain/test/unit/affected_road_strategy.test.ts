import { describe, expect, it } from 'vitest';
import { IncidentStatus, IncidentType, Severity } from '@city-commander/shared-schemas';
import { contextAndEteAffectedRoadStrategy, displayOnlyAffectedRoadStrategy, parallelRoadImpactExplicitHostStrategy } from '../../src/strategies/affected_road_strategy.js';

const bsIncident = {
  event_id: 'TPE_2026_EVT_002', type: IncidentType.Crowd_Surge_Injury, location: 'BL17', affected_segment: 'BS_MRT_BL17', affected_road: 'RD_TPE_001',
  status: IncidentStatus.Restricted, severity: Severity.High, description: 'crowd surge', timestamp: '2026-05-20 22:20',
};

describe('AffectedRoadStrategy (Strategy B)', () => {
  it('keeps affected_road display-only by default and never directly triggers Article 2', () => {
    expect(displayOnlyAffectedRoadStrategy.resolve(bsIncident)).toEqual({
      role: 'display_only', affected_road: 'RD_TPE_001', include_in_ete_context: false,
      directly_triggers_article2: false, requires_article2_revalidation: false,
    });
  });

  it('allows configured contextual ETE use without changing the hard Article 2 rule', () => {
    expect(contextAndEteAffectedRoadStrategy.resolve(bsIncident)).toMatchObject({
      include_in_ete_context: true, directly_triggers_article2: false,
    });
  });

  it('requires an independent Article 2 revalidation for the explicit-host role', () => {
    expect(parallelRoadImpactExplicitHostStrategy.resolve(bsIncident)).toMatchObject({
      directly_triggers_article2: false, requires_article2_revalidation: true,
    });
  });
});
