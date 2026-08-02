/**
 * LocalSopRetriever — minimal SopRetriever for the demo Lambda.
 *
 * Why this exists:
 *  - The official SopRetriever uses Bedrock KB + per-article S3 objects
 *    (`sop/article-N.json`). The demo Lambda has neither: only the
 *    `emergency_traffic_sop.txt` file (loaded via the manifest gate).
 *  - To keep the What-if pipeline's stage-4 contract intact
 *    (it consumes `SopRetriever.retrieve()`) we ship a thin adapter
 *    that resolves citations directly from the in-memory SOP articles
 *    loaded at cold-start.
 *
 * Behaviour:
 *  - Treats the in-memory `SOPLoadResult` as authoritative (already
 *    verified by the manifest gate, verbatim content).
 *  - On `retrieve()` returns success with citations for every article in
 *    `citationArticleSet` whose number is 1..7 and present in memory.
 *  - Returns `both_failed` only when the in-memory loader is empty
 *    (impossible in production; protects against accidental misconfig).
 *
 * Boundaries:
 *  - This is NOT a Bedrock-KB integration. No AWS call. No network IO.
 *  - It does NOT recompute or paraphrase SOP content. Citations are
 *    verbatim from the in-memory load.
 *
 * Implementation:
 *  - Standalone class that exposes the same `retrieve(citationArticleSet,
 *    eventFacts)` contract as `SopRetriever`. The `production_handler`
 *    casts it to the official `SopRetriever` interface; the only method
 *    the pipeline actually calls is `retrieve`, so structural typing is
 *    sufficient.
 *
 * @module backend/whatif/local_sop_retriever
 */

import type { SopRetrieveResult, SopCitationResult } from '@city-commander/rag';
import type { SOPLoadResult } from '@city-commander/domain';

export class LocalSopRetriever {
  constructor(private readonly sopArticles: SOPLoadResult) {}

  async retrieve(
    citationArticleSet: readonly number[],
    _eventFacts: string,
  ): Promise<SopRetrieveResult> {
    if (citationArticleSet.length === 0) {
      return { outcome: 'success', citations: [], source: 'kb' };
    }

    const articles = this.sopArticles.articles;
    if (articles.length === 0) {
      return {
        outcome: 'both_failed',
        failed_articles: [...citationArticleSet],
        partial_citations: [],
        kb_error: 'in-memory SOP loader is empty',
        s3_error: 'local adapter does not call S3',
      };
    }

    const citations: SopCitationResult[] = [];
    const failed: number[] = [];

    for (const articleNo of citationArticleSet) {
      const chunk = this.sopArticles.getByArticleNo(articleNo);
      if (chunk === undefined) {
        failed.push(articleNo);
        continue;
      }
      citations.push({
        article_no: articleNo,
        content: chunk.text,
        source_location: `emergency_traffic_sop.txt#article-${articleNo}`,
        relevancy_score: null,
        source: 'kb',
      });
    }

    if (failed.length === citationArticleSet.length) {
      return {
        outcome: 'both_failed',
        failed_articles: failed,
        partial_citations: citations,
        kb_error: 'no SOP article matched the citation set',
        s3_error: 'local adapter does not call S3',
      };
    }

    return {
      outcome: 'success',
      citations: orderByArticleSet(citations, citationArticleSet),
      source: 'kb',
    };
  }
}

function orderByArticleSet(
  citations: readonly SopCitationResult[],
  citationArticleSet: readonly number[],
): SopCitationResult[] {
  const rank = new Map<number, number>();
  citationArticleSet.forEach((articleNo, index) => rank.set(articleNo, index));
  return [...citations].sort((a, b) => {
    const rankA = rank.get(a.article_no) ?? Number.MAX_SAFE_INTEGER;
    const rankB = rank.get(b.article_no) ?? Number.MAX_SAFE_INTEGER;
    if (rankA !== rankB) return rankA - rankB;
    return a.article_no - b.article_no;
  });
}
