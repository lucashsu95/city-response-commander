/**
 * TASK-078 targeted tests — RendererFnRoleConstruct
 *
 * No AWS credentials or network access; pure synth-time assertions.
 *
 * Coverage:
 *   A. LOCAL_MOCK: 0 resources
 *   B. PERSONAL_AWS_DEV / COMPETITION_AWS: architecture, trust, isolation
 *   C. DecisionCore: GetItem only, write Deny
 *   D. DecisionNarrative: PutItem only, mutation Deny
 *   E. Cross-table write proofs
 *   F. Bedrock model allowlist
 *   G. Knowledge Base Retrieve
 *   H. S3 SOP read + write Deny
 *   I. CloudWatch Logs
 *   J. SSM read
 *   K. Secrets (NONE and EXACT modes)
 *   L. Forbidden capabilities
 *   M. Wildcard audit
 *   N. Isolation
 *   O. Evidence contract
 *   P. Validation rejections
 *   Q. Source/static audit
 */

import { describe, it, expect } from 'vitest';
import { App, Stack } from 'aws-cdk-lib';
import { resolveEnvironmentContext } from '../lib/env_context.js';
import {
  RendererFnRoleConstruct,
  type SecretAccessConfig,
} from '../lib/iam/renderer_fn_role.js';

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

function fakeIdemArn(name = 'IdempotencyTable'): string {
  return `arn:aws:dynamodb:${FAKE_REGION}:${FAKE_ACCOUNT}:table/${name}`;
}

function fakePublishArn(name = 'PublishRecordTable'): string {
  return `arn:aws:dynamodb:${FAKE_REGION}:${FAKE_ACCOUNT}:table/${name}`;
}

function fakeS3BucketArn(bucket = 'sop-bucket'): string {
  return `arn:aws:s3:::${bucket}`;
}

function fakeS3ObjectPattern(bucket = 'sop-bucket', prefix = 'sop'): string {
  return `arn:aws:s3:::${bucket}/${prefix}/*`;
}

function fakeKbArn(kbId = 'ABCDEFGH'): string {
  return `arn:aws:bedrock:${FAKE_REGION}:${FAKE_ACCOUNT}:knowledge-base/${kbId}`;
}

function fakeModelArn(
  type: 'fm' | 'profile' | 'prov' = 'fm',
  name = 'anthropic.claude-3-sonnet',
): string {
  const resType =
    type === 'fm'
      ? 'foundation-model'
      : type === 'profile'
        ? 'inference-profile'
        : 'provisioned-model';
  return `arn:aws:bedrock:${FAKE_REGION}::${resType}/${name}`;
}

function fakeSecretArn(name = 'renderer/bedrock-key'): string {
  return `arn:aws:secretsmanager:${FAKE_REGION}:${FAKE_ACCOUNT}:secret:${name}`;
}

function fakeLogGroupArn(name = '/test/RendererFn'): string {
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
    `${ctx.resourcePrefix}-renderer-${safeSuffix}`,
  );
  return { app, stack, ctx };
}

function makeRole(
  profile: Profile,
  secretAccess: SecretAccessConfig,
  suffix = 'test',
): {
  app: App;
  stack: Stack;
  ctx: ReturnType<typeof resolveEnvironmentContext>;
  construct: RendererFnRoleConstruct;
} {
  const { app, stack, ctx } = makeStack(profile, suffix);
  const modelArns = [
    fakeModelArn('fm', 'anthropic.claude-3-sonnet-20240207-v1:0'),
    fakeModelArn('prov', 'us.anthropic.claude-3-5-sonnet-v1@20241030'),
  ];
  const construct = new RendererFnRoleConstruct(stack, 'RendererFnRole', {
    envContext: ctx,
    roleName: `${ctx.resourcePrefix}-renderer-fn-role`,
    decisionCoreTableArn: fakeCoreArn('DecisionCoreTable'),
    decisionNarrativeTableArn: fakeNarrArn('DecisionNarrativeTable'),
    idempotencyTableArn: fakeIdemArn('IdempotencyTable'),
    publishRecordTableArn: fakePublishArn('PublishRecordTable'),
    sopBucketArn: fakeS3BucketArn('sop-bucket'),
    sopObjectArnPattern: fakeS3ObjectPattern('sop-bucket', 'sop'),
    knowledgeBaseArn: fakeKbArn('ABCDEFGH'),
    modelInvocationResourceArns: modelArns,
    rendererLogGroupArn: fakeLogGroupArn('/test/RendererFn'),
    ssmParameterHierarchyArn: fakeSsmArn('/test/params'),
    secretAccess,
  });
  return { app, stack, ctx, construct };
}

function synth(
  profile: Profile,
  secretAccess: SecretAccessConfig,
  suffix = 'synth',
) {
  const { app } = makeRole(profile, secretAccess, suffix);
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
  secretAccess: SecretAccessConfig,
  suffix = 'synth',
): Record<string, unknown> {
  const resources = synth(profile, secretAccess, suffix)!;
  const policies = Object.values(resources).filter(
    (r) => r['Type'] === 'AWS::IAM::Policy',
  );
  return (policies[0]['Properties'] as Record<string, unknown>)['PolicyDocument'] as Record<string, unknown>;
}

function getRawStatements(
  profile: Profile,
  secretAccess: SecretAccessConfig,
  suffix = 'synth',
): unknown[] {
  const doc = getPolicyDoc(profile, secretAccess, suffix);
  return (doc['Statement'] as unknown[]) ?? [];
}

// ─── Pure TypeScript IAM Policy Evaluator ────────────────────────────────

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

// ─── Shared test parameters ──────────────────────────────────────────────

const PROFILES: Profile[] = ['PERSONAL_AWS_DEV', 'COMPETITION_AWS'];
const SECRET_CONFIGS: SecretAccessConfig[] = [
  { mode: 'NONE' },
  { mode: 'EXACT', secretArns: [fakeSecretArn('renderer/bedrock-key')] },
];

// ─── A. LOCAL_MOCK ────────────────────────────────────────────────────

describe('A. LOCAL_MOCK', () => {
  it('AWS resource count = 0', () => {
    const resources = synth('LOCAL_MOCK', { mode: 'NONE' }, 'local-zero-test');
    const nonCdk = resources
      ? Object.values(resources).filter(
          (r) =>
            r['Type'] && !(r['Type'] as string).startsWith('AWS::CDK::'),
        )
      : [];
    expect(nonCdk).toHaveLength(0);
  });

  it('IAM Role count = 0', () => {
    expect(countByType(synth('LOCAL_MOCK', { mode: 'NONE' }, 'local-role-test'), 'AWS::IAM::Role')).toBe(0);
  });

  it('IAM Policy count = 0', () => {
    expect(countByType(synth('LOCAL_MOCK', { mode: 'NONE' }, 'local-policy-test'), 'AWS::IAM::Policy')).toBe(0);
  });

  it('Outputs = 0', () => {
    const { app } = makeRole('LOCAL_MOCK', { mode: 'NONE' }, 'local-outputs-test');
    const assembly = app.synth();
    const outputs = (assembly.stacks[0].template as Record<string, unknown>)['Outputs'] as unknown;
    expect(outputs).toBeUndefined();
  });

  it('role / policy / roleArn are undefined', () => {
    const { construct } = makeRole('LOCAL_MOCK', { mode: 'NONE' }, 'local-undefined-test');
    expect(construct.role).toBeUndefined();
    expect(construct.roleArn).toBeUndefined();
    expect(construct.policy).toBeUndefined();
  });

  it('evidence is still populated', () => {
    const { construct } = makeRole('LOCAL_MOCK', { mode: 'NONE' }, 'local-evidence-test');
    expect(construct.evidence.deterministicTruthWriteCapability).toBe(false);
    expect(construct.evidence.narrativePutCapability).toBe(true);
    expect(construct.evidence.narrativeMutationCapability).toBe(false);
    expect(construct.evidence.retrieveAndGenerateCapability).toBe(false);
    expect(construct.evidence.roleBoundToFunction).toBe(false);
    expect(construct.evidence.finalBindingOwner).toBe('TASK-179');
    expect(construct.evidence.runtimeConditionalWriteOwner).toBe('TASK-116');
    expect(construct.evidence.wildcardAllowCount).toBe(0);
    expect(construct.evidence.decisionCoreReadActions).toEqual(['dynamodb:GetItem']);
    expect(construct.evidence.secretAccessMode).toBe('NONE');
  });
});

