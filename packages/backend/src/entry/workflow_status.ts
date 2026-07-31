/**
 * `WorkflowStatusFn` Lambda entry point (§10.11e; TASK-091, TASK-097).
 *
 * The whole job of this module is the three lines in {@link handler}: resolve
 * configuration from the environment, assemble the store, delegate to
 * {@link dispatchWorkflowStatusAction}. No branching on `action`, no guard
 * construction, no fencing logic — all of that is already decided and tested in
 * `src/workflow/`, and duplicating any of it here would create a second place
 * where the five guarded transitions are defined.
 *
 * ## Invocation shape
 *
 * Invoked by Step Functions with the state's `Parameters` block as the payload,
 * so the event IS an {@link AslWorkflowStatusPayload} — there is no HTTP
 * envelope to unwrap and no `body` to parse. The `ApplyOrConfirmOutcome` is
 * returned as-is and becomes the state's result.
 *
 * ## Errors are not caught here
 *
 * A thrown error is how this function reports failure to the state machine, and
 * `workflow.asl.json` already has `Retry` and `Catch` blocks bound to those
 * failures. Wrapping the dispatch in a `try/catch` that returned a value would
 * turn a failed transition into a successful state and silently skip the
 * `PREPARE_*` error path.
 *
 * `FENCED_STALE_EXECUTION` is deliberately NOT an error: it is a legitimate
 * outcome meaning the fencing worked, and it flows back as a normal result for
 * the state machine to branch on.
 *
 * @module backend/entry/workflow_status
 */

import { IdempotencyRepository } from '../repository/idempotency_repository.js';
import type { IdempotencyStateStore } from '../workflow/apply_or_confirm.js';
import type { ApplyOrConfirmOutcome } from '../workflow/apply_or_confirm.js';
import type { AslWorkflowStatusPayload } from '../workflow/wiring.js';
import { dispatchWorkflowStatusAction } from '../workflow/wiring.js';
import { systemInjectionClock } from '../time/clock.js';
import { resolveExecutionDeadlineMs, resolveTableName } from '../config/env_keys.js';

/** Everything the handler needs that is not in the event. */
interface WorkflowStatusRuntime {
  readonly store: IdempotencyStateStore;
  readonly executionDeadlineMs: number;
}

/**
 * Container-scoped singleton.
 *
 * Built on first invocation rather than at import time, for two reasons that
 * pull in the same direction:
 *
 *  1. A missing or malformed environment variable throws inside the handler,
 *     where Lambda records it against the invocation and Step Functions can
 *     retry it. Thrown at module scope it becomes an `Runtime.ImportModuleError`
 *     with no request context attached.
 *  2. Tests can call {@link resetRuntimeForTesting} between cases instead of
 *     fighting the module cache.
 *
 * Once built it is reused for the life of the container, which is the point: the
 * DynamoDB client's connection pool and resolved credentials survive across warm
 * invocations.
 */
let runtime: WorkflowStatusRuntime | null = null;

function getRuntime(): WorkflowStatusRuntime {
  if (runtime === null) {
    runtime = {
      // IdempotencyRepository satisfies IdempotencyStateStore: this function owns
      // the five guarded transitions, so it needs the writer, not the reader.
      // Region is left to the SDK, which reads the AWS_REGION that Lambda always
      // sets — re-reading it here would add a variable that can disagree.
      store: new IdempotencyRepository({
        tableName: resolveTableName('IDEMPOTENCY'),
      }),
      executionDeadlineMs: resolveExecutionDeadlineMs(),
    };
  }
  return runtime;
}

/** Drop the memoized runtime. Test seam only. */
export function resetRuntimeForTesting(): void {
  runtime = null;
}

/**
 * Lambda handler for `WorkflowStatusFn`.
 *
 * @param event one of the five ASL status payloads
 * @returns the {@link ApplyOrConfirmOutcome}, including `FENCED_STALE_EXECUTION`
 * @throws AslPayloadError for a payload the state machine should never produce
 * @throws IdempotencyRepositoryError on a DynamoDB failure
 */
export async function handler(
  event: AslWorkflowStatusPayload,
): Promise<ApplyOrConfirmOutcome> {
  const { store, executionDeadlineMs } = getRuntime();

  // One clock read per invocation, passed down. Everything below this line is
  // deterministic given the payload and this instant.
  const clock = systemInjectionClock();

  return dispatchWorkflowStatusAction(store, event, {
    nowEpochMs: clock.nowEpochMs,
    nowDisplay: clock.nowDisplay,
    executionDeadlineMs,
  });
}

export default handler;
