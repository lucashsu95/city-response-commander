/**
 * DecisionCore Put-failure identity classification (design §6, §15.2, FIX 4;
 * TASK-101).
 *
 * A failed `attribute_not_exists(decision_id)` Put means "a core already exists
 * under this key". Design is emphatic that this must NOT be blanket-treated as a
 * duplicate execution, because two very different situations produce it:
 *
 *  - **Same decision.** Express is at-least-once, so a task can legitimately run
 *    twice, or the first response can be lost. The existing core is byte-for-byte
 *    the same decision → `ALREADY_COMMITTED_SAME_DECISION`: do not rewrite,
 *    continue to the idempotent `MARK_CORE_COMMITTED` checkpoint.
 *  - **Different decision.** The same key maps to a different set of decision
 *    facts → `CORE_IDENTITY_CONFLICT`: fail closed. Do not overwrite the core, do
 *    not push an alert, do not enrich, log a security alert, and record a
 *    terminal `processing_failed`.
 *
 * Five immutable identity fields are compared, and `core_hash` is the canonical
 * hash from §10.11a-1 (FIX 4). Because that hash excludes execution-volatile
 * metadata — `injection_run_id`, execution ARN/name, `trace_id`, `attempt_count`,
 * lifecycle timestamps — a genuine retry of the same decision produces the same
 * hash, while any changed decision fact produces a different one. Comparing raw
 * records instead of the canonical hash would flag every retry as a conflict.
 *
 * @module backend/decision/identity_classifier
 */

import { CoreWriteStatus } from '@city-commander/shared-schemas';
import type { DecisionCore } from '@city-commander/shared-schemas';

/** The immutable fields that define core identity (§15.2). */
export const CORE_IDENTITY_FIELDS = [
  'decision_id',
  'idempotency_key',
  'source_manifest_hash',
  'core_hash',
  'schema_version',
] as const satisfies readonly (keyof DecisionCore)[];

/** One field-level difference found during comparison. */
export interface CoreIdentityMismatch {
  readonly field: (typeof CORE_IDENTITY_FIELDS)[number];
  readonly expected: string;
  readonly actual: string;
}

/** Result of comparing a computed core against the one already stored. */
export interface CoreIdentityClassification {
  readonly status:
    CoreWriteStatus.ALREADY_COMMITTED_SAME_DECISION | CoreWriteStatus.CORE_IDENTITY_CONFLICT;
  /** Every field that differs. Empty iff the status is ALREADY_COMMITTED_SAME_DECISION. */
  readonly mismatches: readonly CoreIdentityMismatch[];
}

/**
 * Compare the computed core against the stored one on the five identity fields.
 *
 * @param computed the core this execution just built
 * @param stored the core read back with `ConsistentRead: true`
 *
 * All mismatching fields are reported, not just the first, so the security alert
 * (TASK-159) can state exactly what diverged.
 */
export function classifyCoreIdentity(
  computed: DecisionCore,
  stored: DecisionCore,
): CoreIdentityClassification {
  const mismatches: CoreIdentityMismatch[] = [];

  for (const field of CORE_IDENTITY_FIELDS) {
    const expected = computed[field];
    const actual = stored[field];
    if (expected !== actual) {
      mismatches.push({ field, expected: String(expected), actual: String(actual) });
    }
  }

  return {
    status:
      mismatches.length === 0
        ? CoreWriteStatus.ALREADY_COMMITTED_SAME_DECISION
        : CoreWriteStatus.CORE_IDENTITY_CONFLICT,
    mismatches,
  };
}
