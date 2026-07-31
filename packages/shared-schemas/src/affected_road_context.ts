/**
 * AffectedRoadContext — Strategy B (AffectedRoadStrategy) output (§10.9b, §11.2)
 *
 * Produced by `AffectedRoadStrategy.resolve(incident) -> AffectedRoadContext`
 * for incidents that carry an `affected_road` field (only EVT_002-style
 * incidents).
 *
 * Hard rules (never overridden by role or description text):
 * - BS_ events route to art.3 evaluation via `affected_segment`, NOT via
 *   `affected_road`.
 * - `affected_road` must NEVER directly trigger SOP art.1 or art.2,
 *   regardless of the configured role.
 * - `affected_road` never enters the ETE affected set, and never becomes
 *   a mandatory action, under the active `DISPLAY_AND_CONTEXT_ONLY` role.
 *
 * @module shared-schemas/affected_road_context
 */

import type { GuidanceId } from './hg001_literals.js';

/**
 * AffectedRoadContext — Strategy B role and derived context flags for
 * an incident's `affected_road`.
 *
 * Discriminated union on `role`. `DISPLAY_AND_CONTEXT_ONLY` is the only
 * role literal ever named by design.md; it is the active HG-001 default
 * and pins `mandatory_action` / `enters_ete_set` / `triggers_article1_or_2`
 * to the literal `false` (not merely `boolean`).
 *
 * The second branch exists only because design.md §10.6 documents future
 * "other non-selected modes" for `affected_road.role` without naming any
 * concrete literal. It is intentionally NOT constructible by any factory
 * today — no host guidance has resolved OQ-002's remaining scope — and is
 * kept open (`role: string`) rather than closed against a spec that
 * anticipates future variants.
 */
export type AffectedRoadContext =
  | {
      readonly role: 'DISPLAY_AND_CONTEXT_ONLY';
      /** @immutable-official the raw affected_road, or null when absent */
      readonly affected_road: string | null;
      /** @derived hard rule: DISPLAY_AND_CONTEXT_ONLY never creates a mandatory action */
      readonly mandatory_action: false;
      /** @derived hard rule: DISPLAY_AND_CONTEXT_ONLY never enters the ETE affected set */
      readonly enters_ete_set: false;
      /** @derived hard rule: affected_road never directly triggers art.1 or art.2 */
      readonly triggers_article1_or_2: false;
      /** @provenance always 'HG-001' */
      readonly guidance_id: GuidanceId;
    }
  | {
      /**
       * @unimplemented Future host-configured role, not yet named by any
       * organizer guidance. No factory produces this branch; it exists
       * only to keep the union open per design.md's documented but
       * unnamed "other non-selected modes" for `affected_road.role`.
       * Per §11.2, unselected modes remain configurable alternatives and
       * must never become the active default.
       */
      readonly role: string;
      readonly affected_road: string | null;
      readonly mandatory_action: boolean;
      readonly enters_ete_set: boolean;
      readonly triggers_article1_or_2: boolean;
      readonly guidance_id: GuidanceId | null;
    };

/**
 * Construct the active HG-001 `DISPLAY_AND_CONTEXT_ONLY` AffectedRoadContext.
 *
 * This is the constructor real code should use — it pins
 * `mandatory_action` / `enters_ete_set` / `triggers_article1_or_2` to
 * `false` and stamps `guidance_id` to `'HG-001'` automatically.
 */
export function displayAndContextOnlyAffectedRoadContext(
  affected_road: string | null,
): AffectedRoadContext {
  return {
    role: 'DISPLAY_AND_CONTEXT_ONLY',
    affected_road,
    mandatory_action: false,
    enters_ete_set: false,
    triggers_article1_or_2: false,
    guidance_id: 'HG-001',
  };
}
