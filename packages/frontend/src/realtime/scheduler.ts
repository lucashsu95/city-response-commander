/**
 * Realtime Timer Scheduler (§16.4)
 *
 * Thin injection seam over the browser timer API so the realtime transport
 * (WebSocket reconnect scheduling + HTTP polling cadence) can be driven
 * deterministically in tests without sleeping.
 *
 * This is a frontend transport concern only. It carries no policy or domain
 * meaning.
 *
 * @module frontend/realtime/scheduler
 */

/** Opaque handle returned by the injected scheduler. */
export type TimerHandle = ReturnType<typeof setTimeout>;

/** Minimal one-shot timer contract used by the realtime transport. */
export interface RealtimeScheduler {
  /** Schedules a one-shot callback after `delayMs` milliseconds. */
  setTimer(handler: () => void, delayMs: number): TimerHandle;
  /** Cancels a previously scheduled callback. */
  clearTimer(handle: TimerHandle): void;
}

/**
 * Production scheduler backed by the browser timer API.
 */
export function createBrowserScheduler(): RealtimeScheduler {
  return {
    setTimer(handler: () => void, delayMs: number): TimerHandle {
      return setTimeout(handler, delayMs);
    },
    clearTimer(handle: TimerHandle): void {
      clearTimeout(handle);
    },
  };
}
