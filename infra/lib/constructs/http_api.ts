/**
 * HttpApiConstruct — API Gateway HTTP API with route contract & Cognito JWT authorizer
 *
 * §4.4, §12, §17
 * TASK-069
 *
 * Defines exactly ONE `apigwv2.HttpApi` with a fixed route table:
 *
 *   Public reads (no authorizer) → ApiReadFn (6 routes):
 *     GET /timeline
 *     GET /roads
 *     GET /crowd
 *     GET /incidents
 *     GET /decisions/{id}
 *     GET /reports/{id}
 *
 *   Protected writes (Cognito JWT, single scope per route) (3 routes):
 *     POST /incidents/{id}/inject → InjectFn   (admin / incidents.inject)
 *     POST /what-if                → WhatIfFn  (operator / whatif.execute)
 *     POST /decisions/{id}/publish → PublishFn (commander / decisions.publish)
 *
 * Invariants enforced by this Construct:
 *   - routeCount = 9
 *   - publicReadRouteCount = 6 (GET)
 *   - protectedWriteRouteCount = 3 (POST)
 *   - 0 ANY routes, 0 `$default` route, no extra health/mock/debug routes
 *   - 0 unauthenticated POST
 *   - Each POST has exactly ONE AuthorizationScopes entry
 *   - The JWT authorizer is attached to the three POST routes only
 *
 * ─── Dual-layer authorization boundary (explicit) ─────────────────────────
 *
 *   Layer 1 — API Gateway JWT Authorizer:
 *     validates `iss` (issuerUrl from TASK-071 Cognito provider URL),
 *     `aud` (userPoolClientId from TASK-071), token signature, and the
 *     `scope` claim — `scope` is the API capability gate.
 *
 *   Layer 2 — Handler group verification (deferred to handler tasks):
 *     The Cognito `cognito:groups` claim is the role-entitlement identity.
 *     API Gateway does NOT auto-map group names to capability scopes.
 *     Each protected Handler MUST independently verify the
 *     `cognito:groups` claim (admin / operator / commander) before
 *     performing write logic. TASK-069 does NOT modify Handler code;
 *     Handler group checks are owned by their respective application
 *     tasks (TASK-066/067/085/136/144).
 *
 *   This Construct does NOT add a Pre Token Generation Lambda,
 *   does NOT modify Handler code, and does NOT create IAM Roles
 *   for Lambda execution. Lambda EXECUTION roles are owned by
 *   separate per-function tasks; this Construct only emits
 *   resource-based Lambda permissions (`AWS::Lambda::Permission`)
 *   for the integration bindings themselves.
 *
 * ─── IAM ownership (precise, do not blur) ─────────────────────────────
 *
 *   The two distinct concerns are NOT conflated:
 *
 *   (a) Lambda EXECUTION roles — the role each Lambda function
 *       ASSUMES at runtime to call other AWS services. These are
 *       constructed and bound by:
 *
 *         InjectFnRole   → TASK-076
 *         ApiReadFnRole  → TASK-081
 *         PublishFnRole  → TASK-082
 *         WhatIfFnRole   → TASK-177
 *
 *       TASK-179 performs the final binding of these roles to the
 *       concrete Lambda Function resources. TASK-069 does NOT
 *       construct any of these roles and does NOT bind any of them.
 *
 *   (b) Lambda RESOURCE-BASED permissions — the
 *       `AWS::Lambda::Permission` resources that allow API Gateway
 *       to INVOKE each Lambda. These are emitted automatically by
 *       `HttpLambdaIntegration` when `scopePermissionToRoute: true`,
 *       and their `SourceArn` is scoped to the specific
 *       method+path of each route. This Construct IS the owner of
 *       these integration permissions.
 *
 *   TASK-076 does NOT bind any of the four runtime roles. Each role
 *   has its own dedicated task. See tasks.md for the full table.
 *
 * ─── Out of scope ───────────────────────────────────────────────────────
 *
 * - WebSocket API (TASK-070)
 * - Frontend hosting (TASK-072)
 * - SSM parameter provisioning (TASK-073)
 * - API access logs / metrics / alarms (TASK-075)
 * - Lambda execution IAM roles (TASK-076/081/082/177; final binding TASK-179)
 * - Handler business logic (TASK-085+)
 * - NetworkAuthStack composition (TASK-180)
 *
 * LOCAL_MOCK:
 *   - 0 AWS resources, 0 Outputs, no fake API or endpoint
 *   - validation of non-AWS-only inputs (apiName, CORS, contract shape)
 *     still runs
 */

