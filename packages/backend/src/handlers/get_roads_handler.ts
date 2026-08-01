/**
 * `GET /roads` — segment traffic with A/B grading (design §12, R2/R4.3; TASK-150).
 *
 * Public read-only. Grading is delegated to `classifySegments`; this handler owns
 * no threshold. A segment with no legal row at the replay position reports
 * `Saturation_Score: null` and `level: null` — a visible gap rather than a
 * fabricated grade the operator might act on (§21).
 *
 * Always `200` for a well-formed request; see `get_timeline_handler` for why a
 * `404` would be wrong here.
 *
 * @module backend/handlers/get_roads_handler
 */

import { queryRoads } from './dashboard_query.js';
import type { DashboardPorts } from './dashboard_query.js';
import { ok, resolveTraceId, withErrorEnvelope } from './http_envelope.js';
import type { HttpErrorResult, HttpGetEvent, HttpResult } from './http_envelope.js';

/** Build the `GET /roads` handler. */
export function createGetRoadsHandler(
  ports: DashboardPorts,
): (event: HttpGetEvent) => Promise<HttpResult | HttpErrorResult> {
  return async (event: HttpGetEvent) => {
    const traceId = resolveTraceId(event);
    return withErrorEnvelope(traceId, async () => ok(queryRoads(ports, traceId)));
  };
}
