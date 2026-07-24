/** RuleEngine Article 6 — SOP-6 multilingual-alert trigger. */

import type { MultilingualScopeResult } from '../strategies/multilingual_scope_strategy.js';
import { evaluateMultilingualTrigger, type MultilingualTriggerResult } from './multilingual_trigger.js';

export interface Article6Result extends MultilingualTriggerResult {
  readonly adds_to_triggered_articles: readonly number[];
  readonly multilingual_scope: {
    readonly mode: string;
    readonly stations_in_scope: readonly string[];
  };
}

/** Evaluate SOP-6 over the caller-selected, current Strategy-F scope. */
export function evaluateArticle6(scope: MultilingualScopeResult): Article6Result {
  const trigger = evaluateMultilingualTrigger(scope);
  return {
    ...trigger,
    adds_to_triggered_articles: trigger.triggered ? [6] : [],
    multilingual_scope: {
      mode: scope.mode,
      stations_in_scope: scope.stations_in_scope.map((station) => station.bs_id),
    },
  };
}
