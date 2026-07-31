/**
 * Domain pipeline adapter — the seam between `DecisionFn` and the deterministic
 * domain (design §8, §9, §21; TASK-099).
 *
 * `DecisionFn` owns orchestration, persistence and the zero-write invariant. It
 * owns NO rule semantics: every threshold, grading boundary and formula stays in
 * `packages/domain` (member 1's Rule Engine). This adapter is the only place the
 * two meet, so the boundary is inspectable in one file.
 *
 * ## Why this file is thin
 *
 * It delegates to `runDeterministicDecision` (member 1's composition facade),
 * which internally runs classification → art.1 → incident anchor (Strategy D) →
 * candidate qualification → evacuation selection → ETE affected-set (Strategy C) →
 * ETE (art.7) → art.2–6 → EvidenceTrace, in the order fixed by the organizer-
 * guided golden walkthroughs.
 *
 * An earlier revision of this adapter hand-assembled the first few of those steps
 * and declared the rest in a `PENDING_PIPELINE_STEPS` list, because their call
 * contracts were unverified and guessing the assembly would have produced a green
 * test suite with a wrong ETE. The facade removes that guesswork, so the
 * hand-assembly is gone: **Strategy A alignment, grading and article aggregation
 * are no longer performed here.** Two implementations of the same alignment could
 * disagree, and only one of them would be the one member 1 validates against
 * ACC_001 = 78.6 / EVT_002 = 22:15 / EVT_003 = 41.0.
 *
 * ## The no-fabrication rule
 *
 * When a required input is absent the adapter reports the gap and stops. It never
 * substitutes a default. That is not defensiveness — a defaulted saturation score
 * would be graded A/B, feed the ETE formula, be written into an immutable
 * DecisionCore, be quoted in the CMS text and be pushed to the public. It would
 * also pass every test. §21 is explicit: official data unavailable →
 * `data_status=insufficient_data`, STOP, disclose the gap.
 *
 * Two gaps are detected here rather than inside the facade:
 *
 *  - **Ingestion did not reach `ready`.** Reported with the ingestion
 *    `stop_reason`, before the facade is called at all.
 *  - **The requested `event_id` is absent from the official incident set.** The
 *    facade *throws* in this case; a missing incident is a data gap, not a
 *    programming fault, so the incident is resolved here and the gap is returned
 *    as `insufficient_data`.
 *
 * A fault raised by the facade itself propagates. A transient or logic failure
 * must never be laundered into `insufficient_data`, because that reads as "the
 * official data had a hole" and would be disclosed to the operator as such.
 *
 * @module backend/decision/domain_pipeline_adapter
 */

import { runDeterministicDecision } from '@city-commander/domain';
import type {
  DeterministicDecisionFacts,
  IngestionResult,
  PolicyStrategyConfigProvider,
} from '@city-commander/domain';
import type { Incident } from '@city-commander/shared-schemas';

/**
 * Ingestion port (TASK-019).
 *
 * Declared as a port rather than calling `ingestData` directly so the adapter is
 * unit-testable without the five official files on disk, and so `LOCAL_MOCK` can
 * supply a fixture provider. `ingestData` is synchronous, and so is this.
 */
export interface IngestionPort {
  ingest(): IngestionResult;
}

/**
 * The deterministic composition facade (member 1, `@city-commander/domain`).
 *
 * Typed as a port so the adapter's own mapping — the STOP gate, incident
 * resolution, and the refusal to launder a fault into `insufficient_data` — can be
 * tested without standing up the five official files, a road network and the SOP
 * corpus. {@link DEFAULT_DECISION_COMPOSER} is the real facade, so production
 * needs no wiring and there is no stub to leave switched on by accident.
 */
export type DecisionComposerPort = typeof runDeterministicDecision;

/** The real facade. Used unless a test injects a substitute. */
export const DEFAULT_DECISION_COMPOSER: DecisionComposerPort = runDeterministicDecision;

/**
 * The ports the default adapter needs.
 *
 * `config` resolves the provisional Strategies A–F (§30) and is passed straight
 * through to the facade; the adapter reads no policy key itself.
 */
export interface DomainPipelinePorts {
  readonly ingestion: IngestionPort;
  readonly config: PolicyStrategyConfigProvider;
  /** Defaults to {@link DEFAULT_DECISION_COMPOSER}. */
  readonly decide?: DecisionComposerPort;
}

/** Adapter input. */
export interface DomainPipelineInput {
  /** Official event id, as it appears in `live_incidents.json`. */
  readonly eventId: string;
}

/**
 * Domain steps not yet wired.
 *
 * Empty since `runDeterministicDecision` landed: the facade composes every
 * deterministic step. Retained as an explicit, assertable statement that nothing
 * is outstanding — and as the place to re-declare a gap if one ever reappears.
 * While non-empty the adapter returns `insufficient_data`, so a partial pipeline
 * can never produce a DecisionCore.
 */
