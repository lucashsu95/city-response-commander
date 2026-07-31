/**
 * Recovery — strongly-consistent read-only recovery judgement.
 *
 * @module backend/recovery
 */

export { evaluateRecoveryGate, RecoveryGate, RecommendedRecoveryMode } from './recovery_gate.js';

export type { RecoveryGateResult, RecoveryGateInput, RecoveryGatePorts } from './recovery_gate.js';
