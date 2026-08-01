/**
 * SOP Evidence Builder — shared helper for building `RagTrace` from retrieval results.
 *
 * Used by both:
 *  - What-if stage 4 (explanation.ts)
 *  - Event / incident handler (future — integrator connects here)
 *
 * Design constraints:
 *  - `retriever_type` is passed in; this module does NOT invent AWS KB claims
 *  - Article headings are extracted from the SOP text itself (section headers)
 *  - No LLM call — purely deterministic text extraction
 *
 * @module backend/reasoning/sop_evidence
 */

import type { RagTrace, RagTraceChunk } from '@city-commander/shared-schemas';
import type { SopCitationResult } from '@city-commander/rag';

// Article headings extracted from emergency_traffic_sop.txt
const ARTICLE_HEADINGS: ReadonlyMap<number, string> = new Map([
  [1, '交通擁塞級別判定'],
  [2, '車禍與路障應變'],
  [3, '捷運與接駁分流'],
  [4, '大巨蛋散場啟動'],
  [5, '號誌故障應變'],
  [6, '數位通報與多語化'],
  [7, '預計恢復時間 (ETE) 計算'],
]);

/**
 * Retriever type labels.
 * "aws_bedrock_kb"  — real managed AWS Bedrock Knowledge Base
 * "local_sop_knowledge_base" — in-memory SOP (no AWS KB, no network call)
 */
export type RetrieverType = 'aws_bedrock_kb' | 'local_sop_knowledge_base';

/**
 * Build a `RagTrace` from SOP citation results.
 *
 * @param citations       — verbatim citations from SopRetriever.retrieve()
 * @param query          — the original query / context string used for retrieval
 * @param retrieverType  — "aws_bedrock_kb" or "local_sop_knowledge_base"
 * @param knowledgeSource — human-readable source label (e.g. "emergency_traffic_sop.txt")
 * @returns RagTrace (deterministic — no LLM call)
 */
export function buildRagTrace(
  citations: readonly SopCitationResult[],
  query: string,
  retrieverType: RetrieverType,
  knowledgeSource: string,
): RagTrace {
  const retrieved_chunks: RagTraceChunk[] = citations.map((c) => {
    const heading = ARTICLE_HEADINGS.get(c.article_no) ?? `第 ${c.article_no} 條`;
    return {
      article: c.article_no,
      heading,
      excerpt: c.content,
      score: c.relevancy_score,
      source: c.source_location,
    };
  });

  return Object.freeze({
    retriever_type: retrieverType,
    knowledge_source: knowledgeSource,
    query,
    retrieved_chunks,
    citations: citations.map((c) => c.article_no),
    retrieval_count: citations.length,
  });
}

/**
 * Map a SopRetriever source string to the canonical retriever type.
 *
 * "kb"            → "aws_bedrock_kb"
 * "s3_fallback"   → "local_sop_knowledge_base" (still falls back to local SOP text)
 * "kb_partial_s3_fallback" → "local_sop_knowledge_base"
 */
export function mapRetrieverType(source: 'kb' | 's3_fallback' | 'kb_partial_s3_fallback'): RetrieverType {
  switch (source) {
    case 'kb':
      return 'aws_bedrock_kb';
    case 'kb_partial_s3_fallback':
    case 's3_fallback':
      return 'local_sop_knowledge_base';
  }
}

/**
 * Build a short retrieval context string for use as `RagTrace.query`.
 *
 * Captures the articles to be cited plus any ETE or action context.
 */
export function buildRetrievalContext(
  triggeredArticles: readonly number[],
  appliedFormulaArticles: readonly number[],
  eteMinutes?: number,
  expectedActions?: readonly string[],
): string {
  const parts: string[] = [];

  if (triggeredArticles.length > 0) {
    parts.push(`觸發 SOP 第 ${triggeredArticles.join('、')} 條`);
  }
  if (appliedFormulaArticles.length > 0) {
    parts.push(`套用公式 SOP 第 ${appliedFormulaArticles.join('、')} 條`);
  }
  if (eteMinutes !== undefined) {
    parts.push(`ETE=${eteMinutes} 分鐘`);
  }
  if (expectedActions && expectedActions.length > 0) {
    parts.push(`預期動作：${expectedActions.slice(0, 2).join('；')}`);
  }

  return parts.length > 0 ? parts.join('。') : 'What-if 假設情境';
}
