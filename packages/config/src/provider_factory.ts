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
 * 3. No default — throws if neither is provided
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

/**
 * Options for creating a ConfigProvider via the factory.
 */
export interface ProviderFactoryOptions {
  /** Explicit profile override. If not provided, reads from CITY_COMMANDER_ENV env var. */
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
 * @throws ConfigLoadError if no profile can be determined
 */
function resolveProfile(options: ProviderFactoryOptions): EnvironmentProfile {
  if (options.profile) {
    return options.profile;
  }

  const env = options.env ?? process.env;
  const envProfile = env['CITY_COMMANDER_ENV'];

  if (envProfile) {
    const valid: EnvironmentProfile[] = ['LOCAL_MOCK', 'PERSONAL_AWS_DEV', 'COMPETITION_AWS'];
    if (!valid.includes(envProfile as EnvironmentProfile)) {
      throw new ConfigLoadError(
        `Invalid environment profile "${envProfile}". Must be one of: ${valid.join(', ')}`,
      );
    }
    return envProfile as EnvironmentProfile;
  }

  throw new ConfigLoadError(
    'Cannot determine environment profile. Provide `profile` option or set CITY_COMMANDER_ENV environment variable.',
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
