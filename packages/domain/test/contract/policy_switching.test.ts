import { describe, expect, it } from 'vitest';
import { createPolicyStrategyBundle } from '../../src/strategies/policy_strategy_bundle.js';
import { isArticle2Triggered } from '../../src/rule_engine/article2.js';
import { makeIncident, roadNetwork, roadSegments } from '../helpers/domain-fixtures.js';

class LocalConfigProvider {
  constructor(private readonly values: Readonly<Record<string, string | number | boolean | readonly string[]>>) {}
  get(key: string): string | number | boolean | readonly string[] { const value = this.values[key]; if (value === undefined) throw new Error(`missing ${key}`); return value; }
}

const values = (overrides: Readonly<Record<string, string | number>> = {}) => ({
  'policy.time_alignment.mode': 'exact_or_latest_prior_per_entity',
  'policy.time_alignment.max_staleness_minutes': 10,
  'policy.affected_road.role': 'display_only',
  'policy.ete.affected_set': 'incident_primary_and_selected_secondary',
  'policy.incident_anchor.mode': 'incident_anchor_from_location_text',
  'policy.affected_intersection_scope.mode': 'unresolved_manual_confirmation',
  'policy.multilingual_scope.mode': 'current_snapshot_all_available_stations',
  ...overrides,
});
const bundle = (overrides: Readonly<Record<string, string | number>> = {}) => createPolicyStrategyBundle(new LocalConfigProvider(values(overrides)));

describe('Strategies A-F policy switching contract', () => {
  it('switches Strategy A through ConfigProvider', () => {
    const records = [{ timestamp_normalized: new Date(2026, 4, 20, 20, 0), marker: 'old' }];
    const event = new Date(2026, 4, 20, 22, 0);
    const strict = bundle();
    const visible = bundle({ 'policy.time_alignment.mode': 'last_known_value_with_visible_staleness' });
    expect(strict.timeAlignment.select('RD', event, records).data_status).toBe('insufficient_data');
    expect(visible.timeAlignment.select('RD', event, records).record?.marker).toBe('old');
    expect(visible.metadata.time_alignment.mode).toBe('last_known_value_with_visible_staleness');
  });

  it('switches Strategy B through ConfigProvider without allowing affected_road to trigger article 2', () => {
    const incident = makeIncident({ affected_road: 'RD_CONTEXT' });
    const display = bundle();
    const context = bundle({ 'policy.affected_road.role': 'context_and_ete' });
    expect(display.affectedRoad.resolve(incident).include_in_ete_context).toBe(false);
    expect(context.affectedRoad.resolve(incident)).toMatchObject({ include_in_ete_context: true, directly_triggers_article2: false });
    expect(context.metadata.affected_road.role).toBe('context_and_ete');
  });

  it('switches Strategy C through ConfigProvider', () => {
    const incident = makeIncident();
    const input = { incident, affected_road: bundle().affectedRoad.resolve(incident), selected_primary_evacuation: 'RD_P', selected_secondary_evacuation: ['RD_S'] };
    const direct = bundle({ 'policy.ete.affected_set': 'directly_affected_roads_at_event_snapshot' });
    const routed = bundle();
    expect(direct.eteAffectedSet.resolve(input).affected_set).toEqual(['RD_TPE_002']);
    expect(routed.eteAffectedSet.resolve(input).affected_set).toEqual(['RD_TPE_002', 'RD_P', 'RD_S']);
    expect(routed.metadata.ete.affected_set).toBe('incident_primary_and_selected_secondary');
  });

  it('switches Strategy D through ConfigProvider', () => {
    const incident = makeIncident({ location: 'unknown location' });
    const text = bundle();
    const explicit = bundle({ 'policy.incident_anchor.mode': 'explicit_host_mapping' });
    expect(text.incidentAnchor.resolve(incident, roadNetwork(), { mode: 'incident_anchor_from_location_text' }).manual_confirmation_required).toBe(true);
    expect(explicit.incidentAnchor.resolve(incident, roadNetwork(), { mode: 'explicit_host_mapping', explicit_mappings: { [incident.event_id]: { anchor_intersection: '忠孝東路四段', position_relative_to_intersection: 'south' } } })).toMatchObject({ manual_confirmation_required: false, anchor_intersection: '忠孝東路四段' });
    expect(explicit.metadata.incident_anchor.mode).toBe('explicit_host_mapping');
  });

  it('switches Strategy E through ConfigProvider', () => {
    const incident = makeIncident();
    const segment = roadSegments()[0];
    const unresolved = bundle();
    const all = bundle({ 'policy.affected_intersection_scope.mode': 'all_segment_intersections' });
    expect(unresolved.affectedIntersectionScope.resolve(incident, segment, { mode: 'unresolved_manual_confirmation' }).total_police).toBe('unresolved');
    expect(all.affectedIntersectionScope.resolve(incident, segment, { mode: 'all_segment_intersections' })).toMatchObject({ total_police: segment.intersections.length * 2, official_golden_answer: false });
    expect(all.metadata.affected_intersection_scope.mode).toBe('all_segment_intersections');
  });

  it('switches Strategy F through ConfigProvider', () => {
    const stations = [{ bs_id: 'A', roaming_pct_value: 0.4 }, { bs_id: 'B', roaming_pct_value: 0.1 }];
    const all = bundle();
    const explicit = bundle({ 'policy.multilingual_scope.mode': 'explicit_host_policy' });
    expect(all.multilingualScope.stationsInScope(stations, { mode: 'current_snapshot_all_available_stations' }).stations_in_scope.map((station) => station.bs_id)).toEqual(['A', 'B']);
    expect(explicit.multilingualScope.stationsInScope(stations, { mode: 'explicit_host_policy', explicit_station_ids: ['B'] }).stations_in_scope.map((station) => station.bs_id)).toEqual(['B']);
    expect(explicit.metadata.multilingual_scope.mode).toBe('explicit_host_policy');
  });

  it('keeps the Rule Engine function unchanged across all ConfigProvider swaps', () => {
    const reference = isArticle2Triggered;
    bundle();
    bundle({ 'policy.affected_road.role': 'context_and_ete', 'policy.ete.affected_set': 'directly_affected_roads_at_event_snapshot', 'policy.incident_anchor.mode': 'explicit_host_mapping', 'policy.affected_intersection_scope.mode': 'all_segment_intersections', 'policy.multilingual_scope.mode': 'explicit_host_policy' });
    expect(isArticle2Triggered).toBe(reference);
  });
});
