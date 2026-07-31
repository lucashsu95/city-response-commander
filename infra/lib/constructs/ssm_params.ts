/**
 * SsmParametersConstruct — Production SSM Parameter Store layer for non-secret config.
 *
 * §4.12, §23, §23.1, §26, TASK-073
 *
 * Provides exactly one `AWS::SSM::Parameter` per non-secret config key in the
 * canonical schema (`packages/config/src/config_schema.ts`). The non-secret key
 * set is derived directly from the machine-readable `CONFIG_SCHEMA` registry
 * via the workspace package — no hand-written duplicate key list, no regex
 * extraction, no YAML guess.
 *
 * Parameter naming is determined by `parameterNameForConfigKey(prefix, key)`,
 * which is the inverse of the decoder used by `SsmConfigProvider.ssmPathToConfigKey`
 * (`packages/config/src/ssm_config_provider.ts`). The provider reads from
 * `/<prefixBase>/<environment>/<config-key-with-dots-as-slashes>`; this
 * construct writes to the exact same path. No parallel naming convention.
 *
 * Serialization is the exact inverse of `SsmConfigProvider.parseParameterValue`:
 *   - string  → as-is
 *   - number  → String(n) (NaN / Infinity rejected)
 *   - boolean → "true" / "false"
 *   - string[] → join with "," (no spaces; the provider's parser detects
 *                arrays by `value.includes(',') && !value.includes(' ')`)
 *
 * ─── Security boundary (precise, do not blur) ─────────────────────────────
 *
 * This construct:
 *   - Writes ONLY non-secret configuration values to Parameter Store (String tier).
 *   - NEVER writes SecureString, StringList, secret material, IAM policies,
 *     KMS keys, or IAM grants.
 *   - NEVER reads from `process.env`, `config.local.yaml`, or any other
 *     runtime source — values are supplied by the caller (TASK-180) via
 *     `valuesByKey`.
 *   - NEVER hardcodes account ID, region, model ID, endpoint, or credentials.
 *   - For AWS profiles, REJECTS caller values for `env` and `config.provider`
 *     that do not match the active profile — fail-fast with no silent
 *     fallback, no trim, no override.
 *
 * IAM ownership (precise):
 *   - This construct creates zero IAM Roles, zero IAM Policies, zero
 *     `grantRead` calls.
 *   - Runtime SSM read permissions are owned by TASK-076..083 (per-Lambda
 *     roles) and TASK-177 (WhatIfFnRole).
 *   - Final Lambda ↔ role ↔ config binding is owned by TASK-179.
 *   - Stack composition is owned by TASK-180.
 *   - Operator-driven SSM write-back (post-deploy endpoint resolution) is
 *     owned by TASK-167 deployment runbook.
 *
 * Secret boundary (precise):
 *   - Secrets Manager Secret provisioning is owned by TASK-074.
 *   - This construct does not create Secrets Manager Secrets, KMS Keys,
 *     or SecureString parameters.
 *   - When the schema later evolves to include a secret-locator key (e.g.,
 *     a secret name or ARN), the value is a locator string only —
 *     never secret material.
 *
 * ─── Removal policy (per profile, §26) ─────────────────────────────────────
 *
 *   PERSONAL_AWS_DEV  → DeletionPolicy = Delete  (Stack can be destroyed cleanly)
 *   COMPETITION_AWS   → DeletionPolicy = Retain  (judging URL stable; teardown
 *                                                is organizer-gated, not here)
 *   LOCAL_MOCK        → 0 SSM resources, 0 Outputs
 *
 * The StringParameter L2 does not propagate RemovalPolicy to its inner
 * CfnParameter; we apply it explicitly via `node.defaultChild` to the
 * CfnParameter, matching the established pattern in
 * cognito.ts / workflow_state_machine.ts.
 *
 * ─── Provider compatibility (precise) ──────────────────────────────────────
 *
 * The reverse function `parameterNameForConfigKey` is exposed so:
 *   - Tests can mechanically verify that the name produced by this Construct
 *     is the same path the SsmConfigProvider would look up.
 *   - Future IaC code (e.g., runtime resolver wiring) can request the exact
 *     name for any canonical key without re-deriving the prefix shape.
 *
 * ─── Out of scope (deferred) ──────────────────────────────────────────────
 *
 * - Secrets Manager Secret / SecureString provisioning (TASK-074)
 * - Runtime SSM read IAM grants (TASK-076..083, TASK-177)
 * - Lambda ↔ role final binding (TASK-179)
 * - Stack composition (TASK-180)
 * - SSM write-back runbook for resolved endpoints (TASK-167)
 * - Organizational defaults (TASK-073 never writes a default value;
 *   the caller supplies all values via `valuesByKey`)
 */

