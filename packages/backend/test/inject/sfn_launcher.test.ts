/**
 * TASK-087 — Step Functions launcher unit tests.
 *
 * The name derivation gets the most coverage here, because it is the part that
 * fails silently in the worst way: a name AWS rejects turns every injection into
 * a 503, and a name that ignores `attempt_count` makes recovery impossible while
 * looking perfectly correct in code review.
 *
 * The other two axes:
 *  - the payload must carry exactly the four fields MARK_RUNNING fences on;
 *  - an unset ARN and an AWS fault must both leave the record in `start_failed`,
 *    so `recoverFromStartFailed` (TASK-094) can re-lease it.
 */

import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import {
  ExecutionAlreadyExists,
  InvalidArn,
  StateMachineDoesNotExist,
  type SFNClient,
} from '@aws-sdk/client-sfn';
import { IdempotencyStatus, RecoveryMode, RecoveryStage } from '@city-commander/shared-schemas';
import {
  MAX_EXECUTION_NAME_LENGTH,
  NoopTelemetry,
  STATE_MACHINE_ARN_KEY,
  SfnLauncher,
  SfnLauncherUsageError,
  WorkflowStartFailedError,
  buildExecutionPayload,
  deriveExecutionName,
  resolveStateMachineArn,
  type ConfigReader,
  type ConditionalUpdateStateInput,
  type IdempotencyRepository,
  type Telemetry,
  type WorkflowLaunchInput,
} from '../../src/index.js';

const ARN = 'arn:aws:states:ap-northeast-1:123456789012:stateMachine:DecisionWorkflow';
const KEY = 'TPE_2026_ACC_001|2026-05-20 22:10|prov-2026a';
const DECISION = 'DEC_TPE_2026_ACC_001_abcdef123456';
const NOW_MS = 1_800_000_000_000;
const NOW_DISPLAY = '2026-05-20 22:10';

const LEGAL_NAME = /^[a-zA-Z0-9_-]{1,80}$/;

function configWith(values: Record<string, string>): ConfigReader {
  return {
    get: (key: string) => {
      if (!(key in values)) {
        // Mirrors ConfigProvider: an unset optional key throws.
        throw Object.assign(new Error(`Config key "${key}" is missing.`), {
          name: 'ConfigKeyMissingError',
        });
      }
      return values[key] as string;
    },
  };
}

interface FakeRepository {
  readonly repository: IdempotencyRepository;
  readonly updates: ConditionalUpdateStateInput[];
  failWith: Error | null;
}

function fakeRepository(): FakeRepository {
  const updates: ConditionalUpdateStateInput[] = [];
  const state: FakeRepository = {
    updates,
    failWith: null,
    repository: {
      conditionalUpdateState: async (input: ConditionalUpdateStateInput) => {
        updates.push(input);
        if (state.failWith !== null) throw state.failWith;
        return {} as never;
      },
    } as unknown as IdempotencyRepository,
  };
  return state;
}

interface FakeSfn {
  readonly client: SFNClient;
  readonly sent: { stateMachineArn?: string; name?: string; input?: string }[];
  respondWith: { executionArn?: string } | null;
  throwWith: Error | null;
}

function fakeSfn(): FakeSfn {
  const sent: FakeSfn['sent'] = [];
  const state: FakeSfn = {
    sent,
    respondWith: { executionArn: `${ARN.replace('stateMachine', 'execution')}:exec-1` },
    throwWith: null,
    client: {
      send: async (command: { input: Record<string, unknown> }) => {
        sent.push(command.input as FakeSfn['sent'][number]);
        if (state.throwWith !== null) throw state.throwWith;
        return state.respondWith;
      },
    } as unknown as SFNClient,
  };
  return state;
}

function launchInput(overrides: Partial<WorkflowLaunchInput> = {}): WorkflowLaunchInput {
  return {
    idempotencyKey: KEY,
    decisionId: DECISION,
    attemptCount: 1,
    leaseOwner: 'req-1',
    recoveryMode: RecoveryMode.NORMAL,
    requestTimestamp: NOW_DISPLAY,
    ...overrides,
  };
}

