/**
 * Read model — four-source aggregation for the GET API.
 *
 * @module backend/read_model
 */

export {
  aggregateDecisionReadModel,
  DecisionReadModelAggregator,
} from './read_model_aggregator.js';

export type {
  DecisionReadModel,
  ReadModelDataStatus,
  ReadModelPorts,
  ReadModelInput,
  ExecutionSummary,
} from './read_model_aggregator.js';
