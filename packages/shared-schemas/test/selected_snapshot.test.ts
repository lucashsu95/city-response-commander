/**
 * Type/schema tests for SelectedSnapshot (§10.5, Strategy A / TimeAlignmentStrategy output)
 *
 * Validates:
 * - SelectedSnapshot is exported and assignable with a realistic full example
 * - exact_match: true/false variants are both valid
 * - data_status accepts its declared literal values
 * - selected_timestamp aliases observation_timestamp
 * - selection_mode and guidance_id are exact literals
 * - createSelectedSnapshot enforces the observation_timestamp <= decision_cutoff_timestamp invariant
 */
import { describe, it, expect } from 'vitest';
import { createSelectedSnapshot } from '../src/index.js';
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
      decision_cutoff_timestamp: '2026-05-20 22:10',
      observation_timestamp: '2026-05-20 22:00',
      selected_timestamp: '2026-05-20 22:00',
      exact_match: false,
      staleness_minutes: 10,
      selection_mode: 'GLOBAL_AS_OF_EVENT_CUTOFF_LATEST_PRIOR_PER_ENTITY',
      source_record: sourceRecord,
      data_status: 'stale',
      manual_confirmation_required: false,
      guidance_id: 'HG-001',
    };

    expect(snapshot.entity_id).toBe('RD_TPE_002');
    expect(snapshot.event_timestamp).toBe('2026-05-20 22:10');
    expect(snapshot.decision_cutoff_timestamp).toBe('2026-05-20 22:10');
    expect(snapshot.observation_timestamp).toBe('2026-05-20 22:00');
    expect(snapshot.selected_timestamp).toBe('2026-05-20 22:00');
    expect(snapshot.staleness_minutes).toBe(10);
    expect(snapshot.source_record).toBe(sourceRecord);
    expect(snapshot.manual_confirmation_required).toBe(false);
    expect(snapshot.selection_mode).toBe('GLOBAL_AS_OF_EVENT_CUTOFF_LATEST_PRIOR_PER_ENTITY');
    expect(snapshot.guidance_id).toBe('HG-001');
  });

  it('selected_timestamp equals observation_timestamp (alias relationship)', () => {
    const snapshot: SelectedSnapshot = {
      entity_id: 'RD_TPE_002',
      event_timestamp: '2026-05-20 22:00',
      decision_cutoff_timestamp: '2026-05-20 22:00',
      observation_timestamp: '2026-05-20 22:00',
      selected_timestamp: '2026-05-20 22:00',
      exact_match: true,
      staleness_minutes: 0,
      selection_mode: 'GLOBAL_AS_OF_EVENT_CUTOFF_LATEST_PRIOR_PER_ENTITY',
      source_record: sourceRecord,
      data_status: 'fresh',
      manual_confirmation_required: false,
      guidance_id: 'HG-001',
    };

    expect(snapshot.selected_timestamp).toBe(snapshot.observation_timestamp);
  });

  describe('exact_match', () => {
    it('accepts true (observation_timestamp === event_timestamp)', () => {
      const snapshot: SelectedSnapshot = {
        entity_id: 'RD_TPE_002',
        event_timestamp: '2026-05-20 22:00',
        decision_cutoff_timestamp: '2026-05-20 22:00',
        observation_timestamp: '2026-05-20 22:00',
        selected_timestamp: '2026-05-20 22:00',
        exact_match: true,
        staleness_minutes: 0,
        selection_mode: 'GLOBAL_AS_OF_EVENT_CUTOFF_LATEST_PRIOR_PER_ENTITY',
        source_record: sourceRecord,
        data_status: 'fresh',
        manual_confirmation_required: false,
        guidance_id: 'HG-001',
      };
      expect(snapshot.exact_match).toBe(true);
    });

    it('accepts false (no exact match, prior row carried forward)', () => {
      const snapshot: SelectedSnapshot = {
        entity_id: 'RD_TPE_002',
        event_timestamp: '2026-05-20 22:10',
        decision_cutoff_timestamp: '2026-05-20 22:10',
        observation_timestamp: '2026-05-20 22:00',
        selected_timestamp: '2026-05-20 22:00',
        exact_match: false,
        staleness_minutes: 10,
        selection_mode: 'GLOBAL_AS_OF_EVENT_CUTOFF_LATEST_PRIOR_PER_ENTITY',
        source_record: sourceRecord,
        data_status: 'stale',
        manual_confirmation_required: false,
        guidance_id: 'HG-001',
      };
      expect(snapshot.exact_match).toBe(false);
    });
  });

  describe('data_status', () => {
    it('accepts fresh, stale, and INSUFFICIENT_DATA', () => {
      const statuses: SelectedSnapshot['data_status'][] = ['fresh', 'stale', 'INSUFFICIENT_DATA'];
      for (const data_status of statuses) {
        const snapshot: SelectedSnapshot = {
          entity_id: 'RD_TPE_002',
          event_timestamp: '2026-05-20 22:10',
          decision_cutoff_timestamp: '2026-05-20 22:10',
          observation_timestamp: '2026-05-20 22:00',
          selected_timestamp: '2026-05-20 22:00',
          exact_match: false,
          staleness_minutes: 10,
          selection_mode: 'GLOBAL_AS_OF_EVENT_CUTOFF_LATEST_PRIOR_PER_ENTITY',
          source_record: sourceRecord,
          data_status,
          manual_confirmation_required: false,
          guidance_id: 'HG-001',
        };
        expect(snapshot.data_status).toBe(data_status);
      }
    });
  });

  describe('createSelectedSnapshot', () => {
    it('succeeds and auto-stamps guidance_id when observation_timestamp <= decision_cutoff_timestamp', () => {
      const snapshot = createSelectedSnapshot({
        entity_id: 'RD_TPE_002',
        event_timestamp: '2026-05-20 22:10',
        decision_cutoff_timestamp: '2026-05-20 22:10',
        observation_timestamp: '2026-05-20 22:00',
        selected_timestamp: '2026-05-20 22:00',
        exact_match: false,
        staleness_minutes: 10,
        selection_mode: 'GLOBAL_AS_OF_EVENT_CUTOFF_LATEST_PRIOR_PER_ENTITY',
        source_record: sourceRecord,
        data_status: 'stale',
        manual_confirmation_required: false,
      });

      expect(snapshot.guidance_id).toBe('HG-001');
    });

    it('throws when observation_timestamp is after decision_cutoff_timestamp', () => {
      expect(() =>
        createSelectedSnapshot({
          entity_id: 'RD_TPE_002',
          event_timestamp: '2026-05-20 22:10',
          decision_cutoff_timestamp: '2026-05-20 22:10',
          observation_timestamp: '2026-05-20 22:30',
          selected_timestamp: '2026-05-20 22:30',
          exact_match: false,
          staleness_minutes: 0,
          selection_mode: 'GLOBAL_AS_OF_EVENT_CUTOFF_LATEST_PRIOR_PER_ENTITY',
          source_record: sourceRecord,
          data_status: 'fresh',
          manual_confirmation_required: false,
        }),
      ).toThrow();
    });
  });
});
