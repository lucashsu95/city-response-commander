/**
 * Demo timeline playback range — extends visible playback to 17:00–23:30.
 *
 * Generates 15-minute slots for the command-center slider and maps each slot
 * to crowd/traffic rows whose `timestamp_raw` matches that frame.
 *
 * @module frontend/demo/demo_timeline_range
 */

import type { DemoTimeseriesResponse } from '../api/demo_api_adapter.js';

export const DEMO_PLAYBACK_START = '2026-05-20 17:00';
export const DEMO_PLAYBACK_END = '2026-05-20 23:30';
export const DEMO_PLAYBACK_STEP_MINUTES = 15;

export interface DemoPlaybackFrame {
  readonly timestamp: string;
  readonly snapshotIndex: number;
}

type DemoSnapshotEntry = DemoTimeseriesResponse['snapshots'][number];

/** Normalizes demo timestamps so `2026/5/20 23:30` matches `2026-05-20 23:30`. */
export function normalizeDemoTimestamp(value: string): string | null {
  const trimmed = value.trim();
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]} ${isoMatch[4]}:${isoMatch[5]}`;
  }
  const slashMatch = trimmed.match(/^(\d{4})\/(\d+)\/(\d+)\s+(\d+):(\d+)/);
  if (slashMatch) {
    const month = slashMatch[2].padStart(2, '0');
    const day = slashMatch[3].padStart(2, '0');
    const hour = slashMatch[4].padStart(2, '0');
    const minute = slashMatch[5].padStart(2, '0');
    return `${slashMatch[1]}-${month}-${day} ${hour}:${minute}`;
  }
  return null;
}

function parseToMinutes(value: string): number | null {
  const normalized = normalizeDemoTimestamp(value);
  if (normalized === null) return null;
  const match = normalized.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})/);
  if (!match) return null;
  return Number(match[4]) * 60 + Number(match[5]);
}

/** Parses a demo timestamp label to minutes-from-midnight for comparisons. */
export function parseDemoToMinutes(value: string): number | null {
  return parseToMinutes(value);
}

function minutesToLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `2026-05-20 ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function generatePlaybackSlots(start: string, end: string, stepMinutes: number): readonly string[] {
  const startMinutes = parseToMinutes(start);
  const endMinutes = parseToMinutes(end);
  if (startMinutes === null || endMinutes === null || endMinutes < startMinutes) {
    return [];
  }
  const slots: string[] = [];
  for (let m = startMinutes; m <= endMinutes; m += stepMinutes) {
    slots.push(minutesToLabel(m));
  }
  return slots;
}

function collectRowsLatestPrior<T extends { readonly timestamp_raw: string }>(
  snapshots: readonly DemoSnapshotEntry[],
  pick: (snapshot: DemoSnapshotEntry) => readonly T[],
  entityKey: (row: T) => string,
  frameTimestamp: string,
): readonly T[] {
  const slotMinutes = parseToMinutes(frameTimestamp);
  if (slotMinutes === null) return [];

  const bestByEntity = new Map<string, { row: T; minutes: number }>();

  for (const snapshot of snapshots) {
    for (const row of pick(snapshot)) {
      const rowMinutes = parseToMinutes(row.timestamp_raw);
      if (rowMinutes === null || rowMinutes > slotMinutes) continue;

      const key = entityKey(row);
      const existing = bestByEntity.get(key);
      if (existing === undefined || rowMinutes > existing.minutes) {
        bestByEntity.set(key, { row, minutes: rowMinutes });
      }
    }
  }

  return [...bestByEntity.values()].sort((a, b) => b.minutes - a.minutes).map((entry) => entry.row);
}

/**
 * Returns crowd/traffic rows aligned to the active playback frame.
 * Uses latest-prior-per-entity selection so metrics evolve as the timeline advances,
 * even when demo CSV timestamps fall between 15-minute grid slots.
 */
export function resolveSnapshotForPlaybackFrame(
  snapshots: readonly DemoSnapshotEntry[],
  frame: DemoPlaybackFrame | null,
): DemoSnapshotEntry | null {
  if (frame === null || snapshots.length === 0) return null;

  const traffic = collectRowsLatestPrior(
    snapshots,
    (s) => s.traffic,
    (row) => row.Segment_ID,
    frame.timestamp,
  );
  const crowd = collectRowsLatestPrior(
    snapshots,
    (s) => s.crowd,
    (row) => row.BS_ID,
    frame.timestamp,
  );

  if (traffic.length === 0 && crowd.length === 0) {
    return snapshots[frame.snapshotIndex] ?? snapshots[snapshots.length - 1] ?? null;
  }

  return {
    timestamp_display: frame.timestamp,
    traffic,
    crowd,
  };
}

/**
 * Builds playback frames from 17:00 through 23:30 (15-minute steps).
 */
export function buildDemoPlaybackFrames(
  snapshots: readonly DemoSnapshotEntry[],
): readonly DemoPlaybackFrame[] {
  const slots = generatePlaybackSlots(
    DEMO_PLAYBACK_START,
    DEMO_PLAYBACK_END,
    DEMO_PLAYBACK_STEP_MINUTES,
  );

  if (snapshots.length === 0) {
    return slots.map((timestamp) => ({ timestamp, snapshotIndex: 0 }));
  }

  const indexed = snapshots
    .map((snapshot, index) => ({
      index,
      minutes: parseToMinutes(snapshot.timestamp_display),
    }))
    .filter((entry): entry is { index: number; minutes: number } => entry.minutes !== null)
    .sort((a, b) => a.minutes - b.minutes);

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