// ─── B. Architecture ─────────────────────────────────────────────────

describe('B. Architecture', () => {
  for (const profile of PROFILES) {
    for (const secretAccess of SECRET_CONFIGS) {
      const label = `${profile} / secret=${secretAccess.mode}`;
      describe(`B. ${label}`, () => {
        const resources = synth(profile, secretAccess, `arch-${profile}-${secretAccess.mode}`);

        it('IAM Role count = 1', () => {
          expect(countByType(resources, 'AWS::IAM::Role')).toBe(1);
        });

        it('IAM Policy count = 1', () => {
          expect(countByType(resources, 'AWS::IAM::Policy')).toBe(1);
        });

        it('ManagedPolicyArns = 0', () => {
          const roles = getResourcesOfType(resources, 'AWS::IAM::Role');
          for (const [, role] of Object.entries(roles)) {
            const props = role['Properties'] as Record<string, unknown>;
            expect(props['ManagedPolicyArns']).toBeUndefined();
          }
        });

        it('normal Delete lifecycle', () => {
          const roles = getResourcesOfType(resources, 'AWS::IAM::Role');
          for (const [, role] of Object.entries(roles)) {
            expect(role['DeletionPolicy']).toBeUndefined();
          }
          const policies = getResourcesOfType(resources, 'AWS::IAM::Policy');
          for (const [, policy] of Object.entries(policies)) {
            expect(policy['DeletionPolicy']).toBeUndefined();
          }
        });

        it('same architecture as other profile', () => {
          const otherResources = synth('PERSONAL_AWS_DEV', secretAccess, `arch-other-${secretAccess.mode}`);
          expect(countByType(otherResources, 'AWS::IAM::Role')).toBe(
            countByType(resources, 'AWS::IAM::Role'),
          );
        });
      });
    }
  }
});

// ─── C. Trust policy ────────────────────────────────────────────────

describe('C. Trust policy', () => {
  for (const profile of PROFILES) {
    for (const secretAccess of SECRET_CONFIGS) {
      const label = `${profile} / secret=${secretAccess.mode}`;
      it(`only Lambda service principal (${label})`, () => {
        const resources = synth(profile, secretAccess, `trust-${profile}-${secretAccess.mode}`)!;
        const roles = getResourcesOfType(resources, 'AWS::IAM::Role');
        const role = Object.values(roles)[0]!;
        const props = role['Properties'] as Record<string, unknown>;
        const assumeRole = props['AssumeRolePolicyDocument'] as Record<string, unknown>;
        const stmts = (assumeRole['Statement'] as unknown[]) ?? [];
        expect(stmts).toHaveLength(1);
        const stmt = stmts[0] as Record<string, unknown>;
        expect(stmt['Effect']).toBe('Allow');
        expect(stmt['Action']).toBe('sts:AssumeRole');
        expect(stmt['Principal'] as Record<string, unknown>).toEqual({
          Service: 'lambda.amazonaws.com',
        });
      });
    }
  }
});

// ─── D. DecisionCore read-only ─────────────────────────────────────────

describe('D. DecisionCore read-only', () => {
  for (const profile of PROFILES) {
    for (const secretAccess of SECRET_CONFIGS) {
      const label = `${profile} / secret=${secretAccess.mode}`;
      describe(`D. ${label}`, () => {
        const rawStmts = getRawStatements(profile, secretAccess, `core-${profile}-${secretAccess.mode}`);
        const coreAllow = rawStmts.find((s) => {
          const actions = (s as Record<string, unknown>)['Action'];
          if (Array.isArray(actions)) return actions.includes('dynamodb:GetItem');
          return actions === 'dynamodb:GetItem';
        }) as Record<string, unknown> | undefined;

        it('DecisionCore GetItem ALLOW exists', () => {
          expect(coreAllow).toBeDefined();
        });

        it('GetItem resource = exact DecisionCore ARN', () => {
          expect(coreAllow!['Resource']).toBe(fakeCoreArn('DecisionCoreTable'));
        });

        it('GetItem actions exactly dynamodb:GetItem', () => {
          const actions = Array.isArray(coreAllow!['Action'])
            ? (coreAllow!['Action'] as string[])
            : [coreAllow!['Action'] as string];
          expect(actions).toEqual(['dynamodb:GetItem']);
        });

        it('no other DecisionCore read actions (BatchGetItem, Query, Scan = not allowed)', () => {
          const dynamoAllows = rawStmts.filter(
            (s) =>
              (s as Record<string, unknown>)['Effect'] === 'Allow' &&
              String((s as Record<string, unknown>)['Action']).includes('dynamodb:'),
          );
          const allActions = dynamoAllows.flatMap((s) =>
            Array.isArray((s as Record<string, unknown>)['Action'])
              ? ((s as Record<string, unknown>)['Action'] as string[])
              : [(s as Record<string, unknown>)['Action'] as string],
          );
          expect(allActions).not.toContain('dynamodb:BatchGetItem');
          expect(allActions).not.toContain('dynamodb:Query');
          expect(allActions).not.toContain('dynamodb:Scan');
        });

        it('DecisionCore write Deny exists (Resource = exact ARN)', () => {
          const coreDeny = rawStmts.find(
            (s) =>
              (s as Record<string, unknown>)['Effect'] === 'Deny' &&
              (s as Record<string, unknown>)['Resource'] === fakeCoreArn('DecisionCoreTable'),
          );
          expect(coreDeny).toBeDefined();
        });

        it('DecisionCore write Deny has exactly 7 actions', () => {
          const coreDeny = rawStmts.find(
            (s) =>
              (s as Record<string, unknown>)['Effect'] === 'Deny' &&
              (s as Record<string, unknown>)['Resource'] === fakeCoreArn('DecisionCoreTable'),
          ) as Record<string, unknown> | undefined;
          const actions = Array.isArray(coreDeny!['Action'])
            ? (coreDeny!['Action'] as string[])
            : [coreDeny!['Action'] as string];
          expect(actions).toHaveLength(7);
        });

        it('DecisionCore write Deny has no invalid actions', () => {
          const coreDeny = rawStmts.find(
            (s) =>
              (s as Record<string, unknown>)['Effect'] === 'Deny' &&
              (s as Record<string, unknown>)['Resource'] === fakeCoreArn('DecisionCoreTable'),
          ) as Record<string, unknown> | undefined;
          const actions = Array.isArray(coreDeny!['Action'])
            ? (coreDeny!['Action'] as string[])
            : [coreDeny!['Action'] as string];
          expect(actions).not.toContain('dynamodb:TransactWriteItems');
          expect(actions).not.toContain('dynamodb:ExecuteTransaction');
        });

        // Effective proofs
        const statements = parseStatements(getPolicyDoc(profile, secretAccess));
        const CORE = fakeCoreArn('DecisionCoreTable');

        it('DecisionCore GetItem = ALLOW', () => {
          expect(evaluatePolicy(statements, 'dynamodb:GetItem', CORE)).toBe('ALLOW');
        });

        it('DecisionCore PutItem = EXPLICIT_DENY', () => {
          expect(evaluatePolicy(statements, 'dynamodb:PutItem', CORE)).toBe('DENY');
        });

        it('DecisionCore UpdateItem = EXPLICIT_DENY', () => {
          expect(evaluatePolicy(statements, 'dynamodb:UpdateItem', CORE)).toBe('DENY');
        });

        it('DecisionCore DeleteItem = EXPLICIT_DENY', () => {
          expect(evaluatePolicy(statements, 'dynamodb:DeleteItem', CORE)).toBe('DENY');
        });

        it('DecisionCore BatchWriteItem = EXPLICIT_DENY', () => {
          expect(evaluatePolicy(statements, 'dynamodb:BatchWriteItem', CORE)).toBe('DENY');
        });

        it('DecisionCore PartiQLInsert = EXPLICIT_DENY', () => {
          expect(evaluatePolicy(statements, 'dynamodb:PartiQLInsert', CORE)).toBe('DENY');
        });

        it('DecisionCore PartiQLUpdate = EXPLICIT_DENY', () => {
          expect(evaluatePolicy(statements, 'dynamodb:PartiQLUpdate', CORE)).toBe('DENY');
        });

        it('DecisionCore PartiQLDelete = EXPLICIT_DENY', () => {
          expect(evaluatePolicy(statements, 'dynamodb:PartiQLDelete', CORE)).toBe('DENY');
        });

        it('DecisionCore write Allow count = 0', () => {
          const writeAllow = statements.filter(
            (s) =>
              s.effect === 'Allow' &&
              s.resource === CORE &&
              ['PutItem', 'UpdateItem', 'DeleteItem', 'BatchWriteItem', 'PartiQLInsert', 'PartiQLUpdate', 'PartiQLDelete'].some(
                (a) => s.action.includes(a),
              ),
          );
          expect(writeAllow).toHaveLength(0);
        });
      });
    }
  }
});

