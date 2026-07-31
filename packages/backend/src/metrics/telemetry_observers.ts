/**
 * Outcome-to-metric mapping (TASK-158).
 *
 * The handlers in this package already return precise outcome objects. These
 * observers turn those outcomes into the right metric, so a call site is one line
 * and every handler agrees on what counts as what.
 *
 * ## The vocabularies deliberately differ, and this is where they meet
 *
 * `applyOrConfirm` distinguishes `DIFFERENT_EXECUTION` from `DIFFERENT_ATTEMPT`
 * because the guard needs that precision to explain itself. CloudWatch does not:
 * both are one stale execution being intercepted, and splitting them across two
 * dimension values would halve the population of an alarm that should watch
 * fencing as a whole. So the metric layer collapses them to
 * `FENCED_STALE_EXECUTION` and keeps the precise reason as a searchable property.
 *
 * The one that must NOT be collapsed is `TARGET_NOT_REACHED`: the record is ours,
 * yet the guard still failed. That is the fail-closed branch, and it is the only
 * fencing reason that suggests a real defect rather than a race.
 *
 * ## What is not recorded here
 *
 * `APPLIED` and `ALREADY_APPLIED` emit nothing. Both are success (§10.11e), and a
 * counter that fires on the happy path buries the signal it exists to surface.
 *
 * @module backend/metrics/telemetry_observers
 */

import { CoreWriteStatus, StatusActionResult } from '@city-commander/shared-schemas';
import { isThrottlingError } from '../errors/transient.js';
import type { ApplyOrConfirmOutcome, FencedReason } from '../workflow/apply_or_confirm.js';
import type { PersistCoreOutcome } from '../decision/decision_core_writer.js';
import type { CounterContext, FencedExecutionReason } from './counter_emitter.js';
import type { Telemetry } from './telemetry_facade.js';

/**
 * Run an emission, swallowing anything it throws.
 *
 * {@link EmfTelemetry} is already fail-safe, but {@link Telemetry} is a public
 * interface: members 4 and 5 supply their own call sites and may supply their own
 * implementations. Enforcing the guarantee here — at the boundary between logic
 * and instrumentation — means a third-party telemetry bug cannot mask the error a
 * handler was actually reporting.
 */
function safely(emit: () => void): void {
  try {
    emit();
  } catch {
    // Deliberately silent: there is no safe channel left. Reporting a metric
    // failure through another metric risks recursing, and throwing would defeat
    // the entire point of this wrapper.
  }
}

/**
 * Collapse a guard-level fencing reason onto the metric vocabulary.
 *
 * `DIFFERENT_EXECUTION` and `DIFFERENT_ATTEMPT` are both a stale execution being
 * intercepted; `TARGET_NOT_REACHED` and `RECORD_MISSING` stay distinct because
 * they indicate a possible defect rather than a race.
 */
export function toFencedMetricReason(reason: FencedReason): FencedExecutionReason {
  switch (reason) {
    case 'DIFFERENT_EXECUTION':
    case 'DIFFERENT_ATTEMPT':
      return 'FENCED_STALE_EXECUTION';
    case 'TARGET_NOT_REACHED':
      return 'TARGET_NOT_REACHED';
    case 'RECORD_MISSING':
      return 'RECORD_MISSING';
  }
}

/**
 * Record a WorkflowStatusFn transition outcome.
 *
 * Emits only for `FENCED_STALE_EXECUTION`; the two success results are silent.
 *
 * @param action the guarded transition, e.g. `MARK_RUNNING` ??a closed set, so
 *   safe to use as the `ActionType` dimension
 */
export function observeStatusOutcome(
  telemetry: Telemetry,
  action: string,
  outcome: ApplyOrConfirmOutcome,
  context: CounterContext = {},
): void {
  if (outcome.result !== StatusActionResult.FENCED_STALE_EXECUTION) return;

  safely(() =>
    telemetry.recordFenced(toFencedMetricReason(outcome.reason), action, {
      ...context,
      ...(outcome.record === null ? {} : { attemptCount: outcome.record.attempt_count }),
    }),
  );
}

/**
 * Record a DecisionCore write outcome (TASK-100/101).
 *
 * `COMMITTED` is silent. The other two are both idempotency conflicts, separated
 * by `ActionType` so an alarm can watch the immutability violation without firing
 * on healthy at-least-once deduplication.
 */
export function observeCoreWriteOutcome(
  telemetry: Telemetry,
  outcome: PersistCoreOutcome,
  context: CounterContext = {},
): void {
  switch (outcome.status) {
    case CoreWriteStatus.COMMITTED:
      return;
    case CoreWriteStatus.ALREADY_COMMITTED_SAME_DECISION:
      safely(() => telemetry.recordConflict('DUPLICATE_SAME_DECISION', context));
      return;
    case CoreWriteStatus.CORE_IDENTITY_CONFLICT:
      safely(() => telemetry.recordConflict('CORE_IDENTITY_CONFLICT', context));
      return;
  }
}

/**
 * Record a re-request that InjectFn routed to 202 (TASK-088).
 *
 * A healthy in-flight duplicate, not an error ??the rate is what matters.
 */
export function observeInFlightRerequest(telemetry: Telemetry, context: CounterContext = {}): void {
  safely(() => telemetry.recordConflict('IN_FLIGHT_REQUEST', context));
}

/**
 * Record a throttling event, but only when the error really is throttling.
 *
 * Keeps `ThrottlingEventCount` meaningful: counting every failure here would make
 * it impossible to tell a capacity problem from a bug.
 *
 * @returns `true` when a throttling metric was emitted
 */
export function observeIfThrottled(
  telemetry: Telemetry,
  error: unknown,
  source: Parameters<Telemetry['recordThrottling']>[0],
  context: CounterContext & { readonly attemptNumber?: number } = {},
): boolean {
  if (!isThrottlingError(error)) return false;
  safely(() => telemetry.recordThrottling(source, context));
  return true;
}