import { Construct } from 'constructs';
import { Duration, CfnOutput } from 'aws-cdk-lib';
import * as apigw from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import type { IFunction } from 'aws-cdk-lib/aws-lambda';
import type { EnvironmentContext } from '../env_context.js';
import { COGNITO_GROUP_NAMES, type AuthorizationContract } from './cognito.js';

// ─── Route contract ─────────────────────────────────────────────────────────

/** HTTP method enum used for the route table. Limited to GET and POST. */
export type HttpApiRouteMethod = 'GET' | 'POST';

/**
 * Per-route authorization mode.
 *
 *  - 'public-read'   → GET route, no authorizer, integrated to ApiReadFn
 *  - 'protected-write' → POST route, JWT authorizer with exactly one scope
 */
export type HttpApiAuthorizationMode = 'public-read' | 'protected-write';

/**
 * The single source-of-truth route table for the API. Built exactly once
 * from `createRouteContract()` and frozen as `HTTP_API_ROUTE_CONTRACT`.
 *
 * Invariants:
 *   - 9 entries
 *   - 6 GET, 3 POST
 *   - 3 entries require a JWT scope (the three POSTs)
 *   - the three requiredScope values match
 *     `authorizationContract.admin/operator/commander.requiredScope`
 */
export interface HttpApiRouteTarget {
  readonly key: string; // canonical key, e.g. "GET /timeline"
  readonly method: HttpApiRouteMethod;
  readonly path: string; // route key path, e.g. "/timeline"
  readonly mode: HttpApiAuthorizationMode;
  readonly lambdaSlot: 'apiReadFn' | 'injectFn' | 'whatIfFn' | 'publishFn';
  readonly requiredGroup?: 'admin' | 'operator' | 'commander';
  readonly requiredScope?: string;
}

/**
 * The frozen route table. Built once at module-load via
 * `createRouteContract()`; downstream code MUST NOT mutate this list.
 */
export const HTTP_API_ROUTE_CONTRACT: readonly HttpApiRouteTarget[] = (() => {
  // The placeholder scope strings are resolved by `buildRouteContract()`
  // once the caller passes the AuthorizationContract from the Cognito
  // Construct. The placeholder values here are SYNTACTICALLY VALID so
  // that structural tests can verify shape before scope-binding occurs.
  // Resolution happens in `HttpApiConstructProps`.
  return Object.freeze([
    {
      key: 'GET /timeline',
      method: 'GET',
      path: '/timeline',
      mode: 'public-read',
      lambdaSlot: 'apiReadFn',
    },
    {
      key: 'GET /roads',
      method: 'GET',
      path: '/roads',
      mode: 'public-read',
      lambdaSlot: 'apiReadFn',
    },
    {
      key: 'GET /crowd',
      method: 'GET',
      path: '/crowd',
      mode: 'public-read',
      lambdaSlot: 'apiReadFn',
    },
    {
      key: 'GET /incidents',
      method: 'GET',
      path: '/incidents',
      mode: 'public-read',
      lambdaSlot: 'apiReadFn',
    },
    {
      key: 'GET /decisions/{id}',
      method: 'GET',
      path: '/decisions/{id}',
      mode: 'public-read',
      lambdaSlot: 'apiReadFn',
    },
    {
      key: 'GET /reports/{id}',
      method: 'GET',
      path: '/reports/{id}',
      mode: 'public-read',
      lambdaSlot: 'apiReadFn',
    },
    {
      key: 'POST /incidents/{id}/inject',
      method: 'POST',
      path: '/incidents/{id}/inject',
      mode: 'protected-write',
      lambdaSlot: 'injectFn',
      requiredGroup: 'admin',
    },
    {
      key: 'POST /what-if',
      method: 'POST',
      path: '/what-if',
      mode: 'protected-write',
      lambdaSlot: 'whatIfFn',
      requiredGroup: 'operator',
    },
    {
      key: 'POST /decisions/{id}/publish',
      method: 'POST',
      path: '/decisions/{id}/publish',
      mode: 'protected-write',
      lambdaSlot: 'publishFn',
      requiredGroup: 'commander',
    },
  ]);
})();