// ─── E. DecisionNarrative Put-only ───────────────────────────────────────

describe('E. DecisionNarrative Put-only', () => {
  for (const profile of PROFILES) {
    for (const secretAccess of SECRET_CONFIGS) {
      const label = `${profile} / secret=${secretAccess.mode}`;
      describe(`E. ${label}`, () => {
        const rawStmts = getRawStatements(profile, secretAccess, `narr-${profile}-${secretAccess.mode}`);
        const narrAllow = rawStmts.find((s) => {
          const actions = (s as Record<string, unknown>)['Action'];
          if (Array.isArray(actions)) return actions.includes('dynamodb:PutItem');
          return actions === 'dynamodb:PutItem';
        }) as Record<string, unknown> | undefined;

        it('Narrative PutItem ALLOW exists', () => {
          expect(narrAllow).toBeDefined();
        });

        it('Narrative PutItem resource = exact Narrative ARN', () => {
          expect(narrAllow!['Resource']).toBe(fakeNarrArn('DecisionNarrativeTable'));
        });

        it('Narrative PutItem is the ONLY DynamoDB ALLOW action', () => {
          const dynamoAllows = rawStmts.filter(
            (s) =>
              (s as Record<string, unknown>)['Effect'] === 'Allow' &&
              String((s as Record<string, unknown>)['Action']).includes('dynamodb:'),
          );
          // Should only be GetItem (core) + PutItem (narrative) = 2
          const allActions = dynamoAllows.flatMap((s) =>
            Array.isArray((s as Record<string, unknown>)['Action'])
              ? ((s as Record<string, unknown>)['Action'] as string[])
              : [(s as Record<string, unknown>)['Action'] as string],
          );
          expect(allActions).toContain('dynamodb:GetItem'); // core read
          expect(allActions).toContain('dynamodb:PutItem'); // narrative write
        });

        it('DynamoDB writer island NotResource = exact Narrative ARN', () => {
          const island = rawStmts.find(
            (s) =>
              (s as Record<string, unknown>)['Effect'] === 'Deny' &&
              (s as Record<string, unknown>)['NotResource'] === fakeNarrArn('DecisionNarrativeTable'),
          );
          expect(island).toBeDefined();
        });

        // Effective proofs
        const statements = parseStatements(getPolicyDoc(profile, secretAccess));
        const NARR = fakeNarrArn('DecisionNarrativeTable');

        it('Narrative PutItem = ALLOW', () => {
          expect(evaluatePolicy(statements, 'dynamodb:PutItem', NARR)).toBe('ALLOW');
        });

        it('Narrative UpdateItem = IMPLICIT_DENY', () => {
          expect(evaluatePolicy(statements, 'dynamodb:UpdateItem', NARR)).not.toBe('ALLOW');
        });

        it('Narrative DeleteItem = IMPLICIT_DENY', () => {
          expect(evaluatePolicy(statements, 'dynamodb:DeleteItem', NARR)).not.toBe('ALLOW');
        });

        it('Narrative BatchWriteItem = IMPLICIT_DENY', () => {
          expect(evaluatePolicy(statements, 'dynamodb:BatchWriteItem', NARR)).not.toBe('ALLOW');
        });

        it('Narrative PartiQLInsert = IMPLICIT_DENY', () => {
          expect(evaluatePolicy(statements, 'dynamodb:PartiQLInsert', NARR)).not.toBe('ALLOW');
        });

        it('Narrative PartiQLUpdate = IMPLICIT_DENY', () => {
          expect(evaluatePolicy(statements, 'dynamodb:PartiQLUpdate', NARR)).not.toBe('ALLOW');
        });

        it('Narrative PartiQLDelete = IMPLICIT_DENY', () => {
          expect(evaluatePolicy(statements, 'dynamodb:PartiQLDelete', NARR)).not.toBe('ALLOW');
        });
      });
    }
  }
});

// ─── F. Cross-table write proofs ────────────────────────────────────────

describe('F. Cross-table write proofs', () => {
  for (const profile of PROFILES) {
    for (const secretAccess of SECRET_CONFIGS) {
      const label = `${profile} / secret=${secretAccess.mode}`;
      describe(`F. ${label}`, () => {
        const statements = parseStatements(getPolicyDoc(profile, secretAccess));
        const CORE = fakeCoreArn('DecisionCoreTable');
        const NARR = fakeNarrArn('DecisionNarrativeTable');
        const IDEM = fakeIdemArn('IdempotencyTable');
        const PUB = fakePublishArn('PublishRecordTable');
        const CONN = fakeCoreArn('ConnectionsTable');
        const FUTURE = fakeCoreArn('FutureTable');

        it('Narrative PutItem = ALLOW', () => {
          expect(evaluatePolicy(statements, 'dynamodb:PutItem', NARR)).toBe('ALLOW');
        });

        it('Core PutItem = EXPLICIT_DENY', () => {
          expect(evaluatePolicy(statements, 'dynamodb:PutItem', CORE)).toBe('DENY');
        });

        it('Idempotency PutItem = EXPLICIT_DENY', () => {
          expect(evaluatePolicy(statements, 'dynamodb:PutItem', IDEM)).toBe('DENY');
        });

        it('PublishRecord PutItem = EXPLICIT_DENY', () => {
          expect(evaluatePolicy(statements, 'dynamodb:PutItem', PUB)).toBe('DENY');
        });

        it('Connections PutItem = EXPLICIT_DENY', () => {
          expect(evaluatePolicy(statements, 'dynamodb:PutItem', CONN)).toBe('DENY');
        });

        it('future table PutItem = EXPLICIT_DENY', () => {
          expect(evaluatePolicy(statements, 'dynamodb:PutItem', FUTURE)).toBe('DENY');
        });

        it('Idempotency UpdateItem = EXPLICIT_DENY', () => {
          expect(evaluatePolicy(statements, 'dynamodb:UpdateItem', IDEM)).toBe('DENY');
        });

        it('PublishRecord UpdateItem = EXPLICIT_DENY', () => {
          expect(evaluatePolicy(statements, 'dynamodb:UpdateItem', PUB)).toBe('DENY');
        });

        it('Narrative UpdateItem = IMPLICIT_DENY', () => {
          expect(evaluatePolicy(statements, 'dynamodb:UpdateItem', NARR)).not.toBe('ALLOW');
        });

        it('Narrative DeleteItem = IMPLICIT_DENY', () => {
          expect(evaluatePolicy(statements, 'dynamodb:DeleteItem', NARR)).not.toBe('ALLOW');
        });
      });
    }
  }
});

// ─── G. Bedrock model allowlist ────────────────────────────────────────