export const PENDING_PIPELINE_STEPS: readonly string[] = [];

/**
 * Deterministic facts for DecisionCore, minus the identity/workflow fields the
 * backend owns (`decision_id`, `idempotency_key`, `injection_run_id`,
 * `workflow_execution_name`, `version`, `core_hash`).
 *
 * Re-exported under a backend-local name so `DecisionFn` and the core builder
 * depend on one stable symbol; the shape is member 1's to define.
 */
export type DecisionFacts = DeterministicDecisionFacts;

/** Adapter result. */
export interface DomainPipelineResult {
  readonly data_status: 'ready' | 'insufficient_data';
  /** Why the pipeline stopped. `null` only when `data_status='ready'`. */
  readonly stop_reason: string | null;
  /** Official-source provenance; empty string when the STOP gate failed. */
  readonly source_manifest_hash: string;
  /** Domain steps still unwired. Non-empty ⇒ `insufficient_data`. */
  readonly pending_steps: readonly string[];
  /** Deterministic facts; `null` whenever `data_status='insufficient_data'`. */
  readonly facts: DecisionFacts | null;
}

/** The adapter contract `DecisionFn` depends on. */
export interface DomainPipelineAdapter {
  execute(input: DomainPipelineInput): Promise<DomainPipelineResult>;
}

function stopped(stopReason: string, sourceManifestHash = ''): DomainPipelineResult {
  return {
    data_status: 'insufficient_data',
    stop_reason: stopReason,
    source_manifest_hash: sourceManifestHash,
    pending_steps: PENDING_PIPELINE_STEPS,
    facts: null,
  };
}

/**
 * Runs the deterministic pipeline via the domain composition facade.
 *
 * Contains no threshold, no grading boundary and no formula.
 *
 * @example
 * ```ts
 * const adapter = new DefaultDomainPipelineAdapter({
 *   ingestion: { ingest: () => ingestData(sourceProvider) },
 *   config: configProvider,
 * });
 * const result = await adapter.execute({ eventId: 'TPE_2026_ACC_001' });
 * ```
 */
export class DefaultDomainPipelineAdapter implements DomainPipelineAdapter {
  private readonly decide: DecisionComposerPort;

  constructor(private readonly ports: DomainPipelinePorts) {
    this.decide = ports.decide ?? DEFAULT_DECISION_COMPOSER;
  }

  async execute(input: DomainPipelineInput): Promise<DomainPipelineResult> {
    // 1. Source-hash STOP gate + the five official files (TASK-007 / TASK-019).
    //    A hash mismatch stops here: an unknown data version must never decide.
    const ingested = this.ports.ingestion.ingest();

    if (ingested.data_status !== 'ready') {
      return stopped(
        ingested.stop_reason ?? 'Ingestion reported insufficient_data.',
        ingested.source_manifest_hash,
      );
    }

    // 2. Resolve the incident here, so an event_id absent from the official set is
    //    a disclosed data gap rather than the facade's thrown Error.
    const incident = this.resolveIncident(ingested.incidents, input.eventId);
    if (incident === null) {
      return stopped(
        `Event "${input.eventId}" is not present in the official incident set.`,
        ingested.source_manifest_hash,
      );
    }

    // 3. One deterministic composition call. Every rule, threshold and formula
    //    lives inside it; a fault raised in there propagates rather than being
    //    reported as a data gap.
    const decision = this.decide({
      ingestion: ingested,
      config: this.ports.config,
      incident,
    });

    if (decision.data_status !== 'ready' || decision.facts === null) {
      return stopped(
        decision.stop_reason ?? 'Domain pipeline reported insufficient_data.',
        decision.source_manifest_hash,
      );
    }

    // 4. Guard against a partial pipeline. Currently unreachable, and deliberately
    //    kept: if a step is ever un-wired again, this is what stops a DecisionCore
    //    from being assembled without it.
    if (PENDING_PIPELINE_STEPS.length > 0) {
      return stopped(
        `Domain pipeline incomplete: ${PENDING_PIPELINE_STEPS.join(', ')}. ` +
          'Refusing to assemble a DecisionCore from a partial pipeline (§21 no-fabrication).',
        decision.source_manifest_hash,
      );
    }

    return {
      data_status: 'ready',
      stop_reason: null,
      source_manifest_hash: decision.source_manifest_hash,
      pending_steps: PENDING_PIPELINE_STEPS,
      facts: decision.facts,
    };
  }

  /** `null` when the official incident set does not contain this `event_id`. */
  private resolveIncident(
    incidents: readonly Incident[] | undefined,
    eventId: string,
  ): Incident | null {
    return incidents?.find((candidate) => candidate.event_id === eventId) ?? null;
  }
}
