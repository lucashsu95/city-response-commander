/**
 * TASK-080 targeted tests — RecoveryGateFnRoleConstruct
 *
 * No AWS credentials or network access; pure synth-time assertions.
 *
 * Coverage:
 *   A. LOCAL_MOCK: 0 resources
 *   B. Architecture: PERSONAL / COMPETITION
 *   C. IdempotencyTable: GetItem only (read-only)
 *   D. DecisionCoreTable: GetItem only (read-only)
 *   E. DecisionNarrativeTable: Query base table only (no GSI)
 *   F. DynamoDB write Deny (all tables, all actions)
 *   G. CloudWatch Logs
 *   H. Explicit Denys (Bedrock, S3 write, WebSocket)
 *   I. Forbidden capabilities
 *   J. Wildcard audit
 *   K. Evidence contract
 *   L. Validation rejections
 *   M. Source / static audit
 */

import { describe, it, expect } from 'vitest';
import { App, Stack } from 'aws-cdk-lib';
import { resolveEnvironmentContext } from '../lib/env_context.js';
import { RecoveryGateFnRoleConstruct } from '../lib/iam/recovery_gate_fn_role.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

type Profile = 'LOCAL_MOCK' | 'PERSONAL_AWS_DEV' | 'COMPETITION_AWS';

const FAKE_ACCOUNT = '111111111111';
const FAKE_REGION = 'us-east-1';

function fakeIdemArn(name = 'IdempotencyTable'): string {
  return `arn:aws:dynamodb:${FAKE_REGION}:${FAKE_ACCOUNT}:table/${name}`;
}

function fakeCoreArn(name = 'DecisionCoreTable'): string {
  return `arn:aws:dynamodb:${FAKE_REGION}:${FAKE_ACCOUNT}:table/${name}`;
}

function fakeNarrArn(name = 'DecisionNarrativeTable'): string {
  return `arn:aws:dynamodb:${FAKE_REGION}:${FAKE_ACCOUNT}:table/${name}`;
}

function fakeNarrIndexArn(
  name = 'DecisionNarrativeTable',
  indexName = 'NarrativeTypeIndex',
): string {
  return `arn:aws:dynamodb:${FAKE_REGION}:${FAKE_ACCOUNT}:table/${name}/index/${indexName}`;
}

function fakePublishArn(name = 'PublishRecordTable'): string {
  return `arn:aws:dynamodb:${FAKE_REGION}:${FAKE_ACCOUNT}:table/${name}`;
}

function fakeLogGroupArn(name = '/test/RecoveryGateFn'): string {
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
  const stack = new Stack(
    app,
    `${ctx.resourcePrefix}-recovery-gate-${safeSuffix}`,
  );
  return { app, stack, ctx };
}

