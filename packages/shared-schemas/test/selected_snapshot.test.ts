/**
 * Type/schema tests for SelectedSnapshot (§10.5, Strategy A / TimeAlignmentStrategy output)
 *
 * Validates:
 * - SelectedSnapshot is exported and assignable with a realistic full example
 * - exact_match: true/false variants are both valid
 * - data_status accepts its declared literal values
 */
import { describe, it, expect } from 'vitest';
import type { SelectedSnapshot } from '../src/index.js';
import type { RawTrafficRecord } from '../src/index.js';

describe('shared-schemas SelectedSnapshot', () => {
  const sourceRecord: RawTrafficRecord = {
    timestamp_raw: '2026/5/20 22:00',
    Segment_ID: 'RD_TPE_002',
    Road_Name: '光復南路',
    Avg_Speed: 5,
    Vehicle_Count: 320,
    Saturation_Score: 1,
    Lane_Status: 'closed' as any,
  };

  it('is exported and assignable with a realistic full example', () => {
    const snapshot: SelectedSnapshot = {
      entity_id: 'RD_TPE_002',
      event_timestamp: '2026-05-20 22:10',
      selected_timestamp: '2026-05-20 22:00',
      exact_match: false,
      staleness_minutes: 10,
      carried_forward: true,
      source_record: sourceRecord,
      data_status: 'stale',
    };

    expect(snapshot.entity_id).toBe('RD_TPE_002');
    expect(snapshot.event_timestamp).toBe('2026-05-20 22:10');
    expect(snapshot.selected_timestamp).toBe('2026-05-20 22:00');
    expect(snapshot.staleness_minutes).toBe(10);
    expect(snapshot.carried_forward).toBe(true);
    expect(snapshot.source_record).toBe(sourceRecord);
  });

  describe('exact_match', () => {
    it('accepts true (selected_timestamp === event_timestamp)', () => {
      const snapshot: SelectedSnapshot = {
        entity_id: 'RD_TPE_002',
        event_timestamp: '2026-05-20 22:00',
        selected_timestamp: '2026-05-20 22:00',
        exact_match: true,
        staleness_minutes: 0,
        carried_forward: false,
        source_record: sourceRecord,
        data_status: 'fresh',
      };
      expect(snapshot.exact_match).toBe(true);
    });

    it('accepts false (no exact match, prior row carried forward)', () => {
      const snapshot: SelectedSnapshot = {
        entity_id: 'RD_TPE_002',
        event_timestamp: '2026-05-20 22:10',
        selected_timestamp: '2026-05-20 22:00',
        exact_match: false,
        staleness_minutes: 10,
        carried_forward: true,
        source_record: sourceRecord,
        data_status: 'stale',
      };
      expect(snapshot.exact_match).toBe(false);
    });
  });

  describe('data_status', () => {
    it('accepts fresh, stale, and insufficient_data', () => {
      const statuses: SelectedSnapshot['data_status'][] = ['fresh', 'stale', 'insufficient_data'];
      for (const data_status of statuses) {
        const snapshot: SelectedSnapshot = {
          entity_id: 'RD_TPE_002',
          event_timestamp: '2026-05-20 22:10',
          selected_timestamp: '2026-05-20 22:00',
          exact_match: false,
          staleness_minutes: 10,
          carried_forward: true,
          source_record: sourceRecord,
          data_status,
        };
        expect(snapshot.data_status).toBe(data_status);
      }
    });
  });
});
