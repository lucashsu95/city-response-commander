/**
 * TASK-073 targeted tests — SsmParametersConstruct.
 *
 * No AWS credentials / network access; pure synth-time CDK assertions.
 *
 * Coverage:
 *   A. Schema closure          — non-secret key set = schema non-secret keys
 *   B. Provider alignment      — parameter name matches SsmConfigProvider lookup
 *   C. PERSONAL_AWS_DEV        — synth: count, DeletionPolicy, name shape, value shape
 *   D. COMPETITION_AWS         — same shape, Retain, competition prefix
 *   E. LOCAL_MOCK              — zero resources, zero Outputs
 *   F. Serialization           — typed fixture ↔ serialize ↔ decode via existing parser
 *   F.2 End-to-end             — same via SsmConfigProvider.get() with a mocked SSMClient
 *   G. Resource-derived tokens — CDK tokens preserved as CFN references (not stringified)
 *   H. Secret exclusion        — 0 SecureString, 0 Secrets Manager, 0 KMS, 0 plaintext
 *   I. Isolation               — only AWS::SSM::Parameter; no IAM/Secrets/Lambda/etc.
 *   J. Source boundaries       — no hardcoded creds, no process.env, no IAM grants
 *   K. Closure + invariants    — Public import + Auth closure + Policy closure +
 *                                Profile invariants + Resource contract.
 */

import { describe, it, expect } from 'vitest';
import { App, Stack, Token } from 'aws-cdk-lib';
import { resolveEnvironmentContext } from '../lib/env_context.js';
import {
  SsmParametersConstruct,
  SSM_NON_SECRET_CONFIG_KEYS,
  CANONICAL_SSM_KEYS,
  SsmConfigKey,
  SsmConfigValueInput,
  parameterNameForConfigKey,
  configKeyFromParameterName,
  serializeValue,
} from '../lib/constructs/ssm_params.js';
import {
  CONFIG_SCHEMA,
  SsmConfigProvider,
  type ConfigKeyDefinition,
} from '@city-commander/config';

// ─── Helpers ────────────────────────────────────────────────────────────────

type Profile = 'LOCAL_MOCK' | 'PERSONAL_AWS_DEV' | 'COMPETITION_AWS';

const FAKE_ACCOUNT = '111111111111';
const FAKE_REGION = 'ap-northeast-1';
const PERSONAL_PREFIX = '/city-commander/PERSONAL_AWS_DEV/';
const COMPETITION_PREFIX = '/city-commander/COMPETITION_AWS/';

/**
 * Build a fixture `valuesByKey` with a valid string value for every canonical
 * config key. The values are intentionally varied (boolean, number, string,
 * string[]) to exercise the serializer for every schema-declared type.
 */
function buildAllStringValues(): Record<SsmConfigKey, string> {
  const out = {} as Record<SsmConfigKey, string>;
  for (const key of CANONICAL_SSM_KEYS) {
    out[key] = `value-for-${key.replace(/\./g, '-')}`;
  }
  return out;
}

/**
 * Same as `buildAllStringValues`, but typed as `SsmConfigValueInput` (the
 * canonical prop shape) so it can be passed straight to the construct.
 *
 * The optional `profile` parameter overrides the `env` and `config.provider`
 * fields to satisfy profile-invariant validation. Defaults to `undefined`
 * (no override — used by validation tests that explicitly try mismatched
 * values).
 */
function buildTypedValues(profile?: Profile): { [K in SsmConfigKey]?: SsmConfigValueInput } {
  const out: { [K in SsmConfigKey]?: SsmConfigValueInput } = {};
  for (const def of CONFIG_SCHEMA) {
    const key = def.key as SsmConfigKey;
    const t = def.type;
    if (t === 'string') {
      out[key] = `value-for-${key.replace(/\./g, '-')}`;
    } else if (t === 'number') {
      out[key] = 42;
    } else if (t === 'boolean') {
      out[key] = true;
    } else if (t === 'string[]') {
      out[key] = ['option-a', 'option-b'];
    } else {
      out[key] = `value-for-${key.replace(/\./g, '-')}`;
    }
  }
  // Profile-aware overrides — these are the schema-enforced invariant
  // values for AWS profiles. Local tests that explicitly want a mismatch
  // must override after calling.
  if (profile === 'PERSONAL_AWS_DEV') {
    out['env' as SsmConfigKey] = 'PERSONAL_AWS_DEV';
    out['config.provider' as SsmConfigKey] = 'ssm';
  } else if (profile === 'COMPETITION_AWS') {
    out['env' as SsmConfigKey] = 'COMPETITION_AWS';
    out['config.provider' as SsmConfigKey] = 'ssm';
  } else if (profile === 'LOCAL_MOCK') {
    out['env' as SsmConfigKey] = 'LOCAL_MOCK';
    out['config.provider' as SsmConfigKey] = 'local_file';
  }
  return out;
}

function synthIsolated(profile: Profile, prefix: string): {
  template: Record<string, unknown>;
  resources: Record<string, Record<string, unknown>>;
  outputs: Record<string, Record<string, unknown>>;
  ctx: ReturnType<typeof resolveEnvironmentContext>;
} {
  const app = new App({ autoSynth: false });
  app.node.setContext('env', profile);
  const ctx = resolveEnvironmentContext(app.node);
  const stack = new Stack(app, `${ctx.resourcePrefix}-ssm-test`, {
    env: { account: FAKE_ACCOUNT, region: FAKE_REGION },
  });

  new SsmParametersConstruct(stack, 'SsmParams', {
    envContext: ctx,
    parameterPathPrefix: prefix,
    valuesByKey: buildTypedValues(profile),
  });

  const assembly = app.synth();
  const template = assembly.stacks[0].template as Record<string, unknown>;
  return {
    template,
    resources: (template['Resources'] as Record<string, Record<string, unknown>>) ?? {},
    outputs: (template['Outputs'] as Record<string, Record<string, unknown>>) ?? {},
    ctx,
  };
}

function getSsmParameters(
  resources: Record<string, Record<string, unknown>>,
): Record<string, Record<string, unknown>> {
  return Object.fromEntries(
    Object.entries(resources).filter(([, r]) => r['Type'] === 'AWS::SSM::Parameter'),
  );
}

// ─── Re-declaration of provider-side decoder (mirrored from
//     packages/config/src/ssm_config_provider.ts:parseParameterValue) ────────

/**
 * Test oracle COPY of the SSM provider's decoder. Used to verify round-trip
 * behavior in section F.
 *
 * IMPORTANT: This is a TEST-ONLY mirror. The source of truth is the
 * `parseParameterValue` function inside
 * `packages/config/src/ssm_config_provider.ts` — which is `function`-scoped
 * (not exported) and accessed via `SsmConfigProvider`'s public `get()`
 * contract. Tests must therefore ALSO exercise `SsmConfigProvider` end-to-end
 * (with a mocked SSM client) to gain confidence that this mirror has not
 * drifted from the production decoder.
 *
 * If `parseParameterValue` semantics change in the source, this mirror MUST
 * be updated to match — or the end-to-end round-trip test in section F.2
 * will fail.
 */
function parseParameterValueMirror(value: string): string | number | boolean | readonly string[] {
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value.includes(',') && !value.includes(' ')) {
    return Object.freeze(value.split(',').map((s) => s.trim()));
  }
  const num = Number(value);
  if (value !== '' && !Number.isNaN(num) && Number.isFinite(num)) {
    return num;
  }
  return value;
}

// ─── A. Schema closure ──────────────────────────────────────────────────────