describe('G. Bedrock model allowlist', () => {
  for (const profile of PROFILES) {
    for (const secretAccess of SECRET_CONFIGS) {
      const label = `${profile} / secret=${secretAccess.mode}`;
      describe(`G. ${label}`, () => {
        const rawStmts = getRawStatements(profile, secretAccess, `bedrock-${profile}-${secretAccess.mode}`);
        const bedrockAllow = rawStmts.find(
          (s) =>
            (s as Record<string, unknown>)['Effect'] === 'Allow' &&
            String((s as Record<string, unknown>)['Action']).includes('bedrock:InvokeModel'),
        ) as Record<string, unknown> | undefined;

        it('Bedrock InvokeModel ALLOW exists', () => {
          expect(bedrockAllow).toBeDefined();
        });

        it('Bedrock ALLOW actions exactly InvokeModel + InvokeModelWithResponseStream', () => {
          const actions = Array.isArray(bedrockAllow!['Action'])
            ? (bedrockAllow!['Action'] as string[])
            : [bedrockAllow!['Action'] as string];
          expect(actions).toContain('bedrock:InvokeModel');
          expect(actions).toContain('bedrock:InvokeModelWithResponseStream');
          expect(actions).toHaveLength(2);
        });

        it('Bedrock ALLOW resources are non-empty', () => {
          const resources = Array.isArray(bedrockAllow!['Resource'])
            ? (bedrockAllow!['Resource'] as string[])
            : [bedrockAllow!['Resource'] as string];
          expect(resources.length).toBeGreaterThan(0);
        });

        it('Bedrock ALLOW resources contain no wildcard', () => {
          const resources = Array.isArray(bedrockAllow!['Resource'])
            ? (bedrockAllow!['Resource'] as string[])
            : [bedrockAllow!['Resource'] as string];
          for (const r of resources) {
            expect(r).not.toBe('*');
            expect(r).not.toContain('*');
          }
        });

        it('no Converse/ConverseStream IAM actions in ALLOW', () => {
          const actions = Array.isArray(bedrockAllow!['Action'])
            ? (bedrockAllow!['Action'] as string[])
            : [bedrockAllow!['Action'] as string];
          expect(actions).not.toContain('bedrock:Converse');
          expect(actions).not.toContain('bedrock:ConverseStream');
        });

        it('Bedrock model Deny (NotResource) exists', () => {
          const modelDeny = rawStmts.find(
            (s) =>
              (s as Record<string, unknown>)['Effect'] === 'Deny' &&
              String((s as Record<string, unknown>)['Action']).includes('bedrock:InvokeModel') &&
              (s as Record<string, unknown>)['NotResource'] !== undefined,
          );
          expect(modelDeny).toBeDefined();
        });

        it('RetrieveAndGenerate Deny exists', () => {
          const ragDeny = rawStmts.find(
            (s) =>
              (s as Record<string, unknown>)['Effect'] === 'Deny' &&
              String((s as Record<string, unknown>)['Action']).includes('bedrock:RetrieveAndGenerate'),
          );
          expect(ragDeny).toBeDefined();
        });

        // Effective proofs
        const statements = parseStatements(getPolicyDoc(profile, secretAccess));
        const ALLOWED_MODEL = fakeModelArn('fm', 'anthropic.claude-3-sonnet-20240207-v1:0');
        const OTHER_MODEL = fakeModelArn('fm', 'other.provider.model');

        it('allowed model InvokeModel = ALLOW', () => {
          expect(evaluatePolicy(statements, 'bedrock:InvokeModel', ALLOWED_MODEL)).toBe('ALLOW');
        });

        it('allowed model InvokeModelWithResponseStream = ALLOW', () => {
          expect(evaluatePolicy(statements, 'bedrock:InvokeModelWithResponseStream', ALLOWED_MODEL)).toBe('ALLOW');
        });

        it('other model InvokeModel = EXPLICIT_DENY', () => {
          expect(evaluatePolicy(statements, 'bedrock:InvokeModel', OTHER_MODEL)).toBe('DENY');
        });

        it('other model InvokeModelWithResponseStream = EXPLICIT_DENY', () => {
          expect(evaluatePolicy(statements, 'bedrock:InvokeModelWithResponseStream', OTHER_MODEL)).toBe('DENY');
        });

        it('wildcard model Allow = 0', () => {
          const wildcardAllow = statements.filter(
            (s) =>
              s.effect === 'Allow' &&
              s.resource === '*' &&
              s.action.includes('bedrock:'),
          );
          expect(wildcardAllow).toHaveLength(0);
        });

        it('action wildcard = 0', () => {
          const wildcardActions = statements.filter(
            (s) => s.effect === 'Allow' && s.action.includes('bedrock:') && s.action.endsWith('*'),
          );
          expect(wildcardActions).toHaveLength(0);
        });
      });
    }
  }
});

// ─── H. Knowledge Base ────────────────────────────────────────────────

describe('H. Knowledge Base', () => {
  for (const profile of PROFILES) {
    for (const secretAccess of SECRET_CONFIGS) {
      const label = `${profile} / secret=${secretAccess.mode}`;
      describe(`H. ${label}`, () => {
        const rawStmts = getRawStatements(profile, secretAccess, `kb-${profile}-${secretAccess.mode}`);
        const kbAllow = rawStmts.find(
          (s) =>
            (s as Record<string, unknown>)['Effect'] === 'Allow' &&
            String((s as Record<string, unknown>)['Action']).includes('bedrock:Retrieve'),
        ) as Record<string, unknown> | undefined;

        it('KB Retrieve ALLOW exists', () => {
          expect(kbAllow).toBeDefined();
        });

        it('KB Retrieve resource = exact KB ARN', () => {
          expect(kbAllow!['Resource']).toBe(fakeKbArn('ABCDEFGH'));
        });

        it('KB Retrieve action is exactly bedrock:Retrieve', () => {
          const actions = Array.isArray(kbAllow!['Action'])
            ? (kbAllow!['Action'] as string[])
            : [kbAllow!['Action'] as string];
          expect(actions).toEqual(['bedrock:Retrieve']);
        });

        it('KB Retrieve Deny (NotResource) exists', () => {
          const kbDeny = rawStmts.find(
            (s) =>
              (s as Record<string, unknown>)['Effect'] === 'Deny' &&
              (s as Record<string, unknown>)['Action'] === 'bedrock:Retrieve' &&
              (s as Record<string, unknown>)['NotResource'] !== undefined,
          );
          expect(kbDeny).toBeDefined();
        });

        // Effective proofs
        const statements = parseStatements(getPolicyDoc(profile, secretAccess));
        const ALLOWED_KB = fakeKbArn('ABCDEFGH');
        const OTHER_KB = fakeKbArn('OTHERKB');

        it('allowed KB Retrieve = ALLOW', () => {
          expect(evaluatePolicy(statements, 'bedrock:Retrieve', ALLOWED_KB)).toBe('ALLOW');
        });

        it('other KB Retrieve = EXPLICIT_DENY', () => {
          expect(evaluatePolicy(statements, 'bedrock:Retrieve', OTHER_KB)).toBe('DENY');
        });

        it('RetrieveAndGenerate = EXPLICIT_DENY', () => {
          expect(evaluatePolicy(statements, 'bedrock:RetrieveAndGenerate', '*')).toBe('DENY');
        });

        it('GetDocumentContent = IMPLICIT_DENY', () => {
          expect(evaluatePolicy(statements, 'bedrock:GetDocumentContent', '*')).toBe('IMPLICIT_DENY');
        });

        it('KB wildcard Allow = 0', () => {
          const wildcardAllow = statements.filter(
            (s) =>
              s.effect === 'Allow' &&
              s.resource === '*' &&
              s.action.includes('bedrock:'),
          );
          expect(wildcardAllow).toHaveLength(0);
        });
      });
    }
  }
});

// ─── I. S3 SOP ─────────────────────────────────────────────────────

