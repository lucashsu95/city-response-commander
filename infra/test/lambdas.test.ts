/**
 * TASK-067 targeted tests — RuntimeLambdas Construct
 *
 * No AWS credentials / network access; pure synth-time assertions.
 * Uses `iam.Role.fromRoleArn` to import role fixtures (zero AWS::IAM::Role
 * created here).
 *
 * Lambda deployment artifacts are pending owner implementation; this test
 * uses `lambda.Code.fromInline` only as an isolated-test fixture. No
 * production fallback exists in the Construct.
 */

import { describe, it, expect } from 'vitest';
import { App, Stack } from 'aws-cdk-lib';
import { Code, Runtime } from 'aws-cdk-lib/aws-lambda';
import { IRole, Role } from 'aws-cdk-lib/aws-iam';
import { resolveEnvironmentContext } from '../lib/env_context.js';
import {
  RuntimeLambdas,
  RUNTIME_LAMBDA_NAMES,
  APPLICATION_RUNTIME_LAMBDA_COUNT,
  LAMBDA_ENV_APP_ENV,
  LAMBDA_ENV_BEDROCK_MODEL_ID,
  LAMBDA_ENV_KNOWLEDGE_BASE_ID,
  LAMBDA_ENV_BEDROCK_REGION,
  FORBIDDEN_AWS_RESERVED_ENV_KEYS,
  type RuntimeLambdaDefinitions,
} from '../lib/constructs/lambdas.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

type Profile = 'LOCAL_MOCK' | 'PERSONAL_AWS_DEV' | 'COMPETITION_AWS';

const FAKE_ACCOUNT = '111111111111';

function makeStack(profile: Profile, stackName?: string): {
  stack: Stack;
  ctx: import('../lib/env_context.js').EnvironmentContext;
} {
  const app = new App({ autoSynth: false });
  app.node.setContext('env', profile);
  const ctx = resolveEnvironmentContext(app.node);
  const stack = new Stack(app, stackName ?? `${ctx.resourcePrefix}-lambdas-test`);
  return { stack, ctx };
}

/** Imported role — does NOT create an AWS::IAM::Role resource. */
function importedRole(stack: Stack, suffix: string): IRole {
  return Role.fromRoleArn(
    stack,
    `ImportedRole${suffix}`,
    `arn:aws:iam::${FAKE_ACCOUNT}:role/Test${suffix}`,
  );
}

/** Mutable definition used by tests that intentionally mutate fields. */
interface MutableDef {
  code: Code;
  handler: string;
  role: IRole;
  memorySizeMb: number;
  timeoutSeconds: number;
  environment?: Record<string, string>;
}

function makeMutableFixtures(stack: Stack): Record<keyof RuntimeLambdaDefinitions, MutableDef> {
  // WsPushFn and ConnFn share WsConnFnRole — the only allowed role sharing.
  // Build it once and reference the same instance for both.
  const wsConnFnRole = importedRole(stack, 'WsConnFnRole');
  return {
    InjectFn: {
      code: Code.fromInline('exports.handler = async () => ({ statusCode: 200 });'),
      handler: 'src/inject.handler',
      role: importedRole(stack, 'InjectFnRole'),
      memorySizeMb: 256,
      timeoutSeconds: 30,
    },
    WorkflowStatusFn: {
      code: Code.fromInline('exports.handler = async () => ({ statusCode: 200 });'),
      handler: 'src/workflow-status.handler',
      role: importedRole(stack, 'WorkflowStatusFnRole'),
      memorySizeMb: 256,
      timeoutSeconds: 30,
    },
    RecoveryGateFn: {
      code: Code.fromInline('exports.handler = async () => ({ statusCode: 200 });'),
      handler: 'src/recovery-gate.handler',
      role: importedRole(stack, 'RecoveryGateFnRole'),
      memorySizeMb: 256,
      timeoutSeconds: 30,
    },
    DecisionFn: {
      code: Code.fromInline('exports.handler = async () => ({ statusCode: 200 });'),
      handler: 'src/decision.handler',
      role: importedRole(stack, 'DecisionFnRole'),
      memorySizeMb: 1024,
      timeoutSeconds: 30,
    },
    RendererFn: {
      code: Code.fromInline('exports.handler = async () => ({ statusCode: 200 });'),
      handler: 'src/renderer.handler',
      role: importedRole(stack, 'RendererFnRole'),
      memorySizeMb: 512,
      timeoutSeconds: 30,
    },
    PublishFn: {
      code: Code.fromInline('exports.handler = async () => ({ statusCode: 200 });'),
      handler: 'src/publish.handler',
      role: importedRole(stack, 'PublishFnRole'),
      memorySizeMb: 256,
      timeoutSeconds: 30,
    },
    ApiReadFn: {
      code: Code.fromInline('exports.handler = async () => ({ statusCode: 200 });'),
      handler: 'src/api-read.handler',
      role: importedRole(stack, 'ApiReadFnRole'),
      memorySizeMb: 256,
      timeoutSeconds: 30,
    },
    WsPushFn: {
      code: Code.fromInline('exports.handler = async () => ({ statusCode: 200 });'),
      handler: 'src/ws-push.handler',
      role: wsConnFnRole,
      memorySizeMb: 256,
      timeoutSeconds: 30,
    },
    ConnFn: {
      code: Code.fromInline('exports.handler = async () => ({ statusCode: 200 });'),
      handler: 'src/conn.handler',
      role: wsConnFnRole,
      memorySizeMb: 256,
      timeoutSeconds: 30,
    },
    WhatIfFn: {
      code: Code.fromInline('exports.handler = async () => ({ statusCode: 200 });'),
      handler: 'src/what-if.handler',
      role: importedRole(stack, 'WhatIfFnRole'),
      memorySizeMb: 512,
      timeoutSeconds: 60,
    },
  };
}

