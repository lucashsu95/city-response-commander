/**
 * Execution Status — Frontend Runtime Boundary Decoder
 * (§10.11c FIX 1, §10.11e, §12 inject status matrix, §13 `processing.failed`)
 *
 * TASK-133. Turns three separate pieces of backend truth into three typed,
 * mutually exclusive presentation models:
 *
 * 1. the **read-only `execution` projection** carried by
 *    `GET /decisions/{decision_id}` (`status` / `last_error` / `retryable` /
 *    `attempt_count`, sourced from `IdempotencyTable`, FIX 1)
 * 2. the **HTTP outcome** of a `POST /incidents/{event_id}/inject` attempt
 *    (`202` / `200` / `503` / `409`, §12 status matrix)
 * 3. the **`processing.failed` realtime event** (`error_code` / `retryable`, §13)
 *
 * ## Why the `execution` block is modelled apart from `DecisionCore`
 *
 * `execution` is a **pure read projection** of `IdempotencyTable` (FIX 1). It is
 * not part of `DecisionCore`, which is `immutable_after_commit` and carries no
 * `IdempotencyTable` state at all. Nothing here is writable, and no field in
 * this module is ever presented as a control: the workflow moves the record,
 * `InjectFn` and `WorkflowStatusFn` own the transitions (§10.11e FIX 2), and the
 * Dashboard only observes.
 *
 * ## Why the states are enumerated rather than reduced to ok/failed
 *
 * §12 forbids collapsing the inject outcomes, and FIX 1 makes one of them
 * terminal:
 *
 * | outcome | meaning | recoverable? |
 * | --- | --- | --- |
 * | `202` | StartExecution accepted, or an existing `starting` / healthy `running` | in progress |
 * | `200` | `status=completed` — a finished decision, a *different* branch from `202` | n/a |
 * | `503` `WORKFLOW_START_FAILED` | the workflow never started | yes, `retryable=true`, by lease recovery |
 * | `409` `CORE_IDENTITY_CONFLICT` | DecisionCore identity mismatch | **no** — `retryable=false`, `recovery_stage=NONE`, terminal |
 *
 * A `409` must never be rendered as a generic error and never as a `500`: it is
 * fail-closed, it is the one outcome that no retry can clear, and the
 * `retryable=false` flag is what the UI keys its (absent) retry affordance off.
 * `retryableOf` therefore reports `false` for it structurally rather than
 * relying on a caller to remember.
 *
 * ## Deterministic boundary (§9)
 *
 * - no status, `error_code`, `decision_id`, `trace_id` or `attempt_count` is
 *   ever synthesized. Absent ⇒ `null`, and the panel says "not supplied".
 * - `retryable` is read from the payload, never inferred from the status code.
 *   An absent `retryable` stays `null` and is treated as *not* retryable by
 *   {@link offersRetry} — fail-closed, because offering a retry the backend did
 *   not authorize is worse than withholding one it did.
 * - a `status` outside the five `IdempotencyTable` values is surfaced verbatim as
 *   an unrecognized status, not silently mapped onto a known one.
 *
 * The two payload decoders here read fields individually instead of failing the
 * whole payload on a type mismatch, unlike `decision_read_model.ts`. That is
 * deliberate and scoped: an inject response and a `processing.failed` frame are
 * *reports about a failure*, so refusing to decode one would hide the very
 * failure the operator needs to see. A field of the wrong type is reported as
 * not supplied — never coerced — and the authoritative record stays the
 * strictly-decoded `execution` projection on `GET /decisions/{decision_id}`.
 *
 * @module frontend/decision/execution_model
 */

import { isRecord, optionalBoolean, optionalNonEmptyString } from './decode_primitives.js';
import type { ExecutionSummaryView } from './decision_read_model.js';

// ─── IdempotencyTable Status Vocabulary (§10.11e) ────────────

/**
 * The five `IdempotencyTable.status` values — exactly five, and deliberately
 * **without** `accepted`: `202 Accepted` is an API response semantic, never a
 * stored status (§10.11e, §12).
 */
export const EXECUTION_STATUSES = [
  'starting',
  'running',
  'completed',
  'start_failed',
  'processing_failed',
] as const;

export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];