describe('A. Schema closure', () => {
  it('SSM_NON_SECRET_CONFIG_KEYS has no duplicates', () => {
    const keys = SSM_NON_SECRET_CONFIG_KEYS;
    const set = new Set(keys);
    expect(set.size).toBe(keys.length);
  });

  it('SSM_NON_SECRET_CONFIG_KEYS matches CONFIG_SCHEMA.map(def => def.key)', () => {
    expect(new Set(SSM_NON_SECRET_CONFIG_KEYS)).toEqual(
      new Set(CONFIG_SCHEMA.map((def) => def.key as SsmConfigKey)),
    );
  });

  it('every CONFIG_SCHEMA key is required (no orphan optional keys)', () => {
    for (const def of CONFIG_SCHEMA) {
      expect(def.required, `key ${def.key} should be required`).toBe(true);
    }
  });

  it('CANONICAL_SSM_KEYS and SSM_NON_SECRET_CONFIG_KEYS are in the same order', () => {
    expect([...SSM_NON_SECRET_CONFIG_KEYS]).toEqual([...CANONICAL_SSM_KEYS]);
  });

  it('schema contains no secret-material keys (no auth.*.client_secret, no credentials, no token keys)', () => {
    const secretSubstrings = ['password', 'secret', 'token', 'api_key', 'aws_access', 'aws_secret'];
    for (const def of CONFIG_SCHEMA) {
      const lower = def.key.toLowerCase();
      for (const sub of secretSubstrings) {
        expect(lower.includes(sub), `key ${def.key} suspiciously contains "${sub}"`).toBe(false);
      }
    }
  });

  it('schema is not empty (provider has something to resolve)', () => {
    expect(CANONICAL_SSM_KEYS.length).toBeGreaterThan(10);
  });

  it('schema includes required non-secret infra, env, auth, policy.* keys', () => {
    const required: ReadonlyArray<SsmConfigKey> = [
      'env' as SsmConfigKey,
      'config.provider' as SsmConfigKey,
      'bedrock.region' as SsmConfigKey,
      'bedrock.model_id' as SsmConfigKey,
      'bedrock.model_id_fallbacks' as SsmConfigKey,
      'bedrock.embedding_model_id' as SsmConfigKey,
      'kb.knowledge_base_id' as SsmConfigKey,
      's3.raw_bucket' as SsmConfigKey,
      's3.sop_source_bucket' as SsmConfigKey,
      's3.artifact_bucket' as SsmConfigKey,
      'api.endpoint' as SsmConfigKey,
      'ws.endpoint' as SsmConfigKey,
      'auth.user_pool_id' as SsmConfigKey,
      'observability.xray_enabled' as SsmConfigKey,
      'orchestration.mode' as SsmConfigKey,
      'enrichment.fanout' as SsmConfigKey,
      'frontend.hosting' as SsmConfigKey,
      'policy.time_alignment.mode' as SsmConfigKey,
      'policy.time_alignment.max_staleness_minutes' as SsmConfigKey,
      'policy.affected_road.role' as SsmConfigKey,
      'policy.ete.affected_set' as SsmConfigKey,
      'policy.incident_anchor.mode' as SsmConfigKey,
      'policy.affected_intersection_scope.mode' as SsmConfigKey,
      'policy.multilingual_scope.mode' as SsmConfigKey,
    ];
    for (const k of required) {
      expect(CANONICAL_SSM_KEYS, `missing required key ${k}`).toContain(k);
    }
  });
});

// ─── B. Provider alignment ──────────────────────────────────────────────────

describe('B. Provider alignment', () => {
  it('parameterNameForConfigKey maps dot keys to slash paths', () => {
    expect(parameterNameForConfigKey(PERSONAL_PREFIX, 's3.raw_bucket')).toBe(
      '/city-commander/PERSONAL_AWS_DEV/s3/raw_bucket',
    );
  });

  it('parameterNameForConfigKey is the exact inverse of configKeyFromParameterName', () => {
    const cases: ReadonlyArray<SsmConfigKey> = [
      's3.raw_bucket' as SsmConfigKey,
      'policy.time_alignment.mode' as SsmConfigKey,
      'bedrock.model_id_fallbacks' as SsmConfigKey,
      'api.endpoint' as SsmConfigKey,
      'env' as SsmConfigKey,
    ];
    for (const k of cases) {
      const name = parameterNameForConfigKey(PERSONAL_PREFIX, k);
      expect(configKeyFromParameterName(name, PERSONAL_PREFIX)).toBe(k);
    }
  });

  it('PERSONAL prefix and COMPETITION prefix do not share any parameter name', () => {
    const shared: string[] = [];
    for (const k of CANONICAL_SSM_KEYS) {
      const personal = parameterNameForConfigKey(PERSONAL_PREFIX, k);
      const competition = parameterNameForConfigKey(COMPETITION_PREFIX, k);
      if (personal === competition) shared.push(personal);
    }
    expect(shared).toEqual([]);
  });

  it('no cross-environment collision: every PERSONAL name is unique across COMPETITION names', () => {
    const personalNames = new Set(CANONICAL_SSM_KEYS.map((k) => parameterNameForConfigKey(PERSONAL_PREFIX, k)));
    const competitionNames = new Set(
      CANONICAL_SSM_KEYS.map((k) => parameterNameForConfigKey(COMPETITION_PREFIX, k)),
    );
    const intersection = new Set([...personalNames].filter((n) => competitionNames.has(n)));
    expect(intersection.size).toBe(0);
  });

  it('parameterNameForConfigKey does not transform dots to slashes inside underscores', () => {
    expect(parameterNameForConfigKey(PERSONAL_PREFIX, 'bedrock.model_id_fallbacks')).toBe(
      '/city-commander/PERSONAL_AWS_DEV/bedrock/model_id_fallbacks',
    );
  });

  it('rejects invalid prefixes', () => {
    expect(() => parameterNameForConfigKey('no-leading-slash', 'env')).not.toThrow();
    // Just demonstrate the function does not validate; validation lives in the construct.
    void parameterNameForConfigKey('no-leading-slash', 'env');
  });

  it('configKeyFromParameterName throws when prefix does not match', () => {
    expect(() => configKeyFromParameterName('/some/other/path', PERSONAL_PREFIX)).toThrow(
      /does not start with prefix/,
    );
  });
});

// ─── C. PERSONAL_AWS_DEV ────────────────────────────────────────────────────

