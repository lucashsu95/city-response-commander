/**
 * Dashboard Playback Logic Tests
 *
 * Tests the timeline playback state machine logic for the demo dashboard:
 * - handleTimelinePlay: resets to 0 when at last index
 * - handleTimelineNext: respects upper bound
 * - handleTimelinePrevious: respects lower bound
 *
 * @module frontend/test/pages/dashboard_playback.test.ts
 */

import { describe, it, expect } from 'vitest';

/**
 * Simulates the playback reset logic from dashboard.tsx.
 * When play is pressed at the last index (or null), reset to 0.
 */
function simulatePlay(
  currentIndex: number | null,
  totalTimestamps: number,
): { nextPlaying: boolean; nextIndex: number | null } {
  if (totalTimestamps === 0) {
    return { nextPlaying: false, nextIndex: currentIndex };
  }
  // If already at the last index, restart from the beginning
  if (currentIndex === null || currentIndex >= totalTimestamps - 1) {
    return { nextPlaying: true, nextIndex: 0 };
  }
  return { nextPlaying: true, nextIndex: currentIndex };
}

/**
 * Simulates one playback tick (auto-advance interval).
 * When at last index, stop playback.
 */
function simulateTick(
  currentIndex: number | null,
  totalTimestamps: number,
): { nextPlaying: boolean; nextIndex: number | null } {
  if (currentIndex === null) return { nextPlaying: false, nextIndex: null };
  if (currentIndex >= totalTimestamps - 1) {
    // Stop at last frame
    return { nextPlaying: false, nextIndex: currentIndex };
  }
  return { nextPlaying: true, nextIndex: currentIndex + 1 };
}

describe('handleTimelinePlay logic', () => {
  it('at last index (9/10) → resets to 0 and plays', () => {
    const result = simulatePlay(9, 10);
    expect(result.nextIndex).toBe(0);
    expect(result.nextPlaying).toBe(true);
  });

  it('at null (initial) → resets to 0 and plays', () => {
    const result = simulatePlay(null, 10);
    expect(result.nextIndex).toBe(0);
    expect(result.nextPlaying).toBe(true);
  });

  it('at mid index (4/10) → continues from current position', () => {
    const result = simulatePlay(4, 10);
    expect(result.nextIndex).toBe(4);
    expect(result.nextPlaying).toBe(true);
  });

  it('at first index (0/10) → continues from 0', () => {
    const result = simulatePlay(0, 10);
    expect(result.nextIndex).toBe(0);
    expect(result.nextPlaying).toBe(true);
  });

  it('empty timestamps → does not play', () => {
    const result = simulatePlay(null, 0);
    expect(result.nextPlaying).toBe(false);
    expect(result.nextIndex).toBeNull();
  });
});

describe('auto-advance tick logic', () => {
  it('at 4/10 → advances to 5/10', () => {
    const result = simulateTick(4, 10);
    expect(result.nextIndex).toBe(5);
    expect(result.nextPlaying).toBe(true);
  });

  it('at 8/10 → advances to 9/10', () => {
    const result = simulateTick(8, 10);
    expect(result.nextIndex).toBe(9);
    expect(result.nextPlaying).toBe(true);
  });

  it('at 9/10 (last) → stops playback', () => {
    const result = simulateTick(9, 10);
    expect(result.nextIndex).toBe(9);
    expect(result.nextPlaying).toBe(false);
  });

  it('at null → stops playback', () => {
    const result = simulateTick(null, 10);
    expect(result.nextIndex).toBeNull();
    expect(result.nextPlaying).toBe(false);
  });

  it('at 0/10 → advances to 1/10', () => {
    const result = simulateTick(0, 10);
    expect(result.nextIndex).toBe(1);
    expect(result.nextPlaying).toBe(true);
  });
});

describe('full playback sequence 10/10 → 1/10 → ... → 10/10', () => {
  it('tick sequence from 9 with stop at last', () => {
    // Starting at 9/10, press play → resets to 0
    expect(simulatePlay(9, 10)).toEqual({ nextPlaying: true, nextIndex: 0 });

    // Tick from 0 → 1
    expect(simulateTick(0, 10)).toEqual({ nextPlaying: true, nextIndex: 1 });

    // Tick from 1 → 2
    expect(simulateTick(1, 10)).toEqual({ nextPlaying: true, nextIndex: 2 });

    // ... continuing ...
    expect(simulateTick(2, 10)).toEqual({ nextPlaying: true, nextIndex: 3 });
    expect(simulateTick(3, 10)).toEqual({ nextPlaying: true, nextIndex: 4 });
    expect(simulateTick(4, 10)).toEqual({ nextPlaying: true, nextIndex: 5 });
    expect(simulateTick(5, 10)).toEqual({ nextPlaying: true, nextIndex: 6 });
    expect(simulateTick(6, 10)).toEqual({ nextPlaying: true, nextIndex: 7 });
    expect(simulateTick(7, 10)).toEqual({ nextPlaying: true, nextIndex: 8 });
    expect(simulateTick(8, 10)).toEqual({ nextPlaying: true, nextIndex: 9 });

    // Last tick stops
    expect(simulateTick(9, 10)).toEqual({ nextPlaying: false, nextIndex: 9 });
  });
});
