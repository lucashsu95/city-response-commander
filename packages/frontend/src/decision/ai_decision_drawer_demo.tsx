/**
 * AI Decision Drawer — Demo Mode
 *
 * Displays the full RAG evidence chain and AI reasoning for demo-mode decisions:
 * - retriever_type & knowledge_source
 * - retrieved SOP chunks
 * - citations
 * - route reasoning (accepted / rejected routes)
 * - model_id
 * - text_source (deterministic / Bedrock)
 *
 * Clearly labels "SOP Knowledge Base 檢索證據" and shows
 * "local_sop_knowledge_base" as-is without claiming AWS Managed KB.
 *
 * @module frontend/decision/ai_decision_drawer_demo
 */

import { useState, type ReactNode } from 'react';

export interface AiDecisionDrawerDemoProps {
  readonly retrieverType: string | null;
  readonly modelId: string | null;
  readonly textSource: string | null;
  readonly ragTrace: Readonly<Record<string, unknown>> | null;
  readonly evidenceTrace: Readonly<Record<string, unknown>>;
  readonly acceptedRoutes: readonly string[];
  readonly rejectedRoutes: readonly { id: string; reason: string }[];
}

type DrawerSection = 'rag' | 'routes' | 'sop';

export function AiDecisionDrawerDemo({
  retrieverType,
  modelId,
  textSource,
  ragTrace,
  evidenceTrace,
  acceptedRoutes,
  rejectedRoutes,
}: AiDecisionDrawerDemoProps): ReactNode {
  const [openSection, setOpenSection] = useState<DrawerSection | null>('rag');

  const isLocalKb = retrieverType === 'local_sop_knowledge_base';

  const retrievedChunks = (() => {
    if (ragTrace === null) return [];
    const chunks = ragTrace['retrieved_chunks'];
    if (!Array.isArray(chunks)) return [];
    return chunks as ReadonlyArray<{
      readonly article?: unknown;
      readonly heading?: unknown;
      readonly excerpt?: unknown;
      readonly score?: unknown;
      readonly source?: unknown;
    }>;
  })();

  const ragCitations = (() => {
    if (ragTrace === null) return [];
    const citations = ragTrace['citations'];
    if (!Array.isArray(citations)) return [];
    return citations as readonly number[];
  })();

  const knowledgeSource = (() => {
    if (ragTrace === null) return null;
    const ks = ragTrace['knowledge_source'];
    return typeof ks === 'string' ? ks : null;
  })();

  const query = (() => {
    if (ragTrace === null) return null;
    const q = ragTrace['query'];
    return typeof q === 'string' ? q : null;
  })();

  const retrievalCount = (() => {
    if (ragTrace === null) return null;
    const rc = ragTrace['retrieval_count'];
    return typeof rc === 'number' ? rc : null;
  })();

  const sopCitations = (() => {
    const sc = evidenceTrace['sop_citations'];
    if (!Array.isArray(sc)) return [];
    return sc as ReadonlyArray<{
      readonly article_no?: unknown;
      readonly content?: unknown;
      readonly score?: unknown;
      readonly source_location?: unknown;
    }>;
  })();

  return (
    <div className="ai-decision-drawer-demo">
      <h4 className="ai-decision-drawer-demo__heading">AI 決策推理鏈</h4>

      <dl className="ai-decision-drawer-demo__meta">
        <div className="ai-decision-drawer-demo__meta-row">
          <dt>文字來源</dt>
          <dd>
            <span className="ai-badge">{textSource ?? '後端未提供'}</span>
          </dd>
        </div>
        <div className="ai-decision-drawer-demo__meta-row">
          <dt>模型</dt>
          <dd>{modelId ?? '後端未提供'}</dd>
        </div>
        <div className="ai-decision-drawer-demo__meta-row">
          <dt>檢索器類型</dt>
          <dd>{retrieverType ?? '後端未提供'}</dd>
        </div>
        <div className="ai-decision-drawer-demo__meta-row">
          <dt>知識來源</dt>
          <dd>
            {knowledgeSource ?? '後端未提供'}
            {isLocalKb && (
              <span className="ai-decision-drawer-demo__kb-note">
                {' '}
                （local_sop_knowledge_base，local 模式，無 AWS Managed KB）
              </span>
            )}
          </dd>
        </div>
        {query !== null && (
          <div className="ai-decision-drawer-demo__meta-row">
            <dt>檢索 Query</dt>
            <dd>{query}</dd>
          </div>
        )}
        {retrievalCount !== null && (
          <div className="ai-decision-drawer-demo__meta-row">
            <dt>檢索命中數</dt>
            <dd>{retrievalCount}</dd>
          </div>
        )}
      </dl>

      <div className="ai-decision-drawer-demo__tabs">
        <button
          type="button"
          className={`ai-decision-drawer-demo__tab${openSection === 'rag' ? ' ai-decision-drawer-demo__tab--active' : ''}`}
          onClick={() => setOpenSection(openSection === 'rag' ? null : 'rag')}
        >
          RAG 檢索證據
        </button>
        <button
          type="button"
          className={`ai-decision-drawer-demo__tab${openSection === 'sop' ? ' ai-decision-drawer-demo__tab--active' : ''}`}
          onClick={() => setOpenSection(openSection === 'sop' ? null : 'sop')}
        >
          SOP 引用
        </button>
        <button
          type="button"
          className={`ai-decision-drawer-demo__tab${openSection === 'routes' ? ' ai-decision-drawer-demo__tab--active' : ''}`}
          onClick={() => setOpenSection(openSection === 'routes' ? null : 'routes')}
        >
          路徑推理
        </button>
      </div>

      {openSection === 'rag' && (
        <div className="ai-decision-drawer-demo__content">
          <p className="ai-decision-drawer-demo__section-label">SOP Knowledge Base 檢索證據</p>
          {retrievedChunks.length === 0 ? (
            <p className="ai-decision-drawer-demo__empty">後端未提供檢索區塊</p>
          ) : (
            <ol className="ai-decision-drawer-demo__chunks">
              {retrievedChunks.map((chunk, i) => (
                <li key={i} className="ai-decision-drawer-demo__chunk">
                  <div className="ai-decision-drawer-demo__chunk-header">
                    <strong>第 {String(chunk.article ?? '?')} 條</strong>
                    {chunk.heading !== undefined && (
                      <span> — {String(chunk.heading)}</span>
                    )}
                  </div>
                  <blockquote className="ai-decision-drawer-demo__chunk-excerpt">
                    {String(chunk.excerpt ?? '（無內容）')}
                  </blockquote>
                  <div className="ai-decision-drawer-demo__chunk-meta">
                    {chunk.score !== null && chunk.score !== undefined && (
                      <span>相關度分數：{Number(chunk.score).toFixed(3)}</span>
                    )}
                    {chunk.source !== undefined && (
                      <span>來源：{String(chunk.source)}</span>
                    )}
                  </div>
                </li>
              ))}
            </ol>
          )}
          {ragCitations.length > 0 && (
            <p className="ai-decision-drawer-demo__citations">
              引用條款：{ragCitations.map((a) => `第 ${a} 條`).join('、')}
            </p>
          )}
        </div>
      )}

      {openSection === 'sop' && (
        <div className="ai-decision-drawer-demo__content">
          {sopCitations.length === 0 ? (
            <p className="ai-decision-drawer-demo__empty">後端未提供 SOP 引用</p>
          ) : (
            <ol className="ai-decision-drawer-demo__citations">
              {sopCitations.map((cit, i) => (
                <li key={i} className="ai-decision-drawer-demo__citation">
                  <div className="ai-decision-drawer-demo__citation-header">
                    <strong>SOP 第 {String(cit.article_no ?? '?')} 條</strong>
                    {cit.score !== null && cit.score !== undefined && (
                      <span className="ai-decision-drawer-demo__citation-score">
                        {' '}
                        分數：{Number(cit.score).toFixed(3)}
                      </span>
                    )}
                  </div>
                  <blockquote className="ai-decision-drawer-demo__citation-content">
                    {String(cit.content ?? '（無內容）')}
                  </blockquote>
                  {cit.source_location !== undefined && (
                    <p className="ai-decision-drawer-demo__citation-source">
                      來源位置：{String(cit.source_location)}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>
      )}

      {openSection === 'routes' && (
        <div className="ai-decision-drawer-demo__content">
          <div className="ai-decision-drawer-demo__route-section">
            <h5 className="ai-decision-drawer-demo__route-heading">採用路徑</h5>
            {acceptedRoutes.length === 0 ? (
              <p className="ai-decision-drawer-demo__empty">後端未提供採用路徑</p>
            ) : (
              <ul className="ai-decision-drawer-demo__routes">
                {acceptedRoutes.map((route) => (
                  <li key={route} className="ai-decision-drawer-demo__route ai-decision-drawer-demo__route--accepted">
                    <span className="ai-decision-drawer-demo__route-icon">&#10003;</span>
                    {route}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="ai-decision-drawer-demo__route-section">
            <h5 className="ai-decision-drawer-demo__route-heading">排除路徑</h5>
            {rejectedRoutes.length === 0 ? (
              <p className="ai-decision-drawer-demo__empty">後端未提供排除路徑</p>
            ) : (
              <ul className="ai-decision-drawer-demo__routes">
                {rejectedRoutes.map((route) => (
                  <li key={route.id} className="ai-decision-drawer-demo__route ai-decision-drawer-demo__route--rejected">
                    <span className="ai-decision-drawer-demo__route-icon">&#10007;</span>
                    <div>
                      <strong>{route.id}</strong>
                      <br />
                      <small>原因：{route.reason}</small>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
