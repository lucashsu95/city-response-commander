/**
 * CognitoAuthConstruct — Cognito User Pool, App Client, Groups & Capability Scopes
 *
 * §4.10
 * TASK-071
 *
 * Defines:
 *   - One Cognito User Pool (admin-created users only, self-sign-up disabled)
 *   - One public SPA OAuth 2.0 authorization-code App Client
 *   - One Cognito User Pool Domain (enables authorization-code flow)
 *   - Three User Pool Groups: admin / operator / commander
 *   - One Cognito Resource Server with three custom capability scopes:
 *       incidents.inject | whatif.execute | decisions.publish
 *
 * ─── Public identity tokens ───────────────────────────────────────────────
 *
 * This Construct exposes TWO different identities that MUST NOT be
 * confused by downstream consumers:
 *
 *   1. `userPool.userPoolArn`  — the AWS resource ARN, e.g.
 *        arn:${Partition}:cognito-idp:${Region}:${Account}:userpool/${Id}
 *      This is the IAM / CloudFormation identity. Not a JWT issuer.
 *
 *   2. `construct.issuerUrl` (= `userPool.userPoolProviderUrl`) — the
 *      OIDC provider URL, e.g.
 *        https://cognito-idp.<region>.<urlSuffix>/<userPoolId>
 *      This is the value Cognito emits as the `iss` claim on access
 *      tokens. TASK-069's HTTP API JWT Authorizer MUST be configured
 *      with this value as the `issuer`. An ARN is not a valid JWT
 *      issuer; using one would cause every request to fail.
 *
 *   Cognito Hosted UI domain, callback URL, logout URL, and Resource
 *   Server identifier are also NOT JWT issuers.
 *
 * ─── Authorization contract ─────────────────────────────────────────────────
 *
 * This Construct defines the raw Cognito primitives. The dual-layer
 * authorization boundary between Cognito and the API routes is:
 *
 *   Layer 1 — Scope gate (TASK-069 API Gateway JWT authorizer):
 *     cognito:groups claim  ≠  access token scope claim
 *     cognito:groups claim  → role entitlement (e.g. "admin")
 *     access token scope    → API capability gate (e.g. "incidents.inject")
 *     Group membership does NOT automatically grant the matching scope.
 *
 *   Layer 2 — Handler group verification (TASK-069 handlers):
 *     Each protected handler MUST independently verify the cognito:groups
 *     claim before executing write logic. The scope gate alone is not
 *     sufficient — TASK-069's handler-level check is required.
 *
 *   This Construct does NOT create a Pre-Token Generation Lambda,
 *   does NOT create an eleventh application Lambda, and does NOT wire
 *   the API Gateway authorizer. Those are deferred to TASK-069 / TASK-180.
 *
 * ─── Out of scope ─────────────────────────────────────────────────────────
 *
 * - No Identity Pool
 * - No IAM Role attachment to groups
 * - No Lambda trigger
 * - No Custom Resource
 * - No API Gateway
 * - No User Pool Trigger Lambda
 * - No hard-coded account/region/ARN/credentials
 * - No secrets or client credentials
 *
 * LOCAL_MOCK:
 *   - 0 AWS resources (no Cognito, no IAM, no Lambda)
 *   - props validation still runs so every profile sees the same errors
 *
 * PERSONAL_AWS_DEV / COMPETITION_AWS:
 *   - Identical architecture; only name, removal policy, and URL-validation
 *     strictness differ.
 */

import { Construct } from 'constructs';
import { CfnOutput, RemovalPolicy, Duration } from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import type { EnvironmentContext } from '../env_context.js';

// ─── Constants ──────────────────────────────────────────────────────────────

/**
 * Canonical group names. These appear as `cognito:groups` JWT claims.
 * They are the role-entitlement identity, NOT the API capability gates.
 */
export const COGNITO_GROUP_NAMES = ['admin', 'operator', 'commander'] as const;
export type CognitoGroupName = (typeof COGNITO_GROUP_NAMES)[number];

/**
 * Canonical scope identifiers (without the resource-server prefix).
 * These appear as OAuth2 `scope` claims in access tokens and are the
 * API capability gates used by TASK-069's JWT authorizer.
 *
 * IMPORTANT: a user in the "admin" group does NOT automatically receive
 * the "incidents.inject" scope. The scope must be explicitly granted
 * via the resource server scope assignment, or by adding the user to
 * a group that has that scope. Cognito does NOT auto-map group names
 * to identically-named scopes.
 */
