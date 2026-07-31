/**
 * Provider Factory — selects the correct ConfigProvider implementation per environment profile.
 *
 * Environment profiles:
 * - LOCAL_MOCK        -> LocalFileConfigProvider (offline, zero AWS calls)
 * - PERSONAL_AWS_DEV  -> SsmConfigProvider (SSM Parameter Store)
 * - COMPETITION_AWS   -> SsmConfigProvider (SSM Parameter Store)
 *
 * Never silently falls back to hard-coded values.
 * Profile determination order:
 * 1. Explicit `profile` parameter (if provided)
 * 2. Environment variable `CITY_COMMANDER_ENV`
 * 3. Environment variable `APP_ENV` (the name CDK injects into every Lambda)
 * 4. No default — throws if none is provided
 *
 * ## Why two environment variable names
 *
 * `infra/lib/constructs/lambdas.ts` injects the profile as `APP_ENV` and treats
 * that key as reserved (an override throws at synth time), while this factory
 * was written against `CITY_COMMANDER_ENV`. Nothing bridged the two, so a
 * deployed Lambda would have a correctly-populated `APP_ENV`, no
 * `CITY_COMMANDER_ENV`, and would throw `ConfigLoadError` on the first
 * `createConfigProvider()` call — a cold-start crash on every invocation, with a
 * message pointing at a variable the infrastructure never sets.
 *
 * Reading both closes that gap without either side having to move first.
 * `CITY_COMMANDER_ENV` keeps precedence so a local shell can still override a
 * deployed value. See {@link PROFILE_ENV_KEYS}.
 *
 * @module config/provider_factory
 */

import { ConfigProvider, ConfigLoadError } from './config_provider.js';
import { LocalFileConfigProvider } from './local_file_config_provider.js';
import { SsmConfigProvider, type SsmConfigProviderOptions } from './ssm_config_provider.js';

/**
 * Valid environment profile names.
 */
export type EnvironmentProfile = 'LOCAL_MOCK' | 'PERSONAL_AWS_DEV' | 'COMPETITION_AWS';

/** The three valid profile names, in canonical order. */
const VALID_PROFILES: readonly EnvironmentProfile[] = [
  'LOCAL_MOCK',
  'PERSONAL_AWS_DEV',
  'COMPETITION_AWS',
];

/**
 * Environment variable names consulted for the profile, in precedence order.
 *
 * - `CITY_COMMANDER_ENV` — this package's original contract. First, so a local
 *   shell export can override whatever the platform injected.
 * - `APP_ENV` — what CDK actually sets on every runtime Lambda
 *   (`LAMBDA_ENV_APP_ENV` in `infra/lib/constructs/lambdas.ts`).
 *
 * Kept as an ordered tuple rather than an `??` chain so the error messages can
 * name every key that was checked, and so a third name can be added in one place.
 */
export const PROFILE_ENV_KEYS: readonly string[] = ['CITY_COMMANDER_ENV', 'APP_ENV'];

/**
 * Options for creating a ConfigProvider via the factory.
 */
export interface ProviderFactoryOptions {
  /**
   * Explicit profile override. If not provided, reads `CITY_COMMANDER_ENV` and
   * then `APP_ENV` (see {@link PROFILE_ENV_KEYS}).
   */
  profile?: EnvironmentProfile;

  /** Path to local YAML config file (used for LOCAL_MOCK). Defaults to config/config.local.yaml relative to cwd. */
  localConfigPath?: string;

  /** SSM prefix base (used for AWS profiles). Defaults to "/city-commander". */
  ssmPrefixBase?: string;

  /** Optional pre-configured SSMClient (for testing). Passed through to SsmConfigProvider. */
  ssmClient?: SsmConfigProviderOptions['ssmClient'];

  /** Optional AWS region (for SSM). Defaults to SDK default. */
  region?: string;

  /** Optional environment variables map (defaults to process.env) */
  env?: Record<string, string | undefined>;
}

/**
 * Determines the active environment profile.
 *
 * Consults {@link PROFILE_ENV_KEYS} in order. A key that is absent, empty, or
 * whitespace-only is skipped, so a Lambda that has `CITY_COMMANDER_ENV=""` set by
 * a stray `environment` block still resolves through `APP_ENV` instead of dying
 * on a value that carries no information.
 *
 * A key that is PRESENT and non-empty but not a valid profile throws rather than
 * falling through to the next key. Falling through would let a typo
 * (`CITY_COMMANDER_ENV=PERSONAL_AWS`) silently resolve to a different profile —
 * potentially pointing a dev shell at `COMPETITION_AWS` — which is exactly the
 * "never silently falls back" rule this module exists to enforce.
 *
 * @throws ConfigLoadError if no profile can be determined, or if a profile
 *   variable holds an unrecognised value
 */
function resolveProfile(options: ProviderFactoryOptions): EnvironmentProfile {
  if (options.profile) {
    return options.profile;
  }

  const env = options.env ?? process.env;

  for (const key of PROFILE_ENV_KEYS) {
    const raw = env[key];
    if (raw === undefined || raw === null) continue;

    const candidate = raw.trim();
    if (candidate === '') continue;

    if (!VALID_PROFILES.includes(candidate as EnvironmentProfile)) {
      throw new ConfigLoadError(
        `Invalid environment profile "${candidate}" from ${key}. ` +
          `Must be one of: ${VALID_PROFILES.join(', ')}`,
      );
    }
    return candidate as EnvironmentProfile;
  }

  throw new ConfigLoadError(
    'Cannot determine environment profile. Provide the `profile` option or set one of: ' +
      `${PROFILE_ENV_KEYS.join(', ')}.`,
  );
}

/**
 * Creates the appropriate ConfigProvider for the active environment profile.
 *
 * - LOCAL_MOCK: returns LocalFileConfigProvider (sync, offline)
 * - PERSONAL_AWS_DEV / COMPETITION_AWS: returns SsmConfigProvider (async, SSM Parameter Store)
 *
 * Never silently falls back to hard-coded values.
 *
 * @throws ConfigLoadError if profile cannot be determined or provider cannot be created
 */
export async function createConfigProvider(
  options: ProviderFactoryOptions = {},
): Promise<ConfigProvider> {
  const profile = resolveProfile(options);

  switch (profile) {
    case 'LOCAL_MOCK': {
      const localPath = options.localConfigPath ?? 'config/config.local.yaml';
      return new LocalFileConfigProvider({
        filePath: localPath,
        env: options.env as Record<string, string | undefined>,
      });
    }

    case 'PERSONAL_AWS_DEV':
    case 'COMPETITION_AWS': {
      return SsmConfigProvider.create({
        environment: profile,
        prefixBase: options.ssmPrefixBase,
        ssmClient: options.ssmClient,
        region: options.region,
      });
    }

    default: {
      // Exhaustive check
      const _exhaustive: never = profile;
      throw new ConfigLoadError(`Unhandled profile: ${_exhaustive}`);
    }
  }
}
