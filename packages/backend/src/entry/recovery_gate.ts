/**
 * `RecoveryGateFn` Lambda entry point (§10.11e, §15.2; TASK-080, TASK-093).
 *
 * Resolves the three table names from the environment, assembles the three
 * READ-ONLY ports, and delegates to {@link evaluateRecoveryGate}. All judgement
 * — the `effective_core_committed` OR, the narrative set difference, the
 * recommended mode — lives in `src/recovery/recovery_gate.ts` and is not
 * restated here.
 *
 * ## Read-only is enforced by the types, not by convention
 *
 * The ports are built with {@link createIdempotencyReader}, `DecisionCoreReader`
 * and `DecisionNarrativeReader`. None of them expose a write primitive, so this
 * function could not write to DynamoDB even if a later edit tried to: it would
 * be a compile error long before it reached the explicit `Deny` on
 * `RecoveryGateFnRole` (§18 / TASK-080).
 *
 * This is why the entry point deliberately does NOT construct an
 * `IdempotencyRepository` and narrow it to `IdempotencyReader`. A reader built
 * from the factory cannot be widened back; a repository assigned to a
 * narrower-typed field can be, with one cast.
 *
 * ## Invocation shape
 *
 * Invoked by Step Functions with the gate's inputs as the payload, so the event
 * IS a {@link RecoveryGateInput}. `decisionId` is optional in the type and the
 * gate falls back to the value on the IdempotencyTable record, so a workflow
 * INPUT that carries only `idempotency_key` still resolves.
 *
 * Errors propagate. A throttled read must surface as a failure the state machine
 * can retry — never as `core_exists: false`, which would send recovery down
 * FULL_WORKFLOW and try to rewrite an immutable DecisionCore.
 *
 * @module backend/entry/recovery_gate
 */

import { createIdempotencyReader } from '../repository/idempotency_repository.js';
import { DecisionCoreReader } from '../repository/decision_core_reader.js';
import { DecisionNarrativeReader } from '../repository/decision_narrative_reader.js';
import type {
  RecoveryGateInput,
  RecoveryGatePorts,
  RecoveryGateResult,
} from '../recovery/recovery_gate.js';
import { evaluateRecoveryGate } from '../recovery/recovery_gate.js';
import { resolveTableName } from '../config/env_keys.js';

/**
 * Container-scoped singleton.
 *
 * Lazy rather than module-scope so a bad environment variable throws inside the
 * handler, where Lambda attaches it to the invocation and Step Functions can
 * retry, instead of becoming a context-free `Runtime.ImportModuleError`. Reused
 * once built, so the three DynamoDB clients keep their connection pools across
 * warm invocations.
 */
let ports: RecoveryGatePorts | null = null;

function getPorts(): RecoveryGatePorts {
  if (ports === null) {
    // Region is left to the SDK, which reads the AWS_REGION that Lambda always
    // sets. Each reader builds its own DocumentClient; that is the readers'
    // documented default and keeps this module free of client plumbing.
    ports = {
      idempotency: createIdempotencyReader({
        tableName: resolveTableName('IDEMPOTENCY'),
      }),
      decisionCore: new DecisionCoreReader({
        tableName: resolveTableName('DECISION_CORE'),
      }),
      decisionNarrative: new DecisionNarrativeReader({
        tableName: resolveTableName('DECISION_NARRATIVE'),
      }),
    };
  }
  return ports;
}

/** Drop the memoized ports. Test seam only. */
export function resetPortsForTesting(): void {
  ports = null;
}

/**
 * Lambda handler for `RecoveryGateFn`. Performs three consistent reads, zero writes.
 *
 * @param event the idempotency key, and optionally the decision id
 * @returns the recovery judgement, including `recommended_recovery_mode`
 * @throws ReaderUsageError when `idempotencyKey` is empty
 * @throws IdempotencyRepositoryError / TableReadError on a read failure —
 *         a fault is never reported as "absent"
 */
export async function handler(event: RecoveryGateInput): Promise<RecoveryGateResult> {
  return evaluateRecoveryGate(getPorts(), event);
}

export default handler;
