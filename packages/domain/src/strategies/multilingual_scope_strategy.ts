/** Strategy F — configure which current station snapshots may trigger SOP-6. */

export type MultilingualScopeMode =
  | 'current_snapshot_all_available_stations'
  | 'incident_area_nearby_stations'
  | 'explicit_host_policy';

/** A current, Strategy-A-aligned station reading. Historical observations are not accepted. */
export interface CurrentStationSnapshot {
  readonly bs_id: string;
  readonly roaming_pct_value: number | null;
}

export interface MultilingualScopeConfig {
  readonly mode: MultilingualScopeMode;
  readonly incident_area_station_ids?: readonly string[];
  readonly explicit_station_ids?: readonly string[];
}

export interface MultilingualScopeResult {
  readonly mode: MultilingualScopeMode;
  readonly stations_in_scope: readonly CurrentStationSnapshot[];
}

export interface MultilingualScopeStrategy {
  stationsInScope(
    currentStations: readonly CurrentStationSnapshot[],
    config: MultilingualScopeConfig,
  ): MultilingualScopeResult;
}

export const currentSnapshotAllAvailableStations: MultilingualScopeStrategy = {
  stationsInScope: (currentStations) => ({
    mode: 'current_snapshot_all_available_stations',
    stations_in_scope: currentStations,
  }),
};
export const incidentAreaNearbyStations: MultilingualScopeStrategy = {
  stationsInScope: (currentStations, config) => ({
    mode: 'incident_area_nearby_stations',
    stations_in_scope: filterStations(currentStations, config.incident_area_station_ids),
  }),
};
export const explicitHostPolicyStations: MultilingualScopeStrategy = {
  stationsInScope: (currentStations, config) => ({
    mode: 'explicit_host_policy',
    stations_in_scope: filterStations(currentStations, config.explicit_station_ids),
  }),
};

export function resolveMultilingualScopeStrategy(
  mode: MultilingualScopeMode,
): MultilingualScopeStrategy {
  switch (mode) {
    case 'current_snapshot_all_available_stations':
      return currentSnapshotAllAvailableStations;
    case 'incident_area_nearby_stations':
      return incidentAreaNearbyStations;
    case 'explicit_host_policy':
      return explicitHostPolicyStations;
  }
}

function filterStations(
  stations: readonly CurrentStationSnapshot[],
  ids: readonly string[] | undefined,
): readonly CurrentStationSnapshot[] {
  if (ids === undefined) return [];
  const allowed = new Set(ids);
  return stations.filter((station) => allowed.has(station.bs_id));
}