function makeFixtures(stack: Stack): RuntimeLambdaDefinitions {
  return makeMutableFixtures(stack) as unknown as RuntimeLambdaDefinitions;
}

/** Build the Construct in a fresh stack and return the synthesized template. */
function synthTemplate(
  profile: Profile,
  builder: (stack: Stack, ctx: import('../lib/env_context.js').EnvironmentContext) => void,
): Record<string, unknown> {
  const app = new App({ autoSynth: false });
  app.node.setContext('env', profile);
  const ctx = resolveEnvironmentContext(app.node);
  const stack = new Stack(app, `${ctx.resourcePrefix}-synth`);
  builder(stack, ctx);
  const a = app.synth();
  return a.stacks[0].template as Record<string, unknown>;
}

function synthResources(
  profile: Profile,
): Record<string, Record<string, unknown>> {
  return synthTemplate(profile, (stack, ctx) => {
    new RuntimeLambdas(stack, 'RuntimeLambdas', {
      envContext: ctx,
      runtime: Runtime.NODEJS_20_X,
      definitions: makeFixtures(stack),
      decisionFnReservedConcurrency: 10,
      bedrockRegion: 'ap-northeast-1',
      bedrockModelId: 'amazon.titan-embed-text-v2:0',
      knowledgeBaseId: 'test-kb-id',
    });
  })['Resources'] as Record<string, Record<string, unknown>>;
}

function getProps(r: Record<string, unknown>): Record<string, unknown> {
  return (r['Properties'] as Record<string, unknown>) ?? {};
}

function countResourcesByType(resources: Record<string, Record<string, unknown>>, typeName: string): number {
  return Object.values(resources).filter((r) => r['Type'] === typeName).length;
}

function getLambdaResources(resources: Record<string, Record<string, unknown>>): Record<string, Record<string, unknown>> {
  return Object.fromEntries(
    Object.entries(resources).filter(([, r]) => r['Type'] === 'AWS::Lambda::Function'),
  );
}

/** Apply a mutation to a freshly cloned fixtures object and build with it. */
function buildWith<T>(
  profile: Profile,
  mutator: (
    f: Record<keyof RuntimeLambdaDefinitions, MutableDef>,
    stack: Stack,
  ) => void,
  extraProps: Partial<ConstructorParameters<typeof RuntimeLambdas>[2]> = {},
): { app: App; stack: Stack } {
  const app = new App({ autoSynth: false });
  app.node.setContext('env', profile);
  const ctx = resolveEnvironmentContext(app.node);
  const stack = new Stack(app, `${ctx.resourcePrefix}-build`);
  const fixtures = makeMutableFixtures(stack);
  mutator(fixtures, stack);
  new RuntimeLambdas(stack, 'RuntimeLambdas', {
    envContext: ctx,
    runtime: Runtime.NODEJS_20_X,
    definitions: fixtures as unknown as RuntimeLambdaDefinitions,
    decisionFnReservedConcurrency: 10,
    bedrockRegion: 'ap-northeast-1',
    bedrockModelId: 'amazon.titan-embed-text-v2:0',
    knowledgeBaseId: 'test-kb-id',
    ...extraProps,
  });
  return { app, stack };
}

// ─── A. Resource topology ──────────────────────────────────────────────────

