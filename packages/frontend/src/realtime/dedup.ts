/**
 * `ready_event_id` Dedup Coordinator — Effectively-Once Presentation (§13)
 *
 * WebSocket delivery is **at-least-once**: `ws_client.ts` forwards every
 * received frame, repeats included (TASK-122). This module sits above that
 * raw transport, at the Dashboard/presentation boundary, and turns repeated
 * deliveries of the same `ready_event_id` into a single presentation commit.
 *
 * `DecisionNarrativeTable` and HTTP polling/read models remain the
 * authoritative state (§13). A unique WebSocket notification is never treated
 * as domain truth by itself — it is only a signal that authoritative state may
 * have changed, gating exactly one authoritative reconciliation + presentation
 * commit per `ready_event_id`.
 *
 * `ready_event_id` is treated strictly as an opaque identity string:
 *   - never split, regenerated, or normalized
 *   - never used to infer `decision_id`, `event_type`, or a version
 *   - never substituted with `occurred_at`, `trace_id`, `decision_id`,
 *     `event_id`, or a payload hash
 *   - never synthesized when missing
 *
 * This is in-memory, session-scoped presentation coordination only. No TTL or
 * LRU eviction: a committed id stays committed for the coordinator's lifetime,
 * because evicting it during the same Dashboard session would let a late
 * redelivery render twice and violate effectively-once presentation.
 *
 * @module frontend/realtime/dedup
 */

import type { RealtimeEventType } from './transport_events.js';

// ─── Ready-Event-Bearing Event Types ──────────────────────

/**
 * §13 event types whose canonical `WebSocketEvent` member (see
 * `@city-commander/shared-schemas` `events.ts`) declares `ready_event_id`:
 * `decision.fast_path_ready`, `decision.enriched`, `public_alert.ready`, and
 * `report.ready`.
 *
 * Only envelopes of these event types are routed through ready_event_id
 * dedup. Every other §13 event type (for example `timeline.updated`, which
 * has no `ready_event_id` in its canonical contract) is forwarded unchanged
 * and is out of scope for this coordinator.
 *
 * Cross-owner integration note: design.md §13 states every event payload
 * carries `ready_event_id`, but the canonical `WebSocketEvent` union does not
 * declare it for `publish.status_changed` or `processing.failed`. This gap is
 * reported here, not resolved — no substitute identity is synthesized for
 * those two event types.
 */
export const READY_EVENT_ID_EVENT_TYPES: readonly RealtimeEventType[] = [
  'decision.fast_path_ready',
  'decision.enriched',
  'public_alert.ready',
  'report.ready',
];

/** True when `eventType` canonically carries a `ready_event_id`. */
export function isReadyEventIdBearingType(eventType: RealtimeEventType): boolean {
  return (READY_EVENT_ID_EVENT_TYPES as readonly string[]).includes(eventType);
}

// ─── Identity ──────────────────────────────────────────────

/** Minimum shape required to dedup a notification: an opaque identity field. */
export interface ReadyEventNotification {
  /** Opaque `ready_event_id` as received, or `null`/`undefined` when absent. */
  readonly readyEventId: string | null | undefined;
}

/**
 * Validates a candidate `ready_event_id`.
 *
 * The original (non-trimmed) value is preserved as the identity when valid,
 * so no whitespace variant of the same id is ever invented. A value that is
 * not a string, empty, or all-whitespace is rejected — never defaulted.
 */
function validateReadyEventId(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') {
    return null;
  }
  if (raw.trim() === '') {
    return null;
  }
  return raw;
}

// ─── Outcomes ──────────────────────────────────────────────

/**
 * Typed outcome of one {@link ReadyEventDedupCoordinator.processNotification}
 * call. Callers distinguish every required case (§13, PATCH 3/5) without the
 * coordinator ever throwing for expected duplicate delivery.
 */
export type ReadyEventOutcome =
  /** First delivery: reconciliation + presentation commit both succeeded. */
  | 'committed'
  /** Redelivery of an id that already committed. Dropped; no rerender. */
  | 'duplicate_committed'
  /** Redelivery while the first delivery's reconciliation/commit is running. */
  | 'duplicate_in_flight'
  /** `ready_event_id` was missing, non-string, empty, or whitespace-only. */
  | 'rejected_missing_ready_event_id'
  /** Reconciliation or presentation commit threw/rejected; reservation released. */
  | 'failed'
  /** Coordinator was disposed before or during this notification. */
  | 'disposed';

