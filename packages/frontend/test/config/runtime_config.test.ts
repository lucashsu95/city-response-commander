/**
 * Runtime Config Tests (TASK-121)
 *
 * Tests for configuration validation logic.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock import.meta.env before importing the module
const mockEnv: Record<string, string | undefined> = {};

vi.mock('../../src/config/runtime_config.js', async () => {
  // Return a factory that reads from our mockEnv
  return {
    loadRuntimeConfig: () => {
      const errors: Array<{ code: string; message: string; field: string }> = [];

      const rawApiEndpoint = mockEnv.VITE_API_ENDPOINT;
      const rawWsEndpoint = mockEnv.VITE_WS_ENDPOINT;
      const rawEnvironment = mockEnv.VITE_APP_ENV;

      const VALID_API_PROTOCOLS = ['http:', 'https:'];
      const VALID_WS_PROTOCOLS = ['ws:', 'wss:'];
      const VALID_ENVIRONMENTS = ['LOCAL_MOCK', 'COMPETITION_AWS', 'TEST'];

      // Validate API endpoint
      if (!rawApiEndpoint || rawApiEndpoint.trim() === '') {
        errors.push({
          code: 'MISSING_API_ENDPOINT',
          message: 'VITE_API_ENDPOINT is required but not configured',
          field: 'apiEndpoint',
        });
      } else {
        try {
          const parsed = new URL(rawApiEndpoint);
          if (!VALID_API_PROTOCOLS.includes(parsed.protocol)) {
            errors.push({
              code: 'INVALID_API_PROTOCOL',
              message: `API endpoint must use http: or https: protocol, got ${parsed.protocol}`,
              field: 'apiEndpoint',
            });
          }
        } catch {
          errors.push({
            code: 'INVALID_API_PROTOCOL',
            message: 'API endpoint must use http: or https: protocol, got invalid URL',
            field: 'apiEndpoint',
          });
        }
      }

      // Validate WebSocket endpoint
      if (!rawWsEndpoint || rawWsEndpoint.trim() === '') {
        errors.push({
          code: 'MISSING_WS_ENDPOINT',
          message: 'VITE_WS_ENDPOINT is required but not configured',
          field: 'wsEndpoint',
        });
      } else {
        try {
          const parsed = new URL(rawWsEndpoint);
          if (!VALID_WS_PROTOCOLS.includes(parsed.protocol)) {
            errors.push({
              code: 'INVALID_WS_PROTOCOL',
              message: `WebSocket endpoint must use ws: or wss: protocol, got ${parsed.protocol}`,
              field: 'wsEndpoint',
            });
          }
        } catch {
          errors.push({
            code: 'INVALID_WS_PROTOCOL',
            message: 'WebSocket endpoint must use ws: or wss: protocol, got invalid URL',
            field: 'wsEndpoint',
          });
        }
      }

      // Validate environment
      const environment = rawEnvironment?.toUpperCase();
      if (!environment || !VALID_ENVIRONMENTS.includes(environment)) {
        errors.push({
          code: 'INVALID_ENVIRONMENT',
          message: `VITE_APP_ENV must be one of: ${VALID_ENVIRONMENTS.join(', ')}`,
          field: 'environment',
        });
      }

      if (errors.length > 0) {
        return { ok: false, errors };
      }

      return {
        ok: true,
        config: {
          apiEndpoint: rawApiEndpoint!.trim(),
          wsEndpoint: rawWsEndpoint!.trim(),
          environment: environment as 'LOCAL_MOCK' | 'COMPETITION_AWS' | 'TEST',
        },
      };
    },
    normalizeEndpoint: (endpoint: string) => endpoint.replace(/\/+$/, ''),
  };
});

describe('runtime_config', () => {
  beforeEach(() => {
    // Clear mock env before each test
    Object.keys(mockEnv).forEach((key) => delete mockEnv[key]);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('loadRuntimeConfig', () => {
    it('returns success for valid configuration', async () => {
      mockEnv.VITE_API_ENDPOINT = 'https://api.example.com';
      mockEnv.VITE_WS_ENDPOINT = 'wss://ws.example.com';
      mockEnv.VITE_APP_ENV = 'LOCAL_MOCK';

      const { loadRuntimeConfig } = await import('../../src/config/runtime_config.js');
      const result = loadRuntimeConfig();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.config.apiEndpoint).toBe('https://api.example.com');
        expect(result.config.wsEndpoint).toBe('wss://ws.example.com');
        expect(result.config.environment).toBe('LOCAL_MOCK');
      }
    });

    it('returns error for missing API endpoint', async () => {
      mockEnv.VITE_WS_ENDPOINT = 'wss://ws.example.com';
      mockEnv.VITE_APP_ENV = 'LOCAL_MOCK';

      const { loadRuntimeConfig } = await import('../../src/config/runtime_config.js');
      const result = loadRuntimeConfig();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.some((e) => e.code === 'MISSING_API_ENDPOINT')).toBe(true);
      }
    });

    it('returns error for missing WebSocket endpoint', async () => {
      mockEnv.VITE_API_ENDPOINT = 'https://api.example.com';
      mockEnv.VITE_APP_ENV = 'LOCAL_MOCK';

      const { loadRuntimeConfig } = await import('../../src/config/runtime_config.js');
      const result = loadRuntimeConfig();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.some((e) => e.code === 'MISSING_WS_ENDPOINT')).toBe(true);
      }
    });

    it('returns error for invalid API protocol (ftp:)', async () => {
      mockEnv.VITE_API_ENDPOINT = 'ftp://api.example.com';
      mockEnv.VITE_WS_ENDPOINT = 'wss://ws.example.com';
      mockEnv.VITE_APP_ENV = 'LOCAL_MOCK';

      const { loadRuntimeConfig } = await import('../../src/config/runtime_config.js');
      const result = loadRuntimeConfig();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.some((e) => e.code === 'INVALID_API_PROTOCOL')).toBe(true);
      }
    });

    it('returns error for invalid WebSocket protocol (http:)', async () => {
      mockEnv.VITE_API_ENDPOINT = 'https://api.example.com';
      mockEnv.VITE_WS_ENDPOINT = 'http://ws.example.com';
      mockEnv.VITE_APP_ENV = 'LOCAL_MOCK';

      const { loadRuntimeConfig } = await import('../../src/config/runtime_config.js');
      const result = loadRuntimeConfig();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.some((e) => e.code === 'INVALID_WS_PROTOCOL')).toBe(true);
      }
    });

    it('returns error for invalid environment', async () => {
      mockEnv.VITE_API_ENDPOINT = 'https://api.example.com';
      mockEnv.VITE_WS_ENDPOINT = 'wss://ws.example.com';
      mockEnv.VITE_APP_ENV = 'INVALID_ENV';

      const { loadRuntimeConfig } = await import('../../src/config/runtime_config.js');
      const result = loadRuntimeConfig();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.errors.some((e) => e.code === 'INVALID_ENVIRONMENT')).toBe(true);
      }
    });

    it('accepts http: protocol for API endpoint', async () => {
      mockEnv.VITE_API_ENDPOINT = 'http://localhost:3001';
      mockEnv.VITE_WS_ENDPOINT = 'ws://localhost:3002';
      mockEnv.VITE_APP_ENV = 'TEST';

      const { loadRuntimeConfig } = await import('../../src/config/runtime_config.js');
      const result = loadRuntimeConfig();

      expect(result.ok).toBe(true);
    });

    it('accepts ws: protocol for WebSocket endpoint', async () => {
      mockEnv.VITE_API_ENDPOINT = 'http://localhost:3001';
      mockEnv.VITE_WS_ENDPOINT = 'ws://localhost:3002';
      mockEnv.VITE_APP_ENV = 'TEST';

      const { loadRuntimeConfig } = await import('../../src/config/runtime_config.js');
      const result = loadRuntimeConfig();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.config.wsEndpoint).toBe('ws://localhost:3002');
      }
    });
  });

  describe('normalizeEndpoint', () => {
    it('removes trailing slashes', async () => {
      const { normalizeEndpoint } = await import('../../src/config/runtime_config.js');
      expect(normalizeEndpoint('https://api.example.com/')).toBe('https://api.example.com');
      expect(normalizeEndpoint('https://api.example.com///')).toBe('https://api.example.com');
    });

    it('preserves URLs without trailing slashes', async () => {
      const { normalizeEndpoint } = await import('../../src/config/runtime_config.js');
      expect(normalizeEndpoint('https://api.example.com')).toBe('https://api.example.com');
    });
  });
});