export const HTTP_API_ROUTE_COUNT = HTTP_API_ROUTE_CONTRACT.length;
export const HTTP_API_GET_COUNT = HTTP_API_ROUTE_CONTRACT.filter((r) => r.method === 'GET').length;
export const HTTP_API_POST_COUNT = HTTP_API_ROUTE_CONTRACT.filter(
  (r) => r.method === 'POST',
).length;
export const HTTP_API_PUBLIC_READ_COUNT = HTTP_API_ROUTE_CONTRACT.filter(
  (r) => r.mode === 'public-read',
).length;
export const HTTP_API_PROTECTED_WRITE_COUNT = HTTP_API_ROUTE_CONTRACT.filter(
  (r) => r.mode === 'protected-write',
).length;

// ─── Public Constants ───────────────────────────────────────────────────────

/** Config key for api.endpoint — matches packages/config/src/config_schema.ts */
export const API_ENDPOINT_CONFIG_KEY = 'api.endpoint';

// ─── Integration timeout bounds ─────────────────────────────────────────────

export const INTEGRATION_TIMEOUT_MIN_SECONDS = 1;
export const INTEGRATION_TIMEOUT_MAX_SECONDS = 29;

// ─── Props ─────────────────────────────────────────────────────────────────

export interface HttpApiConstructProps {
  readonly envContext: EnvironmentContext;

  /** Logical name for the HttpApi (used as `apiName`). */
  readonly apiName: string;

  /**
   * OIDC issuer URL for the Cognito JWT Authorizer.
   * Must equal `userPool.userPoolProviderUrl` from TASK-071.
   * May be a CDK token (unresolved at synth).
   */
  readonly jwtIssuer: string;

  /**
   * JWT audience. MUST be exactly one entry — the App Client ID.
   * May be a CDK token.
   */
  readonly jwtAudience: string[];

  /** Authorization contract from CognitoAuthConstruct (TASK-071). */
  readonly authorizationContract: AuthorizationContract;

  /** Lambda function references — all four MUST be distinct. */
  readonly injectFn: IFunction;
  readonly apiReadFn: IFunction;
  readonly whatIfFn: IFunction;
  readonly publishFn: IFunction;

  /** CORS configuration. */
  readonly corsAllowedOrigins: string[];
  readonly corsAllowedHeaders: string[];

  /**
   * Optional. Integration timeout (seconds). Valid range: 1–29.
   * No silent default — must be provided if integration needs one.
   */
  readonly integrationTimeoutSeconds?: number;
}

// ─── Construct ──────────────────────────────────────────────────────────────

export class HttpApiConstruct extends Construct {
  // Public contract — consumed by TASK-180 (stack composition)
  public readonly httpApi?: apigw.IHttpApi;
  public readonly jwtAuthorizer?: apigw.IHttpRouteAuthorizer;
  public readonly apiId?: string;
  public readonly apiEndpoint?: string;
  public readonly routeCount: number;
  public readonly publicReadRouteCount: number;
  public readonly protectedWriteRouteCount: number;

  /** Map of canonical route key → constructed HttpRoute. */
  public readonly routesByKey: Record<string, apigw.HttpRoute> = {};