/** `true` when `value` is one of the five documented statuses. */
export function isExecutionStatus(value: string | null): value is ExecutionStatus {
  return value !== null && (EXECUTION_STATUSES as readonly string[]).includes(value);
}

/**
 * `last_error` values the workflow writes (§10.11e, `MARK_PROCESSING_FAILED` /
 * `RECONCILE_STALE_RUNNING`). Any other value is displayed verbatim.
 */
export const CORE_IDENTITY_CONFLICT = 'CORE_IDENTITY_CONFLICT';
export const STALE_RUNNING_EXECUTION = 'STALE_RUNNING_EXECUTION';
export const RECOVERY_CORE_MISSING = 'RECOVERY_CORE_MISSING';
/** `error_code` returned by a `503` inject response (§12). */
export const WORKFLOW_START_FAILED = 'WORKFLOW_START_FAILED';

/** `true` when this error names the terminal DecisionCore identity conflict. */
export function isCoreIdentityConflict(errorCode: string | null): boolean {
  return errorCode === CORE_IDENTITY_CONFLICT;
}

// ─── Execution Projection Presentation ───────────────────────

/**
 * The distinct states the read-only `execution` projection can be in.
 *
 * Each variant exists because it demands a different operator response, so none
 * of them may be merged:
 *
 * - `absent` — no `execution` block. The `IdempotencyTable` record expired by
 *   TTL or never existed; the decision itself may still be perfectly valid, so
 *   this is *not* a failure.
 * - `starting` / `running` — in progress, nothing to do but wait.
 * - `completed` — the workflow finished.
 * - `start_failed` — the workflow never started; recoverable by lease recovery.
 * - `processing_failed_retryable` — a stage failed; a same-key re-injection can
 *   recover it (`retryable=true`, graded by `recovery_stage`).
 * - `terminal_identity_conflict` — `last_error=CORE_IDENTITY_CONFLICT`,
 *   `retryable=false`, `recovery_stage=NONE`. **Terminal and non-recoverable.**
 * - `processing_failed_terminal` — `retryable=false` for some *other* reason.
 *   Still no retry affordance: the flag is honoured verbatim rather than
 *   second-guessed.
 * - `processing_failed_unknown_retryability` — `processing_failed` with no
 *   `retryable` flag at all. Fail-closed: no retry offered, gap disclosed.
 * - `unrecognized` — a `status` string outside the documented five.
 */
export type ExecutionPresentationKind =
  | 'absent'
  | 'starting'
  | 'running'
  | 'completed'
  | 'start_failed'
  | 'processing_failed_retryable'
  | 'terminal_identity_conflict'
  | 'processing_failed_terminal'
  | 'processing_failed_unknown_retryability'
  | 'unrecognized';

/** Severity ordering used only for visual hierarchy, never for logic. */
export type ExecutionSeverity =
  'neutral' | 'info' | 'progress' | 'success' | 'warning' | 'terminal';

/** Classified view of the read-only `execution` projection. */
export interface ExecutionPresentation {
  readonly kind: ExecutionPresentationKind;
  readonly severity: ExecutionSeverity;
  /** `execution.status` verbatim, or `null` when no block was supplied. */
  readonly status: string | null;
  /** `execution.last_error` verbatim. */
  readonly lastError: string | null;
  /** `execution.retryable` verbatim. Never inferred from `status`. */
  readonly retryable: boolean | null;
  /** `execution.attempt_count` verbatim. */
  readonly attemptCount: number | null;
  /**
   * Whether lease recovery can still move this record forward, per §10.11e /
   * §15.2. `false` for every terminal state; `null` when the backend did not
   * supply enough to say.
   */
  readonly recoverable: boolean | null;
}

/**
 * Classifies the `execution` projection into one non-interchangeable state.
 *
 * Pure mapping over backend fields: it compares `status` against the five
 * documented values and reads `retryable` / `last_error` as given. It performs
 * no recovery, requests nothing, and derives no field the backend omitted.
 */
