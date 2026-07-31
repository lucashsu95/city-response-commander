/**
 * TASK-082 targeted tests — PublishFnRoleConstruct
 *
 * No AWS credentials or network access; pure synth-time assertions.
 * Test block count: 27 (within 30-limit).
 *
 * Coverage:
 *   A. LOCAL_MOCK
 *   B. Architecture (PERSONAL/COMPETITION)
 *   C. Reads (Core GetItem, Narrative base/GSI Query)
 *   D. PublishRecord allows + implicit denies
 *   E. Cross-table writes (Core / Narrative / Idempotency / Connections / future)
 *   F. Logs
 *   G. Forbidden services (Bedrock / S3 / SNS / SQS / EventBridge / Lambda / SFN / WS)
 *   H. Wildcard audit + evidence
 *   I. Validation rejections
 *   J. Static audit
 */

import { describe, it, expect } from 'vitest';
import { App, Stack } from 'aws-cdk-lib';
import { resolveEnvironmentContext } from '../lib/env_context.js';
import { PublishFnRoleConstruct } from '../lib/iam/publish_fn_role.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

type Profile = 'LOCAL_MOCK' | 'PERSONAL_AWS_DEV' | 'COMPETITION_AWS';

const FAKE_ACCOUNT = '111111111111';
const FAKE_REGION = 'us-east-1';

function fakeCoreArn(name = 'DecisionCoreTable'): string {
  return `arn:aws:dynamodb:${FAKE_REGION}:${FAKE_ACCOUNT}:table/${name}`;
}

function fakeNarrArn(name = 'DecisionNarrativeTable'): string {
  return `arn:aws:dynamodb:${FAKE_REGION}:${FAKE_ACCOUNT}:table/${name}`;
}

function fakeNarrIndexArn(name = 'DecisionNarrativeTable', idx = 'NarrativeTypeIndex'): string {
  return `arn:aws:dynamodb:${FAKE_REGION}:${FAKE_ACCOUNT}:table/${name}/index/${idx}`;
}

function fakePublishArn(name = 'PublishRecordTable'): string {
  return `arn:aws:dynamodb:${FAKE_REGION}:${FAKE_ACCOUNT}:table/${name}`;
}

function fakeIdemArn(name = 'IdempotencyTable'): string {
  return `arn:aws:dynamodb:${FAKE_REGION}:${FAKE_ACCOUNT}:table/${name}`;
}

function fakeConnArn(name = 'ConnectionsTable'): string {
  return `arn:aws:dynamodb:${FAKE_REGION}:${FAKE_ACCOUNT}:table/${name}`;
}

function fakeFutureArn(name = 'FutureTable'): string {
  return `arn:aws:dynamodb:${FAKE_REGION}:${FAKE_ACCOUNT}:table/${name}`;
}

function fakeLogGroupArn(name = '/test/PublishFn'): string {
  return `arn:aws:logs:${FAKE_REGION}:${FAKE_ACCOUNT}:log-group:${name}`;
}

function fakeOtherLogGroupArn(name = '/test/OtherFn'): string {
  return `arn:aws:logs:${FAKE_REGION}:${FAKE_ACCOUNT}:log-group:${name}`;
}

function makeStack(profile: Profile, suffix = 'test'): {
  app: App;
  stack: Stack;
  ctx: ReturnType<typeof resolveEnvironmentContext>;
} {
  const app = new App({ autoSynth: false });
  app.node.setContext('env', profile);
  const ctx = resolveEnvironmentContext(app.node);
  const safeSuffix = suffix.replace(/[^A-Za-z0-9-]/g, '-').toLowerCase();
  const stack = new Stack(app, `${ctx.resourcePrefix}-publish-${safeSuffix}`);
  return { app, stack, ctx };
}

