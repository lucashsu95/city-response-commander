/**
 * Structured CloudWatch logging (design §19, §17; TASK-153).
 *
 * Every line is a single JSON object with a stable `event` discriminator, so
 * CloudWatch Insights can filter and aggregate without regex parsing:
 *
 * ```
 * fields @timestamp, decision_id, fenced_reason
 * | filter event = "fencing.intercepted"
 * | stats count() by fenced_reason
 * ```
 *
 * Two properties matter more than the field list:
 *
 *  1. **Correlation is mandatory.** `trace_id` is required on every line, and
 *     `decision_id` / `attempt_count` are carried whenever known. A fencing
 *     interception that cannot be tied back to its execution is not much use at
 *     3am during a live demo.
 *  2. **Credentials never reach the log.** Values are redacted by key name before
 *     serialization (§17), because the usual leak is not someone logging a
 *     password on purpose — it is an error object or a config dump carried along
 *     as context.
 *
 * Timestamps are ISO-8601 with an explicit `+08:00` offset (Asia/Taipei), so a
 * log line read from a UTC Lambda still states the wall clock the team reasons in.
 *
 * @module backend/logging/structured_logger
 */

import { formatTaipeiIso } from '../time/clock.js';

/** Log severity. `CRITICAL_SECURITY_ALERT` is reserved for TASK-159. */
export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL_SECURITY_ALERT';

/** Stable event names, so a metric filter never depends on message wording. */
export type LogEvent =
  /** A guarded transition was rejected and the execution terminated. */
  | 'fencing.intercepted'
  /** A staged recovery transition was applied. */
  | 'recovery.transition'
  /** A recovery mode was selected from RecoveryGateFn output. */
  | 'recovery.mode_selected'
  /** A start or recovery lease was taken. */
  | 'lease.acquired'
  /** A lease was released or expired. */
  | 'lease.released'
  /** A decision execution reached a terminal state. */
  | 'audit.decision_execution'
  /** Generic diagnostic. */
  | 'diagnostic';

/** Correlation fields carried by every line. */
export interface LogCorrelation {
  /** Required: without it a line cannot be tied to its request/execution. */
  readonly trace_id: string;
  readonly decision_id?: string;
  readonly idempotency_key?: string;
  readonly attempt_count?: number;
  readonly workflow_execution_arn?: string;
}

/** A fully-formed log line. */
export interface StructuredLogRecord extends LogCorrelation {
  readonly level: LogLevel;
  readonly event: LogEvent;
  readonly message: string;
  /** ISO-8601 with `+08:00`. */
  readonly timestamp: string;
  readonly [key: string]: unknown;
}

/** Sink for emitted lines. Defaults to `console`, replaced in tests. */
export interface LogSink {
  write(level: LogLevel, record: StructuredLogRecord): void;
}

/**
 * Attribute names whose values are replaced with `[REDACTED]`.
 *
 * Matched case-insensitively on a substring, so `awsSecretAccessKey`,
 * `authorization_header` and `X-Api-Token` are all covered.
 */
const REDACTED_KEY_FRAGMENTS: readonly string[] = [
  'password',
  'secret',
  'token',
  'credential',
  'authorization',
  'apikey',
  'api_key',
  'accesskey',
  'access_key',
  'sessiontoken',
  'session_token',
  'privatekey',
  'private_key',
  'cookie',
];

/** Placeholder written in place of a redacted value. */
export const REDACTED = '[REDACTED]' as const;

/**
 * Field names a caller's `context` may never set.
 *
 * `log()` used to spread the context LAST, so any of these could be overwritten
 * from outside. The consequence was not cosmetic: `sink.write(level, ...)` still
 * received the true level, so a `CRITICAL_SECURITY_ALERT` went to stderr as
 * expected — but the JSON carried whatever the caller passed. Member 3's metric
 * filter matches on the FIELD (`{ $.level = "CRITICAL_SECURITY_ALERT" }`), so the
 * alarm would silently never fire while everything looked healthy.
 *
 * The correlation keys are included for the same reason: an overwritten
 * `trace_id` or `decision_id` breaks the very correlation §19 requires, and it
 * breaks it quietly.
 */
export const RESERVED_LOG_KEYS: ReadonlySet<string> = new Set([
  'level',
  'event',
  'message',
  'timestamp',
  'trace_id',
  'decision_id',
  'idempotency_key',
  'attempt_count',
  'workflow_execution_arn',
]);