export const COGNITO_SCOPE_NAMES = ['incidents.inject', 'whatif.execute', 'decisions.publish'] as const;
export type CognitoScopeName = (typeof COGNITO_SCOPE_NAMES)[number];

/**
 * Group descriptions for documentation and audit clarity.
 */
export const COGNITO_GROUP_DESCRIPTIONS: Readonly<Record<CognitoGroupName, string>> = {
  admin: 'incident injection role',
  operator: 'what-if analysis role',
  commander: 'decision publication role',
} as const;

/**
 * Authorization contract: maps each group to its required scope and
 * route capability. TASK-069's API Gateway JWT authorizer enforces the
 * scope; the handler must additionally enforce the group claim.
 *
 * @see TASK-069 for the route-scope binding and handler group checks.
 */
export interface AuthorizationContractEntry {
  readonly group: CognitoGroupName;
  readonly requiredScope: string; // e.g. "crcmd-<id>/incidents.inject"
  readonly routeCapability: string; // e.g. "incident injection"
}

/**
 * Exported authorization contract — the stable surface consumed by
 * TASK-069 (API Gateway JWT authorizer wiring) and TASK-180 (stack
 * composition). The `requiredScope` values are NOT available until
 * after the Resource Server is created; Construct consumers must read
 * them from `authorizationContract` after instantiation.
 */
export interface AuthorizationContract {
  readonly admin: AuthorizationContractEntry;
  readonly operator: AuthorizationContractEntry;
  readonly commander: AuthorizationContractEntry;
}

/** Config key for auth.user_pool_id */
export const AUTH_USER_POOL_ID_CONFIG_KEY = 'auth.user_pool_id';

/** Config key for auth.app_client_id */
export const AUTH_APP_CLIENT_ID_CONFIG_KEY = 'auth.app_client_id';

// ─── Props ─────────────────────────────────────────────────────────────────

export interface CognitoAuthConstructProps {
  readonly envContext: EnvironmentContext;

  /** Cognito User Pool logical name (used as base for resourceName). */
  readonly userPoolName: string;

  /** Cognito User Pool Domain prefix. Must be caller-provided; validated for format. */
  readonly domainPrefix: string;

  /** SPA App Client logical name. */
  readonly appClientName: string;

  /**
   * OAuth callback URLs. Must be non-empty.
   * COMPETITION_AWS: must be HTTPS, no localhost, no wildcard, no fragment.
   * PERSONAL_AWS_DEV: HTTPS preferred; localhost HTTP allowed for dev.
   */
  readonly callbackUrls: string[];

  /**
   * OAuth logout URLs. Must be non-empty; validated same as callbackUrls.
   */
  readonly logoutUrls: string[];

  /**
   * Access token validity in minutes. Cognito valid range: 5–43200.
   */
  readonly accessTokenValidityMinutes: number;

  /**
   * ID token validity in minutes. Cognito valid range: 5–900.
   */
  readonly idTokenValidityMinutes: number;

  /**
   * Refresh token validity in days. Cognito valid range: 1–3650.
   */
  readonly refreshTokenValidityDays: number;

  /**
   * Whether to enable TOTP-based MFA as optional. When true, the User Pool
   * allows users to enrol a TOTP authenticator; it does NOT force MFA.
   * SMS MFA is never enabled (no SMS role, no phone as required attribute).
   */
  readonly enableTotpMfa?: boolean;
}

// ─── Validation ────────────────────────────────────────────────────────────

function fail(label: string, msg: string): never {
  throw new Error(`${label}: ${msg}`);
}

/** Returns true for strings that are blank (empty or whitespace-only). */
function isBlank(s: string): boolean {
  return s.trim().length === 0;
}

/**
 * Validate domain prefix: lowercase alphanumeric + hyphens, starts with a
 * letter, 1–63 characters, no trailing hyphen.
 */
function validateDomainPrefix(prefix: string): void {
  if (isBlank(prefix)) fail('domainPrefix', 'must not be blank');
  if (!/^[a-z][a-z0-9-]{0,61}[a-z0-9]$/.test(prefix)) {
    fail(
      'domainPrefix',
      'must be 1–63 lowercase alphanumeric/hyphens, start with a letter, end with alphanumeric',
    );
  }
}

