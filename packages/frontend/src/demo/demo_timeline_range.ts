/**
 * Demo timeline playback range — extends visible playback to 17:00–23:30.
 *
 * The demo backend may return a shorter `timeline[]`; this module generates
 * half-hour slots for the command-center slider and maps each slot to the
 * nearest available snapshot index.
 *
 * @module frontend/demo/demo_timeline_range
 */

import type { DemoTimeseriesResponse } from '../api/demo_api_adapter.js';

export const DEMO_PLAYBACK_START = '2026-05-20 17:00';
export const DEMO_PLAYBACK_END = '2026-05-20 23:30';

export interface DemoPlaybackFrame {
  readonly timestamp: string;
  readonly snapshotIndex: number;
}

function parseToMinutes(value: string): number | null {
  const trimmed = value.trim();
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (isoMatch) {
    return Number(isoMatch[4]) * 60 + Number(isoMatch[5]);
  }
  const slashMatch = trimmed.match(/^(\d{4})\/(\d+)\/(\d+)\s+(\d+):(\d+)/);
  if (slashMatch) {
    return Number(slashMatch[4]) * 60 + Number(slashMatch[5]);
  }
  return null;
}

function minutesToLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `2026-05-20 ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function generateHalfHourSlots(start: string, end: string): readonly string[] {
  const startMinutes = parseToMinutes(start);
  const endMinutes = parseToMinutes(end);
  if (startMinutes === null || endMinutes === null || endMinutes < startMinutes) {
    return [];
  }
  const slots: string[] = [];
  for (let m = startMinutes; m <= endMinutes; m += 30) {
    slots.push(minutesToLabel(m));
  }
  return slots;
}

/**
 * Builds playback frames from 17:00 through 23:30 (30-minute steps).
 * Each frame points at the latest snapshot whose time is <= the slot time.
 */
export function buildDemoPlaybackFrames(
  snapshots: readonly DemoTimeseriesResponse['snapshots'][number][],
): readonly DemoPlaybackFrame[] {
  if (snapshots.length === 0) {
    return generateHalfHourSlots(DEMO_PLAYBACK_START, DEMO_PLAYBACK_END).map((timestamp) => ({
      timestamp,
      snapshotIndex: 0,
    }));
  }

  const indexed = snapshots
    .map((snapshot, index) => ({
      index,
      minutes: parseToMinutes(snapshot.timestamp_display),
    }))
    .filter((entry): entry is { index: number; minutes: number } => entry.minutes !== null)
    .sort((a, b) => a.minutes - b.minutes);

  const slots = generateHalfHourSlots(DEMO_PLAYBACK_START, DEMO_PLAYBACK_END);

  return slots.map((timestamp) => {
    const slotMinutes = parseToMinutes(timestamp)!;
    let snapshotIndex = indexed[0]?.index ?? 0;
    for (const entry of indexed) {
      if (entry.minutes <= slotMinutes) {
        snapshotIndex = entry.index;
      } else {
        break;
      }
    }
    return { timestamp, snapshotIndex };
  });
}
