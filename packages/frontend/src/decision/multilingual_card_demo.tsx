/**
 * Demo Multilingual Alert Card
 *
 * Displays multilingual public alerts with language tabs (中文/English/日本語/한국어).
 * Highlights the card when multilingual_required=true (roaming rate ≥ 30% threshold).
 *
 * Implements two-stage publish confirmation:
 * 1. Preview step — shows pending channels, languages, approved_by
 * 2. Confirm step — calls POST /decisions/{decision_id}/publish
 *    On success: displays publish_state, channels, languages, published_at,
 *    approved_by, delivery_mode. If delivery_mode=competition_demo_dispatch,
 *    shows the disclaimer that this is a competition demo dispatch.
 *
 * @module frontend/decision/multilingual_card_demo
 */

import * as React from 'react';
import type { ReactNode } from 'react';
import type { DemoDecisionView, DemoApiClient } from '../api/demo_api_adapter.js';

export interface MultilingualCardDemoProps {
  readonly decision: DemoDecisionView | null;
  readonly adapter: DemoApiClient;
}

type PublishStage = 'idle' | 'preview' | 'confirming' | 'success' | 'error';

interface PublishResult {
  readonly publishState: string;
  readonly channels: readonly string[];
  readonly languages: readonly string[];
  readonly publishedAt: string;
  readonly approvedBy: string;
  readonly deliveryMode: string;
}

const LANGUAGE_LABELS = ['中文', 'English', '日本語', '한국어'] as const;
type Language = typeof LANGUAGE_LABELS[number];

function getAlertContent(
  decision: DemoDecisionView,
  lang: Language,
): string {
  const alerts = decision.publicAlerts;
  if (!alerts) return '後端未提供';
  const msgs = alerts.messages;
  const map: Record<Language, string | null> = {
    中文: msgs.zh ?? null,
    English: msgs.en ?? null,
    日本語: msgs.ja ?? null,
    한국어: msgs.ko ?? null,
  };
  return map[lang] ?? '後端未提供';
}

function getAvailableLanguages(decision: DemoDecisionView): Language[] {
  const alerts = decision.publicAlerts;
  if (!alerts) return ['中文', 'English'];
  const msgs = alerts.messages;
  return LANGUAGE_LABELS.filter((l) => {
    if (l === '中文' || l === 'English') return true;
    return msgs[l] != null && msgs[l] !== '';
  });
}

