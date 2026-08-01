/**
 * EvidenceTrace View Selector (§10.10, R15)
 *
 * TASK-129. Memoized decode of the `core.evidence` block held by the TASK-132
 * decision controller, so `explanation_chain.tsx` stays presentational and the
 * decode runs once per core rather than once per render.
 *
 * @module frontend/decision/use_evidence_view
 */

import { useMemo } from 'react';
import type { DecisionCoreView } from './decision_read_model.js';
import { decodeEvidenceTrace } from './evidence_model.js';
import type { EvidenceDecodeError, EvidenceTraceView } from './evidence_model.js';

/**
 * Outcome of decoding the evidence block.
 *
 * `absent` means there is no committed core at all (no decision yet, or
 * `data_status=insufficient_data`) — distinct from `error`, which means a core
 * exists but its mandatory `evidence` block is missing or malformed. R15 makes
 * the explanation chain mandatory, so the latter is a contract breach the panel
 * must show rather than an empty reasoning list.
 */
export type EvidenceViewResult =
  | { readonly kind: 'absent' }
  | { readonly kind: 'ok'; readonly evidence: EvidenceTraceView }
  | { readonly kind: 'error'; readonly error: EvidenceDecodeError };

/** Decodes `core.evidence`, memoized on the core identity. */
export function useEvidenceView(core: DecisionCoreView | null): EvidenceViewResult {
  return useMemo(() => evidenceViewOf(core), [core]);
}

/** Non-hook form, for tests and non-React callers. */
export function evidenceViewOf(core: DecisionCoreView | null): EvidenceViewResult {
  if (core === null) return { kind: 'absent' };
  const decoded = decodeEvidenceTrace(core.fields['evidence']);
  return decoded.ok
    ? { kind: 'ok', evidence: decoded.evidence }
    : { kind: 'error', error: decoded.error };
}