function newLauncher(
  overrides: {
    readonly config?: ConfigReader;
    readonly sfn?: FakeSfn;
    readonly repo?: FakeRepository;
    readonly onStatusWriteError?: (error: unknown) => void;
    readonly telemetry?: Telemetry;
  } = {},
): { launcher: SfnLauncher; sfn: FakeSfn; repo: FakeRepository } {
  const sfn = overrides.sfn ?? fakeSfn();
  const repo = overrides.repo ?? fakeRepository();
  const launcher = new SfnLauncher({
    config: overrides.config ?? configWith({ [STATE_MACHINE_ARN_KEY]: ARN }),
    sfnClient: sfn.client,
    repository: repo.repository,
    nowDisplay: NOW_DISPLAY,
    nowEpochMs: NOW_MS,
    ...(overrides.onStatusWriteError === undefined
      ? {}
      : { onStatusWriteError: overrides.onStatusWriteError }),
    ...(overrides.telemetry === undefined ? {} : { telemetry: overrides.telemetry }),
  });
  return { launcher, sfn, repo };
}

// ─── Execution name derivation ─────────────────────────────

describe('deriveExecutionName', () => {
  it('produces an AWS-legal name from a key full of forbidden characters', () => {
    const name = deriveExecutionName(KEY, 1);

    // The raw key contains '|', ' ' and ':', all rejected by StartExecution.
    expect(name).toMatch(LEGAL_NAME);
    expect(name).not.toContain('|');
    expect(name).not.toContain(' ');
    expect(name).not.toContain(':');
  });

  it('is deterministic for the same key and attempt', () => {
    expect(deriveExecutionName(KEY, 1)).toBe(deriveExecutionName(KEY, 1));
  });

  it('changes with the attempt so recovery always gets a fresh execution', () => {
    // The whole point: a name derived from the key alone would raise
    // ExecutionAlreadyExistsException on every recovery, forever.
    expect(deriveExecutionName(KEY, 2)).not.toBe(deriveExecutionName(KEY, 1));
    expect(deriveExecutionName(KEY, 3)).not.toBe(deriveExecutionName(KEY, 2));
  });

  it('embeds the attempt literally, so the console is readable', () => {
    expect(deriveExecutionName(KEY, 7)).toContain('-a7-');
  });

  it('differs for different keys at the same attempt', () => {
    expect(deriveExecutionName(KEY, 1)).not.toBe(
      deriveExecutionName('TPE_2026_ACC_002|2026-05-20 22:10|prov-2026a', 1),
    );
  });

  it('binds the digest to the full key and attempt', () => {
    const expected = createHash('sha256').update(`${KEY}#1`).digest('hex').slice(0, 16);

    expect(deriveExecutionName(KEY, 1).endsWith(`-a1-${expected}`)).toBe(true);
  });

  it('keeps a recognisable prefix', () => {
    expect(deriveExecutionName(KEY, 1).startsWith('dec-')).toBe(true);
  });

  it('stays within the 80 character limit for a very long key', () => {
    const longKey = `${'E'.repeat(200)}|2026-05-20 22:10|prov-2026a`;

    const name = deriveExecutionName(longKey, 1);

    expect(name.length).toBeLessThanOrEqual(MAX_EXECUTION_NAME_LENGTH);
    expect(name).toMatch(LEGAL_NAME);
  });

  it('stays unique across long keys that share a truncated prefix', () => {
    const shared = 'E'.repeat(200);
    const first = deriveExecutionName(`${shared}|2026-05-20 22:10|A`, 1);
    const second = deriveExecutionName(`${shared}|2026-05-20 22:10|B`, 1);

    // Truncation must not be able to collapse two distinct keys onto one name.
    expect(first).not.toBe(second);
    expect(first.length).toBeLessThanOrEqual(MAX_EXECUTION_NAME_LENGTH);
  });

  it('handles a key made entirely of forbidden characters', () => {
    const name = deriveExecutionName('|||   :::|||', 4);

    expect(name).toMatch(LEGAL_NAME);
    expect(name).toContain('-a4-');
  });

  it('collapses runs of substituted characters instead of emitting __ chains', () => {
    expect(deriveExecutionName('a||||b', 1)).toContain('dec-a_b-a1-');
  });

  it('stays legal for a high attempt count', () => {
    const name = deriveExecutionName(KEY, 999_999);

    expect(name).toMatch(LEGAL_NAME);
    expect(name.length).toBeLessThanOrEqual(MAX_EXECUTION_NAME_LENGTH);
  });

  it('rejects an empty key', () => {
    expect(() => deriveExecutionName('', 1)).toThrow(SfnLauncherUsageError);
  });

  it('rejects a non-positive or fractional attempt', () => {
    expect(() => deriveExecutionName(KEY, 0)).toThrow(SfnLauncherUsageError);
    expect(() => deriveExecutionName(KEY, -1)).toThrow(SfnLauncherUsageError);
    expect(() => deriveExecutionName(KEY, 1.5)).toThrow(SfnLauncherUsageError);
  });
});

