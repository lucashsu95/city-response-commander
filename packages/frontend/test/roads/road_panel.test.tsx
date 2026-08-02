/**
 * Road Panel Presentation Tests (TASK-125)
 *
 * Verifies loading/ready/empty/insufficient/error rendering and the
 * server-level → red/yellow/neutral visual mapping, including deliberately
 * inconsistent saturation fixtures that prove the UI never recomputes the
 * classification.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RoadPanel } from '../../src/roads/road_panel.js';
import type { RoadTrafficState } from '../../src/roads/use_road_traffic.js';
import type { RoadReadModel, RoadSegmentView } from '../../src/roads/road_model.js';

function baseSegment(overrides: Partial<RoadSegmentView> = {}): RoadSegmentView {
  return {
    segmentId: 'RD_TPE_001',
    roadName: '市民大道',
    saturationScore: 0.5,
    level: 'A',
    laneStatus: 'normal',
    observationTimestamp: null,
    stalenessMinutes: null,
    dataStatus: null,
    ...overrides,
  };
}

function baseModel(segments: readonly RoadSegmentView[], overrides: Partial<RoadReadModel> = {}): RoadReadModel {
  return {
    schemaVersion: '1.0',
    traceId: 'tr-roads',
    segments,
    timestamp: '2026-05-20 22:10',
    provisional: true,
    dataStatus: null,
    ...overrides,
  };
}

function state(overrides: Partial<RoadTrafficState> = {}): RoadTrafficState {
  return {
    state: 'idle',
    model: null,
    refreshStatus: 'idle',
    error: null,
    ...overrides,
  };
}

describe('RoadPanel', () => {
  it('32. renders the loading state', () => {
    render(<RoadPanel traffic={state({ state: 'loading' })} onRetry={vi.fn()} />);
    expect(screen.getByText('載入路段車流中')).toBeInTheDocument();
  });

  it('33. renders the error state with a retry control', () => {
    const onRetry = vi.fn();
    render(
      <RoadPanel
        traffic={state({ state: 'error', error: { code: 'REQUEST_FAILED', message: 'boom' } })}
        onRetry={onRetry}
      />,
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();
    screen.getByRole('button', { name: '重試' }).click();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders the empty state', () => {
    render(
      <RoadPanel traffic={state({ state: 'empty', model: baseModel([]) })} onRetry={vi.fn()} />,
    );
    expect(screen.getByText('目前無可顯示的路段資料')).toBeInTheDocument();
  });

  it('31. renders an explicit insufficient-data state', () => {
    render(
      <RoadPanel
        traffic={state({
          state: 'insufficient',
          model: baseModel([], { dataStatus: 'insufficient_data' }),
        })}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByText(/資料不足/)).toBeInTheDocument();
  });

  it('17. server level A renders the red indicator and A 級 text', () => {
    render(
      <RoadPanel
        traffic={state({ state: 'ready', model: baseModel([baseSegment({ level: 'A' })]) })}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByText('A 級')).toBeInTheDocument();
    expect(document.querySelector('.road-panel__level-dot--red')).not.toBeNull();
  });

  it('18. server level B renders the yellow indicator and B 級 text', () => {
    render(
      <RoadPanel
        traffic={state({ state: 'ready', model: baseModel([baseSegment({ level: 'B' })]) })}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByText('B 級')).toBeInTheDocument();
    expect(document.querySelector('.road-panel__level-dot--yellow')).not.toBeNull();
  });

  it('19. a non-A/B canonical value renders the neutral indicator', () => {
    render(
      <RoadPanel
        traffic={state({ state: 'ready', model: baseModel([baseSegment({ level: null })]) })}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByText('未分級')).toBeInTheDocument();
    expect(document.querySelector('.road-panel__level-dot--neutral')).not.toBeNull();
  });

  it('20. saturation 0.10 with level A still renders A/red (server truth wins)', () => {
    render(
      <RoadPanel
        traffic={state({
          state: 'ready',
          model: baseModel([baseSegment({ saturationScore: 0.1, level: 'A' })]),
        })}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByText('A 級')).toBeInTheDocument();
    expect(document.querySelector('.road-panel__level-dot--red')).not.toBeNull();
    expect(screen.getByText(/0\.1/)).toBeInTheDocument();
  });

  it('21. saturation 0.99 with level B still renders B/yellow (server truth wins)', () => {
    render(
      <RoadPanel
        traffic={state({
          state: 'ready',
          model: baseModel([baseSegment({ saturationScore: 0.99, level: 'B' })]),
        })}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByText('B 級')).toBeInTheDocument();
    expect(document.querySelector('.road-panel__level-dot--yellow')).not.toBeNull();
    expect(screen.getByText(/0\.99/)).toBeInTheDocument();
  });

  it('23/24. renders all 15 returned segments in original order', () => {
    const segments = Array.from({ length: 15 }, (_, index) =>
      baseSegment({ segmentId: `RD_${index}`, roadName: `Road ${index}` }),
    );
    render(
      <RoadPanel traffic={state({ state: 'ready', model: baseModel(segments) })} onRetry={vi.fn()} />,
    );
    const rows = document.querySelectorAll('.road-panel__row');
    expect(rows).toHaveLength(15);
    expect([...rows].map((row) => row.getAttribute('data-segment-id'))).toEqual(
      segments.map((s) => s.segmentId),
    );
  });

  it('26/27. server observation timestamp and staleness display verbatim', () => {
    render(
      <RoadPanel
        traffic={state({
          state: 'ready',
          model: baseModel([
            baseSegment({ observationTimestamp: '2026-05-20 21:50', stalenessMinutes: 20 }),
          ]),
        })}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByText(/2026-05-20 21:50/)).toBeInTheDocument();
    expect(screen.getByText(/20 分鐘/)).toBeInTheDocument();
  });

  it('28. missing provenance displays an unavailable indicator', () => {
    render(
      <RoadPanel
        traffic={state({
          state: 'ready',
          model: baseModel([baseSegment({ observationTimestamp: null, stalenessMinutes: null })]),
        })}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByText(/provenance 未提供/)).toBeInTheDocument();
  });

  it('34. a background refresh does not remove existing ready content', () => {
    render(
      <RoadPanel
        traffic={state({
          state: 'ready',
          model: baseModel([baseSegment()]),
          refreshStatus: 'refreshing',
        })}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByText('市民大道')).toBeInTheDocument();
    expect(screen.getByText('背景更新中…')).toBeInTheDocument();
  });

  it('35. colour is not the only classification signal (text label present alongside dot)', () => {
    render(
      <RoadPanel
        traffic={state({ state: 'ready', model: baseModel([baseSegment({ level: 'A' })]) })}
        onRetry={vi.fn()}
      />,
    );
    const dot = document.querySelector('.road-panel__level-dot--red');
    expect(dot).not.toBeNull();
    expect(dot?.getAttribute('aria-hidden')).toBe('true');
    expect(screen.getByText('A 級')).toBeInTheDocument();
  });
});