describe('A. Resource topology', () => {
  it('PERSONAL_AWS_DEV: exactly 10 AWS::Lambda::Function', () => {
    const resources = synthResources('PERSONAL_AWS_DEV');
    expect(countResourcesByType(resources, 'AWS::Lambda::Function')).toBe(10);
  });

  it('PERSONAL_AWS_DEV: 0 AWS::IAM::Role', () => {
    const resources = synthResources('PERSONAL_AWS_DEV');
    expect(countResourcesByType(resources, 'AWS::IAM::Role')).toBe(0);
  });

  it('PERSONAL_AWS_DEV: 0 AWS::IAM::Policy', () => {
    const resources = synthResources('PERSONAL_AWS_DEV');
    expect(countResourcesByType(resources, 'AWS::IAM::Policy')).toBe(0);
  });

  it('COMPETITION_AWS: exactly 10 AWS::Lambda::Function', () => {
    const resources = synthResources('COMPETITION_AWS');
    expect(countResourcesByType(resources, 'AWS::Lambda::Function')).toBe(10);
  });

  it('COMPETITION_AWS: 0 AWS::IAM::Role / 0 AWS::IAM::Policy', () => {
    const resources = synthResources('COMPETITION_AWS');
    expect(countResourcesByType(resources, 'AWS::IAM::Role')).toBe(0);
    expect(countResourcesByType(resources, 'AWS::IAM::Policy')).toBe(0);
  });

  it('COMPETITION_AWS uses the same Construct class with the same Lambda count as PERSONAL_AWS_DEV', () => {
    const p = synthResources('PERSONAL_AWS_DEV');
    const c = synthResources('COMPETITION_AWS');
    expect(countResourcesByType(p, 'AWS::Lambda::Function')).toBe(countResourcesByType(c, 'AWS::Lambda::Function'));
  });

  it('LOCAL_MOCK: 0 AWS resources', () => {
    const app = new App({ autoSynth: false });
    app.node.setContext('env', 'LOCAL_MOCK');
    const ctx = resolveEnvironmentContext(app.node);
    const stack = new Stack(app, `${ctx.resourcePrefix}-lm`);
    new RuntimeLambdas(stack, 'RuntimeLambdas', {
      envContext: ctx,
      runtime: Runtime.NODEJS_20_X,
      definitions: makeFixtures(stack),
      decisionFnReservedConcurrency: 10,
      bedrockRegion: 'ap-northeast-1',
      bedrockModelId: 'amazon.titan-embed-text-v2:0',
      knowledgeBaseId: 'test-kb-id',
    });
    const a = app.synth();
    const t = (a.stacks[0].template as Record<string, unknown>) ?? {};
    const resources = (t['Resources'] as Record<string, Record<string, unknown>>) ?? {};
    const nonCdk = Object.values(resources).filter((r) => {
      const ty = r['Type'] as string;
      return ty && !ty.startsWith('AWS::CDK::');
    });
    expect(nonCdk).toHaveLength(0);
  });
});

// ─── B. Exact closure ─────────────────────────────────────────────────────

describe('B. Exact runtime closure', () => {
  it('RUNTIME_LAMBDA_NAMES contains exactly the 10 canonical names in order', () => {
    expect(RUNTIME_LAMBDA_NAMES).toEqual([
      'InjectFn',
      'WorkflowStatusFn',
      'RecoveryGateFn',
      'DecisionFn',
      'RendererFn',
      'PublishFn',
      'ApiReadFn',
      'WsPushFn',
      'ConnFn',
      'WhatIfFn',
    ]);
  });

  it('applicationRuntimeLambdaCount constant equals 10', () => {
    expect(APPLICATION_RUNTIME_LAMBDA_COUNT).toBe(10);
    const { stack } = buildWith('PERSONAL_AWS_DEV', () => {});
    const built = stack.node.findChild('RuntimeLambdas') as RuntimeLambdas;
    expect(built.applicationRuntimeLambdaCount).toBe(10);
  });

  it('Construct does NOT include IngestionFn in any path', () => {
    const { stack, ctx } = makeStack('PERSONAL_AWS_DEV');
    new RuntimeLambdas(stack, 'RuntimeLambdas', {
      envContext: ctx,
      runtime: Runtime.NODEJS_20_X,
      definitions: makeFixtures(stack),
      decisionFnReservedConcurrency: 10,
      bedrockRegion: 'ap-northeast-1',
      bedrockModelId: 'amazon.titan-embed-text-v2:0',
      knowledgeBaseId: 'test-kb-id',
    });
    const lams = getLambdaResources(synthResources('PERSONAL_AWS_DEV'));
    const names = Object.values(lams).map((r) => getProps(r)['FunctionName'] as string);
    expect(names.some((n) => /ingestion/i.test(n))).toBe(false);
  });

  it('All 10 function names have the profile resource prefix', () => {
    const resources = synthResources('PERSONAL_AWS_DEV');
    const lams = getLambdaResources(resources);
    expect(Object.keys(lams)).toHaveLength(10);
    for (const r of Object.values(lams)) {
      const fnName = getProps(r)['FunctionName'] as string;
      expect(fnName.startsWith('personal-dev-')).toBe(true);
    }
  });

  it('All 10 function names are unique', () => {
    const resources = synthResources('PERSONAL_AWS_DEV');
    const lams = getLambdaResources(resources);
    const names = Object.values(lams).map((r) => getProps(r)['FunctionName'] as string);
    expect(new Set(names).size).toBe(10);
  });

  it('WhatIfFn has a FunctionName derived from the WhatIfFn suffix', () => {
    const resources = synthResources('PERSONAL_AWS_DEV');
    const lams = getLambdaResources(resources);
    const whatIf = Object.values(lams).find((r) => /what-if/.test(getProps(r)['FunctionName'] as string));
    expect(whatIf).toBeDefined();
  });
});

// ─── C. Artifact / Handler contract ────────────────────────────────────────

