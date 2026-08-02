/**
 * API Client `getTimeline` Tests (TASK-124)
 *
 * Verifies the read-boundary method used by the timeline controller: it uses
 * the injected API base endpoint, never a hardcoded host, and returns the
 * unvalidated `unknown` body for the frontend-owned decoder to validate.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createApiClient } from '../../src/api/client.js';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('ApiClient.getTimeline', () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('requests the timeline route against the injected base endpoint', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ timestamps: [], current: null }),
    });

    const client = createApiClient({ baseEndpoint: 'https://api.example.com' });
    const result = await client.getTimeline();

    expect(result.ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const requestedUrl = String(mockFetch.mock.calls[0]?.[0]);
    expect(requestedUrl).toBe('https://api.example.com/timeline');
  });

  it('never contacts a hardcoded host regardless of the injected endpoint', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ timestamps: [], current: null }),
    });

    const client = createApiClient({ baseEndpoint: 'https://different-host.example/stage' });
    await client.getTimeline();

    const requestedUrl = String(mockFetch.mock.calls[0]?.[0]);
    expect(requestedUrl).toBe('https://different-host.example/stage/timeline');
  });

  it('returns the raw unknown body for the decoder to validate (no shape assumed)', async () => {
    const arbitraryBody = { timestamps: ['2026-05-20 22:00'], current: '2026-05-20 22:00', extra: 1 };
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: () => Promise.resolve(arbitraryBody),
    });

    const client = createApiClient({ baseEndpoint: 'https://api.example.com' });
    const result = await client.getTimeline();

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual(arbitraryBody);
    }
  });

  it('propagates HTTP errors as a typed result', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
    });

    const client = createApiClient({ baseEndpoint: 'https://api.example.com' });
    const result = await client.getTimeline();

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('HTTP_ERROR');
    }
  });

  it('supports request cancellation via AbortSignal', async () => {
    const abortError = new Error('Aborted');
    abortError.name = 'AbortError';
    mockFetch.mockRejectedValueOnce(abortError);

    const client = createApiClient({ baseEndpoint: 'https://api.example.com' });
    const controller = new AbortController();
    const result = await client.getTimeline({ signal: controller.signal });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('ABORTED');
    }
  });
});
