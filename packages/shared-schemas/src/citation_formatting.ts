/**
 * Citation formatting utilities — shared across rag and backend (§14.1, §21)
 *
 * Moved from packages/rag/src/sop_retriever.ts to shared-schemas (Layer 0)
 * so that both rag (Layer 2) and backend (Layer 2) can import without
 * violating the peer-import prohibition.
 *
 * @module shared-schemas/citation_formatting
 */

/**
 * Minimal input type for `formatCitationLocation`.
 *
 * Only requires the fields needed for formatting; compatible with
 * the full `SopCitationResult` from rag package.
 */
export interface CitationLocationInput {
  readonly source_location: string;
  readonly source: 'kb' | 's3_fallback';
}

/**
 * 格式化 citation 的 source_location 顯示文字。
 *
 * `source === 's3_fallback'` 代表該引用並非 KB 精準比對結果，
 * 而是 S3 fallback 的通用條文備份（§14.1, §21）；
 * 下游（prompt、fallback 文案、citations_presentation）皆須標記此差異，
 * 避免指揮官誤以為是精確比對的 KB 結果。
 */
export function formatCitationLocation(c: CitationLocationInput): string {
  return c.source === 's3_fallback'
    ? `${c.source_location}（類比引用，非精準比對）`
    : c.source_location;
}

/**
 * Disclosure text appended to Bedrock-generated explanations when
 * any citation uses s3_fallback source.
 */
export const FALLBACK_DISCLOSURE = '\n\n（本次引用含類比引用，非精準比對，僅供參考）';