export function classifyExecution(execution: ExecutionSummaryView | null): ExecutionPresentation {
  if (execution === null) {
    return {
      kind: 'absent',
      severity: 'neutral',
      status: null,
      lastError: null,
      retryable: null,
      attemptCount: null,
      recoverable: null,
    };
  }

  const base = {
    status: execution.status,
    lastError: execution.lastError,
    retryable: execution.retryable,
    attemptCount: execution.attemptCount,
  } as const;

  if (!isExecutionStatus(execution.status)) {
    return { ...base, kind: 'unrecognized', severity: 'warning', recoverable: null };
  }

  switch (execution.status) {
    case 'starting':
      return { ...base, kind: 'starting', severity: 'progress', recoverable: true };
    case 'running':
      return { ...base, kind: 'running', severity: 'progress', recoverable: true };
    case 'completed':
      return { ...base, kind: 'completed', severity: 'success', recoverable: null };
    case 'start_failed':
      return { ...base, kind: 'start_failed', severity: 'warning', recoverable: true };
    case 'processing_failed': {
      if (isCoreIdentityConflict(execution.lastError)) {
        // Terminal by contract: recovery_stage=NONE, retryable=false, and no
        // `processing_failed → starting` transition matches it (FIX 1).
        return {
          ...base,
          kind: 'terminal_identity_conflict',
          severity: 'terminal',
          recoverable: false,
        };
      }
      if (execution.retryable === true) {
        return {
          ...base,
          kind: 'processing_failed_retryable',
          severity: 'warning',
          recoverable: true,
        };
      }
      if (execution.retryable === false) {
        return {
          ...base,
          kind: 'processing_failed_terminal',
          severity: 'terminal',
          recoverable: false,
        };
      }
      return {
        ...base,
        kind: 'processing_failed_unknown_retryability',
        severity: 'warning',
        recoverable: null,
      };
    }
  }
}

/** `true` only for the terminal, non-recoverable identity conflict (FIX 1). */
export function isTerminalConflictPresentation(presentation: ExecutionPresentation): boolean {
  return presentation.kind === 'terminal_identity_conflict';
}

// ─── Inject HTTP Outcome (§12 status matrix) ──────────────────

/** The §12 inject outcomes, kept structurally apart. */
export type InjectionOutcomeKind =
  /** `202` — StartExecution accepted, or an existing in-progress execution. */
  | 'accepted'
  /** `200` — `status=completed`; a separate branch from `202` by design. */
  | 'completed'
  /** `503 WORKFLOW_START_FAILED` — workflow never started; `retryable=true`. */
  | 'start_failed'
  /** `409 CORE_IDENTITY_CONFLICT` — terminal, non-recoverable, never a `500`. */
  | 'terminal_conflict'
  /** Any other status (`401`/`403`/`429`/`500`…). Never conflated with the four. */
  | 'other_error';

/** Decoded body fields of an inject response. Nothing is fabricated. */
export interface InjectionOutcome {
  readonly kind: InjectionOutcomeKind;
  /** HTTP status exactly as returned. */
  readonly httpStatus: number;
  /** `decision_id`, or `null` when the response did not carry one. */
  readonly decisionId: string | null;
  /** `trace_id`, or `null` when the response did not carry one. */
  readonly traceId: string | null;
  /** `status` field of the body (`completed` / `start_failed` / …), verbatim. */
  readonly status: string | null;
  /** `error_code`, verbatim. `null` on the success outcomes. */
  readonly errorCode: string | null;
  /** `retryable`, verbatim. Never inferred from the HTTP status. */
  readonly retryable: boolean | null;
  /** `message` from the §12 error envelope, when present. */
  readonly message: string | null;
  /** `true` when the response body was not a JSON object at all. */
  readonly bodyMalformed: boolean;
}

/**
 * Decodes a `POST /incidents/{event_id}/inject` response into one §12 outcome.
 *
 * The HTTP status alone selects the branch — that is the contract, and it is why
 * a `409` can never surface as a generic error and a `503` can never surface as
 * a success. Body fields are then read verbatim; a missing one stays `null`.
 *
 * A non-object body does not change the branch: the status is still
 * authoritative. `bodyMalformed` is set so the panel can disclose that the
 * identifiers were unavailable rather than implying none were issued.
 *
 * @param httpStatus - status line of the response
 * @param body - parsed JSON body, or any non-object value
 */
