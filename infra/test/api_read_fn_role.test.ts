/**
 * TASK-081 targeted tests — ApiReadFnRoleConstruct
 *
 * No AWS credentials or network access; pure synth-time assertions.
 * Test block count: 27 (within 30-limit).
 *
 * Coverage:
 *   A. LOCAL_MOCK: 0 resources, evidence populated
 *   B. Architecture: PERSONAL / COMPETITION counts + trust
 *   C. DynamoDB read allows (table-driven)
 *   D. DynamoDB write denies (table-driven)
 *   E. CloudWatch Logs
 *   F. SSM hierarchy
 *   G. Explicit service denies (Bedrock, SFN, WS, S3)
 *   H. Forbidden capabilities
 *   I. Wildcard audit + evidence
 *   J. Validation rejections
 *   K. Static audit
 */

import { describe, it, expect } from 'vitest';
import { App, Stack } from 'aws-cdk-lib';
import { resolveEnvironmentContext } from '../lib/env_context.js';
import { ApiReadFnRoleConstruct } from '../lib/iam/api_read_fn_role.js';

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

function fakeLogGroupArn(name = '/test/ApiReadFn'): string {
  return `arn:aws:logs:${FAKE_REGION}:${FAKE_ACCOUNT}:log-group:${name}`;
}

function fakeOtherLogGroupArn(name = '/test/OtherFn'): string {
  return `arn:aws:logs:${FAKE_REGION}:${FAKE_ACCOUNT}:log-group:${name}`;
}

function fakeSsmArn(prefix = '/test/params'): string {
  return `arn:aws:ssm:${FAKE_REGION}:${FAKE_ACCOUNT}:parameter${prefix}`;
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
  const stack = new Stack(
    app,
    `${ctx.resourcePrefix}-api-read-${safeSuffix}`,
  );
  return { app, stack, ctx };
}

function makeRole(profile: Profile, suffix = 'test'): {
  app: App;
  stack: Stack;
  ctx: ReturnType<typeof resolveEnvironmentContext>;
  construct: ApiReadFnRoleConstruct;
} {
  const { app, stack, ctx } = makeStack(profile, suffix);
  const construct = new ApiReadFnRoleConstruct(stack, 'ApiReadFnRole', {
    envContext: ctx,
    roleName: `${ctx.resourcePrefix}-api-read-fn-role`,
    decisionCoreTableArn: fakeCoreArn('DecisionCoreTable'),
    decisionNarrativeTableArn: fakeNarrArn('DecisionNarrativeTable'),
    publishRecordTableArn: fakePublishArn('PublishRecordTable'),
    idempotencyTableArn: fakeIdemArn('IdempotencyTable'),
    apiReadLogGroupArn: fakeLogGroupArn('/test/ApiReadFn'),
    ssmParameterHierarchyArn: fakeSsmArn('/test/params'),
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
    expect(construct.evidence.allowedIdempotencyActions).toEqual(['dynamodb:GetItem']);
    expect(construct.evidence.wildcardAllowCount).toBe(0);
    expect(construct.evidence.roleBoundToFunction).toBe(false);
    expect(construct.evidence.finalBindingOwner).toBe('TASK-179');
  });
});

// ─── B. Architecture ────────────────────────────────────────────────────────

