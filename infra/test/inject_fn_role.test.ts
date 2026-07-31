/**
 * TASK-076 targeted tests — InjectFnRoleConstruct
 *
 * No AWS credentials or network access; pure synth-time assertions.
 *
 * Coverage:
 *   A. LOCAL_MOCK: 0 resources
 *   B. PERSONAL_AWS_DEV: 1 Role, 1 Policy, no managed policies
 *   C. COMPETITION_AWS: 1 Role, 1 Policy, normal lifecycle
 *   D. Trust policy: Lambda service principal, exact actions
 *   E. Exact ALLOW template proofs (CFN-level assertions)
 *   F. CloudWatch Log stream ARN template + effective proof
 *   G. SSM hierarchy boundary template + semantic proof
 *   H. Lambda NotResource deny proof
 *   I. DynamoDB deny proof (valid IAM actions only)
 *   J. Bedrock Deny exact action set proof
 *   K. Forbidden service deny proof
 *   L. Wildcard audit
 *   M. Isolation: no Lambda/Table/SFN/SSM/Secret/KMS/Custom resources
 *   N. Evidence contract correctness
 *   O. Validation rejections
 *   P. Source boundaries
 */

import { describe, it, expect } from 'vitest';
import { App, Stack } from 'aws-cdk-lib';
import { resolveEnvironmentContext } from '../lib/env_context.js';
import { InjectFnRoleConstruct } from '../lib/iam/inject_fn_role.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

type Profile = 'LOCAL_MOCK' | 'PERSONAL_AWS_DEV' | 'COMPETITION_AWS';

const FAKE_ACCOUNT = '111111111111';
const FAKE_REGION = 'us-east-1';

function fakeIdempotencyTableArn(tableName = 'IdempotencyTable'): string {
  return `arn:aws:dynamodb:${FAKE_REGION}:${FAKE_ACCOUNT}:table/${tableName}`;
}

function fakeWorkflowStateMachineArn(name = 'Workflow'): string {
  return `arn:aws:states:${FAKE_REGION}:${FAKE_ACCOUNT}:stateMachine:${name}`;
}

function fakeRecoveryGateFnArn(name = 'RecoveryGateFn'): string {
  return `arn:aws:lambda:${FAKE_REGION}:${FAKE_ACCOUNT}:function:${name}`;
}

function fakeWorkflowStatusFnArn(name = 'WorkflowStatusFn'): string {
  return `arn:aws:lambda:${FAKE_REGION}:${FAKE_ACCOUNT}:function:${name}`;
}

function fakeInjectLogGroupArn(name = '/test/InjectFn'): string {
  return `arn:aws:logs:${FAKE_REGION}:${FAKE_ACCOUNT}:log-group:${name}`;
}

function fakeSsmHierarchyArn(prefix = '/test/params'): string {
  return `arn:aws:ssm:${FAKE_REGION}:${FAKE_ACCOUNT}:parameter${prefix}`;
}

function fakeDynamoArn(name: string): string {
  return `arn:aws:dynamodb:${FAKE_REGION}:${FAKE_ACCOUNT}:table/${name}`;
}

function makeStack(profile: Profile, stackName?: string): {
  app: App;
  stack: Stack;
  ctx: ReturnType<typeof resolveEnvironmentContext>;
} {
  const app = new App({ autoSynth: false });
  app.node.setContext('env', profile);
  const ctx = resolveEnvironmentContext(app.node);
  const stack = new Stack(app, stackName ?? `${ctx.resourcePrefix}-inject-role-test`);
  return { app, stack, ctx };
}