function shouldRedact(key: string): boolean {
  const normalized = key.toLowerCase();
  return REDACTED_KEY_FRAGMENTS.some((fragment) => normalized.includes(fragment));
}

/**
 * Recursively redact credential-like values.
 *
 * Cycles are tolerated (an AWS SDK error can reference its own request), and the
 * depth is bounded so a pathological object cannot hang the logger.
 */
export function redactSensitive(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (depth > 6) return '[TRUNCATED]';
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[CIRCULAR]';
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => redactSensitive(item, depth + 1, seen));
  }

  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    out[key] = shouldRedact(key) ? REDACTED : redactSensitive(nested, depth + 1, seen);
  }
  return out;
}

/** Console-backed sink. Uses the stream matching the severity. */
export const consoleLogSink: LogSink = {
  write(level, record) {
    const line = JSON.stringify(record);
    if (level === 'ERROR' || level === 'CRITICAL_SECURITY_ALERT') {
      console.error(line);
    } else if (level === 'WARN') {
      console.warn(line);
    } else {
      console.log(line);
    }
  },
};

/** Construction options. */
export interface StructuredLoggerOptions {
  /** Correlation fields applied to every line from this instance. */
  readonly correlation: LogCorrelation;
  /** Injected clock, so tests assert exact timestamps. */
  readonly now?: () => number;
  readonly sink?: LogSink;
}

/** A logger bound to one request/execution's correlation context. */
export class StructuredLogger {
  private readonly correlation: LogCorrelation;
  private readonly now: () => number;
  private readonly sink: LogSink;

  constructor(options: StructuredLoggerOptions) {
    if (!options.correlation.trace_id) {
      throw new Error('StructuredLogger requires a non-empty "trace_id".');
    }
    this.correlation = options.correlation;
    this.now = options.now ?? Date.now;
    this.sink = options.sink ?? consoleLogSink;
  }

  /** Derive a logger with extra correlation fields (e.g. once `decision_id` is known). */
  withCorrelation(extra: Partial<LogCorrelation>): StructuredLogger {
    return new StructuredLogger({
      correlation: { ...this.correlation, ...extra },
      now: this.now,
      sink: this.sink,
    });
  }

  /**
   * Emit one line.
   *
   * Context is redacted (§17) and then stripped of {@link RESERVED_LOG_KEYS}, so a
   * caller cannot overwrite the severity, the event discriminator or the
   * correlation ids that alarms and Insights queries bind to.
   *
   * A dropped key is reported in `reserved_context_keys_dropped` rather than being
   * discarded silently — a caller colliding with a reserved name is a bug worth
   * seeing, and it is exactly the kind of bug that otherwise surfaces as "the
   * alarm never fired".
   *
   * The authoritative fields are also spread LAST. The filter alone would be
   * enough; the ordering means a future hole in the filter still cannot corrupt
   * them.
   */
  log(
    level: LogLevel,
    event: LogEvent,
    message: string,
    context: Record<string, unknown> = {},
  ): StructuredLogRecord {
    const redacted = redactSensitive(context) as Record<string, unknown>;

    const safeContext: Record<string, unknown> = {};
    const dropped: string[] = [];
    for (const [key, value] of Object.entries(redacted)) {
      if (RESERVED_LOG_KEYS.has(key)) {
        dropped.push(key);
        continue;
      }
      safeContext[key] = value;
    }

    const record: StructuredLogRecord = {
      ...safeContext,
      ...(dropped.length > 0 ? { reserved_context_keys_dropped: dropped } : {}),
      level,
      event,
      // NOT passed through message redaction: CloudWatch Logs is the internal
      // diagnostic channel, and `map_error.ts` deliberately keeps the unredacted
      // cause for exactly this line. Stripping table names here would remove the
      // only place an operator can see them. Credential-shaped VALUES are already
      // handled by `redactSensitive`.
      message,
      timestamp: formatTaipeiIso(this.now()),
      ...this.correlation,
    };
    this.sink.write(level, record);
    return record;
  }

  info(event: LogEvent, message: string, context?: Record<string, unknown>): StructuredLogRecord {
    return this.log('INFO', event, message, context);
  }

