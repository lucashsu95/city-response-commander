/**
 * `GET /crowd` — station crowd data with SOP flags
 * (design §12, R8/R9/R11; TASK-150).
 *
 * Public read-only. Flags come from `evaluateArticle3` / `evaluateArticle4` and are
 * only produced for the stations the SOP names; every other station reports an
 * empty array, because there is no official rule to evaluate for it.
 *
 * Always `200` for a well-formed request; see `get_timeline_handler` for why a
 * `404` would be wrong here.
 *
 * @module backend/handlers/get_crowd_handler
 */

import { queryCrowd } from './dashboard_query.js';
import type { DashboardPorts } from './dashboard_query.js';
import { ok, resolveTraceId, withErrorEnvelope } from './http_envelope.js';
import type { HttpErrorResult, HttpGetEvent, HttpResult } from './http_envelope.js';

/** Build the `GET /crowd` handler. */
export function createGetCrowdHandler(
  ports: DashboardPorts,
): (event: HttpGetEvent) => Promise<HttpResult | HttpErrorResult> {
  return async (event: HttpGetEvent) => {
    const traceId = resolveTraceId(event);
    return withErrorEnvelope(traceId, async () => ok(queryCrowd(ports, traceId)));
  };
}
