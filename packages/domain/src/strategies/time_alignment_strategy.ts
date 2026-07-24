/**
 * TimeAlignmentStrategy (Strategy A) — Event Time Alignment
 *
 * Select the per-entity data row aligned to an event timestamp using a
 * pluggable time-alignment strategy, never using post-event rows as the
 * primary basis (§11.1, R1.5).
 *
 * Modes (config-driven via `policy.time_alignment.mode`):
 * - `exact_or_latest_prior_per_entity` (default): Select exact match or
 *   latest row with Timestamp <= event; if staleness > max_staleness_minutes
 *   → insufficient_data.
 * - `last_known_value_with_visible_staleness`: Same logic but always returns
 *   the row with a staleness_minutes flag visible (no insufficient_data cutoff).
 *
 * OQ-001 — PROVISIONAL_TEAM_POLICY / AWAITING_HOST_REPLY
 *
 * @module domain/strategies/time_alignment_strategy
 */

/**
 * TimeAlignmentMode — strategy mode enum.
 * Matches the config schema's `policy.time_alignment.mode` allowed values.
 * Sourced from: packages/config/src/config_schema.ts (TimeAlignmentModes)
 */
export type TimeAlignmentMode =
  | 'exact_or_latest_prior_per_entity'
  | 'last_known_value_with_visible_staleness';

// ─── Types ─────────────────────────────────────────────────

/** The status of a selected snapshot */
export type SnapshotDataStatus = 'ready' | 'insufficient_data';

/** Result of snapshot selection for a given entity at an event timestamp */
export interface SelectedSnapshot<T> {
  /** The selected record, or null when insufficient_data */
  readonly record: T | null;
  /** Whether the selected row's timestamp exactly matches the event timestamp */
  readonly exact_match: boolean;
  /** Minutes of staleness (0 for exact match) */
  readonly staleness_minutes: number;
  /** Status indicating whether data is ready or insufficient */
  readonly data_status: SnapshotDataStatus;
}

/** A timestamped record that can be selected by the strategy */
export interface TimestampedRecord {
  /** The normalized timestamp (Date) for comparison */
  readonly timestamp_normalized: Date;
}

/** Configuration for the TimeAlignmentStrategy */
export interface TimeAlignmentConfig {
  /** Strategy mode from config */
  readonly mode: TimeAlignmentMode;
  /** Maximum staleness in minutes before declaring insufficient_data (for default mode) */
  readonly max_staleness_minutes: number;
}

// ─── Strategy Interface ────────────────────────────────────

/**
 * TimeAlignmentStrategy — selects the appropriate data row for a given entity
 * aligned to an event timestamp.
 */
export interface TimeAlignmentStrategy {
  /**
   * Select the best snapshot for a given entity at the event timestamp.
   *
   * @param entity_id - The entity identifier (e.g., "RD_TPE_002" or "BS_MRT_BL17")
   * @param event_timestamp - The event's normalized timestamp
   * @param records - All records for this entity, each carrying a `timestamp_normalized`
   * @param config - The time alignment configuration
   * @returns SelectedSnapshot with the chosen record or insufficient_data
   */
  select<T extends TimestampedRecord>(
    entity_id: string,
    event_timestamp: Date,
    records: readonly T[],
    config: TimeAlignmentConfig,
  ): SelectedSnapshot<T>;
}

// ─── Default Implementation: exact_or_latest_prior_per_entity ───

/**
 * Default mode: Select exact row or latest row with Timestamp <= event_timestamp
 * per entity. If staleness exceeds max_staleness_minutes, return insufficient_data.
 *
 * Same station's User_Count/Growth_Rate/Roaming from the same row (guaranteed
 * because we return the entire record).
 */
export const exactOrLatestPriorPerEntity: TimeAlignmentStrategy = {
  select<T extends TimestampedRecord>(
    _entity_id: string,
    event_timestamp: Date,
    records: readonly T[],
    config: TimeAlignmentConfig,
  ): SelectedSnapshot<T> {
    const eventMs = event_timestamp.getTime();

    // Filter to rows with timestamp <= event_timestamp (never post-event)
    let bestRecord: T | null = null;
    let bestTimestampMs = -Infinity;

    for (const record of records) {
      const recordMs = record.timestamp_normalized.getTime();
      if (recordMs <= eventMs && recordMs > bestTimestampMs) {
        bestRecord = record;
        bestTimestampMs = recordMs;
      }
    }

    // No legal row found
    if (bestRecord === null) {
      return {
        record: null,
        exact_match: false,
        staleness_minutes: Infinity,
        data_status: 'insufficient_data',
      };
    }

    const exact_match = bestTimestampMs === eventMs;
    const staleness_minutes = exact_match
      ? 0
      : Math.round((eventMs - bestTimestampMs) / 60_000);

    // Check staleness against configured threshold
    if (staleness_minutes > config.max_staleness_minutes) {
      return {
        record: null,
        exact_match: false,
        staleness_minutes,
        data_status: 'insufficient_data',
      };
    }

    return {
      record: bestRecord,
      exact_match,
      staleness_minutes,
      data_status: 'ready',
    };
  },
};

// ─── Alternative Implementation: last_known_value_with_visible_staleness ───

/**
 * Alternative mode: Same logic as default but always returns the row with
 * a staleness_minutes flag visible — no insufficient_data cutoff based on
 * max_staleness_minutes. Returns insufficient_data ONLY when no legal row exists.
 */
export const lastKnownValueWithVisibleStaleness: TimeAlignmentStrategy = {
  select<T extends TimestampedRecord>(
    _entity_id: string,
    event_timestamp: Date,
    records: readonly T[],
    _config: TimeAlignmentConfig,
  ): SelectedSnapshot<T> {
    const eventMs = event_timestamp.getTime();

    // Filter to rows with timestamp <= event_timestamp (never post-event)
    let bestRecord: T | null = null;
    let bestTimestampMs = -Infinity;

    for (const record of records) {
      const recordMs = record.timestamp_normalized.getTime();
      if (recordMs <= eventMs && recordMs > bestTimestampMs) {
        bestRecord = record;
        bestTimestampMs = recordMs;
      }
    }

    // No legal row found at all
    if (bestRecord === null) {
      return {
        record: null,
        exact_match: false,
        staleness_minutes: Infinity,
        data_status: 'insufficient_data',
      };
    }

    const exact_match = bestTimestampMs === eventMs;
    const staleness_minutes = exact_match
      ? 0
      : Math.round((eventMs - bestTimestampMs) / 60_000);

    // Always return the record with visible staleness — never cut off
    return {
      record: bestRecord,
      exact_match,
      staleness_minutes,
      data_status: 'ready',
    };
  },
};

// ─── Strategy Resolver ─────────────────────────────────────

/**
 * Resolve the TimeAlignmentStrategy implementation from the configured mode.
 *
 * @param mode - The time alignment mode from config
 * @returns The appropriate strategy implementation
 */
export function resolveTimeAlignmentStrategy(mode: TimeAlignmentMode): TimeAlignmentStrategy {
  switch (mode) {
    case 'exact_or_latest_prior_per_entity':
      return exactOrLatestPriorPerEntity;
    case 'last_known_value_with_visible_staleness':
      return lastKnownValueWithVisibleStaleness;
    default: {
      // Exhaustive check — should never happen with valid config
      const _exhaustive: never = mode;
      throw new Error(`Unknown time alignment mode: ${mode}`);
    }
  }
}
