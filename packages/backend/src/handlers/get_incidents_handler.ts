/**
 * `GET /incidents` — the official incident list (design §12, R5.1; TASK-150).
 *
 * Public read-only. Returns `live_incidents.json` as ingested, after the
 * source-hash STOP gate. Incidents are passed through unmodified: they are official
 * input, and this endpoint is not the place to enrich or reinterpret them.
 *
 * Always `200` for a well-formed request; see `get_timeline_handler` for why a
 * `404` would be wrong here.
 *
 * @module backend/handlers/get_incidents_handler
 */

import { queryIncidents } from './dashboard_query.js';
import type { DashboardPorts } from './dashboard_query.js';
import { ok, resolveTraceId, withErrorEnvelope } from './http_envelope.js';
import type { HttpErrorResult, HttpGetEvent, HttpResult } from './http_envelope.js';

/** Build the `GET /incidents` handler. */
export function createGetIncidentsHandler(
  ports: DashboardPorts,
): (event: HttpGetEvent) => Promise<HttpResult | HttpErrorResult> {
  return async (event: HttpGetEvent) => {
    const traceId = resolveTraceId(event);
    return withErrorEnvelope(traceId, async () => ok(queryIncidents(ports, traceId)));
  };
}