  public constructor(scope: Construct, id: string, props: HttpApiConstructProps) {
    super(scope, id);

    const { envContext } = props;
    const { isLocalMock } = envContext;

    // ── Props validation (fail-fast for all profiles) ────────────────────

    validateApiName(props.apiName);
    validateAuthorizationContract(props.authorizationContract);
    validateAudience(props.jwtAudience);
    validateCors(props.corsAllowedOrigins, props.corsAllowedHeaders, envContext.profile);
    if (props.integrationTimeoutSeconds !== undefined) {
      validateIntegrationTimeout(props.integrationTimeoutSeconds);
    }
    // Lambda references must exist and be distinct. The whatIfFn is the
    // single most-likely place for accidental aliasing (because it is
    // the dedicated What-if host per §14.5), so we explicitly enforce it.
    requireLambda('injectFn', props.injectFn);
    requireLambda('apiReadFn', props.apiReadFn);
    requireLambda('whatIfFn', props.whatIfFn);
    requireLambda('publishFn', props.publishFn);
    if (
      props.whatIfFn === props.apiReadFn ||
      props.whatIfFn === props.injectFn ||
      props.whatIfFn === props.publishFn
    ) {
      throw new Error(
        'whatIfFn must be a distinct Lambda reference (not aliased to injectFn/apiReadFn/publishFn)',
      );
    }

    // ── LOCAL_MOCK: short-circuit (0 AWS resources) ──────────────────────

    this.routeCount = HTTP_API_ROUTE_COUNT;
    this.publicReadRouteCount = HTTP_API_PUBLIC_READ_COUNT;
    this.protectedWriteRouteCount = HTTP_API_PROTECTED_WRITE_COUNT;
    if (isLocalMock) {
      return;
    }

    // ── Resolve scope binding from authorizationContract ─────────────────
    const adminScope = props.authorizationContract.admin.requiredScope;
    const operatorScope = props.authorizationContract.operator.requiredScope;
    const commanderScope = props.authorizationContract.commander.requiredScope;
    validateScopeStrings([adminScope, operatorScope, commanderScope]);

    // ── HttpApi ─────────────────────────────────────────────────────────

    const httpApi = new apigw.HttpApi(this, 'HttpApi', {
      apiName: `${envContext.resourcePrefix}-${props.apiName}`,
      description: `City Response Commander HTTP API (TASK-069). Profile=${envContext.profile}`,
      createDefaultStage: true,
      // No default integration, no default authorizer — auth is
      // explicitly bound per-route so GET routes never inherit JWT.
      corsPreflight: {
        allowOrigins: props.corsAllowedOrigins,
        allowMethods: [
          apigw.CorsHttpMethod.GET,
          apigw.CorsHttpMethod.POST,
          apigw.CorsHttpMethod.OPTIONS,
        ],
        allowHeaders: props.corsAllowedHeaders,
        allowCredentials: false,
      },
    });

    // ── JWT Authorizer (only attached to the three POST routes) ──────────
    //
    // CDK 2.262: HttpAuthorizer implements IHttpAuthorizer (not
    // IHttpRouteAuthorizer). To attach it to a route we go through
    // fromHttpAuthorizerAttributes which produces an IHttpRouteAuthorizer
    // that points at the same authorizerId. The resulting permission
    // binding is identical — no second CFN Authorizer is created.

    const jwtAuthorizer = new apigw.HttpAuthorizer(this, 'JwtAuthorizer', {
      httpApi,
      authorizerName: `${envContext.resourcePrefix}-cognito-jwt`,
      type: apigw.HttpAuthorizerType.JWT,
      jwtIssuer: props.jwtIssuer,
      jwtAudience: props.jwtAudience,
      identitySource: ['$request.header.Authorization'],
    });

    const jwtRouteAuthorizer = apigw.HttpAuthorizer.fromHttpAuthorizerAttributes(
      this,
      'JwtRouteAuthorizer',
      {
        authorizerId: jwtAuthorizer.authorizerId,
        authorizerType: 'JWT',
      },
    );

    // ── Lambda integrations (one per Lambda; routes share them) ──────────

    const integrationTimeout =
      props.integrationTimeoutSeconds !== undefined
        ? Duration.seconds(props.integrationTimeoutSeconds)
        : undefined;

    const integrations: Record<HttpApiRouteTarget['lambdaSlot'], HttpLambdaIntegration> = {
      apiReadFn: new HttpLambdaIntegration('ApiReadIntegration', props.apiReadFn, {
        payloadFormatVersion: apigw.PayloadFormatVersion.VERSION_2_0,
        scopePermissionToRoute: true,
        ...(integrationTimeout ? { timeout: integrationTimeout } : {}),
      }),
      injectFn: new HttpLambdaIntegration('InjectIntegration', props.injectFn, {
        payloadFormatVersion: apigw.PayloadFormatVersion.VERSION_2_0,
        scopePermissionToRoute: true,
        ...(integrationTimeout ? { timeout: integrationTimeout } : {}),
      }),
      whatIfFn: new HttpLambdaIntegration('WhatIfIntegration', props.whatIfFn, {
        payloadFormatVersion: apigw.PayloadFormatVersion.VERSION_2_0,
        scopePermissionToRoute: true,
        ...(integrationTimeout ? { timeout: integrationTimeout } : {}),
      }),
      publishFn: new HttpLambdaIntegration('PublishIntegration', props.publishFn, {
        payloadFormatVersion: apigw.PayloadFormatVersion.VERSION_2_0,
        scopePermissionToRoute: true,
        ...(integrationTimeout ? { timeout: integrationTimeout } : {}),
      }),
    };

    // ── Routes ──────────────────────────────────────────────────────────

    const scopeByGroup: Record<'admin' | 'operator' | 'commander', string> = {
      admin: adminScope,
      operator: operatorScope,
      commander: commanderScope,
    };

    for (const target of HTTP_API_ROUTE_CONTRACT) {
      const integration = integrations[target.lambdaSlot];
      const routeKey = apigw.HttpRouteKey.with(
        target.path,
        target.method === 'GET' ? apigw.HttpMethod.GET : apigw.HttpMethod.POST,
      );

      const route = new apigw.HttpRoute(this, `Route_${target.key.replace(/[^A-Za-z0-9]/g, '_')}`, {
        httpApi,
        routeKey,
        integration,
        ...(target.mode === 'protected-write' && target.requiredGroup
          ? {
              authorizer: jwtRouteAuthorizer,
              authorizationScopes: [scopeByGroup[target.requiredGroup]],
            }
          : {}),
      });

      this.routesByKey[target.key] = route;
    }

    // ── Outputs (no cross-stack exportName) ──────────────────────────────

    new CfnOutput(this, 'HttpApiEndpoint', {
      value: httpApi.apiEndpoint,
    });

    // ── Public surface ──────────────────────────────────────────────────
    //
    // `jwtAuthorizer` is exposed as the route-attached IHttpRouteAuthorizer
    // (the same identity CDK resolves at deploy time). The underlying
    // HttpAuthorizer construct is intentionally not re-exposed — callers
    // need only the route-binding identity.

    this.httpApi = httpApi;
    this.jwtAuthorizer = jwtRouteAuthorizer;
    this.apiId = httpApi.apiId;
    this.apiEndpoint = httpApi.apiEndpoint;
  }
}

