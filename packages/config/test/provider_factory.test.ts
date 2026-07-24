import { describe, it, expect, vi } from 'vitest';
import { join } from 'node:path';
import {
  createConfigProvider,
  LocalFileConfigProvider,
  SsmConfigProvider,
  ConfigLoadError,
} from '../src/index.js';

/**
 * Creates a mock SSMClient that returns parameters simulating all keys from config.local.yaml.
 */
function createMockSsmClientWithFullConfig() {
  const prefix = '/city-commander/COMPETITION_AWS/';
  const parameters = [
    { Name: `${prefix}env`, Value: 'COMPETITION_AWS' },
    { Name: `${prefix}bedrock/region`, Value: 'us-east-1' },
    { Name: `${prefix}bedrock/model_id`, Value: 'anthropic.claude-3-sonnet-20240229-v1:0' },
    { Name: `${prefix}bedrock/model_id_fallbacks`, Value: 'anthropic.claude-3-haiku-20240307-v1:0,amazon.titan-text-express-v1' },
    { Name: `${prefix}bedrock/embedding_model_id`, Value: 'amazon.titan-embed-text-v1' },
    { Name: `${prefix}kb/knowledge_base_id`, Value: 'kb-competition-123' },
    { Name: `${prefix}s3/raw_bucket`, Value: 'competition-raw-data' },
    { Name: `${prefix}s3/sop_source_bucket`, Value: 'competition-sop-source' },
    { Name: `${prefix}s3/artifact_bucket`, Value: 'competition-artifacts' },
    { Name: `${prefix}api/endpoint`, Value: 'https://api.competition.example.com' },
    { Name: `${prefix}ws/endpoint`, Value: 'wss://ws.competition.example.com' },
    { Name: `${prefix}auth/user_pool_id`, Value: 'us-east-1_CompPool' },
    { Name: `${prefix}observability/xray_enabled`, Value: 'true' },
    { Name: `${prefix}orchestration/mode`, Value: 'stepfunctions' },
    { Name: `${prefix}enrichment/fanout`, Value: 'stepfunctions' },
    { Name: `${prefix}frontend/hosting`, Value: 'amplify' },
    { Name: `${prefix}config/provider`, Value: 'ssm' },
    { Name: `${prefix}policy/time_alignment/mode`, Value: 'exact_or_latest_prior_per_entity' },
    { Name: `${prefix}policy/time_alignment/max_staleness_minutes`, Value: '30' },
    { Name: `${prefix}policy/affected_road/role`, Value: 'display_only' },
    { Name: `${prefix}policy/ete/affected_set`, Value: 'directly_affected_roads_at_event_snapshot' },
    { Name: `${prefix}policy/incident_anchor/mode`, Value: 'incident_anchor_from_location_text' },
    { Name: `${prefix}policy/affected_intersection_scope/mode`, Value: 'unresolved_manual_confirmation' },
    { Name: `${prefix}policy/multilingual_scope/mode`, Value: 'current_snapshot_all_available_stations' },
  ];

  return {
    send: vi.fn().mockResolvedValue({
      Parameters: parameters.map((p) => ({ Name: p.Name, Value: p.Value })),
      NextToken: undefined,
    }),
  } as any;
}

