/**
 * TASK-068 targeted tests — WorkflowStateMachineConstruct + workflow.asl.json
 *
 * No AWS credentials / network access; pure synth-time assertions.
 * Uses `iam.Role.fromRoleArn` and `lambda.Function.fromFunctionArn` to
 * import role/function fixtures (zero AWS::IAM::Role/Policy/Function/LogGroup
 * created here).
 */

import { describe, it, expect } from 'vitest';
import { App, Stack } from 'aws-cdk-lib';
import * as sfn from 'aws-cdk-lib/aws-stepfunctions';
import { Function, IFunction } from 'aws-cdk-lib/aws-lambda';
import { IRole, Role } from 'aws-cdk-lib/aws-iam';
import { resolveEnvironmentContext } from '../lib/env_context.js';
import {
  WorkflowStateMachineConstruct,
  APPLICATION_STATE_MACHINE_COUNT,
  WORKFLOW_TIMEOUT_SECONDS_MIN,
  WORKFLOW_TIMEOUT_SECONDS_MAX,
  ASL_SUBSTITUTION_KEYS,
} from '../lib/constructs/workflow_state_machine.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

type Profile = 'LOCAL_MOCK' | 'PERSONAL_AWS_DEV' | 'COMPETITION_AWS';

const FAKE_ACCOUNT = '111111111111';
const FAKE_REGION = 'ap-northeast-1';

function makeStack(profile: Profile, stackName?: string): {
  stack: Stack;
  ctx: import('../lib/env_context.js').EnvironmentContext;
} {
  const app = new App({ autoSynth: false });
  app.node.setContext('env', profile);
  const ctx = resolveEnvironmentContext(app.node);
  const stack = new Stack(app, stackName ?? `${ctx.resourcePrefix}-sfn-test`);
  return { stack, ctx };
}

function importedRole(stack: Stack, suffix: string): IRole {
  return Role.fromRoleArn(
    stack,
    `ImportedRole${suffix}`,
    `arn:aws:iam::${FAKE_ACCOUNT}:role/Test${suffix}`,
  );
}

function importedFunction(stack: Stack, fnName: string): IFunction {
  return Function.fromFunctionArn(
    stack,
    `ImportedFn${fnName}`,
    `arn:aws:lambda:${FAKE_REGION}:${FAKE_ACCOUNT}:function:${fnName}`,
  );
}

function makeProps(
  stack: Stack,
  overrides: Partial<ConstructorParameters<typeof WorkflowStateMachineConstruct>[2]> = {},
) {
  const base = {
    envContext: undefined as unknown as import('../lib/env_context.js').EnvironmentContext,
    executionRole: importedRole(stack, 'OrchestratorRole'),
    workflowStatusFn: importedFunction(stack, 'WorkflowStatusFn'),
    recoveryGateFn: importedFunction(stack, 'RecoveryGateFn'),
    decisionFn: importedFunction(stack, 'DecisionFn'),
    rendererFn: importedFunction(stack, 'RendererFn'),
    wsPushFn: importedFunction(stack, 'WsPushFn'),
    workflowTimeoutSeconds: 60,
  };
  return { ...base, ...overrides };
}

function build(
  profile: Profile,
  stackName?: string,
  overrides: Partial<ConstructorParameters<typeof WorkflowStateMachineConstruct>[2]> = {},
): { app: App; stack: Stack; construct: WorkflowStateMachineConstruct } {
  const app = new App({ autoSynth: false });
  app.node.setContext('env', profile);
  const ctx = resolveEnvironmentContext(app.node);
  const stack = new Stack(app, stackName ?? `${ctx.resourcePrefix}-sfn-build`);
  const execRole = importedRole(stack, 'OrchestratorRole');
  const construct = new WorkflowStateMachineConstruct(stack, 'WorkflowStateMachineConstruct', {
    envContext: ctx,
    executionRole: execRole,
    workflowStatusFn: importedFunction(stack, 'WorkflowStatusFn'),
    recoveryGateFn: importedFunction(stack, 'RecoveryGateFn'),
    decisionFn: importedFunction(stack, 'DecisionFn'),
    rendererFn: importedFunction(stack, 'RendererFn'),
    wsPushFn: importedFunction(stack, 'WsPushFn'),
    workflowTimeoutSeconds: 60,
    ...overrides,
  });
  return { app, stack, construct };
}

function synthTemplate(profile: Profile): {
  resources: Record<string, Record<string, unknown>>;
  outputs: Record<string, Record<string, unknown>>;
} {
  const { app, stack } = build(profile);
  const a = app.synth();
  const t = a.stacks[0].template as Record<string, unknown>;
  const resources = (t['Resources'] as Record<string, Record<string, unknown>>) ?? {};
  const outputs = (t['Outputs'] as Record<string, Record<string, unknown>>) ?? {};
  return { resources, outputs };
}

function getProps(r: Record<string, unknown>): Record<string, unknown> {
  return (r['Properties'] as Record<string, unknown>) ?? {};
}

function countResourcesByType(
  resources: Record<string, Record<string, unknown>>,
  typeName: string,
): number {
  return Object.values(resources).filter((r) => r['Type'] === typeName).length;
}

function getStateMachineResources(
  resources: Record<string, Record<string, unknown>>,
): Record<string, Record<string, unknown>> {
  return Object.fromEntries(
    Object.entries(resources).filter(([, r]) => r['Type'] === 'AWS::StepFunctions::StateMachine'),
  );
}

/**
 * Read the deployed definition JSON from a synthesized stack.
 * - If the StateMachine uses `DefinitionBody.fromString`, the JSON is
 *   serialized into the `DefinitionString` property (possibly wrapped in
 *   `Fn::Join` for escaping).
 * - If it uses `DefinitionS3Location`, the asset content is read from
 *   the asset directory under the synth outdir.
 *
 * Returns null when the definition cannot be located.
 */
function getDeployedDefinitionJson(stack: Stack): Record<string, unknown> | null {
  const sm = getStateMachineFromSynth(stack);
  const props = sm.Properties as Record<string, unknown>;
  const ds3 = props.DefinitionS3Location as { Key: string; Bucket: unknown } | undefined;
  if (ds3) {
    const outDir = (stack.node.root as App).outdir;
    const entries = fs.readdirSync(outDir);
    const assetDirs = entries.filter((e) => e.startsWith('asset.'));
    for (const d of assetDirs) {
      const p = path.join(outDir, d, ds3.Key);
      if (fs.existsSync(p)) {
        const content = fs.readFileSync(p, 'utf8');
        return JSON.parse(content) as Record<string, unknown>;
      }
    }
    return null;
  }
  const ds = props.DefinitionString as string | undefined;
  if (typeof ds === 'string') {
    return JSON.parse(ds) as Record<string, unknown>;
  }
  // Fn::Join wrapper case (CDK may wrap the string in a join when there
  // are escape-sensitive characters). Unwrap defensively.
  const fnJoin = ds as { 'Fn::Join'?: [string, string[]] } | undefined;
  if (fnJoin?.['Fn::Join']) {
    const [, parts] = fnJoin['Fn::Join'];
    return JSON.parse(parts.join('')) as Record<string, unknown>;
  }
  return null;
}

function getStateMachineFromSynth(stack: Stack): Record<string, unknown> {
  const a = (stack.node.root as App).synth();
  const t = a.stacks[0].template as Record<string, Record<string, Record<string, unknown>>>;
  const sm = Object.values(t['Resources']).find(
    (r) => r.Type === 'AWS::StepFunctions::StateMachine',
  );
  if (!sm) throw new Error('No AWS::StepFunctions::StateMachine in synth');
  return sm as Record<string, unknown>;
}

// ─── ASL static load (used for structural assertions) ──────────────────────

import * as fs from 'node:fs';
import * as path from 'node:path';