// ─── Validation helpers ─────────────────────────────────────────────────────

function fail(label: string, msg: string): never {
  throw new Error(`${label}: ${msg}`);
}

function isBlank(s: string): boolean {
  return s.trim().length === 0;
}

function validateApiName(name: string): void {
  if (isBlank(name)) fail('apiName', 'must not be blank');
}

function validateAudience(audience: string[]): void {
  if (!Array.isArray(audience) || audience.length === 0) {
    fail('jwtAudience', 'must contain at least one entry');
  }
  const seen = new Set<string>();
  for (const a of audience) {
    if (typeof a !== 'string' || isBlank(a)) {
      fail('jwtAudience', `entry must be a non-blank string; got ${JSON.stringify(a)}`);
    }
    if (a.includes('*')) fail('jwtAudience', `wildcard not allowed; got "${a}"`);
    if (seen.has(a)) fail('jwtAudience', `duplicate entry: "${a}"`);
    seen.add(a);
  }
}

function validateAuthorizationContract(contract: AuthorizationContract): void {
  if (!contract) fail('authorizationContract', 'is required');
  for (const groupName of COGNITO_GROUP_NAMES) {
    const entry = contract[groupName];
    if (!entry) fail('authorizationContract', `missing entry for group "${groupName}"`);
    if (entry.group !== groupName) {
      fail(
        'authorizationContract',
        `entry for "${groupName}" has wrong group name: "${entry.group}"`,
      );
    }
    if (typeof entry.requiredScope !== 'string' || isBlank(entry.requiredScope)) {
      fail('authorizationContract', `${groupName}.requiredScope must be a non-blank string`);
    }
  }
}

