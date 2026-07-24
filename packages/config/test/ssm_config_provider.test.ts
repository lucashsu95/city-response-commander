import { describe, it, expect, vi } from 'vitest';
import { SSMClient, GetParametersByPathCommand } from '@aws-sdk/client-ssm';
import {
  SsmConfigProvider,
  ConfigKeyMissingError,
  ConfigLoadError,
} from '../src/index.js';

/**
 * Creates a mock SSMClient that returns the given parameters on GetParametersByPath calls.
 */
function createMockSsmClient(
  parameters: Array<{ Name: string; Value: string }>,
  options?: { shouldThrow?: Error; paginateAfter?: number },
): SSMClient {
  const client = {
    send: vi.fn(),
  } as unknown as SSMClient;

  if (options?.shouldThrow) {
    (client.send as ReturnType<typeof vi.fn>).mockRejectedValue(options.shouldThrow);
    return client;
  }

  if (options?.paginateAfter !== undefined) {
    // First page
    const firstPage = parameters.slice(0, options.paginateAfter);
    const secondPage = parameters.slice(options.paginateAfter);
    let callCount = 0;
    (client.send as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          Parameters: firstPage.map((p) => ({ Name: p.Name, Value: p.Value })),
          NextToken: 'page2',
        };
      }
      return {
        Parameters: secondPage.map((p) => ({ Name: p.Name, Value: p.Value })),
        NextToken: undefined,
      };
    });
    return client;
  }

  (client.send as ReturnType<typeof vi.fn>).mockResolvedValue({
    Parameters: parameters.map((p) => ({ Name: p.Name, Value: p.Value })),
    NextToken: undefined,
  });

  return client;
}

