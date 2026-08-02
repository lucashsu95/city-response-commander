/**
 * Control Center Recommendation Panel
 *
 * Renders the full traffic-control-center recommendation returned by the demo backend:
 * - Incident summary & classification
 * - Technical actions (signal adjustments, route guidance, CMS messages)
 * - Route actions (primary, secondary, excluded)
 * - Coordination actions
 * - Public guidance in all available languages
 *
 * All values are sourced verbatim from the backend response.
 * When the backend does not provide a field, displays "後端未提供".
 * No fabricated values are shown.
 *
 * @module frontend/decision/control_center_recommendation_panel
 */

import type { ReactNode } from 'react';
import type { DemoRecommendationData } from '../api/demo_api_adapter.js';

export interface ControlCenterRecommendationPanelProps {
  readonly recommendation: DemoRecommendationData | null;
}

const SOP_ARTICLE_LABELS: Readonly<Record<number, string>> = {
  1: 'SOP 第 1 條（路段饱和度分级）',
  2: 'SOP 第 2 條（替代路线筛选）',
  3: 'SOP 第 3 條（人流预警）',
  4: 'SOP 第 4 條（人流消散）',
  5: 'SOP 第 5 條（CMS 引导）',
  6: 'SOP 第 6 條（漫遊達標通報）',
  7: 'SOP 第 7 條（ETE 公式）',
};

function sopLabel(article: number | null): string {
  if (article === null) return '後端未提供';
  return SOP_ARTICLE_LABELS[article] ?? `SOP 第 ${article} 條`;
}

function TechnicalActionRow({
  action,
  index,
}: {
  readonly action: {
    readonly system: string | null;
    readonly target: string | null;
    readonly action: string | null;
    readonly parameter: string | null;
    readonly value: number | null;
    readonly unit: string | null;
    readonly time_window: string | null;
    readonly rationale: string | null;
    readonly source_article: number | null;
    readonly parameter_status: string | null;
  };
  readonly index: number;
}): ReactNode {
  const hasValue = action.value !== null;
  return (
    <div className="ccr-technical-action" key={index}>
      <div className="ccr-technical-action__header">
        <span className="ccr-technical-action__index">{index + 1}</span>
        <span className="ccr-technical-action__system">
          {action.system ?? '後端未提供'}
        </span>
      </div>
      <dl className="ccr-technical-action__fields">
        <div className="ccr-technical-action__field">
          <dt>目標</dt>
          <dd>{action.target ?? '後端未提供'}</dd>
        </div>
        <div className="ccr-technical-action__field">
          <dt>動作</dt>
          <dd>{action.action ?? '後端未提供'}</dd>
        </div>
        <div className="ccr-technical-action__field">
          <dt>參數</dt>
          <dd>{action.parameter ?? '後端未提供'}</dd>
        </div>
        <div className="ccr-technical-action__field">
          <dt>數值</dt>
          <dd>
            {hasValue
              ? `${action.value} ${action.unit ?? ''}`
              : 'SOP 未提供精確秒數'}
          </dd>
        </div>
        <div className="ccr-technical-action__field">
          <dt>參數狀態</dt>
          <dd>
            {action.parameter_status === 'sop_specific' ? (
              <span className="ccr-tag ccr-tag--ok">SOP 已提供精確值</span>
            ) : action.parameter_status === 'sop_not_specific' ? (
              <span className="ccr-tag ccr-tag--warn">SOP 未提供精確秒數，建議依現場流量動態調整</span>
            ) : (
              '後端未提供'
            )}
          </dd>
        </div>
        <div className="ccr-technical-action__field">
          <dt>時間窗口</dt>
          <dd>{action.time_window ?? '後端未提供'}</dd>
        </div>
        <div className="ccr-technical-action__field">
          <dt>依據 SOP</dt>
          <dd>{sopLabel(action.source_article)}</dd>
        </div>
        <div className="ccr-technical-action__field ccr-technical-action__field--full">
          <dt>理由</dt>
          <dd>{action.rationale ?? '後端未提供'}</dd>
        </div>
      </dl>
    </div>
  );
}

