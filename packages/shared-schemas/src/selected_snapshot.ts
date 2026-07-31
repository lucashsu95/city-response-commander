/**
 * SelectedSnapshot — Strategy A (TimeAlignmentStrategy) output (§10.5, §11.1)
 *
 * Produced by `TimeAlignmentStrategy.select(entity_id, event_timestamp)`.
 * Consumed by SnapshotSelector to resolve the per-entity data row used
 * for downstream calculations.
 *
 * Hard rule: selected_timestamp must NEVER be a post-event row — the
 * strategy only ever selects a row with timestamp <= event_timestamp
 * (exact match, or the latest prior row per entity).
 *
 * @module shared-schemas/selected_snapshot
 */

import type { RawTrafficRecord, RawCrowdRecord } from './raw-data.js';

/**
 * SelectedSnapshot — time-aligned data row for a single entity
 *
 * @provisional Strategy A (OQ-001), resolved for implementation by HG-001
 * default `exact_or_latest_prior_per_entity`, but remains configurable.
 */
export interface SelectedSnapshot {
  /** @derived RD_ or BS_ prefixed entity identifier */
  readonly entity_id: string;
  /** @derived the incident's event timestamp used as the alignment cutoff */
  readonly event_timestamp: string;
  /** @provisional timestamp of the row actually selected */
  readonly selected_timestamp: string;
  /** @provisional true when selected_timestamp === event_timestamp exactly */
  readonly exact_match: boolean;
  /** @provisional minutes between event_timestamp and selected_timestamp */
  readonly staleness_minutes: number;
  /** @provisional true when a prior row was carried forward (no exact match) */
  readonly carried_forward: boolean;
  /** @provisional the raw record the selection was made from */
  readonly source_record: RawTrafficRecord | RawCrowdRecord;
  /** @provisional resolved data sufficiency status */
  readonly data_status: 'fresh' | 'stale' | 'insufficient_data';
}
