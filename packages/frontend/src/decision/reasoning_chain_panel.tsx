/**
 * Reasoning Chain Panel
 *
 * Renders the demo backend's RAG trace, route reasoning trace, and
 * ETE (estimated recovery time) calculation as separate cards.
 *
 * All values come from the demo decision view returned by `/demo/incidents`.
 * No values are fabricated or derived — when the backend does not supply a
 * field, the panel renders "後端未提供".
 */

import type { ReactNode } from 'react';
import type { DemoDecisionView } from '../api/demo_api_adapter.js';

export interface ReasoningChainPanelProps {
  readonly decision: DemoDecisionView | null;
}

function stringifyField(value: unknown): string {
  if (value === null || value === undefined) return '後端未提供';
  if (typeof value === 'string') return value === '' ? '後端未提供' : value;
  if (typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (Array.isArray(value)) {
    if (value.length === 0) return '（空）';
    return value.map((v) => stringifyField(v)).join('、');
  }
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return '後端未提供';
    }
  }
  return '後端未提供';
}

function RagTraceCard({ trace }: { readonly trace: Readonly<Record<string, unknown>> | null }): ReactNode {
  if (trace === null) {
    return (
      <section className="rcp-section">
        <h4 className="rcp-section__heading">RAG 解釋鏈</h4>
        <p className="rcp-empty">後端未提供 RAG trace</p>
      </section>
    );
  }
  const retrieverType = stringifyField(trace.retriever_type);
  const knowledgeSource = stringifyField(trace.knowledge_source);
  const query = stringifyField(trace.query);
  const retrieved = Array.isArray(trace.retrieved_chunks) ? trace.retrieved_chunks : [];
  const citations = Array.isArray(trace.citations) ? trace.citations : [];

  return (
    <section className="rcp-section">
      <h4 className="rcp-section__heading">RAG 解釋鏈</h4>
      <dl className="rcp-fields">
        <div className="rcp-field">
          <dt>retriever_type</dt>
          <dd><code>{retrieverType}</code></dd>
        </div>
        <div className="rcp-field">
          <dt>knowledge_source</dt>
          <dd><code>{knowledgeSource}</code></dd>
        </div>
        <div className="rcp-field">
          <dt>query</dt>
          <dd><code>{query}</code></dd>
        </div>
        <div className="rcp-field">
          <dt>retrieved_chunks 數量</dt>
          <dd>{retrieved.length}</dd>
        </div>
        <div className="rcp-field">
          <dt>citations 數量</dt>
          <dd>{citations.length}</dd>
        </div>
      </dl>
      {retrieved.length > 0 && (
        <details className="rcp-details">
          <summary>查看 retrieved_chunks</summary>
          <ol className="rcp-chunks">
            {retrieved.map((chunk, i) => {
              const c = chunk as Record<string, unknown>;
              return (
                <li key={i} className="rcp-chunk">
                  <p><strong>SOP 第 {stringifyField(c.article)} 條</strong> — {stringifyField(c.heading)}</p>
                  <p className="rcp-chunk__excerpt">{stringifyField(c.excerpt)}</p>
                  <p className="rcp-chunk__source">source: {stringifyField(c.source)}</p>
                </li>
              );
            })}
          </ol>
        </details>
      )}
    </section>
  );
}