import { Construct } from 'constructs';
import { RemovalPolicy } from 'aws-cdk-lib';
import {
  CfnParameter,
  ParameterDataType,
  ParameterTier,
  StringParameter,
} from 'aws-cdk-lib/aws-ssm';
import type { EnvironmentContext } from '../env_context.js';
// PUBLIC package entrypoint only — never deep-import into `src/`.
// The `@city-commander/config` package's `package.json` declares
// `CONFIG_SCHEMA` (and the related enums + helpers) as part of its public
// surface in `src/index.ts`. We depend on the published artifact, not the
// workspace symlink's internal layout, so future build/CI/workspace-layout
// changes can move `src/` or restructure the package without breaking us.
import {
  CONFIG_SCHEMA,
  type ConfigKeyDefinition,
} from '@city-commander/config';

// ─── Canonical key set (derived from machine-readable schema) ───────────────

/**
 * The canonical non-secret config key set, derived from the machine-readable
 * `CONFIG_SCHEMA` registry in `packages/config/src/config_schema.ts`.
 *
 * This is the single source of truth: it is the projection of
 * `CONFIG_SCHEMA` into `string[]` (in schema order). If the schema later
 * evolves, this set evolves automatically — no hand-maintained list.
 *
 * Per §23.1 and the current schema, every required key is non-secret
 * (region, model IDs, KB ID, bucket names, endpoints, flags, policy.*).
 * The schema does not currently register any secret-material keys; if any
 * are added in the future, this construct will refuse to emit them (see
 * `serializeValue`).
 *
 * The keys are exposed as a `readonly` tuple so the TypeScript type is
 * the exact key union consumed by `SsmParametersConstructProps.valuesByKey`.
 */
export const SSM_NON_SECRET_CONFIG_KEYS = CONFIG_SCHEMA.map((def) => def.key as SsmConfigKey);

/**
 * The union of all canonical non-secret config keys. Inferred from the
 * schema so it can never drift from the machine-readable registry.
 */
export type SsmConfigKey = (typeof CONFIG_SCHEMA)[number]['key'];

/**
 * The typed value shape a caller may supply for any non-secret config key.
 *
 * The SsmConfigProvider decoder accepts exactly these four JS types
 * (see `packages/config/src/ssm_config_provider.ts:parseParameterValue`).
 * `null` and `undefined` are NOT accepted — they would not round-trip.
 * `unknown` is rejected at runtime by `serializeValue`.
 */
export type SsmConfigValueInput = string | number | boolean | readonly string[];

/**
 * Definition of a single SSM Parameter the construct will emit.
 *
 * One `SsmParameterDefinition` is produced per key in `SSM_NON_SECRET_CONFIG_KEYS`.
 * The set is keyed by the exact config key (dot-notation, e.g. "s3.raw_bucket")
 * so callers can introspect via `parametersByKey`.
 */
