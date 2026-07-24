/**
 * ConfigProvider interface — the single entry point for configuration access.
 *
 * All config consumers use this interface regardless of environment.
 * - LOCAL_MOCK: backed by LocalFileConfigProvider (YAML + env overrides)
 * - PERSONAL_AWS_DEV / COMPETITION_AWS: backed by SsmConfigProvider (future)
 *
 * @module config/config_provider
 */

/**
 * Error thrown when a required config key is missing.
 * Per spec: missing key -> typed error (not silent default for required keys).
 */
export class ConfigKeyMissingError extends Error {
  public readonly key: string;

  constructor(key: string) {
    super(`Required configuration key missing: "${key}"`);
    this.name = 'ConfigKeyMissingError';
    this.key = key;
  }
}

/**
 * Error thrown when YAML configuration cannot be loaded or parsed.
 * Per spec: malformed YAML -> explicit load error.
 */
export class ConfigLoadError extends Error {
  public readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'ConfigLoadError';
    this.cause = cause;
  }
}

/**
 * ConfigProvider — unified configuration access interface.
 *
 * Provides typed access to configuration values via dot-notation keys
 * (e.g., "bedrock.region", "policy.time_alignment.mode").
 */
export interface ConfigProvider {
  /**
   * Get a single configuration value by its dot-notation key.
   *
   * @param key - Dot-notation key (e.g., "env", "bedrock.region", "policy.time_alignment.mode")
   * @returns The configuration value (string, number, boolean, or string[])
   * @throws ConfigKeyMissingError if the key does not exist
   */
  get(key: string): string | number | boolean | readonly string[];

  /**
   * Get all configuration key-value pairs matching a prefix.
   *
   * @param prefix - Dot-notation prefix (e.g., "bedrock", "policy.time_alignment")
   * @returns A map of matching keys to their values
   */
  getAll(prefix: string): Record<string, string | number | boolean | readonly string[]>;
}
