/** Authoritative three-narrative completion gate for decision.enriched (TASK-119). */

import {
  NarrativeType,
  SCHEMA_VERSION,
  type DecisionEnrichedEvent,
} from '@city-commander/shared-schemas';
import { REQUIRED_NARRATIVE_TYPES } from '../recovery/enrichment_recovery.js';

export interface NarrativeCompletionReader {
  /** Strongly consistent base-table read supplied by the production adapter. */
  readonly readCommittedTypes: (decisionId: string) => Promise<readonly NarrativeType[]>;
}

export interface DecisionEnrichedPublisher {
  readonly publish: (event: DecisionEnrichedEvent) => Promise<void>;
}

export type DecisionEnrichedGateResult =
  | { readonly outcome: 'not_ready'; readonly missing: readonly NarrativeType[] }
  | { readonly outcome: 'emitted'; readonly event: DecisionEnrichedEvent };

export function buildDecisionEnrichedReadyEventId(
  decisionId: string,
  coreVersionRef: number,
): string {
  return `${decisionId}|decision.enriched|${coreVersionRef}`;
}

/** Polling fallback is defined separately; it is not a private event-schema extension. */
export function decisionEnrichedPollingFallback(decisionId: string): string {
  return `/decisions/${decisionId}`;
}

/** Emit only after all three authoritative narrative rows are present. */
export async function emitDecisionEnrichedIfComplete(
  reader: NarrativeCompletionReader,
  publisher: DecisionEnrichedPublisher,
  input: {
    readonly decisionId: string;
    readonly coreVersionRef: number;
    readonly traceId: string;
    readonly policyVersion: string;
    readonly occurredAt: string;
  },
): Promise<DecisionEnrichedGateResult> {
  const committed = new Set(await reader.readCommittedTypes(input.decisionId));
  const missing = REQUIRED_NARRATIVE_TYPES.filter((type) => !committed.has(type));
  if (missing.length > 0) return { outcome: 'not_ready', missing };

  const event: DecisionEnrichedEvent = {
    schema_version: SCHEMA_VERSION,
    event_type: 'decision.enriched',
    decision_id: input.decisionId,
    occurred_at: input.occurredAt,
    policy_version: input.policyVersion,
    provisional: true,
    trace_id: input.traceId,
    ready_event_id: buildDecisionEnrichedReadyEventId(
      input.decisionId,
      input.coreVersionRef,
    ),
  };

  await publisher.publish(event);
  return { outcome: 'emitted', event };
}