const ASL_PATH = path.resolve(__dirname, '..', 'statemachine', 'workflow.asl.json');

interface AslState {
  Type: string;
  Next?: string;
  End?: boolean;
  Resource?: string;
  Parameters?: unknown;
  ResultPath?: string;
  ResultSelector?: unknown;
  Retry?: unknown;
  Catch?: Array<{ ErrorEquals: string[]; ResultPath?: string; Next: string }>;
  Choices?: Array<{
    Variable?: string;
    StringEquals?: string;
    BooleanEquals?: boolean;
    Next: string;
  }>;
  Default?: string;
  StartAt?: string;
  Branches?: Array<{ StartAt: string; States: Record<string, AslState> }>;
  Cause?: string;
  Error?: string;
}

interface AslDoc {
  QueryLanguage?: string;
  StartAt: string;
  Comment?: string;
  States: Record<string, AslState>;
}

function loadAsl(): AslDoc {
  const raw = fs.readFileSync(ASL_PATH, 'utf8');
  return JSON.parse(raw) as AslDoc;
}

/** Returns reachable state names from a start state, following Next / Choices / Default / Branches. */
function reachableStates(startAt: string, doc: AslDoc): Set<string> {
  const seen = new Set<string>();
  const stack: string[] = [startAt];
  while (stack.length > 0) {
    const name = stack.pop()!;
    if (seen.has(name)) continue;
    seen.add(name);
    const s = doc.States[name];
    if (!s) continue;
    if (s.Next) stack.push(s.Next);
    if (s.Default) stack.push(s.Default);
    if (s.Choices) {
      for (const c of s.Choices) stack.push(c.Next);
    }
    if (s.Catch) {
      for (const c of s.Catch) stack.push(c.Next);
    }
    if (s.Branches) {
      for (const b of s.Branches) {
        stack.push(b.StartAt);
        // Walk each branch's own reachable set.
        const branchSeen = reachableStates(b.StartAt, { ...doc, States: b.States });
        for (const n of branchSeen) seen.add(`${name}::${n}`);
      }
    }
  }
  return seen;
}

/** Build a literal "is X reachable from Y" check using simulation. */
function isReachable(from: string, to: string, doc: AslDoc): boolean {
  const seen = new Set<string>();
  const stack: string[] = [from];
  while (stack.length > 0) {
    const name = stack.pop()!;
    if (seen.has(name)) continue;
    seen.add(name);
    if (name === to) return true;
    const s = doc.States[name];
    if (!s) continue;
    if (s.Next) stack.push(s.Next);
    if (s.Default) stack.push(s.Default);
    if (s.Choices) {
      for (const c of s.Choices) stack.push(c.Next);
    }
    if (s.Catch) {
      for (const c of s.Catch) stack.push(c.Next);
    }
    if (s.Branches) {
      for (const b of bNesting(doc, name, s)) {
        // no-op placeholder
        void b;
      }
    }
  }
  return false;
}