/** Result of one {@link ReadyEventDedupCoordinator.processNotification} call. */
export interface ProcessNotificationResult {
  readonly outcome: ReadyEventOutcome;
  /** The validated identity, or `null` when rejected/disposed before validation. */
  readonly readyEventId: string | null;
}

function outcome(result: ReadyEventOutcome, readyEventId: string | null): ProcessNotificationResult {
  return { outcome: result, readyEventId };
}

// ─── Coordinator ───────────────────────────────────────────

export interface ReadyEventDedupCoordinator {
  /**
   * Processes one notification against its `ready_event_id`.
   *
   * - First valid delivery: reserves the id as `in_flight`, awaits
   *   `reconcileAuthoritativeState`, then `commitPresentation` with the
   *   reconciled result, and moves the id to `committed` only if both
   *   succeed.
   * - Duplicate while `in_flight`: neither callback is invoked; resolves with
   *   `duplicate_in_flight` immediately.
   * - Duplicate after `committed`: neither callback is invoked; resolves with
   *   `duplicate_committed`.
   * - A callback failure releases the `in_flight` reservation (never marks the
   *   id `committed`), so a later redelivery of the same id can retry.
   * - After {@link dispose}, resolves with `disposed` and never invokes either
   *   callback.
   *
   * `reconcileAuthoritativeState` and `commitPresentation` may be sync or
   * async; both are awaited safely and never produce an unhandled rejection.
   */
  processNotification<TNotification extends ReadyEventNotification, TResult>(
    notification: TNotification,
    reconcileAuthoritativeState: (notification: TNotification) => TResult | Promise<TResult>,
    commitPresentation: (result: TResult, notification: TNotification) => void | Promise<void>,
  ): Promise<ProcessNotificationResult>;

  /**
   * Invalidates the current generation, clears session-scoped tracking, and
   * prevents any in-flight reconciliation/commit from committing afterward.
   * Idempotent. Once disposed, the coordinator never resumes.
   */
  dispose(): void;
}

/** Internal per-id lifecycle state. `unseen` has no map entry. */
type ReadyEventState = 'in_flight' | 'committed';

/**
 * Creates a session-scoped `ready_event_id` dedup coordinator.
 *
 * One instance is intended per mounted realtime lifecycle (§16.4): created
 * once per mount, disposed exactly once on unmount. Reconnect and
 * connected↔polling transitions must never call {@link
 * ReadyEventDedupCoordinator.dispose}, so committed ids stay deduped for the
 * whole session.
 */
export function createReadyEventDedupCoordinator(): ReadyEventDedupCoordinator {
  const seen = new Map<string, ReadyEventState>();
  let disposed = false;
  /** Bumped on dispose so a reconciliation/commit in flight at dispose time can detect staleness. */
  let generation = 0;

  async function processNotification<TNotification extends ReadyEventNotification, TResult>(
    notification: TNotification,
    reconcileAuthoritativeState: (notification: TNotification) => TResult | Promise<TResult>,
    commitPresentation: (result: TResult, notification: TNotification) => void | Promise<void>,
  ): Promise<ProcessNotificationResult> {
    if (disposed) {
      return outcome('disposed', null);
    }

    const readyEventId = validateReadyEventId(notification.readyEventId);
    if (readyEventId === null) {
      return outcome('rejected_missing_ready_event_id', null);
    }

    const existing = seen.get(readyEventId);
    if (existing === 'committed') {
      return outcome('duplicate_committed', readyEventId);
    }
    if (existing === 'in_flight') {
      return outcome('duplicate_in_flight', readyEventId);
    }

    // First delivery: reserve before awaiting anything so a synchronously
    // re-entrant duplicate call (or a duplicate arriving before the first
    // await yields) still coalesces instead of starting a second attempt.
    seen.set(readyEventId, 'in_flight');
    const myGeneration = generation;

    try {
      const result = await reconcileAuthoritativeState(notification);
      if (disposed || myGeneration !== generation) {
        return outcome('disposed', readyEventId);
      }

      await commitPresentation(result, notification);
      if (disposed || myGeneration !== generation) {
        return outcome('disposed', readyEventId);
      }

      seen.set(readyEventId, 'committed');
      return outcome('committed', readyEventId);
    } catch {
      // Release the reservation so a later redelivery can retry. The id must
      // never be poisoned as permanently committed by an unexpected failure.
      if (!disposed && myGeneration === generation && seen.get(readyEventId) === 'in_flight') {
        seen.delete(readyEventId);
      }
      return outcome('failed', readyEventId);
    }
  }

  function dispose(): void {
    if (disposed) {
      return;
    }
    disposed = true;
    generation += 1;
    seen.clear();
  }

  return { processNotification, dispose };
}
