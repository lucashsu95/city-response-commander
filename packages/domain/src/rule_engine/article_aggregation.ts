/** Assemble the three distinct SOP article sets and their citation union. */

export interface ArticleEvaluationSummary {
  readonly article: number;
  readonly triggered: boolean;
  readonly invoked_procedures?: readonly string[];
}

export interface ArticleAggregationInput {
  /** Article 1–6 evaluations only. */
  readonly evaluations: readonly ArticleEvaluationSummary[];
  /** Formula articles, such as Article 7, applied by deterministic calculators. */
  readonly applied_formula_articles: readonly number[];
}

export interface ArticleAggregation {
  readonly triggered_articles: readonly number[];
  readonly applied_formula_articles: readonly number[];
  readonly invoked_procedures: readonly string[];
  readonly citation_article_set: readonly number[];
}

/**
 * Keeps triggers, formula applications, and invoked procedures separate.
 * Article 7 is rejected from triggered_articles because it is a formula only.
 */
export function aggregateArticles(input: ArticleAggregationInput): ArticleAggregation {
  const triggered = new Set<number>();
  const invoked = new Set<string>();
  for (const evaluation of input.evaluations) {
    if (!evaluation.triggered) continue;
    if (evaluation.article === 7)
      throw new Error('Article 7 must be recorded as an applied formula, not a trigger.');
    triggered.add(evaluation.article);
    for (const procedure of evaluation.invoked_procedures ?? []) invoked.add(procedure);
  }

  const applied = new Set(input.applied_formula_articles);
  const triggered_articles = [...triggered].sort((a, b) => a - b);
  const applied_formula_articles = [...applied].sort((a, b) => a - b);
  return {
    triggered_articles,
    applied_formula_articles,
    invoked_procedures: [...invoked].sort(),
    citation_article_set: [...new Set([...triggered_articles, ...applied_formula_articles])].sort(
      (a, b) => a - b,
    ),
  };
}
