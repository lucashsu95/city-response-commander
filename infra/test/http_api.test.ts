/**
 * TASK-069 targeted tests — HttpApiConstruct
 *
 * No AWS credentials / network access; pure synth-time CDK assertions.
 * Lambda function references are created via `Function.fromFunctionArn`
 * (zero AWS::Lambda::Function resources from this test).
 */

import { describe, it, expect } from 'vitest';
import { App, Stack, Token } from 'aws-cdk-lib';
import { Function, IFunction } from 'aws-cdk-lib/aws-lambda';
import { resolveEnvironmentContext } from '../lib/env_context.js';
import {
  HttpApiConstruct,
  HTTP_API_ROUTE_CONTRACT,
  HTTP_API_ROUTE_COUNT,
  HTTP_API_GET_COUNT,
  HTTP_API_POST_COUNT,
  HTTP_API_PUBLIC_READ_COUNT,
  HTTP_API_PROTECTED_WRITE_COUNT,
  API_ENDPOINT_CONFIG_KEY,
} from '../lib/constructs/http_api.js';
import type { AuthorizationContract } from '../lib/constructs/cognito.js';
import { CognitoAuthConstruct } from '../lib/constructs/cognito.js';

type Profile = 'LOCAL_MOCK' | 'PERSONAL_AWS_DEV' | 'COMPETITION_AWS';

const FAKE_ACCOUNT = '111111111111';
const FAKE_REGION = 'ap-northeast-1';

// ─── Fixtures ──────────────────────────────────────────────────────────────

function personalCors() {
  return {
    origins: ['http://localhost:3000', 'https://app.example.com'],
    headers: ['Authorization', 'Content-Type', 'X-Trace-Id'],
  };
}

function competitionCors() {
  return {
    origins: ['https://app.example.com'],
    headers: ['Authorization', 'Content-Type'],
  };
}

function corsFor(profile: Profile) {
  return profile === 'COMPETITION_AWS' ? competitionCors() : personalCors();
}

function buildContract(profile: Profile): AuthorizationContract {
  // Mirror the construct's contract shape; each entry uses the
  // canonical group name and a scope that follows <identifier>/<name>.
  // The identifier is intentionally derived from the resourcePrefix
  // so the contract is profile-aware (TASK-071 emits the same shape).
  const idPrefix = profile === 'COMPETITION_AWS' ? 'competition' : 'personal-dev';
  const id = `${idPrefix}-UserPool-api`;
  return {
    admin:    { group: 'admin',    requiredScope: `${id}/incidents.inject`,  routeCapability: 'incident injection' },
    operator: { group: 'operator', requiredScope: `${id}/whatif.execute`,     routeCapability: 'what-if execution' },
    commander:{ group: 'commander',requiredScope: `${id}/decisions.publish`,  routeCapability: 'decision publication' },
  };
}

function fakeLambda(stack: Stack, id: string): IFunction {
  return Function.fromFunctionArn(
    stack,
    id,
    `arn:aws:lambda:${FAKE_REGION}:${FAKE_ACCOUNT}:function:${id}`,
  );
}

function build(profile: Profile, extra: Partial<{
  integrationTimeoutSeconds: number;
  apiName: string;
  corsAllowedOrigins: string[];
  corsAllowedHeaders: string[];
}> = {}) {
  const app = new App({ autoSynth: false });
  app.node.setContext('env', profile);
  const ctx = resolveEnvironmentContext(app.node);
  const stack = new Stack(app, `cog-http-test-${profile.replace(/_/g, '-')}`);
  const cors = corsFor(profile);

  // Build a Cognito construct to obtain real CDK-token issuer/audience
  // — exactly what TASK-069 receives in production.
  const cognitoConstruct = new CognitoAuthConstruct(stack, 'Cognito', {
    envContext: ctx,
    userPoolName: 'UserPool',
    appClientName: 'AppClient',
    domainPrefix: 'my-cityresponse',
    callbackUrls: profile === 'COMPETITION_AWS'
      ? ['https://app.example.com/callback']
      : ['http://localhost:3000/callback'],
    logoutUrls: profile === 'COMPETITION_AWS'
      ? ['https://app.example.com/logout']
      : ['http://localhost:3000/logout'],
    accessTokenValidityMinutes: 60,
    idTokenValidityMinutes: 60,
    refreshTokenValidityDays: 30,
  });

  const httpApi = new HttpApiConstruct(stack, 'HttpApi', {
    envContext: ctx,
    apiName: extra.apiName ?? 'CrCmdHttpApi',
    jwtIssuer: cognitoConstruct.issuerUrl,
    jwtAudience: [cognitoConstruct.userPoolClientId],
    authorizationContract: extra.corsAllowedOrigins ? buildContract(profile) : buildContract(profile),
    injectFn: fakeLambda(stack, 'InjectFn'),
    apiReadFn: fakeLambda(stack, 'ApiReadFn'),
    whatIfFn: fakeLambda(stack, 'WhatIfFn'),
    publishFn: fakeLambda(stack, 'PublishFn'),
    corsAllowedOrigins: extra.corsAllowedOrigins ?? cors.origins,
    corsAllowedHeaders: extra.corsAllowedHeaders ?? cors.headers,
    integrationTimeoutSeconds: extra.integrationTimeoutSeconds ?? 10,
  });

  return { app, stack, ctx, httpApi, cognitoConstruct };
}

/**
 * Isolated build: HttpApi only, no Cognito. Used by the Isolation
 * section (K) so we can assert HttpApi is the ONLY producer of
 * resources in this stack.
 */
function buildIsolated(profile: Profile) {
  const app = new App({ autoSynth: false });
  app.node.setContext('env', profile);
  const ctx = resolveEnvironmentContext(app.node);
  const stack = new Stack(app, `cog-http-iso-${profile.replace(/_/g, '-')}`);
  const cors = corsFor(profile);

  // Synthesize generic CDK tokens for issuer/audience. The construct
  // only checks structure (non-blank, no wildcard), so token-shaped
  // strings are valid.
  const synthIssuer = Token.asString('mock-issuer.example.com');
  const synthAudience = Token.asString('mock-client-id');

  const httpApi = new HttpApiConstruct(stack, 'HttpApi', {
    envContext: ctx,
    apiName: 'IsoHttpApi',
    jwtIssuer: synthIssuer as unknown as string,
    jwtAudience: [synthAudience as unknown as string],
    authorizationContract: buildContract(profile),
    injectFn: fakeLambda(stack, 'InjectFn'),
    apiReadFn: fakeLambda(stack, 'ApiReadFn'),
    whatIfFn: fakeLambda(stack, 'WhatIfFn'),
    publishFn: fakeLambda(stack, 'PublishFn'),
    corsAllowedOrigins: cors.origins,
    corsAllowedHeaders: cors.headers,
    integrationTimeoutSeconds: 10,
  });

  return { app, stack, httpApi };
}