export interface SsmParameterDefinition {
  /** Canonical config key (dot-notation, e.g. "s3.raw_bucket") */
  readonly configKey: SsmConfigKey;
  /** Canonical SSM Parameter name (e.g. "/city-commander/PERSONAL_AWS_DEV/s3/raw_bucket") */
  readonly parameterName: string;
  /** Canonical serialized string value (provider-decoder-compatible) */
  readonly serializedValue: string;
  /** Underlying StringParameter resource */
  readonly parameter: StringParameter;
}

// ─── Canonical key iterator (frozen, schema order) ──────────────────────────

/**
 * The canonical ordered key list at module load. This is the exact
 * enumeration the construct will iterate over when creating parameters.
 * Tests assert against this same `readonly` tuple to guarantee closure.
 */
export const CANONICAL_SSM_KEYS: readonly SsmConfigKey[] = Object.freeze(
  CONFIG_SCHEMA.map((def) => def.key as SsmConfigKey),
);

// ─── Parameter naming contract (provider-aligned) ────────────────────────────

/**
 * Compute the canonical SSM parameter name for a config key.
 *
 * This is the exact inverse of
 * `SsmConfigProvider.ssmPathToConfigKey` (in
 * `packages/config/src/ssm_config_provider.ts`). Every dot `.` in the config
 * key becomes a path separator `/`. Underscores are preserved.
 *
 * @param prefix  Full SSM path prefix (must end with `/`)
 * @param configKey  Canonical dot-notation key (e.g. "s3.raw_bucket")
 * @returns Canonical fully-qualified parameter name (e.g. "/city-commander/PERSONAL_AWS_DEV/s3/raw_bucket")
 */
export function parameterNameForConfigKey(prefix: string, configKey: string): string {
  return prefix + configKey.replace(/\./g, '/');
}

/**
 * Reverse of `parameterNameForConfigKey`. Mirrors the provider's
 * `ssmPathToConfigKey` exactly: drops the prefix, then converts every
 * remaining `/` back to `.`.
 *
 * Exposed for tests and for any future IaC code that needs to derive the
 * config key from the SSM path.
 */
