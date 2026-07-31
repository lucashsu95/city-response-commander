/**
 * Backend repositories — DynamoDB data-access primitives.
 *
 * @module backend/repository
 */

export {
  IdempotencyRepository,
  createIdempotencyReader,
  normalizeIdempotencyRecord,
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

export { TableReadError, ReaderUsageError } from './read_errors.js';

export type { DecisionTableName } from './read_errors.js';

export { DecisionCoreReader } from './decision_core_reader.js';

export type { DecisionCoreReadPort, DecisionCoreReaderOptions } from './decision_core_reader.js';

export {
  DecisionCoreRepository,
  DecisionCoreAlreadyExistsError,
} from './decision_core_repository.js';

export type { DecisionCorePort } from './decision_core_repository.js';

export {
  DecisionNarrativeReader,
  REQUIRED_NARRATIVE_TYPES,
  splitNarrativeTypes,
} from './decision_narrative_reader.js';

export type {
  DecisionNarrativeReadPort,
  DecisionNarrativeReaderOptions,
} from './decision_narrative_reader.js';