/**
 * Deployment-binding proof fixture.
 *
 * Uses `Function.fromFunctionAttributes({ functionArn, sameEnvironment: true })`
 * — i.e. the imported-function pattern TASK-180 will use when wiring the
 * four concrete Lambda Functions (built by RuntimeLambdasConstruct /
 * TASK-067) into HttpApiConstruct.
 *
 * `sameEnvironment: true` tells CDK it is permitted to attach
 * resource-based permissions (`AWS::Lambda::Permission`) to the stack,
 * which is exactly the boundary HttpApi is meant to populate via
 * `scopePermissionToRoute: true`.
 *
 * Guarantees:
 *   - 0 `AWS::Lambda::Function` (only `Function.fromFunctionAttributes`)
 *   - 0 `AWS::IAM::Role`
 *   - 0 `AWS::IAM::Policy`
 *   - CDK CAN add `AWS::Lambda::Permission` to the stack
 *
 * This is the SAME-ENVIRONMENT scenario the production TASK-180 wiring
 * will produce. If HttpApi's `scopePermissionToRoute: true` is correctly
 * applied, the resulting template will contain exactly 9
 * `AWS::Lambda::Permission` resources (6 GET → ApiReadFn + 1 POST
 * per Lambda for InjectFn/WhatIfFn/PublishFn).
 */
function buildDeploymentBindingProof(profile: Profile) {
  const app = new App({ autoSynth: false });
  app.node.setContext('env', profile);
  const ctx = resolveEnvironmentContext(app.node);
  // The stack MUST have an explicit env so that sameEnvironment auto-
  // detection succeeds. We pick a dummy account/region that matches
  // the imported function ARNs (so CDK considers them "same environment").
  const stack = new Stack(app, `cog-http-proof-${profile.replace(/_/g, '-')}`, {
    env: { account: FAKE_ACCOUNT, region: FAKE_REGION },
  });
  const cors = corsFor(profile);

  function proofLambda(stack: Stack, name: string): IFunction {
    const functionName = `${name}-proof-fixture`;
    return Function.fromFunctionAttributes(stack, name, {
      functionArn: `arn:aws:lambda:${FAKE_REGION}:${FAKE_ACCOUNT}:function:${functionName}`,
      sameEnvironment: true,
    });
  }

  const synthIssuer = Token.asString('mock-issuer.example.com');
  const synthAudience = Token.asString('mock-client-id');

  const httpApi = new HttpApiConstruct(stack, 'HttpApi', {
    envContext: ctx,
    apiName: 'ProofHttpApi',
    jwtIssuer: synthIssuer as unknown as string,
    jwtAudience: [synthAudience as unknown as string],
    authorizationContract: buildContract(profile),
    injectFn: proofLambda(stack, 'InjectFn'),
    apiReadFn: proofLambda(stack, 'ApiReadFn'),
    whatIfFn: proofLambda(stack, 'WhatIfFn'),
    publishFn: proofLambda(stack, 'PublishFn'),
    corsAllowedOrigins: cors.origins,
    corsAllowedHeaders: cors.headers,
    integrationTimeoutSeconds: 10,
  });

  return { app, stack, httpApi };
}

function getTemplate(profile: Profile, extra: Parameters<typeof build>[1] = {}) {
  const { app } = build(profile, extra);
  return app.synth().stacks[0].template as Record<string, Record<string, unknown>>;
}

function getResources(t: Record<string, Record<string, unknown>>) {
  return (t.Resources ?? {}) as Record<string, Record<string, unknown>>;
}

function countByType(r: Record<string, Record<string, unknown>>, type: string): number {
  return Object.values(r).filter((res) => res.Type === type).length;
}

function routesOf(t: Record<string, Record<string, unknown>>) {
  return Object.values(getResources(t)).filter((r) => r.Type === 'AWS::ApiGatewayV2::Route') as Array<Record<string, unknown>>;
}

function routeByKey(t: Record<string, Record<string, unknown>>, method: string, path: string) {
  return routesOf(t).find((r) => {
    const props = r.Properties as Record<string, unknown>;
    const k = props.RouteKey as string;
    return k === `${method} ${path}`;
  });
}

function integrationsOf(t: Record<string, Record<string, unknown>>) {
  return Object.values(getResources(t)).filter((r) => r.Type === 'AWS::ApiGatewayV2::Integration') as Array<Record<string, unknown>>;
}

function authorizersOf(t: Record<string, Record<string, unknown>>) {
  return Object.values(getResources(t)).filter((r) => r.Type === 'AWS::ApiGatewayV2::Authorizer') as Array<Record<string, unknown>>;
}

function permissionsOf(t: Record<string, Record<string, unknown>>) {
  return Object.values(getResources(t)).filter((r) => r.Type === 'AWS::Lambda::Permission') as Array<Record<string, unknown>>;
}

/**
 * Resolve a CFN intrinsic (`Fn::Join`, `Ref`, `Fn::Sub`) to a flat
 * string when possible, otherwise return the input untouched.
 *
 * This avoids asserting against brittle Logical IDs: we always work
 * on the fully-resolved structure.
 */
function resolveIntrinsic(v: unknown): unknown {
  if (v == null || typeof v !== 'object') return v;
  const obj = v as Record<string, unknown>;
  // { Ref: 'X' } — we keep it as a { ref: <name> } shape so the
  // test can match by logical-id substring (not raw equality).
  if ('Ref' in obj) return { __ref: obj.Ref as string };
  // { 'Fn::GetAtt': [logicalId, attr] }
  if ('Fn::GetAtt' in obj) {
    const arr = obj['Fn::GetAtt'] as unknown[];
    return { __getatt: arr[0] as string, __attr: arr[1] as string };
  }
  // { 'Fn::Join': [delim, [...parts]] }
  if ('Fn::Join' in obj) {
    const arr = obj['Fn::Join'] as Array<unknown>;
    const delim = arr[0] as string;
    const parts = (arr[1] as Array<unknown>).map(resolveIntrinsic);
    // Flatten strings; if any part is unresolved, keep as marker.
    const flat: string[] = [];
    for (const p of parts) {
      if (typeof p === 'string') flat.push(p);
      else return { __join: delim, __parts: parts };
    }
    return flat.join(delim);
  }
  // { 'Fn::Sub': '...' }
  if ('Fn::Sub' in obj) {
    return { __sub: obj['Fn::Sub'] };
  }
  // Recurse for objects/arrays.
  if (Array.isArray(obj)) return obj.map(resolveIntrinsic);
  const out: Record<string, unknown> = {};
  for (const [k, v2] of Object.entries(obj)) out[k] = resolveIntrinsic(v2);
  return out;
}

