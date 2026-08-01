/**
 * SopS3Fallback — unit tests (TASK-109)
 *
 * 重點：S3 物件內容宣告的 article_no 必須與請求的條號一致，
 * 否則 citation 會張冠李戴——那比沒有 citation 更糟，因為它看起來完全正常。
 *
 * @module rag/test/unit/sop_s3_fallback
 */

import { describe, it, expect } from 'vitest';
import { SopS3Fallback } from '../../src/sop_s3_fallback.js';
import type { ConfigProvider } from '@city-commander/config';

// ─── Stub helpers ──────────────────────────────────────────────────────────

function makeConfig(): ConfigProvider {
  return {
    get(key: string) {
      if (key === 'bedrock.region') return 'ap-northeast-1';
      if (key === 's3.sop_source_bucket') return 'sop-bucket';
      return undefined;
    },
  } as unknown as ConfigProvider;
}

/** 以指定的 S3 物件內容建立 fallback（直接替換內部 client） */
function makeFallback(body: string | null): SopS3Fallback {
  const fallback = new SopS3Fallback(makeConfig());
  const stubClient = {
    async send() {
      if (body === null) return { Body: undefined };
      return {
        Body: {
          async transformToString() {
            return body;
          },
        },
      };
    },
  };
  (fallback as unknown as { client: unknown }).client = stubClient;
  return fallback;
}

// ─── Tests ─────────────────────────────────────────────────────────────────

describe('SopS3Fallback — 正常讀取', () => {
  it('article_no 相符 → 回傳條文與真實 s3_uri', async () => {
    const fallback = makeFallback(
      JSON.stringify({ article_no: 2, title: 'SOP 第 2 條', text: '車禍與路障應變' }),
    );
    const result = await fallback.fetchArticle(2);

    expect(result.article_no).toBe(2);
    expect(result.text).toBe('車禍與路障應變');
    expect(result.s3_uri).toBe('s3://sop-bucket/sop/article-2.json');
  });
});

describe('SopS3Fallback — article_no 錯置防護', () => {
  it('內容宣告的 article_no 與請求不符 → 丟出例外，不產生錯誤 citation', async () => {
    // 請求第 2 條，但物件內容宣告自己是第 5 條（KB ingestion 切塊錯置）
    const fallback = makeFallback(
      JSON.stringify({ article_no: 5, title: 'SOP 第 5 條', text: '號誌故障應變' }),
    );

    await expect(fallback.fetchArticle(2)).rejects.toThrow(/article_no=5/);
    await expect(fallback.fetchArticle(2)).rejects.toThrow(/refusing to mislabel/);
  });

  it('SopRetriever 會把它記為 citation 缺口（fail closed），不是靜默錯標', async () => {
    const fallback = makeFallback(
      JSON.stringify({ article_no: 5, title: 'x', text: 'y' }),
    );
    // fetchArticle 丟例外 → SopRetriever 的 tryS3Fallback 會計入 failedArticles
    await expect(fallback.fetchArticle(2)).rejects.toBeInstanceOf(Error);
  });
});

describe('SopS3Fallback — 其他錯誤情境', () => {
  it('空 body → 例外', async () => {
    await expect(makeFallback(null).fetchArticle(1)).rejects.toThrow(/empty body|Failed to fetch/);
  });

  it('非合法 JSON → 例外', async () => {
    await expect(makeFallback('{not json').fetchArticle(1)).rejects.toThrow(/invalid JSON/);
  });

  it('缺 title / text 欄位 → 例外', async () => {
    await expect(
      makeFallback(JSON.stringify({ article_no: 1, text: 'only text' })).fetchArticle(1),
    ).rejects.toThrow(/title must be a string/);

    await expect(
      makeFallback(JSON.stringify({ article_no: 1, title: 'only title' })).fetchArticle(1),
    ).rejects.toThrow(/text must be a string/);
  });

  it('article_no 非整數 → 例外', async () => {
    await expect(
      makeFallback(JSON.stringify({ article_no: '2', title: 't', text: 'x' })).fetchArticle(2),
    ).rejects.toThrow(/article_no must be an integer/);
  });
});
