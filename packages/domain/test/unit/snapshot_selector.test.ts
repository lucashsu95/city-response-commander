/**
 * Unit tests for SnapshotSelector and TimeAlignmentStrategy (Strategy A)
 *
 * Tests:
 * - Never selects a post-event row as primary
 * - SelectedSnapshot carries exact_match / staleness_minutes / data_status
 * - Mode is config-driven (both modes tested)
 * - No legal row → insufficient_data (never fabricate)
 * - Exact match → staleness = 0
 * - Latest prior per entity selection
 * - Staleness threshold enforcement (default mode only)
 */

import { describe, it, expect } from 'vitest';
import {
  exactOrLatestPriorPerEntity,
  lastKnownValueWithVisibleStaleness,
  resolveTimeAlignmentStrategy,
} from '../../src/strategies/time_alignment_strategy.js';
import type {
  TimestampedRecord,
  TimeAlignmentConfig,
} from '../../src/strategies/time_alignment_strategy.js';
import { SnapshotSelector } from '../../src/snapshot/snapshot_selector.js';
import type { SnapshotSelectorConfigProvider } from '../../src/snapshot/snapshot_selector.js';

// ─── Test Helpers ──────────────────────────────────────────

interface TestRecord extends TimestampedRecord {
  readonly id: string;
  readonly value: number;
  readonly timestamp_normalized: Date;
}

function makeRecord(id: string, isoTime: string, value: number): TestRecord {
  return {
    id,
    value,
    timestamp_normalized: new Date(isoTime),
  };
}

function makeDate(isoTime: string): Date {
  return new Date(isoTime);
}

const DEFAULT_CONFIG: TimeAlignmentConfig = {
  mode: 'exact_or_latest_prior_per_entity',
  max_staleness_minutes: 30,
};

// ─── Tests: exactOrLatestPriorPerEntity ────────────────────

describe('exactOrLatestPriorPerEntity', () => {
  const strategy = exactOrLatestPriorPerEntity;

  it('selects exact match when available', () => {
    const records = [
      makeRecord('r1', '2026-05-20T22:00:00', 10),
      makeRecord('r2', '2026-05-20T22:10:00', 20),
      makeRecord('r3', '2026-05-20T22:20:00', 30),
    ];
    const eventTime = makeDate('2026-05-20T22:10:00');

    const result = strategy.select('entity1', eventTime, records, DEFAULT_CONFIG);

    expect(result.record).not.toBeNull();
    expect(result.record!.id).toBe('r2');
    expect(result.exact_match).toBe(true);
    expect(result.staleness_minutes).toBe(0);
    expect(result.data_status).toBe('ready');
  });

  it('selects latest prior when no exact match', () => {
    const records = [
      makeRecord('r1', '2026-05-20T22:00:00', 10),
      makeRecord('r2', '2026-05-20T22:05:00', 20),
      makeRecord('r3', '2026-05-20T22:20:00', 30),
    ];
    const eventTime = makeDate('2026-05-20T22:10:00');

    const result = strategy.select('entity1', eventTime, records, DEFAULT_CONFIG);

    expect(result.record).not.toBeNull();
    expect(result.record!.id).toBe('r2');
    expect(result.exact_match).toBe(false);
    expect(result.staleness_minutes).toBe(5);
    expect(result.data_status).toBe('ready');
  });

  it('never selects a post-event row as primary', () => {
    const records = [
      makeRecord('r1', '2026-05-20T22:15:00', 10), // post-event only
      makeRecord('r2', '2026-05-20T22:20:00', 20), // post-event only
    ];
    const eventTime = makeDate('2026-05-20T22:10:00');

    const result = strategy.select('entity1', eventTime, records, DEFAULT_CONFIG);

    expect(result.record).toBeNull();
    expect(result.data_status).toBe('insufficient_data');
  });

  it('returns insufficient_data when no records exist', () => {
    const result = strategy.select('entity1', makeDate('2026-05-20T22:10:00'), [], DEFAULT_CONFIG);

    expect(result.record).toBeNull();
    expect(result.exact_match).toBe(false);
    expect(result.data_status).toBe('insufficient_data');
  });

  it('returns insufficient_data when staleness exceeds max_staleness_minutes', () => {
    const records = [
      makeRecord('r1', '2026-05-20T21:30:00', 10), // 40 minutes before event
    ];
    const eventTime = makeDate('2026-05-20T22:10:00');

    const result = strategy.select('entity1', eventTime, records, DEFAULT_CONFIG);

    expect(result.record).toBeNull();
    expect(result.staleness_minutes).toBe(40);
    expect(result.data_status).toBe('insufficient_data');
  });

  it('returns ready when staleness is exactly at max_staleness_minutes', () => {
    const records = [
      makeRecord('r1', '2026-05-20T21:40:00', 10), // exactly 30 minutes before event
    ];
    const eventTime = makeDate('2026-05-20T22:10:00');

    const result = strategy.select('entity1', eventTime, records, DEFAULT_CONFIG);

    expect(result.record).not.toBeNull();
    expect(result.record!.id).toBe('r1');
    expect(result.staleness_minutes).toBe(30);
    expect(result.data_status).toBe('ready');
  });

  it('returns insufficient_data when staleness is 1 minute over threshold', () => {
    const records = [
      makeRecord('r1', '2026-05-20T21:39:00', 10), // 31 minutes before event
    ];
    const eventTime = makeDate('2026-05-20T22:10:00');

    const result = strategy.select('entity1', eventTime, records, DEFAULT_CONFIG);

    expect(result.record).toBeNull();
    expect(result.staleness_minutes).toBe(31);
    expect(result.data_status).toBe('insufficient_data');
  });

  it('selects latest prior among multiple candidates before event', () => {
    const records = [
      makeRecord('r1', '2026-05-20T21:50:00', 10),
      makeRecord('r2', '2026-05-20T22:00:00', 20),
      makeRecord('r3', '2026-05-20T22:05:00', 30),
      makeRecord('r4', '2026-05-20T22:15:00', 40), // post-event
    ];
    const eventTime = makeDate('2026-05-20T22:10:00');

    const result = strategy.select('entity1', eventTime, records, DEFAULT_CONFIG);

    expect(result.record!.id).toBe('r3');
    expect(result.staleness_minutes).toBe(5);
    expect(result.data_status).toBe('ready');
  });
});