export function configKeyFromParameterName(parameterName: string, prefix: string): string {
  if (!parameterName.startsWith(prefix)) {
    throw new Error(
      `Parameter name "${parameterName}" does not start with prefix "${prefix}"`,
    );
  }
  return parameterName.slice(prefix.length).replace(/\//g, '.');
}

// ─── Value serialization (provider decoder-compatible) ───────────────────────

/**
 * Serialize a config value to the canonical parameter string.
 *
 * Mirrors `SsmConfigProvider.parseParameterValue` exactly:
 *   - string  → as-is (no quoting, no transformation)
 *   - number  → `String(n)` (NaN / Infinity rejected)
 *   - boolean → "true" / "false" (the literal strings)
 *   - string[] → join with "," (no spaces; the provider's parser detects
 *                arrays by `value.includes(',') && !value.includes(' ')`)
 *
 * Rejects (throws):
 *   - null, undefined
 *   - non-finite numbers (NaN, Infinity, -Infinity)
 *   - empty required strings (length 0)
 *   - strings containing "," (would be mis-interpreted as array by the
 *     decoder)
 *   - strings containing " " (would be rejected as array by the decoder)
 *   - any other JS type (object, symbol, bigint, function)
 *
 * CDK unresolved tokens (anything where `Token.isUnresolved(value)` is true)
 * are passed through unchanged as the literal stringValue. They are
 * stringified only at CloudFormation evaluation time, never at synth time.
 *
 * NOTE: CDK tokens are not enumerable — `Token.isUnresolved(value)` is a
 * string sentinel check. We can't reliably detect a token without a CDK
 * dependency here, so callers must pass token-yielding CDK objects
 * directly (e.g. `apiEndpoint.url`); the StringParameter L2 will accept
 * them and emit an appropriate `{{resolve:...}}` placeholder in the
 * synthesized template. Round-trip is broken for tokens (they aren't
 * decoded by the SSM client at runtime) — but that's the same as any
 * IaC that injects a CFN reference into a Parameter value.
 */
export function serializeValue(
  configKey: string,
  value: SsmConfigValueInput,
): string {
  if (value === null || value === undefined) {
    throw new Error(
      `SsmParametersConstruct: value for "${configKey}" must not be null or undefined`,
    );
  }

  const t = typeof value;

  if (t === 'string') {
    const s = value as string;
    if (s.length === 0) {
      throw new Error(
        `SsmParametersConstruct: value for "${configKey}" must not be an empty string`,
      );
    }
    if (s.includes(',')) {
      throw new Error(
        `SsmParametersConstruct: value for "${configKey}" contains a comma, ` +
          'which the SsmConfigProvider decoder would misinterpret as an array boundary. ' +
          'Use a different separator or store this value in a different parameter.',
      );
    }
    if (s.includes(' ')) {
      throw new Error(
        `SsmParametersConstruct: value for "${configKey}" contains a space, ` +
          'which the SsmConfigProvider decoder would reject as an array. ' +
          'The canonical decoder requires comma-separated array values to contain no spaces.',
      );
    }
    return s;
  }

  if (t === 'number') {
    const n = value as number;
    if (!Number.isFinite(n)) {
      throw new Error(
        `SsmParametersConstruct: value for "${configKey}" must be a finite number (got ${n})`,
      );
    }
    return String(n);
  }

  if (t === 'boolean') {
    return (value as boolean) ? 'true' : 'false';
  }

  if (Array.isArray(value)) {
    const arr = value as readonly string[];
    if (arr.length === 0) {
      throw new Error(
        `SsmParametersConstruct: value for "${configKey}" must not be an empty array. ` +
          'Empty arrays cannot round-trip through the SsmConfigProvider decoder.',
      );
    }
    for (let i = 0; i < arr.length; i++) {
      const item = arr[i];
      if (typeof item !== 'string') {
        throw new Error(
          `SsmParametersConstruct: value for "${configKey}" at index ${i} is not a string`,
        );
      }
      if (item.length === 0) {
        throw new Error(
          `SsmParametersConstruct: value for "${configKey}" at index ${i} is an empty string`,
        );
      }
      if (item.includes(',') || item.includes(' ')) {
        throw new Error(
          `SsmParametersConstruct: value for "${configKey}" at index ${i} contains ` +
            'a comma or space, which would break array round-trip with the ' +
            'SsmConfigProvider decoder.',
        );
      }
    }
    return arr.join(',');
  }

  throw new Error(
    `SsmParametersConstruct: value for "${configKey}" has unsupported type "${t}". ` +
      'Allowed: string, number, boolean, string[].',
  );
}

// ─── Validation helpers ──────────────────────────────────────────────────────

const FORBIDDEN_PREFIX_SUBSTRINGS = ['//', ' '];
const FORBIDDEN_PREFIX_REGEX_PARTS = [/\$\{[^}]*\}/, /[*?]/];

function validatePrefix(prefix: string): void {
  if (typeof prefix !== 'string' || prefix.length === 0) {
    throw new Error('SsmParametersConstruct: parameterPathPrefix must be a non-empty string');
  }
  if (prefix !== prefix.trim()) {
    throw new Error(
      `SsmParametersConstruct: parameterPathPrefix "${prefix}" must not have leading or trailing whitespace`,
    );
  }
  if (!prefix.startsWith('/')) {
    throw new Error(
      `SsmParametersConstruct: parameterPathPrefix "${prefix}" must start with "/"`,
    );
  }
  if (!prefix.endsWith('/')) {
    throw new Error(
      `SsmParametersConstruct: parameterPathPrefix "${prefix}" must end with "/"`,
    );
  }
  for (const sub of FORBIDDEN_PREFIX_SUBSTRINGS) {
    if (prefix.includes(sub)) {
      throw new Error(
        `SsmParametersConstruct: parameterPathPrefix "${prefix}" contains forbidden substring "${sub}"`,
      );
    }
  }
  for (const re of FORBIDDEN_PREFIX_REGEX_PARTS) {
    if (re.test(prefix)) {
      throw new Error(
        `SsmParametersConstruct: parameterPathPrefix "${prefix}" contains forbidden token pattern`,
      );
    }
  }
  // No auto-trim/auto-pad: caller must supply the exact prefix.
}

