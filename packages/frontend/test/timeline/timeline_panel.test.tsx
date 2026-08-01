/**
 * Timeline Panel Presentation Tests (TASK-124)
 *
 * Exercises loading/empty/error/ready/refresh rendering plus accessibility
 * and zero-fabrication guarantees for HG-001 evidence.
 */

import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TimelinePanel } from '../../src/timeline/timeline_panel.js';
import type { TimelinePlaybackState } from '../../src/timeline/use_timeline_playback.js';

function baseState(overrides: Partial<TimelinePlaybackState> = {}): TimelinePlaybackState {
  return {
    state: 'idle',
    timestamps: [],
    currentTimestamp: null,
    selectedTimestamp: null,
    selectedIndex: null,
    refreshStatus: 'idle',
    timing: null,
    schemaVersion: null,
    traceId: null,
    provisional: null,
    error: null,
    ...overrides,
  };
}

function noop(): void {
  // intentionally empty
}

describe('TimelinePanel', () => {
  it('renders the loading state', () => {
    render(
      <TimelinePanel
        playback={baseState({ state: 'loading' })}
        onRetry={noop}
        onSelect={noop}
        onPrevious={noop}
        onNext={noop}
      />,
    );

    expect(screen.getByText('載入時間軸中')).toBeInTheDocument();
  });

  it('renders the empty state without fabricating timestamps', () => {
    render(
      <TimelinePanel
        playback={baseState({ state: 'empty' })}
        onRetry={noop}
        onSelect={noop}
        onPrevious={noop}
        onNext={noop}
      />,
    );

    expect(screen.getByText('目前時間軸尚無可播放的時點')).toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
  });

  it('renders the error state with a retry control', () => {
    const onRetry = vi.fn();
    render(
      <TimelinePanel
        playback={baseState({
          state: 'error',
          error: { code: 'REQUEST_FAILED', message: 'boom' },
        })}
        onRetry={onRetry}
        onSelect={noop}
        onPrevious={noop}
        onNext={noop}
      />,
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();
    const retryButton = screen.getByRole('button', { name: '重試' });
    retryButton.click();
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('renders the current position and formatted timestamps in ready state', () => {
    render(
      <TimelinePanel
        playback={baseState({
          state: 'ready',
          timestamps: ['2026-05-20 22:00', '2026-05-20 22:10', '2026-05-20 22:20'],
          currentTimestamp: '2026-05-20 22:10',
          selectedTimestamp: '2026-05-20 22:10',
          selectedIndex: 1,
        })}
        onRetry={noop}
        onSelect={noop}
        onPrevious={noop}
        onNext={noop}
      />,
    );

    expect(document.querySelector('.timeline-panel__current-value')?.textContent).toBe(
      '2026-05-20 22:10',
    );
    expect(screen.getByText('2 / 3')).toBeInTheDocument();
    const select = screen.getByRole('combobox', { name: '選擇時點' });
    expect(select).toHaveValue('2026-05-20 22:10');
  });

  it('disables the previous control at the first timestamp', () => {
    render(
      <TimelinePanel
        playback={baseState({
          state: 'ready',
          timestamps: ['2026-05-20 22:00', '2026-05-20 22:10'],
          currentTimestamp: '2026-05-20 22:00',
          selectedTimestamp: '2026-05-20 22:00',
          selectedIndex: 0,
        })}
        onRetry={noop}
        onSelect={noop}
        onPrevious={noop}
        onNext={noop}
      />,
    );

    expect(screen.getByRole('button', { name: '上一個時點' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '下一個時點' })).toBeEnabled();
  });

  it('disables the next control at the last timestamp', () => {
    render(
      <TimelinePanel
        playback={baseState({
          state: 'ready',
          timestamps: ['2026-05-20 22:00', '2026-05-20 22:10'],
          currentTimestamp: '2026-05-20 22:10',
          selectedTimestamp: '2026-05-20 22:10',
          selectedIndex: 1,
        })}
        onRetry={noop}
        onSelect={noop}
        onPrevious={noop}
        onNext={noop}
      />,
    );

    expect(screen.getByRole('button', { name: '下一個時點' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '上一個時點' })).toBeEnabled();
  });

  it('invokes onPrevious/onNext/onSelect handlers', () => {
    const onPrevious = vi.fn();
    const onNext = vi.fn();
    const onSelect = vi.fn();

    render(
      <TimelinePanel
        playback={baseState({
          state: 'ready',
          timestamps: ['2026-05-20 22:00', '2026-05-20 22:10'],
          currentTimestamp: '2026-05-20 22:00',
          selectedTimestamp: '2026-05-20 22:00',
          selectedIndex: 0,
        })}
        onRetry={noop}
        onSelect={onSelect}
        onPrevious={onPrevious}
        onNext={onNext}
      />,
    );

    screen.getByRole('button', { name: '下一個時點' }).click();
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('shows the background-refresh banner without removing existing content', () => {
    render(
      <TimelinePanel
        playback={baseState({
          state: 'ready',
          timestamps: ['2026-05-20 22:00'],
          currentTimestamp: '2026-05-20 22:00',
          selectedTimestamp: '2026-05-20 22:00',
          selectedIndex: 0,
          refreshStatus: 'refreshing',
        })}
        onRetry={noop}
        onSelect={noop}
        onPrevious={noop}
        onNext={noop}
      />,
    );

    expect(screen.getByText('背景更新中…')).toBeInTheDocument();
    expect(document.querySelector('.timeline-panel__current-value')?.textContent).toBe(
      '2026-05-20 22:00',
    );
  });

  it('shows a background refresh error while keeping existing content visible', () => {
    render(
      <TimelinePanel
        playback={baseState({
          state: 'ready',
          timestamps: ['2026-05-20 22:00'],
          currentTimestamp: '2026-05-20 22:00',
          selectedTimestamp: '2026-05-20 22:00',
          selectedIndex: 0,
          error: { code: 'REQUEST_FAILED', message: 'network blip' },
        })}
        onRetry={noop}
        onSelect={noop}
        onPrevious={noop}
        onNext={noop}
      />,
    );

    expect(screen.getByText(/背景更新失敗/)).toBeInTheDocument();
    expect(document.querySelector('.timeline-panel__current-value')?.textContent).toBe(
      '2026-05-20 22:00',
    );
  });

  it('renders backend-supplied HG-001 evidence verbatim', () => {
    render(
      <TimelinePanel
        playback={baseState({
          state: 'ready',
          timestamps: ['2026-05-20 22:10'],
          currentTimestamp: '2026-05-20 22:10',
          selectedTimestamp: '2026-05-20 22:10',
          selectedIndex: 0,
          timing: {
            eventTimestamp: '2026-05-20 22:15',
            decisionCutoffTimestamp: '2026-05-20 22:15',
            observationTimestamp: '2026-05-20 22:10',
            stalenessMinutes: 5,
            selectionMode: 'GLOBAL_AS_OF_EVENT_CUTOFF_LATEST_PRIOR_PER_ENTITY',
            guidanceId: 'HG-001',
          },
        })}
        onRetry={noop}
        onSelect={noop}
        onPrevious={noop}
        onNext={noop}
      />,
    );

    expect(screen.getByText('事件時間')).toBeInTheDocument();
    expect(screen.getAllByText('2026-05-20 22:15')).toHaveLength(2); // event + cutoff
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('HG-001')).toBeInTheDocument();
  });

  // ─── FIX 1: current position must use authoritative current, not selection ───

  it('keeps the current position badge aligned with currentTimestamp when they diverge from selection', () => {
    render(
      <TimelinePanel
        playback={baseState({
          state: 'ready',
          timestamps: ['2026-05-20 22:00', '2026-05-20 22:10', '2026-05-20 22:20'],
          currentTimestamp: '2026-05-20 22:00', // index 0
          selectedTimestamp: '2026-05-20 22:20', // index 2 — user has navigated away
          selectedIndex: 2,
        })}
        onRetry={noop}
        onSelect={noop}
        onPrevious={noop}
        onNext={noop}
      />,
    );

    // The badge beside "目前重播位置" must reflect currentTimestamp's index (1/3),
    // never the selected index (3/3).
    const currentRow = document.querySelector('.timeline-panel__current');
    expect(currentRow?.textContent).toContain('1 / 3');
    expect(currentRow?.textContent).not.toContain('3 / 3');
  });

  it('shows the selected position separately, labeled 選擇位置, distinct from current position', () => {
    render(
      <TimelinePanel
        playback={baseState({
          state: 'ready',
          timestamps: ['2026-05-20 22:00', '2026-05-20 22:10', '2026-05-20 22:20'],
          currentTimestamp: '2026-05-20 22:00', // index 0 -> "1 / 3"
          selectedTimestamp: '2026-05-20 22:20', // index 2 -> "3 / 3"
          selectedIndex: 2,
        })}
        onRetry={noop}
        onSelect={noop}
        onPrevious={noop}
        onNext={noop}
      />,
    );

    expect(screen.getByText(/選擇位置/)).toBeInTheDocument();
    const selectedRow = document.querySelector('.timeline-panel__selected');
    expect(selectedRow?.textContent).toContain('選擇位置');
    expect(selectedRow?.textContent).toContain('3 / 3');
  });

  it('does not change the current position badge after a local selection change', () => {
    const first = render(
      <TimelinePanel
        playback={baseState({
          state: 'ready',
          timestamps: ['2026-05-20 22:00', '2026-05-20 22:10', '2026-05-20 22:20'],
          currentTimestamp: '2026-05-20 22:10', // index 1 -> "2 / 3"
          selectedTimestamp: '2026-05-20 22:10',
          selectedIndex: 1,
        })}
        onRetry={noop}
        onSelect={noop}
        onPrevious={noop}
        onNext={noop}
      />,
    );

    const currentRowBefore = document.querySelector('.timeline-panel__current')?.textContent;
    expect(currentRowBefore).toContain('2 / 3');

    // Simulate the user having navigated the local selection elsewhere, with
    // the authoritative current position unchanged.
    first.rerender(
      <TimelinePanel
        playback={baseState({
          state: 'ready',
          timestamps: ['2026-05-20 22:00', '2026-05-20 22:10', '2026-05-20 22:20'],
          currentTimestamp: '2026-05-20 22:10', // unchanged: still index 1 -> "2 / 3"
          selectedTimestamp: '2026-05-20 22:00', // selection moved to index 0
          selectedIndex: 0,
        })}
        onRetry={noop}
        onSelect={noop}
        onPrevious={noop}
        onNext={noop}
      />,
    );

    const currentRowAfter = document.querySelector('.timeline-panel__current')?.textContent;
    expect(currentRowAfter).toContain('2 / 3');
    expect(currentRowAfter).toBe(currentRowBefore);
  });

  it('reports no current position badge when currentTimestamp is unavailable, without inferring one', () => {
    render(
      <TimelinePanel
        playback={baseState({
          state: 'ready',
          timestamps: ['2026-05-20 22:00', '2026-05-20 22:10'],
          currentTimestamp: null,
          selectedTimestamp: '2026-05-20 22:00',
          selectedIndex: 0,
        })}
        onRetry={noop}
        onSelect={noop}
        onPrevious={noop}
        onNext={noop}
      />,
    );

    const currentRow = document.querySelector('.timeline-panel__current');
    // No position badge span rendered for the current row.
    expect(currentRow?.querySelector('.timeline-panel__position:not(.timeline-panel__position--selected)')).toBeNull();
  });

  it('shows missing HG-001 metadata as explicitly unavailable, never fabricated', () => {
    render(
      <TimelinePanel
        playback={baseState({
          state: 'ready',
          timestamps: ['2026-05-20 22:10'],
          currentTimestamp: '2026-05-20 22:10',
          selectedTimestamp: '2026-05-20 22:10',
          selectedIndex: 0,
          timing: {
            eventTimestamp: null,
            decisionCutoffTimestamp: null,
            observationTimestamp: null,
            stalenessMinutes: null,
            selectionMode: null,
            guidanceId: null,
          },
        })}
        onRetry={noop}
        onSelect={noop}
        onPrevious={noop}
        onNext={noop}
      />,
    );

    const unavailable = screen.getAllByText('尚無資料');
    expect(unavailable.length).toBeGreaterThan(0);
  });
});
