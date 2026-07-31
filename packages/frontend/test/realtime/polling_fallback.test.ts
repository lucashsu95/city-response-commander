/**
 * Polling Fallback Tests (TASK-122)
 *
 * Covers the §13 per-event fallback mapping and the cancellable polling loop.
 * No real HTTP, no real timers, no sleeping.
 */

import { describe, it, expect } from 'vitest';
import {
  DEFAULT_POLLING_INTERVAL_MS,
  POLLING_ROUTES,
  createDecisionFallbackContext,
  createDefaultFallbackContext,
  createPollingFallback,
  inspectEnrichmentSet,
  isEnrichmentSetPresent,
  resolveFallbackPlan,
  resolvePollingTargetsForEvent,
} from '../../src/realtime/polling_fallback.js';
import type {
  PollingCycleResult,
  PollingError,
  PollingTarget,
} from '../../src/realtime/polling_fallback.js';
import { REALTIME_EVENT_TYPES } from '../../src/realtime/transport_events.js';
import type { RealtimeEventType } from '../../src/realtime/transport_events.js';
import { createFakeScheduler, createFakeTransport, decisionFixture, flush } from './fakes.js';

const DECISION_ID = 'dec-acc001';

function routesFor(eventType: RealtimeEventType, decisionId: string | null): readonly string[] {
  const resolution = resolvePollingTargetsForEvent(eventType, { decisionId });
  if (!resolution.ok) {
    return [];
  }
  return resolution.targets.map((target) => target.route);
}

function targetsFor(eventType: RealtimeEventType, decisionId: string | null): readonly PollingTarget[] {
  const resolution = resolvePollingTargetsForEvent(eventType, { decisionId });
  return resolution.ok ? resolution.targets : [];
}

function createLoopHarness(intervalMs?: number) {
  const scheduler = createFakeScheduler();
  const transport = createFakeTransport();
  const cycles: PollingCycleResult[] = [];
  const errors: PollingError[] = [];

  const polling = createPollingFallback({
    transport,
    scheduler,
    intervalMs,
    onCycle: (result) => cycles.push(result),
    onError: (error) => errors.push(error),
  });

  return { polling, scheduler, transport, cycles, errors };
}

