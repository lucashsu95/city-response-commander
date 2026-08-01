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

  // ─── F-02: read-only route fragment guard ────────────────

  describe('getReadOnlyJson route fragment guard', () => {
    const BASE_ENDPOINT = 'https://api.example.com';
    const NESTED_BASE_ENDPOINT = 'https://api.example.com/stage/v1';

    const rejectedPaths: readonly { readonly label: string; readonly path: string }[] = [
      { label: 'absolute https URL', path: 'https://evil.example' },
      { label: 'absolute http URL', path: 'http://evil.example/steal' },
      { label: 'javascript scheme', path: 'javascript:alert(1)' },
      { label: 'data scheme', path: 'data:text/html,<b>x</b>' },
      { label: 'protocol-relative', path: '//evil.example' },
      { label: 'root-relative', path: '/absolute/path' },
      { label: 'double backslash host', path: '\\\\evil.example' },
      { label: 'single backslash', path: '\\evil' },
      { label: 'space-prefixed absolute URL', path: '  https://evil.example' },
      { label: 'tab-prefixed absolute URL', path: '\thttps://evil.example' },
      { label: 'space-prefixed protocol-relative', path: ' //evil.example' },
      { label: 'trailing whitespace', path: 'timeline ' },
      { label: 'embedded newline', path: 'time\nline' },
      { label: 'embedded NUL', path: 'time\u0000line' },
      { label: 'embedded DEL', path: 'time\u007fline' },
      { label: 'single dot segment', path: '.' },
      { label: 'double dot segment', path: '..' },
      { label: 'traversal', path: '../../secret' },
      { label: 'nested traversal', path: 'reports/../../secret' },
      { label: 'leading traversal with dot', path: './timeline' },
      { label: 'percent-encoded traversal', path: '..%2f..%2fsecret' },
      { label: 'percent-encoded dot segment', path: '%2e%2e/secret' },
      { label: 'malformed percent encoding', path: 'reports/%zz' },
      { label: 'empty string', path: '' },
    ];

    it.each(rejectedPaths)('rejects $label without calling fetch', async ({ path }) => {
      const client = createApiClient({ baseEndpoint: BASE_ENDPOINT });
      const result = await client.getReadOnlyJson(path);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('CONFIGURATION_ERROR');
        expect(result.error.message).toContain('Read-only path rejected');
      }
      expect(mockFetch).not.toHaveBeenCalled();
    });

    const acceptedPaths: readonly { readonly label: string; readonly path: string }[] = [
      { label: 'timeline', path: 'timeline' },
      { label: 'incidents', path: 'incidents' },
      { label: 'encoded report id', path: 'reports/a%2Fb' },
      { label: 'query string', path: 'q?x=1&y=2' },
      { label: 'nested route', path: 'reports/abc/detail' },
    ];

    it.each(acceptedPaths)('accepts $label and resolves against the endpoint', async ({ path }) => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ any: 'payload' }),
      });

      const client = createApiClient({ baseEndpoint: BASE_ENDPOINT });
      const result = await client.getReadOnlyJson(path);

      expect(result.ok).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      const requestedUrl = String(mockFetch.mock.calls[0]?.[0]);
      expect(requestedUrl.startsWith('https://api.example.com/')).toBe(true);
      expect(requestedUrl).not.toContain('evil.example');
    });

    it('accepts an encodeURIComponent identifier containing slash, space, question mark and backslash', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ any: 'payload' }),
      });

      const rawId = 'dec/1 2?x\\y';
      const path = `reports/${encodeURIComponent(rawId)}`;
      expect(path).toBe('reports/dec%2F1%202%3Fx%5Cy');

      const client = createApiClient({ baseEndpoint: BASE_ENDPOINT });
      const result = await client.getReadOnlyJson(path);

      expect(result.ok).toBe(true);
      const requestedUrl = String(mockFetch.mock.calls[0]?.[0]);
      expect(requestedUrl).toBe('https://api.example.com/reports/dec%2F1%202%3Fx%5Cy');
    });

    it('keeps a nested base path prefix and rejects traversal that escapes it', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ any: 'payload' }),
      });

      const client = createApiClient({ baseEndpoint: NESTED_BASE_ENDPOINT });
      const allowed = await client.getReadOnlyJson('timeline');
      expect(allowed.ok).toBe(true);
      expect(String(mockFetch.mock.calls[0]?.[0])).toBe(
        'https://api.example.com/stage/v1/timeline',
      );

      mockFetch.mockReset();
      const escaped = await client.getReadOnlyJson('..%2f..%2fsecret');
      expect(escaped.ok).toBe(false);
      if (!escaped.ok) {
        expect(escaped.error.code).toBe('CONFIGURATION_ERROR');
      }
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('never contacts an external origin for any rejected fragment', async () => {
      const client = createApiClient({ baseEndpoint: BASE_ENDPOINT });

      for (const { path } of rejectedPaths) {
        const result = await client.getReadOnlyJson(path);
        expect(result.ok).toBe(false);
      }

      expect(mockFetch).not.toHaveBeenCalled();
    });
  });
});
