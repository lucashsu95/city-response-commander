import { describe, expect, it } from 'vitest';
import { evaluateArticle6 } from '../../src/rule_engine/article6.js';
import { currentSnapshotAllAvailableStations, incidentAreaNearbyStations } from '../../src/strategies/multilingual_scope_strategy.js';

describe('RuleEngine Article 6 and Strategy F', () => {
  it('triggers at the inclusive 30% boundary using the current all-stations scope', () => {
    const scope = currentSnapshotAllAvailableStations.stationsInScope(
      [{ bs_id: 'BS_A', roaming_pct_value: 0.2999 }, { bs_id: 'BS_B', roaming_pct_value: 0.3 }],
      { mode: 'current_snapshot_all_available_stations' },
    );
    expect(evaluateArticle6(scope)).toMatchObject({ triggered: true, multilingual_required: true, adds_to_triggered_articles: [6], triggering_station_ids: ['BS_B'] });
  });

  it('honors a configured in-scope subset rather than a station outside that current scope', () => {
    const scope = incidentAreaNearbyStations.stationsInScope(
      [{ bs_id: 'BS_NEAR', roaming_pct_value: 0.2 }, { bs_id: 'BS_OTHER', roaming_pct_value: 0.45 }],
      { mode: 'incident_area_nearby_stations', incident_area_station_ids: ['BS_NEAR'] },
    );
    expect(evaluateArticle6(scope)).toMatchObject({ triggered: false, data_status: 'ready', adds_to_triggered_articles: [] });
  });

  it('reports insufficient_data when an unknown in-scope reading could satisfy the threshold', () => {
    const scope = currentSnapshotAllAvailableStations.stationsInScope(
      [{ bs_id: 'BS_KNOWN', roaming_pct_value: 0.2 }, { bs_id: 'BS_UNKNOWN', roaming_pct_value: null }],
      { mode: 'current_snapshot_all_available_stations' },
    );
    expect(evaluateArticle6(scope)).toMatchObject({ triggered: false, multilingual_required: false, data_status: 'insufficient_data' });
  });

  it('retains a known qualifying trigger despite another unknown in-scope reading', () => {
    const scope = currentSnapshotAllAvailableStations.stationsInScope(
      [{ bs_id: 'BS_QUALIFYING', roaming_pct_value: 0.3 }, { bs_id: 'BS_UNKNOWN', roaming_pct_value: null }],
      { mode: 'current_snapshot_all_available_stations' },
    );
    expect(evaluateArticle6(scope)).toMatchObject({ triggered: true, multilingual_required: true, triggering_station_ids: ['BS_QUALIFYING'], data_status: 'ready' });
  });

  it('returns insufficient_data when the current scope has no usable snapshot', () => {
    const scope = currentSnapshotAllAvailableStations.stationsInScope([{ bs_id: 'BS_A', roaming_pct_value: null }], { mode: 'current_snapshot_all_available_stations' });
    expect(evaluateArticle6(scope)).toMatchObject({ triggered: false, data_status: 'insufficient_data' });
  });
});
