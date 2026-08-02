/**
 * Execution Status View Selector (§10.11c FIX 1, §10.11e, §12, §13)
 *
 * TASK-133. Memoized classification of the read-only `execution` projection held
 * by the TASK-132 decision controller, so `execution_status.tsx` stays
 * presentational and the classification runs once per projection rather than
 * once per render — matching `use_ete_view.ts` / `use_route_view.ts`.
 *
 * The hook also carries the two *event-shaped* inputs the panel renders beside
 * the projection:
 *
 * - the latest `processing.failed` frame (§13), which the Dashboard page decodes
 *   from the realtime envelope
 * - the latest `POST /incidents/{event_id}/inject` outcome (§12), produced by
 *   the injection command flow
 *
 * Neither is treated as authoritative decision state: §13 makes the WebSocket
 * frame a notification only, and §12 makes the inject response a statement about
 * the *request*, not about the decision. The authoritative failure record is
 * always the `execution` projection re-read from `GET /decisions/{decision_id}`.
 *
 * @module frontend/decision/use_execution_status
 */

import { useMemo } from 'react';
import type { ExecutionSummaryView } from './decision_read_model.js';
import { classifyExecution } from './execution_model.js';
import type {
  ExecutionPresentation,
  InjectionOutcome,
  ProcessingFailedView,
} from './execution_model.js';

/** Everything the execution panel needs, resolved once per input change. */
export interface ExecutionStatusView {
  /** Classified read-only `execution` projection (§10.11c FIX 1). */
  readonly presentation: ExecutionPresentation;
  /** Latest `processing.failed` frame for this decision, or `null`. */
  readonly lastFailureEvent: ProcessingFailedView | null;
  /** Latest inject HTTP outcome, or `null` when none has been attempted. */
  readonly injection: InjectionOutcome | null;
  /**
   * `true` when the projection and the event disagree about retryability.
   *
   * Not a repair: nothing is reconciled or preferred. It is disclosed so an
   * operator sees that a notification is out of step with the authoritative
   * record instead of silently trusting whichever was rendered last.
   */
  readonly retryabilityDisagreement: boolean;
}

export interface UseExecutionStatusInput {
  /** `execution` from the TASK-132 controller. `null` ⇒ no projection supplied. */
  readonly execution: ExecutionSummaryView | null;
  readonly lastFailureEvent?: ProcessingFailedView | null;
  readonly injection?: InjectionOutcome | null;
}

/** Non-hook form, for tests and non-React callers. */
export function executionStatusOf(input: UseExecutionStatusInput): ExecutionStatusView {
  const presentation = classifyExecution(input.execution);
  const lastFailureEvent = input.lastFailureEvent ?? null;

  const retryabilityDisagreement =
    lastFailureEvent !== null &&
    lastFailureEvent.retryable !== null &&
    presentation.retryable !== null &&
    lastFailureEvent.retryable !== presentation.retryable;

  return {
    presentation,
    lastFailureEvent,
    injection: input.injection ?? null,
    retryabilityDisagreement,
  };
}

/** Classifies the execution projection, memoized on its inputs. */
export function useExecutionStatus(input: UseExecutionStatusInput): ExecutionStatusView {
  const { execution, lastFailureEvent = null, injection = null } = input;
  return useMemo(
    () => executionStatusOf({ execution, lastFailureEvent, injection }),
    [execution, lastFailureEvent, injection],
  );
}
