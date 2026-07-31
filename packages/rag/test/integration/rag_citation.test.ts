/**
 * RAG citation integration test (TASK-120, step 1)
 *
 * 驗證：
 * - citation_article_set 映射到正確的 SOP 條款（triggered ∪ applied = art.1+2+7）
 * - KB 失敗時，S3 fallback 保持完整 citation（不丟失任何 article）
 * - verbatim source_location 來自 KB 或 S3 URI，不被改寫
 * - 使用 MockBedrockAdapter（無實際 AWS 呼叫）
 */

import { describe, it, expect, vi } from 'vitest';
import { SopRetriever } from '../../src/sop_retriever.js';
import { buildCitationArticleSet } from '../../src/citation_article_set.js';
import type { KbRetrieveClient, SopCitationResult } from '../../src/sop_retriever.js';
import type { SopS3Fallback, SopArticleFetchResult } from '../../src/sop_s3_fallback.js';
import type { DecisionCore } from '@city-commander/shared-schemas';
import type { KnowledgeBaseRetrievalResult } from '@aws-sdk/client-bedrock-agent-runtime';

// ─── Stub helpers ──────────────────────────────────────────────────────────

function makeCore(
  triggered: number[],
  applied: number[],
): Pick<DecisionCore, 'triggered_articles' | 'applied_formula_articles'> {
  return {
    triggered_articles: triggered,
    applied_formula_articles: applied,
  } as unknown as DecisionCore;
}

/** KB client 回傳指定 article_no 的 mock 結果 */
function makeKbClient(articleResults: Array<{ article_no: number; content: string; uri: string }>): KbRetrieveClient {
  return {
    retrieve: vi.fn(async (): Promise<KnowledgeBaseRetrievalResult[]> =>
      articleResults.map((r) => ({
        content: { text: r.content },
        score: 0.9,
        location: { s3Location: { uri: r.uri }, type: 'S3' },
        metadata: { article_no: r.article_no },
      } as KnowledgeBaseRetrievalResult)),
    ),
  };
}

/** KB 失敗 client */
function makeKbClientFailing(): KbRetrieveClient {
  return {
    retrieve: vi.fn(async () => { throw new Error('KB unavailable'); }),
  };
}

/** S3 fallback stub */
function makeS3Fallback(articles: Array<{ no: number; text: string; bucket: string }>): SopS3Fallback {
  return {
    fetchArticle: vi.fn(async (articleNo: number): Promise<SopArticleFetchResult> => {
      const found = articles.find((a) => a.no === articleNo);
      if (!found) throw new Error(`S3: article ${articleNo} not found`);
      return {
        article_no: found.no,
        title: `SOP 第 ${found.no} 條`,
        text: found.text,
        s3_uri: `s3://${found.bucket}/sop/article-${found.no}.json`,
      };
    }),
  } as unknown as SopS3Fallback;
}

/** S3 fallback 失敗 stub */
function makeS3FallbackFailing(): SopS3Fallback {
  return {
    fetchArticle: vi.fn(async () => { throw new Error('S3 unavailable'); }),
  } as unknown as SopS3Fallback;
}

// ─── ACC_001 golden: triggered=[1,2] applied=[7] → citation_article_set=[1,2,7] ──

describe('RAG citation — citation_article_set mapping', () => {
  it('ACC_001: triggered=[1,2] applied=[7] → citations cover articles 1, 2, 7', async () => {
    const core = makeCore([1, 2], [7]);
    const citationSet = buildCitationArticleSet(core as DecisionCore);
    expect(citationSet).toEqual([1, 2, 7]);

    const kbClient = makeKbClient([
      { article_no: 1, content: 'SOP 第 1 條原文', uri: 's3://bucket/sop/article-1.json#article-1' },
      { article_no: 2, content: 'SOP 第 2 條原文', uri: 's3://bucket/sop/article-2.json#article-2' },
      { article_no: 7, content: 'SOP 第 7 條原文', uri: 's3://bucket/sop/article-7.json#article-7' },
    ]);
    const retriever = new SopRetriever('kb-id', kbClient, makeS3FallbackFailing());
    const result = await retriever.retrieve(citationSet, 'ACC_001 事件');

    expect(result.outcome).toBe('success');
    if (result.outcome === 'success') {
      const coveredArticles = result.citations.map((c) => c.article_no).sort((a, b) => a - b);
      // citation_article_set 的每個 article 都必須有對應 citation
      for (const article of citationSet) {
        expect(coveredArticles).toContain(article);
      }
      expect(result.source).toBe('kb');
    }
  });

  it('verbatim source_location preserved from KB (not rewritten)', async () => {
    const citationSet = [2];
    const verbatimUri = 's3://official-bucket/sop/article-2.json?versionId=abc123';
    const kbClient = makeKbClient([
      { article_no: 2, content: 'SOP 第 2 條', uri: verbatimUri },
    ]);
    const retriever = new SopRetriever('kb-id', kbClient, makeS3FallbackFailing());
    const result = await retriever.retrieve(citationSet, '事件背景');

    expect(result.outcome).toBe('success');
    if (result.outcome === 'success') {
      const citation = result.citations.find((c) => c.article_no === 2);
      expect(citation?.source_location).toBe(verbatimUri);
    }
  });

  it('empty citation_article_set → empty citations, no KB call', async () => {
    const kbClient = makeKbClient([]);
    const retriever = new SopRetriever('kb-id', kbClient, makeS3FallbackFailing());
    const result = await retriever.retrieve([], '事件');

    expect(result.outcome).toBe('success');
    if (result.outcome === 'success') {
      expect(result.citations).toHaveLength(0);
    }
    expect(kbClient.retrieve).not.toHaveBeenCalled();
  });
});

