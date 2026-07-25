/**
 * SsmConfigProvider — AWS-backed config via SSM Parameter Store.
 *
 * Used for PERSONAL_AWS_DEV and COMPETITION_AWS environments.
 * Reads parameters by key prefix from SSM Parameter Store.
 *
 * Key mapping:
 *   Config key "bedrock.region" -> SSM path "/city-commander/{env}/bedrock/region"
 *   Config key "policy.time_alignment.mode" -> SSM path "/city-commander/{env}/policy/time_alignment/mode"
 *
 * Failure handling:
 * - SSM unavailable -> ConfigLoadError (fail-closed, no silent fallback to hard-coded values)
 * - Missing required parameter -> ConfigKeyMissingError (explicit error)
 *
 * @module config/ssm_config_provider
 */

import { SSMClient, GetParametersByPathCommand } from '@aws-sdk/client-ssm';
import { ConfigProvider, ConfigKeyMissingError, ConfigLoadError } from './config_provider.js';

/**
 * Options for constructing an SsmConfigProvider.
 */
export interface SsmConfigProviderOptions {
  /** Environment name used in the SSM path prefix (e.g., "PERSONAL_AWS_DEV", "COMPETITION_AWS") */
  environment: string;
  /** Optional SSM prefix base (defaults to "/city-commander") */
  prefixBase?: string;
  /** Optional pre-configured SSMClient (useful for testing / mocking) */
  ssmClient?: SSMClient;
  /** Optional AWS region for SSMClient (ignored if ssmClient is provided) */
  region?: string;
}

/**
 * Convert an SSM parameter path to a dot-notation config key.
 *
 * SSM path: "/city-commander/COMPETITION_AWS/bedrock/region"
 * Prefix:   "/city-commander/COMPETITION_AWS/"
 * Result:   "bedrock.region"
 *
 * Underscores in SSM path segments map to underscores in keys (no conversion).
 * Path separators "/" map to dots ".".
 */
function ssmPathToConfigKey(path: string, prefix: string): string {
  const relativePath = path.slice(prefix.length);
  return relativePath.replace(/\//g, '.');
}

/**
 * Parse an SSM parameter value to the appropriate type.
 * SSM stores everything as strings, so we apply heuristic type coercion.
 */
function parseParameterValue(value: string): string | number | boolean | readonly string[] {
  // Boolean
  if (value === 'true') return true;
  if (value === 'false') return false;

  // Comma-separated arrays (StringList style or our convention)
  if (value.includes(',') && !value.includes(' ')) {
    return Object.freeze(value.split(',').map((s) => s.trim()));
  }

  // Number
  const num = Number(value);
  if (value !== '' && !Number.isNaN(num) && Number.isFinite(num)) {
    return num;
  }

  return value;
}

/**
 * SsmConfigProvider reads configuration from AWS SSM Parameter Store.
 *
 * It loads all parameters under the path prefix at construction time
 * and caches them in memory for synchronous access via get()/getAll().
 *
 * Fail-closed behavior:
 * - SSM unreachable -> throws ConfigLoadError (never silently falls back)
 * - Missing required key -> throws ConfigKeyMissingError
 */
export class SsmConfigProvider implements ConfigProvider {
  private readonly flatConfig: Record<string, string | number | boolean | readonly string[]>;

  /**
   * Private constructor — use the static `create()` method for async initialization.
   */
  private constructor(flatConfig: Record<string, string | number | boolean | readonly string[]>) {
    this.flatConfig = flatConfig;
  }

  /**
   * Creates an SsmConfigProvider by loading all parameters from SSM.
   *
   * This is async because SSM calls are async. Once created, all access is synchronous.
   *
   * @throws ConfigLoadError if SSM is unreachable or returns an error
   */
  static async create(options: SsmConfigProviderOptions): Promise<SsmConfigProvider> {
    const { environment, prefixBase = '/city-commander', ssmClient, region } = options;

    const client = ssmClient ?? new SSMClient(region ? { region } : {});
    const pathPrefix = `${prefixBase}/${environment}/`;

    const flatConfig: Record<string, string | number | boolean | readonly string[]> = {};

    try {
      let nextToken: string | undefined;
      do {
        const command = new GetParametersByPathCommand({
          Path: pathPrefix,
          Recursive: true,
          WithDecryption: true,
          NextToken: nextToken,
        });

        const response = await client.send(command);

        if (response.Parameters) {
          for (const param of response.Parameters) {
            if (param.Name && param.Value !== undefined) {
              const key = ssmPathToConfigKey(param.Name, pathPrefix);
              flatConfig[key] = parseParameterValue(param.Value);
            }
          }
        }

        nextToken = response.NextToken;
      } while (nextToken);
    } catch (err: unknown) {
      throw new ConfigLoadError(
        `Failed to load configuration from SSM Parameter Store (prefix: ${pathPrefix}): ${
          err instanceof Error ? err.message : String(err)
        }`,
        err,
      );
    }

    return new SsmConfigProvider(flatConfig);
  }

  get(key: string): string | number | boolean | readonly string[] {
    const value = this.flatConfig[key];
    if (value === undefined) {
      throw new ConfigKeyMissingError(key);
    }
    return value;
  }

  getAll(prefix: string): Record<string, string | number | boolean | readonly string[]> {
    const result: Record<string, string | number | boolean | readonly string[]> = {};
    const prefixDot = prefix + '.';
    for (const [key, value] of Object.entries(this.flatConfig)) {
      if (key === prefix || key.startsWith(prefixDot)) {
        result[key] = value;
      }
    }
    return result;
  }
}