// ─── ARN resolution ────────────────────────────────────────

describe('resolveStateMachineArn', () => {
  it('returns the configured ARN', () => {
    expect(resolveStateMachineArn(configWith({ [STATE_MACHINE_ARN_KEY]: ARN }))).toBe(ARN);
  });

  it('trims surrounding whitespace from a YAML value', () => {
    expect(resolveStateMachineArn(configWith({ [STATE_MACHINE_ARN_KEY]: `  ${ARN}  ` }))).toBe(ARN);
  });

  it('reports an unset key as null rather than throwing', () => {
    expect(resolveStateMachineArn(configWith({}))).toBeNull();
  });

  it('reports a blank value as null', () => {
    expect(resolveStateMachineArn(configWith({ [STATE_MACHINE_ARN_KEY]: '   ' }))).toBeNull();
  });

  it('reports a non-string value as null', () => {
    expect(resolveStateMachineArn({ get: () => 42 })).toBeNull();
  });
});

// ─── Payload ───────────────────────────────────────────────

describe('buildExecutionPayload', () => {
  it('carries exactly the six documented INPUT fields', () => {
    expect(buildExecutionPayload(launchInput())).toEqual({
      idempotency_key: KEY,
      decision_id: DECISION,
      attempt_count: 1,
      lease_owner: 'req-1',
      recovery_mode: RecoveryMode.NORMAL,
      request_timestamp: NOW_DISPLAY,
    });
  });

  it('includes every term MARK_RUNNING fences on', () => {
    const payload = buildExecutionPayload(launchInput());

    // MARK_RUNNING guards on status + lease_owner + attempt_count + recovery_mode.
    // `status` is read from the table; the other three must arrive as INPUT or the
    // guard cannot be built at all.
    expect(payload.lease_owner).toBe('req-1');
    expect(payload.attempt_count).toBe(1);
    expect(payload.recovery_mode).toBe(RecoveryMode.NORMAL);
  });

  it('does not invent a fencing token', () => {
    // This design has no fencing token: the ARN half of the fencing pair is
    // stamped by MARK_RUNNING from $$.Execution.Id, never passed in.
    expect(buildExecutionPayload(launchInput())).not.toHaveProperty('fencing_token');
    expect(buildExecutionPayload(launchInput())).not.toHaveProperty('workflow_execution_arn');
  });

  it('propagates the recovery mode chosen by staged recovery', () => {
    expect(
      buildExecutionPayload(launchInput({ recoveryMode: RecoveryMode.ENRICHMENT_ONLY })),
    ).toMatchObject({ recovery_mode: RecoveryMode.ENRICHMENT_ONLY });
  });
});

// ─── Successful launch ─────────────────────────────────────

describe('launch — success', () => {
  it('starts the execution and reports the ARN AWS returned', async () => {
    const { launcher, sfn } = newLauncher();

    const result = await launcher.launch(launchInput());

    expect(result.outcome).toBe('STARTED');
    expect(result.executionArn).toBe(sfn.respondWith?.executionArn);
  });

  it('sends the configured ARN and the derived name', async () => {
    const { launcher, sfn } = newLauncher();

    await launcher.launch(launchInput());

    expect(sfn.sent).toHaveLength(1);
    expect(sfn.sent[0]?.stateMachineArn).toBe(ARN);
    expect(sfn.sent[0]?.name).toBe(deriveExecutionName(KEY, 1));
  });

  it('sends the payload as JSON matching the ASL contract', async () => {
    const { launcher, sfn } = newLauncher();

    await launcher.launch(launchInput());

    expect(JSON.parse(sfn.sent[0]?.input ?? '{}')).toEqual({
      idempotency_key: KEY,
      decision_id: DECISION,
      attempt_count: 1,
      lease_owner: 'req-1',
      recovery_mode: RecoveryMode.NORMAL,
      request_timestamp: NOW_DISPLAY,
    });
  });

  it('writes nothing to the idempotency table on success', async () => {
    const { launcher, repo } = newLauncher();

    await launcher.launch(launchInput());

    // MARK_RUNNING owns the starting → running transition (PATCH 2).
    expect(repo.updates).toEqual([]);
  });

  it('uses a fresh name for a recovery attempt', async () => {
    const { launcher, sfn } = newLauncher();

    await launcher.launch(
      launchInput({ attemptCount: 2, recoveryMode: RecoveryMode.FULL_WORKFLOW }),
    );

    expect(sfn.sent[0]?.name).toBe(deriveExecutionName(KEY, 2));
  });
});

