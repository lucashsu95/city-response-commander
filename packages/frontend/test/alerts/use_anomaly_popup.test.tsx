/**
 * Anomaly Popup Controller Tests (TASK-127)
 *
 * Deterministic: no real timers, no HTTP, no sockets, no sleeping. The
 * controller is driven directly through its ingest surface, which is exactly
 * how the dashboard drives it.
 */

import { describe, it, expect } from 'vitest';
import { act, render } from '@testing-library/react';
import { type ReactNode } from 'react';
import { ANOMALY_EVENT_TYPE } from '../../src/alerts/anomaly_model.js';
import { useAnomalyPopup } from '../../src/alerts/use_anomaly_popup.js';
import type { AnomalyPopupController } from '../../src/alerts/use_anomaly_popup.js';
import type { RealtimeEventEnvelope } from '../../src/realtime/transport_events.js';

// ─── Harness ─────────────────────────────────────────────────

interface Harness {
  controller(): AnomalyPopupController;
  renderCount(): number;
  rerender(): void;
  unmount(): void;
}

function mountController(): Harness {
  let latest: AnomalyPopupController | null = null;
  let renders = 0;

  function Probe(): ReactNode {
    latest = useAnomalyPopup();
    renders += 1;
    return null;
  }

  const view = render(<Probe />);

  return {
    controller(): AnomalyPopupController {
      if (latest === null) {
        throw new Error('controller not mounted');
      }
      return latest;
    },
    renderCount: () => renders,
    rerender: () => {
      view.rerender(<Probe />);
    },
    unmount: () => {
      view.unmount();
    },
  };
}

// ─── Fixtures ────────────────────────────────────────────────

function anomalyEnvelope(overrides: Record<string, unknown> = {}): RealtimeEventEnvelope {
  return {
    eventType: ANOMALY_EVENT_TYPE,
    decisionId: null,
    eventId: null,
    occurredAt: null,
    readyEventId: null,
    payload: {
      schema_version: '1.0.0',
      trace_id: 'tr-anomaly-1',
      occurred_at: '2026-05-20 22:10',
      provisional: true,
      policy_version: 'prov-2026a',
      event_type: ANOMALY_EVENT_TYPE,
      anomaly_type: 'ROAD_SATURATION',
      segment_or_station_id: 'RD_TPE_0007',
      threshold: 'SOP-1 A 級',
      value: 0.97,
      summary: '中山北路南下車道已達癱瘓等級。',
      ...overrides,
    },
  };
}

function malformedEnvelope(): RealtimeEventEnvelope {
  return {
    eventType: ANOMALY_EVENT_TYPE,
    decisionId: null,
    eventId: null,
    occurredAt: null,
    readyEventId: null,
    payload: { event_type: ANOMALY_EVENT_TYPE, summary: 'no other required field' },
  };
}

function roadsBody(level: string | null, timestamp = '2026-05-20 22:10'): unknown {
  return {
    schema_version: '1.0.0',
    trace_id: 'tr-roads-1',
    segments: [
      {
        segment_id: 'RD_TPE_0007',
        road_name: '中山北路',
        // Contradictory on purpose: the score never decides anything.
        saturation_score: level === null ? 0.99 : 0.1,
        level,
        lane_status: 'Congested',
      },
    ],
    timestamp,
    provisional: false,
  };
}

function crowdBody(flags: readonly string[], cutoff = '2026-05-20 22:10'): unknown {
  return {
    schema_version: '1.0.0',
    trace_id: 'tr-crowd-1',
    data_status: 'ready',
    stations: [
      {
        BS_ID: 'BS_0031',
        Location_Name: '台北車站',
        User_Count: flags.length === 0 ? 999_999 : 1,
        Growth_Rate: 0,
        roaming_pct_value: flags.length === 0 ? 0.99 : 0.001,
        Roaming_User_Pct: flags.length === 0 ? '99%' : '0.1%',
        flags,
      },
    ],
    decision_cutoff_timestamp: cutoff,
    provisional: false,
  };
}

// ─── Tests ───────────────────────────────────────────────────

