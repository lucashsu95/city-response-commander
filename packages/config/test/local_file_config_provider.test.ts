import { describe, it, expect, beforeEach } from 'vitest';
import { join } from 'node:path';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import {
  LocalFileConfigProvider,
  ConfigKeyMissingError,
  ConfigLoadError,
} from '../src/index.js';

describe('LocalFileConfigProvider', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'config-test-'));
  });

  function writeYaml(content: string): string {
    const filePath = join(tempDir, 'config.yaml');
    writeFileSync(filePath, content, 'utf-8');
    return filePath;
  }

  describe('key resolution', () => {
    it('resolves top-level keys', () => {
      const filePath = writeYaml('env: LOCAL_MOCK\n');
      const provider = new LocalFileConfigProvider({ filePath, env: {} });
      expect(provider.get('env')).toBe('LOCAL_MOCK');
    });

    it('resolves nested keys with dot notation', () => {
      const filePath = writeYaml(`
bedrock:
  region: ap-northeast-1
  model_id: test-model
`);
      const provider = new LocalFileConfigProvider({ filePath, env: {} });
      expect(provider.get('bedrock.region')).toBe('ap-northeast-1');
      expect(provider.get('bedrock.model_id')).toBe('test-model');
    });

    it('resolves deeply nested keys', () => {
      const filePath = writeYaml(`
policy:
  time_alignment:
    mode: exact_or_latest_prior_per_entity
    max_staleness_minutes: 30
`);
      const provider = new LocalFileConfigProvider({ filePath, env: {} });
      expect(provider.get('policy.time_alignment.mode')).toBe('exact_or_latest_prior_per_entity');
      expect(provider.get('policy.time_alignment.max_staleness_minutes')).toBe(30);
    });

    it('resolves boolean values', () => {
      const filePath = writeYaml(`
observability:
  xray_enabled: false
`);
      const provider = new LocalFileConfigProvider({ filePath, env: {} });
      expect(provider.get('observability.xray_enabled')).toBe(false);
    });

    it('resolves numeric values', () => {
      const filePath = writeYaml(`
policy:
  time_alignment:
    max_staleness_minutes: 45
`);
      const provider = new LocalFileConfigProvider({ filePath, env: {} });
      expect(provider.get('policy.time_alignment.max_staleness_minutes')).toBe(45);
    });

    it('resolves array values (e.g., model_id_fallbacks)', () => {
      const filePath = writeYaml(`
bedrock:
  model_id_fallbacks:
    - model-a
    - model-b
`);
      const provider = new LocalFileConfigProvider({ filePath, env: {} });
      const fallbacks = provider.get('bedrock.model_id_fallbacks');
      expect(fallbacks).toEqual(['model-a', 'model-b']);
    });
  });

  describe('prefix listing (getAll)', () => {
    it('returns all keys matching a prefix', () => {
      const filePath = writeYaml(`
bedrock:
  region: ap-northeast-1
  model_id: test-model
  embedding_model_id: embed-model
api:
  endpoint: http://localhost:3000
`);
      const provider = new LocalFileConfigProvider({ filePath, env: {} });
      const bedrockConfig = provider.getAll('bedrock');

      expect(bedrockConfig).toEqual({
        'bedrock.region': 'ap-northeast-1',
        'bedrock.model_id': 'test-model',
        'bedrock.embedding_model_id': 'embed-model',
      });
    });

    it('returns nested prefixes correctly', () => {
      const filePath = writeYaml(`
policy:
  time_alignment:
    mode: exact_or_latest_prior_per_entity
    max_staleness_minutes: 30
  affected_road:
    role: display_only
`);
      const provider = new LocalFileConfigProvider({ filePath, env: {} });
      const timeAlignment = provider.getAll('policy.time_alignment');

      expect(timeAlignment).toEqual({
        'policy.time_alignment.mode': 'exact_or_latest_prior_per_entity',
        'policy.time_alignment.max_staleness_minutes': 30,
      });
    });

    it('returns empty object for non-matching prefix', () => {
      const filePath = writeYaml('env: LOCAL_MOCK\n');
      const provider = new LocalFileConfigProvider({ filePath, env: {} });
      expect(provider.getAll('nonexistent')).toEqual({});
    });

    it('returns all policy keys under the policy prefix', () => {
      const filePath = writeYaml(`
policy:
  time_alignment:
    mode: exact_or_latest_prior_per_entity
    max_staleness_minutes: 30
  affected_road:
    role: display_only
`);
      const provider = new LocalFileConfigProvider({ filePath, env: {} });
      const allPolicy = provider.getAll('policy');

      expect(Object.keys(allPolicy)).toContain('policy.time_alignment.mode');
      expect(Object.keys(allPolicy)).toContain('policy.time_alignment.max_staleness_minutes');
      expect(Object.keys(allPolicy)).toContain('policy.affected_road.role');
    });
  });

  describe('env override precedence', () => {
    it('env variables override YAML values (string)', () => {
      const filePath = writeYaml(`
bedrock:
  region: ap-northeast-1
`);
      const provider = new LocalFileConfigProvider({
        filePath,
        env: { CONFIG_BEDROCK_REGION: 'us-east-1' },
      });
      expect(provider.get('bedrock.region')).toBe('us-east-1');
    });

    it('env variables override YAML values (boolean)', () => {
      const filePath = writeYaml(`
observability:
  xray_enabled: false
`);
      const provider = new LocalFileConfigProvider({
        filePath,
        env: { CONFIG_OBSERVABILITY_XRAY_ENABLED: 'true' },
      });
      expect(provider.get('observability.xray_enabled')).toBe(true);
    });

    it('env variables override YAML values (number)', () => {
      const filePath = writeYaml(`
policy:
  time_alignment:
    max_staleness_minutes: 30
`);
      const provider = new LocalFileConfigProvider({
        filePath,
        env: { CONFIG_POLICY_TIME_ALIGNMENT_MAX_STALENESS_MINUTES: '60' },
      });
      expect(provider.get('policy.time_alignment.max_staleness_minutes')).toBe(60);
    });

    it('env variables override YAML arrays (comma-separated)', () => {
      const filePath = writeYaml(`
bedrock:
  model_id_fallbacks:
    - original-a
    - original-b
`);
      const provider = new LocalFileConfigProvider({
        filePath,
        env: { CONFIG_BEDROCK_MODEL_ID_FALLBACKS: 'override-x,override-y' },
      });
      expect(provider.get('bedrock.model_id_fallbacks')).toEqual(['override-x', 'override-y']);
    });

    it('YAML value used when no env override present', () => {
      const filePath = writeYaml(`
env: LOCAL_MOCK
bedrock:
  region: ap-northeast-1
`);
      const provider = new LocalFileConfigProvider({
        filePath,
        env: { CONFIG_ENV: 'COMPETITION_AWS' },
      });
      // env overrides top-level "env"
      expect(provider.get('env')).toBe('COMPETITION_AWS');
      // bedrock.region stays from YAML
      expect(provider.get('bedrock.region')).toBe('ap-northeast-1');
    });
  });

  describe('failure cases', () => {
    it('throws ConfigKeyMissingError for missing required key', () => {
      const filePath = writeYaml('env: LOCAL_MOCK\n');
      const provider = new LocalFileConfigProvider({ filePath, env: {} });

      expect(() => provider.get('nonexistent.key')).toThrow(ConfigKeyMissingError);
      expect(() => provider.get('nonexistent.key')).toThrow(
        'Required configuration key missing: "nonexistent.key"',
      );
    });

    it('throws ConfigLoadError for non-existent file', () => {
      expect(
        () => new LocalFileConfigProvider({ filePath: '/tmp/no-such-file-12345.yaml', env: {} }),
      ).toThrow(ConfigLoadError);
    });

    it('throws ConfigLoadError for malformed YAML', () => {
      const filePath = writeYaml(`
invalid:
  - yaml: [unterminated
`);
      expect(
        () => new LocalFileConfigProvider({ filePath, env: {} }),
      ).toThrow(ConfigLoadError);
    });

    it('throws ConfigLoadError for YAML that is not an object', () => {
      const filePath = writeYaml('just a string\n');
      expect(
        () => new LocalFileConfigProvider({ filePath, env: {} }),
      ).toThrow(ConfigLoadError);
    });
  });

  describe('no network access (offline guarantee)', () => {
    it('loads the real config.local.yaml without any network call', () => {
      // This test proves that LocalFileConfigProvider can resolve the full config
      // schema offline using only the local YAML file.
      const realConfigPath = join(__dirname, '../../../config/config.local.yaml');
      const provider = new LocalFileConfigProvider({ filePath: realConfigPath, env: {} });

      // Verify representative keys resolve correctly
      expect(provider.get('env')).toBe('LOCAL_MOCK');
      expect(provider.get('bedrock.region')).toBe('ap-northeast-1');
      expect(provider.get('config.provider')).toBe('local_file');
      expect(provider.get('policy.time_alignment.mode')).toBe('exact_or_latest_prior_per_entity');
      expect(provider.get('policy.affected_road.role')).toBe('display_only');
      expect(provider.get('policy.ete.affected_set')).toBe('incident_primary_and_selected_secondary');
      expect(provider.get('auth.app_client_id')).toBe('local-mock-client');
      expect(provider.get('policy.ete.snapshot_mode')).toBe('COMMON_EXACT_TIMESTAMP');
      expect(provider.get('policy.incident_anchor.mode')).toBe('incident_anchor_from_location_text');
      expect(provider.get('policy.affected_intersection_scope.mode')).toBe('unresolved_manual_confirmation');
      expect(provider.get('policy.multilingual_scope.mode')).toBe('current_snapshot_all_available_stations');
      expect(provider.get('observability.xray_enabled')).toBe(false);
      expect(provider.get('orchestration.mode')).toBe('lambda_direct');
      expect(provider.get('s3.raw_bucket')).toBe('local-raw-data');
    });

    it('no AWS SDK import exists in the local provider module', async () => {
      // Verify no aws-sdk or @aws-sdk imports in the local provider source
      const { readFileSync } = await import('node:fs');
      const source = readFileSync(
        join(__dirname, '../src/local_file_config_provider.ts'),
        'utf-8',
      );
      expect(source).not.toContain('@aws-sdk');
      expect(source).not.toContain('aws-sdk');
      expect(source).not.toContain('require(\'aws');
    });
  });

  describe('integration with config.local.yaml', () => {
    it('resolves all expected infrastructure keys', () => {
      const realConfigPath = join(__dirname, '../../../config/config.local.yaml');
      const provider = new LocalFileConfigProvider({ filePath: realConfigPath, env: {} });

      // Infrastructure keys
      expect(provider.get('env')).toBeDefined();
      expect(provider.get('bedrock.region')).toBeDefined();
      expect(provider.get('bedrock.model_id')).toBeDefined();
      expect(provider.get('bedrock.embedding_model_id')).toBeDefined();
      expect(provider.get('kb.knowledge_base_id')).toBeDefined();
      expect(provider.get('s3.raw_bucket')).toBeDefined();
      expect(provider.get('s3.sop_source_bucket')).toBeDefined();
      expect(provider.get('s3.artifact_bucket')).toBeDefined();
      expect(provider.get('api.endpoint')).toBeDefined();
      expect(provider.get('ws.endpoint')).toBeDefined();
      expect(provider.get('auth.user_pool_id')).toBeDefined();
      expect(provider.get('observability.xray_enabled')).toBeDefined();
      expect(provider.get('orchestration.mode')).toBeDefined();
      expect(provider.get('enrichment.fanout')).toBeDefined();
      expect(provider.get('frontend.hosting')).toBeDefined();
      expect(provider.get('config.provider')).toBeDefined();
    });

    it('resolves all expected policy keys (Strategies A–F)', () => {
      const realConfigPath = join(__dirname, '../../../config/config.local.yaml');
      const provider = new LocalFileConfigProvider({ filePath: realConfigPath, env: {} });

      // Policy keys (Strategies A–F)
      expect(provider.get('policy.time_alignment.mode')).toBeDefined();
      expect(provider.get('policy.time_alignment.max_staleness_minutes')).toBeDefined();
      expect(provider.get('policy.affected_road.role')).toBeDefined();
      expect(provider.get('policy.ete.affected_set')).toBeDefined();
      expect(provider.get('policy.incident_anchor.mode')).toBeDefined();
      expect(provider.get('policy.affected_intersection_scope.mode')).toBeDefined();
      expect(provider.get('policy.multilingual_scope.mode')).toBeDefined();
    });

    it('getAll returns all bedrock keys from config.local.yaml', () => {
      const realConfigPath = join(__dirname, '../../../config/config.local.yaml');
      const provider = new LocalFileConfigProvider({ filePath: realConfigPath, env: {} });

      const bedrock = provider.getAll('bedrock');
      expect(Object.keys(bedrock)).toContain('bedrock.region');
      expect(Object.keys(bedrock)).toContain('bedrock.model_id');
      expect(Object.keys(bedrock)).toContain('bedrock.model_id_fallbacks');
      expect(Object.keys(bedrock)).toContain('bedrock.embedding_model_id');
    });
  });
});
