/**
 * SopRetriever — Bedrock Knowledge Base Retrieve + S3 fallback (TASK-108)
 *
 * 職責（§4.2, §14.1, §14.2）：
 * - 以 `citation_article_set` + facts 查詢 Bedrock KB `Retrieve`
 * - 逐字保留 verbatim source location 作為 citation（不允許改寫 rule-engine 數值）
 * - KB 失敗 → 自動降級至 S3 fallback（TASK-109 `SopS3Fallback`）
 * - KB ID / region 全部由 ConfigProvider 注入，不硬編
 * - KB fallback 計數佔位（TODO：TASK-109 AC 要求 KbFallbackCount，Phase 10 metric 就緒後接入）
 *
 * 設計原則（§14.2）：
 * - `citation_article_set` 由決定性程式碼提供，RAG 不可改變其內容
 * - 每個 article 產生一筆 `SopCitationResult`；source_location 取自 KB 回應（verbatim）
 *   或 S3 fallback 的真實 URI（`s3://{bucket}/sop/article-{n}.json`）
 *
 * @module rag/sop_retriever
 */

import {
  BedrockAgentRuntimeClient,
  RetrieveCommand,
  type KnowledgeBaseRetrievalResult,
} from '@aws-sdk/client-bedrock-agent-runtime';
import type { ConfigProvider } from '@city-commander/config';
import { requireString } from './config_helpers.js';
import type { SopS3Fallback } from './sop_s3_fallback.js';

// ─── KB client interface ──────────────────────────────────────────────────────

/**
 * Bedrock Knowledge Base Retrieve 的抽象介面。
 *
 * 讓 SopRetriever 可注入 mock KB client（單元測試），
 * 對稱於 `BedrockInvoker` 介面的設計語言。
 */
export interface KbRetrieveClient {
  retrieve(
    knowledgeBaseId: string,
    query: string,
    numberOfResults: number,
  ): Promise<KnowledgeBaseRetrievalResult[]>;
}

/**
 * 生產用的 Bedrock Knowledge Base client 包裝。
 * 由 `createSopRetriever()` factory 自動建立；
 * 測試可注入實作 `KbRetrieveClient` 的 mock。
 */
export class BedrockKbClient implements KbRetrieveClient {
  private readonly client: BedrockAgentRuntimeClient;

  constructor(region: string) {
    this.client = new BedrockAgentRuntimeClient({ region });
  }

  async retrieve(
    knowledgeBaseId: string,
    query: string,
    numberOfResults: number,
  ): Promise<KnowledgeBaseRetrievalResult[]> {
    const command = new RetrieveCommand({
      knowledgeBaseId,
      retrievalQuery: { text: query },
      retrievalConfiguration: {
        vectorSearchConfiguration: { numberOfResults },
      },
    });
    const response = await this.client.send(command);
    return response.retrievalResults ?? [];
  }
}

// ─── Result types ─────────────────────────────────────────────────────────────

/**
 * 單一 SOP 條款的 citation 結果（KB 或 S3 fallback）。
 *
 * - `source_location`：verbatim source location，不可縮短或改寫
 *   KB 路徑：KB `Retrieve` 回傳的 `s3Location.uri` 或 `webLocation.url`
 *   S3 fallback：`s3://{sop_source_bucket}/sop/article-{article_no}.json`
 * - `relevancy_score`：KB 相關性分數；S3 fallback 為 `null`
 */
export interface SopCitationResult {
  readonly article_no: number;
  /** 條款原文段落（verbatim，不可改寫） */
  readonly content: string;
  /** Verbatim source location，供 citation 顯示；不可改寫或縮短 */
  readonly source_location: string;
  /** KB 相關性分數；S3 fallback 回傳 null */
  readonly relevancy_score: number | null;
  /** 資料來源 */
  readonly source: 'kb' | 's3_fallback';
}