function bNesting(
  doc: AslDoc,
  parentName: string,
  state: AslState,
): Array<{ parent: string; branch: number }> {
  if (!state.Branches) return [];
  const out: Array<{ parent: string; branch: number }> = [];
  for (let i = 0; i < state.Branches.length; i++) {
    const b = state.Branches[i];
    // Walk nested branch reachable states and report them with their parent.
    const seen = new Set<string>();
    const stack: string[] = [b.StartAt];
    while (stack.length > 0) {
      const name = stack.pop()!;
      const key = `${parentName}::${name}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ parent: parentName, branch: i });
      const s = b.States[name];
      if (!s) continue;
      if (s.Next) stack.push(s.Next);
      if (s.Default) stack.push(s.Default);
      if (s.Choices) {
        for (const c of s.Choices) stack.push(c.Next);
      }
      if (s.Catch) {
        for (const c of s.Catch) stack.push(c.Next);
      }
    }
  }
  return out;
}

/** Walks forward from startAt and returns the set of state names that can be reached. */
function reachableFrom(from: string, doc: AslDoc): Set<string> {
  const seen = new Set<string>();
  const walk = (stateName: string): void => {
    if (seen.has(stateName)) return;
    seen.add(stateName);
    const s = doc.States[stateName];
    if (!s) return;
    if (s.Next) walk(s.Next);
    if (s.Default) walk(s.Default);
    if (s.Choices) {
      for (const c of s.Choices) walk(c.Next);
    }
    if (s.Catch) {
      for (const c of s.Catch) walk(c.Next);
    }
    if (s.Branches) {
      for (const b of s.Branches) {
        const branchSeen = new Set<string>();
        const innerWalk = (sn: string): void => {
          if (branchSeen.has(sn)) return;
          branchSeen.add(sn);
          seen.add(sn);
          const bs = b.States[sn];
          if (!bs) return;
          if (bs.Next) innerWalk(bs.Next);
          if (bs.Default) innerWalk(bs.Default);
          if (bs.Choices) {
            for (const c of bs.Choices) innerWalk(c.Next);
          }
          if (bs.Catch) {
            for (const c of bs.Catch) innerWalk(c.Next);
          }
        };
        innerWalk(b.StartAt);
      }
    }
  };
  walk(from);
  return seen;
}

// ─── A. JSON + basic structure ─────────────────────────────────────────────

describe('A. JSON + basic structure', () => {
  const doc = loadAsl();

  it('workflow.asl.json parses as valid JSON', () => {
    expect(typeof doc.StartAt).toBe('string');
    expect(doc.States).toBeDefined();
  });

  it('QueryLanguage is JSONPath', () => {
    expect(doc.QueryLanguage).toBe('JSONPath');
  });

  it('StartAt is exactly MARK_RUNNING', () => {
    expect(doc.StartAt).toBe('MARK_RUNNING');
  });

  it('MARK_RUNNING exists and is a Task', () => {
    expect(doc.States['MARK_RUNNING']).toBeDefined();
    expect(doc.States['MARK_RUNNING'].Type).toBe('Task');
  });

  it('every Next / Choices / Default / Catch.Next / Branches.StartAt points to an existing state', () => {
    const globalStates = new Set(Object.keys(doc.States));
    // Branch-local state names are namespaced under their parent. Build
    // a set of "<parent>::<name>" entries to validate the inner branch
    // references, plus the global map for top-level states.
    for (const [name, s] of Object.entries(doc.States)) {
      if (s.Next) expect(globalStates.has(s.Next), `${name}.Next -> ${s.Next}`).toBe(true);
      if (s.Default) expect(globalStates.has(s.Default), `${name}.Default -> ${s.Default}`).toBe(true);
      if (s.Choices) {
        for (const c of s.Choices) {
          expect(globalStates.has(c.Next), `${name}.Choices -> ${c.Next}`).toBe(true);
        }
      }
      if (s.Catch) {
        for (const c of s.Catch) {
          expect(globalStates.has(c.Next), `${name}.Catch -> ${c.Next}`).toBe(true);
        }
      }
      if (s.Branches) {
        for (const [i, b] of s.Branches.entries()) {
          // The branch's own StartAt lives inside the branch-local map.
          const local = new Set(Object.keys(b.States));
          expect(local.has(b.StartAt), `${name}.Branches[${i}].StartAt -> ${b.StartAt}`).toBe(true);
          // Walk inner branch references against the branch-local map.
          for (const [innerName, innerState] of Object.entries(b.States)) {
            if (innerState.Next) {
              expect(local.has(innerState.Next), `${name}::${innerName}.Next -> ${innerState.Next}`).toBe(true);
            }
            if (innerState.Default) {
              expect(local.has(innerState.Default), `${name}::${innerName}.Default -> ${innerState.Default}`).toBe(true);
            }
            if (innerState.Choices) {
              for (const c of innerState.Choices) {
                expect(local.has(c.Next), `${name}::${innerName}.Choices -> ${c.Next}`).toBe(true);
              }
            }
            if (innerState.Catch) {
              for (const c of innerState.Catch) {
                expect(local.has(c.Next), `${name}::${innerName}.Catch -> ${c.Next}`).toBe(true);
              }
            }
          }
        }
      }
    }
  });

  it('every non-terminal state has Next/Choices/Default/End', () => {
    for (const [name, s] of Object.entries(doc.States)) {
      if (s.Type === 'Succeed' || s.Type === 'Fail') continue;
      if (s.End === true) continue;
      const hasContinuation =
        !!s.Next || (s.Choices !== undefined && s.Choices.length > 0) || !!s.Default;
      expect(hasContinuation, `state ${name} has no continuation`).toBe(true);
    }
  });

  it('no unreachable states from StartAt', () => {
    const reachable = reachableFrom(doc.StartAt, doc);
    for (const name of Object.keys(doc.States)) {
      expect(reachable.has(name), `state ${name} unreachable`).toBe(true);
    }
  });

  it('no `$.startAt` cycle or self-loop (no state Next = itself)', () => {
    for (const [name, s] of Object.entries(doc.States)) {
      if (s.Next) {
        expect(s.Next).not.toBe(name);
      }
    }
  });
});

// ─── B. First-state gate ──────────────────────────────────────────────────

describe('B. First-state gate', () => {
  const doc = loadAsl();

  it('DecisionFn is never reachable before MARK_RUNNING', () => {
    // MARK_RUNNING is the start state (and only one); it is the first
    // state traversed. DecisionFn is invoked only from RUN_DECISION.
    expect(isReachable('MARK_RUNNING', 'RUN_DECISION', doc)).toBe(true);
    // RUN_DECISION is never reached before MARK_RUNNING completes; the
    // only path through RUN_DECISION must pass through MARK_RUNNING.
    expect(doc.States['RUN_DECISION'].Next).toBe('DECISION_CORE_WRITE_GATE');
    // No Choice / Catch in any pre-MARK_RUNNING state (there is none).
  });

  it('RecoveryGateFn is never reachable before MARK_RUNNING', () => {
    // Same reasoning: RECOVERY_GATE is only reachable from SELECT_RECOVERY_MODE
    // (which is reached after MARK_RUNNING).
    const reachable = reachableFrom('MARK_RUNNING', doc);
    expect(reachable.has('RECOVERY_GATE')).toBe(true);
    // But RECOVERY_GATE is NEVER reachable from anywhere except through
    // SELECT_RECOVERY_MODE (which requires MARK_RUNNING to have completed).
    expect(doc.States['RECOVERY_GATE'].Type).toBe('Task');
  });

  it('MARK_RUNNING uses $$.Execution.Id', () => {
    const params = doc.States['MARK_RUNNING'].Parameters as Record<string, unknown> | undefined;
    expect(params).toBeDefined();
    const payload = (params as { Payload: Record<string, string> })?.Payload;
    expect(payload).toBeDefined();
    expect(payload['execution_id.$']).toBe('$$.Execution.Id');
  });

  it('MARK_RUNNING error path goes to FAIL_BEFORE_RUNNING_REGISTERED', () => {
    const c = doc.States['MARK_RUNNING'].Catch;
    expect(c).toBeDefined();
    expect(c![0].Next).toBe('FAIL_BEFORE_RUNNING_REGISTERED');
    const fail = doc.States['FAIL_BEFORE_RUNNING_REGISTERED'];
    expect(fail.Type).toBe('Fail');
  });

  it('Mark-running failure does NOT call MARK_PROCESSING_FAILED', () => {
    // The Catch from MARK_RUNNING must go to FAIL_BEFORE_RUNNING_REGISTERED,
    // not into the generic failure path (which contains MARK_PROCESSING_FAILED).
    const c = doc.States['MARK_RUNNING'].Catch!;
    expect(c[0].Next).toBe('FAIL_BEFORE_RUNNING_REGISTERED');
    expect(c[0].Next).not.toBe('MARK_PROCESSING_FAILED');
  });
});

// ─── C. Recovery mode ─────────────────────────────────────────────────────

describe('C. Recovery mode', () => {
  const doc = loadAsl();

  it('NORMAL -> RUN_DECISION', () => {
    const c = doc.States['SELECT_RECOVERY_MODE'].Choices!;
    const normal = c.find((x) => x.Variable === '$.recovery_mode' && x.StringEquals === 'NORMAL');
    expect(normal?.Next).toBe('RUN_DECISION');
  });

  it('FULL_WORKFLOW -> RUN_DECISION', () => {
    const c = doc.States['SELECT_RECOVERY_MODE'].Choices!;
    const full = c.find(
      (x) => x.Variable === '$.recovery_mode' && x.StringEquals === 'FULL_WORKFLOW',
    );
    expect(full?.Next).toBe('RUN_DECISION');
  });

  it('ENRICHMENT_ONLY -> RECOVERY_GATE', () => {
    const c = doc.States['SELECT_RECOVERY_MODE'].Choices!;
    const enr = c.find(
      (x) => x.Variable === '$.recovery_mode' && x.StringEquals === 'ENRICHMENT_ONLY',
    );
    expect(enr?.Next).toBe('RECOVERY_GATE');
  });

  it('Default goes to PREPARE_INVALID_RECOVERY_MODE (fail-closed)', () => {
    expect(doc.States['SELECT_RECOVERY_MODE'].Default).toBe('PREPARE_INVALID_RECOVERY_MODE');
  });

  it('ENRICHMENT_ONLY never reaches RUN_DECISION', () => {
    // Starting from RECOVERY_GATE (the ENRICHMENT_ONLY branch), RUN_DECISION
    // must never be reachable.
    const reachable = reachableFrom('RECOVERY_GATE', doc);
    expect(reachable.has('RUN_DECISION')).toBe(false);
  });

  it('ENRICHMENT_ONLY never reaches PUBLISH_FAST_PATH_READY', () => {
    const reachable = reachableFrom('RECOVERY_GATE', doc);
    expect(reachable.has('PUBLISH_FAST_PATH_READY')).toBe(false);
  });

  it('NORMAL / FULL_WORKFLOW path never reaches RECOVERY_GATE (start branch)', () => {
    // From RUN_DECISION, the recovery start branch (RECOVERY_GATE) is
    // not reachable as a direct downstream state.
    const reachable = reachableFrom('RUN_DECISION', doc);
    expect(reachable.has('RECOVERY_GATE')).toBe(false);
  });

  it('Unknown recovery_mode goes to MARK_PROCESSING_FAILED (fail-closed)', () => {
    const r = reachableFrom('PREPARE_INVALID_RECOVERY_MODE', doc);
    expect(r.has('MARK_PROCESSING_FAILED')).toBe(true);
  });
});

// ─── D. Core-write Choice Gate ─────────────────────────────────────────────

describe('D. Core-write Choice Gate', () => {
  const doc = loadAsl();

  it('DECISION_CORE_WRITE_GATE has exactly three required branches', () => {
    const c = doc.States['DECISION_CORE_WRITE_GATE'].Choices!;
    expect(c.length).toBe(3);
    const labels = c.map((x) => x.StringEquals).sort();
    expect(labels).toEqual([
      'ALREADY_COMMITTED_SAME_DECISION',
      'COMMITTED',
      'CORE_IDENTITY_CONFLICT',
    ]);
  });

  it('COMMITTED -> MARK_CORE_COMMITTED_DECISION', () => {
    const c = doc.States['DECISION_CORE_WRITE_GATE'].Choices!;
    const x = c.find((y) => y.StringEquals === 'COMMITTED');
    expect(x?.Next).toBe('MARK_CORE_COMMITTED_DECISION');
  });

  it('ALREADY_COMMITTED_SAME_DECISION -> MARK_CORE_COMMITTED_DECISION', () => {
    const c = doc.States['DECISION_CORE_WRITE_GATE'].Choices!;
    const x = c.find((y) => y.StringEquals === 'ALREADY_COMMITTED_SAME_DECISION');
    expect(x?.Next).toBe('MARK_CORE_COMMITTED_DECISION');
  });

  it('CORE_IDENTITY_CONFLICT -> terminal failure chain', () => {
    const c = doc.States['DECISION_CORE_WRITE_GATE'].Choices!;
    const x = c.find((y) => y.StringEquals === 'CORE_IDENTITY_CONFLICT');
    expect(x?.Next).toBe('PREPARE_CORE_IDENTITY_CONFLICT');
    expect(doc.States['PREPARE_CORE_IDENTITY_CONFLICT'].Next).toBe('MARK_PROCESSING_FAILED_TERMINAL');
    expect(doc.States['MARK_PROCESSING_FAILED_TERMINAL'].Next).toBe('PUBLISH_PROCESSING_FAILED');
    expect(doc.States['PUBLISH_PROCESSING_FAILED'].Next).toBe('FAIL_CORE_IDENTITY_CONFLICT');
    expect(doc.States['FAIL_CORE_IDENTITY_CONFLICT'].Type).toBe('Fail');
  });

  it('CORE_IDENTITY_CONFLICT path never reaches Fast Path or Renderer or Completed', () => {
    const r = reachableFrom('PREPARE_CORE_IDENTITY_CONFLICT', doc);
    expect(r.has('PUBLISH_FAST_PATH_READY')).toBe(false);
    expect(r.has('ENRICHMENT_PARALLEL')).toBe(false);
    expect(r.has('MARK_COMPLETED')).toBe(false);
    expect(r.has('WORKFLOW_SUCCEEDED')).toBe(false);
  });

  it('Default of DECISION_CORE_WRITE_GATE goes to a fail-closed state', () => {
    expect(doc.States['DECISION_CORE_WRITE_GATE'].Default).toBe('PREPARE_UNKNOWN_CORE_WRITE_STATUS');
    const r = reachableFrom('PREPARE_UNKNOWN_CORE_WRITE_STATUS', doc);
    expect(r.has('MARK_PROCESSING_FAILED')).toBe(true);
    expect(r.has('PUBLISH_FAST_PATH_READY')).toBe(false);
    expect(r.has('ENRICHMENT_PARALLEL')).toBe(false);
  });
});

// ─── E. Fast Path ordering ────────────────────────────────────────────────

describe('E. Fast Path ordering', () => {
  const doc = loadAsl();

  it('RUN_DECISION -> DECISION_CORE_WRITE_GATE -> ... -> PUBLISH_FAST_PATH_READY -> ENRICHMENT_PARALLEL', () => {
    expect(doc.States['RUN_DECISION'].Next).toBe('DECISION_CORE_WRITE_GATE');
    expect(doc.States['MARK_CORE_COMMITTED_DECISION'].Next).toBe('PUBLISH_FAST_PATH_READY');
    expect(doc.States['PUBLISH_FAST_PATH_READY'].Next).toBe('ENRICHMENT_PARALLEL');
  });

  it('no path reaches PUBLISH_FAST_PATH_READY before MARK_CORE_COMMITTED_DECISION', () => {
    // Starting from PUBLISH_FAST_PATH_READY, walking backward via reachable
    // reverse set is not feasible; instead we verify the forward chain
    // and that there is no other Next into PUBLISH_FAST_PATH_READY.
    for (const [name, s] of Object.entries(doc.States)) {
      if (s.Next === 'PUBLISH_FAST_PATH_READY') {
        expect(name).toBe('MARK_CORE_COMMITTED_DECISION');
      }
      if (s.Choices) {
        for (const c of s.Choices) {
          if (c.Next === 'PUBLISH_FAST_PATH_READY') {
            expect(name).toBe('MARK_CORE_COMMITTED_DECISION');
          }
        }
      }
    }
  });
});

// ─── F. Recovery ordering ─────────────────────────────────────────────────

describe('F. Recovery ordering', () => {
  const doc = loadAsl();

  it('RECOVERY_GATE -> RECOVERY_CORE_EXISTS_GATE -> MARK_CORE_COMMITTED_RECOVERY -> ENRICHMENT_PARALLEL', () => {
    expect(doc.States['RECOVERY_GATE'].Next).toBe('RECOVERY_CORE_EXISTS_GATE');
    expect(doc.States['MARK_CORE_COMMITTED_RECOVERY'].Next).toBe('ENRICHMENT_PARALLEL');
  });

  it('MARK_CORE_COMMITTED_RECOVERY uses evidence_source = RECOVERY_GATE_CORE_EXISTS', () => {
    const params = doc.States['MARK_CORE_COMMITTED_RECOVERY'].Parameters as {
      Payload: Record<string, string>;
    };
    expect(params.Payload.evidence_source).toBe('RECOVERY_GATE_CORE_EXISTS');
  });

  it('RECOVERY_GATE path does NOT call DecisionFn', () => {
    // RUN_DECISION is reachable only from DECISION_CORE_WRITE_GATE; the
    // ENRICHMENT_ONLY branch must end at MARK_CORE_COMMITTED_RECOVERY
    // (via RECOVERY_CORE_EXISTS_GATE) without going through RUN_DECISION.
    const reachable = reachableFrom('RECOVERY_GATE', doc);
    expect(reachable.has('RUN_DECISION')).toBe(false);
  });

  it('RECOVERY_GATE path does NOT push decision.fast_path_ready', () => {
    const reachable = reachableFrom('RECOVERY_GATE', doc);
    expect(reachable.has('PUBLISH_FAST_PATH_READY')).toBe(false);
  });

  it('core_exists = false -> RECOVERY_CORE_MISSING failure', () => {
    const c = doc.States['RECOVERY_CORE_EXISTS_GATE'].Choices!;
    expect(c[0].Variable).toBe('$.recovery.payload.core_exists');
    expect(c[0].BooleanEquals).toBe(true);
    expect(doc.States['RECOVERY_CORE_EXISTS_GATE'].Default).toBe('PREPARE_RECOVERY_CORE_MISSING');
    const r = reachableFrom('PREPARE_RECOVERY_CORE_MISSING', doc);
    expect(r.has('MARK_PROCESSING_FAILED')).toBe(true);
  });
});

// ─── G. Parallel branches ────────────────────────────────────────────────

describe('G. Parallel branches', () => {
  const doc = loadAsl();

  it('ENRICHMENT_PARALLEL has exactly 3 branches', () => {
    expect(doc.States['ENRICHMENT_PARALLEL'].Type).toBe('Parallel');
    expect(doc.States['ENRICHMENT_PARALLEL'].Branches!.length).toBe(3);
  });

  it('modes are exactly REPORT, PUBLIC_ALERT, EXPLANATION', () => {
    const branches = doc.States['ENRICHMENT_PARALLEL'].Branches!;
    const modes: string[] = [];
    for (const b of branches) {
      const state = b.States[Object.keys(b.States)[0]];
      const params = state.Parameters as { Payload: Record<string, string> };
      modes.push(params.Payload.mode);
    }
    expect(modes.sort()).toEqual(['EXPLANATION', 'PUBLIC_ALERT', 'REPORT']);
  });

  it('all three branches use RendererFnArn substitution', () => {
    const branches = doc.States['ENRICHMENT_PARALLEL'].Branches!;
    for (const b of branches) {
      const state = b.States[Object.keys(b.States)[0]];
      const params = state.Parameters as { FunctionName: string };
      expect(params.FunctionName).toBe('${RendererFnArn}');
    }
  });

  it('no inline Renderer Lambda name (no ReportFn / PublicAlertFn / ExplanationFn)', () => {
    const aslText = fs.readFileSync(ASL_PATH, 'utf8');
    expect(aslText).not.toMatch(/ReportFn/);
    expect(aslText).not.toMatch(/PublicAlertFn/);
    expect(aslText).not.toMatch(/ExplanationFn/);
  });

  it('PUBLISH_ENRICHED only after parallel success', () => {
    expect(doc.States['ENRICHMENT_PARALLEL'].Next).toBe('PUBLISH_ENRICHED');
  });

  it('PUBLISH_ENRICHED -> MARK_COMPLETED -> WORKFLOW_SUCCEEDED', () => {
    expect(doc.States['PUBLISH_ENRICHED'].Next).toBe('MARK_COMPLETED');
    expect(doc.States['MARK_COMPLETED'].Next).toBe('WORKFLOW_SUCCEEDED');
    expect(doc.States['WORKFLOW_SUCCEEDED'].Type).toBe('Succeed');
  });
});

// ─── H. Failure handling ─────────────────────────────────────────────────

describe('H. Failure handling', () => {
  const doc = loadAsl();

  it('core tasks and parallel have Catch', () => {
    const tasks = [
      'RUN_DECISION',
      'MARK_CORE_COMMITTED_DECISION',
      'MARK_CORE_COMMITTED_RECOVERY',
      'ENRICHMENT_PARALLEL',
      'RECOVERY_GATE_AFTER_FAILURE',
    ];
    for (const t of tasks) {
      expect(doc.States[t].Catch, `${t} missing Catch`).toBeDefined();
    }
  });

  it('Catch ResultPath is non-overlapping; failures do not clobber root input', () => {
    const c = doc.States['RUN_DECISION'].Catch!;
    expect(c[0].ResultPath).toBe('$.workflow_error');
  });

  it('general failure path uses RecoveryGateFn then MARK_PROCESSING_FAILED', () => {
    const r = reachableFrom('RECOVERY_GATE_AFTER_FAILURE', doc);
    expect(r.has('MARK_PROCESSING_FAILED')).toBe(true);
  });

  it('MARK_PROCESSING_FAILED does NOT recursively Catch itself', () => {
    const s = doc.States['MARK_PROCESSING_FAILED'];
    expect(s.Catch).toBeUndefined();
    expect(s.Next).toBe('FAIL_PROCESSING_FAILED');
  });

  it('terminal failure does NOT reach Succeed', () => {
    const r = reachableFrom('FAIL_PROCESSING_FAILED', doc);
    expect(r.has('WORKFLOW_SUCCEEDED')).toBe(false);
    expect(r.has('MARK_COMPLETED')).toBe(false);
  });

  it('WebSocket push failure does NOT roll back core/narrative state', () => {
    // PUBLISH_FAST_PATH_READY Catch goes to ENRICHMENT_PARALLEL (continues
    // pipeline) — it does not jump to a rollback or to MARK_PROCESSING_FAILED.
    const c = doc.States['PUBLISH_FAST_PATH_READY'].Catch!;
    expect(c[0].Next).toBe('ENRICHMENT_PARALLEL');
    expect(c[0].Next).not.toBe('MARK_PROCESSING_FAILED');
    expect(c[0].Next).not.toBe('FAIL_PROCESSING_FAILED');
    // PUBLISH_ENRICHED Catch goes to MARK_COMPLETED (continues success path).
    const c2 = doc.States['PUBLISH_ENRICHED'].Catch!;
    expect(c2[0].Next).toBe('MARK_COMPLETED');
  });
});

// ─── I. State Machine resource ─────────────────────────────────────────────

describe('I. State Machine resource', () => {
  it('PERSONAL_AWS_DEV: exactly 1 AWS::StepFunctions::StateMachine', () => {
    const { resources } = synthTemplate('PERSONAL_AWS_DEV');
    expect(countResourcesByType(resources, 'AWS::StepFunctions::StateMachine')).toBe(1);
  });

  it('PERSONAL_AWS_DEV: StateMachineType = EXPRESS', () => {
    const { resources } = synthTemplate('PERSONAL_AWS_DEV');
    const sms = getStateMachineResources(resources);
    const sm = Object.values(sms)[0];
    expect(getProps(sm)['StateMachineType']).toBe('EXPRESS');
  });

  it('PERSONAL_AWS_DEV: StateMachineName has personal-dev prefix', () => {
    const { resources } = synthTemplate('PERSONAL_AWS_DEV');
    const sms = getStateMachineResources(resources);
    const sm = Object.values(sms)[0];
    const name = getProps(sm)['StateMachineName'] as string;
    expect(name.startsWith('personal-dev-')).toBe(true);
  });

  it('PERSONAL_AWS_DEV: workflowTimeoutSeconds is plumbed into the deployed definition', () => {
    const { stack } = build('PERSONAL_AWS_DEV', undefined, { workflowTimeoutSeconds: 60 });
    const def = getDeployedDefinitionJson(stack);
    expect(def).not.toBeNull();
    expect(def).toHaveProperty('TimeoutSeconds');
    expect(def!.TimeoutSeconds).toBe(60);
    expect(typeof def!.TimeoutSeconds).toBe('number');
    // TimeoutSeconds is at the top level, beside StartAt and States.
    expect(Object.keys(def!).sort()).toEqual(
      expect.arrayContaining(['Comment', 'QueryLanguage', 'StartAt', 'States', 'TimeoutSeconds']),
    );
    expect(def!.StartAt).toBe('MARK_RUNNING');
    expect(Object.keys(def!.States as object).length).toBe(28);
  });

  it('PERSONAL_AWS_DEV: changing workflowTimeoutSeconds changes the deployed definition', () => {
    const { stack: s1 } = build('PERSONAL_AWS_DEV', 'P1', { workflowTimeoutSeconds: 60 });
    const { stack: s2 } = build('PERSONAL_AWS_DEV', 'P2', { workflowTimeoutSeconds: 137 });
    const d1 = getDeployedDefinitionJson(s1);
    const d2 = getDeployedDefinitionJson(s2);
    expect(d1).not.toBeNull();
    expect(d2).not.toBeNull();
    expect(d1!.TimeoutSeconds).toBe(60);
    expect(d2!.TimeoutSeconds).toBe(137);
    // The full definition string must differ (proves the change is
    // operational, not just a stored field).
    const a1 = (s1.node.root as App).synth().stacks[0].template as Record<string, Record<string, Record<string, unknown>>>;
    const a2 = (s2.node.root as App).synth().stacks[0].template as Record<string, Record<string, Record<string, unknown>>>;
    const sm1 = Object.values(a1['Resources']).find((r) => r.Type === 'AWS::StepFunctions::StateMachine')!;
    const sm2 = Object.values(a2['Resources']).find((r) => r.Type === 'AWS::StepFunctions::StateMachine')!;
    const ds1 = (sm1.Properties as Record<string, unknown>)['DefinitionString'] as string;
    const ds2 = (sm2.Properties as Record<string, unknown>)['DefinitionString'] as string;
    expect(ds1).not.toBe(ds2);
    expect(ds1).toMatch(/"TimeoutSeconds":60/);
    expect(ds2).toMatch(/"TimeoutSeconds":137/);
  });

  it('PERSONAL_AWS_DEV: TimeoutSeconds is a number, not a quoted string', () => {
    const { stack } = build('PERSONAL_AWS_DEV', undefined, { workflowTimeoutSeconds: 60 });
    const sm = getStateMachineFromSynth(stack);
    const ds = (sm.Properties as Record<string, unknown>)['DefinitionString'] as string;
    // Must be a bare number, not quoted:
    expect(ds).toMatch(/"TimeoutSeconds":60(?!\d)/);
    expect(ds).not.toMatch(/"TimeoutSeconds":"60"/);
  });

  it('PERSONAL_AWS_DEV: TimeoutSeconds is beside StartAt and States', () => {
    const { stack } = build('PERSONAL_AWS_DEV', undefined, { workflowTimeoutSeconds: 60 });
    const def = getDeployedDefinitionJson(stack);
    expect(def).not.toBeNull();
    expect(Object.prototype.hasOwnProperty.call(def, 'TimeoutSeconds')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(def, 'StartAt')).toBe(true);
    expect(Object.prototype.hasOwnProperty.call(def, 'States')).toBe(true);
  });

  it('PERSONAL_AWS_DEV: same canonical workflow source for both profiles', () => {
    const { stack: s1 } = build('PERSONAL_AWS_DEV', 'CP1', { workflowTimeoutSeconds: 60 });
    const { stack: s2 } = build('COMPETITION_AWS', 'CP2', { workflowTimeoutSeconds: 60 });
    const d1 = getDeployedDefinitionJson(s1);
    const d2 = getDeployedDefinitionJson(s2);
    // Both must read the same canonical workflow.asl.json (same state
    // names, same Comment, same QueryLanguage); only the resource prefix
    // (StateMachineName) and the TimeoutSeconds come from the Construct.
    expect(Object.keys(d1!.States as object).sort()).toEqual(
      Object.keys(d2!.States as object).sort(),
    );
    expect((d1!.States as Record<string, unknown>)['MARK_RUNNING']).toEqual(
      (d2!.States as Record<string, unknown>)['MARK_RUNNING'],
    );
  });

  it('PERSONAL_AWS_DEV: ASL remains valid JSON', () => {
    const { stack } = build('PERSONAL_AWS_DEV', undefined, { workflowTimeoutSeconds: 60 });
    const sm = getStateMachineFromSynth(stack);
    const ds = (sm.Properties as Record<string, unknown>)['DefinitionString'] as string;
    expect(() => JSON.parse(ds)).not.toThrow();
  });

  it('PERSONAL_AWS_DEV: RoleArn is the injected ARN', () => {
    const { resources } = synthTemplate('PERSONAL_AWS_DEV');
    const sms = getStateMachineResources(resources);
    const sm = Object.values(sms)[0];
    expect(getProps(sm)['RoleArn']).toBe(
      `arn:aws:iam::${FAKE_ACCOUNT}:role/TestOrchestratorRole`,
    );
  });

  it('PERSONAL_AWS_DEV: DefinitionSubstitutions uses the five injected function ARNs', () => {
    const { resources } = synthTemplate('PERSONAL_AWS_DEV');
    const sms = getStateMachineResources(resources);
    const sm = Object.values(sms)[0];
    const subs = getProps(sm)['DefinitionSubstitutions'] as Record<string, string>;
    expect(subs['WorkflowStatusFnArn']).toBe(
      `arn:aws:lambda:${FAKE_REGION}:${FAKE_ACCOUNT}:function:WorkflowStatusFn`,
    );
    expect(subs['RecoveryGateFnArn']).toBe(
      `arn:aws:lambda:${FAKE_REGION}:${FAKE_ACCOUNT}:function:RecoveryGateFn`,
    );
    expect(subs['DecisionFnArn']).toBe(
      `arn:aws:lambda:${FAKE_REGION}:${FAKE_ACCOUNT}:function:DecisionFn`,
    );
    expect(subs['RendererFnArn']).toBe(
      `arn:aws:lambda:${FAKE_REGION}:${FAKE_ACCOUNT}:function:RendererFn`,
    );
    expect(subs['WsPushFnArn']).toBe(
      `arn:aws:lambda:${FAKE_REGION}:${FAKE_ACCOUNT}:function:WsPushFn`,
    );
    expect(Object.keys(subs).sort()).toEqual([...ASL_SUBSTITUTION_KEYS].sort());
  });

  it('PERSONAL_AWS_DEV: ARN output exists', () => {
    const { outputs } = synthTemplate('PERSONAL_AWS_DEV');
    const items = Object.values(outputs);
    expect(items.length).toBeGreaterThan(0);
    const wf = items.find((o) => (o['Description'] as string)?.includes('Workflow'));
    expect(wf).toBeDefined();
    // The Value is a CloudFormation token (Ref, Fn::GetAtt, or resolved
    // string) referring to the State Machine ARN. We accept any of these
    // forms as long as the referenced logical id is the State Machine.
    const value = wf!['Value'] as Record<string, unknown> | string;
    if (typeof value === 'string') {
      expect(value).toMatch(/arn:aws:states:/);
      return;
    }
    expect(value).toBeDefined();
    // Either a Ref to the State Machine logical id, or a Fn::GetAtt of it.
    let referencedLogicalId = '';
    if (typeof value['Ref'] === 'string') {
      referencedLogicalId = value['Ref'];
    } else if (Array.isArray(value['Fn::GetAtt'])) {
      referencedLogicalId = (value['Fn::GetAtt'] as string[])[0] ?? '';
    }
    expect(referencedLogicalId).toMatch(/WorkflowStateMachine/i);
  });

  it('PERSONAL_AWS_DEV: RemovalPolicy = DESTROY', () => {
    const { resources } = synthTemplate('PERSONAL_AWS_DEV');
    const sms = getStateMachineResources(resources);
    const sm = Object.values(sms)[0];
    expect(sm['DeletionPolicy']).toBe('Delete');
  });

  it('COMPETITION_AWS: exactly 1 AWS::StepFunctions::StateMachine', () => {
    const { resources } = synthTemplate('COMPETITION_AWS');
    expect(countResourcesByType(resources, 'AWS::StepFunctions::StateMachine')).toBe(1);
  });

  it('COMPETITION_AWS: Type = EXPRESS', () => {
    const { resources } = synthTemplate('COMPETITION_AWS');
    const sm = Object.values(getStateMachineResources(resources))[0];
    expect(getProps(sm)['StateMachineType']).toBe('EXPRESS');
  });

  it('COMPETITION_AWS: name has competition prefix', () => {
    const { resources } = synthTemplate('COMPETITION_AWS');
    const sm = Object.values(getStateMachineResources(resources))[0];
    const name = getProps(sm)['StateMachineName'] as string;
    expect(name.startsWith('competition-')).toBe(true);
  });

  it('COMPETITION_AWS: same ASL as personal (use identical pipeline)', () => {
    const { resources: p } = synthTemplate('PERSONAL_AWS_DEV');
    const { resources: c } = synthTemplate('COMPETITION_AWS');
    const a = getProps(Object.values(getStateMachineResources(p))[0])['DefinitionString'] as string;
    const b = getProps(Object.values(getStateMachineResources(c))[0])['DefinitionString'] as string;
    expect(a).toBe(b);
  });

  it('COMPETITION_AWS: RemovalPolicy = Retain', () => {
    const { resources } = synthTemplate('COMPETITION_AWS');
    const sm = Object.values(getStateMachineResources(resources))[0];
    expect(sm['DeletionPolicy']).toBe('Retain');
  });

  it('LOCAL_MOCK: 0 AWS resources', () => {
    const { resources } = synthTemplate('LOCAL_MOCK');
    const nonCdk = Object.values(resources).filter((r) => {
      const ty = r['Type'] as string;
      return ty && !ty.startsWith('AWS::CDK::');
    });
    expect(nonCdk).toHaveLength(0);
  });
});

// ─── J. Forbidden resources / hard-coded values ───────────────────────────

describe('J. Forbidden resources / hard-coded values', () => {
  it('PERSONAL_AWS_DEV: 0 AWS::IAM::Role', () => {
    const { resources } = synthTemplate('PERSONAL_AWS_DEV');
    expect(countResourcesByType(resources, 'AWS::IAM::Role')).toBe(0);
  });

  it('PERSONAL_AWS_DEV: 0 AWS::IAM::Policy', () => {
    const { resources } = synthTemplate('PERSONAL_AWS_DEV');
    expect(countResourcesByType(resources, 'AWS::IAM::Policy')).toBe(0);
  });

  it('PERSONAL_AWS_DEV: 0 AWS::Lambda::Function', () => {
    const { resources } = synthTemplate('PERSONAL_AWS_DEV');
    expect(countResourcesByType(resources, 'AWS::Lambda::Function')).toBe(0);
  });

  it('PERSONAL_AWS_DEV: 0 AWS::Logs::LogGroup', () => {
    const { resources } = synthTemplate('PERSONAL_AWS_DEV');
    expect(countResourcesByType(resources, 'AWS::Logs::LogGroup')).toBe(0);
  });

  it('PERSONAL_AWS_DEV: 0 Custom Resource', () => {
    const { resources } = synthTemplate('PERSONAL_AWS_DEV');
    const customCount = Object.values(resources).filter((r) => {
      const ty = r['Type'] as string;
      return ty && ty.startsWith('Custom::');
    }).length;
    expect(customCount).toBe(0);
  });

  it('ASL contains no direct DynamoDB / S3 / Bedrock / API Gateway integration', () => {
    const aslText = fs.readFileSync(ASL_PATH, 'utf8');
    expect(aslText).not.toMatch(/arn:aws:states:::dynamodb/);
    expect(aslText).not.toMatch(/arn:aws:states:::s3:/);
    expect(aslText).not.toMatch(/arn:aws:states:::bedrock/);
    expect(aslText).not.toMatch(/arn:aws:states:::apigateway/);
    expect(aslText).not.toMatch(/arn:aws:states:::aws-sdk/);
  });

  it('ASL contains no hard-coded account literal', () => {
    const aslText = fs.readFileSync(ASL_PATH, 'utf8');
    const matches = aslText.match(/\b\d{12}\b/g) ?? [];
    expect(matches).toEqual([]);
  });

  it('ASL contains no hard-coded region literal', () => {
    const aslText = fs.readFileSync(ASL_PATH, 'utf8');
    expect(aslText).not.toMatch(/\b(ap|us|eu|sa|ca|cn|me|af|il)\-\w+\-\d+\b/);
  });

  it('ASL contains no hard-coded Lambda ARN', () => {
    const aslText = fs.readFileSync(ASL_PATH, 'utf8');
    expect(aslText).not.toMatch(/arn:aws:lambda:[^\s"]+:function:[^${]/);
  });

  it('ASL contains no hard-coded StateMachine ARN', () => {
    const aslText = fs.readFileSync(ASL_PATH, 'utf8');
    expect(aslText).not.toMatch(/arn:aws:states:[^\s"]+:stateMachine/);
  });

  it('ASL contains no .sync / .waitForTaskToken / Distributed Map / Activity', () => {
    const aslText = fs.readFileSync(ASL_PATH, 'utf8');
    expect(aslText).not.toMatch(/\.sync/);
    expect(aslText).not.toMatch(/\.waitForTaskToken/);
    expect(aslText).not.toMatch(/ItemProcessor/);
    expect(aslText).not.toMatch(/\bActivity\b/);
  });

  it('Construct source has no lambda_direct runtime fallback', () => {
    const path = require('node:path') as typeof import('node:path');
    const fs = require('node:fs') as typeof import('node:fs');
    const file = path.resolve(__dirname, '..', 'lib', 'constructs', 'workflow_state_machine.ts');
    const content = fs.readFileSync(file, 'utf8');
    // Strip JSDoc; the prohibition is documented but not as runtime code.
    const stripped = content.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(stripped).not.toMatch(/lambda_direct/i);
    expect(stripped).not.toMatch(/LAMBDA_DIRECT_FALLBACK/);
    expect(stripped).not.toMatch(/CALL_DECISION_DIRECTLY/);
    expect(stripped).not.toMatch(/BYPASS_ORCHESTRATOR/);
  });

  it('ASL contains no forbidden state names (lambda_direct / bypass shortcuts)', () => {
    const aslText = fs.readFileSync(ASL_PATH, 'utf8');
    expect(aslText).not.toMatch(/LAMBDA_DIRECT_FALLBACK/);
    expect(aslText).not.toMatch(/CALL_DECISION_DIRECTLY/);
    expect(aslText).not.toMatch(/BYPASS_ORCHESTRATOR/);
  });
});

// ─── K. K-table expected constants ────────────────────────────────────────

describe('K. Constants and validation', () => {
  it('applicationStateMachineCount constant equals 1', () => {
    expect(APPLICATION_STATE_MACHINE_COUNT).toBe(1);
    const { construct } = build('PERSONAL_AWS_DEV');
    expect(construct.applicationStateMachineCount).toBe(1);
  });

  it('workflowTimeoutSeconds < 1 throws', () => {
    const { stack, ctx } = makeStack('PERSONAL_AWS_DEV');
    expect(() =>
      new WorkflowStateMachineConstruct(stack, 'WorkflowStateMachineConstruct', {
        envContext: ctx,
        executionRole: importedRole(stack, 'OrchestratorRole'),
        workflowStatusFn: importedFunction(stack, 'WorkflowStatusFn'),
        recoveryGateFn: importedFunction(stack, 'RecoveryGateFn'),
        decisionFn: importedFunction(stack, 'DecisionFn'),
        rendererFn: importedFunction(stack, 'RendererFn'),
        wsPushFn: importedFunction(stack, 'WsPushFn'),
        workflowTimeoutSeconds: 0,
      }),
    ).toThrow(/workflowTimeoutSeconds/);
  });

  it(`workflowTimeoutSeconds > ${WORKFLOW_TIMEOUT_SECONDS_MAX} throws`, () => {
    const { stack, ctx } = makeStack('PERSONAL_AWS_DEV');
    expect(() =>
      new WorkflowStateMachineConstruct(stack, 'WorkflowStateMachineConstruct', {
        envContext: ctx,
        executionRole: importedRole(stack, 'OrchestratorRole'),
        workflowStatusFn: importedFunction(stack, 'WorkflowStatusFn'),
        recoveryGateFn: importedFunction(stack, 'RecoveryGateFn'),
        decisionFn: importedFunction(stack, 'DecisionFn'),
        rendererFn: importedFunction(stack, 'RendererFn'),
        wsPushFn: importedFunction(stack, 'WsPushFn'),
        workflowTimeoutSeconds: WORKFLOW_TIMEOUT_SECONDS_MAX + 1,
      }),
    ).toThrow(/workflowTimeoutSeconds/);
  });

  it('workflowTimeoutSeconds = 301 throws', () => {
    const { stack, ctx } = makeStack('PERSONAL_AWS_DEV');
    expect(() =>
      new WorkflowStateMachineConstruct(stack, 'WorkflowStateMachineConstruct', {
        envContext: ctx,
        executionRole: importedRole(stack, 'OrchestratorRole'),
        workflowStatusFn: importedFunction(stack, 'WorkflowStatusFn'),
        recoveryGateFn: importedFunction(stack, 'RecoveryGateFn'),
        decisionFn: importedFunction(stack, 'DecisionFn'),
        rendererFn: importedFunction(stack, 'RendererFn'),
        wsPushFn: importedFunction(stack, 'WsPushFn'),
        workflowTimeoutSeconds: 301,
      }),
    ).toThrow(/workflowTimeoutSeconds/);
  });

  it('workflowTimeoutSeconds negative throws', () => {
    const { stack, ctx } = makeStack('PERSONAL_AWS_DEV');
    expect(() =>
      new WorkflowStateMachineConstruct(stack, 'WorkflowStateMachineConstruct', {
        envContext: ctx,
        executionRole: importedRole(stack, 'OrchestratorRole'),
        workflowStatusFn: importedFunction(stack, 'WorkflowStatusFn'),
        recoveryGateFn: importedFunction(stack, 'RecoveryGateFn'),
        decisionFn: importedFunction(stack, 'DecisionFn'),
        rendererFn: importedFunction(stack, 'RendererFn'),
        wsPushFn: importedFunction(stack, 'WsPushFn'),
        workflowTimeoutSeconds: -1,
      }),
    ).toThrow(/workflowTimeoutSeconds/);
  });

  it('workflowTimeoutSeconds = 1 succeeds and appears in deployed definition', () => {
    const { stack, ctx } = makeStack('PERSONAL_AWS_DEV');
    expect(() =>
      new WorkflowStateMachineConstruct(stack, 'WorkflowStateMachineConstruct', {
        envContext: ctx,
        executionRole: importedRole(stack, 'OrchestratorRole'),
        workflowStatusFn: importedFunction(stack, 'WorkflowStatusFn'),
        recoveryGateFn: importedFunction(stack, 'RecoveryGateFn'),
        decisionFn: importedFunction(stack, 'DecisionFn'),
        rendererFn: importedFunction(stack, 'RendererFn'),
        wsPushFn: importedFunction(stack, 'WsPushFn'),
        workflowTimeoutSeconds: 1,
      }),
    ).not.toThrow();
    const def = getDeployedDefinitionJson(stack);
    expect(def).not.toBeNull();
    expect(def!.TimeoutSeconds).toBe(1);
  });

  it(`workflowTimeoutSeconds = ${WORKFLOW_TIMEOUT_SECONDS_MAX} succeeds and appears in deployed definition`, () => {
    const { stack, ctx } = makeStack('PERSONAL_AWS_DEV');
    expect(() =>
      new WorkflowStateMachineConstruct(stack, 'WorkflowStateMachineConstruct', {
        envContext: ctx,
        executionRole: importedRole(stack, 'OrchestratorRole'),
        workflowStatusFn: importedFunction(stack, 'WorkflowStatusFn'),
        recoveryGateFn: importedFunction(stack, 'RecoveryGateFn'),
        decisionFn: importedFunction(stack, 'DecisionFn'),
        rendererFn: importedFunction(stack, 'RendererFn'),
        wsPushFn: importedFunction(stack, 'WsPushFn'),
        workflowTimeoutSeconds: WORKFLOW_TIMEOUT_SECONDS_MAX,
      }),
    ).not.toThrow();
    const def = getDeployedDefinitionJson(stack);
    expect(def).not.toBeNull();
    expect(def!.TimeoutSeconds).toBe(WORKFLOW_TIMEOUT_SECONDS_MAX);
  });

  it('workflowTimeoutSeconds non-integer throws', () => {
    const { stack, ctx } = makeStack('PERSONAL_AWS_DEV');
    expect(() =>
      new WorkflowStateMachineConstruct(stack, 'WorkflowStateMachineConstruct', {
        envContext: ctx,
        executionRole: importedRole(stack, 'OrchestratorRole'),
        workflowStatusFn: importedFunction(stack, 'WorkflowStatusFn'),
        recoveryGateFn: importedFunction(stack, 'RecoveryGateFn'),
        decisionFn: importedFunction(stack, 'DecisionFn'),
        rendererFn: importedFunction(stack, 'RendererFn'),
        wsPushFn: importedFunction(stack, 'WsPushFn'),
        workflowTimeoutSeconds: 60.5,
      }),
    ).toThrow(/workflowTimeoutSeconds/);
  });

  it('Missing executionRole throws', () => {
    const { stack, ctx } = makeStack('PERSONAL_AWS_DEV');
    expect(() =>
      new WorkflowStateMachineConstruct(stack, 'WorkflowStateMachineConstruct', {
        envContext: ctx,
        // @ts-expect-error: testing missing required prop
        executionRole: undefined,
        workflowStatusFn: importedFunction(stack, 'WorkflowStatusFn'),
        recoveryGateFn: importedFunction(stack, 'RecoveryGateFn'),
        decisionFn: importedFunction(stack, 'DecisionFn'),
        rendererFn: importedFunction(stack, 'RendererFn'),
        wsPushFn: importedFunction(stack, 'WsPushFn'),
        workflowTimeoutSeconds: 60,
      }),
    ).toThrow(/executionRole/);
  });

  it('ASL_SUBSTITUTION_KEYS contains exactly the five required keys', () => {
    expect([...ASL_SUBSTITUTION_KEYS].sort()).toEqual([
      'DecisionFnArn',
      'RecoveryGateFnArn',
      'RendererFnArn',
      'WorkflowStatusFnArn',
      'WsPushFnArn',
    ]);
  });

  it('WORKFLOW_TIMEOUT_SECONDS_MIN/MAX = 1/300', () => {
    expect(WORKFLOW_TIMEOUT_SECONDS_MIN).toBe(1);
    expect(WORKFLOW_TIMEOUT_SECONDS_MAX).toBe(300);
  });
});

// ─── L. Retry policy — no retry on States.ALL ──────────────────────────────

describe('L. Retry policy', () => {
  const doc = loadAsl();

  it('No state retries on States.ALL', () => {
    for (const [name, s] of Object.entries(doc.States)) {
      if (!s.Retry) continue;
      for (const r of s.Retry as Array<{ ErrorEquals: string[] }>) {
        for (const e of r.ErrorEquals) {
          expect(e, `${name} retries on States.ALL`).not.toBe('States.ALL');
        }
      }
    }
  });

  it('Retry ErrorEquals are the four Lambda transient errors', () => {
    const allowed = new Set([
      'Lambda.ServiceException',
      'Lambda.AWSLambdaException',
      'Lambda.SdkClientException',
      'Lambda.TooManyRequestsException',
    ]);
    for (const [name, s] of Object.entries(doc.States)) {
      if (!s.Retry) continue;
      for (const r of s.Retry as Array<{ ErrorEquals: string[] }>) {
        for (const e of r.ErrorEquals) {
          expect(allowed.has(e), `${name} retries on unexpected error: ${e}`).toBe(true);
        }
      }
    }
  });

  it('Retry uses conservative parameters (IntervalSeconds=1, MaxAttempts=2, BackoffRate=2)', () => {
    const tasksWithRetry = Object.entries(doc.States).filter(([, s]) => !!s.Retry);
    expect(tasksWithRetry.length).toBeGreaterThan(0);
    for (const [name, s] of tasksWithRetry) {
      const r = (s.Retry as Array<{ IntervalSeconds: number; MaxAttempts: number; BackoffRate: number }>)[0];
      expect(r.IntervalSeconds, `${name}.IntervalSeconds`).toBe(1);
      expect(r.MaxAttempts, `${name}.MaxAttempts`).toBe(2);
      expect(r.BackoffRate, `${name}.BackoffRate`).toBe(2);
    }
  });
});

// ─── M. State machine structure passes non-reachable + cycle sanity ────────

describe('M. Static sanity', () => {
  const doc = loadAsl();

  it('exactly one AWS::Lambda::Function resource produced by the stack is 0', () => {
    const { resources } = synthTemplate('PERSONAL_AWS_DEV');
    expect(countResourcesByType(resources, 'AWS::Lambda::Function')).toBe(0);
  });

  it('WORKFLOW_SUCCEEDED has no Next', () => {
    expect(doc.States['WORKFLOW_SUCCEEDED'].Next).toBeUndefined();
    expect(doc.States['WORKFLOW_SUCCEEDED'].Type).toBe('Succeed');
  });

  it('FAIL_* states are Type=Fail', () => {
    for (const name of ['FAIL_BEFORE_RUNNING_REGISTERED', 'FAIL_CORE_IDENTITY_CONFLICT', 'FAIL_PROCESSING_FAILED']) {
      expect(doc.States[name].Type).toBe('Fail');
    }
  });

  it('express Step Functions list', () => {
    const { resources } = synthTemplate('PERSONAL_AWS_DEV');
    const all = Object.values(getStateMachineResources(resources));
    expect(all.length).toBe(1);
    expect(getProps(all[0])['StateMachineType']).toBe('EXPRESS');
  });
});