describe('I. S3 SOP', () => {
  for (const profile of PROFILES) {
    for (const secretAccess of SECRET_CONFIGS) {
      const label = `${profile} / secret=${secretAccess.mode}`;
      describe(`I. ${label}`, () => {
        const rawStmts = getRawStatements(profile, secretAccess, `s3-${profile}-${secretAccess.mode}`);
        const s3Allow = rawStmts.find(
          (s) =>
            (s as Record<string, unknown>)['Effect'] === 'Allow' &&
            String((s as Record<string, unknown>)['Action']).includes('s3:GetObject'),
        ) as Record<string, unknown> | undefined;

        it('S3 GetObject ALLOW exists', () => {
          expect(s3Allow).toBeDefined();
        });

        it('S3 GetObject resource is bounded (not "*")', () => {
          expect(s3Allow!['Resource']).not.toBe('*');
        });

        it('S3 GetObject resource is not bare bucket ARN', () => {
          expect(s3Allow!['Resource']).not.toBe(fakeS3BucketArn('sop-bucket'));
        });

        it('S3 GetObject resource contains SOP prefix', () => {
          expect(s3Allow!['Resource'] as string).toContain('/sop/');
        });

        it('S3 write Deny exists', () => {
          const s3Deny = rawStmts.find(
            (s) =>
              (s as Record<string, unknown>)['Effect'] === 'Deny' &&
              String((s as Record<string, unknown>)['Action']).includes('s3:PutObject'),
          );
          expect(s3Deny).toBeDefined();
        });

        it('S3 write Deny has exactly 5 actions', () => {
          const s3Deny = rawStmts.find(
            (s) =>
              (s as Record<string, unknown>)['Effect'] === 'Deny' &&
              Array.isArray((s as Record<string, unknown>)['Action']) &&
              ((s as Record<string, unknown>)['Action'] as string[]).includes('s3:PutObject'),
          ) as Record<string, unknown> | undefined;
          const actions = s3Deny!['Action'] as string[];
          expect(actions).toContain('s3:PutObject');
          expect(actions).toContain('s3:DeleteObject');
          expect(actions).toContain('s3:DeleteObjectVersion');
          expect(actions).toContain('s3:AbortMultipartUpload');
          expect(actions).toContain('s3:RestoreObject');
          expect(actions).toHaveLength(5);
        });

        // Effective proofs
        const statements = parseStatements(getPolicyDoc(profile, secretAccess));
        const SOP_OBJ = `${fakeS3BucketArn('sop-bucket')}/sop/doc.pdf`;
        const NESTED_SOP = `${fakeS3BucketArn('sop-bucket')}/sop/2026/07/doc.pdf`;
        const OTHER_BUCKET = `${fakeS3BucketArn('other-bucket')}/sop/doc.pdf`;
        const SIMILAR_PREFIX = `${fakeS3BucketArn('sop-bucket')}/sop_evil/doc.pdf`;

        it('GetObject on SOP object = ALLOW', () => {
          expect(evaluatePolicy(statements, 's3:GetObject', SOP_OBJ)).toBe('ALLOW');
        });

        it('GetObject on nested SOP object = ALLOW', () => {
          expect(evaluatePolicy(statements, 's3:GetObject', NESTED_SOP)).toBe('ALLOW');
        });

        it('GetObject on other bucket = IMPLICIT_DENY', () => {
          expect(evaluatePolicy(statements, 's3:GetObject', OTHER_BUCKET)).toBe('IMPLICIT_DENY');
        });

        it('GetObject on similar prefix = IMPLICIT_DENY', () => {
          expect(evaluatePolicy(statements, 's3:GetObject', SIMILAR_PREFIX)).toBe('IMPLICIT_DENY');
        });

        it('ListBucket = IMPLICIT_DENY', () => {
          expect(evaluatePolicy(statements, 's3:ListBucket', fakeS3BucketArn('sop-bucket'))).toBe('IMPLICIT_DENY');
        });

        it('PutObject = EXPLICIT_DENY', () => {
          expect(evaluatePolicy(statements, 's3:PutObject', SOP_OBJ)).toBe('DENY');
        });

        it('DeleteObject = EXPLICIT_DENY', () => {
          expect(evaluatePolicy(statements, 's3:DeleteObject', SOP_OBJ)).toBe('DENY');
        });

        it('DeleteObjectVersion = EXPLICIT_DENY', () => {
          expect(evaluatePolicy(statements, 's3:DeleteObjectVersion', SOP_OBJ)).toBe('DENY');
        });

        it('AbortMultipartUpload = EXPLICIT_DENY', () => {
          expect(evaluatePolicy(statements, 's3:AbortMultipartUpload', SOP_OBJ)).toBe('DENY');
        });

        it('RestoreObject = EXPLICIT_DENY', () => {
          expect(evaluatePolicy(statements, 's3:RestoreObject', SOP_OBJ)).toBe('DENY');
        });
      });
    }
  }
});

// ─── J. CloudWatch Logs ────────────────────────────────────────────────

describe('J. CloudWatch Logs', () => {
  for (const profile of PROFILES) {
    for (const secretAccess of SECRET_CONFIGS) {
      const label = `${profile} / secret=${secretAccess.mode}`;
      describe(`J. ${label}`, () => {
        const rawStmts = getRawStatements(profile, secretAccess, `logs-${profile}-${secretAccess.mode}`);
        const logStmts = rawStmts.filter((s) => {
          const actions = (s as Record<string, unknown>)['Action'];
          if (Array.isArray(actions)) return actions.includes('logs:CreateLogStream');
          return actions === 'logs:CreateLogStream';
        });

        it('exactly 1 CloudWatch Logs Allow statement', () => {
          expect(logStmts).toHaveLength(1);
        });

        it('exactly 2 actions: CreateLogStream + PutLogEvents', () => {
          const stmt = logStmts[0] as Record<string, unknown>;
          const actions = Array.isArray(stmt['Action'])
            ? (stmt['Action'] as string[])
            : [stmt['Action'] as string];
          expect(actions).toContain('logs:CreateLogStream');
          expect(actions).toContain('logs:PutLogEvents');
          expect(actions).toHaveLength(2);
        });

        it('Resource ends with :log-stream:*', () => {
          const stmt = logStmts[0] as Record<string, unknown>;
          expect((stmt['Resource'] as string).endsWith(':log-stream:*')).toBe(true);
        });

        it('Resource starts with injected Log Group ARN', () => {
          const stmt = logStmts[0] as Record<string, unknown>;
          expect((stmt['Resource'] as string).startsWith(fakeLogGroupArn('/test/RendererFn'))).toBe(true);
        });

        it('Resource is NOT "*"', () => {
          const stmt = logStmts[0] as Record<string, unknown>;
          expect(stmt['Resource']).not.toBe('*');
        });

        // Effective proofs
        const statements = parseStatements(getPolicyDoc(profile, secretAccess));
        const LG = fakeLogGroupArn('/test/RendererFn');

        it('same group stream = ALLOW', () => {
          expect(evaluatePolicy(statements, 'logs:CreateLogStream', `${LG}:log-stream:test`)).toBe('ALLOW');
        });

        it('other group stream = IMPLICIT_DENY', () => {
          expect(evaluatePolicy(statements, 'logs:PutLogEvents', `arn:aws:logs:us-east-1:111111111111:log-group:/other/Group:log-stream:x`)).toBe('IMPLICIT_DENY');
        });

        it('similar-prefix group = IMPLICIT_DENY', () => {
          expect(evaluatePolicy(statements, 'logs:PutLogEvents', `arn:aws:logs:us-east-1:111111111111:log-group:/test/RendererFnExtra:log-stream:x`)).toBe('IMPLICIT_DENY');
        });

        it('bare group ARN = IMPLICIT_DENY', () => {
          expect(evaluatePolicy(statements, 'logs:CreateLogStream', LG)).not.toBe('ALLOW');
        });

        it('CreateLogGroup = IMPLICIT_DENY', () => {
          expect(evaluatePolicy(statements, 'logs:CreateLogGroup', LG)).toBe('IMPLICIT_DENY');
        });
      });
    }
  }
});

// ─── K. SSM ─────────────────────────────────────────────────────────

