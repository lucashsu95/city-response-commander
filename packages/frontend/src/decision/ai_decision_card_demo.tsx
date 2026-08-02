/**
 * Demo AI Decision Card
 *
 * Renders the AI decision reasoning card for demo mode, showing:
 * - Incident level, type, ETE + recovery time
 * - Triggered SOP articles
 * - CMS core text (AI inference summary)
 * - textSource label
 * - expandable "AI Decision Drawer" button (opens AiDecisionDrawerDemo)
 *
 * All values come from the DemoDecisionView passed in props.
 * No hardcoded severity names, route IDs, or ETE values.
 *
 * @module frontend/decision/ai_decision_card_demo
 */

import * as React from 'react';
import type { ReactNode } from 'react';
import type { DemoDecisionView } from '../api/demo_api_adapter.js';
import { AiDecisionDrawerDemo } from './ai_decision_drawer_demo.js';

export interface AiDecisionCardDemoProps {
  readonly decision: DemoDecisionView | null;
}

const SEVERITY_COLORS: Record<string, string> = {
  Critical: '#dc2626',
  High: '#f97316',
  Medium: '#eab308',
  Low: '#64748b',
};

export function AiDecisionCardDemo({ decision }: AiDecisionCardDemoProps): ReactNode {
  const [drawerOpen, setDrawerOpen] = React.useState<boolean>(false);

  if (decision === null) {
    return (
      <div className="ai-card ai-card--empty">
        <p className="ai-card__empty-text">尚無決策資料，請注入突發事件</p>
      </div>
    );
  }

  const severityColor = SEVERITY_COLORS[decision.severity] ?? '#64748b';
  const hasRecoveryAt = decision.recoveryAt !== null;

  return (
    <>
      <div className="ai-card ai-card--decision">
        <div className="ai-card__header">
          <span className="ai-card__icon" aria-hidden="true">◈</span>
          <h3 className="ai-card__title">AI 決策推理</h3>
        </div>
        <div className="ai-card__body">
          <div className="ai-card__field">
            <span className="ai-card__field-label">事故等級</span>
            <span className="ai-card__field-value ai-card__severity" style={{ color: severityColor }}>
              {decision.severity}
            </span>
          </div>
          <div className="ai-card__field">
            <span className="ai-card__field-label">事件類型</span>
            <span className="ai-card__field-value">{decision.incidentType}</span>
          </div>
          <div className="ai-card__field">
            <span className="ai-card__field-label">ETE</span>
            <span className="ai-card__field-value">{decision.eteMinutes} 分鐘</span>
          </div>
          {hasRecoveryAt && (
            <div className="ai-card__field">
              <span className="ai-card__field-label">預計恢復</span>
              <span className="ai-card__field-value">{decision.recoveryAt}</span>
            </div>
          )}
          <div className="ai-card__field">
            <span className="ai-card__field-label">觸發 SOP</span>
            <span className="ai-card__field-value">
              {decision.triggeredArticles.length > 0
                ? decision.triggeredArticles.map((a) => `第 ${a} 條`).join('、')
                : '後端未提供'}
            </span>
          </div>
          {decision.cmsCoreText && (
            <div className="ai-card__text-block">
              <span className="ai-card__field-label">AI 推論摘要</span>
              <p className="ai-card__text">{decision.cmsCoreText}</p>
            </div>
          )}
          <div className="ai-card__field ai-card__field--source">
            <span className="ai-card__field-label">文字來源</span>
            <span className="ai-card__field-value ai-card__source">{decision.textSource}</span>
          </div>
          {(decision.ragTrace !== null || decision.modelId !== null) && (
            <button
              type="button"
              className="ai-card__drawer-btn"
              onClick={() => setDrawerOpen(true)}
            >
              查看 AI 推理過程
            </button>
          )}
        </div>
      </div>

      {drawerOpen && (
        <AiDecisionDrawerDemo
          retrieverType={decision.retrieverType}
          modelId={decision.modelId}
          textSource={decision.textSource}
          ragTrace={decision.ragTrace}
          evidenceTrace={decision.evidenceTrace}
          acceptedRoutes={[]}
          rejectedRoutes={decision.excludedRoutes.map((r: { segment_id: string; reason: string }) => ({ id: r.segment_id, reason: r.reason }))}
          onClose={() => setDrawerOpen(false)}
        />
      )}
    </>
  );
}