  warn(event: LogEvent, message: string, context?: Record<string, unknown>): StructuredLogRecord {
    return this.log('WARN', event, message, context);
  }

  error(event: LogEvent, message: string, context?: Record<string, unknown>): StructuredLogRecord {
    return this.log('ERROR', event, message, context);
  }

  // ─── Domain-specific helpers ─────────────────────────────

  /**
   * A guarded transition was rejected and this execution stopped (TASK-095).
   *
   * `WARN`, not `ERROR`: fencing working is the system behaving correctly under
   * concurrency. Only an unexpected VOLUME of it is a problem, which is why
   * TASK-159 watches the rate rather than the individual line.
   */
  fencingIntercepted(input: {
    readonly action: string;
    readonly reason: string;
    readonly detail: string;
    readonly observedExecutionArn?: string | null;
    readonly observedAttemptCount?: number | null;
  }): StructuredLogRecord {
    return this.warn('fencing.intercepted', `Fenced ${input.action}: ${input.reason}`, {
      action: input.action,
      fenced_reason: input.reason,
      fenced_detail: input.detail,
      observed_execution_arn: input.observedExecutionArn ?? null,
      observed_attempt_count: input.observedAttemptCount ?? null,
    });
  }

  /** A staged recovery transition was applied (TASK-094). */
  recoveryTransition(input: {
    readonly fromStatus: string;
    readonly toStatus: string;
    readonly recoveryMode: string;
    readonly recoveryStage: string;
    readonly previousLastError: string | null;
  }): StructuredLogRecord {
    return this.info(
      'recovery.transition',
      `Recovery ${input.fromStatus} → ${input.toStatus} (${input.recoveryMode})`,
      {
        from_status: input.fromStatus,
        to_status: input.toStatus,
        recovery_mode: input.recoveryMode,
        recovery_stage: input.recoveryStage,
        previous_last_error: input.previousLastError,
      },
    );
  }

  /** A recovery mode was selected from RecoveryGateFn output (TASK-093). */
  recoveryModeSelected(input: {
    readonly recommendedRecoveryMode: string;
    readonly effectiveCoreCommitted: boolean;
    readonly coreExists: boolean;
    readonly missingNarrativeTypes: readonly string[];
  }): StructuredLogRecord {
    return this.info(
      'recovery.mode_selected',
      `RecoveryGate recommends ${input.recommendedRecoveryMode}`,
      {
        recommended_recovery_mode: input.recommendedRecoveryMode,
        effective_core_committed: input.effectiveCoreCommitted,
        core_exists: input.coreExists,
        missing_narrative_types: input.missingNarrativeTypes,
      },
    );
  }

  /** A start or recovery lease was taken (TASK-086 / TASK-094). */
  leaseAcquired(input: {
    readonly leaseOwner: string;
    readonly leaseExpiresAt: number;
    readonly recoveryMode: string;
    readonly isRecovery: boolean;
  }): StructuredLogRecord {
    return this.info('lease.acquired', `Lease acquired by ${input.leaseOwner}`, {
      lease_owner: input.leaseOwner,
      lease_expires_at: input.leaseExpiresAt,
      recovery_mode: input.recoveryMode,
      is_recovery: input.isRecovery,
    });
  }

  /** A lease was released or expired. */
  leaseReleased(input: { readonly reason: string; readonly status: string }): StructuredLogRecord {
    return this.info('lease.released', `Lease released: ${input.reason}`, {
      release_reason: input.reason,
      status: input.status,
    });
  }

  /**
   * Audit line for a terminal decision execution.
   *
   * `workflow_execution_name` is traceability only — it never provides dedup or
   * recovery, which is `idempotency_key`'s job (§15.2).
   */
  decisionExecutionAudit(input: {
    readonly status: string;
    readonly coreWriteStatus?: string;
    readonly workflowExecutionName?: string | null;
    readonly sourceManifestHash?: string | null;
    readonly coreHash?: string | null;
  }): StructuredLogRecord {
    return this.info('audit.decision_execution', `Decision execution ${input.status}`, {
      status: input.status,
      core_write_status: input.coreWriteStatus ?? null,
      workflow_execution_name: input.workflowExecutionName ?? null,
      source_manifest_hash: input.sourceManifestHash ?? null,
      core_hash: input.coreHash ?? null,
    });
  }
}
