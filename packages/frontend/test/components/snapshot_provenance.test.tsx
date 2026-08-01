/**
 * SnapshotProvenance Component Tests (TASK-121)
 *
 * Verifies the canonical SelectedSnapshot fields are displayed verbatim and
 * that a null input renders the formal empty state.
 *
 * Fixtures instantiate canonical contract objects for testing only; they are
 * never used as runtime production data.
 */

import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { LaneStatus } from '@city-commander/shared-schemas';
import type { RawTrafficRecord, SelectedSnapshot } from '@city-commander/shared-schemas';
import { SnapshotProvenance } from '../../src/components/decision/snapshot_provenance.js';

const sourceRecord: RawTrafficRecord = {
  timestamp_raw: '2026/5/20 22:00',
  Segment_ID: 'RD_TPE_002',
  Road_Name: '光復南路',
  Avg_Speed: 5,
  Vehicle_Count: 320,
  Saturation_Score: 1,
  Lane_Status: LaneStatus.Blocked,
};

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
  manual_confirmation_required: true,
  guidance_id: 'HG-001',
};

describe('SnapshotProvenance', () => {
  it('displays the decision cutoff timestamp', () => {
    render(<SnapshotProvenance snapshot={snapshot} />);
    expect(screen.getByText('決策截止時間')).toBeInTheDocument();
    expect(screen.getByText('2026-05-20 22:10')).toBeInTheDocument();
  });

  it('displays the observation timestamp', () => {
    render(<SnapshotProvenance snapshot={snapshot} />);
    expect(screen.getByText('觀測時間')).toBeInTheDocument();
    expect(screen.getByText('2026-05-20 22:00')).toBeInTheDocument();
  });

  it('displays the backend-provided staleness minutes', () => {
    render(<SnapshotProvenance snapshot={snapshot} />);
    expect(screen.getByText('資料延遲（分鐘）')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
  });

  it('displays the exact-match state', () => {
    render(<SnapshotProvenance snapshot={snapshot} />);
    const term = screen.getByText('精確對齊');
    expect(term).toBeInTheDocument();
    // exact_match is false in the fixture
    expect(term.parentElement?.textContent).toContain('否');
  });

  it('displays the canonical selection mode', () => {
    render(<SnapshotProvenance snapshot={snapshot} />);
    expect(screen.getByText('選取模式')).toBeInTheDocument();
    expect(
      screen.getByText('GLOBAL_AS_OF_EVENT_CUTOFF_LATEST_PRIOR_PER_ENTITY')
    ).toBeInTheDocument();
  });

  it('displays the HG-001 guidance provenance', () => {
    render(<SnapshotProvenance snapshot={snapshot} />);
    expect(screen.getByText('指引依據')).toBeInTheDocument();
    expect(screen.getByText('HG-001')).toBeInTheDocument();
  });

  it('displays the manual-confirmation value', () => {
    render(<SnapshotProvenance snapshot={snapshot} />);
    const term = screen.getByText('需人工確認');
    expect(term).toBeInTheDocument();
    // manual_confirmation_required is true in the fixture
    expect(term.parentElement?.textContent).toContain('是');
  });

  it('displays the entity id', () => {
    render(<SnapshotProvenance snapshot={snapshot} />);
    expect(screen.getByText('RD_TPE_002')).toBeInTheDocument();
  });

  it('renders the formal empty state for null input', () => {
    render(<SnapshotProvenance snapshot={null} />);
    expect(screen.getByText('尚無可顯示的資料快照')).toBeInTheDocument();
    expect(screen.queryByText('決策截止時間')).not.toBeInTheDocument();
  });

  it('reflects exact_match true without inferring it', () => {
    const exact: SelectedSnapshot = {
      ...snapshot,
      exact_match: true,
      staleness_minutes: 0,
      observation_timestamp: '2026-05-20 22:10',
      selected_timestamp: '2026-05-20 22:10',
      manual_confirmation_required: false,
    };
    render(<SnapshotProvenance snapshot={exact} />);
    expect(screen.getByText('精確對齊').parentElement?.textContent).toContain('是');
    expect(screen.getByText('需人工確認').parentElement?.textContent).toContain('否');
  });
});