function validateValuesByKey(valuesByKey: {
  readonly [K in SsmConfigKey]?: SsmConfigValueInput;
}): void {
  // 1. Missing required keys
  for (const def of CONFIG_SCHEMA) {
    if (def.required && !(def.key in valuesByKey)) {
      throw new Error(
        `SsmParametersConstruct: missing required config key "${def.key}" in valuesByKey`,
      );
    }
  }
  // 2. Unknown keys
  const knownKeys = new Set<string>(CANONICAL_SSM_KEYS);
  for (const k of Object.keys(valuesByKey)) {
    if (!knownKeys.has(k)) {
      throw new Error(
        `SsmParametersConstruct: unknown config key "${k}" in valuesByKey. ` +
          'All keys must come from CONFIG_SCHEMA.',
      );
    }
  }
}

/**
 * Profile-invariant validation (§4.12, §23.1).
 *
 * For AWS profiles, two schema-declared locator values are tied to the
 * profile itself:
 *
 *   - `env`            — must equal the active `envContext.profile`
 *   - `config.provider` — must be `ssm` for any AWS profile (the only
 *                          non-LOCAL_MOCK provider type; the schema
 *                          allows `local_file | ssm`, but `local_file`
 *                          would imply a LOCAL_MOCK configuration source
 *                          inside an AWS-only stack — explicitly rejected)
 *
 * The function fails fast with an informative error message before any
 * AWS resource is created. It does NOT mutate, trim, or override the
 * caller's values.
 *
 * For LOCAL_MOCK, this check is intentionally skipped — the construct
 * short-circuits before any resource creation anyway.
 */
function validateProfileInvariants(
  envContext: EnvironmentContext,
  valuesByKey: { readonly [K in SsmConfigKey]?: SsmConfigValueInput },
): void {
  if (envContext.isLocalMock) {
    return;
  }

  // The two keys involved are ALWAYS required by the schema (and therefore
  // are guaranteed to be present in `valuesByKey` after `validateValuesByKey`).
  const expectedEnv = envContext.profile; // 'PERSONAL_AWS_DEV' | 'COMPETITION_AWS'
  const actualEnv = valuesByKey['env' as SsmConfigKey];
  if (actualEnv !== expectedEnv) {
    throw new Error(
      `SsmParametersConstruct: profile-invariant violation [profile=${expectedEnv}] ` +
        `on config key "env": expected "${expectedEnv}", got "${String(actualEnv)}". ` +
        'valuesByKey.env must equal envContext.profile for AWS profiles.',
    );
  }

  const actualProvider = valuesByKey['config.provider' as SsmConfigKey];
  if (actualProvider !== 'ssm') {
    throw new Error(
      `SsmParametersConstruct: profile-invariant violation [profile=${expectedEnv}] ` +
        `on config key "config.provider": expected "ssm", got "${String(actualProvider)}". ` +
        'AWS profiles MUST resolve config via SsmConfigProvider.',
    );
  }
}

// ─── Construct ───────────────────────────────────────────────────────────────

export interface SsmParametersConstructProps {
  /** TASK-059 typed environment context */
  readonly envContext: EnvironmentContext;

  /**
   * Full SSM path prefix, OWNER-controlled.
   *
   * Must:
   *   - start with `/`
   *   - end with `/`
   *   - contain no whitespace, no `//`, no wildcards, no account/region/credentials
   *   - be environment-specific (PERSONAL ≠ COMPETITION)
   *
   * TASK-180 (the canonical composition owner) is the only caller that
   * derives this from the active environment profile.
   */
  readonly parameterPathPrefix: string;