// ─── Tests: lastKnownValueWithVisibleStaleness ─────────────

describe('lastKnownValueWithVisibleStaleness', () => {
  const strategy = lastKnownValueWithVisibleStaleness;

  it('selects exact match when available', () => {
    const records = [
      makeRecord('r1', '2026-05-20T22:00:00', 10),
      makeRecord('r2', '2026-05-20T22:10:00', 20),
    ];
    const eventTime = makeDate('2026-05-20T22:10:00');

    const result = strategy.select('entity1', eventTime, records, DEFAULT_CONFIG);

    expect(result.record!.id).toBe('r2');
    expect(result.exact_match).toBe(true);
    expect(result.staleness_minutes).toBe(0);
    expect(result.data_status).toBe('ready');
  });

  it('returns record even when staleness exceeds max_staleness_minutes (no cutoff)', () => {
    const records = [
      makeRecord('r1', '2026-05-20T20:00:00', 10), // 130 minutes before event
    ];
    const eventTime = makeDate('2026-05-20T22:10:00');

    const result = strategy.select('entity1', eventTime, records, DEFAULT_CONFIG);

    expect(result.record).not.toBeNull();
    expect(result.record!.id).toBe('r1');
    expect(result.staleness_minutes).toBe(130);
    expect(result.data_status).toBe('ready');
  });

  it('returns insufficient_data only when no legal row exists at all', () => {
    const records = [
      makeRecord('r1', '2026-05-20T22:15:00', 10), // post-event only
    ];
    const eventTime = makeDate('2026-05-20T22:10:00');

    const result = strategy.select('entity1', eventTime, records, DEFAULT_CONFIG);

    expect(result.record).toBeNull();
    expect(result.data_status).toBe('insufficient_data');
  });

  it('never selects a post-event row', () => {
    const records = [
      makeRecord('r1', '2026-05-20T22:00:00', 10),
      makeRecord('r2', '2026-05-20T22:20:00', 20), // post-event
    ];
    const eventTime = makeDate('2026-05-20T22:10:00');

    const result = strategy.select('entity1', eventTime, records, DEFAULT_CONFIG);

    expect(result.record!.id).toBe('r1');
    expect(result.staleness_minutes).toBe(10);
  });
});

// ─── Tests: resolveTimeAlignmentStrategy ───────────────────

