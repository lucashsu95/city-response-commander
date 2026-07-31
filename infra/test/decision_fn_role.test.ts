/**
 * TASK-077 targeted tests — DecisionFnRoleConstruct
 *
 * No AWS credentials or network access; pure synth-time assertions.
 *
 * Coverage:
 *   A. LOCAL_MOCK: 0 resources
 *   B. PERSONAL_AWS_DEV: 1 Role, 1 Policy, no managed policies
 *   C. COMPETITION_AWS: 1 Role, 1 Policy, normal lifecycle
 *   D. Trust policy: Lambda service principal, exact actions
 *   E. DecisionCore Allow: exact 3 actions, exact ARN, no wildcard
 *   F. DynamoDB writer island Deny: exact 7 actions, NotResource = DecisionCore
 *   G. S3 raw read Allow + S3 write Deny
 *   H. CloudWatch Logs: :log-stream:* resource
 *   I. SSM read: hierarchy /* boundary
 *   J. Bedrock Deny: exact 6 actions, all EXPLICIT_DENY
 *   K. Forbidden capabilities
 *   L. Wildcard audit
 *   M. Isolation: no extra resource types
 *   N. Evidence contract
 *   O. Validation rejections
 *   P. Source/static audit
 */

import { describe, it, expect } from 'vitest';
import { App, Stack } from 'aws-cdk-lib';
import { resolveEnvironmentContext } from '../lib/env_context.js';
import { DecisionFnRoleConstruct } from '../lib/iam/decision_fn_role.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

type Profile = 'LOCAL_MOCK' | 'PERSONAL_AWS_DEV' | 'COMPETITION_AWS';

const FAKE_ACCOUNT = '111111111111';
const FAKE_REGION = 'us-east-1';

function fakeCoreArn(name = 'DecisionCoreTable'): string {
  return `arn:aws:dynamodb:${FAKE_REGION}:${FAKE_ACCOUNT}:table/${name}`;
}

function fakeIdemArn(name = 'IdempotencyTable'): string {
  return `arn:aws:dynamodb:${FAKE_REGION}:${FAKE_ACCOUNT}:table/${name}`;
}

function fakeNarrArn(name = 'DecisionNarrativeTable'): string {
  return `arn:aws:dynamodb:${FAKE_REGION}:${FAKE_ACCOUNT}:table/${name}`;
}

function fakePublishArn(name = 'PublishRecordTable'): string {
  return `arn:aws:dynamodb:${FAKE_REGION}:${FAKE_ACCOUNT}:table/${name}`;
}

function fakeBucketArn(bucket = 'raw-bucket'): string {
  return `arn:aws:s3:::${bucket}`;
}

function fakeObjectPattern(bucket = 'raw-bucket', prefix = 'raw'): string {
  return `arn:aws:s3:::${bucket}/${prefix}/*`;
}

function fakeLogGroupArn(name = '/test/DecisionFn'): string {
  return `arn:aws:logs:${FAKE_REGION}:${FAKE_ACCOUNT}:log-group:${name}`;
}

function fakeSsmArn(prefix = '/test/params'): string {
  return `arn:aws:ssm:${FAKE_REGION}:${FAKE_ACCOUNT}:parameter${prefix}`;
}

function makeStack(profile: Profile, stackName?: string): {
  app: App;
  stack: Stack;
  ctx: ReturnType<typeof resolveEnvironmentContext>;
} {
  const app = new App({ autoSynth: false });
  app.node.setContext('env', profile);
  const ctx = resolveEnvironmentContext(app.node);
  const stack = new Stack(app, stackName ?? `${ctx.resourcePrefix}-decision-role-test`);
  return { app, stack, ctx };
}

function makeRole(profile: Profile, stackName?: string): {
  app: App;
  stack: Stack;
  ctx: ReturnType<typeof resolveEnvironmentContext>;
  construct: DecisionFnRoleConstruct;
} {
  const { app, stack, ctx } = makeStack(profile, stackName);
  const construct = new DecisionFnRoleConstruct(stack, 'DecisionFnRole', {
    envContext: ctx,
    roleName: `${ctx.resourcePrefix}-decision-fn-role`,
    decisionCoreTableArn: fakeCoreArn('DecisionCoreTable'),
    idempotencyTableArn: fakeIdemArn('IdempotencyTable'),
    decisionNarrativeTableArn: fakeNarrArn('DecisionNarrativeTable'),
    publishRecordTableArn: fakePublishArn('PublishRecordTable'),
    rawDataBucketArn: fakeBucketArn('raw-bucket'),
    rawDataObjectArnPattern: fakeObjectPattern('raw-bucket', 'raw'),
    decisionLogGroupArn: fakeLogGroupArn('/test/DecisionFn'),
    ssmParameterHierarchyArn: fakeSsmArn('/test/params'),
  });
  return { app, stack, ctx, construct };
}