// ─── KB failure → S3 fallback keeps citations ──────────────────────────────

describe('RAG citation — KB failure → S3 fallback', () => {
  it('KB unavailable → S3 fallback covers all articles, source=s3_fallback', async () => {
    const citationSet = [1, 2, 7];
    const s3Fallback = makeS3Fallback([
      { no: 1, text: 'SOP 第 1 條 S3 原文', bucket: 'sop-bucket' },
      { no: 2, text: 'SOP 第 2 條 S3 原文', bucket: 'sop-bucket' },
      { no: 7, text: 'SOP 第 7 條 S3 原文', bucket: 'sop-bucket' },
    ]);
    const retriever = new SopRetriever('kb-id', makeKbClientFailing(), s3Fallback);
    const result = await retriever.retrieve(citationSet, 'ACC_001 事件');

    expect(result.outcome).toBe('success');
    if (result.outcome === 'success') {
      expect(result.source).toBe('s3_fallback');
      const coveredArticles = result.citations.map((c) => c.article_no).sort((a, b) => a - b);
      for (const article of citationSet) {
        expect(coveredArticles).toContain(article);
      }
    }
  });

  it('S3 fallback source_location is real S3 URI', async () => {
    const s3Fallback = makeS3Fallback([
      { no: 2, text: 'SOP 第 2 條', bucket: 'my-sop-bucket' },
    ]);
    const retriever = new SopRetriever('kb-id', makeKbClientFailing(), s3Fallback);
    const result = await retriever.retrieve([2], '事件');

    expect(result.outcome).toBe('success');
    if (result.outcome === 'success') {
      const citation = result.citations.find((c) => c.article_no === 2);
      expect(citation?.source_location).toBe('s3://my-sop-bucket/sop/article-2.json');
      expect(citation?.source).toBe('s3_fallback');
      expect(citation?.relevancy_score).toBeNull();
    }
  });

  it('KB partial failure → partial KB + S3 fallback for missing articles', async () => {
    // KB 只回傳 art.1，art.2 + art.7 缺漏 → 走 S3 fallback
    const kbClient = makeKbClient([
      { article_no: 1, content: 'SOP 第 1 條 KB', uri: 's3://bucket/sop/article-1.json' },
    ]);
    const s3Fallback = makeS3Fallback([
      { no: 2, text: 'SOP 第 2 條 S3', bucket: 'sop-bucket' },
      { no: 7, text: 'SOP 第 7 條 S3', bucket: 'sop-bucket' },
    ]);
    const retriever = new SopRetriever('kb-id', kbClient, s3Fallback);
    const result = await retriever.retrieve([1, 2, 7], 'ACC_001');

    expect(result.outcome).toBe('success');
    if (result.outcome === 'success') {
      expect(result.source).toBe('kb_partial_s3_fallback');
      const articles = result.citations.map((c) => c.article_no).sort((a, b) => a - b);
      expect(articles).toContain(1);
      expect(articles).toContain(2);
      expect(articles).toContain(7);
    }
  });

  it('KB + S3 both fail → both_failed with failed_articles', async () => {
    const retriever = new SopRetriever('kb-id', makeKbClientFailing(), makeS3FallbackFailing());
    const result = await retriever.retrieve([1, 2], '事件');

    expect(result.outcome).toBe('both_failed');
    if (result.outcome === 'both_failed') {
      // 兩個 article 都在 failed_articles（citation loss 驗證）
      expect(result.failed_articles).toContain(1);
      expect(result.failed_articles).toContain(2);
      expect(result.failed_articles).toHaveLength(2);
    }
  });
});

// ─── citation content preserved verbatim ─────────────────────────────────

describe('RAG citation — verbatim content preservation', () => {
  it('citation content matches KB result text exactly', async () => {
    const exactContent = '第 2 條：車禍路障應變，觸發條件三項同時成立：status ∈ {Closed,Blocked,Restricted}，severity ∈ {High,Critical}，affected_segment 以 RD_ 開頭。';
    const kbClient = makeKbClient([
      { article_no: 2, content: exactContent, uri: 's3://bucket/sop/article-2.json' },
    ]);
    const retriever = new SopRetriever('kb-id', kbClient, makeS3FallbackFailing());
    const result = await retriever.retrieve([2], '事件');

    if (result.outcome === 'success') {
      const citation = result.citations.find((c: SopCitationResult) => c.article_no === 2);
      expect(citation?.content).toBe(exactContent);
    }
  });
});
