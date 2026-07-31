/** Enrichment-only recovery coordinator (TASK-118). */

import { NarrativeType } from '@city-commander/shared-schemas';

export const REQUIRED_NARRATIVE_TYPES: readonly NarrativeType[] = [
  NarrativeType.REPORT,
  NarrativeType.PUBLIC_ALERT,
  NarrativeType.EXPLANATION,
];

export type NarrativeComposerOutcome = 'committed' | 'branch_already_completed';

export interface EnrichmentRecoveryPorts {
  /** Composer ports only: no DecisionFn, core writer, or fast-path publisher is reachable. */
  readonly composers: Readonly<Record<
    NarrativeType,
    () => Promise<{ readonly outcome: NarrativeComposerOutcome }>
  >>;
}

export type EnrichmentRecoveryResult =
  | { readonly outcome: 'recovery_core_missing'; readonly error_code: 'RECOVERY_CORE_MISSING' }
  | {
      readonly outcome: 'completed';
      readonly recovered: readonly NarrativeType[];
      readonly branch_outcomes: Readonly<Partial<Record<NarrativeType, NarrativeComposerOutcome>>>;
    };

/** Retry exactly RecoveryGateFn's missing narrative set and nothing else. */
export async function recoverMissingNarratives(
  ports: EnrichmentRecoveryPorts,
  input: {
    readonly coreExists: boolean;
    readonly missingNarrativeTypes: readonly NarrativeType[];
  },
): Promise<EnrichmentRecoveryResult> {
  if (!input.coreExists) {
    return { outcome: 'recovery_core_missing', error_code: 'RECOVERY_CORE_MISSING' };
  }

  const missing = new Set(input.missingNarrativeTypes);
  const toRecover = REQUIRED_NARRATIVE_TYPES.filter((type) => missing.has(type));
  const results = await Promise.all(
    toRecover.map(async (type) => ({ type, result: await ports.composers[type]() })),
  );

  const branchOutcomes: Partial<Record<NarrativeType, NarrativeComposerOutcome>> = {};
  for (const { type, result } of results) branchOutcomes[type] = result.outcome;

  return {
    outcome: 'completed',
    recovered: toRecover,
    branch_outcomes: branchOutcomes,
  };
}