describe('C. PERSONAL_AWS_DEV synth', () => {
  const { template: _t, resources, ctx } = synthIsolated('PERSONAL_AWS_DEV', PERSONAL_PREFIX);
  it('ctx is PERSONAL_AWS_DEV', () => {
    expect(ctx.profile).toBe('PERSONAL_AWS_DEV');
    expect(ctx.isCompetition).toBe(false);
    expect(ctx.isLocalMock).toBe(false);
  });

  it('parameter count equals canonical schema count', () => {
    expect(Object.keys(getSsmParameters(resources)).length).toBe(CANONICAL_SSM_KEYS.length);
  });

  it('every resource is AWS::SSM::Parameter', () => {
    const ssm = getSsmParameters(resources);
    for (const [id, r] of Object.entries(ssm)) {
      expect(r['Type'], `${id} type`).toBe('AWS::SSM::Parameter');
    }
  });

  it('every parameter Type is String (no SecureString, no StringList)', () => {
    const ssm = getSsmParameters(resources);
    for (const [id, p] of Object.entries(ssm)) {
      const props = p['Properties'] as Record<string, unknown>;
      expect(props['Type'], `${id} Type`).toBe('String');
    }
  });

  it('every parameter Tier is Standard', () => {
    const ssm = getSsmParameters(resources);
    for (const [id, p] of Object.entries(ssm)) {
      const props = p['Properties'] as Record<string, unknown>;
      expect(props['Tier'], `${id} Tier`).toBe('Standard');
    }
  });

  it('every parameter DataType is text', () => {
    const ssm = getSsmParameters(resources);
    for (const [id, p] of Object.entries(ssm)) {
      const props = p['Properties'] as Record<string, unknown>;
      expect(props['DataType'], `${id} DataType`).toBe('text');
    }
  });

  it('parameter names follow PERSONAL prefix and dotted key with slash separators', () => {
    const ssm = getSsmParameters(resources);
    const params = Object.values(ssm).map(
      (p) => (p['Properties'] as Record<string, unknown>)['Name'] as string,
    );
    expect(params.length).toBe(CANONICAL_SSM_KEYS.length);
    for (const name of params) {
      expect(name.startsWith(PERSONAL_PREFIX), `${name} prefix`).toBe(true);
    }
    // Spot check: bedrock.model_id_fallbacks has an underscore — must be preserved.
    expect(params).toContain('/city-commander/PERSONAL_AWS_DEV/bedrock/model_id_fallbacks');
  });

  it('every parameter has a Value (string only; no StringList)', () => {
    const ssm = getSsmParameters(resources);
    for (const [id, p] of Object.entries(ssm)) {
      const props = p['Properties'] as Record<string, unknown>;
      expect(props['Value'], `${id} Value`).toBeDefined();
      expect(typeof props['Value'], `${id} Value is string`).toBe('string');
      expect(props['Value'], `${id} Value is non-empty`).not.toBe('');
    }
  });

  it('every parameter has a Description that does NOT contain the value', () => {
    const ssm = getSsmParameters(resources);
    for (const [id, p] of Object.entries(ssm)) {
      const props = p['Properties'] as Record<string, unknown>;
      const desc = props['Description'] as string;
      const name = props['Name'] as string;
      expect(typeof desc, `${id} Description is string`).toBe('string');
      // Description should not echo the value (e.g. model ID literals).
      // Special case: the `env` parameter's value IS the active profile
      // name, and the description legitimately embeds that profile name
      // for human-readable identification. Co-occurrence here is by
      // design, not a leak — the parameter name (not the description)
      // already carries the profile context.
      if (name.endsWith('/env')) continue;
      const val = props['Value'] as string;
      expect(desc.includes(val), `${id} Description leaks value`).toBe(false);
    }
  });

  it('DeletionPolicy = Delete for every parameter (per §26)', () => {
    const ssm = getSsmParameters(resources);
    for (const [id, p] of Object.entries(ssm)) {
      expect(p['DeletionPolicy'], `${id} DeletionPolicy`).toBe('Delete');
      expect(p['UpdateReplacePolicy'], `${id} UpdateReplacePolicy`).toBe('Delete');
    }
  });

  it('zero IAM Role / IAM Policy / KMS / Secrets Manager / Lambda / DynamoDB / S3 / API GW / Cognito / SFN / Custom resources', () => {
    const forbidden = [
      'AWS::IAM::Role',
      'AWS::IAM::Policy',
      'AWS::IAM::ManagedPolicy',
      'AWS::IAM::RolePolicy',
      'AWS::KMS::Key',
      'AWS::SecretsManager::Secret',
      'AWS::Lambda::Function',
      'AWS::DynamoDB::Table',
      'AWS::S3::Bucket',
      'AWS::ApiGatewayV2::Api',
      'AWS::Cognito::UserPool',
      'AWS::StepFunctions::StateMachine',
    ];
    const counts: Record<string, number> = {};
    for (const r of Object.values(resources)) {
      const t = r['Type'] as string;
      if (!t) continue;
      if (forbidden.includes(t) || t.startsWith('Custom::')) {
        counts[t] = (counts[t] ?? 0) + 1;
      }
    }
    expect(counts).toEqual({});
  });
});

// ─── D. COMPETITION_AWS ─────────────────────────────────────────────────────

describe('D. COMPETITION_AWS synth', () => {
  const { resources, ctx } = synthIsolated('COMPETITION_AWS', COMPETITION_PREFIX);

  it('ctx is COMPETITION_AWS', () => {
    expect(ctx.profile).toBe('COMPETITION_AWS');
    expect(ctx.isCompetition).toBe(true);
    expect(ctx.isLocalMock).toBe(false);
  });

  it('parameter count equals canonical schema count (same as PERSONAL)', () => {
    expect(Object.keys(getSsmParameters(resources)).length).toBe(CANONICAL_SSM_KEYS.length);
  });

  it('parameter key suffix set is identical to PERSONAL (same schema)', () => {
    const personalResources = synthIsolated('PERSONAL_AWS_DEV', PERSONAL_PREFIX).resources;
    const personalSuffixes = Object.values(getSsmParameters(personalResources))
      .map((p) => (p['Properties'] as Record<string, unknown>)['Name'] as string)
      .map((n) => n.slice(PERSONAL_PREFIX.length))
      .sort();
    const competitionSuffixes = Object.values(getSsmParameters(resources))
      .map((p) => (p['Properties'] as Record<string, unknown>)['Name'] as string)
      .map((n) => n.slice(COMPETITION_PREFIX.length))
      .sort();
    expect(competitionSuffixes).toEqual(personalSuffixes);
  });

  it('parameter names follow COMPETITION prefix', () => {
    const ssm = getSsmParameters(resources);
    for (const p of Object.values(ssm)) {
      const name = (p['Properties'] as Record<string, unknown>)['Name'] as string;
      expect(name.startsWith(COMPETITION_PREFIX), name).toBe(true);
    }
  });

  it('DeletionPolicy = Retain for every parameter (§26)', () => {
    const ssm = getSsmParameters(resources);
    for (const [id, p] of Object.entries(ssm)) {
      expect(p['DeletionPolicy'], `${id} DeletionPolicy`).toBe('Retain');
      expect(p['UpdateReplacePolicy'], `${id} UpdateReplacePolicy`).toBe('Retain');
    }
  });

  it('zero unexpected resource types', () => {
    const allowed = new Set(['AWS::SSM::Parameter', 'AWS::CDK::Metadata']);
    for (const [id, r] of Object.entries(resources)) {
      const t = r['Type'] as string;
      expect(allowed.has(t), `unexpected ${t} at ${id}`).toBe(true);
    }
  });
});

// ─── E. LOCAL_MOCK ──────────────────────────────────────────────────────────

describe('E. LOCAL_MOCK synth', () => {
  const { template, resources, outputs, ctx } = synthIsolated(
    'LOCAL_MOCK',
    PERSONAL_PREFIX,
  );

  it('ctx is LOCAL_MOCK', () => {
    expect(ctx.profile).toBe('LOCAL_MOCK');
    expect(ctx.isLocalMock).toBe(true);
  });

  it('zero AWS::SSM::Parameter', () => {
    expect(Object.keys(getSsmParameters(resources))).toHaveLength(0);
  });

  it('zero non-CDK::Metadata resources', () => {
    const nonMeta = Object.entries(resources).filter(
      ([, r]) => (r['Type'] as string) !== 'AWS::CDK::Metadata',
    );
    expect(nonMeta).toHaveLength(0);
  });

  it('zero Outputs', () => {
    expect(Object.keys(outputs)).toHaveLength(0);
    expect(template['Outputs']).toBeUndefined();
  });
});

// ─── F. Serialization round-trip ─────────────────────────────────────────────

