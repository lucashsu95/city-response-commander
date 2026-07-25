/** Strategy C — resolve the SOP-7 affected-road set and its exact common snapshot. */

import type {
  EteSnapshotProvenance,
  EteSnapshotRoadReading,
  Incident,
} from '@city-commander/shared-schemas';
import { normalizeTimestamp } from '../ingestion/timestamp_normalizer.js';
import type { AffectedRoadStrategyResult } from './affected_road_strategy.js';

export type EteAffectedSetMode =
  'directly_affected_roads_at_event_snapshot' | 'incident_primary_and_selected_secondary';

export interface EteAffectedSetResult {
  readonly mode: EteAffectedSetMode;
  readonly affected_set: readonly string[];
  readonly formula_applicability: 'applicable' | 'partially_defined';
  readonly applicability_note?: string;
}

export interface EteAffectedSetInput {
  readonly incident: Incident;
  readonly affected_road: AffectedRoadStrategyResult;
  readonly selected_primary_evacuation?: string | null;
  readonly selected_secondary_evacuation?: readonly string[];
}

export interface EteAffectedSetStrategy {
  resolve(input: EteAffectedSetInput): EteAffectedSetResult;
}

/** A traffic reading eligible for exact common-snapshot selection. */
export interface EteTrafficReading {
  readonly road_id: string;
  /** Source timestamp in either supported official timestamp format. */
  readonly observation_timestamp: string;
  readonly saturation_score: number;
}

export interface CommonEteSnapshotSelectionInput {
  readonly affected_set: readonly string[];
  readonly event_timestamp: string;
  readonly traffic_readings: readonly EteTrafficReading[];
}

/** Preserve first appearance while removing duplicate or empty road IDs. */
export function stableUniqueRoadIds(
  roadIds: readonly (string | null | undefined)[],
): readonly string[] {
  const unique = new Set<string>();
  for (const roadId of roadIds) {
    if (roadId) unique.add(roadId);
  }
  return [...unique];
}

/**
 * HG-001 policy: incident road + selected primary + selected secondary roads.
 * BS-event contextual affected_road values are intentionally excluded.
 */
export const incidentPrimaryAndSelectedSecondary: EteAffectedSetStrategy = {
  resolve: ({ incident, selected_primary_evacuation, selected_secondary_evacuation = [] }) => {
    if (!incident.affected_segment.startsWith('RD_')) {
      return {
        mode: 'incident_primary_and_selected_secondary',
        affected_set: [],
        formula_applicability: 'partially_defined',
        applicability_note:
          'HG-001 excludes contextual affected_road values from BS-event ETE sets.',
      };
    }

    return {
      mode: 'incident_primary_and_selected_secondary',
      affected_set: stableUniqueRoadIds([
        incident.affected_segment,
        selected_primary_evacuation,
        ...selected_secondary_evacuation,
      ]),
      formula_applicability: 'applicable',
      applicability_note:
        'HG-001 organizer-guided set: incident road, selected primary, and selected secondary evacuation roads.',
    };
  },
};

/** Previous configurable mode: include direct RD_ incidents only. */
export const directlyAffectedRoadsAtEventSnapshot: EteAffectedSetStrategy = {
  resolve: ({ incident, affected_road }) => {
    if (incident.affected_segment.startsWith('RD_')) {
      return {
        mode: 'directly_affected_roads_at_event_snapshot',
        affected_set: [incident.affected_segment],
        formula_applicability: 'applicable',
      };
    }
    if (affected_road.include_in_ete_context && affected_road.affected_road !== null) {
      return {
        mode: 'directly_affected_roads_at_event_snapshot',
        affected_set: [affected_road.affected_road],
        formula_applicability: 'partially_defined',
        applicability_note: 'BS_ affected_road inclusion is a provisional Strategy B/C policy.',
      };
    }
    return {
      mode: 'directly_affected_roads_at_event_snapshot',
      affected_set: [],
      formula_applicability: 'partially_defined',
      applicability_note: 'No affected-road set is defined for this non-road event.',
    };
  },
};

/**
 * Select the latest timestamp at or before the event where every unique affected
 * road has an exact observation. Values at different timestamps are never mixed.
 */
export function selectLatestCommonExactSnapshot(
  input: CommonEteSnapshotSelectionInput,
): EteSnapshotProvenance {
  const eventTimestamp = normalizeTimestamp(input.event_timestamp);
  const affectedSet = stableUniqueRoadIds(input.affected_set);
  if (affectedSet.length === 0) return insufficientCommonSnapshot(eventTimestamp.timestamp_display);

  const readingsByRoad = new Map<string, Map<string, EteSnapshotRoadReading>>();
  const candidateTimestamps = new Set<string>();

  for (const reading of input.traffic_readings) {
    if (!affectedSet.includes(reading.road_id)) continue;
    const normalized = normalizeTimestamp(reading.observation_timestamp);
    if (normalized.timestamp_normalized > eventTimestamp.timestamp_normalized) continue;

    const byTimestamp =
      readingsByRoad.get(reading.road_id) ?? new Map<string, EteSnapshotRoadReading>();
    if (!byTimestamp.has(normalized.timestamp_display)) {
      byTimestamp.set(normalized.timestamp_display, {
        road_id: reading.road_id,
        observation_timestamp: normalized.timestamp_display,
        saturation_score: reading.saturation_score,
      });
    }
    readingsByRoad.set(reading.road_id, byTimestamp);
    candidateTimestamps.add(normalized.timestamp_display);
  }

  const latestFirst = [...candidateTimestamps].sort((left, right) => right.localeCompare(left));
  for (const timestamp of latestFirst) {
    const readings = affectedSet.map((roadId) => readingsByRoad.get(roadId)?.get(timestamp));
    if (readings.every((reading): reading is EteSnapshotRoadReading => reading !== undefined)) {
      return {
        selection_status: 'common_exact_snapshot',
        event_timestamp: eventTimestamp.timestamp_display,
        common_snapshot_timestamp: timestamp,
        readings,
      };
    }
  }

  return insufficientCommonSnapshot(eventTimestamp.timestamp_display);
}

function insufficientCommonSnapshot(eventTimestamp: string): EteSnapshotProvenance {
  return {
    selection_status: 'insufficient_common_snapshot',
    event_timestamp: eventTimestamp,
    common_snapshot_timestamp: null,
    readings: [],
  };
}