// ─── ExecutionAlreadyExists is success ─────────────────────

describe('launch — ExecutionAlreadyExistsException', () => {
  function alreadyExists(): ExecutionAlreadyExists {
    return new ExecutionAlreadyExists({ $metadata: {}, message: 'already exists' });
  }

  it('reports ALREADY_STARTED instead of failing', async () => {
    const sfn = fakeSfn();
    sfn.throwWith = alreadyExists();
    const { launcher } = newLauncher({ sfn });

    const result = await launcher.launch(launchInput());

    // A retried InjectFn invocation for the same key AND attempt. The workflow is
    // already running; this is the at-least-once safe outcome, mapped to 202.
    expect(result.outcome).toBe('ALREADY_STARTED');
  });

  it('does not mark start_failed', async () => {
    const sfn = fakeSfn();
    sfn.throwWith = alreadyExists();
    const { launcher, repo } = newLauncher({ sfn });

    await launcher.launch(launchInput());

    // Marking start_failed here would sabotage a healthy running execution.
    expect(repo.updates).toEqual([]);
  });

  it('records the 202 path as an in-flight re-request (TASK-158)', async () => {
    const sfn = fakeSfn();
    sfn.throwWith = alreadyExists();
    const conflicts: unknown[][] = [];
    const { launcher } = newLauncher({
      sfn,
      telemetry: {
        ...new NoopTelemetry(),
        recordConflict: (...args: unknown[]) => void conflicts.push(args),
      } as unknown as Telemetry,
    });

    await launcher.launch(launchInput());

    expect(conflicts).toEqual([
      ['IN_FLIGHT_REQUEST', { decisionId: DECISION, idempotencyKey: KEY, attemptCount: 1 }],
    ]);
  });

  it('returns a null ARN rather than inventing one', async () => {
    const sfn = fakeSfn();
    sfn.throwWith = alreadyExists();
    const { launcher } = newLauncher({ sfn });

    const result = await launcher.launch(launchInput());

    // AWS gives no ARN for this case (§21 — never fabricate an identifier).
    expect(result.executionArn).toBeNull();
    expect(result.executionName).toBe(deriveExecutionName(KEY, 1));
  });
});

// ─── Missing ARN → controlled 503 ──────────────────────────

describe('launch — state machine ARN not configured', () => {
  it('throws WorkflowStartFailedError rather than crashing', async () => {
    const { launcher } = newLauncher({ config: configWith({}) });

    await expect(launcher.launch(launchInput())).rejects.toBeInstanceOf(WorkflowStartFailedError);
  });

  it('maps to 503 with a retryable envelope', async () => {
    const { launcher } = newLauncher({ config: configWith({}) });

    const error = await launcher.launch(launchInput()).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(WorkflowStartFailedError);
    const domainError = error as WorkflowStartFailedError;
    expect(domainError.httpStatus).toBe(503);
    expect(domainError.retryable).toBe(true);
  });

  it('names the missing config key in the message', async () => {
    const { launcher } = newLauncher({ config: configWith({}) });

    const error = await launcher.launch(launchInput()).catch((caught: unknown) => caught);

    expect((error as Error).message).toContain(STATE_MACHINE_ARN_KEY);
  });

  it('never calls StartExecution', async () => {
    const { launcher, sfn } = newLauncher({ config: configWith({}) });

    await launcher.launch(launchInput()).catch(() => undefined);

    expect(sfn.sent).toEqual([]);
  });

  it('records start_failed as non-retryable, since retrying cannot help', async () => {
    const { launcher, repo } = newLauncher({ config: configWith({}) });

    await launcher.launch(launchInput()).catch(() => undefined);

    expect(repo.updates).toHaveLength(1);
    expect(repo.updates[0]?.mutation.set).toMatchObject({
      status: IdempotencyStatus.start_failed,
      last_error: 'STATE_MACHINE_ARN_NOT_CONFIGURED',
      retryable: false,
    });
  });

  it('treats a blank ARN the same as an unset one', async () => {
    const { launcher, sfn } = newLauncher({
      config: configWith({ [STATE_MACHINE_ARN_KEY]: '   ' }),
    });

    await expect(launcher.launch(launchInput())).rejects.toBeInstanceOf(WorkflowStartFailedError);
    expect(sfn.sent).toEqual([]);
  });
});

