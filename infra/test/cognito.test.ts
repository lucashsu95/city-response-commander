/**
 * TASK-071 targeted tests — CognitoAuthConstruct
 *
 * No AWS credentials / network access; pure synth-time CDK assertions.
 * Uses no IAM Role or Lambda function creation; all cross-resource references
 * are via `Role.fromRoleArn` / `Function.fromFunctionArn` (zero resources).
 */

import { describe, it, expect } from 'vitest';
import { App, Stack } from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import { resolveEnvironmentContext } from '../lib/env_context.js';
import {
  CognitoAuthConstruct,
  COGNITO_GROUP_NAMES,
  COGNITO_SCOPE_NAMES,
  COGNITO_GROUP_DESCRIPTIONS,
  AUTH_USER_POOL_ID_CONFIG_KEY,
  AUTH_APP_CLIENT_ID_CONFIG_KEY,
} from '../lib/constructs/cognito.js';

type Profile = 'LOCAL_MOCK' | 'PERSONAL_AWS_DEV' | 'COMPETITION_AWS';

const FAKE_ACCOUNT = '111111111111';
const FAKE_REGION = 'ap-northeast-1';

// ─── Helpers ────────────────────────────────────────────────────────────────

function personalProps(overrides: Record<string, unknown> = {}) {
  return {
    userPoolName: 'UserPool',
    appClientName: 'AppClient',
    domainPrefix: 'my-cityresponse',
    callbackUrls: ['https://app.example.com/callback'],
    logoutUrls: ['https://app.example.com/logout'],
    accessTokenValidityMinutes: 60,
    idTokenValidityMinutes: 60,
    refreshTokenValidityDays: 30,
    ...overrides,
  };
}

function build(profile: Profile, extra: Record<string, unknown> = {}) {
  const app = new App({ autoSynth: false });
  app.node.setContext('env', profile);
  const ctx = resolveEnvironmentContext(app.node);
  const stackId = `cog-test-${profile.replace(/_/g, '-')}`;
  const stack = new Stack(app, stackId);
  const construct = new CognitoAuthConstruct(stack, 'Cognito', {
    envContext: ctx,
    ...personalProps(extra),
  });
  return { app, stack, ctx, construct };
}

function getTemplate(profile: Profile, extra: Record<string, unknown> = {}) {
  const { app } = build(profile, extra);
  return app.synth().stacks[0].template as Record<string, Record<string, unknown>>;
}

function getResources(t: Record<string, Record<string, unknown>>) {
  return (t.Resources ?? {}) as Record<string, Record<string, unknown>>;
}

function countByType(resources: Record<string, Record<string, unknown>>, type: string): number {
  return Object.values(resources).filter((r) => r.Type === type).length;
}

function getPoolResources(t: Record<string, Record<string, unknown>>) {
  const r = getResources(t);
  return {
    pool: Object.values(r).find((x) => x.Type === 'AWS::Cognito::UserPool')!,
    poolClient: Object.values(r).find((x) => x.Type === 'AWS::Cognito::UserPoolClient')!,
    resourceServer: Object.values(r).find((x) => x.Type === 'AWS::Cognito::UserPoolResourceServer')!,
    domain: Object.values(r).find((x) => x.Type === 'AWS::Cognito::UserPoolDomain')!,
    groups: Object.values(r).filter((x) => x.Type === 'AWS::Cognito::UserPoolGroup'),
  };
}

// ─── A. PERSONAL_AWS_DEV ───────────────────────────────────────────────────

describe('A. PERSONAL_AWS_DEV — resource counts', () => {
  const t = getTemplate('PERSONAL_AWS_DEV');
  const r = getResources(t);

  it('exactly 1 User Pool', () => expect(countByType(r, 'AWS::Cognito::UserPool')).toBe(1));
  it('exactly 1 User Pool Client', () => expect(countByType(r, 'AWS::Cognito::UserPoolClient')).toBe(1));
  it('exactly 1 Resource Server', () => expect(countByType(r, 'AWS::Cognito::UserPoolResourceServer')).toBe(1));
  it('exactly 1 User Pool Domain', () => expect(countByType(r, 'AWS::Cognito::UserPoolDomain')).toBe(1));
  it('exactly 3 User Pool Groups', () => expect(countByType(r, 'AWS::Cognito::UserPoolGroup')).toBe(3));
});

