/**
 * citation_article_set assembly (TASK-110)
 *
 * 計算 citation_article_set = triggered_articles ∪ applied_formula_articles。
 *
 * 設計規則（§14.2, §9.5, §22.1 P27）：
 * - citation_article_set 一定涵蓋 triggered_articles（SOP 觸發條款）
 * - citation_article_set 一定涵蓋 applied_formula_articles（SOP 公式條款，如 art.7）
 * - art.7 只能出現在 applied_formula_articles，不可列入 triggered_articles
 * - 重複出現的條款號只保留一份，並依遞增排序
 *
 * 驗收標準（ACC_001 黃金案例）：
 *   triggered_articles       = [1, 2]
 *   applied_formula_articles = [7]
 *   citation_article_set     = {1, 2, 7}
 *
 * @module rag/citation_article_set
 */

import type { DecisionCore } from '@city-commander/shared-schemas';
import { SOPArticle } from '@city-commander/shared-schemas';

const SOP_ARTICLE_MIN = SOPArticle.ARTICLE_1;
const SOP_ARTICLE_MAX = SOPArticle.ARTICLE_7;

/**
 * 從 DecisionCore 組裝 citation_article_set。
 *
 * 若 DecisionCore 包含超出合法範圍 (1–7) 的條款號，立即丟出 Error，
 * 而非靜默丟棄（符合 failure_cases「assertion failure」要求）。
 *
 * @param core - 已提交的 DecisionCore（immutable）
 * @returns 已排序、去重的 SOP 條款號碼陣列
 *
 * @throws {Error} 當任何條款號不在 1–7 整數範圍內
 *
 * @example
 * // ACC_001
 * buildCitationArticleSet(core) // → [1, 2, 7]
 */
export function buildCitationArticleSet(core: DecisionCore): readonly number[] {
  const allArticles = [...core.triggered_articles, ...core.applied_formula_articles];

  // 驗證所有條款號合法；非法條款號立即報錯，不靜默丟棄
  for (const n of allArticles) {
    if (!Number.isInteger(n) || n < SOP_ARTICLE_MIN || n > SOP_ARTICLE_MAX) {
      throw new Error(
        `Invalid SOP article number: ${n}. Expected integer in [${SOP_ARTICLE_MIN}, ${SOP_ARTICLE_MAX}].`,
      );
    }
  }

  const set = new Set<number>(allArticles);

  // 依遞增排序，確保輸出穩定
  return [...set].sort((a, b) => a - b);
}

/**
 * 驗證 citation_article_set 是否完整覆蓋 triggered ∪ applied_formula（P27）。
 *
 * 設計為防禦性 assertion，供 P27 property test（TASK-049）與
 * SopRetriever 內部驗證使用。不從 index.ts 公開 export，
 * 避免成為套件的外部 API surface。
 *
 * @param citationSet - 已組裝的 citation_article_set
 * @param triggeredArticles - DecisionCore.triggered_articles
 * @param appliedFormulaArticles - DecisionCore.applied_formula_articles
 * @returns 缺失的條款號陣列；空陣列代表驗證通過
 */
export function findMissingCitations(
  citationSet: readonly number[],
  triggeredArticles: readonly number[],
  appliedFormulaArticles: readonly number[],
): readonly number[] {
  const required = new Set<number>([...triggeredArticles, ...appliedFormulaArticles]);
  const covered = new Set<number>(citationSet);

  const missing: number[] = [];
  for (const article of required) {
    if (!covered.has(article)) {
      missing.push(article);
    }
  }

  return missing.sort((a, b) => a - b);
}