function makeRole(profile: Profile, suffix = 'test'): {
  app: App;
  stack: Stack;
  ctx: ReturnType<typeof resolveEnvironmentContext>;
  construct: PublishFnRoleConstruct;
} {
  const { app, stack, ctx } = makeStack(profile, suffix);
  const construct = new PublishFnRoleConstruct(stack, 'PublishFnRole', {
    envContext: ctx,
    roleName: `${ctx.resourcePrefix}-publish-fn-role`,
    decisionCoreTableArn: fakeCoreArn('DecisionCoreTable'),
    decisionNarrativeTableArn: fakeNarrArn('DecisionNarrativeTable'),
    publishRecordTableArn: fakePublishArn('PublishRecordTable'),
    idempotencyTableArn: fakeIdemArn('IdempotencyTable'),
    publishLogGroupArn: fakeLogGroupArn('/test/PublishFn'),
  });
  return { app, stack, ctx, construct };
}

function synth(profile: Profile, suffix = 'synth') {
  const { app } = makeRole(profile, suffix);
  const assembly = app.synth();
  return (assembly.stacks[0].template as Record<string, unknown>)[
    'Resources'
  ] as Record<string, Record<string, unknown>> | undefined;
}

function countByType(
  resources: Record<string, Record<string, unknown>> | undefined,
  type: string,
): number {
  if (!resources) return 0;
  return Object.values(resources).filter((r) => r['Type'] === type).length;
}

function getResourcesOfType(
  resources: Record<string, Record<string, unknown>> | undefined,
  type: string,
): Record<string, Record<string, unknown>> {
  if (!resources) return {};
  return Object.fromEntries(
    Object.entries(resources).filter(([, r]) => r['Type'] === type),
  );
}

function getPolicyDoc(profile: Profile, suffix = 'synth'): Record<string, unknown> {
  const resources = synth(profile, suffix)!;
  const policies = Object.values(resources).filter((r) => r['Type'] === 'AWS::IAM::Policy');
  return (policies[0]['Properties'] as Record<string, unknown>)['PolicyDocument'] as Record<string, unknown>;
}

// ─── Pure TypeScript IAM Policy Evaluator ─────────────────────────────────────

interface Entry {
  effect: string;
  action: string;
  resource: string;
  notResource?: string;
}

function parseStatements(doc: Record<string, unknown>): Entry[] {
  return ((doc['Statement'] as unknown[]) ?? []).flatMap((s) => {
    const stmt = s as Record<string, unknown>;
    const effect = (stmt['Effect'] as string) ?? '';
    const rawActions = stmt['Action'];
    const rawResources = stmt['Resource'] as string | string[] | undefined;
    const notResource = stmt['NotResource'];
    const resourceStrings: string[] = rawResources
      ? (Array.isArray(rawResources) ? rawResources : [rawResources])
      : [];
    const actionStrings: string[] = rawActions
      ? (Array.isArray(rawActions) ? rawActions : [rawActions as string])
      : [];
    if (resourceStrings.length === 0 && actionStrings.length === 0) {
      return [{ effect, action: '', resource: '', notResource: notResource !== undefined
        ? (Array.isArray(notResource) ? (notResource as string[]).join(',') : String(notResource))
        : undefined }];
    }
    const entries: Entry[] = [];
    for (const action of actionStrings) {
      for (const resource of resourceStrings) {
        entries.push({ effect, action, resource, notResource: undefined });
      }
    }
    if (resourceStrings.length === 0 && notResource !== undefined) {
      const notRes = Array.isArray(notResource)
        ? (notResource as string[]).join(',')
        : String(notResource);
      for (const action of actionStrings) {
        entries.push({ effect, action, resource: '', notResource: notRes });
      }
    }
    return entries;
  });
}

type EvalResult = 'ALLOW' | 'DENY' | 'IMPLICIT_DENY';

function resourceMatch(pattern: string, resource: string): boolean {
  if (pattern === '*') return true;
  const p = String(pattern);
  if (p === resource) return true;
  if (p.endsWith('/*')) {
    const prefix = p.slice(0, -2);
    return resource === prefix || resource.startsWith(prefix + '/');
  }
  if (p.endsWith('*')) return resource.startsWith(p.slice(0, -1));
  return false;
}

