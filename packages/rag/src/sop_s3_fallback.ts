/**
 * SopS3Fallback — S3 article_no 直讀 fallback (TASK-109)
 *
 * 職責（§4.2, §14.1, §21.2）：
 * - 當 Bedrock KB 不可用時，由 S3 依 `article_no` 直讀對應的 SOP 條款原文
 * - 回傳與 KB 相同的 citation shape（對 SopRetriever 透明）
 * - 回傳 `s3_uri`（真實 S3 物件 URI），讓 SopRetriever 組裝 verbatim source_location
 * - 失敗時（KB + S3 均失敗）記錄 citation 缺口，絕不虛構 SOP 內容
 *
 * 設計原則（§14.1, §21）：
 * - S3 bucket 從 ConfigProvider 取（key: `s3.sop_source_bucket`），不硬編
 * - S3 物件鍵格式：`sop/article-{article_no}.json`（KB ingestion 切塊產物，TASK-017）
 * - 讀取內容必須符合 `SOPArticleChunk` 型別（article_no, title, text）
 * - 任何讀取或解析失敗均丟出例外，由 SopRetriever 捕捉並記錄 citation 缺口
 *
 * @module rag/sop_s3_fallback
 */

import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import type { ConfigProvider } from '@city-commander/config';
import type { SOPArticleChunk } from '@city-commander/shared-schemas';
import { requireString } from './config_helpers.js';

// ─── Fetch result type ────────────────────────────────────────────────────────

/**
 * `fetchArticle()` 的回傳值，在 `SOPArticleChunk` 基礎上加入 S3 URI。
 *
 * `s3_uri` 為真實 S3 物件的 URI（`s3://{bucket}/sop/article-{n}.json`），
 * 供 `SopRetriever` 組裝 verbatim source_location，確保 citation 可追蹤。
 */
export interface SopArticleFetchResult extends SOPArticleChunk {
  /** 真實 S3 物件 URI，格式：`s3://{bucket}/sop/article-{article_no}.json` */
  readonly s3_uri: string;
}

// ─── SopS3Fallback ────────────────────────────────────────────────────────────

/**
 * SOP 條款的 S3 直讀 fallback。
 *
 * 由 `SopRetriever` 在 KB 不可用時呼叫；
 * 也可獨立用於單元測試（注入 MockS3Client 即可）。
 *
 * @example
 * const fallback = new SopS3Fallback(configProvider);
 * const result = await fallback.fetchArticle(2);
 * // result.article_no === 2
 * // result.text 為 SOP 第 2 條原文（verbatim）
 * // result.s3_uri === 's3://my-sop-bucket/sop/article-2.json'
 */
export class SopS3Fallback {
  private readonly bucket: string;
  private readonly client: S3Client;

  constructor(config: ConfigProvider) {
    const region = requireString(config, 'bedrock.region');
    this.bucket = requireString(config, 's3.sop_source_bucket');
    this.client = new S3Client({ region });
  }

  /**
   * 依 `article_no` 從 S3 直讀 SOP 條款。
   *
   * S3 物件鍵格式：`sop/article-{article_no}.json`
   * 物件內容為 JSON，符合 `SOPArticleChunk` schema。
   * 回傳值額外包含 `s3_uri`，供上層組裝 verbatim source_location。
   *
   * @param articleNo - SOP 條款號（1–7）
   * @returns SopArticleFetchResult（article_no, title, text, s3_uri）
   *
   * @throws {Error} S3 GetObject 失敗、回應體為空、或 JSON 解析失敗時
   */
  async fetchArticle(articleNo: number): Promise<SopArticleFetchResult> {
    const key = buildS3Key(articleNo);
    const s3_uri = `s3://${this.bucket}/${key}`;

    let body: string;
    try {
      const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
      const response = await this.client.send(command);
      if (!response.Body) {
        throw new Error(`S3 object ${s3_uri} has empty body`);
      }
      body = await response.Body.transformToString('utf-8');
    } catch (err) {
      throw new Error(
        `Failed to fetch SOP article ${articleNo} from S3 (${s3_uri}): ` +
          (err instanceof Error ? err.message : String(err)),
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      throw new Error(`Failed to parse SOP article ${articleNo} from S3 (${s3_uri}): invalid JSON`);
    }

    const chunk = validateSOPArticleChunk(parsed, articleNo, s3_uri);
    return { ...chunk, s3_uri };
  }
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * 建立 S3 物件鍵。
 * 格式：`sop/article-{article_no}.json`（與 TASK-017 切塊格式對應）
 */
function buildS3Key(articleNo: number): string {
  return `sop/article-${articleNo}.json`;
}

/**
 * 驗證並轉型 S3 回傳的 JSON 為 `SOPArticleChunk`。
 * @throws {Error} 當任何必要欄位缺失或型別不符時
 */
function validateSOPArticleChunk(
  raw: unknown,
  expectedArticleNo: number,
  s3Uri: string,
): SOPArticleChunk {
  if (typeof raw !== 'object' || raw === null) {
    throw new Error(
      `SOP article ${expectedArticleNo} from S3 (${s3Uri}): expected JSON object, got ${typeof raw}`,
    );
  }

  const obj = raw as Record<string, unknown>;

  if (typeof obj['article_no'] !== 'number' || !Number.isInteger(obj['article_no'])) {
    throw new Error(
      `SOP article ${expectedArticleNo} from S3 (${s3Uri}): article_no must be an integer`,
    );
  }

  // 物件鍵由 article_no 推導，但內容是否對得上必須驗證：
  // 若 KB ingestion（TASK-017）切塊時錯置，我們會拿第 N 條的原文
  // 去當第 M 條的 citation——citation 張冠李戴比沒有 citation 更糟，
  // 因為它看起來完全正常。寧可讓這條 article 記為缺口（fail closed）。
  if (obj['article_no'] !== expectedArticleNo) {
    throw new Error(
      `SOP article ${expectedArticleNo} from S3 (${s3Uri}): ` +
        `content declares article_no=${String(obj['article_no'])}, refusing to mislabel the citation`,
    );
  }
  if (typeof obj['title'] !== 'string') {
    throw new Error(`SOP article ${expectedArticleNo} from S3 (${s3Uri}): title must be a string`);
  }
  if (typeof obj['text'] !== 'string') {
    throw new Error(`SOP article ${expectedArticleNo} from S3 (${s3Uri}): text must be a string`);
  }

  return {
    article_no: obj['article_no'] as number,
    title: obj['title'] as string,
    text: obj['text'] as string,
  };
}