export function MultilingualCardDemo({ decision, adapter }: MultilingualCardDemoProps): ReactNode {
  const [activeTab, setActiveTab] = React.useState<Language>('中文');
  const [publishStage, setPublishStage] = React.useState<PublishStage>('idle');
  const [publishResult, setPublishResult] = React.useState<PublishResult | null>(null);
  const [publishError, setPublishError] = React.useState<string | null>(null);
  const [publishing, setPublishing] = React.useState<boolean>(false);

  if (decision === null) {
    return (
      <div className="ai-card ai-card--multilingual">
        <div className="ai-card__header">
          <span className="ai-card__icon" aria-hidden="true">◎</span>
          <h3 className="ai-card__title">多語通報</h3>
        </div>
        <div className="ai-card__body">
          <p className="ai-card__empty-text">後端未提供多語通報內容</p>
        </div>
      </div>
    );
  }

  const alerts = decision.publicAlerts;
  const hasContent = alerts !== null;
  const isHighlighted = decision.multilingualRequired;
  const availableLanguages = getAvailableLanguages(decision);
  // SOP Article 6 threshold: roaming ≥ 30% triggers multilingual alerts
  const sopTriggerEvidence = {
    threshold_ratio: 0.30,
    threshold_percent: '30%',
    source_article: 'SOP 第 6 條',
  };

  const handlePublishClick = () => {
    setPublishStage('preview');
    setPublishError(null);
  };

  const handleConfirmPublish = async () => {
    setPublishStage('confirming');
    setPublishing(true);
    setPublishError(null);
    try {
      const result = await adapter.publishDecision(
        decision.decisionId,
        ['sms', 'cms'],
        'demo-commander',
        availableLanguages,
      );
      if (!result.ok) {
        setPublishError(result.error.message);
        setPublishStage('preview');
      } else {
        const body = result.data.body as Record<string, unknown>;
        setPublishResult({
          publishState: String(body.publish_state ?? 'unknown'),
          channels: Array.isArray(body.channels) ? body.channels as readonly string[] : [],
          languages: Array.isArray(body.languages) ? body.languages as readonly string[] : [],
          publishedAt: String(body.published_at ?? new Date().toISOString()),
          approvedBy: String(body.approved_by ?? 'demo-commander'),
          deliveryMode: String(body.delivery_mode ?? 'unknown'),
        });
        setPublishStage('success');
      }
    } catch (e) {
      setPublishError(e instanceof Error ? e.message : String(e));
      setPublishStage('preview');
    } finally {
      setPublishing(false);
    }
  };

  const handleDismiss = () => {
    setPublishStage('idle');
    setPublishResult(null);
    setPublishError(null);
  };

  const cardClass = [
    'ai-card',
    'ai-card--multilingual',
    isHighlighted ? 'ai-card--highlighted' : '',
  ].filter(Boolean).join(' ');

  return (
    <div className={cardClass}>
      <div className="ai-card__header">
        <span className="ai-card__icon" aria-hidden="true">◎</span>
        <h3 className="ai-card__title">多語通報</h3>
        {isHighlighted && (
          <span className="ai-card__threshold-badge">
            漫遊率已達 30% 通報門檻
          </span>
        )}
      </div>
      <div className="ai-card__body">
        {/* 30% threshold evidence — visible when multilingualRequired=true */}
        {isHighlighted && (
          <div className="ai-multilingual-evidence">
            <p className="ai-multilingual-evidence__title">30% 門檻觸發證據</p>
            <dl className="ai-multilingual-evidence__list">
              <div>
                <dt>來源 SOP</dt>
                <dd>{sopTriggerEvidence.source_article}</dd>
              </div>
              <div>
                <dt>漫遊率門檻</dt>
                <dd>≥ {sopTriggerEvidence.threshold_percent}</dd>
              </div>
              <div>
                <dt>觸發條件</dt>
                <dd>任一站點 Roaming_User_Pct ≥ {sopTriggerEvidence.threshold_percent}</dd>
              </div>
            </dl>
            <p className="ai-multilingual-evidence__note">
              站點與實際漫遊率詳見下方地圖人流卡片；本卡顯示由 {sopTriggerEvidence.source_article} 自動觸發的多語文案。
            </p>
          </div>
        )}
        {/* Publish Stage: idle / preview / confirming / success / error */}
        {publishStage === 'idle' && (
          <>
            {hasContent ? (
              <>
                <div className="ai-multilingual-tabs" role="tablist">
                  {LANGUAGE_LABELS.map((lang) => (
                    <button
                      key={lang}
                      type="button"
                      role="tab"
                      aria-selected={activeTab === lang}
                      className={[
                        'ai-multilingual-tab__btn',
                        activeTab === lang ? 'ai-multilingual-tab__btn--active' : '',
                        !availableLanguages.includes(lang) ? 'ai-multilingual-tab__btn--unavailable' : '',
                      ].filter(Boolean).join(' ')}
                      onClick={() => setActiveTab(lang)}
                    >
                      {lang}
                    </button>
                  ))}
                </div>
                <div className="ai-multilingual-tab__content" role="tabpanel">
                  <p className="ai-multilingual-tab__text">
                    {getAlertContent(decision, activeTab)}
                  </p>
                </div>
              </>
            ) : (
              <p className="ai-card__empty-text">後端未提供多語通報內容</p>
            )}
            <button
              type="button"
              className="ai-card__publish-btn"
              onClick={handlePublishClick}
            >
              一鍵發布
            </button>
          </>
        )}

        {publishStage === 'preview' && (
          <div className="ai-publish-preview">
            <h4 className="ai-publish-preview__title">待發布內容確認</h4>
            <dl className="ai-publish-preview__list">
              <dt>決策 ID</dt>
              <dd><code>{decision.decisionId}</code></dd>
              <dt>發布頻道</dt>
              <dd>{['SMS', 'CMS'].join('、')}</dd>
              <dt>發布語言</dt>
              <dd>{availableLanguages.join('、')}</dd>
              <dt>核准人</dt>
              <dd>demo-commander</dd>
            </dl>
            {publishError && (
              <p className="ai-publish-preview__error">錯誤：{publishError}</p>
            )}
            <div className="ai-publish-preview__actions">
              <button
                type="button"
                className="ai-publish-preview__confirm-btn"
                onClick={handleConfirmPublish}
              >
                確認發布
              </button>
              <button
                type="button"
                className="ai-publish-preview__cancel-btn"
                onClick={handleDismiss}
              >
                取消
              </button>
            </div>
          </div>
        )}

        {publishStage === 'confirming' && (
          <div className="ai-publish-confirming">
            <p>發布中…</p>
          </div>
        )}

        {publishStage === 'success' && publishResult && (
          <div className="ai-publish-success">
            <h4 className="ai-publish-success__title">發布成功</h4>
            <dl className="ai-publish-success__list">
              <dt>發布狀態</dt>
              <dd>{publishResult.publishState}</dd>
              <dt>頻道</dt>
              <dd>{publishResult.channels.join('、')}</dd>
              <dt>語言</dt>
              <dd>{publishResult.languages.join('、')}</dd>
              <dt>發布時間</dt>
              <dd>{publishResult.publishedAt}</dd>
              <dt>核准人</dt>
              <dd>{publishResult.approvedBy}</dd>
              <dt>派送模式</dt>
              <dd>{publishResult.deliveryMode}</dd>
            </dl>
            {publishResult.deliveryMode === 'competition_demo_dispatch' && (
              <p className="ai-publish-success__disclaimer">
                競賽展示派送，未連接真實電信簡訊閘道
              </p>
            )}
            <button
              type="button"
              className="ai-publish-success__close-btn"
              onClick={handleDismiss}
            >
              關閉
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