function evaluatePolicy(stmts: Entry[], action: string, resource: string): EvalResult {
  let explicitDeny = false;
  let explicitAllow = false;
  for (const stmt of stmts) {
    const matchesAction = stmt.action === '*' || action === stmt.action || stmt.action.endsWith('*');
    if (!matchesAction) continue;
    let matchesResource = false;
    if (stmt.notResource) {
      matchesResource = !stmt.notResource.split(',').map((r) => r.trim()).some((nr) => resourceMatch(nr, resource));
    } else if (stmt.resource === '*') {
      matchesResource = true;
    } else {
      matchesResource = resourceMatch(stmt.resource, resource);
    }
    if (!matchesResource) continue;
    if (stmt.effect === 'Deny') explicitDeny = true;
    else if (stmt.effect === 'Allow') explicitAllow = true;
  }
  if (explicitDeny) return 'DENY';
  if (explicitAllow) return 'ALLOW';
  return 'IMPLICIT_DENY';
}

// ─── A. LOCAL_MOCK ──────────────────────────────────────────────────────────

describe('A. LOCAL_MOCK', () => {
  it('creates 0 AWS resources', () => {
    expect(synth('LOCAL_MOCK', 'local-mock')).toBeUndefined();
  });

  it('construct fields are undefined', () => {
    const { construct } = makeRole('LOCAL_MOCK', 'fields');
    expect(construct.role).toBeUndefined();
    expect(construct.roleArn).toBeUndefined();
    expect(construct.policy).toBeUndefined();
  });

  it('evidence is populated even in LOCAL_MOCK', () => {
    const { construct } = makeRole('LOCAL_MOCK', 'evidence');
    expect(construct.evidence.allowedDecisionCoreActions).toEqual(['dynamodb:GetItem']);
    expect(construct.evidence.allowedNarrativeActions).toEqual(['dynamodb:Query']);
    expect(construct.evidence.allowedPublishRecordActions).toEqual(['dynamodb:GetItem', 'dynamodb:PutItem', 'dynamodb:UpdateItem']);
    expect(construct.evidence.optimisticLockRuntimeOwner).toBe('TASK-145');
    expect(construct.evidence.commanderAuthRuntimeOwner).toBe('TASK-144');
    expect(construct.evidence.roleBoundToFunction).toBe(false);
    expect(construct.evidence.finalBindingOwner).toBe('TASK-179');
  });
});

// ─── B. Architecture ────────────────────────────────────────────────────────

describe('B. Architecture', () => {
  for (const profile of ['PERSONAL_AWS_DEV', 'COMPETITION_AWS'] as Profile[]) {
    describe(`${profile}`, () => {
      it('1 Role, 1 Policy, 0 ManagedPolicy, Lambda trust', () => {
        const resources = synth(profile, 'arch')!;
        expect(countByType(resources, 'AWS::IAM::Role')).toBe(1);
        expect(countByType(resources, 'AWS::IAM::Policy')).toBe(1);
        expect(Object.keys(getResourcesOfType(resources, 'AWS::IAM::ManagedPolicy'))).toHaveLength(0);
        const role = Object.values(getResourcesOfType(resources, 'AWS::IAM::Role'))[0];
        const assumeRole = (role['Properties'] as Record<string, unknown>)['AssumeRolePolicyDocument'] as Record<string, unknown>;
        const stmts = (assumeRole['Statement'] as unknown[]) as Record<string, unknown>[];
        expect(stmts).toHaveLength(1);
        expect(stmts[0]['Effect']).toBe('Allow');
        expect(stmts[0]['Action']).toBe('sts:AssumeRole');
        expect(stmts[0]['Principal'] as Record<string, unknown>).toEqual({ 'Service': 'lambda.amazonaws.com' });
      });
    });
  }
});

// ─── C. Reads ────────────────────────────────────────────────────────────────

