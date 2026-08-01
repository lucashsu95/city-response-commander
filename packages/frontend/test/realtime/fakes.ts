/**
 * Realtime Test Doubles (TASK-122)
 *
 * Deterministic fakes for the injected browser resources: no real WebSocket,
 * no real HTTP, no real timers, no sleeping.
 */

import type { ApiResult } from '../../src/api/client.js';
import type { PollingTransport } from '../../src/realtime/polling_fallback.js';
import type { RealtimeScheduler, TimerHandle } from '../../src/realtime/scheduler.js';
import type { RealtimeSocketLike } from '../../src/realtime/ws_client.js';
import type {
  GetCrowdResponse,
  GetDecisionResponse,
  GetRoadsResponse,
} from '@city-commander/shared-schemas';

// ─── Microtask Flushing ────────────────────────────────────

/** Deterministically drains pending microtasks (no timers, no sleeping). */
export async function flush(turns = 20): Promise<void> {
  for (let index = 0; index < turns; index += 1) {
    await Promise.resolve();
  }
}

// ─── Fake Scheduler ────────────────────────────────────────

interface PendingTimer {
  readonly handler: () => void;
  readonly delayMs: number;
}

export interface FakeScheduler extends RealtimeScheduler {
  pendingCount(): number;
  pendingDelays(): readonly number[];
  /** Removes and returns the first pending timer without running it. */
  takeNext(): PendingTimer | null;
  /** Removes and runs the first pending timer with the given delay. */
  runTimer(delayMs: number): boolean;
  /** Removes and runs the first pending timer. */
  runNext(): boolean;
}

export function createFakeScheduler(): FakeScheduler {
  const timers = new Map<number, PendingTimer>();
  let nextId = 1;

  return {
    setTimer(handler: () => void, delayMs: number): TimerHandle {
      const id = nextId;
      nextId += 1;
      timers.set(id, { handler, delayMs });
      return id as unknown as TimerHandle;
    },
    clearTimer(handle: TimerHandle): void {
      timers.delete(handle as unknown as number);
    },
    pendingCount(): number {
      return timers.size;
    },
    pendingDelays(): readonly number[] {
      return [...timers.values()].map((timer) => timer.delayMs);
    },
    takeNext(): PendingTimer | null {
      const entry = [...timers.entries()][0];
      if (entry === undefined) {
        return null;
      }
      timers.delete(entry[0]);
      return entry[1];
    },
    runTimer(delayMs: number): boolean {
      const entry = [...timers.entries()].find(([, timer]) => timer.delayMs === delayMs);
      if (entry === undefined) {
        return false;
      }
      timers.delete(entry[0]);
      entry[1].handler();
      return true;
    },
    runNext(): boolean {
      const timer = this.takeNext();
      if (timer === null) {
        return false;
      }
      timer.handler();
      return true;
    },
  };
}

// ─── Fake Socket ───────────────────────────────────────────

export class FakeSocket {
  static instances: FakeSocket[] = [];

  static reset(): void {
    FakeSocket.instances = [];
  }

  readonly url: string;
  closeCalls = 0;
  onopen: ((event: unknown) => void) | null = null;
  onclose: ((event: unknown) => void) | null = null;
  onerror: ((event: unknown) => void) | null = null;
  onmessage: ((event: unknown) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeSocket.instances.push(this);
  }

  close(): void {
    this.closeCalls += 1;
  }

  emitOpen(): void {
    this.onopen?.({ type: 'open' });
  }

  emitError(): void {
    this.onerror?.({ type: 'error' });
  }

  emitClose(code = 1006): void {
    this.onclose?.({ type: 'close', code, reason: '', wasClean: false });
  }

  emitMessage(data: unknown): void {
    this.onmessage?.({ data });
  }

  /** True when every handler was detached by the client. */
  isDetached(): boolean {
    return (
      this.onopen === null &&
      this.onclose === null &&
      this.onerror === null &&
      this.onmessage === null
    );
  }
}

export interface SocketRecorder {
  readonly instances: FakeSocket[];
  factory(url: string): RealtimeSocketLike;
  at(index: number): FakeSocket;
}