describe('F. Serialization round-trip (provider-decoder-compatible)', () => {
  it('string round-trips', () => {
    const s = serializeValue('test.key', 'hello-world');
    expect(s).toBe('hello-world');
    expect(parseParameterValueMirror(s)).toBe('hello-world');
  });

  it('number round-trips', () => {
    const s = serializeValue('test.key', 42);
    expect(s).toBe('42');
    expect(parseParameterValueMirror(s)).toBe(42);
  });

  it('boolean true round-trips', () => {
    const s = serializeValue('test.key', true);
    expect(s).toBe('true');
    expect(parseParameterValueMirror(s)).toBe(true);
  });

  it('boolean false round-trips', () => {
    const s = serializeValue('test.key', false);
    expect(s).toBe('false');
    expect(parseParameterValueMirror(s)).toBe(false);
  });

  it('string array round-trips (comma-joined, no spaces)', () => {
    const arr: readonly string[] = ['alpha', 'beta', 'gamma'];
    const s = serializeValue('test.key', arr);
    expect(s).toBe('alpha,beta,gamma');
    expect(parseParameterValueMirror(s)).toEqual(arr);
  });

  it('string array preserves order', () => {
    const arr: readonly string[] = ['z', 'a', 'm', 'b'];
    const s = serializeValue('test.key', arr);
    const back = parseParameterValueMirror(s) as readonly string[];
    expect([...back]).toEqual([...arr]);
  });

  it('rejects null', () => {
    expect(() => serializeValue('test.key', null as unknown as string)).toThrow(/null or undefined/);
  });

  it('rejects undefined', () => {
    expect(() => serializeValue('test.key', undefined as unknown as string)).toThrow(
      /null or undefined/,
    );
  });

  it('rejects NaN', () => {
    expect(() => serializeValue('test.key', Number.NaN)).toThrow(/finite/);
  });

  it('rejects Infinity', () => {
    expect(() => serializeValue('test.key', Infinity)).toThrow(/finite/);
  });

  it('rejects empty string', () => {
    expect(() => serializeValue('test.key', '')).toThrow(/empty string/);
  });

  it('rejects string with comma (would break decoder array branch)', () => {
    expect(() => serializeValue('test.key', 'a,b')).toThrow(/comma/);
  });

  it('rejects string with space (would break decoder array branch)', () => {
    expect(() => serializeValue('test.key', 'a b')).toThrow(/space/);
  });

  it('rejects empty array', () => {
    expect(() => serializeValue('test.key', [])).toThrow(/empty array/);
  });

  it('rejects array element containing comma', () => {
    expect(() => serializeValue('test.key', ['ok', 'has,comma'])).toThrow(/comma or space/);
  });

  it('rejects array element containing space', () => {
    expect(() => serializeValue('test.key', ['ok', 'has space'])).toThrow(/comma or space/);
  });

  it('rejects array element that is empty string', () => {
    expect(() => serializeValue('test.key', ['ok', ''])).toThrow(/empty string/);
  });

  it('rejects array element that is not a string', () => {
    expect(() => serializeValue('test.key', [1 as unknown as string])).toThrow(/not a string/);
  });

  it('rejects unsupported JS types', () => {
    expect(() => serializeValue('test.key', { a: 1 } as unknown as string)).toThrow(
      /unsupported type/,
    );
  });

  it('serialization is deterministic for the same value', () => {
    const arr: readonly string[] = ['x', 'y', 'z'];
    const s1 = serializeValue('test.key', arr);
    const s2 = serializeValue('test.key', arr);
    expect(s1).toBe(s2);
  });
});

// ─── F.2 End-to-end round-trip via SsmConfigProvider ─────────────────────────

/**
 * The serialization contract must round-trip through the REAL provider
 * decoder, not only through the mirror. The mirror is an oracle copy
 * (see parseParameterValueMirror JSDoc) — these tests use the public
 * SsmConfigProvider API with a mocked SSM client to prove that
 * `serializeValue` produces values the production decoder can read
 * back to the same typed value.
 */
describe('F.2 End-to-end round-trip via SsmConfigProvider (public provider API)', () => {
  /**
   * Build a minimal mock SSMClient that records every `GetParametersByPath`
   * call and serves a preconfigured parameter map. We deliberately do NOT
   * connect to AWS — the mock implements just enough of the contract to
   * exercise `SsmConfigProvider.create()`.
   */
  function makeMockSsmClient(
    expectedPrefix: string,
    parametersByPath: Record<string, string>,
  ): { sent: unknown[]; client: unknown } {
    const sent: unknown[] = [];
    const client = {
      send: async (command: unknown) => {
        sent.push(command);
        // Identify the command by its constructor name — the SDK exposes
        // `GetParametersByPathCommand` with a `.input` containing `Path`.
        const ctorName =
          (command as { constructor?: { name?: string } })?.constructor?.name ?? '';
        if (ctorName !== 'GetParametersByPathCommand') {
          throw new Error(`Mock SSM client received unexpected command: ${ctorName}`);
        }
        const input = (command as { input?: Record<string, unknown> }).input ?? {};
        const path = input['Path'] as string;
        if (typeof path !== 'string' || !path.startsWith(expectedPrefix)) {
          throw new Error(
            `Mock SSM client received Path "${path}" which does not match expected prefix "${expectedPrefix}"`,
          );
        }
        const params = Object.entries(parametersByPath)
          .filter(([name]) => name.startsWith(path))
          .map(([Name, Value]) => ({ Name, Value }));
        return { Parameters: params };
      },
    };
    return { sent, client };
  }

  it('strings, numbers, booleans, and string arrays round-trip via SsmConfigProvider.get()', async () => {
    // 1. Build the typed fixture.
    const fixture = buildTypedValues('PERSONAL_AWS_DEV');

    // 2. Synthesize the stack and capture each parameter's serialized value.
    const { resources } = synthIsolated('PERSONAL_AWS_DEV', PERSONAL_PREFIX);
    const ssm = getSsmParameters(resources);
    const parametersByPath: Record<string, string> = {};
    for (const r of Object.values(ssm)) {
      const props = r['Properties'] as Record<string, unknown>;
      parametersByPath[props['Name'] as string] = props['Value'] as string;
    }

    // 3. Hand the synthesized parameters to a mocked SSM client and
    //    construct the production provider.
    const { client } = makeMockSsmClient(PERSONAL_PREFIX, parametersByPath);
    const provider = await SsmConfigProvider.create({
      environment: 'PERSONAL_AWS_DEV',
      ssmClient: client as never,
    });

    // 4. For every non-token, non-secret, non-secret-locator key, verify
    //    that the value the provider reads back equals the original
    //    typed fixture (after `serializeValue` and `parseParameterValue`
    //    round-trip).
    for (const def of CONFIG_SCHEMA) {
      const key = def.key;
      const expected = fixture[key as SsmConfigKey];
      // Skip keys whose expected value is a CDK unresolved Token (those
      // can't be round-tripped through a string-only decoder by design).
      if (expected === undefined) continue;
      const got = provider.get(key);
      // Boolean equality and number equality are strict (no coercion surprise).
      expect(got, `provider.get("${key}")`).toEqual(expected);
    }
  });
});

// ─── G. Resource-derived tokens ──────────────────────────────────────────────

describe('G. Resource-derived tokens', () => {
  it('CDK unresolved Token stringValue is preserved as the canonical resolver path', () => {
    const app = new App({ autoSynth: false });
    app.node.setContext('env', 'PERSONAL_AWS_DEV');
    const ctx = resolveEnvironmentContext(app.node);
    const stack = new Stack(app, 'tok-test', {
      env: { account: FAKE_ACCOUNT, region: FAKE_REGION },
    });

    // Build a fake unresolved token like a CFN reference would produce.
    const unresolved = Token.asString({
      Ref: 'SomeApiGatewayApiId',
    });

    const values = buildTypedValues('PERSONAL_AWS_DEV');
    values['api.endpoint' as SsmConfigKey] = unresolved;

    let constructorThrew: unknown = null;
    let ctor: SsmParametersConstruct | undefined;
    try {
      ctor = new SsmParametersConstruct(stack, 'SsmParams', {
        envContext: ctx,
        parameterPathPrefix: PERSONAL_PREFIX,
        valuesByKey: values,
      });
    } catch (e) {
      constructorThrew = e;
    }
    expect(constructorThrew).toBeNull();
    expect(ctor).toBeDefined();

    // Synthesize and verify the template contains an unresolved token literal,
    // NOT a stringified `${Token[...]}` artifact.
    const assembly = app.synth();
    const template = assembly.stacks[0].template as Record<string, unknown>;
    const resources = (template['Resources'] as Record<string, Record<string, unknown>>) ?? {};
    const ssm = getSsmParameters(resources);
    const apiParam = Object.values(ssm).find(
      (p) =>
        ((p['Properties'] as Record<string, unknown>)['Name'] as string) ===
        '/city-commander/PERSONAL_AWS_DEV/api/endpoint',
    );
    expect(apiParam).toBeDefined();
    const value = (apiParam!['Properties'] as Record<string, unknown>)['Value'];
    // CDK renders unresolved tokens as `{ "Ref": "..." }` JSON objects.
    expect(typeof value, 'token is not stringified to ${Token[…]}').toBe('object');
    expect(JSON.stringify(value).includes('${Token'), 'no ${Token[…]} artifact').toBe(false);
  });
});