function RouteActionsSection({
  routeActions,
}: {
  readonly routeActions: {
    readonly primary_route: string | null;
    readonly primary_route_segment_id: string | null;
    readonly secondary_routes: readonly string[];
    readonly excluded_routes: readonly { segment_id: string; reason: string }[];
    readonly cms_message_zh: string | null;
    readonly cms_message_en: string | null;
  } | null;
}): ReactNode {
  if (routeActions === null) {
    return (
      <section className="ccr-section">
        <h4 className="ccr-section__heading">路徑建議</h4>
        <p className="ccr-empty">後端未提供路徑建議</p>
      </section>
    );
  }

  return (
    <section className="ccr-section">
      <h4 className="ccr-section__heading">路徑建議</h4>
      <dl className="ccr-fields">
        <div className="ccr-field">
          <dt>主疏散路徑</dt>
          <dd>{routeActions.primary_route ?? '後端未提供'}</dd>
        </div>
        <div className="ccr-field">
          <dt>主路徑路段 ID</dt>
          <dd>{routeActions.primary_route_segment_id ?? '後端未提供'}</dd>
        </div>
        <div className="ccr-field">
          <dt>次要疏散路徑</dt>
          <dd>
            {routeActions.secondary_routes.length > 0
              ? routeActions.secondary_routes.join('、')
              : '後端未提供'}
          </dd>
        </div>
        {routeActions.excluded_routes.length > 0 && (
          <div className="ccr-field">
            <dt>排除路徑</dt>
            <dd>
              <ul className="ccr-excluded-routes">
                {routeActions.excluded_routes.map((r) => (
                  <li key={r.segment_id}>
                    <strong>{r.segment_id}</strong>：{r.reason}
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        )}
        <div className="ccr-field">
          <dt>CMS 訊息（中文）</dt>
          <dd>{routeActions.cms_message_zh ?? '後端未提供'}</dd>
        </div>
        <div className="ccr-field">
          <dt>CMS 訊息（英文）</dt>
          <dd>{routeActions.cms_message_en ?? '後端未提供'}</dd>
        </div>
      </dl>
    </section>
  );
}

function PublicGuidanceSection({
  guidance,
}: {
  readonly guidance: {
    readonly zh: string | null;
    readonly en: string | null;
    readonly ja: string | null;
    readonly ko: string | null;
  };
}): ReactNode {
  return (
    <section className="ccr-section">
      <h4 className="ccr-section__heading">公眾引導訊息</h4>
      <dl className="ccr-fields">
        <div className="ccr-field">
          <dt>中文</dt>
          <dd>{guidance.zh ?? '後端未提供'}</dd>
        </div>
        <div className="ccr-field">
          <dt>English</dt>
          <dd>{guidance.en ?? '後端未提供'}</dd>
        </div>
        <div className="ccr-field">
          <dt>日本語</dt>
          <dd>{guidance.ja ?? '後端未提供'}</dd>
        </div>
        <div className="ccr-field">
          <dt>한국어</dt>
          <dd>{guidance.ko ?? '後端未提供'}</dd>
        </div>
      </dl>
    </section>
  );
}

export function ControlCenterRecommendationPanel({
  recommendation,
}: ControlCenterRecommendationPanelProps): ReactNode {
  if (recommendation === null) {
    return (
      <div className="ccr-panel">
        <h3 className="ccr-panel__heading">交控中心建議書</h3>
        <p className="ccr-empty">尚無建議書資料，請注入突發事件</p>
      </div>
    );
  }

  const triggeredArticles = (recommendation.incident_summary ?? '').match(/\d+/g);
  const articleNumbers = recommendation.technical_actions
    .map((a) => a.source_article)
    .filter((n): n is number => n !== null);

  return (
    <div className="ccr-panel">
      <h3 className="ccr-panel__heading">交控中心建議書</h3>

      <section className="ccr-section">
        <h4 className="ccr-section__heading">事件摘要</h4>
        <dl className="ccr-fields">
          <div className="ccr-field">
            <dt>建議書標題</dt>
            <dd>{recommendation.title ?? '後端未提供'}</dd>
          </div>
          <div className="ccr-field">
            <dt>事件摘要</dt>
            <dd>{recommendation.incident_summary ?? '後端未提供'}</dd>
          </div>
          <div className="ccr-field">
            <dt>事件分類</dt>
            <dd>{recommendation.classification ?? '後端未提供'}</dd>
          </div>
        </dl>
      </section>

      <section className="ccr-section">
        <h4 className="ccr-section__heading">技術動作（號誌調整）</h4>
        {recommendation.technical_actions.length === 0 ? (
          <p className="ccr-empty">後端未提供技術動作</p>
        ) : (
          <div className="ccr-technical-actions">
            {recommendation.technical_actions.map((action, i) => (
              <TechnicalActionRow key={i} action={action} index={i} />
            ))}
          </div>
        )}
      </section>

      <RouteActionsSection routeActions={recommendation.route_actions} />

      {recommendation.coordination_actions.length > 0 && (
        <section className="ccr-section">
          <h4 className="ccr-section__heading">協調動作</h4>
          <ul className="ccr-list">
            {recommendation.coordination_actions.map((action, i) => (
              <li key={i}>{action}</li>
            ))}
          </ul>
        </section>
      )}

      <PublicGuidanceSection guidance={recommendation.public_guidance} />
    </div>
  );
}
