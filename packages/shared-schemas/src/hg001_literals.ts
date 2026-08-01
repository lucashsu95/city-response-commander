/**
 * HG-001 shared literal types
 *
 * Small shared module for literal types referenced by both
 * `selected_snapshot.ts` and `affected_road_context.ts`, avoiding
 * duplicate type definitions across the two HG-001 amendment contracts.
 *
 * @module shared-schemas/hg001_literals
 */

/**
 * Strategy A (OQ-001) time-alignment selection mode.
 *
 * Single-member union today (the only mode resolved for implementation
 * by HG-001); extensible later without breaking existing consumers as
 * design.md §10.6 anticipates "other non-selected modes".
 */
export type SelectionMode = 'GLOBAL_AS_OF_EVENT_CUTOFF_LATEST_PRIOR_PER_ENTITY';

/** HG-001 provenance marker, always this exact guidance id. */
export type GuidanceId = 'HG-001';
