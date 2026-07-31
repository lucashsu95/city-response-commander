/**
 * Decision — DecisionCore persistence and identity classification.
 *
 * @module backend/decision
 */

export { persistDecisionCore } from './decision_core_writer.js';
export type { PersistCoreOutcome } from './decision_core_writer.js';

export { classifyCoreIdentity, CORE_IDENTITY_FIELDS } from './identity_classifier.js';
export type { CoreIdentityClassification, CoreIdentityMismatch } from './identity_classifier.js';