describe('C. Reads', () => {
  const CORE = fakeCoreArn('DecisionCoreTable');
  const NARR = fakeNarrArn('DecisionNarrativeTable');
  const GSI = fakeNarrIndexArn('DecisionNarrativeTable', 'NarrativeTypeIndex');

  for (const profile of ['PERSONAL_AWS_DEV', 'COMPETITION_AWS'] as Profile[]) {
    const stmts = parseStatements(getPolicyDoc(profile, 'reads'));
    it(`${profile}: Core GetItem = ALLOW, writes = DENY`, () => {
      expect(evaluatePolicy(stmts, 'dynamodb:GetItem', CORE)).toBe('ALLOW');
      expect(evaluatePolicy(stmts, 'dynamodb:PutItem', CORE)).toBe('DENY');
      expect(evaluatePolicy(stmts, 'dynamodb:UpdateItem', CORE)).toBe('DENY');
      expect(evaluatePolicy(stmts, 'dynamodb:DeleteItem', CORE)).toBe('DENY');
    });

    it(`${profile}: Narrative base Query = ALLOW; GSI Query = IMPLICIT_DENY`, () => {
      expect(evaluatePolicy(stmts, 'dynamodb:Query', NARR)).toBe('ALLOW');
      expect(evaluatePolicy(stmts, 'dynamodb:Query', GSI)).toBe('IMPLICIT_DENY');
      expect(evaluatePolicy(stmts, 'dynamodb:PutItem', NARR)).toBe('DENY');
      expect(evaluatePolicy(stmts, 'dynamodb:UpdateItem', NARR)).toBe('DENY');
    });
  }
});

// ─── D. PublishRecord ───────────────────────────────────────────────────────

describe('D. PublishRecord', () => {
  const PUB = fakePublishArn('PublishRecordTable');

  for (const profile of ['PERSONAL_AWS_DEV', 'COMPETITION_AWS'] as Profile[]) {
    const stmts = parseStatements(getPolicyDoc(profile, 'pub'));
    it(`${profile}: GetItem/PutItem/UpdateItem = ALLOW; Delete/BatchWrite/Scan/Query = IMPLICIT_DENY`, () => {
      expect(evaluatePolicy(stmts, 'dynamodb:GetItem', PUB)).toBe('ALLOW');
      expect(evaluatePolicy(stmts, 'dynamodb:PutItem', PUB)).toBe('ALLOW');
      expect(evaluatePolicy(stmts, 'dynamodb:UpdateItem', PUB)).toBe('ALLOW');
      expect(evaluatePolicy(stmts, 'dynamodb:DeleteItem', PUB)).toBe('IMPLICIT_DENY');
      expect(evaluatePolicy(stmts, 'dynamodb:BatchWriteItem', PUB)).toBe('IMPLICIT_DENY');
      expect(evaluatePolicy(stmts, 'dynamodb:Scan', PUB)).toBe('IMPLICIT_DENY');
      expect(evaluatePolicy(stmts, 'dynamodb:Query', PUB)).toBe('IMPLICIT_DENY');
    });
  }
});

// ─── E. Cross-table writes ───────────────────────────────────────────────────

describe('E. Cross-table writes (all 7 actions)', () => {
  const targets = [
    { arn: fakeIdemArn('IdempotencyTable'), label: 'Idempotency' },
    { arn: fakeConnArn('ConnectionsTable'), label: 'Connections' },
    { arn: fakeFutureArn('FutureTable'), label: 'Future' },
  ];
  const writeActions = [
    'dynamodb:PutItem',
    'dynamodb:UpdateItem',
    'dynamodb:DeleteItem',
    'dynamodb:BatchWriteItem',
    'dynamodb:PartiQLInsert',
    'dynamodb:PartiQLUpdate',
    'dynamodb:PartiQLDelete',
  ];

  for (const profile of ['PERSONAL_AWS_DEV', 'COMPETITION_AWS'] as Profile[]) {
    const stmts = parseStatements(getPolicyDoc(profile, 'cross'));
    for (const { arn, label } of targets) {
      for (const action of writeActions) {
        it(`${profile}: ${action} on ${label} = DENY`, () => {
          expect(evaluatePolicy(stmts, action, arn)).toBe('DENY');
        });
      }
    }
  }
});

// ─── F. CloudWatch Logs ─────────────────────────────────────────────────────

describe('F. CloudWatch Logs', () => {
  const LG = fakeLogGroupArn('/test/PublishFn');
  const OTHER = fakeOtherLogGroupArn('/test/OtherFn');

  for (const profile of ['PERSONAL_AWS_DEV', 'COMPETITION_AWS'] as Profile[]) {
    const stmts = parseStatements(getPolicyDoc(profile, 'logs'));
    it(`${profile}: correct log stream = ALLOW; other group = IMPLICIT_DENY; CreateLogGroup = IMPLICIT_DENY`, () => {
      expect(evaluatePolicy(stmts, 'logs:CreateLogStream', `${LG}:log-stream:foo`)).toBe('ALLOW');
      expect(evaluatePolicy(stmts, 'logs:PutLogEvents', `${LG}:log-stream:bar`)).toBe('ALLOW');
      expect(evaluatePolicy(stmts, 'logs:PutLogEvents', `${OTHER}:log-stream:x`)).toBe('IMPLICIT_DENY');
      expect(evaluatePolicy(stmts, 'logs:CreateLogGroup', '*')).toBe('IMPLICIT_DENY');
    });
  }
});