describe('SsmConfigProvider', () => {
  const prefix = '/city-commander';
  const env = 'COMPETITION_AWS';
  const fullPrefix = `${prefix}/${env}/`;

  describe('basic key resolution', () => {
    it('resolves simple string values', async () => {
      const client = createMockSsmClient([
        { Name: `${fullPrefix}env`, Value: 'COMPETITION_AWS' },
        { Name: `${fullPrefix}bedrock/region`, Value: 'us-east-1' },
      ]);

      const provider = await SsmConfigProvider.create({
        environment: env,
        prefixBase: prefix,
        ssmClient: client,
      });

      expect(provider.get('env')).toBe('COMPETITION_AWS');
      expect(provider.get('bedrock.region')).toBe('us-east-1');
    });

    it('resolves nested keys (path segments to dot notation)', async () => {
      const client = createMockSsmClient([
        { Name: `${fullPrefix}policy/time_alignment/mode`, Value: 'exact_or_latest_prior_per_entity' },
        { Name: `${fullPrefix}policy/affected_road/role`, Value: 'display_only' },
      ]);

      const provider = await SsmConfigProvider.create({
        environment: env,
        prefixBase: prefix,
        ssmClient: client,
      });

      expect(provider.get('policy.time_alignment.mode')).toBe('exact_or_latest_prior_per_entity');
      expect(provider.get('policy.affected_road.role')).toBe('display_only');
    });

    it('resolves boolean values', async () => {
      const client = createMockSsmClient([
        { Name: `${fullPrefix}observability/xray_enabled`, Value: 'false' },
      ]);

      const provider = await SsmConfigProvider.create({
        environment: env,
        prefixBase: prefix,
        ssmClient: client,
      });

      expect(provider.get('observability.xray_enabled')).toBe(false);
    });

    it('resolves numeric values', async () => {
      const client = createMockSsmClient([
        { Name: `${fullPrefix}policy/time_alignment/max_staleness_minutes`, Value: '30' },
      ]);

      const provider = await SsmConfigProvider.create({
        environment: env,
        prefixBase: prefix,
        ssmClient: client,
      });

      expect(provider.get('policy.time_alignment.max_staleness_minutes')).toBe(30);
    });

    it('resolves comma-separated values as arrays', async () => {
      const client = createMockSsmClient([
        { Name: `${fullPrefix}bedrock/model_id_fallbacks`, Value: 'model-a,model-b,model-c' },
      ]);

      const provider = await SsmConfigProvider.create({
        environment: env,
        prefixBase: prefix,
        ssmClient: client,
      });

      expect(provider.get('bedrock.model_id_fallbacks')).toEqual(['model-a', 'model-b', 'model-c']);
    });
  });

  describe('getAll (prefix listing)', () => {
    it('returns all keys matching a prefix', async () => {
      const client = createMockSsmClient([
        { Name: `${fullPrefix}bedrock/region`, Value: 'us-east-1' },
        { Name: `${fullPrefix}bedrock/model_id`, Value: 'claude-3-sonnet' },
        { Name: `${fullPrefix}bedrock/embedding_model_id`, Value: 'titan-embed' },
        { Name: `${fullPrefix}api/endpoint`, Value: 'https://api.example.com' },
      ]);

      const provider = await SsmConfigProvider.create({
        environment: env,
        prefixBase: prefix,
        ssmClient: client,
      });

      const bedrockConfig = provider.getAll('bedrock');
      expect(bedrockConfig).toEqual({
        'bedrock.region': 'us-east-1',
        'bedrock.model_id': 'claude-3-sonnet',
        'bedrock.embedding_model_id': 'titan-embed',
      });
    });

    it('returns empty object for non-matching prefix', async () => {
      const client = createMockSsmClient([
        { Name: `${fullPrefix}env`, Value: 'COMPETITION_AWS' },
      ]);

      const provider = await SsmConfigProvider.create({
        environment: env,
        prefixBase: prefix,
        ssmClient: client,
      });

      expect(provider.getAll('nonexistent')).toEqual({});
    });
  });

  describe('pagination', () => {
    it('fetches all parameters across paginated results', async () => {
      const client = createMockSsmClient(
        [
          { Name: `${fullPrefix}env`, Value: 'COMPETITION_AWS' },
          { Name: `${fullPrefix}bedrock/region`, Value: 'us-east-1' },
          { Name: `${fullPrefix}bedrock/model_id`, Value: 'claude-3' },
        ],
        { paginateAfter: 2 },
      );

      const provider = await SsmConfigProvider.create({
        environment: env,
        prefixBase: prefix,
        ssmClient: client,
      });

      expect(provider.get('env')).toBe('COMPETITION_AWS');
      expect(provider.get('bedrock.region')).toBe('us-east-1');
      expect(provider.get('bedrock.model_id')).toBe('claude-3');
      expect((client.send as ReturnType<typeof vi.fn>).mock.calls.length).toBe(2);
    });
  });

  describe('failure cases', () => {
    it('throws ConfigKeyMissingError for missing required key', async () => {
      const client = createMockSsmClient([
        { Name: `${fullPrefix}env`, Value: 'COMPETITION_AWS' },
      ]);

      const provider = await SsmConfigProvider.create({
        environment: env,
        prefixBase: prefix,
        ssmClient: client,
      });

      expect(() => provider.get('nonexistent.key')).toThrow(ConfigKeyMissingError);
      expect(() => provider.get('nonexistent.key')).toThrow(
        'Required configuration key missing: "nonexistent.key"',
      );
    });

    it('throws ConfigLoadError when SSM is unavailable (fail-closed)', async () => {
      const client = createMockSsmClient([], {
        shouldThrow: new Error('Network timeout - SSM unreachable'),
      });

      await expect(
        SsmConfigProvider.create({
          environment: env,
          prefixBase: prefix,
          ssmClient: client,
        }),
      ).rejects.toThrow(ConfigLoadError);

      await expect(
        SsmConfigProvider.create({
          environment: env,
          prefixBase: prefix,
          ssmClient: client,
        }),
      ).rejects.toThrow(/Failed to load configuration from SSM Parameter Store/);
    });

    it('never silently falls back to hard-coded values on SSM failure', async () => {
      const client = createMockSsmClient([], {
        shouldThrow: new Error('Access denied'),
      });

      // The only possible outcome is an error — never a default value
      try {
        await SsmConfigProvider.create({
          environment: env,
          prefixBase: prefix,
          ssmClient: client,
        });
        // Should not reach here
        expect.fail('Expected ConfigLoadError to be thrown');
      } catch (err) {
        expect(err).toBeInstanceOf(ConfigLoadError);
      }
    });
  });

  describe('SSM path convention', () => {
    it('uses /city-commander/{env}/ as default prefix', async () => {
      const client = createMockSsmClient([]);
      (client.send as ReturnType<typeof vi.fn>).mockResolvedValue({
        Parameters: [],
        NextToken: undefined,
      });

      await SsmConfigProvider.create({
        environment: 'PERSONAL_AWS_DEV',
        ssmClient: client,
      });

      const call = (client.send as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.input.Path).toBe('/city-commander/PERSONAL_AWS_DEV/');
      expect(call.input.Recursive).toBe(true);
      expect(call.input.WithDecryption).toBe(true);
    });

    it('supports custom prefix base', async () => {
      const client = createMockSsmClient([]);
      (client.send as ReturnType<typeof vi.fn>).mockResolvedValue({
        Parameters: [],
        NextToken: undefined,
      });

      await SsmConfigProvider.create({
        environment: 'COMPETITION_AWS',
        prefixBase: '/my-app',
        ssmClient: client,
      });

      const call = (client.send as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.input.Path).toBe('/my-app/COMPETITION_AWS/');
    });
  });
});