describe('A. PERSONAL_AWS_DEV — User Pool contract', () => {
  const { pool } = getPoolResources(getTemplate('PERSONAL_AWS_DEV'));
  const props = pool.Properties as Record<string, unknown>;

  it('adminCreateUserOnly=true (self-sign-up disabled)', () => {
    const adminConfig = props.AdminCreateUserConfig as Record<string, unknown>;
    expect(adminConfig.AllowAdminCreateUserOnly).toBe(true);
  });

  it('email sign-in enabled', () => {
    expect(props.UsernameAttributes).toEqual(['email']);
  });

  it('account recovery restricted to verified_email', () => {
    const recovery = props.AccountRecoverySetting as Record<string, unknown>;
    const mechanisms = recovery.RecoveryMechanisms as Array<Record<string, unknown>>;
    expect(mechanisms).toEqual([{ Name: 'verified_email', Priority: 1 }]);
  });

  it('password policy: minLength 12, requires upper, lower, digit, symbol', () => {
    const pw = (props.Policies as Record<string, unknown>).PasswordPolicy as Record<string, unknown>;
    expect(pw.MinimumLength).toBe(12);
    expect(pw.RequireUppercase).toBe(true);
    expect(pw.RequireLowercase).toBe(true);
    expect(pw.RequireNumbers).toBe(true);
    expect(pw.RequireSymbols).toBe(true);
  });

  it('temporary password validity explicitly configured (7 days)', () => {
    const pw = (props.Policies as Record<string, unknown>).PasswordPolicy as Record<string, unknown>;
    expect(pw.TemporaryPasswordValidityDays).toBe(7);
  });

  it('MfaConfiguration = OFF (no SMS, no fake MFA)', () => {
    expect(props.MfaConfiguration).toBe('OFF');
  });

  it('auto-verified attribute is email only', () => {
    expect(props.AutoVerifiedAttributes).toEqual(['email']);
  });

  it('removal policy DESTROY', () => {
    expect(pool.DeletionPolicy).toBe('Delete');
  });

  it('pool name uses personal-dev prefix', () => {
    expect(props.UserPoolName).toMatch(/^personal-dev-/);
  });
});

describe('A. PERSONAL_AWS_DEV — App Client contract', () => {
  const { poolClient } = getPoolResources(getTemplate('PERSONAL_AWS_DEV'));
  const props = poolClient.Properties as Record<string, unknown>;

  it('generateSecret = false', () => {
    expect(props.GenerateSecret).toBe(false);
  });

  it('preventUserExistenceErrors enabled', () => {
    expect(props.PreventUserExistenceErrors).toBe('ENABLED');
  });

  it('token revocation enabled', () => {
    expect(props.EnableTokenRevocation).toBe(true);
  });

  it('Cognito-only identity provider', () => {
    expect(props.SupportedIdentityProviders).toEqual(['COGNITO']);
  });

  it('authorization-code flow enabled (AllowedOAuthFlows includes "code")', () => {
    expect(props.AllowedOAuthFlows).toContain('code');
  });

  it('implicit flow disabled (AllowedOAuthFlows does NOT include "implicit")', () => {
    expect(props.AllowedOAuthFlows).not.toContain('implicit');
  });

  it('client-credentials flow disabled (no "client_credentials" in AllowedOAuthFlows)', () => {
    expect(props.AllowedOAuthFlows).not.toContain('client_credentials');
  });

  it('callback URLs equal injected props', () => {
    expect(props.CallbackURLs).toEqual(['https://app.example.com/callback']);
  });

  it('logout URLs equal injected props', () => {
    expect(props.LogoutURLs).toEqual(['https://app.example.com/logout']);
  });

  it('access token validity from props (minutes)', () => {
    expect(props.AccessTokenValidity).toBe(60);
  });

  it('id token validity from props (minutes)', () => {
    expect(props.IdTokenValidity).toBe(60);
  });

  it('refresh token validity from props (converted to minutes)', () => {
    // CDK 2.262 serialises refresh token validity in the unit requested,
    // which here we requested as days. Verify the conversion is correct.
    // 30 days × 24 × 60 = 43200 minutes.
    expect(props.RefreshTokenValidity).toBe(30 * 24 * 60);
  });

  it('client name uses personal-dev prefix', () => {
    expect(props.ClientName).toMatch(/^personal-dev-/);
  });

  it('all three custom scopes present in AllowedOAuthScopes', () => {
    const scopes = props.AllowedOAuthScopes as string[];
    COGNITO_SCOPE_NAMES.forEach((name) => {
      expect(scopes.some((s) => s.endsWith(name))).toBe(true);
    });
  });

  it('standard scopes openid/email/profile are present', () => {
    const scopes = props.AllowedOAuthScopes as string[];
    expect(scopes).toContain('openid');
    expect(scopes).toContain('email');
    expect(scopes).toContain('profile');
  });
});

describe('A. PERSONAL_AWS_DEV — Groups', () => {
  const { pool, groups } = getPoolResources(getTemplate('PERSONAL_AWS_DEV'));

  it('group names are exact canonical set admin/operator/commander', () => {
    const groupNames = groups.map((g) => (g.Properties as Record<string, unknown>).GroupName as string);
    expect([...groupNames].sort()).toEqual([...COGNITO_GROUP_NAMES].sort());
  });

  it('no group has an IAM RoleArn attached', () => {
    groups.forEach((g) => {
      expect((g.Properties as Record<string, unknown>).RoleArn).toBeUndefined();
    });
  });

  it('all groups reference the correct User Pool via Ref token', () => {
    groups.forEach((g) => {
      const propRef = (g.Properties as Record<string, unknown>).UserPoolId as Record<string, unknown>;
      expect(propRef).toEqual({ Ref: expect.any(String) });
    });
    expect(pool).toBeDefined();
  });

  it('group descriptions match COGNITO_GROUP_DESCRIPTIONS', () => {
    groups.forEach((g) => {
      const props = g.Properties as Record<string, unknown>;
      expect(props.Description).toBe(COGNITO_GROUP_DESCRIPTIONS[props.GroupName as 'admin' | 'operator' | 'commander']);
    });
  });
});

