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
import type { SelectionMode, GuidanceId } from './hg001_literals.js';

/**
 * SelectedSnapshot — time-aligned data row for a single entity
 *
 * @provisional Strategy A (OQ-001), resolved for implementation by HG-001
 * default `GLOBAL_AS_OF_EVENT_CUTOFF_LATEST_PRIOR_PER_ENTITY`, but remains
 * configurable.
 */
export interface SelectedSnapshot {
  /** @derived RD_ or BS_ prefixed entity identifier */
  readonly entity_id: string;
  /** @derived the incident's event timestamp used as the alignment cutoff */
  readonly event_timestamp: string;
  /** @derived the decision cutoff timestamp; no data after this may be used */
  readonly decision_cutoff_timestamp: string;
  /**
   * @provisional the timestamp of the row actually observed/selected.
   * MUST be `<= decision_cutoff_timestamp` (never future data).
   */
  readonly observation_timestamp: string;
  /**
   * Alias of observation_timestamp; MUST always equal it.
   *
   * @provisional kept for backward compatibility alongside
   * `observation_timestamp`.
   */
  readonly selected_timestamp: string;
  /** @provisional true when observation_timestamp === event_timestamp exactly */
  readonly exact_match: boolean;
  /** @provisional minutes between event_timestamp and observation_timestamp */
  readonly staleness_minutes: number;
  /**
   * @provisional Strategy A selection mode (organizer-guided configurable).
   */
  readonly selection_mode: SelectionMode;
  /** @derived the raw record the selection was made from */
  readonly source_record: RawTrafficRecord | RawCrowdRecord;
  /** @derived resolved data sufficiency status */
  readonly data_status: 'fresh' | 'stale' | 'INSUFFICIENT_DATA';
  /** @derived true when the resolved snapshot requires manual confirmation */
  readonly manual_confirmation_required: boolean;
  /** @provenance always 'HG-001' */
  readonly guidance_id: GuidanceId;
}

/**
 * Create a SelectedSnapshot, automatically stamping `guidance_id`.
 *
 * Enforces the §10.5 invariant `observation_timestamp <= decision_cutoff_timestamp`
 * at construction time — throws if violated (no future data, no future fallback).
 *
 * @param input - all SelectedSnapshot fields except `guidance_id`
 * @throws Error if observation_timestamp is after decision_cutoff_timestamp
 */
export function createSelectedSnapshot(
  input: Omit<SelectedSnapshot, 'guidance_id'>,
): SelectedSnapshot {
  if (new Date(input.observation_timestamp) > new Date(input.decision_cutoff_timestamp)) {
    throw new Error(
      `SelectedSnapshot invariant violated: observation_timestamp "${input.observation_timestamp}" ` +
        `is after decision_cutoff_timestamp "${input.decision_cutoff_timestamp}" (no future data allowed).`,
    );
  }

  return {
    ...input,
    guidance_id: 'HG-001',
  };
}
