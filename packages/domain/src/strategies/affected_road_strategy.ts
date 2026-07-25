/** Strategy B — configure the contextual role of a BS-event affected_road. */

import type { Incident } from '@city-commander/shared-schemas';

export type AffectedRoadRole =
  'display_only' | 'context_and_ete' | 'parallel_road_impact_explicit_host';

export interface AffectedRoadStrategyResult {
  readonly role: AffectedRoadRole;
  readonly affected_road: string | null;
  readonly include_in_ete_context: boolean;
  /** affected_road can never directly satisfy Article 2. */
  readonly directly_triggers_article2: false;
  /** Explicit-host mode still requires independent SOP-2 condition evaluation. */
  readonly requires_article2_revalidation: boolean;
}

export interface AffectedRoadStrategy {
  resolve(incident: Incident): AffectedRoadStrategyResult;
}

export function createAffectedRoadStrategy(role: AffectedRoadRole): AffectedRoadStrategy {
  return {
    resolve: (incident) => ({
      role,
      affected_road: incident.affected_road ?? null,
      include_in_ete_context: role === 'context_and_ete' && incident.affected_road !== undefined,
      directly_triggers_article2: false,
      requires_article2_revalidation:
        role === 'parallel_road_impact_explicit_host' && incident.affected_road !== undefined,
    }),
  };
}

export const displayOnlyAffectedRoadStrategy = createAffectedRoadStrategy('display_only');
export const contextAndEteAffectedRoadStrategy = createAffectedRoadStrategy('context_and_ete');
export const parallelRoadImpactExplicitHostStrategy = createAffectedRoadStrategy(
  'parallel_road_impact_explicit_host',
);
