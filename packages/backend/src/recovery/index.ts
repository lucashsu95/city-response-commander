/**
 * Recovery — strongly-consistent read-only recovery judgement.
 *
 * @module backend/recovery
 */

export { evaluateRecoveryGate, RecoveryGate } from './recovery_gate.js';

export type {
  RecoveryGateResult,
  RecoveryGateInput,
  RecoveryGatePorts,
  RecommendedRecoveryMode,
} from './recovery_gate.js';

export {
  recoverMissingNarratives,
  EnrichmentRecoveryCoreMissingError,
  EnrichmentRecoveryWrongModeError,
} from './enrichment_recovery.js';

export type {
  EnrichmentRecoveryInput,
  EnrichmentRecoveryResult,
  NarrativeBranchOutcome,
} from './enrichment_recovery.js';