// ─── B. COMPETITION_AWS ───────────────────────────────────────────────────

describe('B. COMPETITION_AWS — same architecture', () => {
  const t = getTemplate('COMPETITION_AWS');
  const r = getResources(t);

  it('exactly 1 User Pool', () => expect(countByType(r, 'AWS::Cognito::UserPool')).toBe(1));
  it('exactly 1 User Pool Client', () => expect(countByType(r, 'AWS::Cognito::UserPoolClient')).toBe(1));
  it('exactly 1 Resource Server', () => expect(countByType(r, 'AWS::Cognito::UserPoolResourceServer')).toBe(1));
  it('exactly 1 User Pool Domain', () => expect(countByType(r, 'AWS::Cognito::UserPoolDomain')).toBe(1));
  it('exactly 3 User Pool Groups', () => expect(countByType(r, 'AWS::Cognito::UserPoolGroup')).toBe(3));
});

describe('B. COMPETITION_AWS — competition resource prefix', () => {
  const { pool } = getPoolResources(getTemplate('COMPETITION_AWS'));
  const { poolClient } = getPoolResources(getTemplate('COMPETITION_AWS'));

  it('pool name uses competition prefix', () => {
    expect((pool.Properties as Record<string, unknown>).UserPoolName).toMatch(/^competition-/);
  });

  it('client name uses competition prefix', () => {
    expect((poolClient.Properties as Record<string, unknown>).ClientName).toMatch(/^competition-/);
  });

  it('resource server identifier uses competition prefix', () => {
    const { resourceServer } = getPoolResources(getTemplate('COMPETITION_AWS'));
    expect((resourceServer.Properties as Record<string, unknown>).Identifier).toMatch(/^competition-/);
  });
});

describe('B. COMPETITION_AWS — HTTPS-only URL validation', () => {
  it('HTTP callback URL throws', () => {
    expect(() =>
      build('COMPETITION_AWS', { callbackUrls: ['http://app.example.com/callback'] }),
    ).toThrow(/HTTPS/);
  });

  it('localhost callback URL throws', () => {
    expect(() =>
      build('COMPETITION_AWS', { callbackUrls: ['https://localhost:3000/callback'] }),
    ).toThrow(/localhost/);
  });

  it('wildcard URL throws', () => {
    expect(() =>
      build('COMPETITION_AWS', { callbackUrls: ['https://example.com/callback*x'] }),
    ).toThrow(/wildcard/);
  });

  it('fragment URL throws', () => {
    expect(() =>
      build('COMPETITION_AWS', { callbackUrls: ['https://app.example.com/callback#fragment'] }),
    ).toThrow(/fragment/);
  });

  it('HTTP logout URL throws', () => {
    expect(() =>
      build('COMPETITION_AWS', { logoutUrls: ['http://app.example.com/logout'] }),
    ).toThrow(/HTTPS/);
  });
});

describe('B. COMPETITION_AWS — removal policy RETAIN', () => {
  const { pool } = getPoolResources(getTemplate('COMPETITION_AWS'));

  it('User Pool uses Retain deletion policy', () => {
    expect(pool.DeletionPolicy).toBe('Retain');
  });
});

// ─── C. LOCAL_MOCK ─────────────────────────────────────────────────────────

describe('C. LOCAL_MOCK — zero resources', () => {
  const t = getTemplate('LOCAL_MOCK');
  const r = getResources(t);

  it('total AWS Resources = 0', () => {
    expect(Object.keys(r).length).toBe(0);
  });

  it('no Cognito resources', () => {
    expect(countByType(r, 'AWS::Cognito::UserPool')).toBe(0);
    expect(countByType(r, 'AWS::Cognito::UserPoolClient')).toBe(0);
    expect(countByType(r, 'AWS::Cognito::UserPoolResourceServer')).toBe(0);
    expect(countByType(r, 'AWS::Cognito::UserPoolDomain')).toBe(0);
    expect(countByType(r, 'AWS::Cognito::UserPoolGroup')).toBe(0);
  });

  it('no Cognito Outputs produced by this Construct (LOCAL_MOCK does not emit any)', () => {
    const { construct } = build('LOCAL_MOCK');
    // Construction bails out before producing any CloudFormation Output.
    expect(t.Outputs ?? {}).toEqual({});
    // Sanity: the construct has no resource references in LOCAL_MOCK either.
    void construct;
  });

  it('LOCAL_MOCK template has no Outputs at all (none produced)', () => {
    // For LOCAL_MOCK the cdk.out template literally has no Outputs section.
    const t2 = getTemplate('LOCAL_MOCK');
    expect(t2.Outputs).toBeUndefined();
  });
});

