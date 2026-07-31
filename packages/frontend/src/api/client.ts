/**
 * Typed Public-Read API Client (§12)
 *
 * HTTP client for public-read endpoints using shared-schema response types.
 * Endpoint supplied through dependency injection; no direct env access.
 *
 * @module frontend/api/client
 */

import type {
  GetDecisionResponse,
  GetRoadsResponse,
  GetCrowdResponse,
} from '@city-commander/shared-schemas';
import { normalizeEndpoint } from '../config/runtime_config.js';

// ─── Error Types ───────────────────────────────────────────

/** API error discriminator */
export type ApiErrorCode =
  | 'CONFIGURATION_ERROR'
  | 'NETWORK_ERROR'
  | 'HTTP_ERROR'
  | 'INVALID_JSON'
  | 'ABORTED';

/** Base API error */
interface ApiErrorBase {
  readonly code: ApiErrorCode;
  readonly message: string;
}

/** Configuration error - endpoint not valid */
export interface ConfigurationError extends ApiErrorBase {
  readonly code: 'CONFIGURATION_ERROR';
}

/** Network error - request failed to reach server */
export interface NetworkError extends ApiErrorBase {
  readonly code: 'NETWORK_ERROR';
}

/** HTTP error - server returned non-2xx status */
export interface HttpError extends ApiErrorBase {
  readonly code: 'HTTP_ERROR';
  readonly status: number;
  readonly statusText: string;
}

/** Invalid JSON - response body not parseable */
export interface InvalidJsonError extends ApiErrorBase {
  readonly code: 'INVALID_JSON';
}

/** Aborted - request cancelled via AbortSignal */
export interface AbortedError extends ApiErrorBase {
  readonly code: 'ABORTED';
}

/** Union of all API error types */
export type ApiError =
  | ConfigurationError
  | NetworkError
  | HttpError
  | InvalidJsonError
  | AbortedError;

/** API response result discriminated union */
export type ApiResult<T> =
  | { readonly ok: true; readonly data: T }
  | { readonly ok: false; readonly error: ApiError };

// ─── Error Factories ───────────────────────────────────────

function configurationError(message: string): ConfigurationError {
  return { code: 'CONFIGURATION_ERROR', message };
}

function networkError(message: string): NetworkError {
  return { code: 'NETWORK_ERROR', message };
}

function httpError(status: number, statusText: string): HttpError {
  return {
    code: 'HTTP_ERROR',
    message: `HTTP ${status}: ${statusText}`,
    status,
    statusText,
  };
}

function invalidJsonError(message: string): InvalidJsonError {
  return { code: 'INVALID_JSON', message };
}

function abortedError(): AbortedError {
  return { code: 'ABORTED', message: 'Request was aborted' };
}

// ─── Client Options ────────────────────────────────────────

/** Options for API requests */
export interface RequestOptions {
  /** AbortSignal for request cancellation */
  readonly signal?: AbortSignal;
}

/** API client configuration */
export interface ApiClientConfig {
  /** Base API endpoint (http: or https:) */
  readonly baseEndpoint: string;
}

// ─── API Client ────────────────────────────────────────────

/**
 * Creates a typed API client for public-read endpoints.
 *
 * @param config - Client configuration with base endpoint
 * @returns Object with methods for each supported endpoint
 */
export function createApiClient(config: ApiClientConfig) {
  const baseUrl = normalizeEndpoint(config.baseEndpoint);

  /**
   * Performs a GET request and returns typed result.
   */
  async function get<T>(path: string, options?: RequestOptions): Promise<ApiResult<T>> {
    // Validate base URL
    let url: URL;
    try {
      url = new URL(path, baseUrl + '/');
    } catch {
      return { ok: false, error: configurationError(`Invalid endpoint URL: ${baseUrl}`) };
    }

    // Perform fetch
    let response: Response;
    try {
      response = await fetch(url.toString(), {
        method: 'GET',
        headers: {
          Accept: 'application/json',
        },
        signal: options?.signal,
      });
    } catch (err) {
      // Check for abort
      if (err instanceof Error && err.name === 'AbortError') {
        return { ok: false, error: abortedError() };
      }
      // Network failure
      return {
        ok: false,
        error: networkError(err instanceof Error ? err.message : 'Network request failed'),
      };
    }

    // Check HTTP status
    if (!response.ok) {
      return { ok: false, error: httpError(response.status, response.statusText) };
    }

    // Parse JSON
    let data: T;
    try {
      data = (await response.json()) as T;
    } catch {
      return { ok: false, error: invalidJsonError('Response body is not valid JSON') };
    }

    return { ok: true, data };
  }

  return {
    /**
     * GET /decisions/{id} - Fetch decision read model
     *
     * Returns merged Core + Narrative + Publish + execution summary.
     */
    getDecision(id: string, options?: RequestOptions): Promise<ApiResult<GetDecisionResponse>> {
      return get<GetDecisionResponse>(`decisions/${encodeURIComponent(id)}`, options);
    },

    /**
     * GET /roads - Fetch current road segment data
     *
     * Returns all road segments with saturation scores and A/B levels.
     */
    getRoads(options?: RequestOptions): Promise<ApiResult<GetRoadsResponse>> {
      return get<GetRoadsResponse>('roads', options);
    },

    /**
     * GET /crowd - Fetch current crowd/base-station data
     *
     * Returns all base stations with user counts and roaming percentages.
     */
    getCrowd(options?: RequestOptions): Promise<ApiResult<GetCrowdResponse>> {
      return get<GetCrowdResponse>('crowd', options);
    },
  };
}

/** Type of the API client returned by createApiClient */
export type ApiClient = ReturnType<typeof createApiClient>;