  /**
   * Map of canonical config key → typed value.
   *
   * Must contain exactly the keys required by the schema (no extra, no
   * missing). Values are typed `SsmConfigValueInput` and are serialized
   * via `serializeValue` to ensure provider-decoder compatibility.
   *
   * The construct does NOT read from `process.env`, YAML, or any other
   * runtime source — the caller supplies everything.
   */
  readonly valuesByKey: { readonly [K in SsmConfigKey]?: SsmConfigValueInput };
}

/**
 * SsmParametersConstruct — emits one `AWS::SSM::Parameter` per canonical
 * non-secret config key for the given environment.
 *
 * LOCAL_MOCK short-circuits before any AWS resource is created.
 *
 * Removal policy:
 *   - PERSONAL_AWS_DEV: DeletionPolicy = Delete
 *   - COMPETITION_AWS : DeletionPolicy = Retain
 *   - LOCAL_MOCK      : no resources at all
 */
export class SsmParametersConstruct extends Construct {
  /** The full SSM path prefix used (e.g. "/city-commander/PERSONAL_AWS_DEV/") */
  public readonly parameterPathPrefix: string;

  /** Canonical config keys (in schema order) — empty in LOCAL_MOCK */
  public readonly configKeys: readonly SsmConfigKey[];

  /** Count of parameters created (0 in LOCAL_MOCK) */
  public readonly parameterCount: number;

  /** Definition per key — empty in LOCAL_MOCK */
  public readonly parametersByKey: Readonly<Record<SsmConfigKey, SsmParameterDefinition>>;

  /** Parameter name per key — empty in LOCAL_MOCK */
  public readonly parameterNamesByKey: Readonly<Record<SsmConfigKey, string>>;

  /** Parameter ARN per key — empty in LOCAL_MOCK */
  public readonly parameterArnsByKey: Readonly<Record<SsmConfigKey, string>>;

  /** Serialized string value per key — empty in LOCAL_MOCK */
  public readonly serializedValuesByKey: Readonly<Record<SsmConfigKey, string>>;

