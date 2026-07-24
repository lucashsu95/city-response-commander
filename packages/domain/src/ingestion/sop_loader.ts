/**
 * SOP Loader — emergency_traffic_sop.txt
 *
 * Loads the 7-article SOP text and splits it per article with `article_no` metadata.
 * Preserves verbatim text per article for citation source location.
 * Exposes a lookup by `article_no` (used by KB fallback in Phase 6).
 *
 * Throws an error if exactly 7 articles are not found (§14.1, §21).
 *
 * @module domain/ingestion/sop_loader
 */

import type { SOPArticleChunk } from '@city-commander/shared-schemas';

/** Error types for SOP loading failures */
export class SOPLoadError extends Error {
  constructor(
    message: string,
    public readonly code: 'ARTICLE_COUNT_MISMATCH' | 'PARSE_ERROR' | 'EMPTY_CONTENT',
    public readonly details?: { expected?: number; actual?: number },
  ) {
    super(message);
    this.name = 'SOPLoadError';
  }
}

/** Expected number of SOP articles */
const EXPECTED_ARTICLE_COUNT = 7;

/**
 * Separator pattern: a line consisting of one or more `=` characters
 * (with optional leading/trailing whitespace on the line).
 */
const SEPARATOR_PATTERN = /^=+$/;

/**
 * Article header pattern: matches lines like "1. 交通擁塞級別判定"
 * Captures the article number and the title.
 */
const ARTICLE_HEADER_PATTERN = /^(\d+)\.\s+(.+)$/;

/**
 * Result of loading the SOP file: the article chunks and a lookup function.
 */
export interface SOPLoadResult {
  /** The 7 article chunks, ordered by article_no */
  readonly articles: readonly SOPArticleChunk[];
  /** Lookup a specific article by number (1-7). Returns undefined if not found. */
  readonly getByArticleNo: (articleNo: number) => SOPArticleChunk | undefined;
}

/**
 * Parse raw SOP text content into 7 article chunks.
 *
 * The SOP file structure:
 * - A preamble (e.g., "交通應變標準程序") before article 1
 * - Articles separated by `==========` lines with numbered titles
 *
 * @param sopContent - Raw text content of emergency_traffic_sop.txt
 * @returns SOPLoadResult with articles array and lookup function
 * @throws SOPLoadError if article count != 7, content is empty, or parsing fails
 */
export function parseSOPText(sopContent: string): SOPLoadResult {
  if (!sopContent || sopContent.trim().length === 0) {
    throw new SOPLoadError(
      'SOP content is empty',
      'EMPTY_CONTENT',
    );
  }

  const lines = sopContent.split(/\r?\n/);

  // Find all separator lines to identify article boundaries
  const separatorIndices: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (SEPARATOR_PATTERN.test(lines[i].trim())) {
      separatorIndices.push(i);
    }
  }

  // Articles are delimited by pairs of separator lines:
  // separator → header → separator → content until next separator pair
  // Each article has two separators (before and after the title line)
  const articles: SOPArticleChunk[] = [];

  // Process separator pairs: each article has a pair [separator, title, separator]
  // We look for patterns: sep-line, header-line, sep-line, then content until next sep-line
  let i = 0;
  while (i < separatorIndices.length - 1) {
    const firstSep = separatorIndices[i];
    const secondSep = separatorIndices[i + 1];

    // The header line should be between the two separator lines
    if (secondSep - firstSep === 2) {
      const headerLineIndex = firstSep + 1;
      const headerLine = lines[headerLineIndex].trim();
      const headerMatch = ARTICLE_HEADER_PATTERN.exec(headerLine);

      if (headerMatch) {
        const articleNo = parseInt(headerMatch[1], 10);
        const title = headerMatch[2].trim();

        // Article content starts after the second separator line
        const contentStart = secondSep + 1;

        // Content ends at the next separator line or end of file
        const nextSepIndex = separatorIndices.findIndex(
          (idx) => idx > secondSep,
        );
        const contentEnd = nextSepIndex >= 0
          ? separatorIndices[nextSepIndex]
          : lines.length;

        // Extract content lines and preserve verbatim (including whitespace)
        const contentLines = lines.slice(contentStart, contentEnd);

        // Trim trailing empty lines but preserve internal whitespace
        let lastNonEmpty = contentLines.length - 1;
        while (lastNonEmpty >= 0 && contentLines[lastNonEmpty].trim() === '') {
          lastNonEmpty--;
        }
        const trimmedContent = contentLines.slice(0, lastNonEmpty + 1);

        // Also trim leading empty lines
        let firstNonEmpty = 0;
        while (firstNonEmpty < trimmedContent.length && trimmedContent[firstNonEmpty].trim() === '') {
          firstNonEmpty++;
        }
        const finalContent = trimmedContent.slice(firstNonEmpty);

        const text = finalContent.join('\n');

        articles.push({
          article_no: articleNo,
          title,
          text,
        });

        // Move to the next pair after the second separator
        i += 2;
        continue;
      }
    }

    // If we didn't match a valid article header between separators, skip this separator
    i++;
  }

  // Validate exactly 7 articles found
  if (articles.length !== EXPECTED_ARTICLE_COUNT) {
    throw new SOPLoadError(
      `Expected exactly ${EXPECTED_ARTICLE_COUNT} SOP articles, but found ${articles.length}`,
      'ARTICLE_COUNT_MISMATCH',
      { expected: EXPECTED_ARTICLE_COUNT, actual: articles.length },
    );
  }

  // Validate article numbers are 1-7
  for (let idx = 0; idx < articles.length; idx++) {
    if (articles[idx].article_no !== idx + 1) {
      throw new SOPLoadError(
        `Article at position ${idx} has article_no=${articles[idx].article_no}, expected ${idx + 1}`,
        'PARSE_ERROR',
      );
    }
  }

  const frozenArticles = Object.freeze(articles.map((a) => Object.freeze(a)));

  // Build lookup map for O(1) access
  const articleMap = new Map<number, SOPArticleChunk>();
  for (const article of frozenArticles) {
    articleMap.set(article.article_no, article);
  }

  const getByArticleNo = (articleNo: number): SOPArticleChunk | undefined => {
    return articleMap.get(articleNo);
  };

  return Object.freeze({
    articles: frozenArticles,
    getByArticleNo,
  });
}
