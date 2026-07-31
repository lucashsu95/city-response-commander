/**
 * HTTP handlers — read-only GET endpoints (§12).
 *
 * @module backend/handlers
 */

export { resolveTraceId, requirePathParameter, ok, withErrorEnvelope } from './http_envelope.js';

export type { HttpGetEvent, HttpResult } from './http_envelope.js';

export {
  createGetDecisionHandler,
  DECISION_ID_PARAM,
  IDEMPOTENCY_KEY_QUERY,
} from './get_decision_handler.js';

export { createGetReportHandler, REPORT_DECISION_ID_PARAM } from './get_report_handler.js';

export type { GetReportResponseBody, ReportDeterministicFacts } from './get_report_handler.js';

export { createGetTimelineHandler } from './get_timeline_handler.js';
export { createGetRoadsHandler } from './get_roads_handler.js';
export { createGetCrowdHandler } from './get_crowd_handler.js';
export { createGetIncidentsHandler } from './get_incidents_handler.js';

export { queryTimeline, queryRoads, queryCrowd, queryIncidents } from './dashboard_query.js';

export type {
  DashboardPorts,
  DashboardIngestionPort,
  DashboardSnapshotPort,
  ResponseEnvelope,
  TimelineResponse,
  RoadsResponse,
  RoadSegmentView,
  CrowdResponse,
  CrowdStationView,
  StationFlag,
  IncidentsResponse,
} from './dashboard_query.js';
