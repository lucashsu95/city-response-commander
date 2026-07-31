/**
 * Decision — DecisionCore persistence, identity classification, and the
 * deterministic pipeline seam.
 *
 * @module backend/decision
 */

export { persistDecisionCore } from './decision_core_writer.js';
export type { PersistCoreOutcome } from './decision_core_writer.js';

export { classifyCoreIdentity, CORE_IDENTITY_FIELDS } from './identity_classifier.js';
export type { CoreIdentityClassification, CoreIdentityMismatch } from './identity_classifier.js';

export { DefaultDomainPipelineAdapter, PENDING_PIPELINE_STEPS } from './domain_pipeline_adapter.js';

export type {
  DomainPipelineAdapter,
  DomainPipelineInput,
  DomainPipelineResult,
  DomainPipelinePorts,
  PartialDecisionFacts,
  SegmentAlignmentDiagnostic,
  SnapshotAlignmentPort,
  IngestionPort,
  RuleEnginePort,
  TrafficRow,
  AlignedTrafficRow,
} from './domain_pipeline_adapter.js';

export { runDecisionFn, DecisionFn } from './decision_fn.js';

export type {
  DecisionFnInput,
  DecisionFnPorts,
  DecisionFnResult,
  DecisionCoreBuilderPort,
} from './decision_fn.js';