export function decodeInjectionResponse(httpStatus: number, body: unknown): InjectionOutcome {
  const record = isRecord(body) ? body : null;

  const decisionId =
    record === null ? null : (optionalNonEmptyString(record, 'decision_id') ?? null);
  const traceId = record === null ? null : (optionalNonEmptyString(record, 'trace_id') ?? null);
  const status = record === null ? null : (optionalNonEmptyString(record, 'status') ?? null);
  const errorCode = record === null ? null : (optionalNonEmptyString(record, 'error_code') ?? null);
  const message = record === null ? null : (optionalNonEmptyString(record, 'message') ?? null);
  const retryable = record === null ? null : (optionalBoolean(record, 'retryable') ?? null);

  const kind: InjectionOutcomeKind =
    httpStatus === 202
      ? 'accepted'
      : httpStatus === 200
        ? 'completed'
        : httpStatus === 503
          ? 'start_failed'
          : httpStatus === 409
            ? 'terminal_conflict'
            : 'other_error';

  return {
    kind,
    httpStatus,
    decisionId,
    traceId,
    status,
    errorCode,
    // A 409 is terminal by contract (FIX 1). Reporting `false` structurally
    // rather than trusting the body means a body that omitted `retryable`, or
    // wrongly said `true`, still cannot produce a retry affordance.
    retryable: kind === 'terminal_conflict' ? false : retryable,
    message,
    bodyMalformed: record === null,
  };
}

/**
 * Whether the UI may offer a retry for this outcome.
 *
 * `true` only when the backend said `retryable: true`. The terminal conflict is
 * excluded structurally, so no combination of body fields can turn it into a
 * retryable outcome.
 */
export function offersRetry(outcome: InjectionOutcome): boolean {
  if (outcome.kind === 'terminal_conflict') return false;
  return outcome.retryable === true;
}

// ─── `processing.failed` Event (§13) ─────────────────────────

/** Decoded `processing.failed` frame. Absent fields stay `null`. */
export interface ProcessingFailedView {
  readonly decisionId: string | null;
  readonly eventId: string | null;
  /** `error_code` verbatim; `CORE_IDENTITY_CONFLICT` for the terminal variant. */
  readonly errorCode: string | null;
  /** `retryable` verbatim. `false` for the terminal variant (FIX 1). */
  readonly retryable: boolean | null;
  readonly traceId: string | null;
  readonly occurredAt: string | null;
  readonly policyVersion: string | null;
  /** `true` when the frame was not a JSON object. */
  readonly malformed: boolean;
}

/**
 * Decodes a `processing.failed` payload (§13).
 *
 * The event is a *notification*: it never supplies decision state, and the
 * authoritative failure record remains the read-only `execution` projection on
 * `GET /decisions/{decision_id}` (§13 fallback column). Only the two fields §13
 * names — `error_code` and `retryable` — plus the standard envelope identifiers
 * are read.
 */
export function decodeProcessingFailed(payload: unknown): ProcessingFailedView {
  if (!isRecord(payload)) {
    return {
      decisionId: null,
      eventId: null,
      errorCode: null,
      retryable: null,
      traceId: null,
      occurredAt: null,
      policyVersion: null,
      malformed: true,
    };
  }

  return {
    decisionId: optionalNonEmptyString(payload, 'decision_id') ?? null,
    eventId: optionalNonEmptyString(payload, 'event_id') ?? null,
    errorCode: optionalNonEmptyString(payload, 'error_code') ?? null,
    retryable: optionalBoolean(payload, 'retryable') ?? null,
    traceId: optionalNonEmptyString(payload, 'trace_id') ?? null,
    occurredAt: optionalNonEmptyString(payload, 'occurred_at') ?? null,
    policyVersion: optionalNonEmptyString(payload, 'policy_version') ?? null,
    malformed: false,
  };
}

/**
 * `attempt_count` as text.
 *
 * Kept here rather than in the panel because a non-integer or negative attempt
 * count is a contract breach worth disclosing, not a number to print blindly —
 * and because clamping or rounding it would be a client-side derivation.
 */
export function attemptCountText(value: number | null, unavailable: string): string {
  if (value === null) return unavailable;
  if (!Number.isInteger(value) || value < 0) return `${String(value)}（非預期值）`;
  return String(value);
}