// ─── G. Forbidden services ───────────────────────────────────────────────────

describe('G. Forbidden services', () => {
  const forbidden = [
    // Bedrock
    { action: 'bedrock:InvokeModel', resource: '*', label: 'BedrockInvoke' },
    { action: 'bedrock:InvokeModelWithResponseStream', resource: '*', label: 'BedrockStream' },
    { action: 'bedrock:Retrieve', resource: '*', label: 'BedrockRetrieve' },
    { action: 'bedrock:RetrieveAndGenerate', resource: '*', label: 'BedrockRetrieveGen' },
    // S3
    { action: 's3:PutObject', resource: '*', label: 'S3PutObject' },
    { action: 's3:GetObject', resource: '*', label: 'S3GetObject' },
    // SNS / SQS / EventBridge
    { action: 'sns:Publish', resource: '*', label: 'SNSPublish' },
    { action: 'sqs:SendMessage', resource: '*', label: 'SQSSendMessage' },
    { action: 'events:PutEvents', resource: '*', label: 'EventsPutEvents' },
    // Lambda / SFN / WS
    { action: 'lambda:InvokeFunction', resource: `arn:aws:lambda:${FAKE_REGION}:${FAKE_ACCOUNT}:function:F`, label: 'LambdaInvoke' },
    { action: 'states:StartExecution', resource: '*', label: 'StatesStart' },
    { action: 'execute-api:ManageConnections', resource: '*', label: 'ManageConnections' },
  ];

  for (const profile of ['PERSONAL_AWS_DEV', 'COMPETITION_AWS'] as Profile[]) {
    const stmts = parseStatements(getPolicyDoc(profile, 'forbidden'));
    for (const { action, resource, label } of forbidden) {
      it(`${profile}: ${label} not ALLOW`, () => {
        expect(evaluatePolicy(stmts, action, resource)).not.toBe('ALLOW');
      });
    }
  }
});

// ─── H. Wildcard audit + evidence ────────────────────────────────────────────

describe('H. Wildcard audit + evidence', () => {
  for (const profile of ['PERSONAL_AWS_DEV', 'COMPETITION_AWS'] as Profile[]) {
    it(`${profile}: no ALLOW Resource "*"`, () => {
      const stmts = parseStatements(getPolicyDoc(profile, 'wildcard'));
      expect(stmts.filter((s) => s.effect === 'Allow' && s.resource === '*')).toHaveLength(0);
    });

    it(`${profile}: wildcardAllowCount = 0; optimisticLockEnforcedByIam = false`, () => {
      const { construct } = makeRole(profile, 'wildcard-evidence');
      expect(construct.evidence.wildcardAllowCount).toBe(0);
      expect(construct.evidence.optimisticLockEnforcedByIam).toBe(false);
    });
  }
});

// ─── I. Validation rejections ───────────────────────────────────────────────