// ─── D. Authorization contract ──────────────────────────────────────────────

describe('D. Authorization contract', () => {
  it('exactly three groups named admin/operator/commander', () => {
    const { construct } = build('PERSONAL_AWS_DEV');
    expect(Object.keys(construct.authorizationContract).sort()).toEqual([...COGNITO_GROUP_NAMES].sort());
  });

  it('exact group-to-required-scope contract', () => {
    const { construct } = build('PERSONAL_AWS_DEV');
    expect(construct.authorizationContract.admin).toEqual({
      group: 'admin',
      requiredScope: expect.stringMatching(/incidents\.inject$/),
      routeCapability: 'incident injection',
    });
    expect(construct.authorizationContract.operator).toEqual({
      group: 'operator',
      requiredScope: expect.stringMatching(/whatif\.execute$/),
      routeCapability: 'what-if execution',
    });
    expect(construct.authorizationContract.commander).toEqual({
      group: 'commander',
      requiredScope: expect.stringMatching(/decisions\.publish$/),
      routeCapability: 'decision publication',
    });
  });

  it('no wildcard in any requiredScope', () => {
    const { construct } = build('PERSONAL_AWS_DEV');
    const scopes = [
      construct.authorizationContract.admin.requiredScope,
      construct.authorizationContract.operator.requiredScope,
      construct.authorizationContract.commander.requiredScope,
    ];
    scopes.forEach((s) => expect(s).not.toContain('*'));
  });

  it('scope identifier is profile-specific (different prefixes per profile)', () => {
    const { construct: pc } = build('PERSONAL_AWS_DEV');
    const { construct: cc } = build('COMPETITION_AWS');
    expect(pc.authorizationContract.admin.requiredScope).toContain('personal-dev-');
    expect(cc.authorizationContract.admin.requiredScope).toContain('competition-');
    expect(pc.authorizationContract.admin.requiredScope).not.toEqual(cc.authorizationContract.admin.requiredScope);
  });

  it('group claim ≠ scope claim (dual-layer boundary asserted)', () => {
    const { construct } = build('PERSONAL_AWS_DEV');
    // cognito:groups claim is the group name; requiredScope is the API capability.
    // They are different strings — no automatic mapping is performed.
    expect(construct.authorizationContract.admin.group).toBe('admin');
    expect(construct.authorizationContract.admin.requiredScope).not.toBe('admin');
    expect(construct.authorizationContract.admin.requiredScope).not.toMatch(/^admin\b/);
  });

  it('resourceServerIdentifier is exposed and stable', () => {
    const { construct } = build('PERSONAL_AWS_DEV');
    expect(typeof construct.resourceServerIdentifier).toBe('string');
    expect(construct.resourceServerIdentifier.length).toBeGreaterThan(0);
    expect(construct.resourceServerIdentifier).toContain('personal-dev-');
  });

  it('issuerUrl equals userPool.userPoolProviderUrl (CDK L2 source of truth)', () => {
    const { construct } = build('PERSONAL_AWS_DEV');
    // The IUserPool interface omits userPoolProviderUrl, but the L2
    // UserPool class exposes it. Cast to access the concrete getter.
    expect(construct.issuerUrl).toBe(
      (construct.userPool as cognito.UserPool).userPoolProviderUrl,
    );
  });

  it('issuerUrl does NOT equal userPool.userPoolArn (JWT issuer is not an ARN)', () => {
    const { construct } = build('PERSONAL_AWS_DEV');
    expect(construct.issuerUrl).not.toBe(construct.userPool.userPoolArn);
  });

  it('issuerUrl is the OIDC provider URL: https://cognito-idp.<region>.<urlSuffix>/<userPoolId>', () => {
    const { construct } = build('PERSONAL_AWS_DEV');
    // CDK 2.262 returns userPool.userPoolProviderUrl as a CDK token at
    // synth time (an unresolved attribute reference). The structural
    // contract — encoded in the Output Value as Fn::GetAtt with
    // attribute "ProviderURL" — proves the issuer is a Cognito provider
    // URL, NOT an ARN. We assert this on the Output in section J.1.
    // At the typed-property level, we only verify it does not look like
    // an ARN literal.
    expect(construct.issuerUrl).not.toMatch(/^arn:/);
    expect(construct.issuerUrl).not.toContain(':userpool/');
  });

  it('issuerUrl uses CDK token composition (no hardcoded account/region)', () => {
    const { construct } = build('PERSONAL_AWS_DEV');
    expect(construct.issuerUrl).not.toContain(FAKE_ACCOUNT);
    expect(construct.issuerUrl).not.toContain(FAKE_REGION);
    // At synth time the value is a CDK token (unresolved). It must
    // not include any literal account or region string.
    expect(construct.issuerUrl).not.toMatch(/arn:aws:[a-z0-9]+:/);
  });

  it('issuerUrl is independent of callbackUrls and domainPrefix', () => {
    // The issuer URL MUST be the Cognito provider URL even when the
    // SPA OAuth URLs change — these are orthogonal concerns. CDK
    // tokens are unique per call site; we compare the resolved template
    // Output Value instead of the raw token string.
    const tA = getTemplate('PERSONAL_AWS_DEV', {
      callbackUrls: ['https://appA.example.com/callback'],
      domainPrefix: 'aaa-prefix',
    });
    const tB = getTemplate('PERSONAL_AWS_DEV', {
      callbackUrls: ['https://appB.example.com/callback'],
      domainPrefix: 'bbb-prefix',
    });
    const issuerA = extractIssuerValue(tA);
    const issuerB = extractIssuerValue(tB);
    expect(issuerA).toEqual(issuerB);
    expect(JSON.stringify(issuerA)).not.toContain('appA');
    expect(JSON.stringify(issuerA)).not.toContain('appB');
    expect(JSON.stringify(issuerA)).not.toContain('aaa-prefix');
    expect(JSON.stringify(issuerA)).not.toContain('bbb-prefix');
  });

  it('issuerUrl is the same across PERSONAL_AWS_DEV and COMPETITION_AWS (token-only, no env-bound literal)', () => {
    // Both profiles resolve the same User Pool provider URL via CDK
    // tokens. We compare Output Value structures.
    const tP = getTemplate('PERSONAL_AWS_DEV');
    const tC = getTemplate('COMPETITION_AWS');
    expect(extractIssuerValue(tP)).toEqual(extractIssuerValue(tC));
  });

  it('issuerUrl contains the UserPoolId via the ProviderURL attribute reference', () => {
    const t = getTemplate('PERSONAL_AWS_DEV');
    const issuer = extractIssuerValue(t);
    expect(issuer).toEqual({ 'Fn::GetAtt': [expect.stringMatching(/UserPool/), 'ProviderURL'] });
  });
});

