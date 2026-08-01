/**
 * Demo Route Advice Card
 *
 * Displays recommended evacuation routes for demo mode:
 * - Primary evacuation route
 * - Secondary evacuation routes
 * - Excluded routes with reasons (from POST /demo/incidents response)
 *
 * All values come from the DemoDecisionView — no hardcoded route IDs.
 *
 * @module frontend/decision/route_advice_card_demo
 */

import type { ReactNode } from 'react';
import type { DemoDecisionView } from '../../api/demo_api_adapter.js';

export interface RouteAdviceCardDemoProps {
  readonly decision: DemoDecisionView | null;
}

export function RouteAdviceCardDemo({ decision }: RouteAdviceCardDemoProps): ReactNode {
  if (decision === null) {
    return (
      <div className="ai-card ai-card--empty">
        <p className="ai-card__empty-text">尚無疏散路線資料</p>
      </div>
    );
  }

  return (
    <div className="ai-card ai-card--routes">
      <div className="ai-card__header">
        <span className="ai-card__icon" aria-hidden="true">⬢</span>
        <h3 className="ai-card__title">推薦疏散路線</h3>
      </div>
      <div className="ai-card__body">
        {decision.primaryEvacuation ? (
          <div className="ai-route ai-route--primary">
            <span className="ai-route__badge ai-route__badge--primary">主</span>
            <span className="ai-route__name">{decision.primaryEvacuation}</span>
          </div>
        ) : (
          <div className="ai-route ai-route--empty">後端未提供主疏散路線</div>
        )}

        {decision.secondaryEvacuation.length > 0 && (
          <div className="ai-route-group">
            <span className="ai-route-group__label">次要疏散</span>
            {decision.secondaryEvacuation.map((s, i) => (
              <div key={i} className="ai-route ai-route--secondary">
                <span className="ai-route__badge ai-route__badge--secondary">次</span>
                <span className="ai-route__name">{s}</span>
              </div>
            ))}
          </div>
        )}

        {decision.excludedRoutes.length > 0 && (
          <div className="ai-route-group ai-route-group--excluded">
            <span className="ai-route-group__label">排除路線</span>
            {decision.excludedRoutes.map((ex, i) => (
              <div key={i} className="ai-route ai-route--excluded">
                <span className="ai-route__badge ai-route__badge--excluded">×</span>
                <span className="ai-route__name">{ex.segment_id}</span>
                {ex.reason && (
                  <span className="ai-route__reason">（{ex.reason}）</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