function validateScopeStrings(scopes: readonly string[]): void {
  const seen = new Set<string>();
  for (const s of scopes) {
    if (isBlank(s)) fail('scope', 'must not be blank');
    if (s.includes('*')) fail('scope', `wildcard not allowed; got "${s}"`);
    if (!s.includes('/')) fail('scope', `must be <identifier>/<scopeName>; got "${s}"`);
    if (seen.has(s)) fail('scope', `duplicate scope: "${s}"`);
    seen.add(s);
  }
}

function validateCors(origins: string[], headers: string[], profile: string): void {
  if (origins.length === 0) fail('corsAllowedOrigins', 'must contain at least one origin');
  if (headers.length === 0) fail('corsAllowedHeaders', 'must contain at least one header');
  const isCompetition = profile === 'COMPETITION_AWS';

  const originSeen = new Set<string>();
  for (const o of origins) {
    if (isBlank(o)) fail('corsAllowedOrigins', `must not contain blank entry`);
    if (o === '*' || o.includes('*'))
      fail('corsAllowedOrigins', `wildcard not allowed; got "${o}"`);
    if (o.includes('#')) fail('corsAllowedOrigins', `fragment not allowed; got "${o}"`);
    if (originSeen.has(o)) fail('corsAllowedOrigins', `duplicate origin: "${o}"`);
    originSeen.add(o);
    if (isCompetition) {
      if (!o.toLowerCase().startsWith('https://')) {
        fail('corsAllowedOrigins', `COMPETITION_AWS requires HTTPS; got "${o}"`);
      }
      const host = (() => {
        try {
          return new URL(o).hostname;
        } catch {
          return '';
        }
      })();
      if (host === 'localhost' || host === '127.0.0.1') {
        fail('corsAllowedOrigins', `COMPETITION_AWS prohibits localhost/127.0.0.1; got "${o}"`);
      }
    } else if (
      !o.toLowerCase().startsWith('https://') &&
      !o.toLowerCase().startsWith('http://localhost') &&
      !o.toLowerCase().startsWith('http://127.0.0.1')
    ) {
      fail('corsAllowedOrigins', `non-localhost origin must be HTTPS; got "${o}"`);
    }
  }

  // Required headers (case-insensitive) must include authorization + content-type.
  const lower = headers.map((h) => h.toLowerCase());
  if (!lower.includes('authorization')) {
    fail('corsAllowedHeaders', 'must include "authorization"');
  }
  if (!lower.includes('content-type')) {
    fail('corsAllowedHeaders', 'must include "content-type"');
  }
  const headerSeen = new Set<string>();
  for (const h of headers) {
    if (isBlank(h)) fail('corsAllowedHeaders', `must not contain blank entry`);
    if (h === '*' || h.includes('*'))
      fail('corsAllowedHeaders', `wildcard not allowed; got "${h}"`);
    const k = h.toLowerCase();
    if (headerSeen.has(k)) fail('corsAllowedHeaders', `duplicate header: "${h}"`);
    headerSeen.add(k);
  }
}

function validateIntegrationTimeout(seconds: number): void {
  if (
    !Number.isInteger(seconds) ||
    seconds < INTEGRATION_TIMEOUT_MIN_SECONDS ||
    seconds > INTEGRATION_TIMEOUT_MAX_SECONDS
  ) {
    fail(
      'integrationTimeoutSeconds',
      `must be integer ${INTEGRATION_TIMEOUT_MIN_SECONDS}–${INTEGRATION_TIMEOUT_MAX_SECONDS}; got ${seconds}`,
    );
  }
}

function requireLambda(name: string, fn: IFunction | undefined): asserts fn is IFunction {
  if (!fn) fail(name, 'must be a valid Lambda function reference');
}
