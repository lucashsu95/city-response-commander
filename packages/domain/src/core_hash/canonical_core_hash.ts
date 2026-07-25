/** Canonical DecisionCore hashing (§10.11a-1). */

import { createHash } from 'node:crypto';
import type { DecisionCore } from '@city-commander/shared-schemas';

/** Additional execution metadata is accepted but cannot enter the allowlisted payload. */
export type CanonicalDecisionInput = Omit<DecisionCore, 'core_hash'> &
  Readonly<Record<string, unknown>>;

const SET_LIKE_ARRAY_KEYS = new Set([
  'triggered_articles',
  'applied_formula_articles',
  'invoked_procedures',
  'languages',
  'stations_in_scope',
  'classifications',
  'excluded_candidates',
]);

/** Build exactly the §10.11a-1 deterministic allowlist. */
export function canonicalDecisionPayload(input: CanonicalDecisionInput): Record<string, unknown> {
  return {
    decision_id: input.decision_id,
    idempotency_key: input.idempotency_key,
    source_manifest_hash: input.source_manifest_hash,
    schema_version: input.schema_version,
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
    provisional: input.provisional,
  };
}

/** Lexicographic object keys, compact JSON, normalized numbers, and stable set-like arrays. */
export function canonicalSerialize(value: unknown, fieldName?: string): string {
  return JSON.stringify(normalize(value, fieldName));
}

export function calculateCoreHash(input: CanonicalDecisionInput): string {
  return createHash('sha256')
    .update(canonicalSerialize(canonicalDecisionPayload(input)), 'utf8')
    .digest('hex');
}

function normalize(value: unknown, fieldName?: string): unknown {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value))
      throw new Error('Canonical payload cannot contain a non-finite number.');
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) {
    const normalized = value.map((item) => normalize(item));
    return fieldName !== undefined && SET_LIKE_ARRAY_KEYS.has(fieldName)
      ? [...normalized].sort(compareCanonicalValues)
      : normalized;
  }
  if (typeof value === 'object' && value !== null) {
    const object = value as Record<string, unknown>;
    return Object.fromEntries(
      Object.keys(object)
        .sort()
        .filter((key) => object[key] !== undefined)
        .map((key) => [key, normalize(object[key], key)]),
    );
  }
  throw new Error(`Canonical payload contains unsupported value type: ${typeof value}.`);
}

function compareCanonicalValues(left: unknown, right: unknown): number {
  const a = canonicalSerialize(left);
  const b = canonicalSerialize(right);
  return a < b ? -1 : a > b ? 1 : 0;
}