describe('useAnomalyPopup (TASK-127)', () => {
  it('1. starts closed with no anomaly', () => {
    const harness = mountController();

    expect(harness.controller().isOpen).toBe(false);
    expect(harness.controller().current).toBeNull();

    harness.unmount();
  });

  it('2/3. a valid realtime anomaly opens the popup with no click and no query', () => {
    const harness = mountController();

    act(() => {
      harness.controller().ingestRealtimeEvent(anomalyEnvelope());
    });

    expect(harness.controller().isOpen).toBe(true);
    expect(harness.controller().current?.source).toBe('realtime');
    expect(harness.controller().current?.summary).toBe('中山北路南下車道已達癱瘓等級。');

    harness.unmount();
  });

  it('5. a malformed realtime frame fails closed and leaves state untouched', () => {
    const harness = mountController();

    act(() => {
      harness.controller().ingestRealtimeEvent(malformedEnvelope());
    });

    expect(harness.controller().isOpen).toBe(false);
    expect(harness.controller().current).toBeNull();

    harness.unmount();
  });

  it('a non-anomaly realtime event type is ignored', () => {
    const harness = mountController();

    act(() => {
      harness.controller().ingestRealtimeEvent({
        ...anomalyEnvelope(),
        eventType: 'timeline.updated' as RealtimeEventEnvelope['eventType'],
      });
    });

    expect(harness.controller().isOpen).toBe(false);

    harness.unmount();
  });

  it('6. a resent realtime frame with the same identity opens the popup only once', () => {
    const harness = mountController();

    act(() => {
      harness.controller().ingestRealtimeEvent(anomalyEnvelope());
    });
    act(() => {
      harness.controller().dismiss();
    });
    act(() => {
      harness.controller().ingestRealtimeEvent(anomalyEnvelope());
    });

    expect(harness.controller().isOpen).toBe(false);

    harness.unmount();
  });

  it('7. dismissing keeps the same identity from reopening', () => {
    const harness = mountController();

    act(() => {
      harness.controller().ingestRealtimeEvent(anomalyEnvelope());
    });
    expect(harness.controller().isOpen).toBe(true);

    act(() => {
      harness.controller().dismiss();
    });
    expect(harness.controller().isOpen).toBe(false);
    // The dismissed anomaly is still readable, it is just not on screen.
    expect(harness.controller().current?.entityId).toBe('RD_TPE_0007');

    act(() => {
      harness.controller().ingestRealtimeEvent(anomalyEnvelope());
    });
    expect(harness.controller().isOpen).toBe(false);

    harness.unmount();
  });

  it('8. a new identity reopens the popup', () => {
    const harness = mountController();

    act(() => {
      harness.controller().ingestRealtimeEvent(anomalyEnvelope());
    });
    act(() => {
      harness.controller().dismiss();
    });
    act(() => {
      harness
        .controller()
        .ingestRealtimeEvent(anomalyEnvelope({ occurred_at: '2026-05-20 22:20' }));
    });

    expect(harness.controller().isOpen).toBe(true);
    expect(harness.controller().current?.observedAt).toBe('2026-05-20 22:20');

    harness.unmount();
  });

  it('10. the first active roads polling sample opens the popup once', () => {
    const harness = mountController();

    act(() => {
      harness.controller().ingestPolledRoads(roadsBody('A'));
    });

    expect(harness.controller().isOpen).toBe(true);
    expect(harness.controller().current?.source).toBe('roads');
    expect(harness.controller().current?.category).toBe('A');

    harness.unmount();
  });

  it('11. inactive -> active opens the popup', () => {
    const harness = mountController();

    act(() => {
      harness.controller().ingestPolledRoads(roadsBody(null));
    });
    expect(harness.controller().isOpen).toBe(false);

    act(() => {
      harness.controller().ingestPolledRoads(roadsBody('A'));
    });
    expect(harness.controller().isOpen).toBe(true);

    harness.unmount();
  });

  it('12. active -> active does not reopen after a dismiss', () => {
    const harness = mountController();

    act(() => {
      harness.controller().ingestPolledRoads(roadsBody('A'));
    });
    act(() => {
      harness.controller().dismiss();
    });

    // Repeated sustained samples, including one with a fresh envelope
    // timestamp: a sustained backend verdict never re-alerts.
    act(() => {
      harness.controller().ingestPolledRoads(roadsBody('A'));
      harness.controller().ingestPolledRoads(roadsBody('A', '2026-05-20 22:12'));
      harness.controller().ingestPolledRoads(roadsBody('B', '2026-05-20 22:14'));
    });

    expect(harness.controller().isOpen).toBe(false);

    harness.unmount();
  });

  it('13. active -> inactive re-arms so a later active opens again', () => {
    const harness = mountController();

    act(() => {
      harness.controller().ingestPolledRoads(roadsBody('A'));
    });
    act(() => {
      harness.controller().dismiss();
    });

    // Backend reports recovery.
    act(() => {
      harness.controller().ingestPolledRoads(roadsBody(null));
    });
    expect(harness.controller().isOpen).toBe(false);

    // Same identity recurring after a genuine recovery must alert again.
    act(() => {
      harness.controller().ingestPolledRoads(roadsBody('A'));
    });
    expect(harness.controller().isOpen).toBe(true);

    harness.unmount();
  });

  it('inactive -> inactive never opens the popup', () => {
    const harness = mountController();

    act(() => {
      harness.controller().ingestPolledRoads(roadsBody(null));
      harness.controller().ingestPolledRoads(roadsBody(null));
    });

    expect(harness.controller().isOpen).toBe(false);

    harness.unmount();
  });

  it('14. a failed polling request never reaches the controller, so state is preserved', () => {
    const harness = mountController();

    act(() => {
      harness.controller().ingestPolledRoads(roadsBody('A'));
    });
    const openedIdentity = harness.controller().current?.identity;

    // The dashboard only ingests successful outcomes; a failed cycle simply
    // produces no ingest call at all.
    act(() => {
      harness.rerender();
    });

    expect(harness.controller().isOpen).toBe(true);
    expect(harness.controller().current?.identity).toBe(openedIdentity);

    harness.unmount();
  });

  it('15. a malformed polling payload fails closed without overwriting prior state', () => {
    const harness = mountController();

    act(() => {
      harness.controller().ingestPolledRoads(roadsBody('A'));
    });
    const openedIdentity = harness.controller().current?.identity;

    act(() => {
      harness.controller().ingestPolledRoads({ nonsense: true });
      harness.controller().ingestPolledRoads(null);
      harness.controller().ingestPolledCrowd('not json');
    });

    expect(harness.controller().isOpen).toBe(true);
    expect(harness.controller().current?.identity).toBe(openedIdentity);

    harness.unmount();
  });

  it('15b. a malformed sample does not re-arm a channel', () => {
    const harness = mountController();

    act(() => {
      harness.controller().ingestPolledRoads(roadsBody('A'));
    });
    act(() => {
      harness.controller().dismiss();
    });

    // A malformed payload must not be read as "recovered".
    act(() => {
      harness.controller().ingestPolledRoads({ nonsense: true });
    });
    act(() => {
      harness.controller().ingestPolledRoads(roadsBody('A'));
    });

    expect(harness.controller().isOpen).toBe(false);

    harness.unmount();
  });

  it('18/19. the crowd channel follows backend flags, not raw metrics', () => {
    const harness = mountController();

    // Very high raw metrics, no backend flag: nothing happens.
    act(() => {
      harness.controller().ingestPolledCrowd(crowdBody([]));
    });
    expect(harness.controller().isOpen).toBe(false);

    // Backend flag with minimal raw metrics: alerts.
    act(() => {
      harness.controller().ingestPolledCrowd(crowdBody(['SOP3_CROWD_SURGE']));
    });
    expect(harness.controller().isOpen).toBe(true);
    expect(harness.controller().current?.source).toBe('crowd');

    harness.unmount();
  });

  it('20. the same anomaly arriving over realtime and polling opens one popup', () => {
    const harness = mountController();

    act(() => {
      harness
        .controller()
        .ingestRealtimeEvent(
          anomalyEnvelope({ segment_or_station_id: 'RD_TPE_0007', occurred_at: '2026-05-20 22:10' }),
        );
    });
    expect(harness.controller().isOpen).toBe(true);
    expect(harness.controller().current?.source).toBe('realtime');

    act(() => {
      harness.controller().dismiss();
    });

    // Identical entity + observation instant over the polling channel.
    act(() => {
      harness.controller().ingestPolledRoads(roadsBody('A', '2026-05-20 22:10'));
    });

    expect(harness.controller().isOpen).toBe(false);

    harness.unmount();
  });

  it('the two polling channels track their signals independently', () => {
    const harness = mountController();

    act(() => {
      harness.controller().ingestPolledRoads(roadsBody('A'));
    });
    act(() => {
      harness.controller().dismiss();
    });

    // Roads stays active; crowd becoming active is a separate occurrence.
    act(() => {
      harness.controller().ingestPolledRoads(roadsBody('A'));
      harness.controller().ingestPolledCrowd(crowdBody(['SOP3_CROWD_SURGE']));
    });

    expect(harness.controller().isOpen).toBe(true);
    expect(harness.controller().current?.source).toBe('crowd');

    harness.unmount();
  });

  it('ordinary rerenders keep every ingest function referentially stable', () => {
    const harness = mountController();
    const before = harness.controller();

    act(() => {
      harness.rerender();
    });
    act(() => {
      harness.controller().ingestPolledRoads(roadsBody(null));
    });
    const after = harness.controller();

    expect(after.ingestRealtimeEvent).toBe(before.ingestRealtimeEvent);
    expect(after.ingestPolledRoads).toBe(before.ingestPolledRoads);
    expect(after.ingestPolledCrowd).toBe(before.ingestPolledCrowd);
    expect(after.dismiss).toBe(before.dismiss);

    harness.unmount();
  });

  it('28. ingesting after unmount performs no state update and throws nothing', () => {
    const harness = mountController();
    const controller = harness.controller();

    harness.unmount();
    const rendersAfterUnmount = harness.renderCount();

    expect(() => {
      controller.ingestRealtimeEvent(anomalyEnvelope());
      controller.ingestPolledRoads(roadsBody('A'));
      controller.ingestPolledCrowd(crowdBody(['SOP3_CROWD_SURGE']));
      controller.dismiss();
    }).not.toThrow();

    expect(harness.renderCount()).toBe(rendersAfterUnmount);
  });
});
