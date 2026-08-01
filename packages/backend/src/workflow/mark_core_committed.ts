/**
 * MARK_CORE_COMMITTED — the Fast Path gate (design §10.11e, §15.2, PATCH 2/FIX 2;
 * TASK-102).
 *
 * This checkpoint is the ONLY writer of `core_committed`. `DecisionFn` has zero
 * write permission on IdempotencyTable (§18 / TASK-077), so the flag can only
 * ever be set here, by `WorkflowStatusFn`, under execution fencing.
 *
 * It is also the gate for `decision.fast_path_ready`: the event may be pushed
 * only after this action returns `APPLIED` or `ALREADY_APPLIED`. Pushing earlier
 * would let a fenced-out execution announce a decision that the current attempt
 * had not committed.
 *
 * `core_committed=false` is part of the guard, which makes the action naturally
 * once-only. Two evidence sources are accepted (§10.11e):
 *  - `DECISIONFN_COMMITTED` — normal path, or a safe same-task retry that
 *    resolved to `ALREADY_COMMITTED_SAME_DECISION`;
 *  - `RECOVERY_GATE_CORE_EXISTS` — ENRICHMENT_ONLY recovery, where the read-only
 *    `RecoveryGateFn` confirmed `core_exists=true`. Persisting the flag here is
 *    what stops the design's forbidden state: `completed` with
 *    `core_committed=false` while a DecisionCore actually exists.
 *
 * @module backend/workflow/mark_core_committed
 */

import { IdempotencyStatus } from '@city-commander/shared-schemas';
import type { EvidenceSource } from '@city-commander/shared-schemas';
import { applyOrConfirm } from './apply_or_confirm.js';
import type { ApplyOrConfirmOutcome, IdempotencyStateStore } from './apply_or_confirm.js';
import type { StatusActionContext, WorkflowStatusInput } from './status_context.js';

/** Extra input for MARK_CORE_COMMITTED. */
export interface MarkCoreCommittedContext extends StatusActionContext {
  /**
   * Which witness backs the flag.
   *
   * `DECISIONFN_COMMITTED` on the normal/safe-retry path;
   * `RECOVERY_GATE_CORE_EXISTS` when ENRICHMENT_ONLY recovery confirmed the core.
   */
  readonly evidenceSource: EvidenceSource;
}

/**
 * Record that the DecisionCore is committed, gating the Fast Path push.
 *
 * @returns `APPLIED` | `ALREADY_APPLIED` → may push `fast_path_ready` and enrich;
 *          `FENCED_STALE_EXECUTION` → terminate with no side effects
 */
export function markCoreCommitted(
  store: IdempotencyStateStore,
  input: WorkflowStatusInput,
  context: MarkCoreCommittedContext,
): Promise<ApplyOrConfirmOutcome> {
  const { executionArn, nowDisplay, evidenceSource } = context;

  return applyOrConfirm(store, {
    idempotencyKey: input.idempotencyKey,
    action: 'MARK_CORE_COMMITTED',
    fencing: { executionArn, attemptCount: input.attemptCount },
    guard: {
      status: IdempotencyStatus.running,
      workflow_execution_arn: executionArn,
      attempt_count: input.attemptCount,
      // Makes the checkpoint once-only: a second attempt fails the guard and is
      // resolved as ALREADY_APPLIED rather than re-writing the flag.
      core_committed: false,
    },
    mutation: {
      set: {
        core_committed: true,
        evidence_source: evidenceSource,
        last_transition_execution_arn: executionArn,
        last_transition_attempt_count: input.attemptCount,
        updated_at: nowDisplay,
      },
    },
    confirmTargetReached: (record) => record.core_committed === true,
  });
}