/** Validate a single URL for use in OAuth callback/logout. */
function validateOAuthUrl(
  url: string,
  profile: string,
  index: number,
  isHttpsRequired: boolean,
): void {
  if (isBlank(url)) fail(`urls[${index}]`, 'must not be blank');
  // String-level checks run before URL parsing so we can produce
  // precise errors (wildcard/fragment/HTTPS/localhost) instead of
  // a generic "invalid URL".
  if (url.includes('*')) fail(`urls[${index}]`, `wildcard not allowed; got "${url}"`);
  if (url.includes('#')) fail(`urls[${index}]`, `fragment not allowed; got "${url}"`);
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    fail(`urls[${index}]`, `invalid URL: "${url}"`);
    return; // satisfy TS — fall-through prevented by fail().
  }
  if (isHttpsRequired && u.protocol !== 'https:') {
    fail(`urls[${index}]`, `${profile} requires HTTPS; got "${url}"`);
  }
  if (u.hostname === 'localhost' && isHttpsRequired) {
    fail(`urls[${index}]`, `${profile} prohibits localhost; got "${url}"`);
  }
}

/** Validate URL array: non-empty, no duplicates, per-profile rules applied. */
function validateUrls(urls: string[], profile: string, label: string): void {
  if (urls.length === 0) fail(label, 'must contain at least one URL');
  const seen = new Set<string>();
  for (let i = 0; i < urls.length; i++) {
    if (seen.has(urls[i])) fail(label, `duplicate URL at index ${i}: "${urls[i]}"`);
    seen.add(urls[i]);
    const httpsRequired = profile === 'COMPETITION_AWS';
    validateOAuthUrl(urls[i], profile, i, httpsRequired);
  }
}

/** Validate Cognito token validity ranges. */
function validateTokenValidity(
  value: number,
  label: string,
  min: number,
  max: number,
): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    fail(label, `must be integer ${min}–${max}; got ${value}`);
  }
}

// ─── Construct ─────────────────────────────────────────────────────────────

export class CognitoAuthConstruct extends Construct {
  // Public contract — consumed by TASK-069 / TASK-180
  public readonly userPool: cognito.IUserPool;
  public readonly userPoolClient: cognito.IUserPoolClient;
  public readonly userPoolId: string;
  public readonly userPoolClientId: string;

  /**
   * OIDC issuer URL for the Cognito User Pool.
   *
   * This is the JWT/OIDC identity used by TASK-069's HTTP API JWT
   * Authorizer. It is the value that MUST appear in the `iss` claim of
   * the access token issued by Cognito, and the value the JWT
   * Authorizer passes to API Gateway as `issuer`.
   *
   * Format:
   *   https://cognito-idp.<region>.<urlSuffix>/<userPoolId>
   *
   * Implementation: this is exactly `userPool.userPoolProviderUrl`
   * (the L2 IUserPool getter that resolves the same expression with
   * CDK tokens). Prefer it over `userPool.userPoolArn`.
   *
   * ─── Do not confuse with: ──────────────────────────────────────────
   *
   * - `userPoolArn` — the AWS resource ARN, e.g.
   *     arn:${Partition}:cognito-idp:${Region}:${Account}:userpool/${Id}
   *   This is NOT a valid JWT issuer.
   *
   * - The Cognito Hosted UI domain prefix — the OAuth authorization
   *   endpoint; not a JWT issuer.
   *
   * - The callback/logout URLs — not a JWT issuer.
   *
   * - The Resource Server identifier — a custom-scope namespace; not a
   *   JWT issuer.
   */
  public readonly issuerUrl: string;

  public readonly resourceServerIdentifier: string;

  /**
   * Authorization contract. The `requiredScope` values are fully resolved
   * after `resourceServerIdentifier` is known (set during construction).
   */
  public readonly authorizationContract: AuthorizationContract;

