/**
 * Realtime Transport Envelope (§13)
 *
 * Safe transport-level parsing for WebSocket frames. This module identifies
 * *only* the minimum envelope needed to route a frame to its §13 polling
 * fallback and to hand the frame to subscribers:
 *
 *   - event type (discriminant)
 *   - decision_id / event_id when supplied
 *   - occurred_at when supplied
 *   - ready_event_id when supplied
 *
 * Everything else stays untouched as read-only `unknown` payload data. No
 * domain truth is interpreted, recomputed, or defaulted here, and no canonical
 * shared-schema type is duplicated.
 *
 * TASK-123 boundary: `ready_event_id` is preserved as received transport data
 * only. This module performs no deduplication and no suppression of repeated
 * frames.
 *
 * @module frontend/realtime/transport_events
 */

import type { WebSocketEvent } from '@city-commander/shared-schemas';

// ─── Event Type Identity ───────────────────────────────────

/**
 * Event-type discriminants carried by the canonical
 * `WebSocketEvent` union (imported from the package entry point, never
 * duplicated).
 */
export type CanonicalRealtimeEventType = WebSocketEvent['event_type'];

/**
 * `incident.injected` is listed in the §13 event/fallback table but has no
 * member in the canonical `WebSocketEvent` union yet (cross-owner gap; see the
 * TASK-122 report). Only the §13 event-type literal is declared here so the
 * fallback table can be complete. No payload shape is invented, and
 * shared-schemas is not modified.
 */
export const INCIDENT_INJECTED_EVENT_TYPE = 'incident.injected';

/** Transport-level union of every §13 event type. */
export type RealtimeEventType = CanonicalRealtimeEventType | typeof INCIDENT_INJECTED_EVENT_TYPE;

/**
 * Exhaustive presence map over {@link RealtimeEventType}.
 *
 * The `Record` annotation makes the compiler reject a missing or unknown key,
 * so the §13 table below can never silently drift.
 */
const REALTIME_EVENT_TYPE_PRESENCE: Readonly<Record<RealtimeEventType, true>> = {
  'timeline.updated': true,
  'anomaly.detected': true,
  'incident.injected': true,
  'decision.fast_path_ready': true,
  'decision.enriched': true,
  'public_alert.ready': true,
  'report.ready': true,
  'publish.status_changed': true,
  'processing.failed': true,
};

/** Every §13 event type, in table order. */
export const REALTIME_EVENT_TYPES: readonly RealtimeEventType[] = Object.keys(
  REALTIME_EVENT_TYPE_PRESENCE,
) as readonly RealtimeEventType[];

/** Type guard for a §13 event-type discriminant. */
export function isRealtimeEventType(value: string): value is RealtimeEventType {
  return Object.prototype.hasOwnProperty.call(REALTIME_EVENT_TYPE_PRESENCE, value);
}

// ─── Envelope ──────────────────────────────────────────────

/**
 * Minimum safely-identified transport envelope for one received frame.
 *
 * `payload` is the parsed frame exactly as received, exposed as `unknown` so
 * callers cannot mistake it for validated domain truth.
 */
export interface RealtimeEventEnvelope {
  readonly eventType: RealtimeEventType;
  readonly decisionId: string | null;
  readonly eventId: string | null;
  readonly occurredAt: string | null;
  /** Preserved verbatim for TASK-123; unused for dedup in TASK-122. */
  readonly readyEventId: string | null;
  /** Received frame, preserved as read-only unknown transport data. */
  readonly payload: unknown;
}

// ─── Typed Transport Errors ────────────────────────────────

/** Transport failure discriminator. Never carries payloads or stack traces. */
export type RealtimeTransportErrorCode =
  | 'INVALID_ENDPOINT'
  | 'SOCKET_ERROR'
  | 'UNEXPECTED_CLOSE'
  | 'UNSUPPORTED_MESSAGE_FORMAT'
  | 'INVALID_JSON'
  | 'INVALID_ENVELOPE'
  | 'UNKNOWN_EVENT_TYPE';

/** Typed transport error surfaced to subscribers and the operational status UI. */
export interface RealtimeTransportError {
  readonly code: RealtimeTransportErrorCode;
  /** Operator-facing description. Contains no payload, credential, or stack data. */
  readonly message: string;
}

/** Result of parsing a single received frame. */
export type RealtimeEventParseResult =
  | { readonly ok: true; readonly envelope: RealtimeEventEnvelope }
  | { readonly ok: false; readonly error: RealtimeTransportError };

// ─── Parsing ───────────────────────────────────────────────

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function optionalString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === 'string' && value !== '' ? value : null;
}

function transportError(
  code: RealtimeTransportErrorCode,
  message: string,
): { readonly ok: false; readonly error: RealtimeTransportError } {
  return { ok: false, error: { code, message } };
}

/**
 * Parses one received WebSocket frame into a transport envelope.
 *
 * Invalid input never throws: it is reported as a typed transport error so the
 * SPA stays alive and the degraded-mode UI can surface the failure.
 *
 * @param data - Raw `MessageEvent.data`, treated as `unknown`.
 */
export function parseRealtimeEvent(data: unknown): RealtimeEventParseResult {
  if (typeof data !== 'string') {
    return transportError('UNSUPPORTED_MESSAGE_FORMAT', 'WebSocket 訊息不是文字格式，已忽略');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return transportError('INVALID_JSON', 'WebSocket 訊息不是有效的 JSON，已忽略');
  }

  if (!isRecord(parsed)) {
    return transportError('INVALID_ENVELOPE', 'WebSocket 訊息缺少事件物件結構，已忽略');
  }

  const rawEventType = parsed['event_type'];
  if (typeof rawEventType !== 'string' || rawEventType === '') {
    return transportError('INVALID_ENVELOPE', 'WebSocket 訊息缺少 event_type，已忽略');
  }

  if (!isRealtimeEventType(rawEventType)) {
    return transportError(
      'UNKNOWN_EVENT_TYPE',
      'WebSocket 訊息的 event_type 不在 §13 事件表中，已忽略',
    );
  }

  return {
    ok: true,
    envelope: {
      eventType: rawEventType,
      decisionId: optionalString(parsed, 'decision_id'),
      eventId: optionalString(parsed, 'event_id'),
      occurredAt: optionalString(parsed, 'occurred_at'),
      readyEventId: optionalString(parsed, 'ready_event_id'),
      payload: parsed,
    },
  };
}
