/**
 * Injection — idempotency key derivation and lease ownership.
 *
 * @module backend/inject
 */

export {
  deriveIdempotencyKey,
  parseIdempotencyKey,
  deriveDecisionId,
  deriveInjectionIdentity,
  IdempotencyKeyError,
} from './idempotency_key.js';

export type { IdempotencyKeyParts } from './idempotency_key.js';

export { acquireFirstLease, buildFirstLeaseRecord } from './first_lease.js';

export type {
  AcquireFirstLeaseInput,
  AcquireFirstLeaseOutcome,
  InjectionClock,
  LeaseDurations,
} from './first_lease.js';
