/**
 * Crowd Panel Presentation Tests (TASK-126, state matrix per TASK-135)
 *
 * Covers every UX state (loading / empty / error / insufficient_data / stale /
 * provisional badge / background refresh) and asserts the panel never recomputes
 * an SOP threshold: flags, stale, scope membership and the art.6 verdict are
 * rendered from backend truth only.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CrowdPanel } from '../../src/crowd/crowd_panel.js';
import type { CrowdStationRow } from '../../src/crowd/crowd_model.js';
import type { CrowdSnapshotState } from '../../src/crowd/use_crowd_snapshot.js';

function station(overrides: Partial<CrowdStationRow> = {}): CrowdStationRow {
  return {
    bsId: 'BS_MRT_BL17',
    locationName: '捷運 BL17 站',
    userCount: 31000,
    growthRate: 0.42,
    roamingPctValue: 0.45,
    roamingPctDisplay: '45%',
    flags: ['SOP3_MRT_SHUTTLE'],
    inMultilingualScope: true,
    observationTimestamp: '2026-05-20 22:15',
    exactMatch: false,
    stalenessMinutes: 5,
    stale: true,
    dataStatus: 'ready',
    ...overrides,
  };
}

function snapshot(overrides: Partial<CrowdSnapshotState> = {}): CrowdSnapshotState {
  return {
    state: 'ready',
    stations: [station()],
    multilingual: {
      triggered: true,
      multilingualRequired: true,
      triggeringStationIds: ['BS_MRT_BL17'],
      dataStatus: 'ready',
      scopeMode: 'current_snapshot_all_available_stations',
      stationsInScope: ['BS_MRT_BL17'],
    },
    policy: {
      classification: 'PROVISIONAL_TEAM_POLICY',
      status: 'AWAITING_HOST_REPLY',
      isOfficial: false,
      guidanceId: 'HG-001',
      multilingualScopeMode: 'current_snapshot_all_available_stations',
    },
    decisionCutoffTimestamp: '2026-05-20 22:20',
    stopReason: null,
    provisional: true,
    schemaVersion: '1.0',
    traceId: 'tr-crowd-1',
    refreshStatus: 'idle',
    error: null,
    ...overrides,
  };
}

function noop(): void {
  // intentionally empty
}

function rowFor(bsId: string): HTMLElement | null {
  return document.querySelector(`[data-station-id="${bsId}"]`);
}

describe('CrowdPanel — UX state matrix', () => {
  it('renders the loading state', () => {
    render(<CrowdPanel snapshot={snapshot({ state: 'loading' })} onRetry={noop} />);

    expect(screen.getByText('載入基地台人流中')).toBeInTheDocument();
    expect(document.querySelector('.crowd-panel__table')).toBeNull();
  });

  it('renders the error state with a retry control', () => {
    const onRetry = vi.fn();
    render(
      <CrowdPanel
        snapshot={snapshot({
          state: 'error',
          stations: [],
          error: { code: 'REQUEST_FAILED', message: 'boom' },
        })}
        onRetry={onRetry}
      />,
    );

    expect(screen.getByRole('alert').textContent).toContain('boom');
    const retry = screen.getByRole('button', { name: '重試' });
    retry.click();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders the empty state without fabricating station rows', () => {
    render(<CrowdPanel snapshot={snapshot({ state: 'empty', stations: [] })} onRetry={noop} />);

    expect(screen.getByText('目前重播位置沒有可用的基地台觀測')).toBeInTheDocument();
    expect(document.querySelector('.crowd-panel__table')).toBeNull();
  });

  it('renders the insufficient_data state with the backend stop reason', () => {
    render(
      <CrowdPanel
        snapshot={snapshot({
          state: 'insufficient_data',
          stations: [],
          stopReason: 'source manifest hash mismatch',
        })}
        onRetry={noop}
      />,
    );

    expect(screen.getByText(/後端回報資料不足：source manifest hash mismatch/)).toBeInTheDocument();
    expect(document.querySelector('.crowd-panel__table')).toBeNull();
  });

  it('renders the provisional-policy badge and the OQ-005 scope policy', () => {
    render(<CrowdPanel snapshot={snapshot()} onRetry={noop} />);

    expect(screen.getByText('臨時團隊政策（尚待主辦確認，非官方規則）')).toBeInTheDocument();
    expect(screen.getByText('政策揭露（OQ-005）')).toBeInTheDocument();
    expect(screen.getByText('current_snapshot_all_available_stations')).toBeInTheDocument();
    expect(screen.getByText(/OQ-005 之站集範圍維度仍為開放議題/)).toBeInTheDocument();
  });

  it('states explicitly when the policy envelope was not supplied', () => {
    render(<CrowdPanel snapshot={snapshot({ policy: null, provisional: null })} onRetry={noop} />);

    expect(screen.getByText('後端未提供政策狀態')).toBeInTheDocument();
  });

  it('shows the stale indicator only when the backend says stale', () => {
    render(
      <CrowdPanel
        snapshot={snapshot({
          stations: [
            station({ bsId: 'BS_STALE', stale: true, stalenessMinutes: 5 }),
            station({ bsId: 'BS_FRESH', stale: false, stalenessMinutes: 0, exactMatch: true }),
          ],
        })}
        onRetry={noop}
      />,
    );

    expect(rowFor('BS_STALE')?.textContent).toContain('資料延遲');
    expect(rowFor('BS_FRESH')?.textContent).not.toContain('資料延遲');
  });

  it('shows an explicit unknown badge when the backend omitted the stale verdict', () => {
    render(
      <CrowdPanel
        snapshot={snapshot({ stations: [station({ stale: null, stalenessMinutes: null })] })}
        onRetry={noop}
      />,
    );

    expect(screen.getByText('延遲狀態未提供')).toBeInTheDocument();
  });

  it('keeps existing content while a background refresh is in flight', () => {
    render(<CrowdPanel snapshot={snapshot({ refreshStatus: 'refreshing' })} onRetry={noop} />);

    expect(screen.getByText('背景更新中…')).toBeInTheDocument();
    expect(rowFor('BS_MRT_BL17')).not.toBeNull();
  });

  it('keeps existing content when a background refresh fails', () => {
    render(
      <CrowdPanel
        snapshot={snapshot({ error: { code: 'REQUEST_FAILED', message: 'network blip' } })}
        onRetry={noop}
      />,
    );

    expect(screen.getByText(/背景更新失敗：network blip/)).toBeInTheDocument();
    expect(rowFor('BS_MRT_BL17')).not.toBeNull();
  });

  it('marks a per-station insufficient_data row', () => {
    render(
      <CrowdPanel
        snapshot={snapshot({
          stations: [
            station({
              bsId: 'BS_GAP',
              userCount: null,
              growthRate: null,
              roamingPctValue: null,
              roamingPctDisplay: null,
              observationTimestamp: null,
              stalenessMinutes: null,
              stale: false,
              flags: [],
              dataStatus: 'insufficient_data',
            }),
          ],
        })}
        onRetry={noop}
      />,
    );

    const row = rowFor('BS_GAP');
    expect(row?.textContent).toContain('資料不足');
    expect(row?.textContent).toContain('尚無資料');
    expect(row?.textContent).not.toContain('0%');
  });
});

describe('CrowdPanel — HG-001 evidence', () => {
  it('displays the observation timestamp, staleness and cutoff as YYYY-MM-DD HH:MM', () => {
    render(<CrowdPanel snapshot={snapshot()} onRetry={noop} />);

    expect(screen.getByText('2026-05-20 22:15')).toBeInTheDocument();
    expect(screen.getByText('2026-05-20 22:20')).toBeInTheDocument();
    expect(document.querySelector('.crowd-panel__staleness-minutes')?.textContent).toBe('5');
    expect(rowFor('BS_MRT_BL17')?.textContent).toContain('精確對齊：否');
  });

  it('shows an unavailable label instead of substituting a timestamp', () => {
    render(
      <CrowdPanel
        snapshot={snapshot({
          decisionCutoffTimestamp: null,
          stations: [station({ observationTimestamp: null, exactMatch: null })],
        })}
        onRetry={noop}
      />,
    );

    expect(document.querySelector('.crowd-panel__cutoff-value')?.textContent).toBe('尚無資料');
    expect(document.querySelector('.crowd-panel__observation')?.textContent).toBe('尚無資料');
  });
});

describe('CrowdPanel — no client-side threshold recompute', () => {
  it('does not add an SOP-3 flag for a station above the official numbers when the backend sent none', () => {
    render(
      <CrowdPanel
        snapshot={snapshot({
          // 31,000 users and +0.42 growth would trigger art.3 server-side; the
          // panel must still show only what the backend decided.
          stations: [station({ bsId: 'BS_MRT_BL17', flags: [] })],
        })}
        onRetry={noop}
      />,
    );

    const row = rowFor('BS_MRT_BL17');
    expect(row?.textContent).toContain('未觸發');
    expect(row?.querySelector('[data-flag="SOP3_MRT_SHUTTLE"]')).toBeNull();
  });

  it('does not add an SOP-6 flag for a 45% roaming station when the backend sent none', () => {
    render(
      <CrowdPanel
        snapshot={snapshot({
          stations: [
            station({
              bsId: 'BS_TPE_101',
              roamingPctValue: 0.45,
              roamingPctDisplay: '45%',
              flags: [],
              inMultilingualScope: true,
            }),
          ],
          multilingual: {
            triggered: false,
            multilingualRequired: false,
            triggeringStationIds: [],
            dataStatus: 'ready',
            scopeMode: 'current_snapshot_all_available_stations',
            stationsInScope: ['BS_TPE_101'],
          },
        })}
        onRetry={noop}
      />,
    );

    expect(rowFor('BS_TPE_101')?.querySelector('[data-flag="SOP6_MULTILINGUAL"]')).toBeNull();
    const summary = document.querySelector('.crowd-panel__multilingual-list');
    expect(summary?.textContent).toContain('否');
    expect(summary?.textContent).not.toContain('BS_TPE_101觸發');
  });

  it('does not add an SOP-4 flag for a strongly negative growth rate when the backend sent none', () => {
    render(
      <CrowdPanel
        snapshot={snapshot({
          stations: [station({ bsId: 'BS_TPE_DOME', growthRate: -0.31, flags: [] })],
        })}
        onRetry={noop}
      />,
    );

    expect(rowFor('BS_TPE_DOME')?.querySelector('[data-flag="SOP4_DOME_DISPERSAL"]')).toBeNull();
  });

  it('renders every backend flag it is given, including codes it does not recognize', () => {
    render(
      <CrowdPanel
        snapshot={snapshot({
          stations: [
            station({
              flags: ['SOP3_MRT_SHUTTLE', 'SOP4_DOME_DISPERSAL', 'SOP6_MULTILINGUAL', 'SOP9_NEW'],
            }),
          ],
        })}
        onRetry={noop}
      />,
    );

    expect(screen.getByText('SOP-3 捷運接駁分流')).toBeInTheDocument();
    expect(screen.getByText('SOP-4 大巨蛋散場')).toBeInTheDocument();
    expect(screen.getByText('SOP-6 多語通報')).toBeInTheDocument();
    expect(screen.getByText('SOP9_NEW')).toBeInTheDocument();
  });

  it('reports the scope-level insufficient_data verdict instead of concluding "not triggered"', () => {
    render(
      <CrowdPanel
        snapshot={snapshot({
          multilingual: {
            triggered: false,
            multilingualRequired: false,
            triggeringStationIds: [],
            dataStatus: 'insufficient_data',
            scopeMode: 'incident_area_nearby_stations',
            stationsInScope: [],
          },
        })}
        onRetry={noop}
      />,
    );

    expect(screen.getByText('多語通報判定資料不足，未作出觸發結論')).toBeInTheDocument();
  });

  it('renders the official roaming percent string verbatim, without reformatting', () => {
    render(
      <CrowdPanel
        snapshot={snapshot({
          stations: [station({ roamingPctDisplay: '30%', roamingPctValue: 0.3 })],
        })}
        onRetry={noop}
      />,
    );

    expect(document.querySelector('.crowd-panel__roaming-display')?.textContent).toBe('30%');
    expect(document.querySelector('.crowd-panel__roaming-value')?.textContent).toContain('0.3');
  });

  it('preserves the backend station order', () => {
    render(
      <CrowdPanel
        snapshot={snapshot({
          stations: [station({ bsId: 'BS_XY_ATT' }), station({ bsId: 'BS_MRT_BL17' })],
        })}
        onRetry={noop}
      />,
    );

    const ids = [...document.querySelectorAll('[data-station-id]')].map((row) =>
      row.getAttribute('data-station-id'),
    );
    expect(ids).toEqual(['BS_XY_ATT', 'BS_MRT_BL17']);
  });
});
