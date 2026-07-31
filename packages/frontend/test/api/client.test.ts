/**
 * API Client Tests (TASK-121)
 *
 * Tests for typed API client error handling.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createApiClient } from '../../src/api/client.js';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('API Client', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('createApiClient', () => {
    it('creates client with base endpoint', () => {
      const client = createApiClient({ baseEndpoint: 'https://api.example.com' });
      expect(client).toHaveProperty('getDecision');
      expect(client).toHaveProperty('getRoads');
      expect(client).toHaveProperty('getCrowd');
    });
  });

  describe('HTTP error handling', () => {
    it('returns HTTP_ERROR for non-2xx status', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      const client = createApiClient({ baseEndpoint: 'https://api.example.com' });
      const result = await client.getRoads();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('HTTP_ERROR');
        expect(result.error.status).toBe(404);
        expect(result.error.statusText).toBe('Not Found');
      }
    });

    it('returns HTTP_ERROR for 500 status', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: 'Internal Server Error',
      });

      const client = createApiClient({ baseEndpoint: 'https://api.example.com' });
      const result = await client.getCrowd();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('HTTP_ERROR');
        expect(result.error.status).toBe(500);
      }
    });
  });

  describe('Invalid JSON handling', () => {
    it('returns INVALID_JSON for malformed response', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.reject(new Error('Unexpected token')),
      });

      const client = createApiClient({ baseEndpoint: 'https://api.example.com' });
      const result = await client.getRoads();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_JSON');
      }
    });
  });

  describe('Network error handling', () => {
    it('returns NETWORK_ERROR for fetch failure', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network failure'));

      const client = createApiClient({ baseEndpoint: 'https://api.example.com' });
      const result = await client.getRoads();

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('NETWORK_ERROR');
        expect(result.error.message).toContain('Network failure');
      }
    });
  });

  describe('AbortSignal handling', () => {
    it('returns ABORTED for cancelled request', async () => {
      const abortError = new Error('Aborted');
      abortError.name = 'AbortError';
      mockFetch.mockRejectedValueOnce(abortError);

      const client = createApiClient({ baseEndpoint: 'https://api.example.com' });
      const controller = new AbortController();
      const result = await client.getRoads({ signal: controller.signal });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('ABORTED');
      }
    });
  });

  describe('Success responses', () => {
    it('returns data for successful getRoads', async () => {
      const mockData = {
        schema_version: '1.0',
        trace_id: 'test-trace',
        segments: [],
        timestamp: '2026-07-30T12:00:00Z',
        provisional: false,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockData),
      });

      const client = createApiClient({ baseEndpoint: 'https://api.example.com' });
      const result = await client.getRoads();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.schema_version).toBe('1.0');
        expect(result.data.segments).toEqual([]);
      }
    });

    it('returns data for successful getCrowd', async () => {
      const mockData = {
        schema_version: '1.0',
        trace_id: 'test-trace',
        stations: [],
        timestamp: '2026-07-30T12:00:00Z',
        provisional: false,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockData),
      });

      const client = createApiClient({ baseEndpoint: 'https://api.example.com' });
      const result = await client.getCrowd();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.stations).toEqual([]);
      }
    });

    it('returns data for successful getDecision', async () => {
      const mockData = {
        schema_version: '1.0',
        trace_id: 'test-trace',
        core: {},
        narratives: [],
        execution: {
          status: 'completed',
          last_error: null,
          retryable: false,
          attempt_count: 1,
        },
        policy_version: '1.0',
        provisional: false,
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(mockData),
      });

      const client = createApiClient({ baseEndpoint: 'https://api.example.com' });
      const result = await client.getDecision('decision-123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.policy_version).toBe('1.0');
      }
    });
  });

  describe('URL construction', () => {
    it('properly joins base URL and path', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ schema_version: '1.0', segments: [] }),
      });

      const client = createApiClient({ baseEndpoint: 'https://api.example.com/v1' });
      await client.getRoads();

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('roads'),
        expect.any(Object)
      );
    });

    it('encodes decision ID in URL', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ schema_version: '1.0', core: {} }),
      });

      const client = createApiClient({ baseEndpoint: 'https://api.example.com' });
      await client.getDecision('id/with/slashes');

      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('id%2Fwith%2Fslashes'),
        expect.any(Object)
      );
    });
  });
});