describe('Provider Factory (createConfigProvider)', () => {
  describe('profile resolution', () => {
    it('uses explicit profile parameter when provided', async () => {
      const realConfigPath = join(__dirname, '../../../config/config.local.yaml');
      const provider = await createConfigProvider({
        profile: 'LOCAL_MOCK',
        localConfigPath: realConfigPath,
        env: {},
      });

      expect(provider).toBeInstanceOf(LocalFileConfigProvider);
      expect(provider.get('env')).toBe('LOCAL_MOCK');
    });

    it('reads profile from CITY_COMMANDER_ENV environment variable', async () => {
      const realConfigPath = join(__dirname, '../../../config/config.local.yaml');
      const provider = await createConfigProvider({
        localConfigPath: realConfigPath,
        env: { CITY_COMMANDER_ENV: 'LOCAL_MOCK' },
      });

      expect(provider).toBeInstanceOf(LocalFileConfigProvider);
    });

    it('throws ConfigLoadError when no profile can be determined', async () => {
      await expect(
        createConfigProvider({ env: {} }),
      ).rejects.toThrow(ConfigLoadError);

      await expect(
        createConfigProvider({ env: {} }),
      ).rejects.toThrow(/Cannot determine environment profile/);
    });

    it('throws ConfigLoadError for invalid profile value', async () => {
      await expect(
        createConfigProvider({ env: { CITY_COMMANDER_ENV: 'INVALID_PROFILE' } }),
      ).rejects.toThrow(ConfigLoadError);

      await expect(
        createConfigProvider({ env: { CITY_COMMANDER_ENV: 'INVALID_PROFILE' } }),
      ).rejects.toThrow(/Invalid environment profile/);
    });
  });

  describe('LOCAL_MOCK profile', () => {
    it('returns LocalFileConfigProvider for LOCAL_MOCK', async () => {
      const realConfigPath = join(__dirname, '../../../config/config.local.yaml');
      const provider = await createConfigProvider({
        profile: 'LOCAL_MOCK',
        localConfigPath: realConfigPath,
        env: {},
      });

      expect(provider).toBeInstanceOf(LocalFileConfigProvider);
      expect(provider.get('env')).toBe('LOCAL_MOCK');
      expect(provider.get('config.provider')).toBe('local_file');
    });
  });

  describe('AWS profiles (PERSONAL_AWS_DEV / COMPETITION_AWS)', () => {
    it('returns SsmConfigProvider for PERSONAL_AWS_DEV', async () => {
      const mockClient = createMockSsmClientWithFullConfig();
      // Adjust the mock for PERSONAL_AWS_DEV prefix
      const prefix = '/city-commander/PERSONAL_AWS_DEV/';
      mockClient.send.mockResolvedValue({
        Parameters: [
          { Name: `${prefix}env`, Value: 'PERSONAL_AWS_DEV' },
          { Name: `${prefix}bedrock/region`, Value: 'us-west-2' },
        ],
        NextToken: undefined,
      });

      const provider = await createConfigProvider({
        profile: 'PERSONAL_AWS_DEV',
        ssmClient: mockClient,
        env: {},
      });

      expect(provider).toBeInstanceOf(SsmConfigProvider);
      expect(provider.get('env')).toBe('PERSONAL_AWS_DEV');
    });

    it('returns SsmConfigProvider for COMPETITION_AWS', async () => {
      const mockClient = createMockSsmClientWithFullConfig();

      const provider = await createConfigProvider({
        profile: 'COMPETITION_AWS',
        ssmClient: mockClient,
        env: {},
      });

      expect(provider).toBeInstanceOf(SsmConfigProvider);
      expect(provider.get('env')).toBe('COMPETITION_AWS');
      expect(provider.get('config.provider')).toBe('ssm');
    });
  });

  describe('identical key schema across providers', () => {
    /**
     * Contract test: Both providers must expose the same set of keys
     * when given equivalent configuration data.
     */
    it('both providers expose identical key sets', async () => {
      const realConfigPath = join(__dirname, '../../../config/config.local.yaml');
      const localProvider = await createConfigProvider({
        profile: 'LOCAL_MOCK',
        localConfigPath: realConfigPath,
        env: {},
      });

      const mockClient = createMockSsmClientWithFullConfig();
      const ssmProvider = await createConfigProvider({
        profile: 'COMPETITION_AWS',
        ssmClient: mockClient,
        env: {},
      });

      // All keys that local has should also be resolvable from SSM
      // (SSM mock is set up to mirror the same schema)
      const sharedKeys = [
        'env',
        'bedrock.region',
        'bedrock.model_id',
        'bedrock.embedding_model_id',
        'kb.knowledge_base_id',
        's3.raw_bucket',
        's3.sop_source_bucket',
        's3.artifact_bucket',
        'api.endpoint',
        'ws.endpoint',
        'auth.user_pool_id',
        'observability.xray_enabled',
        'orchestration.mode',
        'enrichment.fanout',
        'frontend.hosting',
        'config.provider',
        'policy.time_alignment.mode',
        'policy.time_alignment.max_staleness_minutes',
        'policy.affected_road.role',
        'policy.ete.affected_set',
        'policy.incident_anchor.mode',
        'policy.affected_intersection_scope.mode',
        'policy.multilingual_scope.mode',
      ];

      for (const key of sharedKeys) {
        // Both should be able to resolve the key without throwing
        expect(() => localProvider.get(key)).not.toThrow();
        expect(() => ssmProvider.get(key)).not.toThrow();
      }
    });

    it('both providers satisfy the same ConfigProvider interface', async () => {
      const realConfigPath = join(__dirname, '../../../config/config.local.yaml');
      const localProvider = await createConfigProvider({
        profile: 'LOCAL_MOCK',
        localConfigPath: realConfigPath,
        env: {},
      });

      const mockClient = createMockSsmClientWithFullConfig();
      const ssmProvider = await createConfigProvider({
        profile: 'COMPETITION_AWS',
        ssmClient: mockClient,
        env: {},
      });

      // Both have get() method
      expect(typeof localProvider.get).toBe('function');
      expect(typeof ssmProvider.get).toBe('function');

      // Both have getAll() method
      expect(typeof localProvider.getAll).toBe('function');
      expect(typeof ssmProvider.getAll).toBe('function');

      // getAll returns matching structure for bedrock prefix
      const localBedrock = localProvider.getAll('bedrock');
      const ssmBedrock = ssmProvider.getAll('bedrock');

      expect(Object.keys(localBedrock).sort()).toEqual(Object.keys(ssmBedrock).sort());
    });

    it('both providers produce typed values (not just strings)', async () => {
      const realConfigPath = join(__dirname, '../../../config/config.local.yaml');
      const localProvider = await createConfigProvider({
        profile: 'LOCAL_MOCK',
        localConfigPath: realConfigPath,
        env: {},
      });

      const mockClient = createMockSsmClientWithFullConfig();
      const ssmProvider = await createConfigProvider({
        profile: 'COMPETITION_AWS',
        ssmClient: mockClient,
        env: {},
      });

      // Boolean values
      expect(typeof localProvider.get('observability.xray_enabled')).toBe('boolean');
      expect(typeof ssmProvider.get('observability.xray_enabled')).toBe('boolean');

      // Numeric values
      expect(typeof localProvider.get('policy.time_alignment.max_staleness_minutes')).toBe('number');
      expect(typeof ssmProvider.get('policy.time_alignment.max_staleness_minutes')).toBe('number');

      // Array values
      expect(Array.isArray(localProvider.get('bedrock.model_id_fallbacks'))).toBe(true);
      expect(Array.isArray(ssmProvider.get('bedrock.model_id_fallbacks'))).toBe(true);
    });
  });

  describe('no silent fallback guarantee', () => {
    it('SSM failure results in ConfigLoadError, never a default provider', async () => {
      const failingClient = {
        send: vi.fn().mockRejectedValue(new Error('SSM connection refused')),
      } as any;

      await expect(
        createConfigProvider({
          profile: 'COMPETITION_AWS',
          ssmClient: failingClient,
          env: {},
        }),
      ).rejects.toThrow(ConfigLoadError);
    });
  });
});