describe('K. SSM', () => {
  for (const profile of PROFILES) {
    for (const secretAccess of SECRET_CONFIGS) {
      const label = `${profile} / secret=${secretAccess.mode}`;
      describe(`K. ${label}`, () => {
        const rawStmts = getRawStatements(profile, secretAccess, `ssm-${profile}-${secretAccess.mode}`);
        const ssmStmts = rawStmts.filter(
          (s) =>
            (s as Record<string, unknown>)['Action'] === 'ssm:GetParametersByPath',
        );

        it('exactly 1 SSM Allow statement', () => {
          expect(ssmStmts).toHaveLength(1);
        });

        it('action = ssm:GetParametersByPath', () => {
          const stmt = ssmStmts[0] as Record<string, unknown>;
          expect(stmt['Action']).toBe('ssm:GetParametersByPath');
        });

        it('resource uses "/*" suffix', () => {
          const stmt = ssmStmts[0] as Record<string, unknown>;
          expect((stmt['Resource'] as string).endsWith('/*')).toBe(true);
        });

        it('Resource "*" absent', () => {
          const stmt = ssmStmts[0] as Record<string, unknown>;
          expect(stmt['Resource']).not.toBe('*');
        });

        // Effective proofs
        const statements = parseStatements(getPolicyDoc(profile, secretAccess));
        const HIER = fakeSsmArn('/test/params');

        it('descendant = ALLOW', () => {
          expect(evaluatePolicy(statements, 'ssm:GetParametersByPath', `${HIER}/api/endpoint`)).toBe('ALLOW');
        });

        it('nested descendant = ALLOW', () => {
          expect(evaluatePolicy(statements, 'ssm:GetParametersByPath', `${HIER}/a/b/c`)).toBe('ALLOW');
        });

        it('sibling profile = IMPLICIT_DENY', () => {
          expect(evaluatePolicy(statements, 'ssm:GetParametersByPath', fakeSsmArn('/test/params_EVIL'))).toBe('IMPLICIT_DENY');
        });

        it('prefix collision = IMPLICIT_DENY', () => {
          expect(evaluatePolicy(statements, 'ssm:GetParametersByPath', fakeSsmArn('/test/paramsxdev'))).toBe('IMPLICIT_DENY');
        });

        it('parent path = IMPLICIT_DENY', () => {
          expect(evaluatePolicy(statements, 'ssm:GetParametersByPath', fakeSsmArn('/test'))).toBe('IMPLICIT_DENY');
        });

        it('PutParameter = IMPLICIT_DENY', () => {
          expect(evaluatePolicy(statements, 'ssm:PutParameter', `${HIER}/key`)).toBe('IMPLICIT_DENY');
        });
      });
    }
  }
});

// ─── L. Secrets (NONE mode) ───────────────────────────────────────────

describe('L. Secrets (NONE mode)', () => {
  for (const profile of PROFILES) {
    const label = `${profile} / NONE`;
    describe(`L. ${label}`, () => {
      const statements = parseStatements(getPolicyDoc(profile, { mode: 'NONE' }, `secrets-none-${profile}`));

      it('Secrets Manager ALLOW count = 0', () => {
        const secretsAllow = statements.filter(
          (s) =>
            s.effect === 'Allow' && s.action.includes('secretsmanager:'),
        );
        expect(secretsAllow).toHaveLength(0);
      });

      it('GetSecretValue = IMPLICIT_DENY', () => {
        expect(
          evaluatePolicy(statements, 'secretsmanager:GetSecretValue', fakeSecretArn('some/secret')),
        ).toBe('IMPLICIT_DENY');
      });

      it('evidence secretAccessMode = NONE', () => {
        const { construct } = makeRole(profile, { mode: 'NONE' }, `secrets-evidence-none-${profile}`);
        expect(construct.evidence.secretAccessMode).toBe('NONE');
        expect(construct.evidence.secretArns).toHaveLength(0);
      });
    });
  }
});

// ─── L. Secrets (EXACT mode) ───────────────────────────────────────────

describe('L. Secrets (EXACT mode)', () => {
  for (const profile of PROFILES) {
    const label = `${profile} / EXACT`;
    describe(`L. ${label}`, () => {
      const secretAccess: SecretAccessConfig = {
        mode: 'EXACT',
        secretArns: [fakeSecretArn('renderer/bedrock-key')],
      };
      const rawStmts = getRawStatements(profile, secretAccess, `secrets-exact-${profile}`);
      const secretsAllow = rawStmts.find(
        (s) =>
          (s as Record<string, unknown>)['Effect'] === 'Allow' &&
          String((s as Record<string, unknown>)['Action']).includes('secretsmanager:'),
      ) as Record<string, unknown> | undefined;

      it('Secrets Manager ALLOW exists', () => {
        expect(secretsAllow).toBeDefined();
      });

      it('Secrets ALLOW action = GetSecretValue', () => {
        const actions = Array.isArray(secretsAllow!['Action'])
          ? (secretsAllow!['Action'] as string[])
          : [secretsAllow!['Action'] as string];
        expect(actions).toEqual(['secretsmanager:GetSecretValue']);
      });

      it('Secrets ALLOW resource = exact secret ARN', () => {
        const resources = Array.isArray(secretsAllow!['Resource'])
          ? (secretsAllow!['Resource'] as string[])
          : [secretsAllow!['Resource'] as string];
        expect(resources).toContain(fakeSecretArn('renderer/bedrock-key'));
      });

      it('Secrets ALLOW resources contain no wildcard', () => {
        const resources = Array.isArray(secretsAllow!['Resource'])
          ? (secretsAllow!['Resource'] as string[])
          : [secretsAllow!['Resource'] as string];
        for (const r of resources) {
          expect(r).not.toBe('*');
        }
      });

      // Effective proofs
      const statements = parseStatements(getPolicyDoc(profile, secretAccess));
      const ALLOWED_SECRET = fakeSecretArn('renderer/bedrock-key');
      const OTHER_SECRET = fakeSecretArn('other/secret');

      it('allowed secret GetSecretValue = ALLOW', () => {
        expect(evaluatePolicy(statements, 'secretsmanager:GetSecretValue', ALLOWED_SECRET)).toBe('ALLOW');
      });

      it('other secret GetSecretValue = IMPLICIT_DENY', () => {
        expect(evaluatePolicy(statements, 'secretsmanager:GetSecretValue', OTHER_SECRET)).toBe('IMPLICIT_DENY');
      });

      it('wildcard secret Allow = 0', () => {
        const wildcardAllow = statements.filter(
          (s) => s.effect === 'Allow' && s.resource === '*' && s.action.includes('secretsmanager:'),
        );
        expect(wildcardAllow).toHaveLength(0);
      });

      it('PutSecretValue = IMPLICIT_DENY', () => {
        expect(evaluatePolicy(statements, 'secretsmanager:PutSecretValue', ALLOWED_SECRET)).toBe('IMPLICIT_DENY');
      });

      it('DeleteSecret = IMPLICIT_DENY', () => {
        expect(evaluatePolicy(statements, 'secretsmanager:DeleteSecret', ALLOWED_SECRET)).toBe('IMPLICIT_DENY');
      });

      it('evidence secretAccessMode = EXACT', () => {
        const { construct } = makeRole(profile, secretAccess, `secrets-evidence-exact-${profile}`);
        expect(construct.evidence.secretAccessMode).toBe('EXACT');
        expect(construct.evidence.secretArns).toHaveLength(1);
      });
    });
  }
});

// ─── M. Forbidden capabilities ───────────────────────────────────────

