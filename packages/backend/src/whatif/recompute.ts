/**
 * What-if stage 3 adapter (TASK-139).
 *
 * The deterministic implementation is owned by member 1 and injected through
 * one facade. This backend module neither imports individual SOP evaluators nor
 * calculates classification, routes, article sets, or ETE.
 */

import type { APIGatewayProxyEventV2 } from 'aws-lambda';
import type { WhatIfAssumption, RecomputeResult } from './whatif_types.js';
import type { LoadedEntityCatalog } from './validators.js';

/** Opaque full-input snapshot plus the entity catalog derived by its owner. */
export interface RuleEngineWhatIfBaseline {
  readonly inputSnapshot: unknown;
  readonly loadedEntities: LoadedEntityCatalog;
}

/** Structured deterministic facts returned by the member-1 facade. */
export interface RuleEngineWhatIfFacts {
  readonly triggered_articles: readonly number[];
  readonly applied_formula_articles: readonly number[];
  readonly expected_actions: readonly string[];
  readonly ete_minutes?: number;
}

/**
 * Single ownership boundary for What-if deterministic work.
 *
 * `loadBaseline` must return a copy/source snapshot of the active decision
 * inputs. `rerun` applies assumptions to that complete snapshot and executes
 * the full Rule Engine. Production AWS/config wiring remains outside this task.
 */
export interface RuleEngineWhatIfFacade {
  readonly loadBaseline: (
    event: APIGatewayProxyEventV2,
  ) => Promise<RuleEngineWhatIfBaseline>;
  readonly rerun: (input: {
    readonly baseline: RuleEngineWhatIfBaseline;
    readonly assumptions: readonly WhatIfAssumption[];
  }) => RuleEngineWhatIfFacts;
}

export interface RecomputeInput {
  readonly facade: RuleEngineWhatIfFacade;
  readonly baseline: RuleEngineWhatIfBaseline;
  readonly assumptions: readonly WhatIfAssumption[];
}

/** Delegate the full rerun, then translate its deterministic facts only. */
export function recompute(input: RecomputeInput): RecomputeResult {
  const facts = input.facade.rerun({
    baseline: input.baseline,
    assumptions: input.assumptions,
  });

  return {
    triggered_articles: facts.triggered_articles,
    applied_formula_articles: facts.applied_formula_articles,
    expected_actions: facts.expected_actions,
    ...(facts.ete_minutes !== undefined && {
      ete_preview: { ete_minutes: facts.ete_minutes },
    }),
    does_not_mutate_state: true,
  };
}