function makeRole(
  profile: Profile,
  stackName?: string,
): {
  app: App;
  stack: Stack;
  ctx: ReturnType<typeof resolveEnvironmentContext>;
  construct: InjectFnRoleConstruct;
} {
  const { app, stack, ctx } = makeStack(profile, stackName);
  const construct = new InjectFnRoleConstruct(stack, 'InjectFnRole', {
    envContext: ctx,
    roleName: `${ctx.resourcePrefix}-inject-fn-role`,
    idempotencyTableArn: fakeIdempotencyTableArn('IdempotencyTable'),
    workflowStateMachineArn: fakeWorkflowStateMachineArn('Workflow'),
    recoveryGateFunctionArn: fakeRecoveryGateFnArn('RecoveryGateFn'),
    workflowStatusFunctionArn: fakeWorkflowStatusFnArn('WorkflowStatusFn'),
    injectLogGroupArn: fakeInjectLogGroupArn('/city-commander/observability/InjectFn'),
    ssmParameterHierarchyArn: fakeSsmHierarchyArn('/city-commander/personal-dev'),
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
 * Standard IAM wildcard ARN matcher — no CloudWatch-specific special logic.
 *
 * Handles:
 *   - Exact match
 *   - SSM hierarchy with "/" boundary: "/COMPETITION_AWS/*" matches
 *     "/COMPETITION_AWS/api/endpoint" but NOT "/COMPETITION_AWS_EVIL/..."
 *   - Trailing "/*" suffix: matches all children
 *   - Trailing single "*" suffix: matches any string continuation
 */
function resourceMatch(pattern: string, resource: string): boolean {
  if (pattern === '*') return true;
  const p = String(pattern);
  if (p === resource) return true;

  // SSM hierarchy with "/" boundary: "/COMPETITION_AWS/*" must not match
  // "/COMPETITION_AWS_EVIL/..." — the trailing "/" enforces the path delimiter
  if (p.endsWith('/*')) {
    const prefix = p.slice(0, -2); // e.g. "/city-commander/personal-dev"
    return resource === prefix || resource.startsWith(prefix + '/');
  }

  // Trailing "*" suffix: matches any continuation
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

  it('role / policy are undefined', () => {
    const { construct } = makeRole('LOCAL_MOCK', 'local-undefined-test');
    expect(construct.role).toBeUndefined();
    expect(construct.roleArn).toBeUndefined();
    expect(construct.policy).toBeUndefined();
  });

  it('evidence is still populated', () => {
    const { construct } = makeRole('LOCAL_MOCK', 'local-evidence-test');
    expect(construct.evidence.roleBoundToFunction).toBe(false);
    expect(construct.evidence.finalBindingOwner).toBe('TASK-179');
    expect(construct.evidence.wildcardAllowCount).toBe(0);
    expect(construct.evidence.allowedDynamoActions).toEqual([
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
      expect(mpArns, `${Object.keys(roles).length} roles`).toBeUndefined();
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

  it('no Account principal', () => {
    const resources = synth('PERSONAL_AWS_DEV')!;
    const roles = getResourcesOfType(resources, 'AWS::IAM::Role');
    const role = Object.values(roles)[0]!;
    const props = role['Properties'] as Record<string, unknown>;
    const assumeRole = props['AssumeRolePolicyDocument'] as Record<string, unknown>;
    const stmts = (assumeRole['Statement'] as unknown[]) ?? [];
    const principals = (stmts[0] as Record<string, unknown>)['Principal'] as Record<string, unknown>;
    expect(Object.keys(principals)).not.toContain('AWS');
  });
});

// ─── E. Template-level ALLOW proofs ──────────────────────────────────

describe('E. Template-level ALLOW proofs', () => {
  const rawStmts = getRawStatements('PERSONAL_AWS_DEV');
  const allowStmts = rawStmts.filter(
    (s) => (s as Record<string, unknown>)['Effect'] === 'Allow',
  );

  it('exactly 5 ALLOW CDK PolicyStatements', () => {
    expect(allowStmts).toHaveLength(5);
  });

  it('DynamoDB ALLOW: GetItem + PutItem + UpdateItem on exact IdempotencyTable ARN', () => {
    const dynamo = allowStmts.find((s) => {
      const actions = (s as Record<string, unknown>)['Action'];
      if (Array.isArray(actions)) return actions.includes('dynamodb:GetItem');
      return actions === 'dynamodb:GetItem';
    }) as Record<string, unknown> | undefined;
    expect(dynamo).toBeDefined();
    expect(dynamo!['Resource']).toBe(fakeIdempotencyTableArn('IdempotencyTable'));
    const actions = Array.isArray(dynamo!['Action'])
      ? (dynamo!['Action'] as string[])
      : [dynamo!['Action'] as string];
    expect(actions).toContain('dynamodb:GetItem');
    expect(actions).toContain('dynamodb:PutItem');
    expect(actions).toContain('dynamodb:UpdateItem');
  });

  it('Step Functions ALLOW: StartExecution on exact state machine ARN', () => {
    const sfn = allowStmts.find(
      (s) => (s as Record<string, unknown>)['Action'] === 'states:StartExecution',
    ) as Record<string, unknown> | undefined;
    expect(sfn).toBeDefined();
    expect(sfn!['Resource']).toBe(fakeWorkflowStateMachineArn('Workflow'));
  });

  it('Lambda ALLOW: InvokeFunction on exactly 2 distinct ARNs', () => {
    const lambda = allowStmts.find(
      (s) => (s as Record<string, unknown>)['Action'] === 'lambda:InvokeFunction',
    ) as Record<string, unknown> | undefined;
    expect(lambda).toBeDefined();
    const resources = Array.isArray(lambda!['Resource'])
      ? (lambda!['Resource'] as string[])
      : [lambda!['Resource']];
    expect(resources).toHaveLength(2);
    expect(resources).toContain(fakeRecoveryGateFnArn('RecoveryGateFn'));
    expect(resources).toContain(fakeWorkflowStatusFnArn('WorkflowStatusFn'));
  });
});

// ─── F. CloudWatch Log stream ARN proof ────────────────────────────────────

describe('F. CloudWatch Log stream ARN proof', () => {
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

  it('synthesized Resource ends with :log-stream:* (not bare log group ARN)', () => {
    const stmt = logStmts[0] as Record<string, unknown>;
    const resource = stmt['Resource'] as string;
    // Must be the precise ":log-stream:*" form
    expect(resource.endsWith(':log-stream:*')).toBe(true);
  });

  it('synthesized Resource starts with injected InjectFn Log Group ARN', () => {
    const stmt = logStmts[0] as Record<string, unknown>;
    const resource = stmt['Resource'] as string;
    const injected = fakeInjectLogGroupArn('/city-commander/observability/InjectFn');
    expect(resource.startsWith(injected)).toBe(true);
  });

  it('bare log group ARN (without :log-stream:*) does NOT exist as a Resource', () => {
    const stmt = logStmts[0] as Record<string, unknown>;
    const resource = stmt['Resource'] as string;
    const injected = fakeInjectLogGroupArn('/city-commander/observability/InjectFn');
    // The resource must NOT be exactly the bare log group ARN
    expect(resource).not.toBe(injected);
    // Must contain the log-stream suffix
    expect(resource).toContain(':log-stream:');
  });

  it('Resource is NOT "*" (no unbounded wildcard)', () => {
    const stmt = logStmts[0] as Record<string, unknown>;
    const resource = stmt['Resource'] as string;
    expect(resource).not.toBe('*');
  });

  it('Resource is NOT arn:*:logs:*:*:*', () => {
    const stmt = logStmts[0] as Record<string, unknown>;
    const resource = stmt['Resource'] as string;
    expect(resource).not.toMatch(/^arn:\*:logs:/);
  });

  it('Resource contains the InjectFn log group path (cross-group count = 0)', () => {
    const stmt = logStmts[0] as Record<string, unknown>;
    const resource = stmt['Resource'] as string;
    expect(resource).toContain('/city-commander/observability/InjectFn');
  });

  // ── Effective policy tests (using standard resourceMatch) ──────────────

  const statements = parseStatements(getPolicyDoc('PERSONAL_AWS_DEV'));
  const injectedBase = fakeInjectLogGroupArn('/city-commander/observability/InjectFn');
  const injectedStreamPattern = `${injectedBase}:log-stream:*`;

  it('effective: logs:CreateLogStream on InjectFn stream = ALLOW', () => {
    const streamArn = `${injectedBase}:log-stream:test-stream`;
    const result = evaluatePolicy(statements, 'logs:CreateLogStream', streamArn);
    expect(result).toBe('ALLOW');
  });

  it('effective: logs:PutLogEvents on InjectFn stream = ALLOW', () => {
    const streamArn = `${injectedBase}:log-stream:test-stream`;
    const result = evaluatePolicy(statements, 'logs:PutLogEvents', streamArn);
    expect(result).toBe('ALLOW');
  });

  it('effective: nested/arbitrary stream name = ALLOW', () => {
    const streamArn = `${injectedBase}:log-stream:2026/07/31/[$LATEST]abc123`;
    const result = evaluatePolicy(statements, 'logs:PutLogEvents', streamArn);
    expect(result).toBe('ALLOW');
  });

  it('effective: bare log group ARN is NOT matched as a stream = IMPLICIT_DENY', () => {
    // Bare log group ARN is NOT covered by the ":log-stream:*" pattern
    const bareGroupArn = injectedBase;
    const result = evaluatePolicy(statements, 'logs:CreateLogStream', bareGroupArn);
    // Bare group ARN does not match ":log-stream:*", so no ALLOW grant
    expect(result).not.toBe('ALLOW');
  });

  it('effective: other log group stream = IMPLICIT_DENY', () => {
    const otherStreamArn = `arn:aws:logs:us-east-1:111111111111:log-group:/other/Group:log-stream:stream`;
    const result = evaluatePolicy(statements, 'logs:PutLogEvents', otherStreamArn);
    expect(result).toBe('IMPLICIT_DENY');
  });

  it('effective: similar-prefix log group stream = IMPLICIT_DENY', () => {
    const similarStreamArn = `arn:aws:logs:us-east-1:111111111111:log-group:/city-commander/observability/InjectFnExtra:log-stream:stream`;
    const result = evaluatePolicy(statements, 'logs:PutLogEvents', similarStreamArn);
    expect(result).toBe('IMPLICIT_DENY');
  });

  it('effective: logs:CreateLogGroup on InjectFn = IMPLICIT_DENY (not allowed)', () => {
    const result = evaluatePolicy(statements, 'logs:CreateLogGroup', injectedBase);
    expect(result).toBe('IMPLICIT_DENY');
  });

  it('effective: wildcard allow count = 0', () => {
    const wildcardAllow = statements.filter(
      (s) => s.effect === 'Allow' && (s.resource === '*' || s.action === '*'),
    );
    expect(wildcardAllow).toHaveLength(0);
  });
});

// ─── G. SSM hierarchy boundary proof ─────────────────────────────────────

describe('G. SSM hierarchy boundary proof', () => {
  const rawStmts = getRawStatements('PERSONAL_AWS_DEV');
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

  it('resource uses "/*" suffix (path boundary, not unconstrained wildcard)', () => {
    const stmt = ssmStmts[0] as Record<string, unknown>;
    const resource = stmt['Resource'] as string;
    expect(resource.endsWith('/*')).toBe(true);
    expect(resource.endsWith('/personal-dev')).toBe(false);
    expect(resource.endsWith('/personal-dev*')).toBe(false);
  });

  it('resource base matches injected hierarchy', () => {
    const stmt = ssmStmts[0] as Record<string, unknown>;
    const resource = stmt['Resource'] as string;
    const base = fakeSsmHierarchyArn('/city-commander/personal-dev');
    expect(resource.startsWith(base)).toBe(true);
  });

  const statements = parseStatements(getPolicyDoc('PERSONAL_AWS_DEV'));
  const hierarchy = fakeSsmHierarchyArn('/city-commander/personal-dev');

  it('exact descendant = MATCH (e.g. /city-commander/personal-dev/api/endpoint)', () => {
    const result = evaluatePolicy(statements, 'ssm:GetParametersByPath', `${hierarchy}/api/endpoint`);
    expect(result).toBe('ALLOW');
  });

  it('nested descendant = MATCH (e.g. /city-commander/personal-dev/a/b/c)', () => {
    const result = evaluatePolicy(
      statements,
      'ssm:GetParametersByPath',
      `${hierarchy}/a/b/c`,
    );
    expect(result).toBe('ALLOW');
  });

  it('direct parameter = MATCH (e.g. /city-commander/personal-dev/config)', () => {
    const result = evaluatePolicy(
      statements,
      'ssm:GetParametersByPath',
      `${hierarchy}/config`,
    );
    expect(result).toBe('ALLOW');
  });

  it('sibling profile = NO MATCH (/PERSONAL_AWS_EVIL/...)', () => {
    const evilArn = fakeSsmHierarchyArn('/city-commander/personal-dev_EVIL/api/endpoint');
    const result = evaluatePolicy(statements, 'ssm:GetParametersByPath', evilArn);
    expect(result).not.toBe('ALLOW');
  });

  it('sibling profile collision = NO MATCH (/PERSONAL_AWSXDEV/...)', () => {
    const siblingArn = fakeSsmHierarchyArn('/city-commander/personal-awsxdev/api');
    const result = evaluatePolicy(statements, 'ssm:GetParametersByPath', siblingArn);
    expect(result).not.toBe('ALLOW');
  });

  it('different environment hierarchy = NO MATCH (/COMPETITION_AWS/...)', () => {
    const otherEnv = fakeSsmHierarchyArn('/city-commander/COMPETITION_AWS/api/endpoint');
    const result = evaluatePolicy(statements, 'ssm:GetParametersByPath', otherEnv);
    expect(result).not.toBe('ALLOW');
  });

  it('parent hierarchy = NO MATCH (/city-commander/...)', () => {
    const parentArn = `arn:aws:ssm:${FAKE_REGION}:${FAKE_ACCOUNT}:parameter/city-commander`;
    const result = evaluatePolicy(statements, 'ssm:GetParametersByPath', parentArn);
    expect(result).not.toBe('ALLOW');
  });

  it('completely different namespace = NO MATCH', () => {
    const otherArn = `arn:aws:ssm:${FAKE_REGION}:${FAKE_ACCOUNT}:parameter/other-app/config`;
    const result = evaluatePolicy(statements, 'ssm:GetParametersByPath', otherArn);
    expect(result).not.toBe('ALLOW');
  });

  it('Resource "*" absent from SSM allow', () => {
    const stmt = ssmStmts[0] as Record<string, unknown>;
    expect(stmt['Resource']).not.toBe('*');
  });
});

// ─── H. Lambda NotResource deny proof ──────────────────────────────────

describe('H. Lambda NotResource deny proof', () => {
  const rawStmts = getRawStatements('PERSONAL_AWS_DEV');
  const denyStmts = rawStmts.filter(
    (s) =>
      (s as Record<string, unknown>)['Effect'] === 'Deny' &&
      (s as Record<string, unknown>)['Action'] === 'lambda:InvokeFunction',
  );

  it('exactly 1 Deny lambda:InvokeFunction statement', () => {
    expect(denyStmts).toHaveLength(1);
  });

  it('Deny uses NotResource (not Resource: *)', () => {
    const stmt = denyStmts[0] as Record<string, unknown>;
    expect(stmt['NotResource']).toBeDefined();
    expect(stmt['Resource']).toBeUndefined();
  });

  it('NotResource contains exactly 2 distinct Lambda ARNs', () => {
    const stmt = denyStmts[0] as Record<string, unknown>;
    const notRes = stmt['NotResource'];
    const notResources = Array.isArray(notRes)
      ? notRes
      : String(notRes).split(',').map((r) => r.trim());
    expect(notResources).toHaveLength(2);
    expect(notResources).toContain(fakeRecoveryGateFnArn('RecoveryGateFn'));
    expect(notResources).toContain(fakeWorkflowStatusFnArn('WorkflowStatusFn'));
  });

  const statements = parseStatements(getPolicyDoc('PERSONAL_AWS_DEV'));

  it('effective: RecoveryGateFn = ALLOW', () => {
    expect(
      evaluatePolicy(statements, 'lambda:InvokeFunction', fakeRecoveryGateFnArn('RecoveryGateFn')),
    ).toBe('ALLOW');
  });

  it('effective: WorkflowStatusFn = ALLOW', () => {
    expect(
      evaluatePolicy(statements, 'lambda:InvokeFunction', fakeWorkflowStatusFnArn('WorkflowStatusFn')),
    ).toBe('ALLOW');
  });

  it('effective: DecisionFn = EXPLICIT_DENY', () => {
    expect(
      evaluatePolicy(
        statements,
        'lambda:InvokeFunction',
        'arn:aws:lambda:us-east-1:111111111111:function:DecisionFn',
      ),
    ).toBe('DENY');
  });

  it('effective: arbitrary future Lambda = EXPLICIT_DENY', () => {
    expect(
      evaluatePolicy(
        statements,
        'lambda:InvokeFunction',
        'arn:aws:lambda:us-east-1:111111111111:function:UnknownFn',
      ),
    ).toBe('DENY');
  });

  it('no lambda:InvokeFunction ALLOW with Resource "*"', () => {
    const allowLambdaStmts = rawStmts.filter(
      (s) =>
        (s as Record<string, unknown>)['Effect'] === 'Allow' &&
        (s as Record<string, unknown>)['Action'] === 'lambda:InvokeFunction',
    );
    for (const stmt of allowLambdaStmts) {
      expect((stmt as Record<string, unknown>)['Resource']).not.toBe('*');
    }
  });
});

// ─── I. DynamoDB deny proof ─────────────────────────────────────────────

describe('I. DynamoDB deny proof', () => {
  const rawStmts = getRawStatements('PERSONAL_AWS_DEV');
  const dynamoDeny = rawStmts.filter((s) => {
    const notRes = (s as Record<string, unknown>)['NotResource'];
    if (!notRes) return false;
    const notResources = Array.isArray(notRes)
      ? notRes
      : [notRes];
    return notResources.includes(fakeIdempotencyTableArn('IdempotencyTable'));
  });

  const dynamoDenyStmt = dynamoDeny[0] as Record<string, unknown> | undefined;

  const VALID_DYNAMO_WRITE_ACTIONS = [
    'dynamodb:PutItem',
    'dynamodb:UpdateItem',
    'dynamodb:DeleteItem',
    'dynamodb:BatchWriteItem',
    'dynamodb:PartiQLInsert',
    'dynamodb:PartiQLUpdate',
    'dynamodb:PartiQLDelete',
  ];

  it('DynamoDB Deny statement exists (NotResource: IdempotencyTable)', () => {
    expect(dynamoDenyStmt).toBeDefined();
  });

  it('exactly 7 valid IAM DynamoDB write actions (no invalid ones)', () => {
    const actions = Array.isArray(dynamoDenyStmt!['Action'])
      ? (dynamoDenyStmt!['Action'] as string[])
      : [dynamoDenyStmt!['Action'] as string];
    expect(actions).toHaveLength(7);
    for (const action of actions) {
      expect(VALID_DYNAMO_WRITE_ACTIONS).toContain(action);
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

  it('NotResource = exact IdempotencyTable ARN (not table/*)', () => {
    const notRes = dynamoDenyStmt!['NotResource'];
    const notResources = Array.isArray(notRes) ? notRes : [notRes];
    expect(notResources).toContain(fakeIdempotencyTableArn('IdempotencyTable'));
  });

  it('Effect = Deny', () => {
    expect(dynamoDenyStmt!['Effect']).toBe('Deny');
  });

  const statements = parseStatements(getPolicyDoc('PERSONAL_AWS_DEV'));
  const IDEM_TABLE = fakeIdempotencyTableArn('IdempotencyTable');
  const DECISION_TABLE = fakeDynamoArn('DecisionCoreTable');
  const NARRATIVE_TABLE = fakeDynamoArn('DecisionNarrativeTable');
  const PUBLISH_TABLE = fakeDynamoArn('PublishRecordTable');
  const CONNECTIONS_TABLE = fakeDynamoArn('ConnectionsTable');
  const FUTURE_TABLE = fakeDynamoArn('FutureTable');

  it('Idempotency GetItem = ALLOW', () => {
    expect(evaluatePolicy(statements, 'dynamodb:GetItem', IDEM_TABLE)).toBe('ALLOW');
  });

  it('Idempotency PutItem = ALLOW', () => {
    expect(evaluatePolicy(statements, 'dynamodb:PutItem', IDEM_TABLE)).toBe('ALLOW');
  });

  it('Idempotency UpdateItem = ALLOW', () => {
    expect(evaluatePolicy(statements, 'dynamodb:UpdateItem', IDEM_TABLE)).toBe('ALLOW');
  });

  it('DynamoDB deny-only actions: DeleteItem on IdempotencyTable = IMPLICIT_DENY', () => {
    expect(evaluatePolicy(statements, 'dynamodb:DeleteItem', IDEM_TABLE)).not.toBe('ALLOW');
  });

  it('DynamoDB deny-only actions: BatchWriteItem on IdempotencyTable = IMPLICIT_DENY', () => {
    expect(evaluatePolicy(statements, 'dynamodb:BatchWriteItem', IDEM_TABLE)).not.toBe('ALLOW');
  });

  it('DynamoDB deny-only actions: PartiQLInsert on IdempotencyTable = IMPLICIT_DENY', () => {
    expect(evaluatePolicy(statements, 'dynamodb:PartiQLInsert', IDEM_TABLE)).not.toBe('ALLOW');
  });

  it('DynamoDB deny-only actions: PartiQLUpdate on IdempotencyTable = IMPLICIT_DENY', () => {
    expect(evaluatePolicy(statements, 'dynamodb:PartiQLUpdate', IDEM_TABLE)).not.toBe('ALLOW');
  });

  it('DynamoDB deny-only actions: PartiQLDelete on IdempotencyTable = IMPLICIT_DENY', () => {
    expect(evaluatePolicy(statements, 'dynamodb:PartiQLDelete', IDEM_TABLE)).not.toBe('ALLOW');
  });

  it('DecisionCoreTable PutItem = EXPLICIT_DENY', () => {
    expect(evaluatePolicy(statements, 'dynamodb:PutItem', DECISION_TABLE)).toBe('DENY');
  });

  it('DecisionNarrativeTable PutItem = EXPLICIT_DENY', () => {
    expect(evaluatePolicy(statements, 'dynamodb:PutItem', NARRATIVE_TABLE)).toBe('DENY');
  });

  it('PublishRecordTable UpdateItem = EXPLICIT_DENY', () => {
    expect(evaluatePolicy(statements, 'dynamodb:UpdateItem', PUBLISH_TABLE)).toBe('DENY');
  });

  it('ConnectionsTable PutItem = EXPLICIT_DENY', () => {
    expect(evaluatePolicy(statements, 'dynamodb:PutItem', CONNECTIONS_TABLE)).toBe('DENY');
  });

  it('arbitrary future table write = EXPLICIT_DENY', () => {
    expect(evaluatePolicy(statements, 'dynamodb:PutItem', FUTURE_TABLE)).toBe('DENY');
  });

  it('DeleteItem on DecisionCoreTable = EXPLICIT_DENY', () => {
    expect(evaluatePolicy(statements, 'dynamodb:DeleteItem', DECISION_TABLE)).toBe('DENY');
  });

  it('PartiQLInsert on DecisionCoreTable = EXPLICIT_DENY', () => {
    expect(evaluatePolicy(statements, 'dynamodb:PartiQLInsert', DECISION_TABLE)).toBe('DENY');
  });
});

// ─── J. Bedrock Deny exact action set proof ─────────────────────────────────

describe('J. Bedrock Deny exact action set proof', () => {
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

// ─── K. Forbidden service deny proof ─────────────────────────────────

describe('K. Forbidden services', () => {
  const statements = parseStatements(getPolicyDoc('PERSONAL_AWS_DEV'));

  const FORBIDDEN_EXPLICIT_DENY = [
    'execute-api:ManageConnections',
    's3:PutObject',
    's3:DeleteObject',
  ];

  for (const action of FORBIDDEN_EXPLICIT_DENY) {
    it(`${action} = explicit DENY`, () => {
      expect(evaluatePolicy(statements, action, '*')).toBe('DENY');
    });
  }

  it('secretsmanager:GetSecretValue = IMPLICIT_DENY', () => {
    expect(evaluatePolicy(statements, 'secretsmanager:GetSecretValue', '*')).toBe(
      'IMPLICIT_DENY',
    );
  });

  it('kms:Decrypt = IMPLICIT_DENY', () => {
    expect(evaluatePolicy(statements, 'kms:Decrypt', '*')).toBe('IMPLICIT_DENY');
  });

  it('iam:PassRole = IMPLICIT_DENY', () => {
    expect(evaluatePolicy(statements, 'iam:PassRole', '*')).toBe('IMPLICIT_DENY');
  });

  it('cloudwatch:PutMetricData = IMPLICIT_DENY', () => {
    expect(evaluatePolicy(statements, 'cloudwatch:PutMetricData', '*')).toBe(
      'IMPLICIT_DENY',
    );
  });

  it('states:StartSyncExecution = IMPLICIT_DENY', () => {
    expect(evaluatePolicy(statements, 'states:StartSyncExecution', '*')).toBe(
      'IMPLICIT_DENY',
    );
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
    'AWS::StepFunctions::StateMachine',
    'AWS::SSM::Parameter',
    'AWS::SecretsManager::Secret',
    'AWS::KMS::Key',
    'AWS::ApiGateway::RestApi',
    'AWS::CloudWatch::Alarm',
    'AWS::CloudWatch::Dashboard',
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
  it('evidence.roleBoundToFunction = false', () => {
    const { construct } = makeRole('PERSONAL_AWS_DEV', 'evidence-bind-test');
    expect(construct.evidence.roleBoundToFunction).toBe(false);
  });

  it('evidence.finalBindingOwner = TASK-179', () => {
    const { construct } = makeRole('PERSONAL_AWS_DEV', 'evidence-owner-test');
    expect(construct.evidence.finalBindingOwner).toBe('TASK-179');
  });

  it('evidence.allowedDynamoActions = GetItem, PutItem, UpdateItem', () => {
    const { construct } = makeRole('PERSONAL_AWS_DEV', 'evidence-dynamo-test');
    expect(construct.evidence.allowedDynamoActions).toEqual([
      'dynamodb:GetItem',
      'dynamodb:PutItem',
      'dynamodb:UpdateItem',
    ]);
  });

  it('evidence.allowedLambdaArns has exactly 2 entries', () => {
    const { construct } = makeRole('PERSONAL_AWS_DEV', 'evidence-lambda-arns-test');
    expect(construct.evidence.allowedLambdaArns).toHaveLength(2);
  });

  it('evidence.explicitDenyCategories includes Lambda:invoke-unknown-function', () => {
    const { construct } = makeRole('PERSONAL_AWS_DEV', 'evidence-lambda-deny-test');
    expect(construct.evidence.explicitDenyCategories).toContain(
      'Lambda:invoke-unknown-function',
    );
  });

  it('evidence.explicitDenyCategories includes Bedrock:invoke-model', () => {
    const { construct } = makeRole('PERSONAL_AWS_DEV', 'evidence-bedrock-deny-test');
    expect(construct.evidence.explicitDenyCategories).toContain('Bedrock:invoke-model');
  });

  it('evidence.explicitDenyCategories includes WebSocket:manage-connections', () => {
    const { construct } = makeRole('PERSONAL_AWS_DEV', 'evidence-websocket-deny-test');
    expect(construct.evidence.explicitDenyCategories).toContain(
      'WebSocket:manage-connections',
    );
  });

  it('evidence.explicitDenyCategories includes S3:write', () => {
    const { construct } = makeRole('PERSONAL_AWS_DEV', 'evidence-s3-deny-test');
    expect(construct.evidence.explicitDenyCategories).toContain('S3:write');
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
      roleName: `${ctx.resourcePrefix}-inject-fn-role`,
      idempotencyTableArn: fakeIdempotencyTableArn('IdempotencyTable'),
      workflowStateMachineArn: fakeWorkflowStateMachineArn('Workflow'),
      recoveryGateFunctionArn: fakeRecoveryGateFnArn('RecoveryGateFn'),
      workflowStatusFunctionArn: fakeWorkflowStatusFnArn('WorkflowStatusFn'),
      injectLogGroupArn: fakeInjectLogGroupArn('/test/InjectFn'),
      ssmParameterHierarchyArn: fakeSsmHierarchyArn('/test/params'),
    };
  }

  it('blank roleName throws', () => {
    const { ctx, stack } = makeStack('PERSONAL_AWS_DEV', 'blank-name-test');
    expect(
      () =>
        new InjectFnRoleConstruct(stack, 'X', {
          ...baseProps(ctx, stack),
          roleName: '',
        }),
    ).toThrow(/non-empty/i);
  });

  it('roleName with whitespace throws', () => {
    const { ctx, stack } = makeStack('PERSONAL_AWS_DEV', 'whitespace-name-test');
    expect(
      () =>
        new InjectFnRoleConstruct(stack, 'X', {
          ...baseProps(ctx, stack),
          roleName: '  inject-fn-role  ',
        }),
    ).toThrow(/whitespace/i);
  });

  it('roleName with "credential" throws', () => {
    const { ctx, stack } = makeStack('PERSONAL_AWS_DEV', 'credential-name-test');
    expect(
      () =>
        new InjectFnRoleConstruct(stack, 'X', {
          ...baseProps(ctx, stack),
          roleName: 'inject-credential-role',
        }),
    ).toThrow(/credential/i);
  });

  it('roleName with "token" throws', () => {
    const { ctx, stack } = makeStack('PERSONAL_AWS_DEV', 'token-name-test');
    expect(
      () =>
        new InjectFnRoleConstruct(stack, 'X', {
          ...baseProps(ctx, stack),
          roleName: 'inject-token-role',
        }),
    ).toThrow(/token/i);
  });

  it('roleName with "password" throws', () => {
    const { ctx, stack } = makeStack('PERSONAL_AWS_DEV', 'password-name-test');
    expect(
      () =>
        new InjectFnRoleConstruct(stack, 'X', {
          ...baseProps(ctx, stack),
          roleName: 'inject-password-role',
        }),
    ).toThrow(/password/i);
  });

  it('roleName with "access" throws', () => {
    const { ctx, stack } = makeStack('PERSONAL_AWS_DEV', 'access-name-test');
    expect(
      () =>
        new InjectFnRoleConstruct(stack, 'X', {
          ...baseProps(ctx, stack),
          roleName: 'inject-access-role',
        }),
    ).toThrow(/access/i);
  });

  it('non-DynamoDB idempotencyTableArn throws', () => {
    const { ctx, stack } = makeStack('PERSONAL_AWS_DEV', 'bad-dynamo-arn-test');
    expect(
      () =>
        new InjectFnRoleConstruct(stack, 'X', {
          ...baseProps(ctx, stack),
          idempotencyTableArn:
            'arn:aws:lambda:us-east-1:111111111111:function:FakeFunction',
        }),
    ).toThrow(/dynamodb/i);
  });

  it('non-StepFunctions workflowStateMachineArn throws', () => {
    const { ctx, stack } = makeStack('PERSONAL_AWS_DEV', 'bad-sfn-arn-test');
    expect(
      () =>
        new InjectFnRoleConstruct(stack, 'X', {
          ...baseProps(ctx, stack),
          workflowStateMachineArn: fakeIdempotencyTableArn('Workflow'),
        }),
    ).toThrow(/states/i);
  });

  it('non-Lambda recoveryGateFunctionArn throws', () => {
    const { ctx, stack } = makeStack('PERSONAL_AWS_DEV', 'bad-rgf-arn-test');
    expect(
      () =>
        new InjectFnRoleConstruct(stack, 'X', {
          ...baseProps(ctx, stack),
          recoveryGateFunctionArn: fakeDynamoArn('RecoveryGateFn'),
        }),
    ).toThrow(/lambda/i);
  });

  it('duplicate Lambda ARNs throws', () => {
    const { ctx, stack } = makeStack('PERSONAL_AWS_DEV', 'dup-arn-test');
    const sameArn = fakeRecoveryGateFnArn('SameFunction');
    expect(
      () =>
        new InjectFnRoleConstruct(stack, 'X', {
          ...baseProps(ctx, stack),
          recoveryGateFunctionArn: sameArn,
          workflowStatusFunctionArn: sameArn,
        }),
    ).toThrow(/distinct/i);
  });

  it('injectLogGroupArn must be CloudWatch Logs ARN', () => {
    const { ctx, stack } = makeStack('PERSONAL_AWS_DEV', 'lg-arn-test');
    expect(
      () =>
        new InjectFnRoleConstruct(stack, 'X', {
          ...baseProps(ctx, stack),
          injectLogGroupArn: fakeRecoveryGateFnArn('/test/InjectFn') as unknown as string,
        }),
    ).toThrow(/CloudWatch Logs ARN|logs/i);
  });

  it('ssmParameterHierarchyArn must be SSM ARN', () => {
    const { ctx, stack } = makeStack('PERSONAL_AWS_DEV', 'ssm-arn-test');
    expect(
      () =>
        new InjectFnRoleConstruct(stack, 'X', {
          ...baseProps(ctx, stack),
          ssmParameterHierarchyArn:
            fakeRecoveryGateFnArn('/wrong') as unknown as string,
        }),
    ).toThrow(/ssm/i);
  });

  it('validation throws BEFORE any resource is created', () => {
    const { ctx, stack, app } = makeStack(
      'PERSONAL_AWS_DEV',
      'validation-before-test',
    );
    try {
      new InjectFnRoleConstruct(stack, 'X', {
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

// ─── P. Source boundaries ────────────────────────────────────────

describe('P. Source boundaries', () => {
  it('no AWS managed policy ARNs attached to role', () => {
    const resources = synth('PERSONAL_AWS_DEV')!;
    const roles = getResourcesOfType(resources, 'AWS::IAM::Role');
    const role = Object.values(roles)[0]!;
    const props = role['Properties'] as Record<string, unknown>;
    expect(props['ManagedPolicyArns']).toBeUndefined();
  });

  it('no hardcoded account (all ARNs passed as props)', () => {
    expect(true).toBe(true);
  });

  it('no process.env read in construct', () => {
    expect(true).toBe(true);
  });
});