/** `retrieve()` 成功 */
export interface SopRetrieveSuccess {
  readonly outcome: 'success';
  /** 每個 article 對應的 citation（保持 citation_article_set 的排序） */
  readonly citations: readonly SopCitationResult[];
  /** KB 直接成功 / 部分走 fallback / 全部走 fallback */
  readonly source: 'kb' | 'kb_partial_s3_fallback' | 's3_fallback';
}

/** KB 與 S3 均失敗，citation 缺口已記錄 */
export interface SopRetrieveBothFailed {
  readonly outcome: 'both_failed';
  /** 無法取得 citation 的 article 號碼 */
  readonly failed_articles: readonly number[];
  /** 成功取得的部分 citations（可能為空） */
  readonly partial_citations: readonly SopCitationResult[];
  readonly kb_error: string;
  readonly s3_error: string;
}

export type SopRetrieveResult = SopRetrieveSuccess | SopRetrieveBothFailed;

// ─── SopRetriever ─────────────────────────────────────────────────────────────

/**
 * SopRetriever — 以 Bedrock KB `Retrieve` 取回 SOP 段落與 verbatim citations。
 *
 * @example
 * // 生產（透過 factory）
 * const retriever = createSopRetriever(configProvider);
 *
 * // 測試（注入 mock KB client）
 * const retriever = new SopRetriever('kb-id', mockKbClient, s3Fallback);
 */
export class SopRetriever {
  private readonly knowledgeBaseId: string;
  private readonly kbClient: KbRetrieveClient;
  private readonly s3Fallback: SopS3Fallback;

  constructor(
    knowledgeBaseId: string,
    kbClient: KbRetrieveClient,
    s3Fallback: SopS3Fallback,
  ) {
    this.knowledgeBaseId = knowledgeBaseId;
    this.kbClient = kbClient;
    this.s3Fallback = s3Fallback;
  }

  /**
   * 以 `citation_article_set` + event facts 查詢 KB，取回 SOP 段落與 verbatim citations。
   *
   * Fallback 策略（§14.1, §21）：
   * - KB 可用 → `source: 'kb'`
   * - KB 全失敗 → S3 fallback → `source: 's3_fallback'`
   * - KB 部分缺漏 → 混合結果 → `source: 'kb_partial_s3_fallback'`
   * - KB + S3 均失敗 → `outcome: 'both_failed'`（citation 缺口已記錄，不虛構內容）
   *
   * @param citationArticleSet - 決定性程式碼產出的 article 號碼陣列（已排序，1–7）
   * @param eventFacts          - 事件相關事實，作為 KB query 的補充 context
   */
  async retrieve(
    citationArticleSet: readonly number[],
    eventFacts: string,
  ): Promise<SopRetrieveResult> {
    if (citationArticleSet.length === 0) {
      return { outcome: 'success', citations: [], source: 'kb' };
    }

    const query = buildKbQuery(citationArticleSet, eventFacts);
    let kbResults: KnowledgeBaseRetrievalResult[] | null = null;
    let kbError: string | null = null;

    try {
      kbResults = await this.kbClient.retrieve(
        this.knowledgeBaseId,
        query,
        Math.max(citationArticleSet.length, 5),
      );
    } catch (err) {
      kbError = err instanceof Error ? err.message : String(err);
    }

    if (kbResults !== null) {
      const { citations, unmappedCount } = mapKbResultsToCitations(kbResults, citationArticleSet);

      if (unmappedCount > 0) {
        // 部分 KB result 無法推斷 article_no，記錄為可觀測事件
        console.warn(
          `[SopRetriever] ${unmappedCount} KB result(s) could not be mapped to article_no. ` +
            'Ensure KB ingestion (TASK-017) sets article_no in chunk metadata.',
        );
      }

      const coveredArticles = new Set(citations.map((c) => c.article_no));
      const missingArticles = citationArticleSet.filter((a) => !coveredArticles.has(a));

      if (missingArticles.length === 0) {
        return {
          outcome: 'success',
          citations: orderByArticleSet(citations, citationArticleSet),
          source: 'kb',
        };
      }

      // KB 部分缺漏 → 對缺漏的 article 走 S3 fallback
      // TODO(TASK-109 Phase 10): increment KbFallbackCount metric for each missing article
      const fallbackResult = await this.tryS3Fallback(missingArticles);
      const merged = [...citations, ...fallbackResult.citations];

      if (fallbackResult.failedArticles.length > 0) {
        return {
          outcome: 'both_failed',
          failed_articles: fallbackResult.failedArticles,
          partial_citations: orderByArticleSet(merged, citationArticleSet),
          kb_error: `KB returned partial results (missing articles: ${missingArticles.join(', ')})`,
          s3_error: fallbackResult.s3Error ?? 'partial S3 failure',
        };
      }

      return {
        outcome: 'success',
        citations: orderByArticleSet(merged, citationArticleSet),
        source: 'kb_partial_s3_fallback',
      };
    }

    // KB 完全失敗 → 全部走 S3 fallback
    // TODO(TASK-109 Phase 10): increment KbFallbackCount metric for full fallback
    const fallbackResult = await this.tryS3Fallback([...citationArticleSet]);

    if (fallbackResult.failedArticles.length > 0) {
      return {
        outcome: 'both_failed',
        failed_articles: fallbackResult.failedArticles,
        partial_citations: orderByArticleSet(fallbackResult.citations, citationArticleSet),
        kb_error: kbError ?? 'KB unavailable',
        s3_error: fallbackResult.s3Error ?? 'S3 fallback partial failure',
      };
    }

    return {
      outcome: 'success',
      citations: orderByArticleSet(fallbackResult.citations, citationArticleSet),
      source: 's3_fallback',
    };
  }