describe('§13 polling fallback mapping', () => {
  it('maps every §13 event to its documented GET fallback target', () => {
    expect(routesFor('timeline.updated', DECISION_ID)).toEqual([POLLING_ROUTES.timeline]);
    expect(routesFor('anomaly.detected', DECISION_ID)).toEqual([
      POLLING_ROUTES.roads,
      POLLING_ROUTES.crowd,
    ]);
    expect(routesFor('incident.injected', DECISION_ID)).toEqual([POLLING_ROUTES.incidents]);
    expect(routesFor('decision.fast_path_ready', DECISION_ID)).toEqual([POLLING_ROUTES.decision]);
    expect(routesFor('decision.enriched', DECISION_ID)).toEqual([POLLING_ROUTES.decision]);
    expect(routesFor('public_alert.ready', DECISION_ID)).toEqual([POLLING_ROUTES.report]);
    expect(routesFor('report.ready', DECISION_ID)).toEqual([POLLING_ROUTES.report]);
    expect(routesFor('publish.status_changed', DECISION_ID)).toEqual([POLLING_ROUTES.decision]);
    expect(routesFor('processing.failed', DECISION_ID)).toEqual([POLLING_ROUTES.decision]);
  });

  it('covers all nine §13 event types with at least one fallback target', () => {
    expect(REALTIME_EVENT_TYPES).toHaveLength(9);
    for (const eventType of REALTIME_EVENT_TYPES) {
      expect(routesFor(eventType, DECISION_ID).length).toBeGreaterThan(0);
    }
  });

  it('maps decision.enriched to poll until the canonical enrichment set is reported', () => {
    const [target] = targetsFor('decision.enriched', DECISION_ID);
    expect(target?.kind).toBe('decision');
    expect(target?.kind === 'decision' && target.awaitEnrichmentSet).toBe(true);

    const [fastPath] = targetsFor('decision.fast_path_ready', DECISION_ID);
    expect(fastPath?.kind === 'decision' && fastPath.awaitEnrichmentSet).toBe(false);
  });

  it('maps anomaly.detected to the roads and crowd read models only', () => {
    const targets = targetsFor('anomaly.detected', DECISION_ID);
    expect(targets.map((target) => target.kind)).toEqual(['roads', 'crowd']);
    // No threshold, saturation, classification, or anomaly field is produced here.
    for (const target of targets) {
      expect(Object.keys(target).sort()).toEqual(['kind', 'path', 'route']);
    }
  });

  it('URL-encodes path identifiers', () => {
    const [decision] = targetsFor('decision.fast_path_ready', 'dec/1 2?x');
    expect(decision?.path).toBe('decisions/dec%2F1%202%3Fx');

    const [report] = targetsFor('report.ready', 'dec/1 2?x');
    expect(report?.path).toBe('reports/dec%2F1%202%3Fx');
  });

  it('never produces a hardcoded base endpoint', () => {
    for (const eventType of REALTIME_EVENT_TYPES) {
      for (const target of targetsFor(eventType, DECISION_ID)) {
        expect(target.path).not.toMatch(/^[a-zA-Z][a-zA-Z\d+\-.]*:/);
        expect(target.path).not.toMatch(/^\//);
        expect(target.path).not.toContain('amazonaws');
        expect(target.path).not.toContain('execute-api');
      }
    }
  });

  it('reports missing decision context explicitly instead of guessing', () => {
    for (const eventType of [
      'decision.fast_path_ready',
      'decision.enriched',
      'public_alert.ready',
      'report.ready',
      'publish.status_changed',
      'processing.failed',
    ] as const) {
      const resolution = resolvePollingTargetsForEvent(eventType, { decisionId: null });
      expect(resolution.ok).toBe(false);
      if (!resolution.ok) {
        expect(resolution.unresolved.requiredParameter).toBe('decision_id');
        expect(resolution.unresolved.eventType).toBe(eventType);
        expect(resolution.unresolved.message).toContain('decision_id');
      }
    }
  });

  it('resolves the default fallback plan without any parameterized target', () => {
    const plan = resolveFallbackPlan(createDefaultFallbackContext());
    expect(plan.targets.map((target) => target.kind)).toEqual([
      'timeline',
      'roads',
      'crowd',
      'incidents',
    ]);
    expect(plan.unresolved).toHaveLength(0);
  });

  it('deduplicates repeated routes and keeps the enrichment-aware decision target', () => {
    const plan = resolveFallbackPlan(createDecisionFallbackContext(DECISION_ID));
    const decisionTargets = plan.targets.filter((target) => target.kind === 'decision');
    expect(decisionTargets).toHaveLength(1);
    expect(decisionTargets[0]?.kind === 'decision' && decisionTargets[0].awaitEnrichmentSet).toBe(
      true,
    );
    expect(plan.targets.filter((target) => target.kind === 'report')).toHaveLength(1);
    expect(plan.unresolved).toHaveLength(0);
  });

  it('reports every unresolved target in the plan when no decision is tracked', () => {
    const plan = resolveFallbackPlan({ eventTypes: REALTIME_EVENT_TYPES, decisionId: null });
    expect(plan.targets.map((target) => target.kind)).toEqual([
      'timeline',
      'roads',
      'crowd',
      'incidents',
    ]);
    expect(plan.unresolved).toHaveLength(6);
  });
});

describe('enrichment readiness is read from the canonical read model', () => {
  it('is false until all three canonical narrative items exist', () => {
    expect(isEnrichmentSetPresent(decisionFixture([]))).toBe(false);
    expect(isEnrichmentSetPresent(decisionFixture(['REPORT']))).toBe(false);
    expect(isEnrichmentSetPresent(decisionFixture(['REPORT', 'PUBLIC_ALERT']))).toBe(false);
    expect(isEnrichmentSetPresent(decisionFixture(['REPORT', 'PUBLIC_ALERT', 'EXPLANATION']))).toBe(
      true,
    );
  });

  // F-01: the API client returns unvalidated runtime JSON, so every level must
  // be checked before it is read.
  const malformedBodies: readonly { readonly label: string; readonly body: unknown }[] = [
    { label: 'narratives missing', body: { schema_version: '1.0' } },
    { label: 'narratives not an array', body: { narratives: { REPORT: true } } },
    { label: 'narratives is a string', body: { narratives: 'REPORT' } },
    { label: 'narrative item not an object', body: { narratives: ['REPORT'] } },
    { label: 'narrative item is null', body: { narratives: [null] } },
    { label: 'payload missing', body: { narratives: [{ narrative_type: 'REPORT' }] } },
    { label: 'payload not an object', body: { narratives: [{ payload: 'REPORT' }] } },
    { label: 'payload.type missing', body: { narratives: [{ payload: {} }] } },
    { label: 'payload.type not a string', body: { narratives: [{ payload: { type: 7 } }] } },
    { label: 'response is null', body: null },
    { label: 'response is an array', body: [] },
  ];

  it.each(malformedBodies)(
    'reports a malformed decision response without throwing or claiming readiness ($label)',
    ({ body }) => {
      const decision = body as never;
      expect(() => inspectEnrichmentSet(decision)).not.toThrow();
      expect(inspectEnrichmentSet(decision)).toEqual({ ok: false, reason: 'MALFORMED_RESPONSE' });
      expect(isEnrichmentSetPresent(decision)).toBe(false);
    },
  );

  it('accepts a canonical response and reports presence explicitly', () => {
    expect(inspectEnrichmentSet(decisionFixture(['REPORT']))).toEqual({ ok: true, present: false });
    expect(inspectEnrichmentSet(decisionFixture(['REPORT', 'PUBLIC_ALERT', 'EXPLANATION']))).toEqual(
      { ok: true, present: true },
    );
  });

  it('ignores unrelated narrative types without treating them as malformed', () => {
    const body = {
      narratives: [{ payload: { type: 'SOMETHING_ELSE' } }, { payload: { type: 'REPORT' } }],
    } as never;
    expect(inspectEnrichmentSet(body)).toEqual({ ok: true, present: false });
  });
});

describe('F-01 exception isolation — malformed decision response', () => {
  function createEnrichmentHarness() {
    const harness = createLoopHarness();
    harness.polling.start(
      resolveFallbackPlan({ eventTypes: ['decision.enriched'], decisionId: DECISION_ID }),
    );
    return harness;
  }

  it('does not throw, produces a typed error, keeps the target, and keeps polling', async () => {
    const harness = createLoopHarness();
    harness.transport.setDecisionRawBody({ narratives: 'not-an-array' });

    expect(() => {
      harness.polling.start(
        resolveFallbackPlan({ eventTypes: ['decision.enriched'], decisionId: DECISION_ID }),
      );
    }).not.toThrow();
    await flush();

    // 1 + 3: typed polling error, no throw.
    expect(harness.errors).toHaveLength(1);
    expect(harness.errors[0]?.code).toBe('INVALID_POLLING_RESPONSE');
    expect(harness.errors[0]?.route).toBe(POLLING_ROUTES.decision);
    expect(harness.errors[0]?.apiErrorCode).toBeNull();
    expect(harness.cycles[0]?.failedCount).toBe(1);
    expect(harness.cycles[0]?.succeededCount).toBe(0);

    // 2: the enrichment target was not retired.
    // 4: the next cycle still runs after the malformed response.
    expect(harness.scheduler.runTimer(DEFAULT_POLLING_INTERVAL_MS)).toBe(true);
    await flush();
    expect(harness.cycles).toHaveLength(2);
    expect(harness.cycles[1]?.outcomes).toHaveLength(1);
    expect(harness.transport.callsFor(`decisions/${DECISION_ID}`)).toBe(2);

    // Recovery: once the canonical shape returns, readiness is honoured again.
    harness.transport.setDecisionRawBody(null);
    harness.transport.setDecisionNarratives(['REPORT', 'PUBLIC_ALERT', 'EXPLANATION']);
    harness.scheduler.runTimer(DEFAULT_POLLING_INTERVAL_MS);
    await flush();
    expect(harness.cycles[2]?.succeededCount).toBe(1);

    harness.polling.stop();
  });

  it('never fabricates REPORT, PUBLIC_ALERT, or EXPLANATION readiness', async () => {
    const harness = createEnrichmentHarness();
    harness.transport.setDecisionRawBody({ narratives: [{ payload: { type: 42 } }] });
    await flush();
    harness.scheduler.runTimer(DEFAULT_POLLING_INTERVAL_MS);
    await flush();

    for (const cycle of harness.cycles.slice(1)) {
      for (const outcome of cycle.outcomes) {
        expect(outcome.result.ok).toBe(false);
      }
    }

    harness.polling.stop();
  });

  it('stop after a malformed response cancels all future work', async () => {
    const harness = createEnrichmentHarness();
    harness.transport.setDecisionRawBody({ narratives: null });
    await flush();
    harness.scheduler.runTimer(DEFAULT_POLLING_INTERVAL_MS);
    await flush();

    harness.polling.stop();
    const callsAfterStop = harness.transport.calls.length;
    const cyclesAfterStop = harness.cycles.length;

    expect(harness.polling.isActive()).toBe(false);
    expect(harness.scheduler.pendingCount()).toBe(0);
    await flush();
    expect(harness.transport.calls.length).toBe(callsAfterStop);
    expect(harness.cycles).toHaveLength(cyclesAfterStop);
  });
});

describe('F-01 exception isolation — throwing consumer callbacks', () => {
  it('a throwing onError callback does not stop later cycles', async () => {
    const scheduler = createFakeScheduler();
    const transport = createFakeTransport();
    const cycles: PollingCycleResult[] = [];
    let errorCalls = 0;

    const polling = createPollingFallback({
      transport,
      scheduler,
      onCycle: (result) => cycles.push(result),
      onError: () => {
        errorCalls += 1;
        throw new Error('consumer onError fault');
      },
    });

    transport.failTarget('timeline');
    expect(() => polling.start(resolveFallbackPlan(createDefaultFallbackContext()))).not.toThrow();
    await flush();

    expect(errorCalls).toBe(1);
    expect(cycles).toHaveLength(1);
    // The cycle still completed and rescheduled despite the consumer fault.
    expect(scheduler.pendingDelays()).toEqual([DEFAULT_POLLING_INTERVAL_MS]);

    expect(scheduler.runTimer(DEFAULT_POLLING_INTERVAL_MS)).toBe(true);
    await flush();
    expect(cycles).toHaveLength(2);
    expect(errorCalls).toBe(2);

    polling.stop();
    expect(scheduler.pendingCount()).toBe(0);
  });

  it('a throwing onCycle callback does not stop later cycles', async () => {
    const scheduler = createFakeScheduler();
    const transport = createFakeTransport();
    let cycleCalls = 0;

    const polling = createPollingFallback({
      transport,
      scheduler,
      onCycle: () => {
        cycleCalls += 1;
        throw new Error('consumer onCycle fault');
      },
    });

    expect(() => polling.start(resolveFallbackPlan(createDefaultFallbackContext()))).not.toThrow();
    await flush();

    expect(cycleCalls).toBe(1);
    expect(scheduler.pendingDelays()).toEqual([DEFAULT_POLLING_INTERVAL_MS]);

    expect(scheduler.runTimer(DEFAULT_POLLING_INTERVAL_MS)).toBe(true);
    await flush();
    expect(cycleCalls).toBe(2);

    expect(scheduler.runTimer(DEFAULT_POLLING_INTERVAL_MS)).toBe(true);
    await flush();
    expect(cycleCalls).toBe(3);

    // 12: stop after repeated consumer faults still cancels everything.
    polling.stop();
    expect(polling.isActive()).toBe(false);
    expect(scheduler.pendingCount()).toBe(0);
    const callsAfterStop = transport.calls.length;
    await flush();
    expect(transport.calls.length).toBe(callsAfterStop);
  });

  it('produces no unhandled rejection while every consumer path throws', async () => {
    const rejections: unknown[] = [];
    const handler = (reason: unknown): void => {
      rejections.push(reason);
    };
    process.on('unhandledRejection', handler);

    try {
      const scheduler = createFakeScheduler();
      const transport = createFakeTransport();
      transport.failTarget('timeline');
      transport.setDecisionRawBody({ narratives: 'malformed' });

      const polling = createPollingFallback({
        transport,
        scheduler,
        onCycle: () => {
          throw new Error('onCycle fault');
        },
        onError: () => {
          throw new Error('onError fault');
        },
      });

      polling.start(
        resolveFallbackPlan({
          eventTypes: ['timeline.updated', 'decision.enriched'],
          decisionId: DECISION_ID,
        }),
      );
      await flush();
      scheduler.runTimer(DEFAULT_POLLING_INTERVAL_MS);
      await flush();
      polling.stop();
      await flush();

      expect(rejections).toEqual([]);
    } finally {
      process.off('unhandledRejection', handler);
    }
  });

  it('a rejecting transport does not stop later cycles or leak a rejection', async () => {
    const scheduler = createFakeScheduler();
    const transport = createFakeTransport();
    const cycles: PollingCycleResult[] = [];

    const rejecting = {
      ...transport,
      getReadOnlyJson: () => Promise.reject(new Error('transport blew up')),
    };

    const polling = createPollingFallback({
      transport: rejecting,
      scheduler,
      onCycle: (result) => cycles.push(result),
    });

    polling.start(resolveFallbackPlan(createDefaultFallbackContext()));
    await flush();

    // No cycle result is published (no success may be claimed) but the loop lives.
    expect(cycles).toHaveLength(0);
    expect(scheduler.pendingDelays()).toEqual([DEFAULT_POLLING_INTERVAL_MS]);

    expect(scheduler.runTimer(DEFAULT_POLLING_INTERVAL_MS)).toBe(true);
    await flush();
    expect(scheduler.pendingDelays()).toEqual([DEFAULT_POLLING_INTERVAL_MS]);

    polling.stop();
    expect(scheduler.pendingCount()).toBe(0);
  });
});

describe('createPollingFallback — loop behaviour', () => {
  it('uses a 2000 ms default interval', async () => {
    const harness = createLoopHarness();
    expect(harness.polling.intervalMs).toBe(DEFAULT_POLLING_INTERVAL_MS);

    harness.polling.start(resolveFallbackPlan(createDefaultFallbackContext()));
    await flush();

    expect(harness.scheduler.pendingDelays()).toEqual([2000]);
    harness.polling.stop();
  });

  it('honours a custom interval', async () => {
    const harness = createLoopHarness(750);
    expect(harness.polling.intervalMs).toBe(750);

    harness.polling.start(resolveFallbackPlan(createDefaultFallbackContext()));
    await flush();

    expect(harness.scheduler.pendingDelays()).toEqual([750]);
    harness.polling.stop();
  });

  it('runs the first cycle immediately and one request per target', async () => {
    const harness = createLoopHarness();
    harness.polling.start(resolveFallbackPlan(createDefaultFallbackContext()));

    expect(harness.transport.calls).toEqual(['timeline', 'roads', 'crowd', 'incidents']);
    await flush();
    expect(harness.cycles).toHaveLength(1);
    expect(harness.cycles[0]?.cycle).toBe(1);
    expect(harness.cycles[0]?.succeededCount).toBe(4);
    expect(harness.cycles[0]?.failedCount).toBe(0);

    harness.polling.stop();
  });

  it('keeps only one polling cycle active at a time', async () => {
    const harness = createLoopHarness();
    harness.polling.start(resolveFallbackPlan(createDefaultFallbackContext()));
    await flush();
    expect(harness.transport.calls).toHaveLength(4);

    // Hold responses so the next cycle stays in flight, then fire its timer twice.
    harness.transport.hold();
    const timer = harness.scheduler.takeNext();
    expect(timer).not.toBeNull();
    timer?.handler();
    expect(harness.transport.calls).toHaveLength(8);
    timer?.handler();
    expect(harness.transport.calls).toHaveLength(8);

    harness.transport.release();
    await flush();
    expect(harness.cycles).toHaveLength(2);

    harness.polling.stop();
  });

  it('start on a running loop is a no-op', async () => {
    const harness = createLoopHarness();
    const plan = resolveFallbackPlan(createDefaultFallbackContext());
    harness.polling.start(plan);
    harness.polling.start(plan);

    expect(harness.transport.calls).toHaveLength(4);
    expect(harness.polling.isActive()).toBe(true);

    await flush();
    harness.polling.stop();
  });

  it('stop cancels the loop and discards late results', async () => {
    const harness = createLoopHarness();
    harness.transport.hold();
    harness.polling.start(resolveFallbackPlan(createDefaultFallbackContext()));
    expect(harness.transport.calls).toHaveLength(4);

    harness.polling.stop();
    expect(harness.polling.isActive()).toBe(false);
    expect(harness.scheduler.pendingCount()).toBe(0);
    expect(harness.transport.signals.every((signal) => signal.aborted)).toBe(true);

    harness.transport.release();
    await flush();

    expect(harness.cycles).toHaveLength(0);
    expect(harness.scheduler.pendingCount()).toBe(0);
  });

  it('one failed target does not terminate later cycles', async () => {
    const harness = createLoopHarness();
    harness.transport.failTarget('timeline');
    harness.polling.start(resolveFallbackPlan(createDefaultFallbackContext()));
    await flush();

    expect(harness.cycles[0]?.failedCount).toBe(1);
    expect(harness.cycles[0]?.succeededCount).toBe(3);
    expect(harness.errors[0]?.code).toBe('TARGET_REQUEST_FAILED');
    expect(harness.errors[0]?.route).toBe(POLLING_ROUTES.timeline);
    expect(harness.errors[0]?.apiErrorCode).toBe('NETWORK_ERROR');
    expect(harness.errors[0]?.message).not.toContain('fake transport failure');

    expect(harness.scheduler.runTimer(DEFAULT_POLLING_INTERVAL_MS)).toBe(true);
    await flush();

    expect(harness.cycles).toHaveLength(2);
    expect(harness.transport.calls).toHaveLength(8);

    harness.polling.stop();
  });

  it('surfaces missing polling context every cycle and never counts it as success', async () => {
    const harness = createLoopHarness();
    harness.polling.start(
      resolveFallbackPlan({ eventTypes: ['decision.enriched'], decisionId: null }),
    );
    await flush();

    expect(harness.cycles[0]?.succeededCount).toBe(0);
    expect(harness.cycles[0]?.outcomes).toHaveLength(0);
    expect(harness.cycles[0]?.unresolved).toHaveLength(1);
    expect(harness.errors[0]?.code).toBe('MISSING_POLLING_CONTEXT');
    expect(harness.errors[0]?.route).toBe(POLLING_ROUTES.decision);

    harness.polling.stop();
  });

  it('passes canonical read models through without adding derived fields', async () => {
    const harness = createLoopHarness();
    harness.polling.start(
      resolveFallbackPlan({ eventTypes: ['anomaly.detected'], decisionId: null }),
    );
    await flush();

    const outcomes = harness.cycles[0]?.outcomes ?? [];
    expect(outcomes.map((outcome) => outcome.target.kind)).toEqual(['roads', 'crowd']);
    for (const outcome of outcomes) {
      expect(outcome.result.ok).toBe(true);
      if (outcome.result.ok && outcome.result.value.kind === 'roads') {
        expect(Object.keys(outcome.result.value.data).sort()).toEqual([
          'provisional',
          'schema_version',
          'segments',
          'timestamp',
          'trace_id',
        ]);
      }
    }

    harness.polling.stop();
  });

  it('retires the enrichment target once the canonical read model reports the set', async () => {
    const harness = createLoopHarness();
    harness.transport.setDecisionNarratives(['REPORT']);
    harness.polling.start(
      resolveFallbackPlan({ eventTypes: ['decision.enriched'], decisionId: DECISION_ID }),
    );
    await flush();

    expect(harness.cycles[0]?.outcomes).toHaveLength(1);
    const firstOutcome = harness.cycles[0]?.outcomes[0];
    expect(
      firstOutcome?.result.ok === true &&
        firstOutcome.result.value.kind === 'decision' &&
        firstOutcome.result.value.enrichmentSetPresent,
    ).toBe(false);

    harness.transport.setDecisionNarratives(['REPORT', 'PUBLIC_ALERT', 'EXPLANATION']);
    harness.scheduler.runTimer(DEFAULT_POLLING_INTERVAL_MS);
    await flush();
    expect(harness.cycles[1]?.outcomes).toHaveLength(1);

    harness.scheduler.runTimer(DEFAULT_POLLING_INTERVAL_MS);
    await flush();
    expect(harness.cycles[2]?.outcomes).toHaveLength(0);
    expect(harness.transport.callsFor(`decisions/${DECISION_ID}`)).toBe(2);

    harness.polling.stop();
  });
});