function makeRole(profile: Profile, suffix = 'test'): {
  app: App;
  stack: Stack;
  ctx: ReturnType<typeof resolveEnvironmentContext>;
  construct: RecoveryGateFnRoleConstruct;
} {
  const { app, stack, ctx } = makeStack(profile, suffix);
  const construct = new RecoveryGateFnRoleConstruct(stack, 'RecoveryGateFnRole', {
    envContext: ctx,
    roleName: `${ctx.resourcePrefix}-recovery-gate-fn-role`,
    idempotencyTableArn: fakeIdemArn('IdempotencyTable'),
    decisionCoreTableArn: fakeCoreArn('DecisionCoreTable'),
    decisionNarrativeTableArn: fakeNarrArn('DecisionNarrativeTable'),
    recoveryGateLogGroupArn: fakeLogGroupArn('/test/RecoveryGateFn'),
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

function getPolicyDoc(
  profile: Profile,
  suffix = 'synth',
): Record<string, unknown> {
  const resources = synth(profile, suffix)!;
  const policies = Object.values(resources).filter(
    (r) => r['Type'] === 'AWS::IAM::Policy',
  );
  return (policies[0]['Properties'] as Record<string, unknown>)['PolicyDocument'] as Record<string, unknown>;
}

// ─── Pure TypeScript IAM Policy Evaluator ─────────────────────────────────────

interface PolicyStatementEntry {
  effect: string;
  action: string;
  resource: string;
  notResource?: string;
}

function parseStatements(
  doc: Record<string, unknown>,
): PolicyStatementEntry[] {
  const stmts = (doc['Statement'] as unknown[]) ?? [];
  return stmts.flatMap((s) => {
    const stmt = s as Record<string, unknown>;
    const effect = (stmt['Effect'] as string) ?? '';
    const rawActions = stmt['Action'];
    const rawResources = stmt['Resource'] as string | string[] | undefined;
    const notResource = stmt['NotResource'];

    const resourceStrings: string[] = rawResources
      ? Array.isArray(rawResources)
        ? rawResources
        : [rawResources]
      : [];

    const actionStrings: string[] = rawActions
      ? Array.isArray(rawActions)
        ? rawActions
        : [rawActions as string]
      : [];

    if (resourceStrings.length === 0 && actionStrings.length === 0) {
      return [
        {
          effect,
          action: '',
          resource: '',
          notResource:
            notResource !== undefined
              ? Array.isArray(notResource)
                ? (notResource as string[]).join(',')
                : String(notResource)
              : undefined,
        },
      ];
    }

    const entries: PolicyStatementEntry[] = [];
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

function evaluatePolicy(
  statements: PolicyStatementEntry[],
  action: string,
  resource: string,
): EvalResult {
  let explicitDeny = false;
  let explicitAllow = false;
  for (const stmt of statements) {
    const stmtAction = stmt.action;
    const matchesAction =
      stmtAction === '*' ||
      action === stmtAction ||
      stmtAction.endsWith('*');
    if (!matchesAction) continue;

    let matchesResource = false;
    if (stmt.notResource) {
      const notResources = stmt.notResource
        .split(',')
        .map((r) => r.trim());
      matchesResource = !notResources.some((nr) =>
        resourceMatch(nr, resource),
      );
    } else if (stmt.resource === '*') {
      matchesResource = true;
    } else {
      matchesResource = resourceMatch(stmt.resource, resource);
    }

    if (!matchesResource) continue;

    if (stmt.effect === 'Deny') {
      explicitDeny = true;
    } else if (stmt.effect === 'Allow') {
      explicitAllow = true;
    }
  }
  if (explicitDeny) return 'DENY';
  if (explicitAllow) return 'ALLOW';
  return 'IMPLICIT_DENY';
}

// ─── A. LOCAL_MOCK ──────────────────────────────────────────────────────────

describe('A. LOCAL_MOCK', () => {
  it('creates 0 AWS resources', () => {
    const resources = synth('LOCAL_MOCK', 'local-mock');
    expect(resources).toBeUndefined();
  });

  it('construct fields are undefined', () => {
    const { construct } = makeRole('LOCAL_MOCK', 'fields');
    expect(construct.role).toBeUndefined();
    expect(construct.roleArn).toBeUndefined();
    expect(construct.policy).toBeUndefined();
  });

  it('evidence is populated even in LOCAL_MOCK', () => {
    const { construct } = makeRole('LOCAL_MOCK', 'evidence');
    expect(construct.evidence).toBeDefined();
    expect(construct.evidence.allowedIdempotencyActions).toEqual(['dynamodb:GetItem']);
    expect(construct.evidence.allowedDecisionCoreActions).toEqual(['dynamodb:GetItem']);
    expect(construct.evidence.allowedNarrativeActions).toEqual(['dynamodb:Query']);
    expect(construct.evidence.wildcardAllowCount).toBe(0);
    expect(construct.evidence.roleBoundToFunction).toBe(false);
    expect(construct.evidence.finalBindingOwner).toBe('TASK-179');
  });
});

// ─── B. Architecture — PERSONAL_AWS_DEV / COMPETITION_AWS ──────────────────

describe('B. Architecture', () => {
  for (const profile of ['PERSONAL_AWS_DEV', 'COMPETITION_AWS'] as Profile[]) {
    describe(`${profile}`, () => {
      it('exactly 1 IAM Role', () => {
        const resources = synth(profile, 'arch-role');
        expect(countByType(resources, 'AWS::IAM::Role')).toBe(1);
      });

      it('exactly 1 IAM Policy (inline)', () => {
        const resources = synth(profile, 'arch-policy');
        expect(countByType(resources, 'AWS::IAM::Policy')).toBe(1);
      });

      it('0 managed policies', () => {
        const resources = synth(profile, 'arch-managed');
        const policies = getResourcesOfType(resources, 'AWS::IAM::ManagedPolicy');
        expect(Object.keys(policies)).toHaveLength(0);
      });

      it('Role has Lambda trust', () => {
        const resources = synth(profile, 'arch-trust')!;
        const roles = getResourcesOfType(resources, 'AWS::IAM::Role');
        const role = Object.values(roles)[0];
        const assumeRole = (role['Properties'] as Record<string, unknown>)['AssumeRolePolicyDocument'] as Record<string, unknown>;
        const statements = (assumeRole['Statement'] as unknown[]) as Record<string, unknown>[];
        expect(statements).toHaveLength(1);
        const stmt = statements[0];
        expect(stmt['Effect']).toBe('Allow');
        const principals = stmt['Principal'] as Record<string, unknown>;
        expect(principals).toEqual({ 'Service': 'lambda.amazonaws.com' });
        expect(stmt['Action']).toBe('sts:AssumeRole');
      });
    });
  }
});

// ─── C. IdempotencyTable GetItem ─────────────────────────────────────────────

describe('C. IdempotencyTable read-only', () => {
  const IDEM_ARN = fakeIdemArn('IdempotencyTable');

  for (const profile of ['PERSONAL_AWS_DEV', 'COMPETITION_AWS'] as Profile[]) {
    const stmts = parseStatements(getPolicyDoc(profile, 'idem'));

    it(`${profile}: GetItem = ALLOW`, () => {
      expect(evaluatePolicy(stmts, 'dynamodb:GetItem', IDEM_ARN)).toBe('ALLOW');
    });

    // PutItem/DeleteItem are EXPLICIT_DENY from the all-tables write Deny (Resource: "*")
    // GetItem is NOT on the deny list, so it hits IMPLICIT_DENY
    for (const [action, expected] of [
      ['dynamodb:PutItem', 'DENY'],
      ['dynamodb:UpdateItem', 'DENY'],
      ['dynamodb:DeleteItem', 'DENY'],
      ['dynamodb:BatchWriteItem', 'DENY'],
      ['dynamodb:PartiQLInsert', 'DENY'],
      ['dynamodb:PartiQLUpdate', 'DENY'],
      ['dynamodb:PartiQLDelete', 'DENY'],
    ] as [string, EvalResult][]) {
      it(`${profile}: ${action} = ${expected}`, () => {
        expect(evaluatePolicy(stmts, action, IDEM_ARN)).toBe(expected);
      });
    }
  }
});

// ─── D. DecisionCoreTable GetItem ───────────────────────────────────────────

describe('D. DecisionCoreTable read-only', () => {
  const CORE_ARN = fakeCoreArn('DecisionCoreTable');

  for (const profile of ['PERSONAL_AWS_DEV', 'COMPETITION_AWS'] as Profile[]) {
    const stmts = parseStatements(getPolicyDoc(profile, 'core'));

    it(`${profile}: GetItem = ALLOW`, () => {
      expect(evaluatePolicy(stmts, 'dynamodb:GetItem', CORE_ARN)).toBe('ALLOW');
    });

    for (const [action, expected] of [
      ['dynamodb:PutItem', 'DENY'],
      ['dynamodb:UpdateItem', 'DENY'],
      ['dynamodb:DeleteItem', 'DENY'],
      ['dynamodb:Query', 'IMPLICIT_DENY'],
      ['dynamodb:Scan', 'IMPLICIT_DENY'],
      ['dynamodb:BatchGetItem', 'IMPLICIT_DENY'],
    ] as [string, EvalResult][]) {
      it(`${profile}: ${action} = ${expected}`, () => {
        expect(evaluatePolicy(stmts, action, CORE_ARN)).toBe(expected);
      });
    }
  }
});

// ─── E. DecisionNarrativeTable Query (base table only) ─────────────────────

describe('E. DecisionNarrativeTable Query boundary', () => {
  const NARR_ARN = fakeNarrArn('DecisionNarrativeTable');
  const GSI_ARN = fakeNarrIndexArn('DecisionNarrativeTable', 'NarrativeTypeIndex');
  const OTHER_TABLE_ARN = fakePublishArn('PublishRecordTable');

  for (const profile of ['PERSONAL_AWS_DEV', 'COMPETITION_AWS'] as Profile[]) {
    const stmts = parseStatements(getPolicyDoc(profile, 'narr'));

    it(`${profile}: Query base table = ALLOW`, () => {
      expect(evaluatePolicy(stmts, 'dynamodb:Query', NARR_ARN)).toBe('ALLOW');
    });

    it(`${profile}: Query GSI/index = IMPLICIT_DENY`, () => {
      expect(evaluatePolicy(stmts, 'dynamodb:Query', GSI_ARN)).toBe('IMPLICIT_DENY');
    });

    it(`${profile}: Query on other table = IMPLICIT_DENY`, () => {
      expect(evaluatePolicy(stmts, 'dynamodb:Query', OTHER_TABLE_ARN)).toBe('IMPLICIT_DENY');
    });

    it(`${profile}: Scan = IMPLICIT_DENY`, () => {
      expect(evaluatePolicy(stmts, 'dynamodb:Scan', NARR_ARN)).toBe('IMPLICIT_DENY');
    });

    it(`${profile}: PutItem = DENY`, () => {
      expect(evaluatePolicy(stmts, 'dynamodb:PutItem', NARR_ARN)).toBe('DENY');
    });

    it(`${profile}: UpdateItem = DENY`, () => {
      expect(evaluatePolicy(stmts, 'dynamodb:UpdateItem', NARR_ARN)).toBe('DENY');
    });

    it(`${profile}: DeleteItem = DENY`, () => {
      expect(evaluatePolicy(stmts, 'dynamodb:DeleteItem', NARR_ARN)).toBe('DENY');
    });

    it(`${profile}: GetItem = IMPLICIT_DENY`, () => {
      expect(evaluatePolicy(stmts, 'dynamodb:GetItem', NARR_ARN)).toBe('IMPLICIT_DENY');
    });
  }
});

// ─── F. DynamoDB write Deny ─────────────────────────────────────────────────

describe('F. DynamoDB write Deny', () => {
  const writeActions = [
    'dynamodb:PutItem',
    'dynamodb:UpdateItem',
    'dynamodb:DeleteItem',
    'dynamodb:BatchWriteItem',
    'dynamodb:PartiQLInsert',
    'dynamodb:PartiQLUpdate',
    'dynamodb:PartiQLDelete',
  ];

  const tables = [
    { arn: fakeIdemArn('IdempotencyTable'), label: 'Idempotency' },
    { arn: fakeCoreArn('DecisionCoreTable'), label: 'DecisionCore' },
    { arn: fakeNarrArn('DecisionNarrativeTable'), label: 'Narrative' },
    { arn: fakePublishArn('PublishRecordTable'), label: 'PublishRecord' },
    { arn: `arn:aws:dynamodb:${FAKE_REGION}:${FAKE_ACCOUNT}:table/FutureTable`, label: 'Future' },
  ];

  for (const profile of ['PERSONAL_AWS_DEV', 'COMPETITION_AWS'] as Profile[]) {
    const stmts = parseStatements(getPolicyDoc(profile, 'writes'));

    for (const action of writeActions) {
      for (const { arn, label } of tables) {
        it(`${profile}: ${action} on ${label} = EXPLICIT_DENY`, () => {
          expect(evaluatePolicy(stmts, action, arn)).toBe('DENY');
        });
      }
    }
  }
});

// ─── G. CloudWatch Logs ─────────────────────────────────────────────────────

describe('G. CloudWatch Logs', () => {
  const LG_ARN = fakeLogGroupArn('/test/RecoveryGateFn');
  const OTHER_LG_ARN = fakeOtherLogGroupArn('/test/OtherFn');

  for (const profile of ['PERSONAL_AWS_DEV', 'COMPETITION_AWS'] as Profile[]) {
    const stmts = parseStatements(getPolicyDoc(profile, 'logs'));

    it(`${profile}: CreateLogStream on correct log group = ALLOW`, () => {
      expect(evaluatePolicy(stmts, 'logs:CreateLogStream', `${LG_ARN}:log-stream:foo`)).toBe('ALLOW');
    });

    it(`${profile}: PutLogEvents on correct log group = ALLOW`, () => {
      expect(evaluatePolicy(stmts, 'logs:PutLogEvents', `${LG_ARN}:log-stream:bar`)).toBe('ALLOW');
    });

    it(`${profile}: PutLogEvents on other log group = IMPLICIT_DENY`, () => {
      expect(evaluatePolicy(stmts, 'logs:PutLogEvents', `${OTHER_LG_ARN}:log-stream:baz`)).toBe('IMPLICIT_DENY');
    });

    it(`${profile}: CreateLogGroup = IMPLICIT_DENY`, () => {
      expect(evaluatePolicy(stmts, 'logs:CreateLogGroup', '*')).toBe('IMPLICIT_DENY');
    });
  }
});

// ─── H. Explicit Denys ──────────────────────────────────────────────────────

describe('H. Explicit Denys', () => {
  const bedrockActions = [
    'bedrock:InvokeModel',
    'bedrock:InvokeModelWithResponseStream',
    'bedrock:Retrieve',
    'bedrock:RetrieveAndGenerate',
  ];

  const s3WriteActions = [
    's3:PutObject',
    's3:DeleteObject',
    's3:DeleteObjectVersion',
    's3:AbortMultipartUpload',
    's3:RestoreObject',
  ];

  for (const profile of ['PERSONAL_AWS_DEV', 'COMPETITION_AWS'] as Profile[]) {
    const stmts = parseStatements(getPolicyDoc(profile, 'deny'));

    for (const action of bedrockActions) {
      it(`${profile}: ${action} = EXPLICIT_DENY`, () => {
        expect(evaluatePolicy(stmts, action, '*')).toBe('DENY');
      });
    }

    for (const action of s3WriteActions) {
      it(`${profile}: ${action} on any S3 = EXPLICIT_DENY`, () => {
        expect(evaluatePolicy(stmts, action, '*')).toBe('DENY');
      });
    }

    it(`${profile}: execute-api:ManageConnections = EXPLICIT_DENY`, () => {
      expect(evaluatePolicy(stmts, 'execute-api:ManageConnections', '*')).toBe('DENY');
    });
  }
});

// ─── I. Forbidden capabilities ──────────────────────────────────────────────

describe('I. Forbidden capabilities', () => {
  const forbidden = [
    { action: 'lambda:InvokeFunction', resource: `arn:aws:lambda:${FAKE_REGION}:${FAKE_ACCOUNT}:function:SomeFn` },
    { action: 'states:StartExecution', resource: `arn:aws:states:${FAKE_REGION}:${FAKE_ACCOUNT}:stateMachine:SomeSM` },
    { action: 'secretsmanager:GetSecretValue', resource: `arn:aws:secretsmanager:${FAKE_REGION}:${FAKE_ACCOUNT}:secret:some-secret` },
    { action: 'kms:Decrypt', resource: `arn:aws:kms:${FAKE_REGION}:${FAKE_ACCOUNT}:key/some-key` },
    { action: 'cloudwatch:PutMetricData', resource: '*' },
    { action: 'xray:PutTraceSegments', resource: '*' },
    { action: 'xray:PutTelemetryRecords', resource: '*' },
    { action: 'dynamodb:BatchGetItem', resource: fakeIdemArn('IdempotencyTable') },
    { action: 'dynamodb:Scan', resource: fakeIdemArn('IdempotencyTable') },
    { action: 'dynamodb:PartiQLSelect', resource: fakeNarrArn('DecisionNarrativeTable') },
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
    it(`${profile}: no ALLOW statements use Resource "*"`, () => {
      const stmts = parseStatements(getPolicyDoc(profile, 'wildcard'));
      const wildcardAllows = stmts.filter(
        (s) => s.effect === 'Allow' && s.resource === '*',
      );
      expect(wildcardAllows).toHaveLength(0);
    });

    it(`${profile}: wildcardAllowCount in evidence = 0`, () => {
      const { construct } = makeRole(profile, 'wildcard-count');
      expect(construct.evidence.wildcardAllowCount).toBe(0);
    });
  }
});

// ─── K. Evidence contract ───────────────────────────────────────────────────

describe('K. Evidence contract', () => {
  for (const profile of ['PERSONAL_AWS_DEV', 'COMPETITION_AWS'] as Profile[]) {
    it(`${profile}: allowedIdempotencyActions = [GetItem]`, () => {
      const { construct } = makeRole(profile, 'ev-idem');
      expect(construct.evidence.allowedIdempotencyActions).toEqual(['dynamodb:GetItem']);
    });

    it(`${profile}: allowedDecisionCoreActions = [GetItem]`, () => {
      const { construct } = makeRole(profile, 'ev-core');
      expect(construct.evidence.allowedDecisionCoreActions).toEqual(['dynamodb:GetItem']);
    });

    it(`${profile}: allowedNarrativeActions = [Query]`, () => {
      const { construct } = makeRole(profile, 'ev-narr');
      expect(construct.evidence.allowedNarrativeActions).toEqual(['dynamodb:Query']);
    });

    it(`${profile}: consistentReadEnforcedByIam = false`, () => {
      const { construct } = makeRole(profile, 'ev-consistent');
      expect(construct.evidence.consistentReadEnforcedByIam).toBe(false);
    });

    it(`${profile}: baseTableOnlyQuery = true`, () => {
      const { construct } = makeRole(profile, 'ev-base-table');
      expect(construct.evidence.baseTableOnlyQuery).toBe(true);
    });

    it(`${profile}: consistentReadRuntimeOwner = TASK-093`, () => {
      const { construct } = makeRole(profile, 'ev-runtime-owner');
      expect(construct.evidence.consistentReadRuntimeOwner).toBe('TASK-093');
    });

    it(`${profile}: roleBoundToFunction = false`, () => {
      const { construct } = makeRole(profile, 'ev-bound');
      expect(construct.evidence.roleBoundToFunction).toBe(false);
    });

    it(`${profile}: finalBindingOwner = TASK-179`, () => {
      const { construct } = makeRole(profile, 'ev-binding-owner');
      expect(construct.evidence.finalBindingOwner).toBe('TASK-179');
    });
  }
});

// ─── L. Validation rejections ───────────────────────────────────────────────

describe('L. Validation rejections', () => {
  describe('roleName', () => {
    for (const [label, roleName] of [
      ['empty', ''],
      ['blank', '   '],
      ['whitespace-padded', '  recovery-gate-role  '],
      ['credential-like', 'recovery-gate-credential-role'],
      ['token-like', 'recovery-gate-token-role'],
    ] as [string, string][]) {
      it(`rejects roleName: ${label}`, () => {
        const mockApp = new App({ autoSynth: false });
        mockApp.node.setContext('env', 'PERSONAL_AWS_DEV');
        const ctx = resolveEnvironmentContext(mockApp.node);
        const stack = new Stack(mockApp, `val-rn-${label}`);
        expect(() => {
          new RecoveryGateFnRoleConstruct(stack, 'Role', {
            envContext: ctx,
            roleName,
            idempotencyTableArn: fakeIdemArn('IdempotencyTable'),
            decisionCoreTableArn: fakeCoreArn('DecisionCoreTable'),
            decisionNarrativeTableArn: fakeNarrArn('DecisionNarrativeTable'),
            recoveryGateLogGroupArn: fakeLogGroupArn('/test/RecoveryGateFn'),
          });
        }).toThrow();
      });
    }
  });

  describe('DynamoDB table ARN', () => {
    for (const [label, arn] of [
      ['empty', ''],
      ['not-dynamodb-arn', `arn:aws:s3:::some-bucket`],
      ['index-arn', `arn:aws:dynamodb:${FAKE_REGION}:${FAKE_ACCOUNT}:table/NarrativeTable/index/NarrativeTypeIndex`],
    ] as [string, string][]) {
      it(`rejects decisionNarrativeTableArn: ${label}`, () => {
        const mockApp = new App({ autoSynth: false });
        mockApp.node.setContext('env', 'PERSONAL_AWS_DEV');
        const ctx = resolveEnvironmentContext(mockApp.node);
        const stack = new Stack(mockApp, `val-narr-${label}`);
        expect(() => {
          new RecoveryGateFnRoleConstruct(stack, 'Role', {
            envContext: ctx,
            roleName: 'valid-recovery-gate-role',
            idempotencyTableArn: fakeIdemArn('IdempotencyTable'),
            decisionCoreTableArn: fakeCoreArn('DecisionCoreTable'),
            decisionNarrativeTableArn: arn,
            recoveryGateLogGroupArn: fakeLogGroupArn('/test/RecoveryGateFn'),
          });
        }).toThrow();
      });
    }
  });

  describe('duplicate table ARNs', () => {
    it('rejects when two tables share the same ARN', () => {
      const mockApp = new App({ autoSynth: false });
      mockApp.node.setContext('env', 'PERSONAL_AWS_DEV');
      const ctx = resolveEnvironmentContext(mockApp.node);
      const stack = new Stack(mockApp, 'val-dupe-tables');
      expect(() => {
        new RecoveryGateFnRoleConstruct(stack, 'Role', {
          envContext: ctx,
          roleName: 'valid-recovery-gate-role',
          idempotencyTableArn: fakeIdemArn('IdempotencyTable'),
          decisionCoreTableArn: fakeIdemArn('IdempotencyTable'),
          decisionNarrativeTableArn: fakeNarrArn('DecisionNarrativeTable'),
          recoveryGateLogGroupArn: fakeLogGroupArn('/test/RecoveryGateFn'),
        });
      }).toThrow();
    });
  });

  describe('recoveryGateLogGroupArn', () => {
    for (const [label, arn] of [
      ['empty', ''],
      ['not-logs-arn', `arn:aws:s3:::some-bucket`],
      ['ends-with-log-stream', `arn:aws:logs:${FAKE_REGION}:${FAKE_ACCOUNT}:log-group:/test/Fn:log-stream:*`],
    ] as [string, string][]) {
      it(`rejects recoveryGateLogGroupArn: ${label}`, () => {
        const mockApp = new App({ autoSynth: false });
        mockApp.node.setContext('env', 'PERSONAL_AWS_DEV');
        const ctx = resolveEnvironmentContext(mockApp.node);
        const stack = new Stack(mockApp, `val-lg-${label}`);
        expect(() => {
          new RecoveryGateFnRoleConstruct(stack, 'Role', {
            envContext: ctx,
            roleName: 'valid-recovery-gate-role',
            idempotencyTableArn: fakeIdemArn('IdempotencyTable'),
            decisionCoreTableArn: fakeCoreArn('DecisionCoreTable'),
            decisionNarrativeTableArn: fakeNarrArn('DecisionNarrativeTable'),
            recoveryGateLogGroupArn: arn,
          });
        }).toThrow();
      });
    }
  });
});

// ─── M. Source / static audit ───────────────────────────────────────────────

describe('M. Source and static audit', () => {
  it('construct synths successfully without throwing', () => {
    const { app, stack, ctx } = makeStack('PERSONAL_AWS_DEV', 'static-audit');
    expect(() => {
      new RecoveryGateFnRoleConstruct(stack, 'AuditRole', {
        envContext: ctx,
        roleName: `${ctx.resourcePrefix}-audit-role`,
        idempotencyTableArn: fakeIdemArn('IdempotencyTable'),
        decisionCoreTableArn: fakeCoreArn('DecisionCoreTable'),
        decisionNarrativeTableArn: fakeNarrArn('DecisionNarrativeTable'),
        recoveryGateLogGroupArn: fakeLogGroupArn('/test/RecoveryGateFn'),
      });
      app.synth();
    }).not.toThrow();
  });

  it('trust principal is lambda.amazonaws.com', () => {
    const resources = synth('PERSONAL_AWS_DEV', 'trust-audit')!;
    const roles = getResourcesOfType(resources, 'AWS::IAM::Role');
    const role = Object.values(roles)[0];
    const assumeRole = (role['Properties'] as Record<string, unknown>)['AssumeRolePolicyDocument'] as Record<string, unknown>;
    const statements = (assumeRole['Statement'] as unknown[]) as Record<string, unknown>[];
    const principals = statements[0]['Principal'] as Record<string, unknown>;
    expect(principals['Service']).toBe('lambda.amazonaws.com');
  });
});
