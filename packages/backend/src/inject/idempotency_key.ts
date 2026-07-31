/**
 * Idempotency key and decision id derivation (design §12, §15.2; TASK-086).
 *
 * `idempotency_key = event_id|event_timestamp|policy_version` (§10.11e).
 *
 * All three parts matter:
 *  - `event_id` scopes the key to one official incident.
 *  - `event_timestamp` is used VERBATIM, never normalized. The official value is
 *    immutable (`timestamp_raw`, §10.1), and rewriting it here would change the
 *    key and defeat dedup for the same event.
 *  - `policy_version` is part of the identity on purpose: switching a provisional
 *    Strategy (A–F) produces a different decision, so it must produce a
 *    different key rather than colliding with the previous policy's decision.
 *
 * `decision_id` is DETERMINISTICALLY derived from the key (§10.11a: "決定性推導").
 * Determinism is not cosmetic — if the IdempotencyTable record expires by TTL
 * while the DecisionCore row survives, a re-injection of the same event must map
 * to the SAME `decision_id` so the core's conditional Put resolves to
 * `ALREADY_COMMITTED_SAME_DECISION` instead of writing a second core for the
 * same incident.
 *
 * @module backend/inject/idempotency_key
 */

import { createHash } from 'node:crypto';

/** Separator between the three key parts. */
const KEY_SEPARATOR = '|';

/** Hex characters of the key digest carried in `decision_id`. */
const DECISION_ID_DIGEST_LENGTH = 12;

/** The three parts of an idempotency key. */
export interface IdempotencyKeyParts {
  /** `Incident.event_id`, e.g. `TPE_2026_ACC_001`. */
  readonly eventId: string;
  /** `Incident.timestamp` VERBATIM, e.g. `2026-05-20 22:10`. Never normalized. */
  readonly eventTimestamp: string;
  /** Active policy version; a policy switch must change the key. */
  readonly policyVersion: string;
}

/** A key part was empty or contained the reserved separator. */
export class IdempotencyKeyError extends Error {
  constructor(
    message: string,
    public readonly part: keyof IdempotencyKeyParts,
    public readonly value: string,
  ) {
    super(message);
    this.name = 'IdempotencyKeyError';
  }
}

function assertPart(part: keyof IdempotencyKeyParts, value: string): void {
  if (value.length === 0) {
    throw new IdempotencyKeyError(`Idempotency key part "${part}" must not be empty.`, part, value);
  }
  if (value.includes(KEY_SEPARATOR)) {
    // Without this, ("a|b", "c") and ("a", "b|c") would collapse to one key and
    // two different events would silently share a decision.
    throw new IdempotencyKeyError(
      `Idempotency key part "${part}" must not contain "${KEY_SEPARATOR}": got "${value}".`,
      part,
      value,
    );
  }
}

/**
 * Build `event_id|event_timestamp|policy_version`.
 *
 * @throws IdempotencyKeyError when a part is empty or contains `|`
 *
 * @example
 * ```ts
 * deriveIdempotencyKey({
 *   eventId: 'TPE_2026_ACC_001',
 *   eventTimestamp: '2026-05-20 22:10',
 *   policyVersion: 'prov-2026a',
 * });
 * // 'TPE_2026_ACC_001|2026-05-20 22:10|prov-2026a'
 * ```
 */
export function deriveIdempotencyKey(parts: IdempotencyKeyParts): string {
  assertPart('eventId', parts.eventId);
  assertPart('eventTimestamp', parts.eventTimestamp);
  assertPart('policyVersion', parts.policyVersion);

  return [parts.eventId, parts.eventTimestamp, parts.policyVersion].join(KEY_SEPARATOR);
}

/** Split a key back into its parts. Returns `null` when the shape is wrong. */
export function parseIdempotencyKey(idempotencyKey: string): IdempotencyKeyParts | null {
  const segments = idempotencyKey.split(KEY_SEPARATOR);
  if (segments.length !== 3) return null;
  const [eventId, eventTimestamp, policyVersion] = segments;
  if (!eventId || !eventTimestamp || !policyVersion) return null;
  return { eventId, eventTimestamp, policyVersion };
}

/**
 * Derive the `decision_id` for a key. Same key always yields the same id.
 *
 * Shape: `DEC_{event_id}_{12 hex chars of SHA-256(idempotency_key)}` — readable
 * on the Dashboard while still keyed to the full triple, so two events that
 * share an `event_id` but differ in timestamp or policy version get distinct ids.
 *
 * @throws IdempotencyKeyError when the key is not a well-formed triple
 */
export function deriveDecisionId(idempotencyKey: string): string {
  const parts = parseIdempotencyKey(idempotencyKey);
  if (parts === null) {
    throw new IdempotencyKeyError(
      `Cannot derive decision_id: "${idempotencyKey}" is not "event_id${KEY_SEPARATOR}event_timestamp${KEY_SEPARATOR}policy_version".`,
      'eventId',
      idempotencyKey,
    );
  }

  const digest = createHash('sha256')
    .update(idempotencyKey, 'utf8')
    .digest('hex')
    .slice(0, DECISION_ID_DIGEST_LENGTH);

  return `DEC_${parts.eventId}_${digest}`;
}

/** Derive both identifiers in one step. */
export function deriveInjectionIdentity(parts: IdempotencyKeyParts): {
  readonly idempotencyKey: string;
  readonly decisionId: string;
} {
  const idempotencyKey = deriveIdempotencyKey(parts);
  return { idempotencyKey, decisionId: deriveDecisionId(idempotencyKey) };
}