describe('resolveTimeAlignmentStrategy', () => {
  it('resolves exact_or_latest_prior_per_entity mode', () => {
    const strategy = resolveTimeAlignmentStrategy('exact_or_latest_prior_per_entity');
    expect(strategy).toBe(exactOrLatestPriorPerEntity);
  });

  it('resolves last_known_value_with_visible_staleness mode', () => {
    const strategy = resolveTimeAlignmentStrategy('last_known_value_with_visible_staleness');
    expect(strategy).toBe(lastKnownValueWithVisibleStaleness);
  });

  it('throws on unknown mode', () => {
    expect(() => resolveTimeAlignmentStrategy('unknown' as any)).toThrow(
      'Unknown time alignment mode: unknown',
    );
  });
});

// ─── Tests: SnapshotSelector (config-driven facade) ────────

describe('SnapshotSelector', () => {
  it('reads mode and threshold from config provider (default mode)', () => {
    const configProvider: SnapshotSelectorConfigProvider = {
      get(key: string) {
        if (key === 'policy.time_alignment.mode') return 'exact_or_latest_prior_per_entity';
        if (key === 'policy.time_alignment.max_staleness_minutes') return 30;
        throw new Error(`Unexpected key: ${key}`);
      },
    };

    const selector = new SnapshotSelector(configProvider);
    const config = selector.getConfig();

    expect(config.mode).toBe('exact_or_latest_prior_per_entity');
    expect(config.max_staleness_minutes).toBe(30);
  });

  it('delegates to the correct strategy based on config mode', () => {
    const configProvider: SnapshotSelectorConfigProvider = {
      get(key: string) {
        if (key === 'policy.time_alignment.mode') return 'last_known_value_with_visible_staleness';
        if (key === 'policy.time_alignment.max_staleness_minutes') return 15;
        throw new Error(`Unexpected key: ${key}`);
      },
    };

    const selector = new SnapshotSelector(configProvider);
    const records = [
      makeRecord('r1', '2026-05-20T20:00:00', 10), // very stale (130 min)
    ];
    const eventTime = makeDate('2026-05-20T22:10:00');

    // With last_known_value_with_visible_staleness, stale records still returned
    const result = selector.select('entity1', eventTime, records);

    expect(result.record).not.toBeNull();
    expect(result.data_status).toBe('ready');
    expect(result.staleness_minutes).toBe(130);
  });

  it('applies max_staleness_minutes threshold in default mode', () => {
    const configProvider: SnapshotSelectorConfigProvider = {
      get(key: string) {
        if (key === 'policy.time_alignment.mode') return 'exact_or_latest_prior_per_entity';
        if (key === 'policy.time_alignment.max_staleness_minutes') return 15;
        throw new Error(`Unexpected key: ${key}`);
      },
    };

    const selector = new SnapshotSelector(configProvider);
    const records = [
      makeRecord('r1', '2026-05-20T21:50:00', 10), // 20 minutes before event (> 15 threshold)
    ];
    const eventTime = makeDate('2026-05-20T22:10:00');

    const result = selector.select('entity1', eventTime, records);

    expect(result.record).toBeNull();
    expect(result.data_status).toBe('insufficient_data');
    expect(result.staleness_minutes).toBe(20);
  });

  it('preserves all fields from the selected record (same-row cohesion)', () => {
    const configProvider: SnapshotSelectorConfigProvider = {
      get(key: string) {
        if (key === 'policy.time_alignment.mode') return 'exact_or_latest_prior_per_entity';
        if (key === 'policy.time_alignment.max_staleness_minutes') return 30;
        throw new Error(`Unexpected key: ${key}`);
      },
    };

    const selector = new SnapshotSelector(configProvider);

    interface CrowdRecord extends TimestampedRecord {
      bs_id: string;
      user_count: number;
      growth_rate: number;
      roaming_pct: number;
      timestamp_normalized: Date;
    }

    const records: CrowdRecord[] = [
      {
        bs_id: 'BS_MRT_BL17',
        user_count: 31000,
        growth_rate: 0.35,
        roaming_pct: 0.05,
        timestamp_normalized: new Date('2026-05-20T22:10:00'),
      },
    ];

    const result = selector.select(
      'BS_MRT_BL17',
      new Date('2026-05-20T22:10:00'),
      records,
    );

    expect(result.record).not.toBeNull();
    // All fields from the same row are preserved
    expect(result.record!.user_count).toBe(31000);
    expect(result.record!.growth_rate).toBe(0.35);
    expect(result.record!.roaming_pct).toBe(0.05);
    expect(result.exact_match).toBe(true);
  });
});
