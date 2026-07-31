/**
 * Shared HTTP plumbing for the read-only GET handlers (design §12; TASK-150).
 *
 * API Gateway HTTP API payload format 2.0. Every handler follows the same shape:
 * extract and validate the path parameter, aggregate, respond `200`. Errors go
 * through `toHttpErrorResult` so the status code always comes from the single
 * mapping table in TASK-156 and no handler picks one by hand.
 *
 * @module backend/handlers/http_envelope
 */

import { ValidationError, mapToDomainError, toHttpErrorResult } from '../errors/index.js';
import type { HttpErrorResult } from '../errors/index.js';

export type { HttpErrorResult };

/** The slice of an API Gateway HTTP API v2 event these handlers read. */
export interface HttpGetEvent {
  readonly pathParameters?: Record<string, string | undefined> | null;
  readonly queryStringParameters?: Record<string, string | undefined> | null;
  readonly requestContext?: {
    readonly requestId?: string;
  };
}

/** API Gateway proxy response. */
export interface HttpResult {
  readonly statusCode: number;
  readonly headers: Record<string, string>;
  readonly body: string;
}

/**
 * Correlation id for the response envelope and the structured log.
 *
 * Falls back to a synthetic value rather than an empty string: a response
 * without a `trace_id` cannot be correlated to its log line (§19), which is
 * exactly when correlation matters most.
 */
export function resolveTraceId(event: HttpGetEvent): string {
  return event.requestContext?.requestId ?? `trace-unavailable-${String(Date.now())}`;
}

/**
 * Read a required path parameter.
 *
 * @throws ValidationError → `400` when missing or blank
 */
export function requirePathParameter(event: HttpGetEvent, name: string, traceId: string): string {
  const value = event.pathParameters?.[name]?.trim();
  if (!value) {
    throw new ValidationError(`Missing required path parameter "${name}".`, { traceId });
  }
  return value;
}

/** `200 OK` with a JSON body. */
export function ok(body: unknown): HttpResult {
  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  };
}

/**
 * Run a handler body, converting any failure into the unified §12 error envelope.
 *
 * Insufficient data is deliberately NOT routed here: it is a `200` carrying
 * `data_status`, not an error (§12, §21).
 */
export async function withErrorEnvelope(
  traceId: string,
  handler: () => Promise<HttpResult>,
): Promise<HttpResult | HttpErrorResult> {
  try {
    return await handler();
  } catch (error: unknown) {
    return toHttpErrorResult(mapToDomainError(error, { traceId }), traceId);
  }
}