describe('B. Architecture', () => {
  for (const profile of ['PERSONAL_AWS_DEV', 'COMPETITION_AWS'] as Profile[]) {
    describe(`${profile}`, () => {
      it('1 IAM Role', () => {
        expect(countByType(synth(profile, 'arch-role'), 'AWS::IAM::Role')).toBe(1);
      });

      it('1 IAM Policy', () => {
        expect(countByType(synth(profile, 'arch-policy'), 'AWS::IAM::Policy')).toBe(1);
      });

      it('0 managed policies', () => {
        expect(Object.keys(getResourcesOfType(synth(profile, 'arch-mp'), 'AWS::IAM::ManagedPolicy'))).toHaveLength(0);
      });

      it('Lambda trust + sts:AssumeRole', () => {
        const resources = synth(profile, 'arch-trust')!;
        const roles = getResourcesOfType(resources, 'AWS::IAM::Role');
        const role = Object.values(roles)[0];
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

// ─── C. DynamoDB read allows ─────────────────────────────────────────────────

describe('C. DynamoDB read allows', () => {
  const tables = [
    { arn: fakeCoreArn('DecisionCoreTable'), label: 'Core', action: 'dynamodb:GetItem', expected: 'ALLOW' as EvalResult },
    { arn: fakeNarrArn('DecisionNarrativeTable'), label: 'Narrative', action: 'dynamodb:Query', expected: 'ALLOW' as EvalResult },
    { arn: fakePublishArn('PublishRecordTable'), label: 'Publish', action: 'dynamodb:GetItem', expected: 'ALLOW' as EvalResult },
    { arn: fakeIdemArn('IdempotencyTable'), label: 'Idem', action: 'dynamodb:GetItem', expected: 'ALLOW' as EvalResult },
    // Narrative GSI: base ARN is ALLOW but the index ARN should be IMPLICIT_DENY
    { arn: fakeNarrIndexArn('DecisionNarrativeTable', 'NarrativeTypeIndex'), label: 'NarrativeGSI', action: 'dynamodb:Query', expected: 'IMPLICIT_DENY' as EvalResult },
  ];

  for (const profile of ['PERSONAL_AWS_DEV', 'COMPETITION_AWS'] as Profile[]) {
    const stmts = parseStatements(getPolicyDoc(profile, 'reads'));
    for (const { arn, label, action, expected } of tables) {
      it(`${profile}: ${label} ${action} = ${expected}`, () => {
        expect(evaluatePolicy(stmts, action, arn)).toBe(expected);
      });
    }
  }
});

// ─── D. DynamoDB write denies ────────────────────────────────────────────────

describe('D. DynamoDB write denies', () => {
  const tables = [
    fakeIdemArn('IdempotencyTable'),
    fakeCoreArn('DecisionCoreTable'),
    fakeNarrArn('DecisionNarrativeTable'),
    fakePublishArn('PublishRecordTable'),
    `arn:aws:dynamodb:${FAKE_REGION}:${FAKE_ACCOUNT}:table/FutureTable`,
  ];

  for (const profile of ['PERSONAL_AWS_DEV', 'COMPETITION_AWS'] as Profile[]) {
    const stmts = parseStatements(getPolicyDoc(profile, 'writes'));
    for (const arn of tables) {
      for (const action of [
        'dynamodb:PutItem',
        'dynamodb:UpdateItem',
        'dynamodb:DeleteItem',
        'dynamodb:BatchWriteItem',
        'dynamodb:PartiQLInsert',
        'dynamodb:PartiQLUpdate',
        'dynamodb:PartiQLDelete',
      ]) {
        it(`${profile}: ${action} on ${arn.split('/').pop()} = DENY`, () => {
          expect(evaluatePolicy(stmts, action, arn)).toBe('DENY');
        });
      }
    }
  }
});

// ─── E. Idempotency non-GetItem denies ───────────────────────────────────────

describe('E. Idempotency non-GetItem denies', () => {
  const IDEM = fakeIdemArn('IdempotencyTable');

  for (const profile of ['PERSONAL_AWS_DEV', 'COMPETITION_AWS'] as Profile[]) {
    const stmts = parseStatements(getPolicyDoc(profile, 'idem-write'));
    for (const action of ['dynamodb:Query', 'dynamodb:Scan', 'dynamodb:PutItem', 'dynamodb:UpdateItem']) {
      it(`${profile}: ${action} IdempotencyTable not ALLOW`, () => {
        expect(evaluatePolicy(stmts, action, IDEM)).not.toBe('ALLOW');
      });
    }
  }
});

// ─── F. CloudWatch Logs ─────────────────────────────────────────────────────

describe('F. CloudWatch Logs', () => {
  const LG = fakeLogGroupArn('/test/ApiReadFn');
  const OTHER = fakeOtherLogGroupArn('/test/OtherFn');

  for (const profile of ['PERSONAL_AWS_DEV', 'COMPETITION_AWS'] as Profile[]) {
    const stmts = parseStatements(getPolicyDoc(profile, 'logs'));
    it(`${profile}: correct log stream = ALLOW`, () => {
      expect(evaluatePolicy(stmts, 'logs:CreateLogStream', `${LG}:log-stream:foo`)).toBe('ALLOW');
      expect(evaluatePolicy(stmts, 'logs:PutLogEvents', `${LG}:log-stream:bar`)).toBe('ALLOW');
    });
    it(`${profile}: other log group = IMPLICIT_DENY`, () => {
      expect(evaluatePolicy(stmts, 'logs:PutLogEvents', `${OTHER}:log-stream:x`)).toBe('IMPLICIT_DENY');
    });
    it(`${profile}: CreateLogGroup = IMPLICIT_DENY`, () => {
      expect(evaluatePolicy(stmts, 'logs:CreateLogGroup', '*')).toBe('IMPLICIT_DENY');
    });
  }
});

// ─── G. SSM hierarchy ───────────────────────────────────────────────────────

describe('G. SSM hierarchy', () => {
  const HIER = fakeSsmArn('/test/params');

  for (const profile of ['PERSONAL_AWS_DEV', 'COMPETITION_AWS'] as Profile[]) {
    const stmts = parseStatements(getPolicyDoc(profile, 'ssm'));
    it(`${profile}: descendant param = ALLOW`, () => {
      expect(evaluatePolicy(stmts, 'ssm:GetParametersByPath', `${HIER}/api/endpoint`)).toBe('ALLOW');
      expect(evaluatePolicy(stmts, 'ssm:GetParametersByPath', `${HIER}/a/b/c`)).toBe('ALLOW');
    });
    it(`${profile}: sibling prefix = IMPLICIT_DENY`, () => {
      expect(evaluatePolicy(stmts, 'ssm:GetParametersByPath', '/test/other/param')).toBe('IMPLICIT_DENY');
    });
  }
});

// ─── H. Explicit service denies ─────────────────────────────────────────────

describe('H. Explicit service denies', () => {
  const allDenyCases: { action: string; resource: string; label: string }[] = [
    // Bedrock
    { action: 'bedrock:InvokeModel', resource: '*', label: 'InvokeModel' },
    { action: 'bedrock:InvokeModelWithResponseStream', resource: '*', label: 'InvokeModelStream' },
    { action: 'bedrock:Retrieve', resource: '*', label: 'Retrieve' },
    { action: 'bedrock:RetrieveAndGenerate', resource: '*', label: 'RetrieveAndGenerate' },
    // Step Functions
    { action: 'states:StartExecution', resource: '*', label: 'StartExecution' },
    // WebSocket
    { action: 'execute-api:ManageConnections', resource: '*', label: 'ManageConnections' },
    // S3 writes
    { action: 's3:PutObject', resource: '*', label: 'S3PutObject' },
    { action: 's3:DeleteObject', resource: '*', label: 'S3DeleteObject' },
    { action: 's3:DeleteObjectVersion', resource: '*', label: 'S3DeleteObjectVersion' },
    { action: 's3:AbortMultipartUpload', resource: '*', label: 'S3AbortMultipartUpload' },
    { action: 's3:RestoreObject', resource: '*', label: 'S3RestoreObject' },
  ];

  for (const profile of ['PERSONAL_AWS_DEV', 'COMPETITION_AWS'] as Profile[]) {
    const stmts = parseStatements(getPolicyDoc(profile, 'deny'));
    for (const { action, resource, label } of allDenyCases) {
      it(`${profile}: ${label} = EXPLICIT_DENY`, () => {
        expect(evaluatePolicy(stmts, action, resource)).toBe('DENY');
      });
    }
  }
});

// ─── I. Forbidden capabilities ───────────────────────────────────────────────

describe('I. Forbidden capabilities', () => {
  const forbidden = [
    { action: 'lambda:InvokeFunction', resource: `arn:aws:lambda:${FAKE_REGION}:${FAKE_ACCOUNT}:function:F` },
    { action: 'secretsmanager:GetSecretValue', resource: `arn:aws:secretsmanager:${FAKE_REGION}:${FAKE_ACCOUNT}:secret:s` },
    { action: 'kms:Decrypt', resource: `arn:aws:kms:${FAKE_REGION}:${FAKE_ACCOUNT}:key:k` },
    { action: 'cloudwatch:PutMetricData', resource: '*' },
    { action: 'xray:PutTraceSegments', resource: '*' },
  ];

  for (const profile of ['PERSONAL_AWS_DEV', 'COMPETITION_AWS'] as Profile[]) {
    const stmts = parseStatements(getPolicyDoc(profile, 'forbidden'));
    for (const { action, resource } of forbidden) {
      it(`${profile}: ${action} is not ALLOW`, () => {
        expect(evaluatePolicy(stmts, action, resource)).not.toBe('ALLOW');
      });
    }
  }
});

// ─── J. Wildcard audit ──────────────────────────────────────────────────────

describe('J. Wildcard audit', () => {
  for (const profile of ['PERSONAL_AWS_DEV', 'COMPETITION_AWS'] as Profile[]) {
    it(`${profile}: no ALLOW Resource "*"`, () => {
      const stmts = parseStatements(getPolicyDoc(profile, 'wildcard'));
      expect(stmts.filter((s) => s.effect === 'Allow' && s.resource === '*')).toHaveLength(0);
    });

    it(`${profile}: wildcardAllowCount = 0`, () => {
      expect(makeRole(profile, 'wldcnt').construct.evidence.wildcardAllowCount).toBe(0);
    });
  }
});

// ─── K. Evidence contract ───────────────────────────────────────────────────

describe('K. Evidence contract', () => {
  for (const profile of ['PERSONAL_AWS_DEV', 'COMPETITION_AWS'] as Profile[]) {
    it(`${profile}: evidence fields correct`, () => {
      const { construct } = makeRole(profile, 'ev');
      expect(construct.evidence.allowedDecisionCoreActions).toEqual(['dynamodb:GetItem']);
      expect(construct.evidence.allowedNarrativeActions).toEqual(['dynamodb:Query']);
      expect(construct.evidence.allowedPublishRecordActions).toEqual(['dynamodb:GetItem']);
      expect(construct.evidence.allowedIdempotencyActions).toEqual(['dynamodb:GetItem']);
      expect(construct.evidence.idempotencyQueryCapability).toBe(false);
      expect(construct.evidence.idempotencyWriteCapability).toBe(false);
      expect(construct.evidence.roleBoundToFunction).toBe(false);
      expect(construct.evidence.finalBindingOwner).toBe('TASK-179');
    });
  }
});

// ─── L. Validation rejections ───────────────────────────────────────────────

describe('L. Validation rejections', () => {
  describe('roleName', () => {
    for (const [label, roleName] of [
      ['empty', ''],
      ['whitespace', '  api-read-role  '],
      ['credential', 'api-read-credential-role'],
    ] as [string, string][]) {
      it(`rejects: ${label}`, () => {
        const mockApp = new App({ autoSynth: false });
        mockApp.node.setContext('env', 'PERSONAL_AWS_DEV');
        const ctx = resolveEnvironmentContext(mockApp.node);
        const stack = new Stack(mockApp, `val-rn-${label}`);
        expect(() => new ApiReadFnRoleConstruct(stack, 'Role', {
          envContext: ctx,
          roleName,
          decisionCoreTableArn: fakeCoreArn('DecisionCoreTable'),
          decisionNarrativeTableArn: fakeNarrArn('DecisionNarrativeTable'),
          publishRecordTableArn: fakePublishArn('PublishRecordTable'),
          idempotencyTableArn: fakeIdemArn('IdempotencyTable'),
          apiReadLogGroupArn: fakeLogGroupArn('/test/ApiReadFn'),
          ssmParameterHierarchyArn: fakeSsmArn('/test/params'),
        })).toThrow();
      });
    }
  });

  describe('decisionNarrativeTableArn', () => {
    for (const [label, arn] of [
      ['empty', ''],
      ['not-dynamodb', `arn:aws:s3:::b`],
      ['index-arn', `arn:aws:dynamodb:${FAKE_REGION}:${FAKE_ACCOUNT}:table/T/index/I`],
    ] as [string, string][]) {
      it(`rejects: ${label}`, () => {
        const mockApp = new App({ autoSynth: false });
        mockApp.node.setContext('env', 'PERSONAL_AWS_DEV');
        const ctx = resolveEnvironmentContext(mockApp.node);
        const stack = new Stack(mockApp, `val-narr-${label}`);
        expect(() => new ApiReadFnRoleConstruct(stack, 'Role', {
          envContext: ctx,
          roleName: 'valid-api-read-role',
          decisionCoreTableArn: fakeCoreArn('DecisionCoreTable'),
          decisionNarrativeTableArn: arn,
          publishRecordTableArn: fakePublishArn('PublishRecordTable'),
          idempotencyTableArn: fakeIdemArn('IdempotencyTable'),
          apiReadLogGroupArn: fakeLogGroupArn('/test/ApiReadFn'),
          ssmParameterHierarchyArn: fakeSsmArn('/test/params'),
        })).toThrow();
      });
    }
  });

  describe('apiReadLogGroupArn', () => {
    it('rejects: ends-with-log-stream', () => {
      const mockApp = new App({ autoSynth: false });
      mockApp.node.setContext('env', 'PERSONAL_AWS_DEV');
      const ctx = resolveEnvironmentContext(mockApp.node);
      const stack = new Stack(mockApp, 'val-lg-end');
      expect(() => new ApiReadFnRoleConstruct(stack, 'Role', {
        envContext: ctx,
        roleName: 'valid-api-read-role',
        decisionCoreTableArn: fakeCoreArn('DecisionCoreTable'),
        decisionNarrativeTableArn: fakeNarrArn('DecisionNarrativeTable'),
        publishRecordTableArn: fakePublishArn('PublishRecordTable'),
        idempotencyTableArn: fakeIdemArn('IdempotencyTable'),
        apiReadLogGroupArn: `arn:aws:logs:${FAKE_REGION}:${FAKE_ACCOUNT}:log-group:/test/Fn:log-stream:*`,
        ssmParameterHierarchyArn: fakeSsmArn('/test/params'),
      })).toThrow();
    });
  });

  describe('ssmParameterHierarchyArn', () => {
    it('rejects: trailing wildcard', () => {
      const mockApp = new App({ autoSynth: false });
      mockApp.node.setContext('env', 'PERSONAL_AWS_DEV');
      const ctx = resolveEnvironmentContext(mockApp.node);
      const stack = new Stack(mockApp, 'val-ssm-wild');
      expect(() => new ApiReadFnRoleConstruct(stack, 'Role', {
        envContext: ctx,
        roleName: 'valid-api-read-role',
        decisionCoreTableArn: fakeCoreArn('DecisionCoreTable'),
        decisionNarrativeTableArn: fakeNarrArn('DecisionNarrativeTable'),
        publishRecordTableArn: fakePublishArn('PublishRecordTable'),
        idempotencyTableArn: fakeIdemArn('IdempotencyTable'),
        apiReadLogGroupArn: fakeLogGroupArn('/test/ApiReadFn'),
        ssmParameterHierarchyArn: `arn:aws:ssm:${FAKE_REGION}:${FAKE_ACCOUNT}:parameter/test/params/*`,
      })).toThrow();
    });
  });
});

// ─── M. Static audit ───────────────────────────────────────────────────────

describe('M. Static audit', () => {
  it('construct synths without error', () => {
    const { app, stack, ctx } = makeStack('PERSONAL_AWS_DEV', 'static');
    expect(() => {
      new ApiReadFnRoleConstruct(stack, 'StaticRole', {
        envContext: ctx,
        roleName: `${ctx.resourcePrefix}-static-role`,
        decisionCoreTableArn: fakeCoreArn('DecisionCoreTable'),
        decisionNarrativeTableArn: fakeNarrArn('DecisionNarrativeTable'),
        publishRecordTableArn: fakePublishArn('PublishRecordTable'),
        idempotencyTableArn: fakeIdemArn('IdempotencyTable'),
        apiReadLogGroupArn: fakeLogGroupArn('/test/ApiReadFn'),
        ssmParameterHierarchyArn: fakeSsmArn('/test/params'),
      });
      app.synth();
    }).not.toThrow();
  });

  it('trust principal is lambda.amazonaws.com', () => {
    const resources = synth('PERSONAL_AWS_DEV', 'trust')!;
    const role = Object.values(getResourcesOfType(resources, 'AWS::IAM::Role'))[0];
    const assumeRole = (role['Properties'] as Record<string, unknown>)['AssumeRolePolicyDocument'] as Record<string, unknown>;
    const stmts = (assumeRole['Statement'] as unknown[]) as Record<string, unknown>[];
    expect((stmts[0]['Principal'] as Record<string, unknown>)['Service']).toBe('lambda.amazonaws.com');
  });
});