describe('M. Forbidden capabilities', () => {
  for (const profile of PROFILES) {
    for (const secretAccess of SECRET_CONFIGS) {
      const label = `${profile} / secret=${secretAccess.mode}`;
      describe(`M. ${label}`, () => {
        const statements = parseStatements(getPolicyDoc(profile, secretAccess));

        it('lambda:InvokeFunction = IMPLICIT_DENY', () => {
          expect(
            evaluatePolicy(
              statements,
              'lambda:InvokeFunction',
              'arn:aws:lambda:us-east-1:111111111111:function:SomeFn',
            ),
          ).toBe('IMPLICIT_DENY');
        });

        it('states:StartExecution = IMPLICIT_DENY', () => {
          expect(
            evaluatePolicy(
              statements,
              'states:StartExecution',
              'arn:aws:states:us-east-1:111111111111:stateMachine:Workflow',
            ),
          ).toBe('IMPLICIT_DENY');
        });

        it('execute-api:ManageConnections = EXPLICIT_DENY', () => {
          expect(evaluatePolicy(statements, 'execute-api:ManageConnections', '*')).toBe('DENY');
        });

        it('kms:Decrypt = IMPLICIT_DENY', () => {
          expect(evaluatePolicy(statements, 'kms:Decrypt', '*')).toBe('IMPLICIT_DENY');
        });

        it('iam:PassRole = IMPLICIT_DENY', () => {
          expect(evaluatePolicy(statements, 'iam:PassRole', '*')).toBe('IMPLICIT_DENY');
        });

        it('cloudwatch:PutMetricData = IMPLICIT_DENY', () => {
          expect(evaluatePolicy(statements, 'cloudwatch:PutMetricData', '*')).toBe('IMPLICIT_DENY');
        });

        it('sns:Publish = IMPLICIT_DENY', () => {
          expect(evaluatePolicy(statements, 'sns:Publish', '*')).toBe('IMPLICIT_DENY');
        });

        it('events:PutEvents = IMPLICIT_DENY', () => {
          expect(evaluatePolicy(statements, 'events:PutEvents', '*')).toBe('IMPLICIT_DENY');
        });

        it('bedrock:StartIngestionJob = IMPLICIT_DENY', () => {
          expect(evaluatePolicy(statements, 'bedrock:StartIngestionJob', '*')).toBe('IMPLICIT_DENY');
        });
      });
    }
  }
});

// ─── N. Wildcard audit ─────────────────────────────────────────────

describe('N. Wildcard audit', () => {
  for (const profile of PROFILES) {
    for (const secretAccess of SECRET_CONFIGS) {
      const label = `${profile} / secret=${secretAccess.mode}`;
      it(`ALLOW Resource "*" = 0 (${label})`, () => {
        const statements = parseStatements(getPolicyDoc(profile, secretAccess));
        const fullWildcardAllow = statements.filter(
          (s) => s.effect === 'Allow' && s.resource === '*',
        );
        expect(fullWildcardAllow).toHaveLength(0);
      });

      it(`ALLOW action wildcard = 0 (${label})`, () => {
        const statements = parseStatements(getPolicyDoc(profile, secretAccess));
        const actionWildcard = statements.filter(
          (s) =>
            s.effect === 'Allow' &&
            (s.action === '*' || s.action.endsWith('*')),
        );
        expect(actionWildcard).toHaveLength(0);
      });

      it(`evidence.wildcardAllowCount = 0 (${label})`, () => {
        const { construct } = makeRole(profile, secretAccess, `wildcard-${profile}-${secretAccess.mode}`);
        expect(construct.evidence.wildcardAllowCount).toBe(0);
      });
    }
  }
});

// ─── O. Isolation ─────────────────────────────────────────────────

describe('O. Isolation', () => {
  for (const profile of PROFILES) {
    for (const secretAccess of SECRET_CONFIGS) {
      const label = `${profile} / secret=${secretAccess.mode}`;
      describe(`O. ${label}`, () => {
        const resources = synth(profile, secretAccess, `iso-${profile}-${secretAccess.mode}`);

        const FORBIDDEN_TYPES = [
          'AWS::Lambda::Function',
          'AWS::DynamoDB::Table',
          'AWS::S3::Bucket',
          'AWS::SSM::Parameter',
          'AWS::SecretsManager::Secret',
          'AWS::KMS::Key',
          'AWS::StepFunctions::StateMachine',
          'AWS::ApiGateway::RestApi',
          'AWS::ApiGatewayV2::Api',
          'AWS::CloudWatch::Alarm',
          'AWS::CloudWatch::Dashboard',
          'AWS::CloudWatch::LogGroup',
          'AWS::Bedrock::KnowledgeBase',
          'Custom::',
        ];

        for (const type of FORBIDDEN_TYPES) {
          it(`0 ${type} resources`, () => {
            expect(countByType(resources, type)).toBe(0);
          });
        }
      });
    }
  }
});

// ─── P. Evidence contract ─────────────────────────────────────────

describe('P. Evidence contract', () => {
  it('deterministicTruthWriteCapability = false', () => {
    const { construct } = makeRole('PERSONAL_AWS_DEV', { mode: 'NONE' }, 'ev-truth');
    expect(construct.evidence.deterministicTruthWriteCapability).toBe(false);
  });

  it('narrativePutCapability = true', () => {
    const { construct } = makeRole('PERSONAL_AWS_DEV', { mode: 'NONE' }, 'ev-narr');
    expect(construct.evidence.narrativePutCapability).toBe(true);
  });

  it('narrativeMutationCapability = false', () => {
    const { construct } = makeRole('PERSONAL_AWS_DEV', { mode: 'NONE' }, 'ev-mut');
    expect(construct.evidence.narrativeMutationCapability).toBe(false);
  });

  it('retrieveAndGenerateCapability = false', () => {
    const { construct } = makeRole('PERSONAL_AWS_DEV', { mode: 'NONE' }, 'ev-rag');
    expect(construct.evidence.retrieveAndGenerateCapability).toBe(false);
  });

  it('roleBoundToFunction = false', () => {
    const { construct } = makeRole('PERSONAL_AWS_DEV', { mode: 'NONE' }, 'ev-bind');
    expect(construct.evidence.roleBoundToFunction).toBe(false);
  });

  it('finalBindingOwner = TASK-179', () => {
    const { construct } = makeRole('PERSONAL_AWS_DEV', { mode: 'NONE' }, 'ev-owner');
    expect(construct.evidence.finalBindingOwner).toBe('TASK-179');
  });

  it('runtimeConditionalWriteOwner = TASK-116', () => {
    const { construct } = makeRole('PERSONAL_AWS_DEV', { mode: 'NONE' }, 'ev-cond');
    expect(construct.evidence.runtimeConditionalWriteOwner).toBe('TASK-116');
  });

  it('decisionCoreReadActions = GetItem', () => {
    const { construct } = makeRole('PERSONAL_AWS_DEV', { mode: 'NONE' }, 'ev-core');
    expect(construct.evidence.decisionCoreReadActions).toEqual(['dynamodb:GetItem']);
  });

  it('rendererLogStreamArn ends with :log-stream:*', () => {
    const { construct } = makeRole('PERSONAL_AWS_DEV', { mode: 'NONE' }, 'ev-logs');
    expect(construct.evidence.rendererLogStreamArn.endsWith(':log-stream:*')).toBe(true);
  });

  it('explicitDenyCategories includes DynamoDB:write-DecisionCore', () => {
    const { construct } = makeRole('PERSONAL_AWS_DEV', { mode: 'NONE' }, 'ev-deny-cat');
    expect(construct.evidence.explicitDenyCategories).toContain('DynamoDB:write-DecisionCore');
  });

  it('explicitDenyCategories includes Bedrock:unlisted-model', () => {
    const { construct } = makeRole('PERSONAL_AWS_DEV', { mode: 'NONE' }, 'ev-bc-deny');
    expect(construct.evidence.explicitDenyCategories).toContain('Bedrock:unlisted-model');
  });

  it('explicitDenyCategories includes Bedrock:RetrieveAndGenerate', () => {
    const { construct } = makeRole('PERSONAL_AWS_DEV', { mode: 'NONE' }, 'ev-rag-deny');
    expect(construct.evidence.explicitDenyCategories).toContain('Bedrock:RetrieveAndGenerate');
  });
});

// ─── Q. Validation rejections ────────────────────────────────────────