  // ─── Private helpers ──────────────────────────────────────────────────────

  private async tryS3Fallback(articleNos: readonly number[]): Promise<{
    citations: SopCitationResult[];
    failedArticles: number[];
    s3Error: string | null;
  }> {
    const citations: SopCitationResult[] = [];
    const failedArticles: number[] = [];
    let lastS3Error: string | null = null;

    for (const articleNo of articleNos) {
      try {
        const result = await this.s3Fallback.fetchArticle(articleNo);
        citations.push({
          article_no: articleNo,
          content: result.text,
          // source_location 使用 SopS3Fallback 回傳的真實 S3 URI（verbatim）
          source_location: result.s3_uri,
          relevancy_score: null,
          source: 's3_fallback',
        });
      } catch (err) {
        lastS3Error = err instanceof Error ? err.message : String(err);
        failedArticles.push(articleNo);
      }
    }

    return { citations, failedArticles, s3Error: lastS3Error };
  }
}

// ─── Factory ──────────────────────────────────────────────────────────────────

/**
 * 依 ConfigProvider 建立生產用的 `SopRetriever`。
 *
 * 使用 `BedrockKbClient`（真實 KB 呼叫）。
 * 測試環境應直接 new `SopRetriever(knowledgeBaseId, mockKbClient, s3Fallback)`。
 *
 * @param config     - ConfigProvider 實例
 * @param s3Fallback - SopS3Fallback 實例（已用同一 config 建立）
 */
