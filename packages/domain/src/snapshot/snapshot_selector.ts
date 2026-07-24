/**
 * SnapshotSelector — Selects per-entity data rows aligned to an event timestamp
 *
 * Uses the pluggable TimeAlignmentStrategy (Strategy A) to select the best
 * data row for each entity, reading mode/threshold from ConfigProvider's
 * `policy.time_alignment.*` keys.
 *
 * Never uses post-event rows as the primary basis.
 * Mode is config-driven (§11.1, R1.5).
 *
 * @module domain/snapshot/snapshot_selector
 */

import type {
  SelectedSnapshot,
  TimestampedRecord,
  TimeAlignmentConfig,
  TimeAlignmentMode,
} from '../strategies/time_alignment_strategy.js';
import { resolveTimeAlignmentStrategy } from '../strategies/time_alignment_strategy.js';

// Re-export for consumer convenience
export type { SelectedSnapshot, TimestampedRecord, TimeAlignmentConfig, TimeAlignmentMode };

// ─── Config Access Interface ───────────────────────────────

/**
 * Minimal config interface needed by SnapshotSelector.
 * Compatible with the full ConfigProvider from @city-commander/config.
 */
export interface SnapshotSelectorConfigProvider {
  get(key: string): string | number | boolean | readonly string[];
}

// ─── SnapshotSelector ──────────────────────────────────────

/**
 * SnapshotSelector — facade that reads configuration and delegates
 * to the appropriate TimeAlignmentStrategy implementation.
 */
export class SnapshotSelector {
  private readonly config: TimeAlignmentConfig;

  /**
   * Create a SnapshotSelector with configuration from ConfigProvider.
   *
   * @param configProvider - The configuration provider (reads `policy.time_alignment.*`)
   */
  constructor(configProvider: SnapshotSelectorConfigProvider) {
    const mode = configProvider.get('policy.time_alignment.mode') as TimeAlignmentMode;
    const maxStalenessMinutes = configProvider.get(
      'policy.time_alignment.max_staleness_minutes',
    ) as number;

    this.config = {
      mode,
      max_staleness_minutes: maxStalenessMinutes,
    };
  }

  /**
   * Select the aligned snapshot for a given entity at an event timestamp.
   *
   * @param entity_id - The entity identifier (e.g., "RD_TPE_002" for traffic, "BS_MRT_BL17" for crowd)
   * @param event_timestamp - The event's normalized timestamp (Date)
   * @param records - All records for this entity, each having a `timestamp_normalized` property
   * @returns SelectedSnapshot with the chosen record or insufficient_data
   */
  select<T extends TimestampedRecord>(
    entity_id: string,
    event_timestamp: Date,
    records: readonly T[],
  ): SelectedSnapshot<T> {
    const strategy = resolveTimeAlignmentStrategy(this.config.mode);
    return strategy.select(entity_id, event_timestamp, records, this.config);
  }

  /**
   * Get the current time alignment configuration (for diagnostics/metadata).
   */
  getConfig(): Readonly<TimeAlignmentConfig> {
    return this.config;
  }
}