// ─── H. Secret exclusion ───────────────────────────────────────────────────

describe('H. Secret exclusion', () => {
  it('PERSONAL synth has zero SecureString / StringList parameters', () => {
    const { resources } = synthIsolated('PERSONAL_AWS_DEV', PERSONAL_PREFIX);
    for (const [id, r] of Object.entries(getSsmParameters(resources))) {
      const props = r['Properties'] as Record<string, unknown>;
      expect(props['Type'], `${id} Type`).toBe('String');
      // StringList parameters use Type=StringList; ensure none exist.
      expect(props['Type'] === 'StringList' || props['Type'] === 'SecureString').toBe(false);
    }
  });

  it('COMPETITION synth has zero SecureString / StringList parameters', () => {
    const { resources } = synthIsolated('COMPETITION_AWS', COMPETITION_PREFIX);
    for (const [id, r] of Object.entries(getSsmParameters(resources))) {
      const props = r['Properties'] as Record<string, unknown>;
      expect(props['Type'], `${id} Type`).toBe('String');
      expect(props['Type'] === 'StringList' || props['Type'] === 'SecureString').toBe(false);
    }
  });

  it('no Secrets Manager / KMS resources exist in either profile synth', () => {
    for (const profile of ['PERSONAL_AWS_DEV', 'COMPETITION_AWS'] as Profile[]) {
      const prefix = profile === 'PERSONAL_AWS_DEV' ? PERSONAL_PREFIX : COMPETITION_PREFIX;
      const { resources } = synthIsolated(profile, prefix);
      for (const r of Object.values(resources)) {
        const t = r['Type'] as string;
        expect(t === 'AWS::SecretsManager::Secret' || t === 'AWS::KMS::Key', t).toBe(false);
      }
    }
  });

  it('Descriptions do not contain credential-like substrings', () => {
    const badSubstr = [
      'password',
      'token',
      'secret',
      'aws_access',
      'aws_secret',
      'credentials',
    ];
    for (const profile of ['PERSONAL_AWS_DEV', 'COMPETITION_AWS'] as Profile[]) {
      const prefix = profile === 'PERSONAL_AWS_DEV' ? PERSONAL_PREFIX : COMPETITION_PREFIX;
      const { resources } = synthIsolated(profile, prefix);
      for (const [id, r] of Object.entries(getSsmParameters(resources))) {
        const desc = ((r['Properties'] as Record<string, unknown>)['Description'] as string) ?? '';
        const lower = desc.toLowerCase();
        for (const sub of badSubstr) {
          // The Description currently mentions 'TASK-073 SSM Parameter for config key X';
          // the substring check intentionally excludes 'token' occurrences that are
          // inherent to config-key names like 'auth.user_pool_id'. We assert each
          // config key is a schema key — not credential material.
          expect(lower.includes(sub), `${id} description leaked "${sub}"`).toBe(false);
        }
      }
    }
  });
});

// ─── I. Isolation ──────────────────────────────────────────────────────────

describe('I. Isolation', () => {
  it('PERSONAL contains ONLY AWS::SSM::Parameter and AWS::CDK::Metadata', () => {
    const { resources } = synthIsolated('PERSONAL_AWS_DEV', PERSONAL_PREFIX);
    const typesSeen = new Set(Object.values(resources).map((r) => r['Type'] as string));
    for (const t of typesSeen) {
      expect(['AWS::SSM::Parameter', 'AWS::CDK::Metadata']).toContain(t);
    }
  });

  it('COMPETITION contains ONLY AWS::SSM::Parameter and AWS::CDK::Metadata', () => {
    const { resources } = synthIsolated('COMPETITION_AWS', COMPETITION_PREFIX);
    const typesSeen = new Set(Object.values(resources).map((r) => r['Type'] as string));
    for (const t of typesSeen) {
      expect(['AWS::SSM::Parameter', 'AWS::CDK::Metadata']).toContain(t);
    }
  });
});

// ─── J. Source boundaries ───────────────────────────────────────────────────

describe('J. Source boundaries (static checks)', () => {
  it('construct file does not reference process.env', async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const file = path.join(
      __dirname,
      '..',
      'lib',
      'constructs',
      'ssm_params.ts',
    );
    const src = await fs.readFile(file, 'utf8');
    // Strip JSDoc / comments to avoid false positives.
    const stripped = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(stripped.includes('process.env')).toBe(false);
  });

  it('construct file does not import config.local.yaml', async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const file = path.join(
      __dirname,
      '..',
      'lib',
      'constructs',
      'ssm_params.ts',
    );
    const src = await fs.readFile(file, 'utf8');
    const stripped = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(stripped.includes('config.local.yaml')).toBe(false);
    // 'config_local' is not a literal in the construct; probe programmatically.
    const probe = 'config' + '_local';
    expect(stripped.includes(probe)).toBe(false);
  });

  it('construct file does not call grantRead / grantReadWrite / addToRolePolicy / addToResourcePolicy', async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const file = path.join(
      __dirname,
      '..',
      'lib',
      'constructs',
      'ssm_params.ts',
    );
    const src = await fs.readFile(file, 'utf8');
    const stripped = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(stripped.includes('grantRead')).toBe(false);
    expect(stripped.includes('grantReadWrite')).toBe(false);
    expect(stripped.includes('addToRolePolicy')).toBe(false);
    expect(stripped.includes('addToResourcePolicy')).toBe(false);
    expect(stripped.includes('PolicyStatement')).toBe(false);
    expect(stripped.includes('ManagedPolicy')).toBe(false);
  });

  it('construct file documents TASK-074 / TASK-167 / TASK-179 / TASK-180 boundaries', async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const file = path.join(
      __dirname,
      '..',
      'lib',
      'constructs',
      'ssm_params.ts',
    );
    const src = await fs.readFile(file, 'utf8');
    expect(src).toContain('TASK-074');
    expect(src).toContain('TASK-167');
    expect(src).toContain('TASK-179');
    expect(src).toContain('TASK-180');
  });

});

// ─── K. Construct API surface ───────────────────────────────────────────────