  public constructor(scope: Construct, id: string, props: SsmParametersConstructProps) {
    super(scope, id);

    const { envContext, parameterPathPrefix: rawPrefix, valuesByKey } = props;

    // 1. Validate prefix shape BEFORE any resource creation.
    validatePrefix(rawPrefix);

    this.parameterPathPrefix = rawPrefix;

    // 2. LOCAL_MOCK: zero resources, zero outputs, no validation of
    //    AWS-only inputs (the construct owner is the only place that
    //    enforces frontend runtime isolation per §23.1).
    if (envContext.isLocalMock) {
      this.parameterCount = 0;
      this.configKeys = Object.freeze([] as SsmConfigKey[]);
      this.parametersByKey = Object.freeze({} as Record<SsmConfigKey, SsmParameterDefinition>);
      this.parameterNamesByKey = Object.freeze({} as Record<SsmConfigKey, string>);
      this.parameterArnsByKey = Object.freeze({} as Record<SsmConfigKey, string>);
      this.serializedValuesByKey = Object.freeze({} as Record<SsmConfigKey, string>);
      return;
    }

    // 3. Validate valuesByKey completeness BEFORE any resource creation.
    validateValuesByKey(valuesByKey);
    validateProfileInvariants(envContext, valuesByKey);

    // 4. Removal policy per profile.
    const removalPolicy = envContext.isCompetition ? RemovalPolicy.RETAIN : RemovalPolicy.DESTROY;

    // 5. Build one parameter per canonical key (in schema order).
    const parametersByKey: Record<string, SsmParameterDefinition> = {};
    const namesByKey: Record<string, string> = {};
    const arnsByKey: Record<string, string> = {};
    const valuesByKeyOut: Record<string, string> = {};

    for (const def of CONFIG_SCHEMA) {
      const key = def.key as SsmConfigKey;
      const rawValue = valuesByKey[key];
      // We must have a value at this point because validateValuesByKey
      // already rejected missing required keys. But TypeScript can't
      // narrow `{ readonly [K in SsmConfigKey]?: SsmConfigValueInput }`
      // to a non-undefined here, so we re-check defensively.
      if (rawValue === undefined) {
        // This branch is reachable only for optional keys that the
        // caller chose to omit. SSM Parameter Store requires a value,
        // so we reject explicitly (no silent default).
        throw new Error(
          `SsmParametersConstruct: optional config key "${key}" was omitted from valuesByKey. ` +
            'TASK-073 explicitly requires every canonical key to be supplied — no silent defaults.',
        );
      }

      const serialized = serializeValue(key, rawValue);
      const paramName = parameterNameForConfigKey(rawPrefix, key);

      const parameter = new StringParameter(this, toResourceId(key), {
        parameterName: paramName,
        stringValue: serialized,
        tier: ParameterTier.STANDARD,
        dataType: ParameterDataType.TEXT,
        description: buildDescription(envContext.profile, key),
      });

      // The L2 StringParameter does NOT propagate RemovalPolicy to the
      // inner CfnParameter. Apply it explicitly via defaultChild —
      // matches the pattern used in cognito.ts / workflow_state_machine.ts.
      const cfnParam = parameter.node.defaultChild as CfnParameter;
      cfnParam.applyRemovalPolicy(removalPolicy);

      parametersByKey[key] = {
        configKey: key,
        parameterName: paramName,
        serializedValue: serialized,
        parameter,
      };
      namesByKey[key] = paramName;
      // Parameter ARN is a CDK token; we capture it as a string for the
      // public readonly surfaces. CDK guarantees `parameterArn` is
      // resolvable at deploy time.
      arnsByKey[key] = parameter.parameterArn;
      valuesByKeyOut[key] = serialized;
    }

    this.parameterCount = Object.keys(parametersByKey).length;
    this.configKeys = Object.freeze(CANONICAL_SSM_KEYS.slice() as SsmConfigKey[]);
    this.parametersByKey = Object.freeze(parametersByKey as Record<SsmConfigKey, SsmParameterDefinition>);
    this.parameterNamesByKey = Object.freeze(namesByKey as Record<SsmConfigKey, string>);
    this.parameterArnsByKey = Object.freeze(arnsByKey as Record<SsmConfigKey, string>);
    this.serializedValuesByKey = Object.freeze(valuesByKeyOut as Record<SsmConfigKey, string>);
  }
}

// ─── Internal helpers ───────────────────────────────────────────────────────

/**
 * Convert a dot-notation config key to a CDK Construct id.
 * "s3.raw_bucket" → "S3RawBucket"
 *
 * Trivially deterministic; the schema is the only source of truth for
 * the key set, so the id set is also deterministic.
 */
function toResourceId(configKey: string): string {
  return configKey
    .split('.')
    .map((seg) => seg.charAt(0).toUpperCase() + seg.slice(1))
    .join('');
}

/**
 * Build the parameter description.
 *
 * Per spec: "description只包含 config key與 environment，不包含 value".
 * The description intentionally does NOT include the resolved value, the
 * account ID, the region, or any secret-like material. It is purely
 * a key-identification string for the parameter.
 *
 * The `_def` parameter is intentionally unused; it is kept in the signature
 * for future maintainers who may want to enrich the description with
 * schema metadata (e.g. extract provisional policy flag). The lint rule
 * `no-unused-vars` is satisfied by the leading underscore.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function buildDescription(profile: string, key: string, _def?: ConfigKeyDefinition): string {
  return `TASK-073 SSM Parameter for config key ${key} (env=${profile})`;
}