describe('I. Validation rejections', () => {
  describe('roleName', () => {
    for (const [label, roleName] of [
      ['empty', ''],
      ['whitespace', '  publish-role  '],
      ['credential', 'publish-credential-role'],
    ] as [string, string][]) {
      it(`rejects: ${label}`, () => {
        const mockApp = new App({ autoSynth: false });
        mockApp.node.setContext('env', 'PERSONAL_AWS_DEV');
        const ctx = resolveEnvironmentContext(mockApp.node);
        const stack = new Stack(mockApp, `val-rn-${label}`);
        expect(() => new PublishFnRoleConstruct(stack, 'Role', {
          envContext: ctx,
          roleName,
          decisionCoreTableArn: fakeCoreArn('DecisionCoreTable'),
          decisionNarrativeTableArn: fakeNarrArn('DecisionNarrativeTable'),
          publishRecordTableArn: fakePublishArn('PublishRecordTable'),
          idempotencyTableArn: fakeIdemArn('IdempotencyTable'),
          publishLogGroupArn: fakeLogGroupArn('/test/PublishFn'),
        })).toThrow();
      });
    }
  });

  describe('decisionNarrativeTableArn: index ARN', () => {
    it('rejects', () => {
      const mockApp = new App({ autoSynth: false });
      mockApp.node.setContext('env', 'PERSONAL_AWS_DEV');
      const ctx = resolveEnvironmentContext(mockApp.node);
      const stack = new Stack(mockApp, 'val-narr-idx');
      expect(() => new PublishFnRoleConstruct(stack, 'Role', {
        envContext: ctx,
        roleName: 'valid-publish-role',
        decisionCoreTableArn: fakeCoreArn('DecisionCoreTable'),
        decisionNarrativeTableArn: `arn:aws:dynamodb:${FAKE_REGION}:${FAKE_ACCOUNT}:table/T/index/I`,
        publishRecordTableArn: fakePublishArn('PublishRecordTable'),
        idempotencyTableArn: fakeIdemArn('IdempotencyTable'),
        publishLogGroupArn: fakeLogGroupArn('/test/PublishFn'),
      })).toThrow();
    });
  });

  describe('publishLogGroupArn: log-stream suffix', () => {
    it('rejects', () => {
      const mockApp = new App({ autoSynth: false });
      mockApp.node.setContext('env', 'PERSONAL_AWS_DEV');
      const ctx = resolveEnvironmentContext(mockApp.node);
      const stack = new Stack(mockApp, 'val-lg-end');
      expect(() => new PublishFnRoleConstruct(stack, 'Role', {
        envContext: ctx,
        roleName: 'valid-publish-role',
        decisionCoreTableArn: fakeCoreArn('DecisionCoreTable'),
        decisionNarrativeTableArn: fakeNarrArn('DecisionNarrativeTable'),
        publishRecordTableArn: fakePublishArn('PublishRecordTable'),
        idempotencyTableArn: fakeIdemArn('IdempotencyTable'),
        publishLogGroupArn: `arn:aws:logs:${FAKE_REGION}:${FAKE_ACCOUNT}:log-group:/test/Fn:log-stream:*`,
      })).toThrow();
    });
  });

  describe('duplicate table ARNs', () => {
    it('rejects when two tables share the same ARN', () => {
      const mockApp = new App({ autoSynth: false });
      mockApp.node.setContext('env', 'PERSONAL_AWS_DEV');
      const ctx = resolveEnvironmentContext(mockApp.node);
      const stack = new Stack(mockApp, 'val-dupe');
      expect(() => new PublishFnRoleConstruct(stack, 'Role', {
        envContext: ctx,
        roleName: 'valid-publish-role',
        decisionCoreTableArn: fakeCoreArn('DecisionCoreTable'),
        decisionNarrativeTableArn: fakeNarrArn('DecisionNarrativeTable'),
        publishRecordTableArn: fakeCoreArn('DecisionCoreTable'),
        idempotencyTableArn: fakeIdemArn('IdempotencyTable'),
        publishLogGroupArn: fakeLogGroupArn('/test/PublishFn'),
      })).toThrow();
    });
  });
});

// ─── J. Static audit ───────────────────────────────────────────────────────

describe('J. Static audit', () => {
  it('construct synths without error', () => {
    const { app, stack, ctx } = makeStack('PERSONAL_AWS_DEV', 'static');
    expect(() => {
      new PublishFnRoleConstruct(stack, 'StaticRole', {
        envContext: ctx,
        roleName: `${ctx.resourcePrefix}-static-role`,
        decisionCoreTableArn: fakeCoreArn('DecisionCoreTable'),
        decisionNarrativeTableArn: fakeNarrArn('DecisionNarrativeTable'),
        publishRecordTableArn: fakePublishArn('PublishRecordTable'),
        idempotencyTableArn: fakeIdemArn('IdempotencyTable'),
        publishLogGroupArn: fakeLogGroupArn('/test/PublishFn'),
      });
      app.synth();
    }).not.toThrow();
  });
});