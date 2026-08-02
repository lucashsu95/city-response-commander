/**
 * Evacuation Route View Selector (§10.8, §10.8a, R6/R13)
 *
 * TASK-130. Memoized decode of the route blocks held by the TASK-132 decision
 * controller, so `route_panel.tsx` stays presentational and the decode runs
 * once per core rather than once per render.
 *
 * @module frontend/decision/use_route_view
 */

import { useMemo } from 'react';
import type { DecisionCoreView } from './decision_read_model.js';
import { decodeRouteView } from './route_model.js';
import type { RouteDecodeError, RouteView } from './route_model.js';

/**
 * Outcome of decoding the route blocks.
 *
 * `absent` means there is no committed core at all (no decision yet, or
 * `data_status=insufficient_data`) — distinct from `error`, which means a core
 * exists but a route block is malformed. The latter is a contract breach the
 * panel must show instead of an empty route list, because an empty list reads
 * as "no candidate was excluded".
 */
export type RouteViewResult =
  | { readonly kind: 'absent' }
  | { readonly kind: 'ok'; readonly routes: RouteView }
  | { readonly kind: 'error'; readonly error: RouteDecodeError };

/** Decodes the route blocks, memoized on the core identity. */
export function useRouteView(core: DecisionCoreView | null): RouteViewResult {
  return useMemo(() => routeViewOf(core), [core]);
}

/** Non-hook form, for tests and non-React callers. */
export function routeViewOf(core: DecisionCoreView | null): RouteViewResult {
  if (core === null) return { kind: 'absent' };
  const decoded = decodeRouteView(core);
  return decoded.ok
    ? { kind: 'ok', routes: decoded.routes }
    : { kind: 'error', error: decoded.error };
}