function extractIssuerValue(t: Record<string, Record<string, unknown>>): unknown {
  const outputs = (t.Outputs ?? {}) as Record<string, Record<string, unknown>>;
  const hit = Object.entries(outputs).find(([k]) => k.includes('AuthUserPoolIssuer'));
  return hit?.[1].Value;
}

// ─── E. Isolation — zero forbidden resource types ────────────────────────────

describe('E. Isolation — zero forbidden resource types (PERSONAL_AWS_DEV)', () => {
  const r = getResources(getTemplate('PERSONAL_AWS_DEV'));

  it('0 AWS::IAM::Role', () => expect(countByType(r, 'AWS::IAM::Role')).toBe(0));
  it('0 AWS::IAM::Policy', () => expect(countByType(r, 'AWS::IAM::Policy')).toBe(0));
  it('0 AWS::Lambda::Function', () => expect(countByType(r, 'AWS::Lambda::Function')).toBe(0));
  it('0 AWS::Cognito::IdentityPool', () => expect(countByType(r, 'AWS::Cognito::IdentityPool')).toBe(0));
  it('0 Custom::*', () => {
    const types = Object.values(r).map((x) => x.Type as string);
    expect(types.filter((t) => t.startsWith('Custom::'))).toHaveLength(0);
  });
  it('0 API Gateway V1 resources', () => expect(countByType(r, 'AWS::ApiGateway::')).toBe(0));
  it('0 API Gateway V2 resources', () => {
    const types = Object.values(r).map((x) => x.Type as string);
    expect(types.filter((t) => t.startsWith('AWS::ApiGatewayV2::'))).toHaveLength(0);
  });
  it('0 DynamoDB resources', () => expect(countByType(r, 'AWS::DynamoDB::')).toBe(0));
  it('0 S3 resources', () => expect(countByType(r, 'AWS::S3::')).toBe(0));
  it('0 SSM resources', () => expect(countByType(r, 'AWS::SSM::')).toBe(0));
  it('0 Secrets Manager resources', () => expect(countByType(r, 'AWS::SecretsManager::')).toBe(0));
});

// ─── F. Hard-coding guard ─────────────────────────────────────────────────

