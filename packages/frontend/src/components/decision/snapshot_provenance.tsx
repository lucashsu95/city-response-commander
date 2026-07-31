/**
 * SelectedSnapshot Provenance Display (§10.5, HG-001)
 *
 * Presentation boundary for the canonical `SelectedSnapshot` contract.
 * Every value rendered here is supplied by the backend verbatim.
 *
 * This component performs NO deterministic calculation. Specifically it does
 * not:
 * - compute staleness from timestamps (it reads `staleness_minutes`)
 * - compare `observation_timestamp` against `decision_cutoff_timestamp`
 * - select observations or implement latest-prior logic
 * - infer `exact_match`, `selection_mode`, `guidance_id`, or
 *   `manual_confirmation_required`
 *
 * @module frontend/components/decision/snapshot_provenance
 */

import type { ReactNode } from 'react';
import type { SelectedSnapshot } from '@city-commander/shared-schemas';
import { EmptyState } from '../system/async_state.js';

/**
 * Formats a backend-provided boolean for display.
 * Presentation formatting only; the value is never derived here.
 */
function booleanText(value: boolean): string {
  return value ? '是' : '否';
}

export interface SnapshotProvenanceProps {
  /**
   * Canonical backend-provided snapshot, or null when none has been supplied.
   * Never fabricated by the frontend.
   */
  readonly snapshot: SelectedSnapshot | null;
}

/**
 * Displays the canonical SelectedSnapshot provenance evidence.
 *
 * Renders the formal empty state when no snapshot is provided, so the region
 * never shows placeholder or fabricated values.
 */
export function SnapshotProvenance({ snapshot }: SnapshotProvenanceProps): ReactNode {
  if (snapshot === null) {
    return <EmptyState message="尚無可顯示的資料快照" />;
  }

  return (
    <section className="provenance-panel" aria-labelledby="snapshot-provenance-heading">
      <h3 id="snapshot-provenance-heading" className="provenance-panel__heading">
        資料快照對齊
      </h3>
      <dl className="provenance-panel__list">
        <div className="provenance-panel__row">
          <dt className="provenance-panel__term">實體代號</dt>
          <dd className="provenance-panel__value">{snapshot.entity_id}</dd>
        </div>
        <div className="provenance-panel__row">
          <dt className="provenance-panel__term">決策截止時間</dt>
          <dd className="provenance-panel__value">{snapshot.decision_cutoff_timestamp}</dd>
        </div>
        <div className="provenance-panel__row">
          <dt className="provenance-panel__term">觀測時間</dt>
          <dd className="provenance-panel__value">{snapshot.observation_timestamp}</dd>
        </div>
        <div className="provenance-panel__row">
          <dt className="provenance-panel__term">資料延遲（分鐘）</dt>
          <dd className="provenance-panel__value">{snapshot.staleness_minutes}</dd>
        </div>
        <div className="provenance-panel__row">
          <dt className="provenance-panel__term">精確對齊</dt>
          <dd className="provenance-panel__value">{booleanText(snapshot.exact_match)}</dd>
        </div>
        <div className="provenance-panel__row">
          <dt className="provenance-panel__term">選取模式</dt>
          <dd className="provenance-panel__value provenance-panel__value--code">
            {snapshot.selection_mode}
          </dd>
        </div>
        <div className="provenance-panel__row">
          <dt className="provenance-panel__term">需人工確認</dt>
          <dd className="provenance-panel__value">
            {booleanText(snapshot.manual_confirmation_required)}
          </dd>
        </div>
        <div className="provenance-panel__row">
          <dt className="provenance-panel__term">指引依據</dt>
          <dd className="provenance-panel__value provenance-panel__value--code">
            {snapshot.guidance_id}
          </dd>
        </div>
      </dl>
    </section>
  );
}
