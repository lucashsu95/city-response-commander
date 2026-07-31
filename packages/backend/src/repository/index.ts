/**
 * Backend repositories — DynamoDB data-access primitives.
 *
 * @module backend/repository
 */

export {
  IdempotencyRepository,
  createIdempotencyReader,
  IdempotencyRepositoryError,
  IdempotencyConditionFailedError,
  IdempotencyUsageError,
} from './idempotency_repository.js';

export type {
  IdempotencyReader,
  IdempotencyRepositoryOptions,
  IdempotencyGuard,
  IdempotencyMutation,
  IdempotencyMutableFields,
  ClearableIdempotencyField,
  ConditionalUpdateStateInput,
  IdempotencyOperation,
} from './idempotency_repository.js';
