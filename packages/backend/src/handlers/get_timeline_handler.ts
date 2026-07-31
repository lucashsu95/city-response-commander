/**
 * `GET /timeline` — official replay positions (design §12, R1.5/R4.1; TASK-150).
 *
 * Public read-only. Always `200` when the request is well-formed: an empty or
 * unverified source set returns `data_status=insufficient_data` with an empty
 * `timestamps` array, not a `404`. There is no resource to be missing — the route
 * describes the dataset, and "the STOP gate failed" is a state the Dashboard needs
 * to render, not an error to swallow (§12, §21).
 *
 * @module backend/handlers/get_timeline_handler
 */

import { queryTimeline } from './dashboard_query.js';
import type { DashboardPorts } from './dashboard_query.js';
import { ok, resolveTraceId, withErrorEnvelope } from './http_envelope.js';
import type { HttpErrorResult, HttpGetEvent, HttpResult } from './http_envelope.js';

/** Build the `GET /timeline` handler. */
export function createGetTimelineHandler(
  ports: DashboardPorts,
): (event: HttpGetEvent) => Promise<HttpResult | HttpErrorResult> {
  return async (event: HttpGetEvent) => {
    const traceId = resolveTraceId(event);
    return withErrorEnvelope(traceId, async () => ok(queryTimeline(ports, traceId)));
  };
}