function RouteReasoningTraceCard({
  trace,
  decision,
}: {
  readonly trace: Readonly<Record<string, unknown>> | null;
  readonly decision: DemoDecisionView;
}): ReactNode {
  if (trace === null) {
    return (
      <section className="rcp-section">
        <h4 className="rcp-section__heading">路線推理鏈</h4>
        <p className="rcp-empty">後端未提供 route_reasoning_trace</p>
      </section>
    );
  }
  // Backend schema: `route_reasoning` is the per-candidate array.
  const rawCandidates = Array.isArray(trace.route_reasoning) ? trace.route_reasoning : [];
  const candidates = Array.isArray(trace.candidates) ? trace.candidates : [];
  const rows = rawCandidates.length > 0 ? rawCandidates : candidates;
  const primaryRoute = stringifyField(trace.primary_route);
  const primaryRouteCongested = trace.primary_route_congested === true;
  const incidentSegment = stringifyField(trace.incident_segment);

  return (
    <section className="rcp-section">
      <h4 className="rcp-section__heading">路線推理鏈（route_reasoning_trace）</h4>
      <dl className="rcp-fields">
        <div className="rcp-field">
          <dt>事故路段</dt>
          <dd><code>{incidentSegment}</code></dd>
        </div>
        <div className="rcp-field">
          <dt>主疏散路徑</dt>
          <dd>
            <strong>{primaryRoute}</strong>
            {primaryRouteCongested && (
              <span className="ccr-tag ccr-tag--warn" style={{ marginLeft: 6 }}>
                主路徑壅塞
              </span>
            )}
          </dd>
        </div>
        <div className="rcp-field">
          <dt>次要疏散路徑</dt>
          <dd>
            {decision.secondaryEvacuation.length > 0
              ? decision.secondaryEvacuation.join('、')
              : '後端未提供'}
          </dd>
        </div>
        <div className="rcp-field">
          <dt>排除路徑（含排除原因）</dt>
          <dd>
            {decision.excludedRoutes.length > 0 ? (
              <ul className="rcp-excluded">
                {decision.excludedRoutes.map((r) => (
                  <li key={r.segment_id}>
                    <strong>{r.segment_id}</strong>：{r.reason}
                  </li>
                ))}
              </ul>
            ) : (
              '（無）'
            )}
          </dd>
        </div>
        <div className="rcp-field">
          <dt>規劃耗時</dt>
          <dd>
            {decision.elapsedMs !== null
              ? `${decision.elapsedMs} ms`
              : '後端未提供'}
          </dd>
        </div>
        <div className="rcp-field">
          <dt>SOP 條款</dt>
          <dd>SOP 第 2 條（替代路線篩選）</dd>
        </div>
      </dl>
      {rows.length > 0 && (
        <details className="rcp-details" open>
          <summary>查看候選路段評估（{rows.length} 條）</summary>
          <table className="rcp-candidates">
            <thead>
              <tr>
                <th>路段 ID</th>
                <th>容量 (vph)</th>
                <th>飽和度</th>
                <th>結果</th>
                <th>原因</th>
                <th>SOP</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((cand, i) => {
                const c = cand as Record<string, unknown>;
                const segId =
                  stringifyField(c.candidate_segment) !== '後端未提供'
                    ? stringifyField(c.candidate_segment)
                    : stringifyField(c.segment_id);
                return (
                  <tr key={i}>
                    <td><code>{segId}</code></td>
                    <td>{stringifyField(c.capacity_vph)}</td>
                    <td>{stringifyField(c.saturation ?? c.saturation_score)}</td>
                    <td>
                      {c.accepted === true
                        ? '採用'
                        : c.accepted === false
                        ? '排除'
                        : '—'}
                    </td>
                    <td>{stringifyField(c.reason)}</td>
                    <td>第 {stringifyField(c.source_article)} 條</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </details>
      )}
    </section>
  );
}

function EteCalculationCard({
  calc,
  decision,
}: {
  readonly calc: Readonly<Record<string, unknown>> | null;
  readonly decision: DemoDecisionView;
}): ReactNode {
  return (
    <section className="rcp-section">
      <h4 className="rcp-section__heading">ETE 計算（SOP 第 7 條）</h4>
      {calc === null ? (
        <p className="rcp-empty">後端未提供 ete_calculation</p>
      ) : (
        <dl className="rcp-fields">
          <div className="rcp-field">
            <dt>source_article</dt>
            <dd>SOP 第 {stringifyField(calc.source_article)} 條</dd>
          </div>
          <div className="rcp-field">
            <dt>formula</dt>
            <dd><code>{stringifyField(calc.formula)}</code></dd>
          </div>
          <div className="rcp-field">
            <dt>variables</dt>
            <dd><code>{stringifyField(calc.variables)}</code></dd>
          </div>
          <div className="rcp-field">
            <dt>substitution</dt>
            <dd><code>{stringifyField(calc.substitution)}</code></dd>
          </div>
          <div className="rcp-field">
            <dt>result_minutes</dt>
            <dd>
              <strong>{stringifyField(calc.result_minutes)}</strong> 分鐘
            </dd>
          </div>
          <div className="rcp-field">
            <dt>base_timestamp</dt>
            <dd>{stringifyField(calc.base_timestamp)}</dd>
          </div>
          <div className="rcp-field">
            <dt>recovery_at</dt>
            <dd>{stringifyField(calc.recovery_at)}</dd>
          </div>
          <div className="rcp-field">
            <dt>timezone</dt>
            <dd>{stringifyField(calc.timezone)}</dd>
          </div>
        </dl>
      )}
      <dl className="rcp-fields">
        <div className="rcp-field">
          <dt>最終 ETE 分鐘</dt>
          <dd>
            <strong>{decision.eteMinutes}</strong> 分鐘
          </dd>
        </div>
        <div className="rcp-field">
          <dt>severity</dt>
          <dd>{decision.eteSeverity}</dd>
        </div>
        <div className="rcp-field">
          <dt>預計恢復時間</dt>
          <dd>{decision.recoveryAt ?? '後端未提供'}</dd>
        </div>
      </dl>
    </section>
  );
}

export function ReasoningChainPanel({ decision }: ReasoningChainPanelProps): ReactNode {
  if (decision === null) {
    return (
      <div className="rcp-panel">
        <h3 className="rcp-panel__heading">推理與 ETE</h3>
        <p className="rcp-empty">尚未注入事件。</p>
      </div>
    );
  }

  return (
    <div className="rcp-panel">
      <h3 className="rcp-panel__heading">推理與 ETE（模組 4）</h3>
      <RagTraceCard trace={decision.ragTrace} />
      <RouteReasoningTraceCard trace={decision.routeReasoningTrace} decision={decision} />
      <EteCalculationCard calc={decision.eteCalculation} decision={decision} />
    </div>
  );
}