export function createSocketRecorder(): SocketRecorder {
  const instances: FakeSocket[] = [];
  return {
    instances,
    factory(url: string): RealtimeSocketLike {
      const socket = new FakeSocket(url);
      instances.push(socket);
      return socket as unknown as RealtimeSocketLike;
    },
    at(index: number): FakeSocket {
      const socket = instances[index];
      if (socket === undefined) {
        throw new Error(`No fake socket at index ${index}`);
      }
      return socket;
    },
  };
}

// ─── Canonical-shaped Fixtures ─────────────────────────────

export function roadsFixture(): GetRoadsResponse {
  return {
    schema_version: '1.0',
    trace_id: 'tr-roads',
    segments: [],
    timestamp: '2026-05-20 22:10',
    provisional: true,
  };
}

export function crowdFixture(): GetCrowdResponse {
  return {
    schema_version: '1.0',
    trace_id: 'tr-crowd',
    stations: [],
    timestamp: '2026-05-20 22:10',
    provisional: true,
  };
}

export type NarrativePayloadType = 'REPORT' | 'PUBLIC_ALERT' | 'EXPLANATION';

export function decisionFixture(
  narrativeTypes: readonly NarrativePayloadType[] = [],
): GetDecisionResponse {
  return {
    schema_version: '1.0',
    trace_id: 'tr-decision',
    core: {},
    narratives: narrativeTypes.map((type) => ({
      decision_id: 'dec-1',
      narrative_type: type,
      core_version_ref: 1,
      ready_event_id: `dec-1|${type}|1`,
      payload: { type },
    })),
    execution: {
      status: 'running',
      last_error: null,
      retryable: false,
      attempt_count: 1,
    },
    policy_version: 'prov-2026a',
    provisional: true,
  } as unknown as GetDecisionResponse;
}

// ─── Fake Transport ────────────────────────────────────────

export interface FakeTransport extends PollingTransport {
  /** Every requested target key, in call order. */
  readonly calls: string[];
  readonly signals: AbortSignal[];
  callsFor(key: string): number;
  failTarget(key: string): void;
  clearFailures(): void;
  setDecisionNarratives(types: readonly NarrativePayloadType[]): void;
  /**
   * Forces the decision response body to arbitrary runtime data, mimicking a
   * backend that returns JSON not matching the canonical contract.
   * Pass `null` to restore the canonical fixture.
   */
  setDecisionRawBody(body: unknown | null): void;
  /** Holds every response until {@link release} is called. */
  hold(): void;
  release(): void;
}

export function createFakeTransport(): FakeTransport {
  const calls: string[] = [];
  const signals: AbortSignal[] = [];
  const failing = new Set<string>();
  let narrativeTypes: readonly NarrativePayloadType[] = [];
  let decisionRawBody: unknown | null = null;
  let gate: Promise<void> | null = null;
  let openGate: (() => void) | null = null;

  async function respond<T>(key: string, signal: AbortSignal | undefined, data: T): Promise<ApiResult<T>> {
    calls.push(key);
    if (signal !== undefined) {
      signals.push(signal);
    }
    if (gate !== null) {
      await gate;
    }
    if (failing.has(key)) {
      return { ok: false, error: { code: 'NETWORK_ERROR', message: 'fake transport failure' } };
    }
    return { ok: true, data };
  }

  return {
    calls,
    signals,

    getRoads(options) {
      return respond('roads', options?.signal, roadsFixture());
    },
    getCrowd(options) {
      return respond('crowd', options?.signal, crowdFixture());
    },
    getDecision(id, options) {
      const body =
        decisionRawBody === null
          ? decisionFixture(narrativeTypes)
          : (decisionRawBody as GetDecisionResponse);
      return respond(`decisions/${id}`, options?.signal, body);
    },
    getReadOnlyJson(path, options) {
      return respond(path, options?.signal, { path } as unknown);
    },

    callsFor(key: string): number {
      return calls.filter((call) => call === key).length;
    },
    failTarget(key: string): void {
      failing.add(key);
    },
    clearFailures(): void {
      failing.clear();
    },
    setDecisionNarratives(types: readonly NarrativePayloadType[]): void {
      narrativeTypes = types;
    },
    setDecisionRawBody(body: unknown | null): void {
      decisionRawBody = body;
    },
    hold(): void {
      if (gate !== null) {
        return;
      }
      gate = new Promise<void>((resolve) => {
        openGate = resolve;
      });
    },
    release(): void {
      const resolve = openGate;
      gate = null;
      openGate = null;
      resolve?.();
    },
  };
}
