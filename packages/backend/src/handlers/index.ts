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