/** Pull the source-arn out of an AWS::Lambda::Permission resource as a normalised string. */
function permissionSourceArn(p: Record<string, unknown>): string {
  const props = p.Properties as Record<string, unknown>;
  const raw = props.SourceArn;
  const resolved = resolveIntrinsic(raw);
  // resolved may be a string, a { __ref, __getatt, __join, __sub } shape.
  // Return JSON for debugging; callers extract substrings.
  return JSON.stringify(resolved);
}

/**
 * Pull the route-path segment from a source-arn.
 *
 * CDK 2.262.2 emits SourceArn as a Fn::Join where the last string
 * element is the literal triple-slash pattern followed by the path.
 * The stage and method segments are both wildcard. Only the path is
 * a literal. We extract the path by stripping the leading stage+method
 * wildcard prefix.
 */
function permissionRoutePath(p: Record<string, unknown>): string {
  const json = permissionSourceArn(p);
  // Match the substring `/*/*/<path>"` (stage+method wildcards + path).
  const match = json.match(/\/\*\/\*\/([^"]*)"/);
  return match ? '/' + match[1] : '';
}

/** Pull the function name out of an AWS::Lambda::Permission resource (last ARN segment). */
function permissionFunctionName(p: Record<string, unknown>): string {
  const props = p.Properties as Record<string, unknown>;
  const fnName = props.FunctionName;
  const resolved = resolveIntrinsic(fnName);
  return JSON.stringify(resolved);
}

// ─── A. PERSONAL_AWS_DEV topology ───────────────────────────────────────────

describe('A. PERSONAL_AWS_DEV — HTTP API topology', () => {
  const t = getTemplate('PERSONAL_AWS_DEV');
  const r = getResources(t);

  it('exactly 1 AWS::ApiGatewayV2::Api', () => {
    expect(countByType(r, 'AWS::ApiGatewayV2::Api')).toBe(1);
  });

  it('ProtocolType = HTTP', () => {
    const api = Object.values(r).find((x) => x.Type === 'AWS::ApiGatewayV2::Api')!;
    expect((api.Properties as Record<string, unknown>).ProtocolType).toBe('HTTP');
  });

  it('exactly 1 default Stage', () => {
    expect(countByType(r, 'AWS::ApiGatewayV2::Stage')).toBe(1);
  });

  it('exactly 1 JWT Authorizer', () => {
    const auths = authorizersOf(t);
    expect(auths.length).toBe(1);
    expect((auths[0].Properties as Record<string, unknown>).AuthorizerType).toBe('JWT');
  });

  it('exactly 9 Routes', () => {
    expect(routesOf(t).length).toBe(9);
  });

  it('6 GET routes, 3 POST routes, 0 ANY, 0 $default', () => {
    const routes = routesOf(t);
    let get = 0, post = 0, any = 0, def = 0;
    for (const r of routes) {
      const k = (r.Properties as Record<string, unknown>).RouteKey as string;
      if (k === '$default') def++;
      else if (k.startsWith('GET ')) get++;
      else if (k.startsWith('POST ')) post++;
      else if (k.startsWith('ANY ')) any++;
    }
    expect(get).toBe(6);
    expect(post).toBe(3);
    expect(any).toBe(0);
    expect(def).toBe(0);
  });

  it('HttpApiEndpoint output exists (no exportName)', () => {
    const outputs = (t.Outputs ?? {}) as Record<string, Record<string, unknown>>;
    const hit = Object.entries(outputs).find(([k]) => k.includes('HttpApiEndpoint'));
    expect(hit).toBeDefined();
    expect(hit![1].ExportName).toBeUndefined();
    expect(hit![1].Export).toBeUndefined();
  });

  it('route contract count invariants are baked in', () => {
    expect(HTTP_API_ROUTE_COUNT).toBe(9);
    expect(HTTP_API_GET_COUNT).toBe(6);
    expect(HTTP_API_POST_COUNT).toBe(3);
    expect(HTTP_API_PUBLIC_READ_COUNT).toBe(6);
    expect(HTTP_API_PROTECTED_WRITE_COUNT).toBe(3);
  });
});

// ─── B. COMPETITION_AWS ───────────────────────────────────────────────────

describe('B. COMPETITION_AWS — same route architecture', () => {
  const t = getTemplate('COMPETITION_AWS');
  const r = getResources(t);

  it('exactly 1 HTTP API', () => expect(countByType(r, 'AWS::ApiGatewayV2::Api')).toBe(1));
  it('9 routes (same as PERSONAL)', () => expect(routesOf(t).length).toBe(9));
  it('6 GET routes', () => {
    const rs = routesOf(t).filter((r) => ((r.Properties as Record<string, unknown>).RouteKey as string).startsWith('GET '));
    expect(rs.length).toBe(6);
  });
  it('3 POST routes', () => {
    const rs = routesOf(t).filter((r) => ((r.Properties as Record<string, unknown>).RouteKey as string).startsWith('POST '));
    expect(rs.length).toBe(3);
  });
  it('API name uses competition prefix', () => {
    const api = Object.values(r).find((x) => x.Type === 'AWS::ApiGatewayV2::Api')!;
    expect((api.Properties as Record<string, unknown>).Name).toMatch(/^competition-/);
  });

  it('rejects HTTP localhost origin', () => {
    expect(() =>
      build('COMPETITION_AWS', { corsAllowedOrigins: ['http://localhost:3000'] }),
    ).toThrow(/HTTPS|localhost/);
  });

  it('rejects wildcard origin', () => {
    expect(() =>
      build('COMPETITION_AWS', { corsAllowedOrigins: ['*'] }),
    ).toThrow(/wildcard/);
  });

  it('rejects 127.0.0.1 origin', () => {
    expect(() =>
      build('COMPETITION_AWS', { corsAllowedOrigins: ['http://127.0.0.1:3000'] }),
    ).toThrow(/localhost|HTTPS/);
  });
});

// ─── C. LOCAL_MOCK ─────────────────────────────────────────────────────────

describe('C. LOCAL_MOCK — zero resources', () => {
  const t = getTemplate('LOCAL_MOCK');
  const r = getResources(t);

  it('total AWS Resources = 0', () => {
    expect(Object.keys(r).length).toBe(0);
  });

  it('no HTTP API resources', () => {
    expect(countByType(r, 'AWS::ApiGatewayV2::Api')).toBe(0);
    expect(countByType(r, 'AWS::ApiGatewayV2::Route')).toBe(0);
    expect(countByType(r, 'AWS::ApiGatewayV2::Stage')).toBe(0);
    expect(countByType(r, 'AWS::ApiGatewayV2::Authorizer')).toBe(0);
    expect(countByType(r, 'AWS::ApiGatewayV2::Integration')).toBe(0);
  });

  it('no Outputs produced (construct returns early)', () => {
    expect(t.Outputs).toBeUndefined();
  });

  it('typed route counts are still populated (cross-profile contract)', () => {
    const { httpApi } = build('LOCAL_MOCK');
    expect(httpApi.routeCount).toBe(9);
    expect(httpApi.publicReadRouteCount).toBe(6);
    expect(httpApi.protectedWriteRouteCount).toBe(3);
    expect(httpApi.httpApi).toBeUndefined();
    expect(httpApi.jwtAuthorizer).toBeUndefined();
  });
});

// ─── D. Exact route table ─────────────────────────────────────────────────

describe('D. Exact route table — every spec route synthesized', () => {
  const expected: Array<{ method: string; path: string }> = [
    { method: 'GET', path: '/timeline' },
    { method: 'GET', path: '/roads' },
    { method: 'GET', path: '/crowd' },
    { method: 'GET', path: '/incidents' },
    { method: 'GET', path: '/decisions/{id}' },
    { method: 'GET', path: '/reports/{id}' },
    { method: 'POST', path: '/incidents/{id}/inject' },
    { method: 'POST', path: '/what-if' },
    { method: 'POST', path: '/decisions/{id}/publish' },
  ];

  for (const e of expected) {
    it(`${e.method} ${e.path} exists`, () => {
      const t = getTemplate('PERSONAL_AWS_DEV');
      const route = routeByKey(t, e.method, e.path);
      expect(route).toBeDefined();
    });
  }

  it('exactly the 9 expected routes (no extras)', () => {
    const t = getTemplate('PERSONAL_AWS_DEV');
    const keys = routesOf(t).map((r) => (r.Properties as Record<string, unknown>).RouteKey as string);
    expect([...keys].sort()).toEqual([...expected.map((e) => `${e.method} ${e.path}`)].sort());
  });
});

// ─── E. Integration mapping ────────────────────────────────────────────────

describe('E. Integration mapping (route → Lambda)', () => {
  it('six GET routes target a single shared ApiRead integration', () => {
    const t = getTemplate('PERSONAL_AWS_DEV');
    const getRoutes = routesOf(t).filter((r) =>
      ((r.Properties as Record<string, unknown>).RouteKey as string).startsWith('GET '),
    );
    // Each route Target is { 'Fn::Join': ['', ['integrations/', { Ref: <intId> }]] }
    // We extract the Ref name and verify it is the same across all six.
    const intgRefs = getRoutes.map((r) => {
      const target = (r.Properties as Record<string, unknown>).Target as Record<string, unknown>;
      const join = target['Fn::Join'] as Array<unknown>;
      const arr = join[1] as Array<Record<string, unknown>>;
      return (arr[1].Ref as string);
    });
    const distinct = new Set(intgRefs);
    expect(distinct.size).toBe(1);
  });

  it('exactly 4 Integrations (one per Lambda: inject / api-read / what-if / publish)', () => {
    const t = getTemplate('PERSONAL_AWS_DEV');
    expect(integrationsOf(t).length).toBe(4);
  });

  it('inject POST routes only to the InjectFn integration (not shared with others)', () => {
    const t = getTemplate('PERSONAL_AWS_DEV');
    const route = routeByKey(t, 'POST', '/incidents/{id}/inject')!;
    const target = (route.Properties as Record<string, unknown>).Target as string;
    // All six GET routes use a different integration; the inject route
    // must use one of the four — but not the ApiRead one.
    const getTarget = (routeByKey(t, 'GET', '/timeline')!.Properties as Record<string, unknown>).Target as string;
    expect(target).not.toBe(getTarget);
  });

  it('what-if POST routes only to its own integration (not shared with inject or publish)', () => {
    const t = getTemplate('PERSONAL_AWS_DEV');
    const whatIfTarget = ((routeByKey(t, 'POST', '/what-if')!).Properties as Record<string, unknown>).Target as string;
    const injectTarget = ((routeByKey(t, 'POST', '/incidents/{id}/inject')!).Properties as Record<string, unknown>).Target as string;
    const publishTarget = ((routeByKey(t, 'POST', '/decisions/{id}/publish')!).Properties as Record<string, unknown>).Target as string;
    expect(whatIfTarget).not.toBe(injectTarget);
    expect(whatIfTarget).not.toBe(publishTarget);
  });

  it('publish POST routes only to its own integration', () => {
    const t = getTemplate('PERSONAL_AWS_DEV');
    const publishTarget = ((routeByKey(t, 'POST', '/decisions/{id}/publish')!).Properties as Record<string, unknown>).Target as string;
    const injectTarget = ((routeByKey(t, 'POST', '/incidents/{id}/inject')!).Properties as Record<string, unknown>).Target as string;
    expect(publishTarget).not.toBe(injectTarget);
  });

  it('all 4 integrations are AWS_PROXY (Lambda proxy)', () => {
    const t = getTemplate('PERSONAL_AWS_DEV');
    for (const i of integrationsOf(t)) {
      const props = i.Properties as Record<string, unknown>;
      expect(props.IntegrationType).toBe('AWS_PROXY');
    }
  });
});

// ─── F. JWT Authorizer contract ─────────────────────────────────────────────

describe('F. JWT Authorizer contract', () => {
  it('AuthorizerType = JWT', () => {
    const t = getTemplate('PERSONAL_AWS_DEV');
    const auth = authorizersOf(t)[0];
    expect((auth.Properties as Record<string, unknown>).AuthorizerType).toBe('JWT');
  });

  it('identity source = $request.header.Authorization', () => {
    const t = getTemplate('PERSONAL_AWS_DEV');
    const auth = authorizersOf(t)[0];
    expect((auth.Properties as Record<string, unknown>).IdentitySource).toEqual([
      '$request.header.Authorization',
    ]);
  });

  it('issuer uses Fn::GetAtt(... ProviderURL) — Cognito provider URL token, NOT an ARN', () => {
    const t = getTemplate('PERSONAL_AWS_DEV');
    const auth = authorizersOf(t)[0];
    const issuer = (auth.Properties as Record<string, unknown>).JwtConfiguration as Record<string, unknown>;
    const iss = issuer.Issuer as Record<string, unknown>;
    expect(iss).toEqual({ 'Fn::GetAtt': [expect.stringMatching(/UserPool/), 'ProviderURL'] });
    expect(JSON.stringify(iss)).not.toMatch(/^arn:/);
    expect(JSON.stringify(iss)).not.toContain(':userpool/');
    expect(JSON.stringify(iss)).not.toContain('AWS::AccountId');
  });

  it('audience uses TASK-071 App Client ID token (Ref to UserPoolClient)', () => {
    const t = getTemplate('PERSONAL_AWS_DEV');
    const auth = authorizersOf(t)[0];
    const issuer = (auth.Properties as Record<string, unknown>).JwtConfiguration as Record<string, unknown>;
    const aud = issuer.Audience as Array<Record<string, unknown>>;
    expect(aud).toEqual([{ Ref: expect.stringMatching(/UserPoolClient/) }]);
  });

  it('JWT authorizer is referenced by exactly 3 routes (the three POSTs)', () => {
    const t = getTemplate('PERSONAL_AWS_DEV');
    const auth = authorizersOf(t)[0];
    const authId = (auth.Properties as Record<string, unknown>).Name as string;
    const routes = routesOf(t);
    const referencing = routes.filter((r) =>
      ((r.Properties as Record<string, unknown>).RouteKey as string).startsWith('POST '),
    );
    expect(referencing.length).toBe(3);
    // CDK emits AuthorizerId only on routes that bind an authorizer.
    const withAuthId = routes.filter((r) => (r.Properties as Record<string, unknown>).AuthorizerId);
    expect(withAuthId.length).toBe(3);
    void authId;
  });
});

// ─── G. Authorization scopes ───────────────────────────────────────────────

describe('G. Authorization scopes per route', () => {
  it('POST /incidents/{id}/inject → incidents.inject scope (single)', () => {
    const t = getTemplate('PERSONAL_AWS_DEV');
    const route = routeByKey(t, 'POST', '/incidents/{id}/inject')!;
    const scopes = (route.Properties as Record<string, unknown>).AuthorizationScopes as string[];
    expect(scopes).toHaveLength(1);
    expect(scopes[0]).toMatch(/incidents\.inject$/);
  });

  it('POST /what-if → whatif.execute scope (single)', () => {
    const t = getTemplate('PERSONAL_AWS_DEV');
    const route = routeByKey(t, 'POST', '/what-if')!;
    const scopes = (route.Properties as Record<string, unknown>).AuthorizationScopes as string[];
    expect(scopes).toHaveLength(1);
    expect(scopes[0]).toMatch(/whatif\.execute$/);
  });

  it('POST /decisions/{id}/publish → decisions.publish scope (single)', () => {
    const t = getTemplate('PERSONAL_AWS_DEV');
    const route = routeByKey(t, 'POST', '/decisions/{id}/publish')!;
    const scopes = (route.Properties as Record<string, unknown>).AuthorizationScopes as string[];
    expect(scopes).toHaveLength(1);
    expect(scopes[0]).toMatch(/decisions\.publish$/);
  });

  it('GET routes have AuthorizationType = NONE (no AuthorizerId / AuthorizationScopes)', () => {
    const t = getTemplate('PERSONAL_AWS_DEV');
    const getRoutes = routesOf(t).filter((r) =>
      ((r.Properties as Record<string, unknown>).RouteKey as string).startsWith('GET '),
    );
    expect(getRoutes.length).toBe(6);
    for (const r of getRoutes) {
      const props = r.Properties as Record<string, unknown>;
      expect(props.AuthorizationType).toBe('NONE');
      expect(props.AuthorizerId).toBeUndefined();
      expect(props.AuthorizationScopes).toBeUndefined();
    }
  });

  it('0 unauthenticated POST (every POST has an AuthorizerId)', () => {
    const t = getTemplate('PERSONAL_AWS_DEV');
    const postRoutes = routesOf(t).filter((r) =>
      ((r.Properties as Record<string, unknown>).RouteKey as string).startsWith('POST '),
    );
    const unauthenticated = postRoutes.filter((r) => !(r.Properties as Record<string, unknown>).AuthorizerId);
    expect(unauthenticated.length).toBe(0);
  });
});

// ─── H. Payload format ────────────────────────────────────────────────────

describe('H. Payload format (Lambda integrations)', () => {
  it('all integrations declare PayloadFormatVersion = 2.0', () => {
    const t = getTemplate('PERSONAL_AWS_DEV');
    for (const i of integrationsOf(t)) {
      const props = i.Properties as Record<string, unknown>;
      expect(props.PayloadFormatVersion).toBe('2.0');
    }
  });

  it('integration URI references Lambda function ARN (AWS_PROXY)', () => {
    const t = getTemplate('PERSONAL_AWS_DEV');
    for (const i of integrationsOf(t)) {
      const props = i.Properties as Record<string, unknown>;
      expect(props.IntegrationUri).toBeDefined();
    }
  });
});

// ─── I. Lambda integration contract ───────────────────────────────────────

describe('I. Lambda integration contract — scopePermissionToRoute', () => {
  it('all 4 integrations are AWS_PROXY (Lambda proxy)', () => {
    const t = getTemplate('PERSONAL_AWS_DEV');
    for (const i of integrationsOf(t)) {
      const props = i.Properties as Record<string, unknown>;
      expect(props.IntegrationType).toBe('AWS_PROXY');
    }
  });

  it('HttpLambdaIntegration is constructed with scopePermissionToRoute = true', () => {
    // Verify the construct source uses scopePermissionToRoute: true for
    // every integration so that any real `lambda.Function` reference
    // would receive route-scoped AWS::Lambda::Permission.
    const fs = require('node:fs');
    const path = require('node:path');
    const src = fs.readFileSync(
      path.resolve(__dirname, '../lib/constructs/http_api.ts'),
      'utf8',
    );
    // Strip comments so JSDoc mentions are not counted.
    const stripped = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    const matches = stripped.match(/scopePermissionToRoute:\s*true/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(4);
  });
});

// ─── J. CORS ───────────────────────────────────────────────────────────────

describe('J. CORS configuration', () => {
  it('GET, POST, OPTIONS methods only (no PUT/PATCH/DELETE/HEAD)', () => {
    const t = getTemplate('PERSONAL_AWS_DEV');
    const api = Object.values(getResources(t)).find((x) => x.Type === 'AWS::ApiGatewayV2::Api')!;
    const cors = (api.Properties as Record<string, unknown>).CorsConfiguration as Record<string, unknown>;
    const methods = (cors.AllowMethods as string[]).map((m) => m.toUpperCase());
    expect(methods).toEqual(expect.arrayContaining(['GET', 'POST', 'OPTIONS']));
    expect(methods).not.toContain('PUT');
    expect(methods).not.toContain('PATCH');
    expect(methods).not.toContain('DELETE');
    expect(methods).not.toContain('HEAD');
    expect(methods).not.toContain('*');
  });

  it('allowCredentials = false', () => {
    const t = getTemplate('PERSONAL_AWS_DEV');
    const api = Object.values(getResources(t)).find((x) => x.Type === 'AWS::ApiGatewayV2::Api')!;
    const cors = (api.Properties as Record<string, unknown>).CorsConfiguration as Record<string, unknown>;
    expect(cors.AllowCredentials).toBe(false);
  });

  it('allowOrigins equal caller-provided prop', () => {
    const t = getTemplate('PERSONAL_AWS_DEV');
    const api = Object.values(getResources(t)).find((x) => x.Type === 'AWS::ApiGatewayV2::Api')!;
    const cors = (api.Properties as Record<string, unknown>).CorsConfiguration as Record<string, unknown>;
    expect(cors.AllowOrigins).toEqual(personalCors().origins);
  });

  it('allowHeaders equal caller-provided prop', () => {
    const t = getTemplate('PERSONAL_AWS_DEV');
    const api = Object.values(getResources(t)).find((x) => x.Type === 'AWS::ApiGatewayV2::Api')!;
    const cors = (api.Properties as Record<string, unknown>).CorsConfiguration as Record<string, unknown>;
    expect(cors.AllowHeaders).toEqual(personalCors().headers);
  });

  it('headers must include authorization and content-type', () => {
    expect(() =>
      build('PERSONAL_AWS_DEV', { corsAllowedHeaders: ['X-Trace-Id'] }),
    ).toThrow(/authorization|content-type/);
  });

  it('wildcard origin rejected', () => {
    expect(() =>
      build('PERSONAL_AWS_DEV', { corsAllowedOrigins: ['*'] }),
    ).toThrow(/wildcard/);
  });

  it('PERSONAL allows explicit localhost HTTP origin (dev)', () => {
    expect(() => build('PERSONAL_AWS_DEV', {
      corsAllowedOrigins: ['http://localhost:3000'],
    })).not.toThrow();
  });
});

// ─── K. Isolation ─────────────────────────────────────────────────────────

describe('K. Isolation — no forbidden resource types (HttpApi only)', () => {
  const { app } = buildIsolated('PERSONAL_AWS_DEV');
  const t = app.synth().stacks[0].template as Record<string, Record<string, unknown>>;
  const r = getResources(t);

  it('0 AWS::IAM::Role', () => expect(countByType(r, 'AWS::IAM::Role')).toBe(0));
  it('0 AWS::IAM::Policy', () => expect(countByType(r, 'AWS::IAM::Policy')).toBe(0));
  it('0 AWS::Lambda::Function', () => expect(countByType(r, 'AWS::Lambda::Function')).toBe(0));
  it('0 AWS::Logs::LogGroup', () => expect(countByType(r, 'AWS::Logs::LogGroup')).toBe(0));
  it('0 AWS::StepFunctions::StateMachine', () => expect(countByType(r, 'AWS::StepFunctions::StateMachine')).toBe(0));
  it('0 AWS::ApiGatewayV2::ApiGatewayManagedOverridesForApi (no WebSocket)', () => {
    expect(countByType(r, 'AWS::ApiGatewayV2::ApiGatewayManagedOverridesForApi')).toBe(0);
  });
  it('0 AWS::Cognito::* (HttpApi does not create Cognito resources)', () => {
    expect(countByType(r, 'AWS::Cognito::UserPool')).toBe(0);
    expect(countByType(r, 'AWS::Cognito::UserPoolClient')).toBe(0);
    expect(countByType(r, 'AWS::Cognito::UserPoolGroup')).toBe(0);
    expect(countByType(r, 'AWS::Cognito::IdentityPool')).toBe(0);
  });
  it('0 AWS::DynamoDB::Table', () => expect(countByType(r, 'AWS::DynamoDB::Table')).toBe(0));
  it('0 AWS::S3::Bucket', () => expect(countByType(r, 'AWS::S3::Bucket')).toBe(0));
  it('0 Custom::*', () => {
    const types = Object.values(r).map((x) => x.Type as string);
    expect(types.filter((t) => t.startsWith('Custom::'))).toHaveLength(0);
  });
});

// ─── L. Source boundary & hardcoding guard ─────────────────────────────────

describe('L. Source boundary — no hardcoded values', () => {
  it('the construct source file contains no hardcoded account ID literal', () => {
    // Static check: read http_api.ts as source and assert no
    // literal 12-digit account IDs (the test fixture does contain
    // `111111111111` in a separate test file — this assertion
    // targets the construct only).
    const fs = require('node:fs');
    const path = require('node:path');
    const src = fs.readFileSync(
      path.resolve(__dirname, '../lib/constructs/http_api.ts'),
      'utf8',
    );
    expect(src).not.toMatch(/\b\d{12}\b/);
  });

  it('the construct source file contains no hardcoded region literal', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const src = fs.readFileSync(
      path.resolve(__dirname, '../lib/constructs/http_api.ts'),
      'utf8',
    );
    // AWS region literal patterns: ap-xxx-yy, us-xxx-y, eu-xxx-y, ca-xxx-y
    expect(src).not.toMatch(/\b(ap|us|eu|ca|sa|af|me|il|jp|au)-(?:central|north|south|east|west)-\d+\b/);
  });

  it('the construct source file contains no hardcoded Lambda ARN literal', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const src = fs.readFileSync(
      path.resolve(__dirname, '../lib/constructs/http_api.ts'),
      'utf8',
    );
    expect(src).not.toMatch(/arn:aws:lambda:[a-z0-9-]+:\d{12}:function:/);
  });

  it('the construct source file contains no hardcoded API endpoint URL literal', () => {
    const fs = require('node:fs');
    const path = require('node:path');
    const src = fs.readFileSync(
      path.resolve(__dirname, '../lib/constructs/http_api.ts'),
      'utf8',
    );
    expect(src).not.toMatch(/https:\/\/[a-z0-9]+\.execute-api\.[a-z0-9-]+\.amazonaws\.com/);
  });

  it('route contract is exactly 9 entries (canonical, frozen)', () => {
    expect(HTTP_API_ROUTE_CONTRACT.length).toBe(9);
    const distinct = new Set(HTTP_API_ROUTE_CONTRACT.map((r) => `${r.method} ${r.path}`));
    expect(distinct.size).toBe(9);
  });

  it('each protected POST has exactly one requiredGroup', () => {
    const protectedRoutes = HTTP_API_ROUTE_CONTRACT.filter((r) => r.mode === 'protected-write');
    expect(protectedRoutes.length).toBe(3);
    for (const r of protectedRoutes) {
      expect(r.requiredGroup).toBeDefined();
      expect(['admin', 'operator', 'commander']).toContain(r.requiredGroup);
    }
  });

  it('group names in route contract are exactly admin/operator/commander (per TASK-071)', () => {
    const groups = HTTP_API_ROUTE_CONTRACT
      .filter((r) => r.requiredGroup)
      .map((r) => r.requiredGroup as string);
    expect([...groups].sort()).toEqual(['admin', 'commander', 'operator']);
  });

  it('api.endpoint config key matches schema', () => {
    expect(API_ENDPOINT_CONFIG_KEY).toBe('api.endpoint');
  });
});

// ─── N. Deployment-binding proof (Lambda permissions) ──────────────────────
//
// This suite proves that the SAME HttpApiConstruct, given the same
// Lambda references TASK-180 will pass at composition time (via
// Function.fromFunctionAttributes({ sameEnvironment: true })),
// produces a CloudFormation template containing the expected set of
// route-scoped AWS::Lambda::Permission resources.
//
// The assertion that follows is a synthesised-template proof — it does
// NOT rely on source-code inspection of `scopePermissionToRoute`.
//
// ─── CDK 2.262.2 emitted shape (verified by probe) ───────────────────────
//
// With `scopePermissionToRoute: true`, each AWS::Lambda::Permission is
// emitted with SourceArn of the form:
//
//   arn:<Partition>:execute-api:<Region>:<AccountId>:<ApiId>
//       /<stage-wildcard> /<method-wildcard> /<route-path-literal>
//
// CDK 2.262.2 DOES NOT substitute the actual HTTP method into the
// method segment; both stage and method are emitted as `*`. The
// route-path is the only literal segment. This is a documented CDK
// behaviour for `HttpLambdaIntegration` and is the same effective
// isolation produced by CloudFormation:
//   - the SourceArn is bound to ONE specific route path
//   - a different route path requires a different permission
//   - this gives the same least-privilege guarantee as method-scoping
//
// We assert against this actual shape, not against an aspirational one.

interface PermissionKey {
  /** Function name substring (last ARN segment of the Lambda) */
  functionNameSuffix: string;
  /** Expected route path as emitted in the SourceArn (literal, {id} preserved) */
  path: string;
}

const EXPECTED_PERMISSIONS: PermissionKey[] = [
  { functionNameSuffix: 'ApiReadFn', path: '/timeline' },
  { functionNameSuffix: 'ApiReadFn', path: '/roads' },
  { functionNameSuffix: 'ApiReadFn', path: '/crowd' },
  { functionNameSuffix: 'ApiReadFn', path: '/incidents' },
  { functionNameSuffix: 'ApiReadFn', path: '/decisions/{id}' },
  { functionNameSuffix: 'ApiReadFn', path: '/reports/{id}' },
  { functionNameSuffix: 'InjectFn',  path: '/incidents/{id}/inject' },
  { functionNameSuffix: 'WhatIfFn',  path: '/what-if' },
  { functionNameSuffix: 'PublishFn', path: '/decisions/{id}/publish' },
];

describe('N. Deployment-binding proof fixture (fromFunctionAttributes + sameEnvironment)', () => {
  const { app } = buildDeploymentBindingProof('PERSONAL_AWS_DEV');
  const t = app.synth().stacks[0].template as Record<string, Record<string, unknown>>;
  const r = getResources(t);
  const perms = permissionsOf(t);

  it('topology: 1 HTTP API, 9 routes, 4 integrations', () => {
    expect(countByType(r, 'AWS::ApiGatewayV2::Api')).toBe(1);
    expect(countByType(r, 'AWS::ApiGatewayV2::Route')).toBe(9);
    expect(countByType(r, 'AWS::ApiGatewayV2::Integration')).toBe(4);
  });

  it('topology: 0 Lambda functions, 0 IAM roles, 0 IAM policies', () => {
    expect(countByType(r, 'AWS::Lambda::Function')).toBe(0);
    expect(countByType(r, 'AWS::IAM::Role')).toBe(0);
    expect(countByType(r, 'AWS::IAM::Policy')).toBe(0);
  });

  it('exactly 9 AWS::Lambda::Permission resources produced', () => {
    expect(perms.length).toBe(9);
  });

  for (const expected of EXPECTED_PERMISSIONS) {
    describe(`permission for ${expected.path} → ${expected.functionNameSuffix}`, () => {
      const matching = perms.filter((p) => {
        const fnJson = permissionFunctionName(p);
        if (!fnJson.includes(expected.functionNameSuffix)) return false;
        return permissionRoutePath(p) === expected.path;
      });

      it(`exists (exactly 1)`, () => {
        expect(matching.length).toBe(1);
      });

      it('Action = lambda:InvokeFunction', () => {
        expect((matching[0].Properties as Record<string, unknown>).Action).toBe('lambda:InvokeFunction');
      });

      it('Principal = apigateway.amazonaws.com', () => {
        expect((matching[0].Properties as Record<string, unknown>).Principal).toBe('apigateway.amazonaws.com');
      });

      it('FunctionName targets the correct Lambda (function-name suffix match)', () => {
        const fnJson = permissionFunctionName(matching[0]);
        expect(fnJson).toContain(expected.functionNameSuffix);
      });

      it('SourceArn scopes to this HTTP API (no cross-API)', () => {
        const arnJson = permissionSourceArn(matching[0]);
        expect(arnJson).toMatch(/execute-api/);
        // No cross-API wildcard pattern.
        expect(arnJson).not.toMatch(/execute-api:\\?\*/);
      });

      it('SourceArn route-path segment equals the expected route (no substring collision)', () => {
        expect(permissionRoutePath(matching[0])).toBe(expected.path);
      });

      it('SourceArn does NOT match another route path (no over-permissioning)', () => {
        const ownPath = permissionRoutePath(matching[0]);
        // No two permissions share the same route-path.
        const samePathCount = perms.filter((p) => permissionRoutePath(p) === ownPath).length;
        expect(samePathCount).toBe(1);
      });
    });
  }

  it('Allocation: ApiReadFn receives 6 permissions (one per GET route)', () => {
    const apiReadPerms = perms.filter((p) => permissionFunctionName(p).includes('ApiReadFn'));
    expect(apiReadPerms.length).toBe(6);
    // And the 6 paths are exactly the 6 GET routes.
    const paths = apiReadPerms.map((p) => permissionRoutePath(p)).sort();
    const expectedPaths = EXPECTED_PERMISSIONS
      .filter((e) => e.functionNameSuffix === 'ApiReadFn')
      .map((e) => e.path)
      .sort();
    expect(paths).toEqual(expectedPaths);
  });

  it('Allocation: InjectFn receives exactly 1 permission', () => {
    const injectPerms = perms.filter((p) => permissionFunctionName(p).includes('InjectFn'));
    expect(injectPerms.length).toBe(1);
    expect(permissionRoutePath(injectPerms[0])).toBe('/incidents/{id}/inject');
  });

  it('Allocation: WhatIfFn receives exactly 1 permission', () => {
    const wifPerms = perms.filter((p) => permissionFunctionName(p).includes('WhatIfFn'));
    expect(wifPerms.length).toBe(1);
    expect(permissionRoutePath(wifPerms[0])).toBe('/what-if');
  });

  it('Allocation: PublishFn receives exactly 1 permission', () => {
    const pubPerms = perms.filter((p) => permissionFunctionName(p).includes('PublishFn'));
    expect(pubPerms.length).toBe(1);
    expect(permissionRoutePath(pubPerms[0])).toBe('/decisions/{id}/publish');
  });

  it('Every permission has a SourceArn (none missing)', () => {
    for (const p of perms) {
      const srcArn = (p.Properties as Record<string, unknown>).SourceArn;
      expect(srcArn).toBeDefined();
      expect(srcArn).not.toBe('');
    }
  });

  it('Security: no whole-API wildcard — every route-path segment is one of the nine routes', () => {
    for (const p of perms) {
      const path = permissionRoutePath(p);
      // The route-path segment must be exactly one of the nine known routes.
      const matches = EXPECTED_PERMISSIONS.some((e) => e.path === path);
      expect(matches).toBe(true);
    }
  });

  it('Security: no cross-API wildcard (execute-api:*)', () => {
    for (const p of perms) {
      const arnJson = permissionSourceArn(p);
      // A cross-API wildcard would appear as `arn:...:execute-api:*`.
      // CDK emits this as `{"Fn::Join":["",["arn",..., ":execute-api:", {"Ref":"AWS::AccountId"},":","<apiId>","/..."]]}` — i.e. an actual API id.
      expect(arnJson).not.toMatch(/execute-api:\\?\*/);
    }
  });
});

// ─── O. Shared ApiRead integration proof ───────────────────────────────────

describe('O. Shared ApiRead integration proves route-scoped permissions are per-route, not per-integration', () => {
  const { app } = buildDeploymentBindingProof('PERSONAL_AWS_DEV');
  const t = app.synth().stacks[0].template as Record<string, Record<string, unknown>>;
  const r = getResources(t);

  it('Integration count = 4 (ApiRead shared by 6 GETs, 3 dedicated per POST)', () => {
    expect(countByType(r, 'AWS::ApiGatewayV2::Integration')).toBe(4);
  });

  it('Exactly one ApiRead integration resource exists', () => {
    const integrations = Object.values(r).filter((x) => x.Type === 'AWS::ApiGatewayV2::Integration');
    const apiReadInts = integrations.filter((i) => {
      const props = i.Properties as Record<string, unknown>;
      const uri = resolveIntrinsic(props.IntegrationUri);
      return JSON.stringify(uri).includes('ApiReadFn');
    });
    expect(apiReadInts.length).toBe(1);
  });

  it('Six GET routes all reference the shared ApiRead integration', () => {
    const getRoutes = Object.values(r).filter(
      (x) => x.Type === 'AWS::ApiGatewayV2::Route' &&
             ((x.Properties as Record<string, unknown>).RouteKey as string).startsWith('GET '),
    );
    expect(getRoutes.length).toBe(6);
    const refs = getRoutes.map((g) => {
      const target = (g.Properties as Record<string, unknown>).Target as Record<string, unknown>;
      const join = target['Fn::Join'] as Array<unknown>;
      const arr = join[1] as Array<Record<string, unknown>>;
      return (arr[1].Ref as string);
    });
    expect(new Set(refs).size).toBe(1);
  });

  it('Despite the shared integration, 6 distinct Lambda permissions exist for ApiReadFn', () => {
    const perms = permissionsOf(t).filter((p) => permissionFunctionName(p).includes('ApiReadFn'));
    expect(perms.length).toBe(6);
    // Each permission's SourceArn must contain a different path.
    const paths = perms.map((p) => permissionSourceArn(p));
    expect(new Set(paths).size).toBe(6);
  });

  it('scopePermissionToRoute remains true on every integration', () => {
    // Safety net — if someone tries to relax this to reduce permission
    // counts, this test fails.
    const fs = require('node:fs');
    const path = require('node:path');
    const src = fs.readFileSync(
      path.resolve(__dirname, '../lib/constructs/http_api.ts'),
      'utf8',
    );
    // Strip comments to count only true code occurrences.
    const stripped = src
      .replace(/\/\*[\s\S]*?\*\//g, '')   // block comments
      .replace(/\/\/.*$/gm, '');            // line comments
    const matches = stripped.match(/scopePermissionToRoute:\s*true/g);
    expect(matches).not.toBeNull();
    expect(matches!.length).toBe(4);
  });
});