/**
 * AffectedRoadContext Display (§10.9b, §11.2, HG-001)
 *
 * Presentation boundary for the canonical `AffectedRoadContext` contract.
 * Every value rendered here is supplied by the backend verbatim.
 *
 * This component performs NO deterministic calculation. Specifically it does
 * not:
 * - determine or reinterpret the affected-road role
 * - trigger SOP Article 1 or Article 2
 * - add the road to any ETE affected set
 * - infer mandatory action or override the HG-001 guidance marker
 *
 * @module frontend/components/decision/affected_road_context_view
 */

import type { ReactNode } from 'react';
import type { AffectedRoadContext } from '@city-commander/shared-schemas';
import { EmptyState } from '../system/async_state.js';

/**
 * Formats a backend-provided boolean for display.
 * Presentation formatting only; the value is never derived here.
 */
function booleanText(value: boolean): string {
  return value ? '是' : '否';
}

export interface AffectedRoadContextViewProps {
  /**
   * Canonical backend-provided affected-road context, or null when none has
   * been supplied. Never fabricated by the frontend.
   */
  readonly context: AffectedRoadContext | null;
}

/**
 * Displays the canonical AffectedRoadContext values.
 *
 * Renders the formal empty state when no context is provided.
 */
export function AffectedRoadContextView({ context }: AffectedRoadContextViewProps): ReactNode {
  if (context === null) {
    return <EmptyState message="尚無可顯示的受影響道路資訊" />;
  }

  return (
    <section className="provenance-panel" aria-labelledby="affected-road-heading">
      <h3 id="affected-road-heading" className="provenance-panel__heading">
        受影響道路
      </h3>
      <dl className="provenance-panel__list">
        <div className="provenance-panel__row">
          <dt className="provenance-panel__term">路段代號</dt>
          <dd className="provenance-panel__value">{context.affected_road ?? '未提供'}</dd>
        </div>
        <div className="provenance-panel__row">
          <dt className="provenance-panel__term">角色</dt>
          <dd className="provenance-panel__value provenance-panel__value--code">{context.role}</dd>
        </div>
        <div className="provenance-panel__row">
          <dt className="provenance-panel__term">強制處置</dt>
          <dd className="provenance-panel__value">{booleanText(context.mandatory_action)}</dd>
        </div>
        <div className="provenance-panel__row">
          <dt className="provenance-panel__term">納入 ETE 集合</dt>
          <dd className="provenance-panel__value">{booleanText(context.enters_ete_set)}</dd>
        </div>
        <div className="provenance-panel__row">
          <dt className="provenance-panel__term">觸發第一或第二條</dt>
          <dd className="provenance-panel__value">
            {booleanText(context.triggers_article1_or_2)}
          </dd>
        </div>
        <div className="provenance-panel__row">
          <dt className="provenance-panel__term">指引依據</dt>
          <dd className="provenance-panel__value provenance-panel__value--code">
            {context.guidance_id ?? '未提供'}
          </dd>
        </div>
      </dl>
    </section>
  );
}
