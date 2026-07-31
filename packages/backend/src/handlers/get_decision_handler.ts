/**
 * `GET /decisions/{decision_id}` — the DecisionReadModel endpoint
 * (design §12, §10.11c; TASK-150).
 *
 * Public read-only. Returns the four-source merge: DecisionCore (authoritative
 * numbers) + DecisionNarrative + PublishRecord + the read-only `execution`
 * projection (FIX 1).
 *
 * Status codes are deliberately narrow:
 *  - `200` whenever the request itself was well-formed — including when no core
 *    is committed. That case carries `data_status=insufficient_data` (§12, §21).
 *    A `404` would be wrong: `decision_id` is deterministically derived from the
 *    idempotency key (TASK-086), so "not committed yet" is a lifecycle state, not
 *    a missing resource, and the Dashboard polls this endpoint precisely to watch
 *    that state change.
 *  - `400` for a missing path parameter.
 *  - `429` / `500` for downstream faults, never downgraded to "no data".
 *
 * @module backend/handlers/get_decision_handler
 */

import { aggregateDecisionReadModel } from '../read_model/read_model_aggregator.js';
import type { ReadModelPorts } from '../read_model/read_model_aggregator.js';
import { ok, requirePathParameter, resolveTraceId, withErrorEnvelope } from './http_envelope.js';
import type { HttpErrorResult, HttpGetEvent, HttpResult } from './http_envelope.js';

/** Path parameter name, matching the §12 route `/decisions/{decision_id}`. */
export const DECISION_ID_PARAM = 'decision_id';

/**
 * Optional query parameter carrying the idempotency key.
 *
 * The key is not derivable from `decision_id` (derivation runs the other way), so
 * the `execution` projection is only included when the caller supplies it. Absent
 * ⇒ `execution: null`, never a guessed key.
 */
export const IDEMPOTENCY_KEY_QUERY = 'idempotency_key';

/**
 * Build the `GET /decisions/{decision_id}` handler.
 *
 * @example
 * ```ts
 * export const handler = createGetDecisionHandler({
 *   decisionCore: coreReader,
 *   decisionNarrative: narrativeReader,
 *   publishRecord: publishReader,
 *   idempotency: createIdempotencyReader({ tableName }),
 * });
 * ```
 */
export function createGetDecisionHandler(
  ports: ReadModelPorts,
): (event: HttpGetEvent) => Promise<HttpResult | HttpErrorResult> {
  return async (event: HttpGetEvent) => {
    const traceId = resolveTraceId(event);

    return withErrorEnvelope(traceId, async () => {
      const decisionId = requirePathParameter(event, DECISION_ID_PARAM, traceId);
      const idempotencyKey = event.queryStringParameters?.[IDEMPOTENCY_KEY_QUERY]?.trim();

      const model = await aggregateDecisionReadModel(ports, {
        decisionId,
        traceId,
        ...(idempotencyKey ? { idempotencyKey } : {}),
      });

      // 200 even for insufficient_data: disclosure, not fabrication and not 404.
      return ok(model);
    });
  };
}
