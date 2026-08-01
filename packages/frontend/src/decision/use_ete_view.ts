/**
 * ETE View Selector (§10.9, R12)
 *
 * TASK-131. Memoized decode of the `core.ete` block held by the TASK-132
 * decision controller, so `ete_panel.tsx` stays presentational and the decode
 * runs once per core rather than once per render.
 *
 * @module frontend/decision/use_ete_view
 */

import { useMemo } from 'react';
import type { DecisionCoreView } from './decision_read_model.js';
import { decodeEte } from './ete_model.js';
import type { EteDecodeError, EteView } from './ete_model.js';

/**
 * Outcome of decoding the ETE block.
 *
 * Three outcomes, kept apart because they mean different things to a commander:
 * - `absent` — no committed core at all (no decision yet, or
 *   `data_status=insufficient_data`)
 * - `not_applicable` — a core exists but carries no `ete` block. ETE does not
 *   apply to every event (a BS_ crowd event has none), so this is a normal
 *   state, not a failure — and never a zero.
 * - `error` — an `ete` block exists but is malformed: a contract breach the
 *   panel must show rather than rendering a blank calculation basis.
 */
export type EteViewResult =
  | { readonly kind: 'absent' }
  | { readonly kind: 'not_applicable' }
  | { readonly kind: 'ok'; readonly ete: EteView }
  | { readonly kind: 'error'; readonly error: EteDecodeError };

/** Decodes `core.ete`, memoized on the core identity. */
export function useEteView(core: DecisionCoreView | null): EteViewResult {
  return useMemo(() => eteViewOf(core), [core]);
}

/** Non-hook form, for tests and non-React callers. */
export function eteViewOf(core: DecisionCoreView | null): EteViewResult {
  if (core === null) return { kind: 'absent' };

  const raw = core.fields['ete'];
  if (raw === null || raw === undefined) return { kind: 'not_applicable' };

  const decoded = decodeEte(raw);
  return decoded.ok ? { kind: 'ok', ete: decoded.ete } : { kind: 'error', error: decoded.error };
}