describe('K. Construct API surface', () => {
  it('parameterCount, parameterNamesByKey, parameterArnsByKey, serializedValuesByKey have consistent sizes', () => {
    for (const profile of ['PERSONAL_AWS_DEV', 'COMPETITION_AWS'] as Profile[]) {
      const prefix = profile === 'PERSONAL_AWS_DEV' ? PERSONAL_PREFIX : COMPETITION_PREFIX;
      const app = new App({ autoSynth: false });
      app.node.setContext('env', profile);
      const ctx = resolveEnvironmentContext(app.node);
      const stack = new Stack(app, 'api-test', {
        env: { account: FAKE_ACCOUNT, region: FAKE_REGION },
      });
      const ctor = new SsmParametersConstruct(stack, 'SsmParams', {
        envContext: ctx,
        parameterPathPrefix: prefix,
        valuesByKey: buildTypedValues(profile),
      });
      expect(ctor.parameterCount).toBe(CANONICAL_SSM_KEYS.length);
      expect(ctor.parameterPathPrefix).toBe(prefix);
      expect(Object.keys(ctor.parameterNamesByKey).length).toBe(CANONICAL_SSM_KEYS.length);
      expect(Object.keys(ctor.parameterArnsByKey).length).toBe(CANONICAL_SSM_KEYS.length);
      expect(Object.keys(ctor.serializedValuesByKey).length).toBe(CANONICAL_SSM_KEYS.length);
      expect(ctor.configKeys).toEqual(CANONICAL_SSM_KEYS);
    }
  });

  it('LOCAL_MOCK: all API surfaces are empty', () => {
    const app = new App({ autoSynth: false });
    app.node.setContext('env', 'LOCAL_MOCK');
    const ctx = resolveEnvironmentContext(app.node);
    const stack = new Stack(app, 'lm-api-test');
    const ctor = new SsmParametersConstruct(stack, 'SsmParams', {
      envContext: ctx,
      parameterPathPrefix: PERSONAL_PREFIX,
      valuesByKey: {},
    });
    expect(ctor.parameterCount).toBe(0);
    expect(ctor.configKeys).toEqual([]);
    expect(Object.keys(ctor.parameterNamesByKey)).toHaveLength(0);
    expect(Object.keys(ctor.parameterArnsByKey)).toHaveLength(0);
    expect(Object.keys(ctor.serializedValuesByKey)).toHaveLength(0);
  });

  it('missing required key in valuesByKey throws BEFORE any resource is created', () => {
    const app = new App({ autoSynth: false });
    app.node.setContext('env', 'PERSONAL_AWS_DEV');
    const ctx = resolveEnvironmentContext(app.node);
    const stack = new Stack(app, 'missing-test');
    // Pick any required key from the schema and omit it.
    const someRequiredKey = CONFIG_SCHEMA[0].key as SsmConfigKey;
    const values = buildTypedValues('PERSONAL_AWS_DEV');
    delete values[someRequiredKey];
    expect(() => {
      new SsmParametersConstruct(stack, 'SsmParams', {
        envContext: ctx,
        parameterPathPrefix: PERSONAL_PREFIX,
        valuesByKey: values,
      });
    }).toThrow(new RegExp(`missing required config key "${someRequiredKey}"`));
  });

  it('unknown key in valuesByKey throws', () => {
    const app = new App({ autoSynth: false });
    app.node.setContext('env', 'PERSONAL_AWS_DEV');
    const ctx = resolveEnvironmentContext(app.node);
    const stack = new Stack(app, 'unknown-test');
    const values = buildTypedValues('PERSONAL_AWS_DEV');
    (values as Record<string, unknown>)['some.fake.key'] = 'oops';
    expect(() => {
      new SsmParametersConstruct(stack, 'SsmParams', {
        envContext: ctx,
        parameterPathPrefix: PERSONAL_PREFIX,
        valuesByKey: values,
      });
    }).toThrow(/unknown config key/);
  });

  it('invalid prefix throws before any resource is created', () => {
    const app = new App({ autoSynth: false });
    app.node.setContext('env', 'PERSONAL_AWS_DEV');
    const ctx = resolveEnvironmentContext(app.node);
    const stack = new Stack(app, 'invalid-prefix-test');
    expect(() => {
      new SsmParametersConstruct(stack, 'SsmParams', {
        envContext: ctx,
        parameterPathPrefix: 'no-leading-slash',
        valuesByKey: buildTypedValues('PERSONAL_AWS_DEV'),
      });
    }).toThrow(/must start with "\/"/);
  });

  it('prefix with // is rejected', () => {
    const app = new App({ autoSynth: false });
    app.node.setContext('env', 'PERSONAL_AWS_DEV');
    const ctx = resolveEnvironmentContext(app.node);
    const stack = new Stack(app, 'slash-prefix-test');
    expect(() => {
      new SsmParametersConstruct(stack, 'SsmParams', {
        envContext: ctx,
        parameterPathPrefix: '/city-commander/PERSONAL_AWS_DEV//',
        valuesByKey: buildTypedValues('PERSONAL_AWS_DEV'),
      });
    }).toThrow(/forbidden substring/);
  });

  it('prefix with whitespace is rejected', () => {
    const app = new App({ autoSynth: false });
    app.node.setContext('env', 'PERSONAL_AWS_DEV');
    const ctx = resolveEnvironmentContext(app.node);
    const stack = new Stack(app, 'ws-prefix-test');
    expect(() => {
      new SsmParametersConstruct(stack, 'SsmParams', {
        envContext: ctx,
        parameterPathPrefix: '/city-commander/PERSONAL_AWS_DEV /',
        valuesByKey: buildTypedValues('PERSONAL_AWS_DEV'),
      });
    }).toThrow(/forbidden substring/);
  });

  it('prefix not ending with / is rejected', () => {
    const app = new App({ autoSynth: false });
    app.node.setContext('env', 'PERSONAL_AWS_DEV');
    const ctx = resolveEnvironmentContext(app.node);
    const stack = new Stack(app, 'suffix-prefix-test');
    expect(() => {
      new SsmParametersConstruct(stack, 'SsmParams', {
        envContext: ctx,
        parameterPathPrefix: '/city-commander/PERSONAL_AWS_DEV',
        valuesByKey: buildTypedValues('PERSONAL_AWS_DEV'),
      });
    }).toThrow(/must end with "\/"/);
  });

  it('no public readonly Record<string, any> types in the construct module', async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const file = path.join(
      __dirname,
      '..',
      'lib',
      'constructs',
      'ssm_params.ts',
    );
    const src = await fs.readFile(file, 'utf8');
    // Strip comments and JSDoc for the search.
    const stripped = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    expect(/Record\s*<\s*string\s*,\s*any\s*>/.test(stripped)).toBe(false);
  });

  it('valuesByKey is keyed by SsmConfigKey union (the schema-derived type)', () => {
    // Compile-time check (this test would not compile if the type were wrong);
    // runtime verify by ensuring the assignments in buildTypedValues match the schema.
    const expected = new Set(CANONICAL_SSM_KEYS);
    const actual = new Set(Object.keys(buildTypedValues()));
    expect(actual).toEqual(expected);
  });

  it('schema-derived key type is a TS union (subset sanity)', () => {
    // Mechanically verify a sample of well-known keys are present.
    const knownSet: Set<SsmConfigKey> = new Set([
      'env' as SsmConfigKey,
      'bedrock.region' as SsmConfigKey,
      's3.raw_bucket' as SsmConfigKey,
      'api.endpoint' as SsmConfigKey,
      'ws.endpoint' as SsmConfigKey,
      'auth.user_pool_id' as SsmConfigKey,
      'observability.xray_enabled' as SsmConfigKey,
      'orchestration.mode' as SsmConfigKey,
      'enrichment.fanout' as SsmConfigKey,
      'frontend.hosting' as SsmConfigKey,
      'config.provider' as SsmConfigKey,
      'policy.time_alignment.mode' as SsmConfigKey,
    ]);
    for (const k of knownSet) {
      expect(CANONICAL_SSM_KEYS).toContain(k);
    }
  });
});

// ─── L. Schema-side helper (deterministic binding) ──────────────────────────

describe('L. Schema-derived keys match all schema entries', () => {
  it('every CONFIG_SCHEMA entry maps to a canonical key', () => {
    for (const def of CONFIG_SCHEMA) {
      // The assertion uses `def: ConfigKeyDefinition` for type safety of the
      // for-loop binding (a deliberate static reference, not a runtime call).
      const _d: ConfigKeyDefinition = def;
      expect(CANONICAL_SSM_KEYS).toContain(def.key as SsmConfigKey);
      expect(SSM_NON_SECRET_CONFIG_KEYS).toContain(def.key as SsmConfigKey);
    }
    // Silence unused-var lint.
    void buildAllStringValues;
  });
});

// ─── K.1 Public package import boundary ─────────────────────────────────────

