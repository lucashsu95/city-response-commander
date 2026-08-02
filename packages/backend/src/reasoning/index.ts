/**
 * @city-commander/reasoning — Deterministic reasoning trace builders
 *
 * Re-exported from backend so that the integrator (demo handler / acceptance layer)
 * can connect these helpers to their respective handlers.
 *
 * @packageDocumentation
 */

// ─── SOP Evidence / RagTrace ──────────────────────────────────
export {
  buildRagTrace,
  mapRetrieverType,
  buildRetrievalContext,
  type RetrieverType,
} from './sop_evidence.js';

// ─── ETE Calculation ─────────────────────────────────────────
export {
  computeEte,
  SOP7_FORMULA,
  SOP7_CONGESTION_PENALTY,
  BASE_CLEARANCE_TABLE,
  DEFAULT_TIMEZONE,
  type EteCalculationInputs,
} from './ete_calculator.js';

// ─── Route Reasoning ──────────────────────────────────────────
export {
  buildRouteReasoningTrace,
  evaluateRouteCandidate,
  type RouteReasoningTrace,
  type RouteReasoningEntry,
  type RouteSegmentEvidence,
} from './route_reasoning.js';
