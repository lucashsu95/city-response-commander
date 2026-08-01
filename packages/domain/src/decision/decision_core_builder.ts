/** Immutable DecisionCore assembly and canonical hashing. */

import type { DecisionCore } from '@city-commander/shared-schemas';
import {
  calculateCoreHash,
  type CanonicalDecisionInput,
} from '../core_hash/canonical_core_hash.js';

type ImmutableIncidentFacts = NonNullable<DecisionCore['event_facts']>;

export type DecisionCoreBuildInput = Omit<
  DecisionCore,
  'core_hash' | 'immutable_after_commit' | 'event_facts'
> & { readonly event_facts: ImmutableIncidentFacts };

/** Builds a detached, deeply frozen core and hashes only canonical decision facts. */
export function buildDecisionCore(input: DecisionCoreBuildInput): DecisionCore {
  if (input.triggered_articles.includes(7)) {
    throw new Error('Article 7 must never be included in triggered_articles.');
  }

  const detachedCore = structuredClone({
    decision_id: input.decision_id,
    idempotency_key: input.idempotency_key,
    injection_run_id: input.injection_run_id,
    workflow_execution_name: input.workflow_execution_name,
    version: input.version,
    source_manifest_hash: input.source_manifest_hash,
    immutable_after_commit: true as const,
    event_id: input.event_id,
    occurred_at: input.occurred_at,
    event_facts: input.event_facts,
    triggered_articles: input.triggered_articles,
    applied_formula_articles: input.applied_formula_articles,
    invoked_procedures: input.invoked_procedures,
    art1_measures: input.art1_measures,
    classifications: input.classifications,
    incident_anchor: input.incident_anchor,
    primary_evacuation: input.primary_evacuation,
    secondary_evacuation: input.secondary_evacuation,
    excluded_candidates: input.excluded_candidates,
    affected_intersection_scope: input.affected_intersection_scope,
    ete: input.ete,
    multilingual_required: input.multilingual_required,
    multilingual_scope: input.multilingual_scope,
    evidence: input.evidence,
    policy: input.policy,
    cms_core_text: input.cms_core_text,
    // UARE (spec: .kiro/specs/unified-adaptive-reasoning-engine/, R5 AC1/AC5).
    // Deliberately NOT added to canonicalDecisionPayload's §10.11a-1 hash
    // allowlist (canonical_core_hash.ts) — these are advisory/presentation
    // fields derived from triggered_articles (already hashed), not new
    // decision-identity facts, mirroring how injection_run_id/version/
    // workflow_execution_name are present on DecisionCore but excluded from
    // the hash.
    sop_matched: input.sop_matched,
    sop_authority: input.sop_authority,
    universal_principles: input.universal_principles,
    grounding_candidates: input.grounding_candidates,
    provisional: input.provisional,
    schema_version: input.schema_version,
  });
  const coreHash = calculateCoreHash(detachedCore as CanonicalDecisionInput);
  return deepFreeze({ ...detachedCore, core_hash: coreHash });
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object') return value;
  for (const nestedValue of Object.values(value)) deepFreeze(nestedValue);
  Object.freeze(value);
  return value;
}