// ─── AWS faults → start_failed ─────────────────────────────

describe('launch — StartExecution failure', () => {
  it('marks start_failed and surfaces a 503', async () => {
    const sfn = fakeSfn();
    sfn.throwWith = Object.assign(new Error('Rate exceeded'), { name: 'ThrottlingException' });
    const { launcher, repo } = newLauncher({ sfn });

    await expect(launcher.launch(launchInput())).rejects.toBeInstanceOf(WorkflowStartFailedError);
    expect(repo.updates[0]?.mutation.set).toMatchObject({
      status: IdempotencyStatus.start_failed,
    });
  });

  it('guards the transition on status, lease_owner and attempt_count', async () => {
    const sfn = fakeSfn();
    sfn.throwWith = Object.assign(new Error('Rate exceeded'), { name: 'ThrottlingException' });
    const { launcher, repo } = newLauncher({ sfn });

    await launcher.launch(launchInput()).catch(() => undefined);

    // Without the guard a late write could clobber a newer attempt's record.
    expect(repo.updates[0]?.guard).toEqual({
      status: IdempotencyStatus.starting,
      lease_owner: 'req-1',
      attempt_count: 1,
    });
  });

  it('marks a throttled start as retryable', async () => {
    const sfn = fakeSfn();
    sfn.throwWith = Object.assign(new Error('Rate exceeded'), { name: 'ThrottlingException' });
    const { launcher, repo } = newLauncher({ sfn });

    await launcher.launch(launchInput()).catch(() => undefined);

    expect(repo.updates[0]?.mutation.set).toMatchObject({ retryable: true });
  });

  it('records a throttled start as a ThrottlingEvent (TASK-158)', async () => {
    const sfn = fakeSfn();
    sfn.throwWith = Object.assign(new Error('Rate exceeded'), { name: 'ThrottlingException' });
    const throttles: unknown[][] = [];
    const { launcher } = newLauncher({
      sfn,
      telemetry: {
        ...new NoopTelemetry(),
        recordThrottling: (...args: unknown[]) => void throttles.push(args),
      } as unknown as Telemetry,
    });

    await launcher.launch(launchInput()).catch(() => undefined);

    expect(throttles).toEqual([
      ['STEP_FUNCTIONS', { decisionId: DECISION, idempotencyKey: KEY, attemptNumber: 1 }],
    ]);
  });

  it('does not record throttling for a bad ARN', async () => {
    const sfn = fakeSfn();
    sfn.throwWith = new InvalidArn({ $metadata: {}, message: 'Invalid ARN' });
    const throttles: unknown[][] = [];
    const { launcher } = newLauncher({
      sfn,
      telemetry: {
        ...new NoopTelemetry(),
        recordThrottling: (...args: unknown[]) => void throttles.push(args),
      } as unknown as Telemetry,
    });

    await launcher.launch(launchInput()).catch(() => undefined);

    // A configuration fault is not a capacity problem.
    expect(throttles).toEqual([]);
  });

  it('does not fail the launch when telemetry throws', async () => {
    const sfn = fakeSfn();
    sfn.throwWith = Object.assign(new Error('Rate exceeded'), { name: 'ThrottlingException' });
    const { launcher } = newLauncher({
      sfn,
      telemetry: {
        ...new NoopTelemetry(),
        recordThrottling: () => {
          throw new Error('metric pipeline down');
        },
      } as unknown as Telemetry,
    });

    // The caller must still learn why the start failed.
    await expect(launcher.launch(launchInput())).rejects.toBeInstanceOf(WorkflowStartFailedError);
  });

  it('marks a bad ARN as non-retryable', async () => {
    const sfn = fakeSfn();
    sfn.throwWith = new InvalidArn({ $metadata: {}, message: 'Invalid ARN' });
    const { launcher, repo } = newLauncher({ sfn });

    await launcher.launch(launchInput()).catch(() => undefined);

    // Retrying a malformed ARN forever would burn attempts for nothing.
    expect(repo.updates[0]?.mutation.set).toMatchObject({ retryable: false });
  });

  it('marks a missing state machine as non-retryable', async () => {
    const sfn = fakeSfn();
    sfn.throwWith = new StateMachineDoesNotExist({ $metadata: {}, message: 'gone' });
    const { launcher, repo } = newLauncher({ sfn });

    await launcher.launch(launchInput()).catch(() => undefined);

    expect(repo.updates[0]?.mutation.set).toMatchObject({ retryable: false });
  });

  it('records the AWS error name in last_error at bounded cardinality', async () => {
    const sfn = fakeSfn();
    sfn.throwWith = Object.assign(new Error('socket hang up'), { name: 'TimeoutError' });
    const { launcher, repo } = newLauncher({ sfn });

    await launcher.launch(launchInput()).catch(() => undefined);

    expect(repo.updates[0]?.mutation.set).toMatchObject({
      last_error: 'START_EXECUTION_FAILED:TimeoutError',
    });
  });

  it('releases the lease immediately so recovery need not wait for the TTL', async () => {
    const sfn = fakeSfn();
    sfn.throwWith = Object.assign(new Error('Rate exceeded'), { name: 'ThrottlingException' });
    const { launcher, repo } = newLauncher({ sfn });

    await launcher.launch(launchInput()).catch(() => undefined);

    expect(repo.updates[0]?.mutation.set).toMatchObject({
      lease_expires_at: NOW_MS,
      updated_at: NOW_DISPLAY,
    });
  });

  it('grades recovery as FULL_WORKFLOW, since the workflow never ran', async () => {
    const sfn = fakeSfn();
    sfn.throwWith = Object.assign(new Error('Rate exceeded'), { name: 'ThrottlingException' });
    const { launcher, repo } = newLauncher({ sfn });

    await launcher.launch(launchInput()).catch(() => undefined);

    // No execution started, so no DecisionCore can exist.
    expect(repo.updates[0]?.mutation.set).toMatchObject({
      recovery_stage: RecoveryStage.FULL_WORKFLOW,
    });
  });

  it('treats a success response without an ARN as a start failure', async () => {
    const sfn = fakeSfn();
    sfn.respondWith = {};
    const { launcher, repo } = newLauncher({ sfn });

    await expect(launcher.launch(launchInput())).rejects.toBeInstanceOf(WorkflowStartFailedError);
    expect(repo.updates[0]?.mutation.set).toMatchObject({
      last_error: 'START_EXECUTION_MISSING_ARN',
    });
  });

  it('reports the original AWS fault even when the status write also fails', async () => {
    const sfn = fakeSfn();
    sfn.throwWith = Object.assign(new Error('Rate exceeded'), { name: 'ThrottlingException' });
    const repo = fakeRepository();
    repo.failWith = new Error('conditional check failed');
    const onStatusWriteError = vi.fn();
    const { launcher } = newLauncher({ sfn, repo, onStatusWriteError });

    const error = await launcher.launch(launchInput()).catch((caught: unknown) => caught);

    // The caller must learn why the start failed, not why the bookkeeping failed.
    expect(error).toBeInstanceOf(WorkflowStartFailedError);
    expect(onStatusWriteError).toHaveBeenCalledTimes(1);
  });

  it('keeps the AWS fault as the cause for logging', async () => {
    const cause = Object.assign(new Error('Rate exceeded'), { name: 'ThrottlingException' });
    const sfn = fakeSfn();
    sfn.throwWith = cause;
    const { launcher } = newLauncher({ sfn });

    const error = await launcher.launch(launchInput()).catch((caught: unknown) => caught);

    expect((error as { cause?: unknown }).cause).toBe(cause);
  });
});

// ─── Usage errors ──────────────────────────────────────────

describe('launch — usage errors', () => {
  it('rejects a missing lease owner before touching AWS', async () => {
    const { launcher, sfn } = newLauncher();

    await expect(launcher.launch(launchInput({ leaseOwner: '' }))).rejects.toBeInstanceOf(
      SfnLauncherUsageError,
    );
    // An empty lease owner makes MARK_RUNNING unfenceable: a bug, not a 503.
    expect(sfn.sent).toEqual([]);
  });

  it('rejects a missing idempotency key', async () => {
    const { launcher } = newLauncher();

    await expect(launcher.launch(launchInput({ idempotencyKey: '' }))).rejects.toBeInstanceOf(
      SfnLauncherUsageError,
    );
  });

  it('rejects a missing decision id', async () => {
    const { launcher } = newLauncher();

    await expect(launcher.launch(launchInput({ decisionId: '' }))).rejects.toBeInstanceOf(
      SfnLauncherUsageError,
    );
  });

  it('does not mark start_failed for a usage error', async () => {
    const { launcher, repo } = newLauncher();

    await launcher.launch(launchInput({ leaseOwner: '' })).catch(() => undefined);

    expect(repo.updates).toEqual([]);
  });
});