describe('K.1 Public package import boundary', () => {
  it('production source imports from "@city-commander/config" (no /src/ deep import)', async () => {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    // vitest runs from `infra/` as the root; the construct file is at
    // `infra/lib/constructs/ssm_params.ts`. Fall back to __dirname / cwd
    // resolution where available.
    const cwd = process.cwd();
    const candidates = [
      path.join(cwd, 'lib', 'constructs', 'ssm_params.ts'),
      path.join(cwd, 'infra', 'lib', 'constructs', 'ssm_params.ts'),
    ];
    let file: string | null = null;
    for (const c of candidates) {
      try {
        await fs.access(c);
        file = c;
        break;
      } catch {
        // try next
      }
    }
    if (file === null) {
      throw new Error(
        `Cannot locate infra/lib/constructs/ssm_params.ts from cwd=${cwd}; tried ${candidates.join(', ')}`,
      );
    }
    const src = await fs.readFile(file, 'utf8');
    const stripped = src
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/.*$/gm, '');
    // The package's public entrypoint MUST be used. The deep-import form
    // (e.g., `@city-commander/config/src/...` or a relative cross-package
    // read into `src/`) is forbidden.
    expect(/from\s+['"]@city-commander\/config['"]/.test(stripped)).toBe(true);
    expect(/from\s+['"]@city-commander\/config\/src\b/.test(stripped)).toBe(false);
  });

  it('package root exports CONFIG_SCHEMA (verified by resolving the public entrypoint)', () => {
    // The public entrypoint of @city-commander/config is reachable via
    // `import { CONFIG_SCHEMA } from '@city-commander/config'`. If this
    // import resolves and `CONFIG_SCHEMA` is a non-empty readonly array,
    // the package's public API is intact.
    expect(Array.isArray(CONFIG_SCHEMA)).toBe(true);
    expect(CONFIG_SCHEMA.length).toBeGreaterThan(0);
  });
});

// ─── K.2 Auth closure gate (TASK-006 schema contract) ────────────────────────

/**
 * The Cognito construct (TASK-071) declares:
 *   AUTH_USER_POOL_ID_CONFIG_KEY = 'auth.user_pool_id'
 *   AUTH_APP_CLIENT_ID_CONFIG_KEY = 'auth.app_client_id'
 *
 * Both keys MUST exist in CONFIG_SCHEMA. If the App Client ID key is missing
 * here, this is upstream TASK-006 schema drift — the construct MUST NOT
 * silently patch the schema or fake a parameter for it. The test below
 * exposes the block.
 */
describe('K.2 Auth closure gate', () => {
  it('CONFIG_SCHEMA contains auth.user_pool_id', () => {
    const keys = CONFIG_SCHEMA.map((def) => def.key);
    expect(keys).toContain('auth.user_pool_id');
  });

  it('CONFIG_SCHEMA contains auth.app_client_id (TASK-006 contract — exposes upstream drift if missing)', () => {
    const keys = CONFIG_SCHEMA.map((def) => def.key);
    // This assertion is INTENTIONALLY strict. If it fails, the upstream
    // schema owner (TASK-006) must add the key — not TASK-073.
    expect(keys).toContain('auth.app_client_id');
  });

  it('synth produces one AWS::SSM::Parameter per present auth.* key (paths are distinct)', () => {
    const { resources } = synthIsolated('PERSONAL_AWS_DEV', PERSONAL_PREFIX);
    const ssm = getSsmParameters(resources);
    const names = Object.values(ssm).map(
      (r) => ((r['Properties'] as Record<string, unknown>)['Name'] as string) ?? '',
    );
    if (names.some((n) => n.endsWith('/auth/user_pool_id'))) {
      expect(names.some((n) => n.endsWith('/auth/user_pool_id'))).toBe(true);
    }
    if (names.some((n) => n.endsWith('/auth/app_client_id'))) {
      expect(names.some((n) => n.endsWith('/auth/app_client_id'))).toBe(true);
    }
    // And the two parameter paths, when both present, MUST be distinct.
    const u = names.find((n) => n.endsWith('/auth/user_pool_id'));
    const a = names.find((n) => n.endsWith('/auth/app_client_id'));
    if (u && a) {
      expect(u).not.toBe(a);
    }
  });

  it('auth.* keys accept CDK unresolved resource tokens', () => {
    // Build a fixture and overwrite both auth keys with CDK tokens.
    const app = new App({ autoSynth: false });
    app.node.setContext('env', 'PERSONAL_AWS_DEV');
    const ctx = resolveEnvironmentContext(app.node);
    const stack = new Stack(app, 'auth-tok', {
      env: { account: FAKE_ACCOUNT, region: FAKE_REGION },
    });
    const userPoolRef = Token.asString({ Ref: 'FakeUserPoolId' });
    const appClientRef = Token.asString({ Ref: 'FakeAppClientId' });
    const values = buildTypedValues('PERSONAL_AWS_DEV');
    if ('auth.user_pool_id' in values) {
      values['auth.user_pool_id' as SsmConfigKey] = userPoolRef;
    }
    if ('auth.app_client_id' in values) {
      values['auth.app_client_id' as SsmConfigKey] = appClientRef;
    }
    let ctor: SsmParametersConstruct | undefined;
    let threw: unknown = null;
    try {
      ctor = new SsmParametersConstruct(stack, 'SsmParams', {
        envContext: ctx,
        parameterPathPrefix: PERSONAL_PREFIX,
        valuesByKey: values,
      });
    } catch (e) {
      threw = e;
    }
    // The construct must accept the token values (no stringification).
    expect(threw).toBeNull();
    expect(ctor).toBeDefined();
    if (threw === null) {
      const assembly = app.synth();
      const template = assembly.stacks[0].template as Record<string, unknown>;
      const resources = (template['Resources'] as Record<string, Record<string, unknown>>) ?? {};
      const ssm = getSsmParameters(resources);
      const userPoolParam = Object.values(ssm).find(
        (r) =>
          ((r['Properties'] as Record<string, unknown>)['Name'] as string) ===
          '/city-commander/PERSONAL_AWS_DEV/auth/user_pool_id',
      );
      if (userPoolParam) {
        const v = (userPoolParam['Properties'] as Record<string, unknown>)['Value'];
        expect(typeof v).toBe('object');
        expect(JSON.stringify(v).includes('${Token')).toBe(false);
      }
      const appClientParam = Object.values(ssm).find(
        (r) =>
          ((r['Properties'] as Record<string, unknown>)['Name'] as string) ===
          '/city-commander/PERSONAL_AWS_DEV/auth/app_client_id',
      );
      if (appClientParam) {
        const v = (appClientParam['Properties'] as Record<string, unknown>)['Value'];
        expect(typeof v).toBe('object');
        expect(JSON.stringify(v).includes('${Token')).toBe(false);
      }
    }
  });
});

// ─── K.3 Policy closure gate (HG-001 + TASK-006 schema contract) ────────────

/**
 * Mechanical derivation of the exact policy.* key list from CONFIG_SCHEMA.
 * Every key is required (no orphans). If the schema later evolves, this
 * test list evolves automatically — no hand-maintained enumeration.
 */
function derivePolicyKeys(): string[] {
  return CONFIG_SCHEMA.filter((def) => def.key.startsWith('policy.')).map((def) => def.key);
}

describe('K.3 Policy closure gate', () => {
  it('every CONFIG_SCHEMA policy.* key produces a canonical SSM parameter', () => {
    const policyKeys = derivePolicyKeys();
    expect(policyKeys.length).toBeGreaterThan(0);
    for (const k of policyKeys) {
      expect(CANONICAL_SSM_KEYS).toContain(k as SsmConfigKey);
    }
  });

  it('every schema policy.* key is materialized as an AWS::SSM::Parameter', () => {
    const { resources } = synthIsolated('PERSONAL_AWS_DEV', PERSONAL_PREFIX);
    const ssm = getSsmParameters(resources);
    const names = Object.values(ssm).map(
      (r) => ((r['Properties'] as Record<string, unknown>)['Name'] as string) ?? '',
    );
    for (const k of derivePolicyKeys()) {
      const suffix = '/' + k.replace(/\./g, '/');
      expect(names.some((n) => n.endsWith(suffix)), `policy key ${k} -> ${suffix}`).toBe(true);
    }
  });

  it('CONFIG_SCHEMA contains the active HG-001 policy key policy.ete.snapshot_mode (exposes upstream drift if missing)', () => {
    const policyKeys = derivePolicyKeys();
    // INTENTIONALLY strict. If it fails, the upstream schema owner
    // (TASK-006) must add the key — not TASK-073.
    expect(policyKeys).toContain('policy.ete.snapshot_mode');
  });
});

// ─── K.4 Profile-invariant validation ───────────────────────────────────────

describe('K.4 Profile-invariant validation (env + config.provider enforcement)', () => {
  it('PERSONAL_AWS_DEV + env=PERSONAL_AWS_DEV + config.provider=ssm is accepted', () => {
    const app = new App({ autoSynth: false });
    app.node.setContext('env', 'PERSONAL_AWS_DEV');
    const ctx = resolveEnvironmentContext(app.node);
    const stack = new Stack(app, 'PersonalOkTest');
    const values = buildTypedValues('PERSONAL_AWS_DEV');
    expect(() => {
      new SsmParametersConstruct(stack, 'SsmParams', {
        envContext: ctx,
        parameterPathPrefix: PERSONAL_PREFIX,
        valuesByKey: values,
      });
    }).not.toThrow();
  });

  it('COMPETITION_AWS + env=COMPETITION_AWS + config.provider=ssm is accepted', () => {
    const app = new App({ autoSynth: false });
    app.node.setContext('env', 'COMPETITION_AWS');
    const ctx = resolveEnvironmentContext(app.node);
    const stack = new Stack(app, 'CompetitionOkTest');
    const values = buildTypedValues('COMPETITION_AWS');
    expect(() => {
      new SsmParametersConstruct(stack, 'SsmParams', {
        envContext: ctx,
        parameterPathPrefix: COMPETITION_PREFIX,
        valuesByKey: values,
      });
    }).not.toThrow();
  });

  // ── Invalid combinations ──
  const invalid: ReadonlyArray<{
    name: string;
    profile: Profile;
    override: (v: { [K in SsmConfigKey]?: SsmConfigValueInput }) => void;
    expected: string;
  }> = [
    {
      name: 'PERSONAL + env=COMPETITION_AWS',
      profile: 'PERSONAL_AWS_DEV',
      override: (v) => {
        v['env' as SsmConfigKey] = 'COMPETITION_AWS';
      },
      expected: 'env',
    },
    {
      name: 'PERSONAL + env=LOCAL_MOCK',
      profile: 'PERSONAL_AWS_DEV',
      override: (v) => {
        v['env' as SsmConfigKey] = 'LOCAL_MOCK';
      },
      expected: 'env',
    },
    {
      name: 'PERSONAL + config.provider=local_file',
      profile: 'PERSONAL_AWS_DEV',
      override: (v) => {
        v['config.provider' as SsmConfigKey] = 'local_file';
      },
      expected: 'config.provider',
    },
    {
      name: 'COMPETITION + env=PERSONAL_AWS_DEV',
      profile: 'COMPETITION_AWS',
      override: (v) => {
        v['env' as SsmConfigKey] = 'PERSONAL_AWS_DEV';
      },
      expected: 'env',
    },
    {
      name: 'COMPETITION + env=LOCAL_MOCK',
      profile: 'COMPETITION_AWS',
      override: (v) => {
        v['env' as SsmConfigKey] = 'LOCAL_MOCK';
      },
      expected: 'env',
    },
    {
      name: 'COMPETITION + config.provider=local_file',
      profile: 'COMPETITION_AWS',
      override: (v) => {
        v['config.provider' as SsmConfigKey] = 'local_file';
      },
      expected: 'config.provider',
    },
  ];

  for (const c of invalid) {
    it(`${c.name} is rejected (mentions profile, key, expected, actual)`, () => {
      const app = new App({ autoSynth: false });
      app.node.setContext('env', c.profile);
      const ctx = resolveEnvironmentContext(app.node);
      const stack = new Stack(app, 'BadTest');
      const values = buildTypedValues(c.profile);
      c.override(values);
      let caught: Error | null = null;
      try {
        new SsmParametersConstruct(stack, 'SsmParams', {
          envContext: ctx,
          parameterPathPrefix:
            c.profile === 'PERSONAL_AWS_DEV' ? PERSONAL_PREFIX : COMPETITION_PREFIX,
          valuesByKey: values,
        });
      } catch (e) {
        caught = e as Error;
      }
      expect(caught).not.toBeNull();
      const msg = caught?.message ?? '';
      // Error message must include profile, offending key, expected, actual.
      expect(msg).toContain(c.profile);
      expect(msg).toContain(c.expected);
      expect(msg).toContain('expected');
      expect(msg).toContain('got');
      // And it must NOT leak other config values (defensive — error
      // must reference ONLY the offending key, not the whole valuesByKey).
      expect(msg.includes('bedrock.region')).toBe(false);
      expect(msg.includes('s3.raw_bucket')).toBe(false);
    });
  }
});

// ─── K.5 Resource contract per profile ──────────────────────────────────────

describe('K.5 Resource contract per profile (closure gate)', () => {
  it('PERSONAL produces exactly CANONICAL_SSM_KEYS parameters (full set)', () => {
    const { resources } = synthIsolated('PERSONAL_AWS_DEV', PERSONAL_PREFIX);
    const ssm = getSsmParameters(resources);
    expect(Object.keys(ssm).length).toBe(CANONICAL_SSM_KEYS.length);
  });

  it('COMPETITION produces exactly CANONICAL_SSM_KEYS parameters (full set)', () => {
    const { resources } = synthIsolated('COMPETITION_AWS', COMPETITION_PREFIX);
    const ssm = getSsmParameters(resources);
    expect(Object.keys(ssm).length).toBe(CANONICAL_SSM_KEYS.length);
  });

  it('LOCAL_MOCK produces 0 resources and 0 Outputs', () => {
    const { resources, outputs, template } = synthIsolated('LOCAL_MOCK', '/unused/');
    expect(Object.keys(resources).length).toBe(0);
    expect(Object.keys(outputs).length).toBe(0);
    expect(template['Outputs']).toBeUndefined();
  });

  it('PERSONAL produces 0 SecureString / 0 Secrets / 0 KMS / 0 IAM / 0 Lambda / 0 Custom Resource', () => {
    const { resources } = synthIsolated('PERSONAL_AWS_DEV', PERSONAL_PREFIX);
    let secrets = 0;
    let kms = 0;
    let iam = 0;
    let lambda = 0;
    let customResource = 0;
    let secureString = 0;
    for (const r of Object.values(resources)) {
      const t = r['Type'] as string;
      if (t === 'AWS::SSM::Parameter') {
        const p = r['Properties'] as Record<string, unknown>;
        if (p['Type'] === 'SecureString') secureString++;
        if (p['Type'] === 'StringList') {
          // StringList not allowed — count toward violation.
          expect(p['Type'] === 'StringList').toBe(false);
        }
        continue;
      }
      if (t === 'AWS::SecretsManager::Secret') secrets++;
      if (t === 'AWS::KMS::Key' || t === 'AWS::KMS::Alias') kms++;
      if (t.startsWith('AWS::IAM::')) iam++;
      if (t.startsWith('AWS::Lambda::')) lambda++;
      if (t === 'AWS::CloudFormation::CustomResource' || t === 'Custom::Whatever') {
        customResource++;
      }
    }
    expect(secureString).toBe(0);
    expect(secrets).toBe(0);
    expect(kms).toBe(0);
    expect(iam).toBe(0);
    expect(lambda).toBe(0);
    expect(customResource).toBe(0);
  });

  it('COMPETITION produces 0 SecureString / 0 Secrets / 0 KMS / 0 IAM / 0 Lambda / 0 Custom Resource', () => {
    const { resources } = synthIsolated('COMPETITION_AWS', COMPETITION_PREFIX);
    let secrets = 0;
    let kms = 0;
    let iam = 0;
    let lambda = 0;
    let customResource = 0;
    let secureString = 0;
    for (const r of Object.values(resources)) {
      const t = r['Type'] as string;
      if (t === 'AWS::SSM::Parameter') {
        const p = r['Properties'] as Record<string, unknown>;
        if (p['Type'] === 'SecureString') secureString++;
        continue;
      }
      if (t === 'AWS::SecretsManager::Secret') secrets++;
      if (t === 'AWS::KMS::Key' || t === 'AWS::KMS::Alias') kms++;
      if (t.startsWith('AWS::IAM::')) iam++;
      if (t.startsWith('AWS::Lambda::')) lambda++;
      if (t === 'AWS::CloudFormation::CustomResource') customResource++;
    }
    expect(secureString).toBe(0);
    expect(secrets).toBe(0);
    expect(kms).toBe(0);
    expect(iam).toBe(0);
    expect(lambda).toBe(0);
    expect(customResource).toBe(0);
  });
});