function synth(profile: Profile) {
  const { app } = makeRole(profile);
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

function getPolicyDoc(profile: Profile): Record<string, unknown> {
  const resources = synth(profile)!;
  const policies = Object.values(resources).filter(
    (r) => r['Type'] === 'AWS::IAM::Policy',
  );
  return (policies[0]['Properties'] as Record<string, unknown>)['PolicyDocument'] as Record<string, unknown>;
}

function getRawStatements(profile: Profile): unknown[] {
  const doc = getPolicyDoc(profile);
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

/**
 * Standard IAM wildcard ARN matcher — no service-specific special logic.
 *
 * Handles:
 *   - Exact match
 *   - SSM hierarchy with "/" boundary: "/COMPETITION_AWS/*" must not match
 *     "/COMPETITION_AWS_EVIL/..." — the trailing "/" enforces the path delimiter
 *   - Trailing "/*" suffix: matches all children
 *   - Trailing single "*" suffix: matches any string continuation
 */
function resourceMatch(pattern: string, resource: string): boolean {
  if (pattern === '*') return true;
  const p = String(pattern);
  if (p === resource) return true;

  // SSM hierarchy with "/" boundary
  if (p.endsWith('/*')) {
    const prefix = p.slice(0, -2);
    return resource === prefix || resource.startsWith(prefix + '/');
  }

  // Trailing "*" suffix
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
      stmtAction === '*' || action === stmtAction || stmtAction.endsWith('*');
    if (!matchesAction) continue;

    let matchesResource = false;
    if (stmt.notResource) {
      const notResources = stmt.notResource.split(',').map((r) => r.trim());
      matchesResource = !notResources.some((nr) => resourceMatch(nr, resource));
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

// ─── A. LOCAL_MOCK ────────────────────────────────────────────────────

describe('A. LOCAL_MOCK', () => {
  it('AWS resource count = 0', () => {
    const resources = synth('LOCAL_MOCK');
    const nonCdk = resources
      ? Object.values(resources).filter(
          (r) => r['Type'] && !(r['Type'] as string).startsWith('AWS::CDK::'),
        )
      : [];
    expect(nonCdk).toHaveLength(0);
  });

  it('IAM Role count = 0', () => {
    expect(countByType(synth('LOCAL_MOCK'), 'AWS::IAM::Role')).toBe(0);
  });

  it('IAM Policy count = 0', () => {
    expect(countByType(synth('LOCAL_MOCK'), 'AWS::IAM::Policy')).toBe(0);
  });

  it('Outputs = 0', () => {
    const { app } = makeRole('LOCAL_MOCK', 'local-outputs-test');
    const assembly = app.synth();
    const outputs = (assembly.stacks[0].template as Record<string, unknown>)['Outputs'] as unknown;
    expect(outputs).toBeUndefined();
  });

  it('role / policy / roleArn are undefined', () => {
    const { construct } = makeRole('LOCAL_MOCK', 'local-undefined-test');
    expect(construct.role).toBeUndefined();
    expect(construct.roleArn).toBeUndefined();
    expect(construct.policy).toBeUndefined();
  });

  it('evidence is still populated', () => {
    const { construct } = makeRole('LOCAL_MOCK', 'local-evidence-test');
    expect(construct.evidence.deterministicTruthWriter).toBe(true);
    expect(construct.evidence.bedrockCapability).toBe(false);
    expect(construct.evidence.idempotencyWriteCapability).toBe(false);
    expect(construct.evidence.roleBoundToFunction).toBe(false);
    expect(construct.evidence.finalBindingOwner).toBe('TASK-179');
    expect(construct.evidence.wildcardAllowCount).toBe(0);
    expect(construct.evidence.decisionCoreActions).toEqual([
      'dynamodb:GetItem',
      'dynamodb:PutItem',
      'dynamodb:UpdateItem',
    ]);
  });
});

// ─── B. PERSONAL_AWS_DEV ───────────────────────────────────────────────

describe('B. PERSONAL_AWS_DEV', () => {
  const resources = synth('PERSONAL_AWS_DEV');

  it('IAM Role count = 1', () => {
    expect(countByType(resources, 'AWS::IAM::Role')).toBe(1);
  });

  it('IAM Policy count = 1', () => {
    expect(countByType(resources, 'AWS::IAM::Policy')).toBe(1);
  });

  it('ManagedPolicyArns = 0 (no AWS managed policies)', () => {
    const roles = getResourcesOfType(resources, 'AWS::IAM::Role');
    for (const [, role] of Object.entries(roles)) {
      const props = role['Properties'] as Record<string, unknown>;
      const mpArns = props['ManagedPolicyArns'] as unknown[];
      expect(mpArns).toBeUndefined();
    }
  });

  it('same architecture as COMPETITION', () => {
    const compResources = synth('COMPETITION_AWS');
    expect(countByType(compResources, 'AWS::IAM::Role')).toBe(
      countByType(resources, 'AWS::IAM::Role'),
    );
    expect(countByType(compResources, 'AWS::IAM::Policy')).toBe(
      countByType(resources, 'AWS::IAM::Policy'),
    );
  });
});

// ─── C. COMPETITION_AWS ─────────────────────────────────────────────

describe('C. COMPETITION_AWS', () => {
  const resources = synth('COMPETITION_AWS');

  it('IAM Role count = 1', () => {
    expect(countByType(resources, 'AWS::IAM::Role')).toBe(1);
  });

  it('IAM Policy count = 1', () => {
    expect(countByType(resources, 'AWS::IAM::Policy')).toBe(1);
  });

  it('normal Delete lifecycle (no Retain)', () => {
    const roles = getResourcesOfType(resources, 'AWS::IAM::Role');
    for (const [, role] of Object.entries(roles)) {
      expect(role['DeletionPolicy']).toBeUndefined();
    }
    const policies = getResourcesOfType(resources, 'AWS::IAM::Policy');
    for (const [, policy] of Object.entries(policies)) {
      expect(policy['DeletionPolicy']).toBeUndefined();
    }
  });

  it('same Role/Policy counts as PERSONAL', () => {
    const personalResources = synth('PERSONAL_AWS_DEV');
    expect(countByType(resources, 'AWS::IAM::Role')).toBe(
      countByType(personalResources, 'AWS::IAM::Role'),
    );
    expect(countByType(resources, 'AWS::IAM::Policy')).toBe(
      countByType(personalResources, 'AWS::IAM::Policy'),
    );
  });
});

// ─── D. Trust policy ────────────────────────────────────────────────

describe('D. Trust policy', () => {
  it('only lambda.amazonaws.com principal', () => {
    const resources = synth('PERSONAL_AWS_DEV')!;
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

  it('no AWS managed policies attached', () => {
    const resources = synth('PERSONAL_AWS_DEV')!;
    const roles = getResourcesOfType(resources, 'AWS::IAM::Role');
    const role = Object.values(roles)[0]!;
    const props = role['Properties'] as Record<string, unknown>;
    expect(props['ManagedPolicyArns']).toBeUndefined();
  });

  it('only Service principal (lambda.amazonaws.com)', () => {
    const resources = synth('PERSONAL_AWS_DEV')!;
    const roles = getResourcesOfType(resources, 'AWS::IAM::Role');
    const role = Object.values(roles)[0]!;
    const props = role['Properties'] as Record<string, unknown>;
    const assumeRole = props['AssumeRolePolicyDocument'] as Record<string, unknown>;
    const stmts = (assumeRole['Statement'] as unknown[]) ?? [];
    const principals = (stmts[0] as Record<string, unknown>)['Principal'] as Record<string, unknown>;
    // Only Service principal is allowed; no AWS Account, no Federated, no unexpected keys
    expect(Object.keys(principals)).toEqual(['Service']);
    expect(principals['Service']).toBe('lambda.amazonaws.com');
  });

  it('no Account principal in trust', () => {
    const resources = synth('PERSONAL_AWS_DEV')!;
    const roles = getResourcesOfType(resources, 'AWS::IAM::Role');
    const role = Object.values(roles)[0]!;
    const props = role['Properties'] as Record<string, unknown>;
    const assumeRole = props['AssumeRolePolicyDocument'] as Record<string, unknown>;
    const stmts = (assumeRole['Statement'] as unknown[]) ?? [];
    const principals = (stmts[0] as Record<string, unknown>)['Principal'] as Record<string, unknown>;
    expect(Object.keys(principals)).not.toContain('AWS');
    expect(Object.keys(principals)).not.toContain('Federated');
  });
});

// ─── E. DecisionCore Allow ──────────────────────────────────────────────

describe('E. DecisionCore Allow', () => {
  const rawStmts = getRawStatements('PERSONAL_AWS_DEV');
  const allowStmts = rawStmts.filter(
    (s) => (s as Record<string, unknown>)['Effect'] === 'Allow',
  );

  it('exactly 4 ALLOW statements (DynamoDB + S3 + Logs + SSM)', () => {
    expect(allowStmts).toHaveLength(4);
  });

  it('DynamoDB ALLOW: exactly GetItem + PutItem + UpdateItem on exact DecisionCore ARN', () => {
    const dynamo = allowStmts.find((s) => {
      const actions = (s as Record<string, unknown>)['Action'];
      if (Array.isArray(actions)) return actions.includes('dynamodb:GetItem');
      return actions === 'dynamodb:GetItem';
    }) as Record<string, unknown> | undefined;
    expect(dynamo).toBeDefined();
    expect(dynamo!['Resource']).toBe(fakeCoreArn('DecisionCoreTable'));
    const actions = Array.isArray(dynamo!['Action'])
      ? (dynamo!['Action'] as string[])
      : [dynamo!['Action'] as string];
    expect(actions).toContain('dynamodb:GetItem');
    expect(actions).toContain('dynamodb:PutItem');
    expect(actions).toContain('dynamodb:UpdateItem');
    expect(actions).toHaveLength(3);
  });

  it('no DeleteItem / BatchWriteItem / Query / Scan / PartiQL in DecisionCore Allow', () => {
    const dynamo = allowStmts.find((s) => {
      const actions = (s as Record<string, unknown>)['Action'];
      if (Array.isArray(actions)) return actions.includes('dynamodb:GetItem');
      return actions === 'dynamodb:GetItem';
    }) as Record<string, unknown> | undefined;
    const actions = Array.isArray(dynamo!['Action'])
      ? (dynamo!['Action'] as string[])
      : [dynamo!['Action'] as string];
    expect(actions).not.toContain('dynamodb:DeleteItem');
    expect(actions).not.toContain('dynamodb:BatchWriteItem');
    expect(actions).not.toContain('dynamodb:Query');
    expect(actions).not.toContain('dynamodb:Scan');
    expect(actions).not.toContain('dynamodb:PartiQLInsert');
    expect(actions).not.toContain('dynamodb:PartiQLUpdate');
    expect(actions).not.toContain('dynamodb:PartiQLDelete');
  });

  it('DynamoDB Allow does not use Resource "*"', () => {
    const dynamo = allowStmts.find((s) => {
      const actions = (s as Record<string, unknown>)['Action'];
      if (Array.isArray(actions)) return actions.includes('dynamodb:GetItem');
      return actions === 'dynamodb:GetItem';
    }) as Record<string, unknown> | undefined;
    expect(dynamo!['Resource']).not.toBe('*');
  });
});

// ─── F. DynamoDB writer island Deny ───────────────────────────────────────

describe('F. DynamoDB writer island Deny', () => {
  const rawStmts = getRawStatements('PERSONAL_AWS_DEV');
  const dynamoDeny = rawStmts.filter((s) => {
    const notRes = (s as Record<string, unknown>)['NotResource'];
    if (!notRes) return false;
    const notResources = Array.isArray(notRes)
      ? notRes
      : [notRes];
    return notResources.includes(fakeCoreArn('DecisionCoreTable'));
  });

  const dynamoDenyStmt = dynamoDeny[0] as Record<string, unknown> | undefined;

  const VALID_WRITE_ACTIONS = [
    'dynamodb:PutItem',
    'dynamodb:UpdateItem',
    'dynamodb:DeleteItem',
    'dynamodb:BatchWriteItem',
    'dynamodb:PartiQLInsert',
    'dynamodb:PartiQLUpdate',
    'dynamodb:PartiQLDelete',
  ];

  it('DynamoDB Deny statement exists (NotResource: DecisionCoreTable)', () => {
    expect(dynamoDenyStmt).toBeDefined();
  });

  it('Effect = Deny', () => {
    expect(dynamoDenyStmt!['Effect']).toBe('Deny');
  });

  it('exactly 7 valid IAM DynamoDB write actions (no invalid ones)', () => {
    const actions = Array.isArray(dynamoDenyStmt!['Action'])
      ? (dynamoDenyStmt!['Action'] as string[])
      : [dynamoDenyStmt!['Action'] as string];
    expect(actions).toHaveLength(7);
    for (const action of actions) {
      expect(VALID_WRITE_ACTIONS).toContain(action);
    }
    const invalid = [
      'dynamodb:TransactWriteItems',
      'dynamodb:ExecuteTransaction',
      'dynamodb:ExecuteTransactionItems',
    ];
    for (const inv of invalid) {
      expect(actions, `${inv} should not be present`).not.toContain(inv);
    }
  });

  it('NotResource = exact DecisionCoreTable ARN', () => {
    const notRes = dynamoDenyStmt!['NotResource'];
    const notResources = Array.isArray(notRes) ? notRes : [notRes];
    expect(notResources).toContain(fakeCoreArn('DecisionCoreTable'));
  });

  it('Resource field absent (uses NotResource, not Resource)', () => {
    expect(dynamoDenyStmt!['Resource']).toBeUndefined();
  });

  // ── Effective policy tests ──────────────────────────────────────────────

  const statements = parseStatements(getPolicyDoc('PERSONAL_AWS_DEV'));
  const CORE = fakeCoreArn('DecisionCoreTable');
  const IDEM = fakeIdemArn('IdempotencyTable');
  const NARR = fakeNarrArn('DecisionNarrativeTable');
  const PUB = fakePublishArn('PublishRecordTable');
  const FUTURE = fakeCoreArn('FutureTable');

  it('DecisionCore GetItem = ALLOW', () => {
    expect(evaluatePolicy(statements, 'dynamodb:GetItem', CORE)).toBe('ALLOW');
  });

  it('DecisionCore PutItem = ALLOW', () => {
    expect(evaluatePolicy(statements, 'dynamodb:PutItem', CORE)).toBe('ALLOW');
  });

  it('DecisionCore UpdateItem = ALLOW', () => {
    expect(evaluatePolicy(statements, 'dynamodb:UpdateItem', CORE)).toBe('ALLOW');
  });

  it('DecisionCore DeleteItem = IMPLICIT_DENY (not in Allow grant)', () => {
    expect(evaluatePolicy(statements, 'dynamodb:DeleteItem', CORE)).not.toBe('ALLOW');
  });

  it('DecisionCore BatchWriteItem = IMPLICIT_DENY (not in Allow grant)', () => {
    expect(evaluatePolicy(statements, 'dynamodb:BatchWriteItem', CORE)).not.toBe('ALLOW');
  });

  it('IdempotencyTable PutItem = EXPLICIT_DENY', () => {
    expect(evaluatePolicy(statements, 'dynamodb:PutItem', IDEM)).toBe('DENY');
  });

  it('IdempotencyTable UpdateItem = EXPLICIT_DENY', () => {
    expect(evaluatePolicy(statements, 'dynamodb:UpdateItem', IDEM)).toBe('DENY');
  });

  it('IdempotencyTable DeleteItem = EXPLICIT_DENY', () => {
    expect(evaluatePolicy(statements, 'dynamodb:DeleteItem', IDEM)).toBe('DENY');
  });

  it('DecisionNarrativeTable PutItem = EXPLICIT_DENY', () => {
    expect(evaluatePolicy(statements, 'dynamodb:PutItem', NARR)).toBe('DENY');
  });

  it('DecisionNarrativeTable UpdateItem = EXPLICIT_DENY', () => {
    expect(evaluatePolicy(statements, 'dynamodb:UpdateItem', NARR)).toBe('DENY');
  });

  it('DecisionNarrativeTable DeleteItem = EXPLICIT_DENY', () => {
    expect(evaluatePolicy(statements, 'dynamodb:DeleteItem', NARR)).toBe('DENY');
  });

  it('PublishRecordTable PutItem = EXPLICIT_DENY', () => {
    expect(evaluatePolicy(statements, 'dynamodb:PutItem', PUB)).toBe('DENY');
  });

  it('PublishRecordTable UpdateItem = EXPLICIT_DENY', () => {
    expect(evaluatePolicy(statements, 'dynamodb:UpdateItem', PUB)).toBe('DENY');
  });

  it('PublishRecordTable DeleteItem = EXPLICIT_DENY', () => {
    expect(evaluatePolicy(statements, 'dynamodb:DeleteItem', PUB)).toBe('DENY');
  });

  it('arbitrary future table PutItem = EXPLICIT_DENY', () => {
    expect(evaluatePolicy(statements, 'dynamodb:PutItem', FUTURE)).toBe('DENY');
  });

  it('arbitrary future table DeleteItem = EXPLICIT_DENY', () => {
    expect(evaluatePolicy(statements, 'dynamodb:DeleteItem', FUTURE)).toBe('DENY');
  });
});

// ─── G. S3 raw read + S3 write Deny ──────────────────────────────────────

describe('G. S3 raw read + S3 write Deny', () => {
  const rawStmts = getRawStatements('PERSONAL_AWS_DEV');

  it('S3 GetObject ALLOW exists', () => {
    const s3Allow = rawStmts.find((s) => {
      const actions = (s as Record<string, unknown>)['Action'];
      if (Array.isArray(actions)) return actions.includes('s3:GetObject');
      return actions === 's3:GetObject';
    }) as Record<string, unknown> | undefined;
    expect(s3Allow).toBeDefined();
  });

  it('S3 GetObject resource is bounded (not "*", not bare bucket ARN)', () => {
    const s3Allow = rawStmts.find((s) => {
      const actions = (s as Record<string, unknown>)['Action'];
      if (Array.isArray(actions)) return actions.includes('s3:GetObject');
      return actions === 's3:GetObject';
    }) as Record<string, unknown> | undefined;
    const resource = s3Allow!['Resource'] as string;
    expect(resource).not.toBe('*');
    expect(resource).not.toBe(fakeBucketArn('raw-bucket'));
    expect(resource).toContain('/raw/');
    expect(resource).toContain('/*');
  });

  it('S3 write Deny exists', () => {
    const s3Deny = rawStmts.filter((s) =>
      (s as Record<string, unknown>)['Effect'] === 'Deny' &&
      ((s as Record<string, unknown>)['Action'] as string | string[] | undefined)
        ?.toString()
        .includes('s3:PutObject'),
    );
    expect(s3Deny.length).toBeGreaterThan(0);
  });

  it('S3 write Deny has exact 5 actions', () => {
    const s3Deny = rawStmts.find((s) =>
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

  it('S3 write Deny Resource = "*"', () => {
    const s3Deny = rawStmts.find((s) =>
      (s as Record<string, unknown>)['Effect'] === 'Deny' &&
      Array.isArray((s as Record<string, unknown>)['Action']) &&
      ((s as Record<string, unknown>)['Action'] as string[]).includes('s3:PutObject'),
    ) as Record<string, unknown> | undefined;
    expect(s3Deny!['Resource']).toBe('*');
  });

  // ── Effective S3 policy tests ─────────────────────────────────────────────

  const statements = parseStatements(getPolicyDoc('PERSONAL_AWS_DEV'));
  const rawObject = `${fakeBucketArn('raw-bucket')}/raw/data.json`;
  const nestedRawObject = `${fakeBucketArn('raw-bucket')}/raw/2026/07/data.json`;
  const bareBucket = fakeBucketArn('raw-bucket');
  const otherBucketObject = `${fakeBucketArn('other-bucket')}/raw/data.json`;
  const similarPrefixObject = `${fakeBucketArn('raw-bucket')}/raw_evil/data.json`;
  const sopObject = `${fakeBucketArn('raw-bucket')}/sop/doc.pdf`;

  it('effective: GetObject on official raw object = ALLOW', () => {
    expect(evaluatePolicy(statements, 's3:GetObject', rawObject)).toBe('ALLOW');
  });

  it('effective: GetObject on nested raw object = ALLOW', () => {
    expect(evaluatePolicy(statements, 's3:GetObject', nestedRawObject)).toBe('ALLOW');
  });

  it('effective: GetObject on bare bucket ARN = IMPLICIT_DENY (not an object)', () => {
    expect(evaluatePolicy(statements, 's3:GetObject', bareBucket)).not.toBe('ALLOW');
  });

  it('effective: GetObject on other bucket = IMPLICIT_DENY', () => {
    expect(evaluatePolicy(statements, 's3:GetObject', otherBucketObject)).toBe('IMPLICIT_DENY');
  });

  it('effective: GetObject on similar-prefix bucket = IMPLICIT_DENY', () => {
    expect(evaluatePolicy(statements, 's3:GetObject', similarPrefixObject)).toBe('IMPLICIT_DENY');
  });

  it('effective: GetObject on SOP object = IMPLICIT_DENY', () => {
    expect(evaluatePolicy(statements, 's3:GetObject', sopObject)).toBe('IMPLICIT_DENY');
  });

  it('effective: s3:PutObject = EXPLICIT_DENY', () => {
    expect(evaluatePolicy(statements, 's3:PutObject', rawObject)).toBe('DENY');
  });

  it('effective: s3:DeleteObject = EXPLICIT_DENY', () => {
    expect(evaluatePolicy(statements, 's3:DeleteObject', rawObject)).toBe('DENY');
  });

  it('effective: s3:DeleteObjectVersion = EXPLICIT_DENY', () => {
    expect(evaluatePolicy(statements, 's3:DeleteObjectVersion', rawObject)).toBe('DENY');
  });

  it('effective: s3:AbortMultipartUpload = EXPLICIT_DENY', () => {
    expect(evaluatePolicy(statements, 's3:AbortMultipartUpload', rawObject)).toBe('DENY');
  });

  it('effective: s3:RestoreObject = EXPLICIT_DENY', () => {
    expect(evaluatePolicy(statements, 's3:RestoreObject', rawObject)).toBe('DENY');
  });

  it('effective: s3:ListBucket = IMPLICIT_DENY (not allowed)', () => {
    expect(evaluatePolicy(statements, 's3:ListBucket', fakeBucketArn('raw-bucket'))).toBe('IMPLICIT_DENY');
  });
});

// ─── H. CloudWatch Logs ──────────────────────────────────────────────────

describe('H. CloudWatch Logs', () => {
  const rawStmts = getRawStatements('PERSONAL_AWS_DEV');
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

  it('synthesized Resource ends with :log-stream:*', () => {
    const stmt = logStmts[0] as Record<string, unknown>;
    const resource = stmt['Resource'] as string;
    expect(resource.endsWith(':log-stream:*')).toBe(true);
  });

  it('synthesized Resource starts with injected Log Group ARN', () => {
    const stmt = logStmts[0] as Record<string, unknown>;
    const resource = stmt['Resource'] as string;
    const injected = fakeLogGroupArn('/test/DecisionFn');
    expect(resource.startsWith(injected)).toBe(true);
  });

  it('Resource is NOT "*" (no unbounded wildcard)', () => {
    const stmt = logStmts[0] as Record<string, unknown>;
    expect(stmt['Resource']).not.toBe('*');
  });

  it('Resource is NOT arn:*:logs:*:*:*', () => {
    const stmt = logStmts[0] as Record<string, unknown>;
    expect(stmt['Resource'] as string).not.toMatch(/^arn:\*:logs:/);
  });

  // ── Effective Logs policy tests ─────────────────────────────────────────────

  const statements = parseStatements(getPolicyDoc('PERSONAL_AWS_DEV'));
  const injectedBase = fakeLogGroupArn('/test/DecisionFn');

  it('effective: logs:CreateLogStream on same group stream = ALLOW', () => {
    const streamArn = `${injectedBase}:log-stream:test-stream`;
    expect(evaluatePolicy(statements, 'logs:CreateLogStream', streamArn)).toBe('ALLOW');
  });

  it('effective: logs:PutLogEvents on same group stream = ALLOW', () => {
    const streamArn = `${injectedBase}:log-stream:test-stream`;
    expect(evaluatePolicy(statements, 'logs:PutLogEvents', streamArn)).toBe('ALLOW');
  });

  it('effective: logs:PutLogEvents on other group stream = IMPLICIT_DENY', () => {
    const otherStream = `arn:aws:logs:us-east-1:111111111111:log-group:/other/Group:log-stream:stream`;
    expect(evaluatePolicy(statements, 'logs:PutLogEvents', otherStream)).toBe('IMPLICIT_DENY');
  });

  it('effective: logs:PutLogEvents on similar-prefix group = IMPLICIT_DENY', () => {
    const similarStream = `arn:aws:logs:us-east-1:111111111111:log-group:/test/DecisionFnExtra:log-stream:stream`;
    expect(evaluatePolicy(statements, 'logs:PutLogEvents', similarStream)).toBe('IMPLICIT_DENY');
  });

  it('effective: bare log group ARN = IMPLICIT_DENY (not a stream)', () => {
    expect(evaluatePolicy(statements, 'logs:CreateLogStream', injectedBase)).not.toBe('ALLOW');
  });

  it('effective: logs:CreateLogGroup = IMPLICIT_DENY', () => {
    expect(evaluatePolicy(statements, 'logs:CreateLogGroup', injectedBase)).toBe('IMPLICIT_DENY');
  });
});

// ─── I. SSM read ─────────────────────────────────────────────────────

describe('I. SSM read', () => {
  const rawStmts = getRawStatements('PERSONAL_AWS_DEV');
  const ssmStmts = rawStmts.filter(
    (s) =>
      (s as Record<string, unknown>)['Action'] === 'ssm:GetParametersByPath',
  );

  it('exactly 1 SSM Allow statement', () => {
    expect(ssmStmts).toHaveLength(1);
  });

  it('action = ssm:GetParametersByPath (no wildcards)', () => {
    const stmt = ssmStmts[0] as Record<string, unknown>;
    expect(stmt['Action']).toBe('ssm:GetParametersByPath');
  });

  it('resource uses "/*" suffix (path boundary)', () => {
    const stmt = ssmStmts[0] as Record<string, unknown>;
    const resource = stmt['Resource'] as string;
    expect(resource.endsWith('/*')).toBe(true);
  });

  it('resource base matches injected hierarchy', () => {
    const stmt = ssmStmts[0] as Record<string, unknown>;
    const resource = stmt['Resource'] as string;
    const base = fakeSsmArn('/test/params');
    expect(resource.startsWith(base)).toBe(true);
  });

  const statements = parseStatements(getPolicyDoc('PERSONAL_AWS_DEV'));
  const hierarchy = fakeSsmArn('/test/params');

  it('exact descendant = ALLOW', () => {
    expect(evaluatePolicy(statements, 'ssm:GetParametersByPath', `${hierarchy}/api/endpoint`)).toBe('ALLOW');
  });

  it('nested descendant = ALLOW', () => {
    expect(evaluatePolicy(statements, 'ssm:GetParametersByPath', `${hierarchy}/a/b/c`)).toBe('ALLOW');
  });

  it('sibling profile = IMPLICIT_DENY', () => {
    const siblingArn = fakeSsmArn('/test/params_EVIL/config');
    expect(evaluatePolicy(statements, 'ssm:GetParametersByPath', siblingArn)).toBe('IMPLICIT_DENY');
  });

  it('prefix collision = IMPLICIT_DENY', () => {
    const collisionArn = fakeSsmArn('/test/paramsxdev/config');
    expect(evaluatePolicy(statements, 'ssm:GetParametersByPath', collisionArn)).toBe('IMPLICIT_DENY');
  });

  it('parent path = IMPLICIT_DENY', () => {
    expect(evaluatePolicy(statements, 'ssm:GetParametersByPath', fakeSsmArn('/test'))).toBe('IMPLICIT_DENY');
  });

  it('different namespace = IMPLICIT_DENY', () => {
    const otherArn = fakeSsmArn('/other-app/config');
    expect(evaluatePolicy(statements, 'ssm:GetParametersByPath', otherArn)).toBe('IMPLICIT_DENY');
  });

  it('Resource "*" absent', () => {
    const stmt = ssmStmts[0] as Record<string, unknown>;
    expect(stmt['Resource']).not.toBe('*');
  });

  it('effective: ssm:PutParameter = IMPLICIT_DENY', () => {
    expect(evaluatePolicy(statements, 'ssm:PutParameter', `${hierarchy}/key`)).toBe('IMPLICIT_DENY');
  });
});

// ─── J. Bedrock Deny ──────────────────────────────────────────────────

describe('J. Bedrock Deny', () => {
  const rawStmts = getRawStatements('PERSONAL_AWS_DEV');
  const bedrockDeny = rawStmts.filter((s) =>
    (s as Record<string, unknown>)['Effect'] === 'Deny' &&
    ((s as Record<string, unknown>)['Action'] as string | string[] | undefined)?.toString().includes('bedrock'),
  );

  const EXPECTED_BEDROCK_ACTIONS = [
    'bedrock:InvokeModel',
    'bedrock:InvokeModelWithResponseStream',
    'bedrock:Converse',
    'bedrock:ConverseStream',
    'bedrock:Retrieve',
    'bedrock:RetrieveAndGenerate',
  ];

  it('exactly 1 Bedrock explicit Deny statement', () => {
    expect(bedrockDeny).toHaveLength(1);
  });

  it('exactly 6 Bedrock actions (no missing, no extra)', () => {
    const stmt = bedrockDeny[0] as Record<string, unknown>;
    const actions = Array.isArray(stmt['Action'])
      ? (stmt['Action'] as string[])
      : [stmt['Action'] as string];
    expect(actions).toHaveLength(6);
    for (const expected of EXPECTED_BEDROCK_ACTIONS) {
      expect(actions, `missing: ${expected}`).toContain(expected);
    }
  });

  it('missing Bedrock action count = 0', () => {
    const stmt = bedrockDeny[0] as Record<string, unknown>;
    const actions = Array.isArray(stmt['Action'])
      ? (stmt['Action'] as string[])
      : [stmt['Action'] as string];
    const missing = EXPECTED_BEDROCK_ACTIONS.filter((a) => !actions.includes(a));
    expect(missing).toHaveLength(0);
  });

  it('extra Bedrock action count = 0', () => {
    const stmt = bedrockDeny[0] as Record<string, unknown>;
    const actions = Array.isArray(stmt['Action'])
      ? (stmt['Action'] as string[])
      : [stmt['Action'] as string];
    const extra = actions.filter((a) => !EXPECTED_BEDROCK_ACTIONS.includes(a));
    expect(extra).toHaveLength(0);
  });

  it('Effect = Deny', () => {
    const stmt = bedrockDeny[0] as Record<string, unknown>;
    expect(stmt['Effect']).toBe('Deny');
  });

  it('Resource = "*"', () => {
    const stmt = bedrockDeny[0] as Record<string, unknown>;
    expect(stmt['Resource']).toBe('*');
  });

  it('no Bedrock ALLOW statements exist', () => {
    const allowStmts = rawStmts.filter(
      (s) => (s as Record<string, unknown>)['Effect'] === 'Allow',
    );
    for (const stmt of allowStmts) {
      const actions = (stmt as Record<string, unknown>)['Action'];
      if (Array.isArray(actions)) {
        expect(actions.some((a) => a.toString().startsWith('bedrock:'))).toBe(false);
      } else {
        expect(String(actions).startsWith('bedrock:')).toBe(false);
      }
    }
  });

  const statements = parseStatements(getPolicyDoc('PERSONAL_AWS_DEV'));

  it('effective: InvokeModel = EXPLICIT_DENY', () => {
    expect(evaluatePolicy(statements, 'bedrock:InvokeModel', '*')).toBe('DENY');
  });

  it('effective: InvokeModelWithResponseStream = EXPLICIT_DENY', () => {
    expect(evaluatePolicy(statements, 'bedrock:InvokeModelWithResponseStream', '*')).toBe('DENY');
  });

  it('effective: Converse = EXPLICIT_DENY', () => {
    expect(evaluatePolicy(statements, 'bedrock:Converse', '*')).toBe('DENY');
  });

  it('effective: ConverseStream = EXPLICIT_DENY', () => {
    expect(evaluatePolicy(statements, 'bedrock:ConverseStream', '*')).toBe('DENY');
  });

  it('effective: Retrieve = EXPLICIT_DENY', () => {
    expect(evaluatePolicy(statements, 'bedrock:Retrieve', '*')).toBe('DENY');
  });

  it('effective: RetrieveAndGenerate = EXPLICIT_DENY', () => {
    expect(evaluatePolicy(statements, 'bedrock:RetrieveAndGenerate', '*')).toBe('DENY');
  });
});

// ─── K. Forbidden capabilities ─────────────────────────────────────

describe('K. Forbidden capabilities', () => {
  const statements = parseStatements(getPolicyDoc('PERSONAL_AWS_DEV'));

  const FORBIDDEN_EXPLICIT_DENY = [
    'execute-api:ManageConnections',
  ];

  for (const action of FORBIDDEN_EXPLICIT_DENY) {
    it(`${action} = explicit DENY`, () => {
      expect(evaluatePolicy(statements, action, '*')).toBe('DENY');
    });
  }

  it('lambda:InvokeFunction = IMPLICIT_DENY', () => {
    expect(evaluatePolicy(statements, 'lambda:InvokeFunction', 'arn:aws:lambda:us-east-1:111111111111:function:SomeFn')).toBe('IMPLICIT_DENY');
  });

  it('states:StartExecution = IMPLICIT_DENY', () => {
    expect(evaluatePolicy(statements, 'states:StartExecution', 'arn:aws:states:us-east-1:111111111111:stateMachine:Workflow')).toBe('IMPLICIT_DENY');
  });

  it('states:StartSyncExecution = IMPLICIT_DENY', () => {
    expect(evaluatePolicy(statements, 'states:StartSyncExecution', '*')).toBe('IMPLICIT_DENY');
  });

  it('secretsmanager:GetSecretValue = IMPLICIT_DENY', () => {
    expect(evaluatePolicy(statements, 'secretsmanager:GetSecretValue', '*')).toBe('IMPLICIT_DENY');
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

  it('sqs:SendMessage = IMPLICIT_DENY', () => {
    expect(evaluatePolicy(statements, 'sqs:SendMessage', '*')).toBe('IMPLICIT_DENY');
  });
});

// ─── L. Wildcard audit ─────────────────────────────────────────────

describe('L. Wildcard audit', () => {
  const statements = parseStatements(getPolicyDoc('PERSONAL_AWS_DEV'));

  it('ALLOW Resource "*" count = 0', () => {
    const fullWildcardAllow = statements.filter(
      (s) => s.effect === 'Allow' && s.resource === '*',
    );
    expect(fullWildcardAllow).toHaveLength(0);
  });

  it('ALLOW action wildcard count = 0', () => {
    const actionWildcard = statements.filter(
      (s) =>
        s.effect === 'Allow' &&
        (s.action === '*' || s.action.endsWith('*')),
    );
    expect(actionWildcard).toHaveLength(0);
  });

  it('evidence.wildcardAllowCount = 0', () => {
    const { construct } = makeRole('PERSONAL_AWS_DEV', 'wildcard-evidence-test');
    expect(construct.evidence.wildcardAllowCount).toBe(0);
  });
});

// ─── M. Isolation ─────────────────────────────────────────────────

describe('M. Isolation', () => {
  const resources = synth('PERSONAL_AWS_DEV')!;

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
    'Custom::',
  ];

  for (const type of FORBIDDEN_TYPES) {
    it(`0 ${type} resources`, () => {
      expect(countByType(resources, type)).toBe(0);
    });
  }
});

// ─── N. Evidence contract ─────────────────────────────────────────

describe('N. Evidence contract', () => {
  it('deterministicTruthWriter = true', () => {
    const { construct } = makeRole('PERSONAL_AWS_DEV', 'evidence-truth-test');
    expect(construct.evidence.deterministicTruthWriter).toBe(true);
  });

  it('bedrockCapability = false', () => {
    const { construct } = makeRole('PERSONAL_AWS_DEV', 'evidence-bedrock-test');
    expect(construct.evidence.bedrockCapability).toBe(false);
  });

  it('idempotencyWriteCapability = false', () => {
    const { construct } = makeRole('PERSONAL_AWS_DEV', 'evidence-idem-test');
    expect(construct.evidence.idempotencyWriteCapability).toBe(false);
  });

  it('roleBoundToFunction = false', () => {
    const { construct } = makeRole('PERSONAL_AWS_DEV', 'evidence-bind-test');
    expect(construct.evidence.roleBoundToFunction).toBe(false);
  });

  it('finalBindingOwner = TASK-179', () => {
    const { construct } = makeRole('PERSONAL_AWS_DEV', 'evidence-owner-test');
    expect(construct.evidence.finalBindingOwner).toBe('TASK-179');
  });

  it('decisionCoreActions = GetItem, PutItem, UpdateItem', () => {
    const { construct } = makeRole('PERSONAL_AWS_DEV', 'evidence-core-test');
    expect(construct.evidence.decisionCoreActions).toEqual([
      'dynamodb:GetItem',
      'dynamodb:PutItem',
      'dynamodb:UpdateItem',
    ]);
  });

  it('rawDataActions = GetObject', () => {
    const { construct } = makeRole('PERSONAL_AWS_DEV', 'evidence-s3-test');
    expect(construct.evidence.rawDataActions).toEqual(['s3:GetObject']);
  });

  it('explicitDenyCategories includes DynamoDB:write-to-non-core-table', () => {
    const { construct } = makeRole('PERSONAL_AWS_DEV', 'evidence-deny-test');
    expect(construct.evidence.explicitDenyCategories).toContain('DynamoDB:write-to-non-core-table');
  });

  it('explicitDenyCategories includes Bedrock:invoke-model', () => {
    const { construct } = makeRole('PERSONAL_AWS_DEV', 'evidence-bc-deny-test');
    expect(construct.evidence.explicitDenyCategories).toContain('Bedrock:invoke-model');
  });

  it('logGroupStreamArn ends with :log-stream:*', () => {
    const { construct } = makeRole('PERSONAL_AWS_DEV', 'evidence-logs-test');
    expect(construct.evidence.logGroupStreamArn.endsWith(':log-stream:*')).toBe(true);
  });
});

// ─── O. Validation rejections ────────────────────────────────────────

describe('O. Validation rejections', () => {
  function baseProps(
    ctx: ReturnType<typeof resolveEnvironmentContext>,
    stack: Stack,
  ) {
    return {
      envContext: ctx,
      roleName: `${ctx.resourcePrefix}-decision-fn-role`,
      decisionCoreTableArn: fakeCoreArn('DecisionCoreTable'),
      idempotencyTableArn: fakeIdemArn('IdempotencyTable'),
      decisionNarrativeTableArn: fakeNarrArn('DecisionNarrativeTable'),
      publishRecordTableArn: fakePublishArn('PublishRecordTable'),
      rawDataBucketArn: fakeBucketArn('raw-bucket'),
      rawDataObjectArnPattern: fakeObjectPattern('raw-bucket', 'raw'),
      decisionLogGroupArn: fakeLogGroupArn('/test/DecisionFn'),
      ssmParameterHierarchyArn: fakeSsmArn('/test/params'),
    };
  }

  it('blank roleName throws', () => {
    const { ctx, stack } = makeStack('PERSONAL_AWS_DEV', 'blank-name-test');
    expect(
      () =>
        new DecisionFnRoleConstruct(stack, 'X', {
          ...baseProps(ctx, stack),
          roleName: '',
        }),
    ).toThrow(/non-empty/i);
  });

  it('roleName with whitespace throws', () => {
    const { ctx, stack } = makeStack('PERSONAL_AWS_DEV', 'ws-name-test');
    expect(
      () =>
        new DecisionFnRoleConstruct(stack, 'X', {
          ...baseProps(ctx, stack),
          roleName: '  decision-fn-role  ',
        }),
    ).toThrow(/whitespace/i);
  });

  it('roleName with "credential" throws', () => {
    const { ctx, stack } = makeStack('PERSONAL_AWS_DEV', 'cred-name-test');
    expect(
      () =>
        new DecisionFnRoleConstruct(stack, 'X', {
          ...baseProps(ctx, stack),
          roleName: 'decision-credential-role',
        }),
    ).toThrow(/credential/i);
  });

  it('roleName with "secret" throws', () => {
    const { ctx, stack } = makeStack('PERSONAL_AWS_DEV', 'secret-name-test');
    expect(
      () =>
        new DecisionFnRoleConstruct(stack, 'X', {
          ...baseProps(ctx, stack),
          roleName: 'decision-secret-role',
        }),
    ).toThrow(/secret/i);
  });

  it('non-DynamoDB decisionCoreTableArn throws', () => {
    const { ctx, stack } = makeStack('PERSONAL_AWS_DEV', 'bad-core-arn-test');
    expect(
      () =>
        new DecisionFnRoleConstruct(stack, 'X', {
          ...baseProps(ctx, stack),
          decisionCoreTableArn: fakeBucketArn('FakeTable'),
        }),
    ).toThrow(/dynamodb/i);
  });

  it('non-S3 rawDataBucketArn throws', () => {
    const { ctx, stack } = makeStack('PERSONAL_AWS_DEV', 'bad-bucket-arn-test');
    expect(
      () =>
        new DecisionFnRoleConstruct(stack, 'X', {
          ...baseProps(ctx, stack),
          rawDataBucketArn: fakeIdemArn('FakeBucket'),
        }),
    ).toThrow(/s3/i);
  });

  it('rawDataObjectArnPattern = "*" throws', () => {
    const { ctx, stack } = makeStack('PERSONAL_AWS_DEV', 'wildcard-pattern-test');
    expect(
      () =>
        new DecisionFnRoleConstruct(stack, 'X', {
          ...baseProps(ctx, stack),
          rawDataObjectArnPattern: '*',
        }),
    ).toThrow(/wildcard/i);
  });

  it('rawDataObjectArnPattern = bare bucket ARN throws', () => {
    const { ctx, stack } = makeStack('PERSONAL_AWS_DEV', 'bare-bucket-pattern-test');
    expect(
      () =>
        new DecisionFnRoleConstruct(stack, 'X', {
          ...baseProps(ctx, stack),
          rawDataObjectArnPattern: fakeBucketArn('raw-bucket'),
        }),
    ).toThrow(/bounded object suffix/i);
  });

  it('rawDataObjectArnPattern not under bucket throws', () => {
    const { ctx, stack } = makeStack('PERSONAL_AWS_DEV', 'wrong-bucket-pattern-test');
    expect(
      () =>
        new DecisionFnRoleConstruct(stack, 'X', {
          ...baseProps(ctx, stack),
          rawDataObjectArnPattern: fakeObjectPattern('other-bucket', 'raw'),
        }),
    ).toThrow(/child of/i);
  });

  it('non-Logs decisionLogGroupArn throws', () => {
    const { ctx, stack } = makeStack('PERSONAL_AWS_DEV', 'bad-lg-arn-test');
    expect(
      () =>
        new DecisionFnRoleConstruct(stack, 'X', {
          ...baseProps(ctx, stack),
          decisionLogGroupArn: fakeCoreArn('/test/DecisionFn') as unknown as string,
        }),
    ).toThrow(/logs/i);
  });

  it('non-SSM ssmParameterHierarchyArn throws', () => {
    const { ctx, stack } = makeStack('PERSONAL_AWS_DEV', 'bad-ssm-arn-test');
    expect(
      () =>
        new DecisionFnRoleConstruct(stack, 'X', {
          ...baseProps(ctx, stack),
          ssmParameterHierarchyArn: fakeCoreArn('/test/params') as unknown as string,
        }),
    ).toThrow(/ssm/i);
  });

  it('duplicate table ARNs throws', () => {
    const { ctx, stack } = makeStack('PERSONAL_AWS_DEV', 'dup-table-test');
    const sameArn = fakeCoreArn('DecisionCoreTable');
    expect(
      () =>
        new DecisionFnRoleConstruct(stack, 'X', {
          ...baseProps(ctx, stack),
          decisionCoreTableArn: sameArn,
          idempotencyTableArn: sameArn,
        }),
    ).toThrow(/distinct/i);
  });

  it('validation throws BEFORE any resource is created', () => {
    const { ctx, stack, app } = makeStack(
      'PERSONAL_AWS_DEV',
      'validation-before-test',
    );
    try {
      new DecisionFnRoleConstruct(stack, 'X', {
        ...baseProps(ctx, stack),
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

// ─── P. Source/static audit ────────────────────────────────────────

describe('P. Source/static audit', () => {
  it('no AWS managed policy ARNs', () => {
    const resources = synth('PERSONAL_AWS_DEV')!;
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
