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

// ─── Read-only Route Fragment Guard ────────────────────────

/** Explicit scheme prefix, e.g. `https:`, `javascript:`, `data:`. */
const EXPLICIT_SCHEME_PATTERN = /^[a-zA-Z][a-zA-Z\d+\-.]*:/;

/** Root-relative or protocol-relative syntax. */
const LEADING_SLASH_PATTERN = /^\//;

/** ASCII C0 control characters plus DEL, anywhere in the fragment. */
// eslint-disable-next-line no-control-regex -- deliberately matching C0/DEL to reject smuggled control characters
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001F\u007F]/;

/** Why a read-only route fragment was refused. */
type ReadOnlyPathRejection =
  | 'EMPTY'
  | 'SURROUNDING_WHITESPACE'
  | 'BACKSLASH'
  | 'CONTROL_CHARACTER'
  | 'EXPLICIT_SCHEME'
  | 'LEADING_SLASH'
  | 'DOT_SEGMENT'
  | 'MALFORMED_ENCODING'
  | 'UNRESOLVABLE'
  | 'CROSS_ORIGIN'
  | 'OUTSIDE_BASE_PATH';

type ReadOnlyPathValidation =
  | { readonly valid: true; readonly url: URL }
  | { readonly valid: false; readonly reason: ReadOnlyPathRejection };

/**
 * Returns the path portion of a route fragment, excluding query and hash.
 */
function pathPortion(path: string): string {
  const cut = path.search(/[?#]/);
  return cut === -1 ? path : path.slice(0, cut);
}

/**
 * Validates that a route fragment cannot escape the injected API endpoint.
 *
 * Defence in depth, in order:
 *  1. reject empty input
 *  2. reject surrounding whitespace (a trimmed value differing from the input)
 *  3. reject backslashes, which URL parsers may treat as separators
 *  4. reject ASCII control characters
 *  5. reject explicit schemes
 *  6. reject root-relative and protocol-relative syntax
 *  7. reject `.` and `..` path segments
 *  8. resolve against the injected endpoint
 *  9. require the same origin as the endpoint
 * 10. require the pathname to stay inside the normalized base path prefix
 *
 * No host, origin, or endpoint literal appears here: the base always comes from
 * the injected configuration.
 */
function validateReadOnlyPath(path: string, baseEndpoint: string): ReadOnlyPathValidation {
  if (path === '') {
    return { valid: false, reason: 'EMPTY' };
  }
  if (path !== path.trim()) {
    return { valid: false, reason: 'SURROUNDING_WHITESPACE' };
  }
  if (path.includes('\\')) {
    return { valid: false, reason: 'BACKSLASH' };
  }
  if (CONTROL_CHARACTER_PATTERN.test(path)) {
    return { valid: false, reason: 'CONTROL_CHARACTER' };
  }
  if (EXPLICIT_SCHEME_PATTERN.test(path)) {
    return { valid: false, reason: 'EXPLICIT_SCHEME' };
  }
  if (LEADING_SLASH_PATTERN.test(path)) {
    return { valid: false, reason: 'LEADING_SLASH' };
  }
  for (const rawSegment of pathPortion(path).split('/')) {
    if (rawSegment === '.' || rawSegment === '..') {
      return { valid: false, reason: 'DOT_SEGMENT' };
    }
    // A percent-encoded dot segment (`%2e%2e`, `..%2f..`) is not a separator to
    // the URL parser, so the base-path check below would not catch it. Reject it
    // here in case the server decodes before routing. Only dot segments are
    // checked after decoding: other decoded characters (a backslash inside an
    // `encodeURIComponent` identifier, for example) remain legitimate.
    let decodedSegment: string;
    try {
      decodedSegment = decodeURIComponent(rawSegment);
    } catch {
      return { valid: false, reason: 'MALFORMED_ENCODING' };
    }
    for (const part of decodedSegment.split('/')) {
      if (part === '.' || part === '..') {
        return { valid: false, reason: 'DOT_SEGMENT' };
      }
    }
  }

  // Resolve against the injected endpoint and confirm the result stayed inside it.
  let base: URL;
  let resolved: URL;
  try {
    base = new URL(`${baseEndpoint}/`);
    resolved = new URL(path, base);
  } catch {
    return { valid: false, reason: 'UNRESOLVABLE' };
  }
  if (resolved.origin !== base.origin) {
    return { valid: false, reason: 'CROSS_ORIGIN' };
  }
  const basePathname = base.pathname.endsWith('/') ? base.pathname : `${base.pathname}/`;
  if (!resolved.pathname.startsWith(basePathname)) {
    return { valid: false, reason: 'OUTSIDE_BASE_PATH' };
  }

  return { valid: true, url: resolved };
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

    /**
     * GET {route fragment} - Generic read-only JSON request.
     *
     * Used by the §13 polling fallback for routes that have no canonical
     * shared-schema response contract yet (`/timeline`, `/incidents`,
     * `/reports/{id}`). The result stays `unknown` on purpose: no duplicate
     * canonical response interface is invented in the frontend.
     *
     * @param path - Relative route fragment with identifiers already
     *               URL-encoded. Anything that could escape the injected base
     *               endpoint is rejected before any request is made: absolute,
     *               protocol-relative and root-relative paths, backslashes,
     *               control characters, surrounding whitespace, dot-segment
     *               traversal, and any fragment that resolves to a different
     *               origin or outside the base path prefix.
     */
    getReadOnlyJson(path: string, options?: RequestOptions): Promise<ApiResult<unknown>> {
      const validation = validateReadOnlyPath(path, baseUrl);
      if (!validation.valid) {
        // The rejected fragment is not echoed back into the error message.
        return Promise.resolve({
          ok: false,
          error: configurationError(
            `Read-only path rejected: must be a relative route fragment inside the configured API endpoint (${validation.reason})`,
          ),
        });
      }
      return get<unknown>(path, options);
    },
  };
}

/** Type of the API client returned by createApiClient */
export type ApiClient = ReturnType<typeof createApiClient>;
