/**
 * LocalFileConfigProvider — offline config backed by a local YAML file + env overrides.
 *
 * Designed for LOCAL_MOCK environment. Zero AWS calls.
 * No AWS SDK imports in this module.
 *
 * Resolution order:
 * 1. Environment variables (highest priority, with CONFIG_ prefix + underscore-delimited key)
 * 2. Local YAML file values
 *
 * Environment variable mapping:
 *   "bedrock.region" -> CONFIG_BEDROCK_REGION
 *   "policy.time_alignment.mode" -> CONFIG_POLICY_TIME_ALIGNMENT_MODE
 *
 * @module config/local_file_config_provider
 */

import { readFileSync } from 'node:fs';
import { load as loadYaml } from 'js-yaml';
import {
  ConfigProvider,
  ConfigKeyMissingError,
  ConfigLoadError,
} from './config_provider.js';

/**
 * Options for constructing a LocalFileConfigProvider.
 */
export interface LocalFileConfigProviderOptions {
  /** Path to the YAML configuration file */
  filePath: string;
  /** Optional environment variables map (defaults to process.env) */
  env?: Record<string, string | undefined>;
}

/**
 * Flattens a nested object into dot-notation key-value pairs.
 *
 * Example: { bedrock: { region: "us-east-1" } } -> { "bedrock.region": "us-east-1" }
 */
function flattenObject(
  obj: unknown,
  prefix = '',
): Record<string, string | number | boolean | readonly string[]> {
  const result: Record<string, string | number | boolean | readonly string[]> = {};

  if (obj === null || obj === undefined) {
    return result;
  }

  if (typeof obj !== 'object') {
    return result;
  }

  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;

    if (Array.isArray(value)) {
      // Store arrays of strings (e.g., model_id_fallbacks)
      result[fullKey] = Object.freeze(value.map(String)) as readonly string[];
    } else if (value !== null && typeof value === 'object') {
      // Recurse into nested objects
      Object.assign(result, flattenObject(value, fullKey));
    } else if (typeof value === 'boolean') {
      result[fullKey] = value;
    } else if (typeof value === 'number') {
      result[fullKey] = value;
    } else if (typeof value === 'string') {
      result[fullKey] = value;
    }
    // Skip null/undefined values — they represent unset keys
  }

  return result;
}

/**
 * Convert a dot-notation key to its environment variable name.
 * "bedrock.region" -> "CONFIG_BEDROCK_REGION"
 */
function keyToEnvVar(key: string): string {
  return 'CONFIG_' + key.replace(/\./g, '_').toUpperCase();
}

/**
 * Try to coerce an environment variable string to the appropriate type
 * based on the existing YAML value type.
 */
function coerceEnvValue(
  envValue: string,
  existingValue: string | number | boolean | readonly string[] | undefined,
): string | number | boolean | readonly string[] {
  if (existingValue === undefined) {
    // No existing type hint; return as-is
    return envValue;
  }

  if (typeof existingValue === 'boolean') {
    return envValue === 'true' || envValue === '1';
  }

  if (typeof existingValue === 'number') {
    const num = Number(envValue);
    if (!Number.isNaN(num)) {
      return num;
    }
    return envValue;
  }

  if (Array.isArray(existingValue)) {
    // Env override for arrays: comma-separated
    return Object.freeze(envValue.split(',').map((s) => s.trim()));
  }

  return envValue;
}

/**
 * LocalFileConfigProvider reads configuration from a local YAML file
 * with environment variable overrides. Fully offline — no AWS SDK dependencies.
 */
export class LocalFileConfigProvider implements ConfigProvider {
  private readonly flatConfig: Record<string, string | number | boolean | readonly string[]>;

  constructor(options: LocalFileConfigProviderOptions) {
    const { filePath, env = process.env } = options;

    // Load and parse YAML
    let yamlContent: string;
    try {
      yamlContent = readFileSync(filePath, 'utf-8');
    } catch (err) {
      throw new ConfigLoadError(
        `Failed to read configuration file: ${filePath}`,
        err,
      );
    }

    let parsed: unknown;
    try {
      parsed = loadYaml(yamlContent);
    } catch (err) {
      throw new ConfigLoadError(
        `Failed to parse YAML configuration: ${filePath}`,
        err,
      );
    }

    if (parsed === null || parsed === undefined || typeof parsed !== 'object') {
      throw new ConfigLoadError(
        `Configuration file must contain a YAML object: ${filePath}`,
      );
    }

    // Flatten YAML into dot-notation keys
    const yamlFlat = flattenObject(parsed);

    // Apply environment variable overrides
    this.flatConfig = { ...yamlFlat };
    for (const key of Object.keys(yamlFlat)) {
      const envVarName = keyToEnvVar(key);
      const envValue = env[envVarName];
      if (envValue !== undefined) {
        this.flatConfig[key] = coerceEnvValue(envValue, yamlFlat[key]);
      }
    }

    // Also check for env vars that define keys not present in YAML
    // (allows adding config purely through env)
    for (const [envKey, envValue] of Object.entries(env)) {
      if (envKey.startsWith('CONFIG_') && envValue !== undefined) {
        const configKey = envKey
          .slice('CONFIG_'.length)
          .toLowerCase()
          .replace(/_/g, '.');
        if (!(configKey in this.flatConfig)) {
          this.flatConfig[configKey] = envValue;
        }
      }
    }
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