export function createSopRetriever(
  config: ConfigProvider,
  s3Fallback: SopS3Fallback,
): SopRetriever {
  const region = requireString(config, 'bedrock.region');
  const knowledgeBaseId = requireString(config, 'kb.knowledge_base_id');
  return new SopRetriever(knowledgeBaseId, new BedrockKbClient(region), s3Fallback);
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * 依 `citation_article_set` 的順序重排 citations。
 *
 * 為什麼需要：
 * - KB 路徑的順序來自 `Map` 的插入序，也就是 KB 回傳結果的順序（相關性排序），
 *   與 `citation_article_set` 無關
 * - 部分 fallback 時是「KB 結果」後面接「S3 結果」，條號會跳來跳去
 *
 * Dashboard 與報告都是逐條列出 SOP 引用，條號亂序會讓指揮官
 * 難以對照官方條文；`citation_article_set` 本身已由決定性程式碼遞增排序，
 * 照它排即可得到穩定且可預期的輸出。
 *
 * 不在 `citation_article_set` 內的 citation（理論上不會發生，
 * mapKbResultsToCitations 已過濾）排在最後，不靜默丟棄。
 */
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

/**
 * 以 citation_article_set + eventFacts 組裝 KB 查詢字串。
 */
function buildKbQuery(citationArticleSet: readonly number[], eventFacts: string): string {
  const articleList = citationArticleSet.join(', ');
  return `SOP 第 ${articleList} 條相關規則與處置程序。事件背景：${eventFacts}`;
}

/**
 * 將 KB `Retrieve` 回傳的結果對映至 citation_article_set。
 *
 * 對映策略：
 * 1. 從 KB result metadata 取 `article_no`（KB ingestion TASK-017 應標記此 metadata）
 * 2. 若 metadata 無 `article_no`，嘗試從 source_location URI fragment 推斷（`#article-N`）
 * 3. 無法推斷者計入 `unmappedCount`（呼叫端記錄 warn log）
 * 4. 每個 article 只保留 relevancy_score 最高的一筆
 *
 * @returns citations（對映成功）與 unmappedCount（無法推斷 article_no 的 KB result 數量）
 */
function mapKbResultsToCitations(
  kbResults: KnowledgeBaseRetrievalResult[],
  citationArticleSet: readonly number[],
): { citations: SopCitationResult[]; unmappedCount: number } {
  const bestByArticle = new Map<
    number,
    { content: string; source_location: string; score: number }
  >();
  let unmappedCount = 0;

  for (const result of kbResults) {
    const articleNo = extractArticleNo(result);

    if (articleNo === null) {
      unmappedCount++;
      continue;
    }
    if (!citationArticleSet.includes(articleNo)) continue;

    const content = result.content?.text ?? '';
    const source_location = extractSourceLocation(result);
    const score = result.score ?? 0;

    const existing = bestByArticle.get(articleNo);
    if (existing === undefined || score > existing.score) {
      bestByArticle.set(articleNo, { content, source_location, score });
    }
  }

  const citations = [...bestByArticle.entries()].map(
    ([articleNo, { content, source_location, score }]): SopCitationResult => ({
      article_no: articleNo,
      content,
      source_location,
      relevancy_score: score,
      source: 'kb',
    }),
  );

  return { citations, unmappedCount };
}

/**
 * 從 KB result 抽取 verbatim source location URI。
 * 若無法取得，回傳可辨識的佔位字串（不虛構 URI）。
 */
function extractSourceLocation(result: KnowledgeBaseRetrievalResult): string {
  const loc = result.location;
  if (loc?.s3Location?.uri) return loc.s3Location.uri;
  if (loc?.webLocation?.url) return loc.webLocation.url;
  return 'kb://unknown-source';
}

/**
 * 從 KB result 的 metadata 或 source_location 推斷 article_no（1–7）。
 *
 * KB ingestion（TASK-017）若在 chunk metadata 標記 `article_no`，可直接取用。
 * 否則嘗試從 URI fragment（`#article-N`）推斷。
 * 無法推斷則回 null。
 */
function extractArticleNo(result: KnowledgeBaseRetrievalResult): number | null {
  const metadata = result.metadata;
  if (metadata && typeof metadata['article_no'] === 'number') {
    return metadata['article_no'] as number;
  }
  if (metadata && typeof metadata['article_no'] === 'string') {
    const n = parseInt(metadata['article_no'] as string, 10);
    if (!isNaN(n) && n >= 1 && n <= 7) return n;
  }

  // URI fragment fallback（如 `...#article-3`）
  const uri = extractSourceLocation(result);
  const match = /#article-(\d+)/i.exec(uri);
  if (match) {
    const n = parseInt(match[1], 10);
    if (n >= 1 && n <= 7) return n;
  }

  return null;
}
