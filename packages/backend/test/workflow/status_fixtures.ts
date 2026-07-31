/**
 * Shared fixtures for the WorkflowStatusFn action tests (TASK-089/090/091/102).
 */

import { vi } from 'vitest';
import { IdempotencyStatus, RecoveryMode, RecoveryStage } from '@city-commander/shared-schemas';
import type { IdempotencyRecord } from '@city-commander/shared-schemas';
import type {
  ConditionalUpdateStateInput,
  IdempotencyStateStore,
  WorkflowStatusInput,
} from '../../src/index.js';

export const KEY = 'TPE_2026_ACC_001|2026-05-20 22:10|prov-2026a';
export const DECISION = 'DEC_TPE_2026_ACC_001_abcdef123456';
export const EXEC = 'arn:aws:states:::execution:city-commander:exec-1';
export const OTHER_EXEC = 'arn:aws:states:::execution:city-commander:exec-2';
export const NOW_MS = 1_800_000_000_000;
export const NOW_DISPLAY = '2026-05-20 22:11';

/**
 * Intersection, not `extends`: the fake stays assignable to the real port while
 * exposing the vi.fn() mock surface.
 */
export type FakeStore = IdempotencyStateStore & {
  readonly conditionalUpdateState: ReturnType<typeof vi.fn>;
  readonly getConsistent: ReturnType<typeof vi.fn>;
};

export function createStore(): FakeStore {
  return {
    conditionalUpdateState: vi.fn(),
    getConsistent: vi.fn(),
  } as unknown as FakeStore;
}

export function record(overrides: Partial<IdempotencyRecord> = {}): IdempotencyRecord {
  return {
    idempotency_key: KEY,
    decision_id: DECISION,
    status: IdempotencyStatus.running,
    attempt_count: 1,
    lease_owner: 'req-aaa',
    lease_expires_at: NOW_MS + 30_000,
    last_error: null,
    retryable: true,
    workflow_execution_arn: EXEC,
    running_started_at: NOW_MS,
    running_deadline_at: NOW_MS + 60_000,
    completed_execution_arn: null,
    completed_attempt_count: null,
    last_transition_execution_arn: EXEC,
    last_transition_attempt_count: 1,
    evidence_source: null,
    core_committed: false,
    recovery_stage: RecoveryStage.NONE,
    recovery_mode: RecoveryMode.NORMAL,
    previous_last_error: null,
    created_at: '2026-05-20 22:10',
    updated_at: NOW_DISPLAY,
    expires_at: 1_800_086_400,
    ...overrides,
  };
}

export const statusInput: WorkflowStatusInput = {
  idempotencyKey: KEY,
  decisionId: DECISION,
  attemptCount: 1,
  leaseOwner: 'req-aaa',
  recoveryMode: RecoveryMode.NORMAL,
};

export const statusContext = {
  executionArn: EXEC,
  nowEpochMs: NOW_MS,
  nowDisplay: NOW_DISPLAY,
};

/** The update request an action handed to the store. */
export function updateOf(store: FakeStore): ConditionalUpdateStateInput {
  return store.conditionalUpdateState.mock.calls[0][0] as ConditionalUpdateStateInput;
}
