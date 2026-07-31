/**
 * DecisionCore persistence (design §10.11a, §15.2; TASK-100 + TASK-101).
 *
 * One immutable conditional Put, and a three-way classification of its outcome:
 *
 *   `attribute_not_exists(decision_id)` succeeds ......... COMMITTED
 *   fails → ConsistentRead GetItem → identity matches .... ALREADY_COMMITTED_SAME_DECISION
 *   fails → ConsistentRead GetItem → identity differs .... CORE_IDENTITY_CONFLICT
 *
 * `core_write_status` is EXECUTION-LOCAL (§6): it is returned to the Step
 * Functions Choice Gate and is never stored in DecisionCoreTable, because the
 * same stored core yields different statuses depending on which execution asked.
 *
 * Two things this module must not do, both enforced by the ports it accepts:
 *  - it never writes IdempotencyTable (`core_committed` belongs to
 *    `MARK_CORE_COMMITTED`, FIX 2 — DecisionFnRole is explicitly denied that
 *    write in §18);
 *  - it never overwrites a committed core, even on conflict.
 *
 * @module backend/decision/decision_core_writer
 */

import { CoreWriteStatus } from '@city-commander/shared-schemas';
import type { DecisionCore } from '@city-commander/shared-schemas';
import { DecisionCoreAlreadyExistsError } from '../repository/decision_core_repository.js';
import type { DecisionCorePort } from '../repository/decision_core_repository.js';
import { classifyCoreIdentity } from './identity_classifier.js';
import type { CoreIdentityMismatch } from './identity_classifier.js';

/** Outcome of persisting a DecisionCore. */
export type PersistCoreOutcome =
  | {
      /** First write won. Proceed to MARK_CORE_COMMITTED. */
      readonly status: CoreWriteStatus.COMMITTED;
      readonly core: DecisionCore;
    }
  | {
      /**
       * A core with identical identity already exists — safe same-task retry or a
       * lost response. Proceed to the idempotent MARK_CORE_COMMITTED; do NOT
       * rewrite the core.
       */
      readonly status: CoreWriteStatus.ALREADY_COMMITTED_SAME_DECISION;
      readonly core: DecisionCore;
    }
  | {
      /**
       * Terminal. A DIFFERENT decision is committed under this key. Fail closed:
       * no overwrite, no `fast_path_ready`, no enrichment, no public alert; log a
       * security alert and record MARK_PROCESSING_FAILED
       * (`retryable=false`, `recovery_stage=NONE`).
       */
      readonly status: CoreWriteStatus.CORE_IDENTITY_CONFLICT;
      /** The core already stored. Never modified. */
      readonly storedCore: DecisionCore;
      /** Every identity field that diverged, for the security alert. */
      readonly mismatches: readonly CoreIdentityMismatch[];
    };

/**
 * Persist a DecisionCore and classify the result.
 *
 * @throws TableReadError on a non-conditional DynamoDB failure — a transient
 *         fault is never reported as a conflict
 *
 * @example DecisionFn → Step Functions Choice Gate
 * ```ts
 * const outcome = await persistDecisionCore(coreRepository, core);
 * switch (outcome.status) {
 *   case CoreWriteStatus.COMMITTED:
 *   case CoreWriteStatus.ALREADY_COMMITTED_SAME_DECISION:
 *     return { core_write_status: outcome.status };            // → MARK_CORE_COMMITTED
 *   case CoreWriteStatus.CORE_IDENTITY_CONFLICT:
 *     return { core_write_status: outcome.status };             // → terminal failure
 * }
 * ```
 */
export async function persistDecisionCore(
  repository: DecisionCorePort,
  core: DecisionCore,
): Promise<PersistCoreOutcome> {
  try {
    const committed = await repository.conditionalPutNew(core);
    return { status: CoreWriteStatus.COMMITTED, core: committed };
  } catch (error: unknown) {
    if (!(error instanceof DecisionCoreAlreadyExistsError)) throw error;

    // Mandated: strongly-consistent re-read before classifying. An eventually
    // consistent read could miss the very write that caused this failure.
    const stored = await repository.getConsistent(core.decision_id);

    if (stored === null) {
      // The Put said the key exists, the consistent read says it does not. That
      // cannot both be true, so treat it as a conflict rather than retrying a
      // write against an inconsistent view.
      return {
        status: CoreWriteStatus.CORE_IDENTITY_CONFLICT,
        storedCore: core,
        mismatches: [
          {
            field: 'decision_id',
            expected: core.decision_id,
            actual: '<absent on consistent read>',
          },
        ],
      };
    }

    const classification = classifyCoreIdentity(core, stored);

    if (classification.status === CoreWriteStatus.ALREADY_COMMITTED_SAME_DECISION) {
      // Return the STORED core: it is the committed truth, and the workflow must
      // continue against it rather than against this execution's copy.
      return { status: CoreWriteStatus.ALREADY_COMMITTED_SAME_DECISION, core: stored };
    }

    return {
      status: CoreWriteStatus.CORE_IDENTITY_CONFLICT,
      storedCore: stored,
      mismatches: classification.mismatches,
    };
  }
}