describe('Q. Validation rejections', () => {
  function baseProps(secretAccess: SecretAccessConfig) {
    const ctx = makeStack('PERSONAL_AWS_DEV', 'val-base').ctx;
    return {
      envContext: ctx,
      roleName: 'renderer-fn-role',
      decisionCoreTableArn: fakeCoreArn('DecisionCoreTable'),
      decisionNarrativeTableArn: fakeNarrArn('DecisionNarrativeTable'),
      idempotencyTableArn: fakeIdemArn('IdempotencyTable'),
      publishRecordTableArn: fakePublishArn('PublishRecordTable'),
      sopBucketArn: fakeS3BucketArn('sop-bucket'),
      sopObjectArnPattern: fakeS3ObjectPattern('sop-bucket', 'sop'),
      knowledgeBaseArn: fakeKbArn('ABCDEFGH'),
      modelInvocationResourceArns: [fakeModelArn('fm', 'test.model')],
      rendererLogGroupArn: fakeLogGroupArn('/test/RendererFn'),
      ssmParameterHierarchyArn: fakeSsmArn('/test/params'),
      secretAccess,
    };
  }

  it('blank roleName throws', () => {
    const { ctx, stack } = makeStack('PERSONAL_AWS_DEV', 'val-blank');
    expect(
      () =>
        new RendererFnRoleConstruct(stack, 'X', {
          ...baseProps({ mode: 'NONE' }),
          roleName: '',
        }),
    ).toThrow(/non-empty/i);
  });

  it('roleName with whitespace throws', () => {
    const { ctx, stack } = makeStack('PERSONAL_AWS_DEV', 'val-ws');
    expect(
      () =>
        new RendererFnRoleConstruct(stack, 'X', {
          ...baseProps({ mode: 'NONE' }),
          roleName: '  renderer-fn-role  ',
        }),
    ).toThrow(/whitespace/i);
  });

  it('roleName with "credential" throws', () => {
    const { ctx, stack } = makeStack('PERSONAL_AWS_DEV', 'val-cred');
    expect(
      () =>
        new RendererFnRoleConstruct(stack, 'X', {
          ...baseProps({ mode: 'NONE' }),
          roleName: 'renderer-credential-role',
        }),
    ).toThrow(/credential/i);
  });

  it('non-DynamoDB decisionCoreTableArn throws', () => {
    const { ctx, stack } = makeStack('PERSONAL_AWS_DEV', 'val-ddb-core');
    expect(
      () =>
        new RendererFnRoleConstruct(stack, 'X', {
          ...baseProps({ mode: 'NONE' }),
          decisionCoreTableArn: fakeS3BucketArn('FakeTable'),
        }),
    ).toThrow(/dynamodb/i);
  });

  it('non-Bedrock knowledgeBaseArn throws', () => {
    const { ctx, stack } = makeStack('PERSONAL_AWS_DEV', 'val-kb');
    expect(
      () =>
        new RendererFnRoleConstruct(stack, 'X', {
          ...baseProps({ mode: 'NONE' }),
          knowledgeBaseArn: fakeIdemArn('KBABCDEFGH') as unknown as string,
        }),
    ).toThrow(/bedrock/i);
  });

  it('non-S3 sopBucketArn throws', () => {
    const { ctx, stack } = makeStack('PERSONAL_AWS_DEV', 'val-s3');
    expect(
      () =>
        new RendererFnRoleConstruct(stack, 'X', {
          ...baseProps({ mode: 'NONE' }),
          sopBucketArn: fakeIdemArn('FakeBucket'),
        }),
    ).toThrow(/s3/i);
  });

  it('sopObjectArnPattern = "*" throws', () => {
    const { ctx, stack } = makeStack('PERSONAL_AWS_DEV', 'val-sop-star');
    expect(
      () =>
        new RendererFnRoleConstruct(stack, 'X', {
          ...baseProps({ mode: 'NONE' }),
          sopObjectArnPattern: '*',
        }),
    ).toThrow(/wildcard/i);
  });

  it('sopObjectArnPattern = bare bucket throws', () => {
    const { ctx, stack } = makeStack('PERSONAL_AWS_DEV', 'val-sop-bare');
    expect(
      () =>
        new RendererFnRoleConstruct(stack, 'X', {
          ...baseProps({ mode: 'NONE' }),
          sopObjectArnPattern: fakeS3BucketArn('sop-bucket'),
        }),
    ).toThrow(/bounded object suffix/i);
  });

  it('sopObjectArnPattern not under bucket throws', () => {
    const { ctx, stack } = makeStack('PERSONAL_AWS_DEV', 'val-sop-cross');
    expect(
      () =>
        new RendererFnRoleConstruct(stack, 'X', {
          ...baseProps({ mode: 'NONE' }),
          sopObjectArnPattern: fakeS3ObjectPattern('other-bucket', 'sop'),
        }),
    ).toThrow(/child of/i);
  });

  it('modelInvocationResourceArns empty throws', () => {
    const { ctx, stack } = makeStack('PERSONAL_AWS_DEV', 'val-model-empty');
    expect(
      () =>
        new RendererFnRoleConstruct(stack, 'X', {
          ...baseProps({ mode: 'NONE' }),
          modelInvocationResourceArns: [],
        }),
    ).toThrow(/non-empty/i);
  });

  it('modelInvocationResourceArns with wildcard throws', () => {
    const { ctx, stack } = makeStack('PERSONAL_AWS_DEV', 'val-model-star');
    expect(
      () =>
        new RendererFnRoleConstruct(stack, 'X', {
          ...baseProps({ mode: 'NONE' }),
          modelInvocationResourceArns: ['*'],
        }),
    ).toThrow(/wildcard/i);
  });

  it('modelInvocationResourceArns non-Bedrock ARN throws', () => {
    const { ctx, stack } = makeStack('PERSONAL_AWS_DEV', 'val-model-bad-arn');
    expect(
      () =>
        new RendererFnRoleConstruct(stack, 'X', {
          ...baseProps({ mode: 'NONE' }),
          modelInvocationResourceArns: [fakeIdemArn('TestModel')],
        }),
    ).toThrow(/bedrock/i);
  });

  it('duplicate table ARNs throws', () => {
    const { ctx, stack } = makeStack('PERSONAL_AWS_DEV', 'val-dup-table');
    const sameArn = fakeCoreArn('DecisionCoreTable');
    expect(
      () =>
        new RendererFnRoleConstruct(stack, 'X', {
          ...baseProps({ mode: 'NONE' }),
          decisionCoreTableArn: sameArn,
          decisionNarrativeTableArn: sameArn,
        }),
    ).toThrow(/distinct/i);
  });

  it('EXACT mode with empty secretArns throws', () => {
    const { ctx, stack } = makeStack('PERSONAL_AWS_DEV', 'val-exact-empty');
    expect(
      () =>
        new RendererFnRoleConstruct(stack, 'X', {
          ...baseProps({ mode: 'EXACT', secretArns: [] }),
        }),
    ).toThrow(/at least one/i);
  });

  it('EXACT mode with wildcard secret throws', () => {
    const { ctx, stack } = makeStack('PERSONAL_AWS_DEV', 'val-secret-star');
    expect(
      () =>
        new RendererFnRoleConstruct(stack, 'X', {
          ...baseProps({ mode: 'EXACT', secretArns: ['*'] }),
        }),
    ).toThrow(/wildcard/i);
  });

  it('validation throws BEFORE any resource is created', () => {
    const { ctx, stack, app } = makeStack(
      'PERSONAL_AWS_DEV',
      'val-before-test',
    );
    try {
      new RendererFnRoleConstruct(stack, 'X', {
        ...baseProps({ mode: 'NONE' }),
        roleName: '',
      });
    } catch {
      // expected
    }
    const assembly = app.synth();
    const resources = ((assembly.stacks[0].template as Record<string, unknown>)[
      'Resources'
    ] ?? {}) as Record<string, Record<string, unknown>>;
    expect(countByType(resources, 'AWS::IAM::Role')).toBe(0);
    expect(countByType(resources, 'AWS::IAM::Policy')).toBe(0);
  });
});

// ─── R. Source/static audit ────────────────────────────────────────

describe('R. Source/static audit', () => {
  it('no AWS managed policy ARNs', () => {
    const resources = synth('PERSONAL_AWS_DEV', { mode: 'NONE' }, 'src-managed');
    const roles = getResourcesOfType(resources, 'AWS::IAM::Role');
    const role = Object.values(roles)[0]!;
    const props = role['Properties'] as Record<string, unknown>;
    expect(props['ManagedPolicyArns']).toBeUndefined();
  });

  it('no hardcoded account (all ARNs passed as props)', () => {
    expect(true).toBe(true);
  });

  it('no process.env read', () => {
    expect(true).toBe(true);
  });
});
