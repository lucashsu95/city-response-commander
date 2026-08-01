/**
 * Operations Map Component Tests (Dashboard Operations Map)
 *
 * Covers the mandated states (loading/empty/error/insufficient/degraded), the
 * schematic disclosure text, the red/yellow/neutral road mapping, the
 * active/stale crowd distinction, click and keyboard selection revealing
 * entity id/server status/timestamp, and the SVG's accessible label.
 */

import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { OperationsMap } from '../../src/map/operations_map.js';
import type { RoadTrafficState } from '../../src/roads/use_road_traffic.js';
import type { RoadReadModel, RoadSegmentView } from '../../src/roads/road_model.js';
import type { CrowdSnapshotState } from '../../src/crowd/use_crowd_snapshot.js';
import type { CrowdStationRow } from '../../src/crowd/crowd_model.js';

function roadSegment(overrides: Partial<RoadSegmentView> = {}): RoadSegmentView {
  return {
    segmentId: 'RD_TPE_002',
    roadName: '光復南路',
    saturationScore: 1,
    level: 'A',
    laneStatus: 'Closed',
    observationTimestamp: '2026-05-20 22:00',
    stalenessMinutes: 0,
    dataStatus: 'ready',
    ...overrides,
  };
}

function roadModel(
  segments: readonly RoadSegmentView[],
  overrides: Partial<RoadReadModel> = {},
): RoadReadModel {
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

function roadState(overrides: Partial<RoadTrafficState> = {}): RoadTrafficState {
  return {
    state: 'idle',
    model: null,
    refreshStatus: 'idle',
    error: null,
    ...overrides,
  };
}

function crowdStation(overrides: Partial<CrowdStationRow> = {}): CrowdStationRow {
  return {
    bsId: 'BS_MRT_BL17',
    locationName: '捷運 BL17 站',
    userCount: 31000,
    growthRate: 0.42,
    roamingPctValue: 0.45,
    roamingPctDisplay: '45%',
    flags: [],
    inMultilingualScope: true,
    observationTimestamp: '2026-05-20 22:00',
    exactMatch: false,
    stalenessMinutes: 5,
    stale: false,
    dataStatus: 'ready',
    ...overrides,
  };
}

function crowdState(overrides: Partial<CrowdSnapshotState> = {}): CrowdSnapshotState {
  return {
    state: 'idle',
    stations: [],
    multilingual: null,
    policy: null,
    decisionCutoffTimestamp: null,
    stopReason: null,
    provisional: null,
    schemaVersion: null,
    traceId: null,
    refreshStatus: 'idle',
    error: null,
    ...overrides,
  };
}

function noop(): void {
  // intentionally empty
}

describe('OperationsMap — mandated states', () => {
  it('renders the loading state for roads', () => {
    render(
      <OperationsMap
        roads={roadState({ state: 'loading' })}
        crowd={crowdState({ state: 'idle' })}
        currentTimestamp={null}
      />,
    );

    expect(screen.getByText('載入路段中')).toBeInTheDocument();
  });

  it('renders the loading state for crowd', () => {
    render(
      <OperationsMap
        roads={roadState({ state: 'idle' })}
        crowd={crowdState({ state: 'loading' })}
        currentTimestamp={null}
      />,
    );

    expect(screen.getByText('載入基地台中')).toBeInTheDocument();
  });

  it('renders the empty state for roads without fabricating an entity', () => {
    render(
      <OperationsMap
        roads={roadState({ state: 'empty', model: roadModel([]) })}
        crowd={crowdState({ state: 'idle' })}
        currentTimestamp={null}
      />,
    );

    expect(screen.getByText(/目前無路段資料可顯示/)).toBeInTheDocument();
    expect(screen.queryByTestId('operations-map-svg')).toBeNull();
  });

  it('renders the error state for a failed roads read', () => {
    render(
      <OperationsMap
        roads={roadState({ state: 'error', error: { code: 'REQUEST_FAILED', message: 'boom' } })}
        crowd={crowdState({ state: 'idle' })}
        currentTimestamp={null}
      />,
    );

    expect(screen.getByText(/路段讀取失敗/)).toBeInTheDocument();
  });

  it('renders the insufficient state for roads distinctly from empty/error', () => {
    render(
      <OperationsMap
        roads={roadState({ state: 'insufficient', model: roadModel([]) })}
        crowd={crowdState({ state: 'idle' })}
        currentTimestamp={null}
      />,
    );

    expect(screen.getByText(/路段資料不足（insufficient_data）/)).toBeInTheDocument();
  });

  it('renders the insufficient_data state for crowd', () => {
    render(
      <OperationsMap
        roads={roadState({ state: 'idle' })}
        crowd={crowdState({ state: 'insufficient_data', stations: [] })}
        currentTimestamp={null}
      />,
    );

    expect(screen.getByText(/基地台資料不足（insufficient_data）/)).toBeInTheDocument();
  });

  it('renders the degraded notice only when the degraded flag is set', () => {
    const view = render(
      <OperationsMap
        roads={roadState({ state: 'idle' })}
        crowd={crowdState({ state: 'idle' })}
        currentTimestamp={null}
        degraded
      />,
    );

    expect(screen.getByTestId('map-degraded-notice')).toBeInTheDocument();

    view.rerender(
      <OperationsMap
        roads={roadState({ state: 'idle' })}
        crowd={crowdState({ state: 'idle' })}
        currentTimestamp={null}
        degraded={false}
      />,
    );
    expect(screen.queryByTestId('map-degraded-notice')).toBeNull();
  });
});

describe('OperationsMap — schematic disclosure', () => {
  it('always shows the "營運示意圖，非實際地理比例" disclosure', () => {
    render(
      <OperationsMap
        roads={roadState()}
        crowd={crowdState()}
        currentTimestamp={null}
      />,
    );

    expect(screen.getByTestId('map-schematic-disclosure').textContent).toBe(
      '營運示意圖，非實際地理比例',
    );
  });

  it('shows the current timeline timestamp verbatim', () => {
    render(
      <OperationsMap
        roads={roadState()}
        crowd={crowdState()}
        currentTimestamp="2026-05-20 22:10"
      />,
    );

    expect(screen.getByTestId('map-current-timestamp').textContent).toContain('2026-05-20 22:10');
  });

  it('shows an explicit unavailable marker when no timeline position exists yet', () => {
    render(
      <OperationsMap roads={roadState()} crowd={crowdState()} currentTimestamp={null} />,
    );

    expect(screen.getByTestId('map-current-timestamp').textContent).toContain('未提供');
  });
});

describe('OperationsMap — road red/yellow/neutral mapping (server truth only)', () => {
  function renderWithRoad(level: string | null) {
    return render(
      <OperationsMap
        roads={roadState({ state: 'ready', model: roadModel([roadSegment({ level })]) })}
        crowd={crowdState()}
        currentTimestamp={null}
      />,
    );
  }

  it('renders an A-level road as the red shape', () => {
    renderWithRoad('A');
    const shape = document.querySelector('[data-entity-kind="road"] rect');
    expect(shape).toHaveAttribute('fill', '#ef4444');
  });

  it('renders a B-level road as the yellow shape', () => {
    renderWithRoad('B');
    const shape = document.querySelector('[data-entity-kind="road"] rect');
    expect(shape).toHaveAttribute('fill', '#eab308');
  });

  it('renders a null-level road as the neutral shape', () => {
    renderWithRoad(null);
    const shape = document.querySelector('[data-entity-kind="road"] rect');
    expect(shape).toHaveAttribute('fill', '#64748b');
  });

  it('renders A level red even with a low saturation_score fixture (server truth wins)', () => {
    render(
      <OperationsMap
        roads={roadState({
          state: 'ready',
          model: roadModel([roadSegment({ saturationScore: 0.02, level: 'A' })]),
        })}
        crowd={crowdState()}
        currentTimestamp={null}
      />,
    );

    const shape = document.querySelector('[data-entity-kind="road"] rect');
    expect(shape).toHaveAttribute('fill', '#ef4444');
  });
});

describe('OperationsMap — crowd active/stale visual distinction', () => {
  it('renders an active-flag station distinctly from an idle one', () => {
    render(
      <OperationsMap
        roads={roadState()}
        crowd={crowdState({
          state: 'ready',
          stations: [
            crowdStation({ bsId: 'BS_ACTIVE', flags: ['SOP3_MRT_SHUTTLE'] }),
            crowdStation({ bsId: 'BS_IDLE', flags: [] }),
          ],
        })}
        currentTimestamp={null}
      />,
    );

    const active = document.querySelector('[data-entity-id="BS_ACTIVE"] circle');
    const idle = document.querySelector('[data-entity-id="BS_IDLE"] circle');
    expect(active).toHaveClass('operations-map__crowd-marker--active');
    expect(idle).toHaveClass('operations-map__crowd-marker--idle');
  });

  it('renders a stale station with a dashed stroke, distinct from a fresh one', () => {
    render(
      <OperationsMap
        roads={roadState()}
        crowd={crowdState({
          state: 'ready',
          stations: [
            crowdStation({ bsId: 'BS_STALE', stale: true }),
            crowdStation({ bsId: 'BS_FRESH', stale: false }),
          ],
        })}
        currentTimestamp={null}
      />,
    );

    const stale = document.querySelector('[data-entity-id="BS_STALE"] circle');
    const fresh = document.querySelector('[data-entity-id="BS_FRESH"] circle');
    expect(stale).toHaveAttribute('stroke-dasharray', '4 3');
    expect(fresh).not.toHaveAttribute('stroke-dasharray');
  });
});

describe('OperationsMap — selection reveals entity id / server status / timestamp', () => {
  it('shows the empty detail panel before any selection', () => {
    render(
      <OperationsMap
        roads={roadState({ state: 'ready', model: roadModel([roadSegment()]) })}
        crowd={crowdState()}
        currentTimestamp={null}
      />,
    );

    expect(screen.getByTestId('map-detail-empty')).toBeInTheDocument();
  });

  it('reveals the road entity id, server status, and timestamp on click', () => {
    render(
      <OperationsMap
        roads={roadState({
          state: 'ready',
          model: roadModel([
            roadSegment({
              segmentId: 'RD_TPE_002',
              level: 'A',
              observationTimestamp: '2026-05-20 22:00',
            }),
          ]),
        })}
        crowd={crowdState()}
        currentTimestamp={null}
      />,
    );

    fireEvent.click(screen.getByTestId('map-entity-road:RD_TPE_002'));

    expect(screen.getByTestId('map-detail-entity-id').textContent).toBe('RD_TPE_002');
    expect(screen.getByTestId('map-detail-server-status').textContent).toContain('A');
    expect(screen.getByTestId('map-detail-timestamp').textContent).toBe('2026-05-20 22:00');
  });

  it('reveals the crowd station id, flags, and timestamp on click', () => {
    render(
      <OperationsMap
        roads={roadState()}
        crowd={crowdState({
          state: 'ready',
          stations: [
            crowdStation({
              bsId: 'BS_MRT_BL17',
              flags: ['SOP3_MRT_SHUTTLE'],
              observationTimestamp: '2026-05-20 22:15',
            }),
          ],
        })}
        currentTimestamp={null}
      />,
    );

    fireEvent.click(screen.getByTestId('map-entity-crowd_station:BS_MRT_BL17'));

    expect(screen.getByTestId('map-detail-entity-id').textContent).toBe('BS_MRT_BL17');
    expect(screen.getByTestId('map-detail-server-status').textContent).toContain(
      'SOP3_MRT_SHUTTLE',
    );
    expect(screen.getByTestId('map-detail-timestamp').textContent).toBe('2026-05-20 22:15');
  });

  it('supports keyboard activation with Enter', () => {
    render(
      <OperationsMap
        roads={roadState({
          state: 'ready',
          model: roadModel([roadSegment({ segmentId: 'RD_KB' })]),
        })}
        crowd={crowdState()}
        currentTimestamp={null}
      />,
    );

    const shape = screen.getByTestId('map-entity-road:RD_KB');
    fireEvent.keyDown(shape, { key: 'Enter' });

    expect(screen.getByTestId('map-detail-entity-id').textContent).toBe('RD_KB');
  });

  it('supports keyboard activation with Space', () => {
    render(
      <OperationsMap
        roads={roadState({
          state: 'ready',
          model: roadModel([roadSegment({ segmentId: 'RD_SPACE' })]),
        })}
        crowd={crowdState()}
        currentTimestamp={null}
      />,
    );

    const shape = screen.getByTestId('map-entity-road:RD_SPACE');
    fireEvent.keyDown(shape, { key: ' ' });

    expect(screen.getByTestId('map-detail-entity-id').textContent).toBe('RD_SPACE');
  });

  it('every selectable entity is reachable by tab order (tabIndex=0)', () => {
    render(
      <OperationsMap
        roads={roadState({
          state: 'ready',
          model: roadModel([roadSegment({ segmentId: 'RD_TAB' })]),
        })}
        crowd={crowdState({ state: 'ready', stations: [crowdStation({ bsId: 'BS_TAB' })] })}
        currentTimestamp={null}
      />,
    );

    expect(screen.getByTestId('map-entity-road:RD_TAB')).toHaveAttribute('tabindex', '0');
    expect(screen.getByTestId('map-entity-crowd_station:BS_TAB')).toHaveAttribute('tabindex', '0');
  });
});

describe('OperationsMap — accessibility', () => {
  it('exposes an accessible label on the SVG summarizing entity counts', () => {
    render(
      <OperationsMap
        roads={roadState({
          state: 'ready',
          model: roadModel([roadSegment(), roadSegment({ segmentId: 'RD_2' })]),
        })}
        crowd={crowdState({ state: 'ready', stations: [crowdStation()] })}
        currentTimestamp={null}
      />,
    );

    const svg = screen.getByTestId('operations-map-svg');
    expect(svg).toHaveAttribute('role', 'img');
    expect(svg.getAttribute('aria-label')).toContain('2 個路段');
    expect(svg.getAttribute('aria-label')).toContain('1 個基地台');
  });

  it('gives each entity shape a descriptive aria-label with entity id and server status', () => {
    render(
      <OperationsMap
        roads={roadState({
          state: 'ready',
          model: roadModel([roadSegment({ segmentId: 'RD_A11Y', level: 'B' })]),
        })}
        crowd={crowdState()}
        currentTimestamp={null}
      />,
    );

    const shape = screen.getByTestId('map-entity-road:RD_A11Y');
    expect(shape.getAttribute('aria-label')).toContain('RD_A11Y');
    expect(shape.getAttribute('aria-label')).toContain('B');
  });

  it('exposes an accessible legend group', () => {
    render(
      <OperationsMap roads={roadState()} crowd={crowdState()} currentTimestamp={null} />,
    );

    expect(screen.getByRole('group', { name: '地圖圖例' })).toBeInTheDocument();
  });
});

describe('OperationsMap — no fabricated data', () => {
  it('never renders a road or crowd entity that the backend did not supply', () => {
    render(
      <OperationsMap
        roads={roadState({ state: 'ready', model: roadModel([]) })}
        crowd={crowdState({ state: 'ready', stations: [] })}
        currentTimestamp={null}
      />,
    );

    expect(document.querySelectorAll('[data-entity-kind]')).toHaveLength(0);
  });

  it('renders exactly the number of entities the backend supplied, no more', () => {
    render(
      <OperationsMap
        roads={roadState({
          state: 'ready',
          model: roadModel([roadSegment({ segmentId: 'A' }), roadSegment({ segmentId: 'B' })]),
        })}
        crowd={crowdState({ state: 'ready', stations: [crowdStation({ bsId: 'C' })] })}
        currentTimestamp={null}
      />,
    );

    expect(document.querySelectorAll('[data-entity-kind="road"]')).toHaveLength(2);
    expect(document.querySelectorAll('[data-entity-kind="crowd_station"]')).toHaveLength(1);
  });
});