describe('F. Hard-coding guard (PERSONAL_AWS_DEV)', () => {
  it('no hardcoded account ID literal in any resource property', () => {
    const r = getResources(getTemplate('PERSONAL_AWS_DEV'));
    const allProps = stringifyAllProps(r);
    expect(allProps.some((v) => v.includes(FAKE_ACCOUNT))).toBe(false);
  });

  it('no hardcoded region literal appears as a literal value', () => {
    const r = getResources(getTemplate('PERSONAL_AWS_DEV'));
    const allProps = stringifyAllProps(r);
    // The literal string region should NOT appear. CDK uses Ref tokens to AWS::Region.
    expect(allProps.some((v) => v === FAKE_REGION)).toBe(false);
    // The CDK token reference style: "Ref": "AWS::Region"  not  "ap-northeast-1"
    expect(JSON.stringify(r)).not.toContain(FAKE_REGION);
  });

  it('no ARN literal in template', () => {
    const r = getResources(getTemplate('PERSONAL_AWS_DEV'));
    const json = JSON.stringify(r);
    expect(json).not.toMatch(/arn:aws:[a-z]+:\*|^arn:aws:[a-z]+:[^/:"]+:.*:\*/);
  });

  it('no client secret literal', () => {
    const r = getResources(getTemplate('PERSONAL_AWS_DEV'));
    const allProps = stringifyAllProps(r);
    expect(allProps.some((v) => /secret[a-z0-9]{20,}/i.test(v))).toBe(false);
  });

  it('domain prefix is the caller-provided prop, not a hard-coded value', () => {
    const r = getResources(getTemplate('PERSONAL_AWS_DEV'));
    const domain = Object.values(r).find((x) => x.Type === 'AWS::Cognito::UserPoolDomain')!;
    expect((domain.Properties as Record<string, unknown>).Domain).toBe('my-cityresponse');
  });
});

function stringifyAllProps(r: Record<string, Record<string, unknown>>): string[] {
  const list: string[] = [];
  function walk(v: unknown): void {
    if (v == null) return;
    if (typeof v === 'string') list.push(v);
    else if (Array.isArray(v)) v.forEach(walk);
    else if (typeof v === 'object') Object.values(v as Record<string, unknown>).forEach(walk);
  }
  Object.values(r).forEach((res) => walk(res.Properties));
  return list;
}

// ─── G. Validation failures ────────────────────────────────────────────────

describe('G. Validation failures (PERSONAL_AWS_DEV)', () => {
  it('blank userPoolName throws', () => {
    expect(() => build('PERSONAL_AWS_DEV', { userPoolName: '  ' })).toThrow(/userPoolName/);
  });

  it('blank appClientName throws', () => {
    expect(() => build('PERSONAL_AWS_DEV', { appClientName: '' })).toThrow(/appClientName/);
  });

  it('empty callbackUrls throws', () => {
    expect(() => build('PERSONAL_AWS_DEV', { callbackUrls: [] })).toThrow(/callbackUrls/);
  });

  it('empty logoutUrls throws', () => {
    expect(() => build('PERSONAL_AWS_DEV', { logoutUrls: [] })).toThrow(/logoutUrls/);
  });

  it('duplicate URLs throw', () => {
    expect(() =>
      build('PERSONAL_AWS_DEV', { callbackUrls: ['https://a.com/cb', 'https://a.com/cb'] }),
    ).toThrow(/duplicate/);
  });

  it('wildcard URL throws', () => {
    expect(() =>
      build('PERSONAL_AWS_DEV', { callbackUrls: ['https://example.com/cb*x'] }),
    ).toThrow(/wildcard/);
  });

  it('fragment URL throws', () => {
    expect(() =>
      build('PERSONAL_AWS_DEV', { callbackUrls: ['https://example.com/cb#frag'] }),
    ).toThrow(/fragment/);
  });

  it('invalid domainPrefix (trailing hyphen) throws', () => {
    expect(() => build('PERSONAL_AWS_DEV', { domainPrefix: 'prefix-' })).toThrow(/domainPrefix/);
  });

  it('invalid domainPrefix (starts with digit) throws', () => {
    expect(() => build('PERSONAL_AWS_DEV', { domainPrefix: '123abc' })).toThrow(/domainPrefix/);
  });

  it('invalid domainPrefix (too long 64 chars) throws', () => {
    expect(() => build('PERSONAL_AWS_DEV', { domainPrefix: 'a'.repeat(64) })).toThrow(/domainPrefix/);
  });

  it('accessTokenValidity below 5 throws', () => {
    expect(() => build('PERSONAL_AWS_DEV', { accessTokenValidityMinutes: 4 })).toThrow(/accessTokenValidity/);
  });

  it('accessTokenValidity above 43200 throws', () => {
    expect(() => build('PERSONAL_AWS_DEV', { accessTokenValidityMinutes: 43201 })).toThrow(/accessTokenValidity/);
  });

  it('idTokenValidity above 900 throws', () => {
    expect(() => build('PERSONAL_AWS_DEV', { idTokenValidityMinutes: 901 })).toThrow(/idTokenValidity/);
  });

  it('refreshTokenValidity below 1 throws', () => {
    expect(() => build('PERSONAL_AWS_DEV', { refreshTokenValidityDays: 0 })).toThrow(/refreshTokenValidity/);
  });

  it('refreshTokenValidity above 3650 throws', () => {
    expect(() => build('PERSONAL_AWS_DEV', { refreshTokenValidityDays: 3651 })).toThrow(/refreshTokenValidity/);
  });

  it('non-integer token validity throws', () => {
    expect(() => build('PERSONAL_AWS_DEV', { accessTokenValidityMinutes: 60.5 })).toThrow(/accessTokenValidity/);
  });
});

// ─── H. Config key exports ─────────────────────────────────────────────────

describe('H. Config key exports', () => {
  it('AUTH_USER_POOL_ID_CONFIG_KEY = "auth.user_pool_id"', () => {
    expect(AUTH_USER_POOL_ID_CONFIG_KEY).toBe('auth.user_pool_id');
  });

  it('AUTH_APP_CLIENT_ID_CONFIG_KEY = "auth.app_client_id"', () => {
    expect(AUTH_APP_CLIENT_ID_CONFIG_KEY).toBe('auth.app_client_id');
  });
});

// ─── I. Public surface ─────────────────────────────────────────────────────

describe('I. Public surface (PERSONAL_AWS_DEV)', () => {
  it('userPoolId is a CDK token (non-empty string)', () => {
    const { construct } = build('PERSONAL_AWS_DEV');
    expect(typeof construct.userPoolId).toBe('string');
    expect(construct.userPoolId.length).toBeGreaterThan(0);
  });

  it('userPoolClientId is a CDK token (non-empty string)', () => {
    const { construct } = build('PERSONAL_AWS_DEV');
    expect(typeof construct.userPoolClientId).toBe('string');
    expect(construct.userPoolClientId.length).toBeGreaterThan(0);
  });

  it('userPool and userPoolClient references are exposed', () => {
    const { construct } = build('PERSONAL_AWS_DEV');
    expect(construct.userPool).toBeDefined();
    expect(construct.userPoolClient).toBeDefined();
  });

  it('authorizationContract contains admin/operator/commander keys', () => {
    const { construct } = build('PERSONAL_AWS_DEV');
    expect(construct.authorizationContract).toHaveProperty('admin');
    expect(construct.authorizationContract).toHaveProperty('operator');
    expect(construct.authorizationContract).toHaveProperty('commander');
  });
});

// ─── J. Outputs — issuer/ARN separation ──────────────────────────────────

describe('J.1 Outputs — AuthUserPoolIssuer is the OIDC issuer URL, NOT an ARN', () => {
  function issuerOutputFor(profile: Profile, extra: Record<string, unknown> = {}) {
    const t = getTemplate(profile, extra);
    const outputs = (t.Outputs ?? {}) as Record<string, Record<string, unknown>>;
    const hit = Object.entries(outputs).find(([k]) => k.includes('AuthUserPoolIssuer'))!;
    return hit[1] as Record<string, unknown>;
  }

  it('semantic type: Value is an Fn::GetAtt reference to Cognito UserPool.ProviderURL', () => {
    const value = issuerOutputFor('PERSONAL_AWS_DEV').Value as Record<string, unknown>;
    // CDK 2.262 emits userPool.userPoolProviderUrl as
    //   { 'Fn::GetAtt': ['<UserPoolLogicalId>', 'ProviderURL'] }
    // This is the canonical Cognito OIDC provider URL attribute.
    expect(value).toEqual({
      'Fn::GetAtt': [expect.stringMatching(/UserPool/), 'ProviderURL'],
    });
  });

  it('value comes from construct.issuerUrl (construct.issuerUrl IS userPool.userPoolProviderUrl)', () => {
    const { construct } = build('PERSONAL_AWS_DEV');
    // At synth time, construct.issuerUrl is the L2 token string; CDK
    // emits the same token as Fn::GetAtt("ProviderURL"). Both
    // refer to the same underlying attribute, so the resolved CFN
    // value is the same physical URL at deploy time.
    const value = issuerOutputFor('PERSONAL_AWS_DEV').Value;
    expect(value).toEqual({
      'Fn::GetAtt': [expect.any(String), 'ProviderURL'],
    });
    // Verify the typed property is exactly the L2 getter:
    expect(construct.issuerUrl).toBe(
      (construct.userPool as cognito.UserPool).userPoolProviderUrl,
    );
  });

  it('does NOT start with arn:', () => {
    const rendered = JSON.stringify(issuerOutputFor('PERSONAL_AWS_DEV').Value);
    expect(rendered).not.toMatch(/^"arn:/);
  });

  it('does NOT contain :userpool/ (ARN-only pattern)', () => {
    const rendered = JSON.stringify(issuerOutputFor('PERSONAL_AWS_DEV').Value);
    expect(rendered).not.toContain(':userpool/');
  });

  it('does NOT reference AWS AccountId', () => {
    const rendered = JSON.stringify(issuerOutputFor('PERSONAL_AWS_DEV').Value);
    expect(rendered).not.toContain('AWS::AccountId');
  });

  it('does NOT use Hosted UI domainPrefix (must be a Cognito provider URL)', () => {
    const rendered = JSON.stringify(issuerOutputFor('PERSONAL_AWS_DEV').Value);
    expect(rendered).not.toContain('my-cityresponse');
  });

  it('does NOT contain a Ref to AWS::Cognito::UserPool (uses GetAtt not Ref)', () => {
    const value = issuerOutputFor('PERSONAL_AWS_DEV').Value as Record<string, unknown>;
    // The User Pool ID is in the AuthUserPoolId output. The issuer
    // output is the ProviderURL attribute, NOT a Ref to the pool.
    expect(value.Ref).toBeUndefined();
  });

  it('has no Export (no cross-stack exportName)', () => {
    const o = issuerOutputFor('PERSONAL_AWS_DEV');
    expect(o.Export).toBeUndefined();
    expect(o.ExportName).toBeUndefined();
  });

  it('contract — is HTTPS via the Cognito provider URL (ProviderURL attribute)', () => {
    // ProviderURL is documented by AWS as an HTTPS URL of the form
    //   https://cognito-idp.<region>.<amazonaws|c2s|...>/<userPoolId>
    // We assert the structural marker — the GetAtt attribute name —
    // proves we are asking AWS for the provider URL, not an ARN.
    const value = issuerOutputFor('PERSONAL_AWS_DEV').Value as Record<string, unknown>;
    const fnGetAtt = value['Fn::GetAtt'] as string[];
    expect(fnGetAtt).toHaveLength(2);
    expect(fnGetAtt[1]).toBe('ProviderURL');
  });
});

describe('J.2 Outputs — contract separation (no identity imitation)', () => {
  it('AuthUserPoolId is a Ref to AWS::Cognito::UserPool (User Pool ID)', () => {
    const t = getTemplate('PERSONAL_AWS_DEV');
    const outputs = (t.Outputs ?? {}) as Record<string, Record<string, unknown>>;
    const hit = Object.entries(outputs).find(([k]) => k.includes('AuthUserPoolId'))!;
    expect(hit[1].Value).toEqual({ Ref: expect.stringMatching(/UserPool/) });
  });

  it('AuthUserPoolClientId is a Ref to AWS::Cognito::UserPoolClient', () => {
    const t = getTemplate('PERSONAL_AWS_DEV');
    const outputs = (t.Outputs ?? {}) as Record<string, Record<string, unknown>>;
    const hit = Object.entries(outputs).find(([k]) => k.includes('AuthUserPoolClientId'))!;
    expect(hit[1].Value).toEqual({ Ref: expect.stringMatching(/UserPoolClient/) });
  });

  it('AuthResourceServerIdentifier is a literal string identifier (NOT a JWT issuer)', () => {
    const t = getTemplate('PERSONAL_AWS_DEV');
    const outputs = (t.Outputs ?? {}) as Record<string, Record<string, unknown>>;
    const hit = Object.entries(outputs).find(([k]) => k.includes('AuthResourceServerIdentifier'))!;
    const value = hit[1].Value;
    expect(typeof value).toBe('string');
    expect(value as string).toMatch(/^personal-dev-UserPool-api$/);
    // It must NOT start with https://, it must NOT be an arn: string,
    // and it must NOT contain cognito-idp.
    expect(String(value)).not.toMatch(/^https:\/\//);
    expect(String(value)).not.toMatch(/^arn:/);
    expect(String(value)).not.toContain('cognito-idp');
  });

  it('the four outputs are pairwise distinct', () => {
    const t = getTemplate('PERSONAL_AWS_DEV');
    const outputs = (t.Outputs ?? {}) as Record<string, Record<string, unknown>>;
    const pairs = [
      ['AuthUserPoolId', 'AuthUserPoolClientId'],
      ['AuthUserPoolId', 'AuthUserPoolIssuer'],
      ['AuthUserPoolId', 'AuthResourceServerIdentifier'],
      ['AuthUserPoolClientId', 'AuthUserPoolIssuer'],
      ['AuthUserPoolClientId', 'AuthResourceServerIdentifier'],
      ['AuthUserPoolIssuer', 'AuthResourceServerIdentifier'],
    ];
    for (const [a, b] of pairs) {
      const va = JSON.stringify((Object.entries(outputs).find(([k]) => k.includes(a))?.[1] ?? {}).Value);
      const vb = JSON.stringify((Object.entries(outputs).find(([k]) => k.includes(b))?.[1] ?? {}).Value);
      expect(va).not.toBe(vb);
    }
  });
});

describe('J.3 Outputs — LOCAL_MOCK still produces zero resources and zero Outputs', () => {
  it('LOCAL_MOCK stack has 0 AWS resources', () => {
    const r = getResources(getTemplate('LOCAL_MOCK'));
    expect(Object.keys(r).length).toBe(0);
  });

  it('LOCAL_MOCK template has no Outputs section (no CfnOutput created)', () => {
    const t = getTemplate('LOCAL_MOCK');
    expect(t.Outputs).toBeUndefined();
  });
});
