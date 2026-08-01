/**
 * LLM-prohibited DecisionCore fields — canonical source (§9 boundary).
 *
 * `packages/rag/src/schema_validator.ts` imports this directly for runtime
 * enforcement. `eslint-local-rules.cjs` (repo-root, lint-time CJS, outside
 * any package's build output) cannot import this ESM package without a
 * build step, so it keeps its own literal copy; `eslint-local-rules/test/
 * prohibited-fields-sync.test.ts` asserts the two stay identical.
 *
 * Typed against `keyof DecisionCore` so a field rename fails the build
 * instead of silently drifting.
 */

import type { DecisionCore } from './decision_core.js';

/** Typed against `keyof DecisionCore` — a field rename fails the build here first. */
const PROHIBITED_KEYS: readonly (keyof DecisionCore)[] = [
  'decision_id',
  'idempotency_key',
  'core_hash',
  'source_manifest_hash',
  'immutable_after_commit',
  'event_id',
  'occurred_at',
  'event_facts',
  'triggered_articles',
  'applied_formula_articles',
  'invoked_procedures',
  'art1_measures',
  'classifications',
  'incident_anchor',
  'primary_evacuation',
  'secondary_evacuation',
  'excluded_candidates',
  'affected_intersection_scope',
  'ete',
  'multilingual_required',
  'multilingual_scope',
  'evidence',
  'policy',
  'cms_core_text',
  'sop_matched',
  'sop_authority',
  'universal_principles',
  'grounding_candidates',
  'pre_warning_segments',
  'signal_conflicts',
  'cascading_risk',
  'self_blocked_exclusions',
  'provisional',
  'schema_version',
];

/** Widened to `ReadonlySet<string>` so callers can check arbitrary (untrusted) payload keys. */
export const LLM_PROHIBITED_FIELDS: ReadonlySet<string> = new Set(PROHIBITED_KEYS);