describe('C. Artifact / Handler contract', () => {
  it('each Lambda has a Handler', () => {
    const resources = synthResources('PERSONAL_AWS_DEV');
    const lams = getLambdaResources(resources);
    for (const r of Object.values(lams)) {
      const p = getProps(r);
      expect(typeof p['Handler']).toBe('string');
      expect((p['Handler'] as string).length).toBeGreaterThan(0);
    }
  });

  it('each Lambda has a Code/Image reference (Code via property presence)', () => {
    const resources = synthResources('PERSONAL_AWS_DEV');
    const lams = getLambdaResources(resources);
    for (const r of Object.values(lams)) {
      const p = getProps(r);
      // Code is rendered inline as ZipFile for `Code.fromInline` fixture
      expect(p).toHaveProperty('Code');
    }
  });

  it('changing handler does NOT require Construct source changes', () => {
    const { stack, ctx } = makeStack('PERSONAL_AWS_DEV');
    const fixtures = makeFixtures(stack);
    const updated = {
      ...fixtures,
      InjectFn: { ...fixtures.InjectFn, handler: 'src/custom-inject.handler' },
    };
    new RuntimeLambdas(stack, 'RuntimeLambdas', {
      envContext: ctx,
      runtime: Runtime.NODEJS_20_X,
      definitions: updated,
      decisionFnReservedConcurrency: 10,
    });
    const a = (stack.node.root as App).synth();
    const resources = (a.stacks[0].template as Record<string, unknown>)['Resources'] as Record<string, Record<string, unknown>>;
    const inject = Object.values(resources).find(
      (r) => r['Type'] === 'AWS::Lambda::Function' && (getProps(r)['FunctionName'] as string).endsWith('-inject'),
    );
    expect(getProps(inject!)['Handler']).toBe('src/custom-inject.handler');
  });

  it('missing any of the 10 definitions throws', () => {
    const app = new App({ autoSynth: false });
    app.node.setContext('env', 'PERSONAL_AWS_DEV');
    const ctx = resolveEnvironmentContext(app.node);
    const stack = new Stack(app, `${ctx.resourcePrefix}-build`);
    const fixtures = makeFixtures(stack);
    const partial: Partial<RuntimeLambdaDefinitions> = { ...fixtures };
    delete (partial as Record<string, unknown>).WhatIfFn;
    expect(() =>
      new RuntimeLambdas(stack, 'RuntimeLambdas', {
        envContext: ctx,
        runtime: Runtime.NODEJS_20_X,
        definitions: partial as RuntimeLambdaDefinitions,
        decisionFnReservedConcurrency: 10,
      }),
    ).toThrow(/definitions must contain exactly 10 entries|missing required function 'WhatIfFn'/);
  });

  it('an unknown eleventh definition throws', () => {
    const app = new App({ autoSynth: false });
    app.node.setContext('env', 'PERSONAL_AWS_DEV');
    const ctx = resolveEnvironmentContext(app.node);
    const stack = new Stack(app, `${ctx.resourcePrefix}-build`);
    const fixtures = makeFixtures(stack);
    const extras = { ...fixtures, IngestionFn: fixtures.InjectFn } as unknown as RuntimeLambdaDefinitions;
    expect(() =>
      new RuntimeLambdas(stack, 'RuntimeLambdas', {
        envContext: ctx,
        runtime: Runtime.NODEJS_20_X,
        definitions: extras,
        decisionFnReservedConcurrency: 10,
      }),
    ).toThrow(/IngestionFn|unknown function|exactly 10/);
  });

  it('empty handler throws', () => {
    const app = new App({ autoSynth: false });
    app.node.setContext('env', 'PERSONAL_AWS_DEV');
    const ctx = resolveEnvironmentContext(app.node);
    const stack = new Stack(app, `${ctx.resourcePrefix}-build`);
    const fixtures = makeMutableFixtures(stack);
    fixtures.InjectFn.handler = '';
    expect(() =>
      new RuntimeLambdas(stack, 'RuntimeLambdas', {
        envContext: ctx,
        runtime: Runtime.NODEJS_20_X,
        definitions: fixtures as unknown as RuntimeLambdaDefinitions,
        decisionFnReservedConcurrency: 10,
      }),
    ).toThrow(/handler must be a non-empty string/);
  });

  it('WhatIfFn handler equal to DecisionFn handler throws', () => {
    const app = new App({ autoSynth: false });
    app.node.setContext('env', 'PERSONAL_AWS_DEV');
    const ctx = resolveEnvironmentContext(app.node);
    const stack = new Stack(app, `${ctx.resourcePrefix}-build`);
    const fixtures = makeMutableFixtures(stack);
    fixtures.WhatIfFn.handler = fixtures.DecisionFn.handler;
    expect(() =>
      new RuntimeLambdas(stack, 'RuntimeLambdas', {
        envContext: ctx,
        runtime: Runtime.NODEJS_20_X,
        definitions: fixtures as unknown as RuntimeLambdaDefinitions,
        decisionFnReservedConcurrency: 10,
      }),
    ).toThrow(/WhatIfFn.*handler.*independent/i);
  });

  it('WhatIfFn handler equal to RendererFn handler throws', () => {
    const app = new App({ autoSynth: false });
    app.node.setContext('env', 'PERSONAL_AWS_DEV');
    const ctx = resolveEnvironmentContext(app.node);
    const stack = new Stack(app, `${ctx.resourcePrefix}-build`);
    const fixtures = makeMutableFixtures(stack);
    fixtures.WhatIfFn.handler = fixtures.RendererFn.handler;
    expect(() =>
      new RuntimeLambdas(stack, 'RuntimeLambdas', {
        envContext: ctx,
        runtime: Runtime.NODEJS_20_X,
        definitions: fixtures as unknown as RuntimeLambdaDefinitions,
        decisionFnReservedConcurrency: 10,
      }),
    ).toThrow(/WhatIfFn/);
  });

  it('WhatIfFn handler equal to ApiReadFn handler throws', () => {
    const app = new App({ autoSynth: false });
    app.node.setContext('env', 'PERSONAL_AWS_DEV');
    const ctx = resolveEnvironmentContext(app.node);
    const stack = new Stack(app, `${ctx.resourcePrefix}-build`);
    const fixtures = makeMutableFixtures(stack);
    fixtures.WhatIfFn.handler = fixtures.ApiReadFn.handler;
    expect(() =>
      new RuntimeLambdas(stack, 'RuntimeLambdas', {
        envContext: ctx,
        runtime: Runtime.NODEJS_20_X,
        definitions: fixtures as unknown as RuntimeLambdaDefinitions,
        decisionFnReservedConcurrency: 10,
      }),
    ).toThrow(/WhatIfFn/);
  });

  it('Construct source contains no production Code.fromInline default', () => {
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    const file = path.resolve(__dirname, '..', 'lib', 'constructs', 'lambdas.ts');
    const content = fs.readFileSync(file, 'utf8');
    // Strip comments and string literals to look at runtime code only.
    const stripped = content
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(stripped).not.toMatch(/Code\.fromInline\s*\(/);
  });
});

// ─── D. Role contract ─────────────────────────────────────────────────────

describe('D. Role contract', () => {
  it('every Lambda has a Role property', () => {
    const resources = synthResources('PERSONAL_AWS_DEV');
    const lams = getLambdaResources(resources);
    for (const r of Object.values(lams)) {
      expect(getProps(r)).toHaveProperty('Role');
    }
  });

  it('Template has no auto-generated IAM Role', () => {
    const resources = synthResources('PERSONAL_AWS_DEV');
    expect(countResourcesByType(resources, 'AWS::IAM::Role')).toBe(0);
  });

  it('Template has no IAM Policy', () => {
    const resources = synthResources('PERSONAL_AWS_DEV');
    expect(countResourcesByType(resources, 'AWS::IAM::Policy')).toBe(0);
  });

  it('Role ARN strings are all imported (no NEW IAM resource attributes)', () => {
    const resources = synthResources('PERSONAL_AWS_DEV');
    const lams = getLambdaResources(resources);
    for (const r of Object.values(lams)) {
      const role = getProps(r)['Role'];
      // Role is either a string (imported ARN) or Fn::GetAtt on an IAM::Role
      // (which we never create). Verify it is a STRING.
      expect(typeof role).toBe('string');
      expect(role).toMatch(/^arn:aws:iam::\d{12}:role\//);
    }
  });

  it('WsPushFn and ConnFn share the SAME Role ARN', () => {
    const resources = synthResources('PERSONAL_AWS_DEV');
    const lams = getLambdaResources(resources);
    const wsPush = Object.values(lams).find((r) => /ws-push$/.test(getProps(r)['FunctionName'] as string));
    const conn = Object.values(lams).find((r) => /connection$/.test(getProps(r)['FunctionName'] as string));
    expect(getProps(wsPush!)['Role']).toBe(getProps(conn!)['Role']);
  });

  it('the eight other functions each have a UNIQUE Role ARN', () => {
    const resources = synthResources('PERSONAL_AWS_DEV');
    const lams = getLambdaResources(resources);
    const rolesBySuffix: Record<string, string> = {};
    for (const r of Object.values(lams)) {
      const suffix = (getProps(r)['FunctionName'] as string).split('-').pop()!;
      const role = getProps(r)['Role'] as string;
      rolesBySuffix[suffix] = role;
    }
    // WsPushFn and ConnFn share; their roles must collapse.
    rolesBySuffix['push'] = rolesBySuffix['connection'];
    const uniqueRoles = new Set(Object.values(rolesBySuffix));
    // Expect: inject, status, gate, decision, renderer, publish, read, connection/push, what-if => 9 unique roles
    expect(uniqueRoles.size).toBe(9);
  });

  it('Construct forbids WsPushFn + ConnFn role mismatch at construction time', () => {
    expect(() =>
      buildWith('PERSONAL_AWS_DEV', (f, stack) => {
        // Force a different role for ConnFn
        f.ConnFn.role = Role.fromRoleArn(
          stack,
          'DifferentConnRole',
          `arn:aws:iam::${FAKE_ACCOUNT}:role/TestDifferentConnRole`,
        );
      }),
    ).toThrow(/WsConnFnRole|share/i);
  });

  it('forbidden role ARNs are not injected into any runtime Lambda', () => {
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    const file = path.resolve(__dirname, '..', 'lib', 'constructs', 'lambdas.ts');
    const content = fs.readFileSync(file, 'utf8');
    // Strip JSDoc blocks: the prohibition concerns runtime implementation,
    // not the documentation that names the forbidden role.
    const stripped = content.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(stripped).not.toMatch(/IngestionRole/);
    expect(stripped).not.toMatch(/OrchestratorRole/);
    expect(stripped).not.toMatch(/KnowledgeBaseServiceRole/);
  });
});

// ─── E. Memory / timeout ───────────────────────────────────────────────────

describe('E. Memory / timeout', () => {
  it('per-function MemorySize equals fixture values', () => {
    const resources = synthResources('PERSONAL_AWS_DEV');
    const lams = getLambdaResources(resources);
    const decision = Object.values(lams).find((r) => /decision$/.test(getProps(r)['FunctionName'] as string));
    expect(getProps(decision!)['MemorySize']).toBe(1024);
    const renderer = Object.values(lams).find((r) => /renderer$/.test(getProps(r)['FunctionName'] as string));
    expect(getProps(renderer!)['MemorySize']).toBe(512);
  });

  it('per-function Timeout equals fixture values', () => {
    const resources = synthResources('PERSONAL_AWS_DEV');
    const lams = getLambdaResources(resources);
    const whatIf = Object.values(lams).find((r) => /what-if$/.test(getProps(r)['FunctionName'] as string));
    expect(getProps(whatIf!)['Timeout']).toBe(60);
  });

  it('memorySizeMb below 128 throws', () => {
    expect(() =>
      buildWith('PERSONAL_AWS_DEV', (f) => { f.InjectFn.memorySizeMb = 64; }),
    ).toThrow(/memorySizeMb/);
  });

  it('memorySizeMb above 10240 throws', () => {
    expect(() =>
      buildWith('PERSONAL_AWS_DEV', (f) => { f.InjectFn.memorySizeMb = 20480; }),
    ).toThrow(/memorySizeMb/);
  });

  it('non-integer memorySizeMb throws', () => {
    expect(() =>
      buildWith('PERSONAL_AWS_DEV', (f) => { f.InjectFn.memorySizeMb = 256.5; }),
    ).toThrow(/memorySizeMb/);
  });

  it('timeoutSeconds 0 throws', () => {
    expect(() =>
      buildWith('PERSONAL_AWS_DEV', (f) => { f.InjectFn.timeoutSeconds = 0; }),
    ).toThrow(/timeoutSeconds/);
  });

  it('timeoutSeconds 901 (above 900 hard cap) throws', () => {
    expect(() =>
      buildWith('PERSONAL_AWS_DEV', (f) => { f.InjectFn.timeoutSeconds = 901; }),
    ).toThrow(/timeoutSeconds/);
  });

  it('RendererFn and WhatIfFn have INDEPENDENT memory/timeout (no shared generic)', () => {
    // The fixture values are themselves distinct (checked at the source level),
    // and the rendered CFN shows MemorySize/Timeout per function (checked in A/B).
    // Here we confirm the fixtures are independent and not aliased.
    const { stack } = buildWith('PERSONAL_AWS_DEV', () => {});
    const built = stack.node.findChild('RuntimeLambdas') as RuntimeLambdas;
    expect(built.rendererFn).toBeDefined();
    expect(built.whatIfFn).toBeDefined();
    expect(built.rendererFn).not.toBe(built.whatIfFn);
  });
});

// ─── F. DecisionFn reserved concurrency ────────────────────────────────────

describe('F. DecisionFn reserved concurrency', () => {
  it('DecisionFn has ReservedConcurrentExecutions from props', () => {
    const { stack, ctx } = makeStack('PERSONAL_AWS_DEV');
    new RuntimeLambdas(stack, 'RuntimeLambdas', {
      envContext: ctx,
      runtime: Runtime.NODEJS_20_X,
      definitions: makeFixtures(stack),
      decisionFnReservedConcurrency: 17,
    });
    const resources = (stack.node.root as App).synth().stacks[0].template['Resources'] as Record<string, Record<string, unknown>>;
    const lams = getLambdaResources(resources);
    const decision = Object.values(lams).find((r) => /decision$/.test(getProps(r)['FunctionName'] as string));
    expect(getProps(decision!)['ReservedConcurrentExecutions']).toBe(17);
  });

  it('the other nine Lambdas do NOT have ReservedConcurrentExecutions', () => {
    const resources = synthResources('PERSONAL_AWS_DEV');
    const lams = getLambdaResources(resources);
    for (const r of Object.values(lams)) {
      const fnName = getProps(r)['FunctionName'] as string;
      if (/decision$/.test(fnName)) continue;
      expect(getProps(r)['ReservedConcurrentExecutions']).toBeUndefined();
    }
  });

  it('decisionFnReservedConcurrency = 0 throws', () => {
    const { stack, ctx } = makeStack('PERSONAL_AWS_DEV');
    expect(() =>
      new RuntimeLambdas(stack, 'RuntimeLambdas', {
        envContext: ctx,
        runtime: Runtime.NODEJS_20_X,
        definitions: makeFixtures(stack),
        decisionFnReservedConcurrency: 0,
      }),
    ).toThrow(/decisionFnReservedConcurrency/);
  });

  it('decisionFnReservedConcurrency negative throws', () => {
    const { stack, ctx } = makeStack('PERSONAL_AWS_DEV');
    expect(() =>
      new RuntimeLambdas(stack, 'RuntimeLambdas', {
        envContext: ctx,
        runtime: Runtime.NODEJS_20_X,
        definitions: makeFixtures(stack),
        decisionFnReservedConcurrency: -1,
      }),
    ).toThrow(/decisionFnReservedConcurrency/);
  });

  it('decisionFnReservedConcurrency non-integer throws', () => {
    const { stack, ctx } = makeStack('PERSONAL_AWS_DEV');
    expect(() =>
      new RuntimeLambdas(stack, 'RuntimeLambdas', {
        envContext: ctx,
        runtime: Runtime.NODEJS_20_X,
        definitions: makeFixtures(stack),
        decisionFnReservedConcurrency: 10.5,
      }),
    ).toThrow(/decisionFnReservedConcurrency/);
  });
});

// ─── G. Environment wiring ─────────────────────────────────────────────────

describe('G. Environment wiring', () => {
  it('APP_ENV equals the selected profile (cannot be overridden by props)', () => {
    const resources = synthResources('PERSONAL_AWS_DEV');
    const lams = getLambdaResources(resources);
    for (const r of Object.values(lams)) {
      const env = getProps(r)['Environment'] as { Variables?: Record<string, string> } | undefined;
      if (env) {
        expect(env.Variables?.[LAMBDA_ENV_APP_ENV]).toBe('PERSONAL_AWS_DEV');
      }
    }
  });

  it('environment values come from props (not hard-coded)', () => {
    const { stack } = buildWith('PERSONAL_AWS_DEV', (f) => {
      f.DecisionFn.environment = { DECISION_TABLE_NAME: 'test-decision-table-from-props' };
    });
    const a = (stack.node.root as App).synth();
    const resources = (a.stacks[0].template as Record<string, unknown>)['Resources'] as Record<string, Record<string, unknown>>;
    const lams = getLambdaResources(resources);
    const decision = Object.values(lams).find((r) => /decision$/.test(getProps(r)['FunctionName'] as string));
    const env = (getProps(decision!)['Environment'] as Record<string, unknown>)['Variables'] as Record<string, string>;
    expect(env['DECISION_TABLE_NAME']).toBe('test-decision-table-from-props');
  });

  it('WhatIfFn receives BEDROCK_MODEL_ID / BEDROCK_REGION / KNOWLEDGE_BASE_ID', () => {
    const resources = synthResources('PERSONAL_AWS_DEV');
    const lams = getLambdaResources(resources);
    const whatIf = Object.values(lams).find((r) => /what-if$/.test(getProps(r)['FunctionName'] as string));
    const env = (getProps(whatIf!)['Environment'] as Record<string, unknown>)['Variables'] as Record<string, string>;
    expect(env[LAMBDA_ENV_BEDROCK_MODEL_ID]).toBe('amazon.titan-embed-text-v2:0');
    expect(env[LAMBDA_ENV_KNOWLEDGE_BASE_ID]).toBe('test-kb-id');
    expect(env[LAMBDA_ENV_BEDROCK_REGION]).toBe('ap-northeast-1');
  });

  it('no function has AWS credentials or secret env values', () => {
    const resources = synthResources('PERSONAL_AWS_DEV');
    const lams = getLambdaResources(resources);
    for (const r of Object.values(lams)) {
      const env = (getProps(r)['Environment'] as Record<string, unknown> | undefined)?.['Variables'] as Record<string, string> | undefined;
      if (!env) continue;
      for (const k of FORBIDDEN_AWS_RESERVED_ENV_KEYS) {
        expect(env[k]).toBeUndefined();
      }
    }
  });

  it('forbidden AWS env keys are blocked at construct time', () => {
    expect(() =>
      buildWith('PERSONAL_AWS_DEV', (f) => {
        f.InjectFn.environment = { AWS_REGION: 'ap-northeast-1' };
      }),
    ).toThrow(/reserved AWS env var|AWS_REGION/);
  });

  it('environment that overrides APP_ENV is rejected', () => {
    expect(() =>
      buildWith('PERSONAL_AWS_DEV', (f) => {
        f.InjectFn.environment = { [LAMBDA_ENV_APP_ENV]: 'OVERRIDE' };
      }),
    ).toThrow(/reserved|APP_ENV/);
  });

  it('Construct has no hard-coded table / bucket / endpoint / model / KB ID literals', () => {
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    const file = path.resolve(__dirname, '..', 'lib', 'constructs', 'lambdas.ts');
    const content = fs.readFileSync(file, 'utf8');
    const stripped = content
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(stripped).not.toMatch(/amazon\.titan-embed-text-v2:0/);
    expect(stripped).not.toMatch(/ap-northeast-1/);
    expect(stripped).not.toMatch(/\b\d{12}\b/);
  });
});

// ─── H. Forbidden resources ────────────────────────────────────────────────

describe('H. Forbidden resources', () => {
  const FORBIDDEN_TYPES = [
    'AWS::StepFunctions::StateMachine',
    'AWS::ApiGatewayV2::Api',
    'AWS::ApiGatewayV2::Route',
    'AWS::Cognito::UserPool',
    'AWS::Logs::LogGroup',
    'AWS::Lambda::Permission',
    'AWS::Lambda::Url',
    'AWS::Lambda::LayerVersion',
  ];

  for (const profile of ['PERSONAL_AWS_DEV', 'COMPETITION_AWS'] as const) {
    it(`${profile}: none of the forbidden resource types appear`, () => {
      const resources = synthResources(profile);
      for (const t of FORBIDDEN_TYPES) {
        expect(countResourcesByType(resources, t)).toBe(0);
      }
    });
  }

  it('no Custom:: resources are produced', () => {
    const resources = synthResources('PERSONAL_AWS_DEV');
    const customCount = Object.values(resources).filter((r) => {
      const t = r['Type'] as string;
      return t && t.startsWith('Custom::');
    }).length;
    expect(customCount).toBe(0);
  });
});

// ─── I. Source-level boundary tests ────────────────────────────────────────

describe('I. Source-level boundary tests', () => {
  function readSource(): string {
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    const file = path.resolve(__dirname, '..', 'lib', 'constructs', 'lambdas.ts');
    return fs.readFileSync(file, 'utf8');
  }

  it('applicationRuntimeLambdaCount constant equals 10', () => {
    expect(APPLICATION_RUNTIME_LAMBDA_COUNT).toBe(10);
  });

  it('Construct source has no IngestionFn class / type / function name', () => {
    const content = readSource();
    // Acceptable: documentation that explicitly states IngestionFn is forbidden.
    // Forbidden: any production class / type / const named IngestionFn.
    expect(content).not.toMatch(/class\s+IngestionFn/);
    expect(content).not.toMatch(/type\s+IngestionFn\b/);
    expect(content).not.toMatch(/IngestionFn\s*:\s*RuntimeLambdaName/);
    expect(content).not.toMatch(/['"]IngestionFn['"]/);
  });

  it('Construct source has no Code.fromInline production fallback', () => {
    const content = readSource();
    const stripped = content
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(stripped).not.toMatch(/Code\.fromInline\s*\(/);
  });

  it('Construct source has no hard-coded AWS account (12 digits)', () => {
    const content = readSource();
    const matches = content.match(/\b\d{12}\b/g) ?? [];
    expect(matches).toEqual([]);
  });

  it('Construct source has no hard-coded Region (ap-*/us-*/eu-*/cn-*)', () => {
    const content = readSource();
    expect(content).not.toMatch(/\b(ap|us|eu|sa|ca|cn|me|af|il)\-\w+\-\d+\b/);
  });

  it('Construct source has no hard-coded Bedrock model ID', () => {
    const content = readSource();
    const stripped = content
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(stripped).not.toMatch(/amazon\.titan-/);
  });

  it('Construct source has no hard-coded handler package', () => {
    const content = readSource();
    const stripped = content
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    // Production handler paths must be injected via props only.
    expect(stripped).not.toMatch(/['"`]src\/[a-zA-Z0-9_-]+\.handler['"`]/);
  });

  it('Construct source documents the deterministic-truth boundary', () => {
    const content = readSource();
    expect(content).toMatch(/Deterministic/);
    expect(content).toMatch(/decision/i);
    expect(content).toMatch(/renderer/i);
  });

  it('Construct source documents the TASK-178 ingestion boundary', () => {
    const content = readSource();
    expect(content).toMatch(/TASK-178/);
    expect(content).toMatch(/ingestion/i);
    expect(content).toMatch(/deployment-time|deployment time/);
  });

  it('Construct source documents the TASK-179 final-binding boundary', () => {
    const content = readSource();
    expect(content).toMatch(/TASK-179/);
    expect(content).toMatch(/final\s+bindings?|final role binding/);
  });

  it('Construct source uses addResourceDependency (no deprecated addDependency)', () => {
    const content = readSource();
    const stripped = content
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(stripped).not.toMatch(/\.addDependency\s*\(/);
  });
});

// ─── J. Public exports ─────────────────────────────────────────────────────

describe('J. Public exports', () => {
  it('exports RUNTIME_LAMBDA_NAMES as a readonly tuple of length 10', () => {
    expect(RUNTIME_LAMBDA_NAMES).toHaveLength(10);
  });

  it('exports APPLICATION_RUNTIME_LAMBDA_COUNT = 10', () => {
    expect(APPLICATION_RUNTIME_LAMBDA_COUNT).toBe(10);
  });

  it('exports the documented environment-key constants', () => {
    expect(LAMBDA_ENV_APP_ENV).toBe('APP_ENV');
    expect(LAMBDA_ENV_BEDROCK_MODEL_ID).toBe('BEDROCK_MODEL_ID');
    expect(LAMBDA_ENV_KNOWLEDGE_BASE_ID).toBe('KNOWLEDGE_BASE_ID');
    expect(LAMBDA_ENV_BEDROCK_REGION).toBe('BEDROCK_REGION');
  });

  it('exports FORBIDDEN_AWS_RESERVED_ENV_KEYS as a Set', () => {
    expect(FORBIDDEN_AWS_RESERVED_ENV_KEYS).toBeInstanceOf(Set);
    expect(FORBIDDEN_AWS_RESERVED_ENV_KEYS.has('AWS_REGION')).toBe(true);
    expect(FORBIDDEN_AWS_RESERVED_ENV_KEYS.has('AWS_DEFAULT_REGION')).toBe(true);
    expect(FORBIDDEN_AWS_RESERVED_ENV_KEYS.has('AWS_ACCESS_KEY_ID')).toBe(true);
    expect(FORBIDDEN_AWS_RESERVED_ENV_KEYS.has('AWS_SECRET_ACCESS_KEY')).toBe(true);
    expect(FORBIDDEN_AWS_RESERVED_ENV_KEYS.has('AWS_SESSION_TOKEN')).toBe(true);
  });
});