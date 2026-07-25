/** Deterministic SOP-6 threshold evaluation for the Strategy-F current scope. */

import type { MultilingualScopeResult } from '../strategies/multilingual_scope_strategy.js';

export const ROAMING_THRESHOLD = 0.3;

export interface MultilingualTriggerResult {
  readonly triggered: boolean;
  readonly multilingual_required: boolean;
  readonly triggering_station_ids: readonly string[];
  readonly data_status: 'ready' | 'insufficient_data';
}

/** Evaluates only current, Strategy-A-aligned station snapshots. */
export function evaluateMultilingualTrigger(
  scope: Pick<MultilingualScopeResult, 'stations_in_scope'>,
): MultilingualTriggerResult {
  const triggering_station_ids = scope.stations_in_scope
    .filter(
      (station) =>
        station.roaming_pct_value !== null && station.roaming_pct_value >= ROAMING_THRESHOLD,
    )
    .map((station) => station.bs_id);

  // A known qualifying station is sufficient regardless of incomplete readings
  // elsewhere in the selected current scope.
  if (triggering_station_ids.length > 0) {
    return {
      triggered: true,
      multilingual_required: true,
      triggering_station_ids,
      data_status: 'ready',
    };
  }

  // Without a known qualifier, a missing in-scope reading could meet the
  // inclusive threshold, so the false result is not conclusive.
  const hasUnknownReading = scope.stations_in_scope.some(
    (station) => station.roaming_pct_value === null,
  );
  return {
    triggered: false,
    multilingual_required: false,
    triggering_station_ids: [],
    data_status:
      hasUnknownReading || scope.stations_in_scope.length === 0 ? 'insufficient_data' : 'ready',
  };
}