  public constructor(scope: Construct, id: string, props: CognitoAuthConstructProps) {
    super(scope, id);

    const { envContext } = props;
    const { profile, isLocalMock, isCompetition, resourcePrefix } = envContext;

    // ── Props validation (fail-fast for all profiles) ──────────────────────

    if (isBlank(props.userPoolName)) fail('userPoolName', 'must not be blank');
    if (isBlank(props.appClientName)) fail('appClientName', 'must not be blank');
    validateDomainPrefix(props.domainPrefix);
    validateUrls(props.callbackUrls, profile, 'callbackUrls');
    validateUrls(props.logoutUrls, profile, 'logoutUrls');
    validateTokenValidity(props.accessTokenValidityMinutes, 'accessTokenValidityMinutes', 5, 43200);
    validateTokenValidity(props.idTokenValidityMinutes, 'idTokenValidityMinutes', 5, 900);
    validateTokenValidity(props.refreshTokenValidityDays, 'refreshTokenValidityDays', 1, 3650);

    // ── LOCAL_MOCK: short-circuit (0 AWS resources) ──────────────────────

    if (isLocalMock) {
      // No AWS resources for LOCAL_MOCK.
      // The public surface provides typed placeholders that allow TypeScript to
      // compile without a real User Pool; tests assert 0 AWS resources via
      // the stack template so the placeholders never reach CloudFormation.
      this.userPool = undefined as unknown as cognito.IUserPool;
      this.userPoolClient = undefined as unknown as cognito.IUserPoolClient;
      this.userPoolId = 'mock-user-pool-id';
      this.userPoolClientId = 'mock-app-client-id';
      // LOCAL_MOCK placeholder follows the same OIDC issuer format so
      // contract tests can compare structure against the AWS profile path.
      this.issuerUrl = 'https://cognito-idp.mock-region.amazonaws.com/mock-user-pool-id';
      this.resourceServerIdentifier = 'mock-resource-server';
      this.authorizationContract = this.#makeContract('mock-resource-server');
      return;
    }

    // ── User Pool ────────────────────────────────────────────────────────

    const removalPolicy = isCompetition ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;

    const userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: `${resourcePrefix}-${props.userPoolName}`,
      selfSignUpEnabled: false,        // admin-created users only
      signInCaseSensitive: false,
      signInAliases: {
        email: true,                    // email sign-in required
      },
      autoVerify: {
        email: true,
      },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      passwordPolicy: {
        minLength: 12,
        requireUppercase: true,
        requireLowercase: true,
        requireDigits: true,
        requireSymbols: true,
        tempPasswordValidity: Duration.days(7),
      },
      // MFA: TOTP optional (not required, not SMS). When MFA is OFF,
      // mfaSecondFactor must not be set; otherwise provide OTP as the second factor.
      mfa: props.enableTotpMfa ? cognito.Mfa.OPTIONAL : cognito.Mfa.OFF,
      ...(props.enableTotpMfa ? {
        mfaSecondFactor: {
          otp: true,
          sms: false,
        },
      } : {}),
      userInvitation: {
        emailSubject: 'Your temporary password for City Response Commander',
        emailBody: 'Your temporary password is {####}. Sign in at {##url##}.',
      },
      removalPolicy,
    });

    // Apply removal policy to the underlying L1 so we can assert it
    const cfnPool = userPool.node.defaultChild as cognito.CfnUserPool;
    cfnPool.applyRemovalPolicy(removalPolicy);

    // ── User Pool Domain (required for authorization-code OAuth flow) ───────

    new cognito.UserPoolDomain(this, 'UserPoolDomain', {
      userPool,
      cognitoDomain: {
        domainPrefix: props.domainPrefix,
      },
    });

    // ── Resource Server with three custom scopes ───────────────────────────

    const resourceServerIdentifier = `${resourcePrefix}-${props.userPoolName}-api`;

    new cognito.UserPoolResourceServer(this, 'ResourceServer', {
      userPool,
      identifier: resourceServerIdentifier,
      scopes: COGNITO_SCOPE_NAMES.map((name) => ({
        scopeName: name,
        scopeDescription: `capability: ${name}`,
      })),
    });

    // ── Three Groups ──────────────────────────────────────────────────────

    const groupDescriptions = COGNITO_GROUP_DESCRIPTIONS;
    const _groups = COGNITO_GROUP_NAMES.map((groupName) => {
      const group = new cognito.UserPoolGroup(this, `Group_${groupName}`, {
        userPool,
        groupName,
        description: groupDescriptions[groupName],
        // No IAM Role attached to the group — separation of concerns.
        // TASK-069 / TASK-076 will wire precise IAM actions to handler roles.
      });
      return group;
    });
    void _groups; // consumed for side-effect (group creation); no IAM role attachment

    // ── App Client (public SPA, authorization-code flow) ───────────────────

    const appClient = new cognito.UserPoolClient(this, 'UserPoolClient', {
      userPool,
      userPoolClientName: `${resourcePrefix}-${props.appClientName}`,
      generateSecret: false,                          // SPA cannot keep a secret
      enableTokenRevocation: true,                   // RFC 7009 token revocation
      preventUserExistenceErrors: true,              // security: no user enumeration
      supportedIdentityProviders: [cognito.UserPoolClientIdentityProvider.COGNITO],
      oAuth: {
        flows: {
          authorizationCodeGrant: true,
          implicitCodeGrant: false,                  // disabled for security
          clientCredentials: false,                  // not a machine-to-machine client
        },
        scopes: [
          cognito.OAuthScope.OPENID,
          cognito.OAuthScope.EMAIL,
          cognito.OAuthScope.PROFILE,
          // Custom capability scopes — each grants a specific API capability
          cognito.OAuthScope.custom(`${resourceServerIdentifier}/${COGNITO_SCOPE_NAMES[0]}`),  // incidents.inject
          cognito.OAuthScope.custom(`${resourceServerIdentifier}/${COGNITO_SCOPE_NAMES[1]}`),  // whatif.execute
          cognito.OAuthScope.custom(`${resourceServerIdentifier}/${COGNITO_SCOPE_NAMES[2]}`),  // decisions.publish
        ],
        callbackUrls: props.callbackUrls,
        logoutUrls: props.logoutUrls,
      },
      accessTokenValidity: Duration.minutes(props.accessTokenValidityMinutes),
      idTokenValidity: Duration.minutes(props.idTokenValidityMinutes),
      refreshTokenValidity: Duration.days(props.refreshTokenValidityDays),
    });

    // ── Public surface ────────────────────────────────────────────────────
    //
    // `issuerUrl` MUST equal `userPool.userPoolProviderUrl` so that it
    // resolves to the canonical Cognito provider URL:
    //   https://cognito-idp.<region>.<urlSuffix>/<userPoolId>
    // The CDK L2 getter uses the same tokens; referencing it directly
    // guarantees parity with what AWS Cognito emits in `iss` claims.

    this.userPool = userPool;
    this.userPoolClient = appClient;
    this.userPoolId = userPool.userPoolId;
    this.userPoolClientId = appClient.userPoolClientId;
    this.issuerUrl = userPool.userPoolProviderUrl;
    this.resourceServerIdentifier = resourceServerIdentifier;
    this.authorizationContract = this.#makeContract(resourceServerIdentifier);

    // ── CloudFormation Outputs (no cross-stack exportName) ────────────────
    //
    // AuthUserPoolIssuer is an OIDC issuer URL token, NOT a User Pool
    // ARN. It MUST match the `iss` claim of Cognito-issued access
    // tokens so TASK-069's HTTP API JWT Authorizer can validate the
    // `iss` header. TASK-069 audience uses userPoolClientId.
    //
    // Do not confuse this with `userPool.userPoolArn` (the AWS
    // resource identity); an ARN is not a valid JWT issuer.

    new CfnOutput(this, 'AuthUserPoolId', {
      value: userPool.userPoolId,
    });

    new CfnOutput(this, 'AuthUserPoolClientId', {
      value: appClient.userPoolClientId,
    });

    new CfnOutput(this, 'AuthUserPoolIssuer', {
      // OIDC issuer URL. The value is the Cognito User Pool provider
      // URL — resolved via CDK tokens at deploy time. It contains the
      // User Pool ID token but no AWS account ID, no partition, and no
      // `arn:` prefix.
      value: this.issuerUrl,
    });

    new CfnOutput(this, 'AuthResourceServerIdentifier', {
      value: resourceServerIdentifier,
    });
  }

  /**
   * Build the authorization contract once the resource server identifier is
   * known. The contract maps group names to required scopes and route
   * capabilities. TASK-069 uses this to wire the JWT authorizer scope claim
   * to route capabilities; TASK-069's handler code additionally verifies
   * the `cognito:groups` claim.
   */
  #makeContract(identifier: string): AuthorizationContract {
    const entries: Record<CognitoGroupName, AuthorizationContractEntry> = {
      admin: {
        group: 'admin',
        requiredScope: `${identifier}/${COGNITO_SCOPE_NAMES[0]}`,
        routeCapability: 'incident injection',
      },
      operator: {
        group: 'operator',
        requiredScope: `${identifier}/${COGNITO_SCOPE_NAMES[1]}`,
        routeCapability: 'what-if execution',
      },
      commander: {
        group: 'commander',
        requiredScope: `${identifier}/${COGNITO_SCOPE_NAMES[2]}`,
        routeCapability: 'decision publication',
      },
    };
    return entries;
  }
}
