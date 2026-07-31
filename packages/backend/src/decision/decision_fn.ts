/**
 * DecisionFn — the deterministic Fast Path handler (design §6, §8, §15.2;
 * TASK-099).
 *
 * Orchestration only. It owns three invariants and no rule semantics:
 *
 *  1. **Source gate first.** The five official files are hash-verified before
 *     anything is computed (§10.0). An unknown data version never decides.
 *  2. **No fabrication.** If the adapter reports `insufficient_data` the handler
 *     returns that verbatim and does NOT call `buildDecisionCore`. A gap is
 *     disclosed, never filled (§21).
 *  3. **Zero IdempotencyTable writes.** `core_committed` belongs to
 *     `MARK_CORE_COMMITTED`; `DecisionFnRole` is explicitly denied that write
 *     (§18 / FIX 2). The ports below simply do not expose it.
 *
 * `core_write_status` is returned to the Step Functions Choice Gate as an
 * execution-local value; it is never stored in DecisionCoreTable (§6).
 *
 * @module backend/decision/decision_fn
 */

import { CoreWriteStatus } from '@city-commander/shared-schemas';
import type { DecisionCore } from '@city-commander/shared-schemas';
import type { DecisionCorePort } from '../repository/decision_core_repository.js';
import { persistDecisionCore } from './decision_core_writer.js';
import type { PersistCoreOutcome } from './decision_core_writer.js';
import type {
  DomainPipelineAdapter,
  DomainPipelineResult,
  PartialDecisionFacts,
} from './domain_pipeline_adapter.js';

/** Handler input, taken from the Step Functions workflow INPUT (§10.11e). */
export interface DecisionFnInput {
  readonly idempotencyKey: string;
  readonly decisionId: string;
  /** Official event id from `live_incidents.json`. */
  readonly eventId: string;
  /** Per-injection execution id. Excluded from `core_hash` (§10.11a-1). */
  readonly injectionRunId: string;
  /** Traceability only — never used for dedup or recovery (§15.2). */
  readonly workflowExecutionName?: string;
  readonly traceId: string;
}

/**
 * Builds the immutable core from deterministic facts.
 *
 * Injected as a port so the canonical hashing stays in `packages/domain`
 * (`buildDecisionCore`, TASK-035) and this handler never re-implements it.
 */
export interface DecisionCoreBuilderPort {
  build(input: {
    readonly facts: PartialDecisionFacts;
    readonly decisionId: string;
    readonly idempotencyKey: string;
    readonly injectionRunId: string;
    readonly workflowExecutionName?: string;
    readonly sourceManifestHash: string;
  }): DecisionCore;
}

/** Ports `DecisionFn` depends on. Deliberately no IdempotencyTable writer. */
export interface DecisionFnPorts {
  readonly pipeline: DomainPipelineAdapter;
  readonly coreBuilder: DecisionCoreBuilderPort;
  readonly coreRepository: DecisionCorePort;
}

/** Handler outcome, consumed by the Step Functions Choice Gate. */
export type DecisionFnResult =
  | {
      /**
       * Nothing authoritative could be produced. No core was written and no
       * `fast_path_ready` may be pushed. `200` + `data_status` at the API edge.
       */
      readonly data_status: 'insufficient_data';
      readonly stop_reason: string;
      readonly source_manifest_hash: string;
      readonly pending_steps: readonly string[];
      /** Facts computed before the stop, for disclosure. `null` if none. */
      readonly facts: PartialDecisionFacts | null;
    }
  | {
      readonly data_status: 'ready';
      /** Execution-local Choice Gate value (§6). Never persisted. */
      readonly core_write_status: CoreWriteStatus;
      readonly outcome: PersistCoreOutcome;
      readonly source_manifest_hash: string;
    };

/**
 * Run the deterministic decision and persist the core.
 *
 * @throws TableReadError on a DynamoDB fault — a transient failure is never
 *         reported as `insufficient_data`, because that would look like a data gap
 *
 * @example Step Functions DecisionFn task
 * ```ts
 * const result = await runDecisionFn(ports, input);
 * if (result.data_status === 'insufficient_data') return result;      // no core, no push
 * return { core_write_status: result.core_write_status };             // → Choice Gate
 * ```
 */
export async function runDecisionFn(
  ports: DecisionFnPorts,
  input: DecisionFnInput,
): Promise<DecisionFnResult> {
  // Steps 1–3: source gate, ingestion, Strategy A alignment, rule engine.
  const pipeline: DomainPipelineResult = await ports.pipeline.execute({ eventId: input.eventId });

  if (pipeline.data_status === 'insufficient_data' || pipeline.facts === null) {
    // Disclose and stop. buildDecisionCore is NOT called.
    return {
      data_status: 'insufficient_data',
      stop_reason: pipeline.stop_reason ?? 'Domain pipeline reported insufficient_data.',
      source_manifest_hash: pipeline.source_manifest_hash,
      pending_steps: pipeline.pending_steps,
      facts: pipeline.facts,
    };
  }

  // Step 4: assemble the immutable core (canonical core_hash lives in domain).
  const core = ports.coreBuilder.build({
    facts: pipeline.facts,
    decisionId: input.decisionId,
    idempotencyKey: input.idempotencyKey,
    injectionRunId: input.injectionRunId,
    ...(input.workflowExecutionName === undefined
      ? {}
      : { workflowExecutionName: input.workflowExecutionName }),
    sourceManifestHash: pipeline.source_manifest_hash,
  });

  // Step 5: immutable conditional Put + identity classification (TASK-100/101).
  const outcome = await persistDecisionCore(ports.coreRepository, core);

  return {
    data_status: 'ready',
    core_write_status: outcome.status,
    outcome,
    source_manifest_hash: pipeline.source_manifest_hash,
  };
}

/** `DecisionFn` bound to a fixed set of ports, built once per container. */
export class DecisionFn {
  constructor(private readonly ports: DecisionFnPorts) {}

  run(input: DecisionFnInput): Promise<DecisionFnResult> {
    return runDecisionFn(this.ports, input);
  }
}
