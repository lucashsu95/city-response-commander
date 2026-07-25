import { describe, expect, it } from 'vitest';
import { IncidentStatus, IncidentType, Severity } from '@city-commander/shared-schemas';
import { SnapshotSelector } from '../../src/snapshot/snapshot_selector.js';
import { evaluateArticle3 } from '../../src/rule_engine/article3.js';
import { isArticle2Triggered } from '../../src/rule_engine/article2.js';
import { createPolicyStrategyBundle } from '../../src/strategies/policy_strategy_bundle.js';
import { makeIncident } from '../helpers/domain-fixtures.js';

class LocalConfigProvider {
  constructor(private readonly values: Readonly<Record<string, string | number>>) {}
  get(key: string): string | number { const value = this.values[key]; if (value === undefined) throw new Error(`missing ${key}`); return value; }
}

const config = new LocalConfigProvider({
  'policy.time_alignment.mode': 'exact_or_latest_prior_per_entity',
  'policy.time_alignment.max_staleness_minutes': 30,
  'policy.affected_road.role': 'display_only',
  'policy.ete.affected_set': 'incident_primary_and_selected_secondary',
  'policy.incident_anchor.mode': 'incident_anchor_from_location_text',
  'policy.affected_intersection_scope.mode': 'unresolved_manual_confirmation',
  'policy.multilingual_scope.mode': 'current_snapshot_all_available_stations',
});

describe('EVT_002 golden', () => {
  it('computes article 3 from latest-prior BL17 production selection and keeps affected_road display-only', () => {
    const incident = makeIncident({ event_id: 'TPE_2026_EVT_002', type: IncidentType.Crowd_Surge_Injury, affected_segment: 'BS_MRT_BL17', affected_road: 'RD_TPE_001', status: IncidentStatus.Restricted, severity: Severity.High, timestamp: '2026-05-20 22:20' });
    const selector = new SnapshotSelector(config);
    const selected = selector.select(incident.affected_segment, new Date(2026, 4, 20, 22, 20), [
      { timestamp_normalized: new Date(2026, 4, 20, 22, 15), user_count: 31_000, growth_rate: 0.2 },
      { timestamp_normalized: new Date(2026, 4, 20, 22, 25), user_count: 1, growth_rate: 0 },
    ]);
    expect(selected.record?.timestamp_normalized).toEqual(new Date(2026, 4, 20, 22, 15));
    const reading = selected.record;
    expect(reading).not.toBeNull();
    const article3 = evaluateArticle3({ bs_id: incident.affected_segment, user_count: reading!.user_count, growth_rate: reading!.growth_rate });
    const policy = createPolicyStrategyBundle(config);
    const affectedRoad = policy.affectedRoad.resolve(incident);
    expect(article3).toMatchObject({ triggered: true, adds_to_triggered_articles: [3], data_status: 'ready' });
    expect(article3.trigger_reason).toContain('31000');
    expect(isArticle2Triggered(incident)).toBe(false);
    expect(affectedRoad).toMatchObject({ role: 'display_only', affected_road: 'RD_TPE_001', include_in_ete_context: false, directly_triggers_article2: false });
    expect(policy.metadata).toMatchObject({ classification: 'PROVISIONAL_TEAM_POLICY', status: 'AWAITING_HOST_REPLY', affected_road: { role: 'display_only' } });
  });
});
