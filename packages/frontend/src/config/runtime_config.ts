/**
 * Runtime Configuration (§4.9, §23.1)
 *
 * Single source of truth for Vite environment variables.
 * No other frontend module may access import.meta.env directly.
 *
 * Competition-day flow:
 *   AWS/CDK outputs → build env vars → frontend build → deployment
 *
 * @module frontend/config/runtime_config
 */

/** Supported environment profiles */
export type AppEnvironment = 'LOCAL_MOCK' | 'COMPETITION_AWS' | 'TEST' | 'DEMO';

/** API access mode for this build.
 *
 * - `production`: the original demo client (`createApiClient`) — every route is
 *   hit at its canonical production path. Required for the live competition
 *   deployment that exposes `/decisions/{id}`, `/roads`, `/crowd`, `/timeline`,
 *   `/incidents/{id}/inject`, `/decisions/{id}/publish`, the WebSocket
 *   channel, and Cognito-gated admin calls.
 * - `demo`: the "fastest demonstrable version" adapter (`createDemoApiClient`),
 *   used when only `GET /health`, `GET /demo/timeseries`, `POST /demo/incidents`
 *   and `POST /what-if` are deployed. The adapter never fabricates values; it
 *   caches the single `demo/timeseries` snapshot, fills canonical envelope
 *   fields with documented defaults, and serves `GET /decisions/{id}` /
 *   `GET /reports/{id}` from an in-memory decision cache that
 *   `POST /demo/incidents` populated.
 *
 * Selected via `VITE_API_MODE` at build time.
 */
export type ApiMode = 'production' | 'demo';

/** Parsed runtime configuration */
export interface RuntimeConfig {
  /** HTTP API base endpoint (http: or https:) */
  readonly apiEndpoint: string;
  /** WebSocket endpoint (ws: or wss:). Empty string in demo mode — polling only. */
  readonly wsEndpoint: string;
  /** Current environment profile */
  readonly environment: AppEnvironment;
  /**
   * API access mode. `demo` enables the Demo API Compatibility Adapter; it is
   * the only mode that tolerates an empty `wsEndpoint` and a non-`COMPETITION_AWS`
   * environment without rendering the configuration error screen.
   */
  readonly apiMode: ApiMode;
}

/** Configuration error types */
export type RuntimeConfigErrorCode =
  | 'MISSING_API_ENDPOINT'
  | 'MISSING_WS_ENDPOINT'
  | 'INVALID_API_PROTOCOL'
  | 'INVALID_WS_PROTOCOL'
  | 'INVALID_ENVIRONMENT'
  | 'INVALID_API_MODE';

/** Single configuration error */
export interface RuntimeConfigError {
  readonly code: RuntimeConfigErrorCode;
  readonly message: string;
  readonly field: string;
}

/** Configuration result discriminated union */
export type RuntimeConfigResult =
  | {
      readonly ok: true;
      readonly config: RuntimeConfig;
    }
  | {
      readonly ok: false;
      readonly errors: readonly RuntimeConfigError[];
    };

const VALID_API_PROTOCOLS = ['http:', 'https:'] as const;
const VALID_WS_PROTOCOLS = ['ws:', 'wss:'] as const;
const VALID_ENVIRONMENTS: readonly AppEnvironment[] = ['LOCAL_MOCK', 'COMPETITION_AWS', 'TEST', 'DEMO'];
const VALID_API_MODES: readonly ApiMode[] = ['production', 'demo'];

/**
 * Validates that a URL uses an allowed protocol.
 */
function validateProtocol(
  url: string,
  allowedProtocols: readonly string[],
): { valid: true; protocol: string } | { valid: false; actual: string | null } {
  try {
    const parsed = new URL(url);
    if (allowedProtocols.includes(parsed.protocol)) {
      return { valid: true, protocol: parsed.protocol };
    }
    return { valid: false, actual: parsed.protocol };
  } catch {
    return { valid: false, actual: null };
  }
}

/**
 * Validates and normalizes the environment value.
 */
function parseEnvironment(value: string | undefined): AppEnvironment | null {
  if (!value) return null;
  const upper = value.toUpperCase() as AppEnvironment;
  return VALID_ENVIRONMENTS.includes(upper) ? upper : null;
}

/**
 * Validates and normalizes the API mode value. Defaults to `production` when
 * unset, matching the historic single-mode behavior before the demo adapter
 * existed; demo mode must be opted into explicitly via `VITE_API_MODE=demo`.
 */
function parseApiMode(value: string | undefined): ApiMode | null {
  if (!value) return 'production';
  const normalized = value.toLowerCase() as ApiMode;
  return VALID_API_MODES.includes(normalized) ? normalized : null;
}

/**
 * Loads and validates runtime configuration from Vite environment variables.
 *
 * This is the ONLY function in the frontend that accesses import.meta.env.
 * All other modules receive configuration through dependency injection.
 */
export function loadRuntimeConfig(): RuntimeConfigResult {
  const errors: RuntimeConfigError[] = [];

  // Read raw values from Vite env
  const rawApiEndpoint = import.meta.env.VITE_API_ENDPOINT as string | undefined;
  const rawWsEndpoint = import.meta.env.VITE_WS_ENDPOINT as string | undefined;
  const rawEnvironment = import.meta.env.VITE_APP_ENV as string | undefined;
  const rawApiMode = import.meta.env.VITE_API_MODE as string | undefined;

  // Validate API mode up front so the demo WS-relaxation rule below is
  // gated on a value that has actually parsed successfully.
  const apiMode = parseApiMode(rawApiMode);
  if (apiMode === null) {
    errors.push({
      code: 'INVALID_API_MODE',
      message: `VITE_API_MODE 必須是 ${VALID_API_MODES.join(' / ')} 之一`,
      field: 'apiMode',
    });
  }

  // Validate API endpoint
  if (!rawApiEndpoint || rawApiEndpoint.trim() === '') {
    errors.push({
      code: 'MISSING_API_ENDPOINT',
      message: 'VITE_API_ENDPOINT is required but not configured',
      field: 'apiEndpoint',
    });
  } else {
    const apiResult = validateProtocol(rawApiEndpoint, VALID_API_PROTOCOLS);
    if (!apiResult.valid) {
      errors.push({
        code: 'INVALID_API_PROTOCOL',
        message: `API endpoint must use http: or https: protocol${apiResult.actual ? `, got ${apiResult.actual}` : ', got invalid URL'}`,
        field: 'apiEndpoint',
      });
    }
  }

  // Validate WebSocket endpoint. Demo mode never opens a socket — the realtime
  // hook already falls back to HTTP polling when `wsEndpoint` is empty or fails
  // validation, which is exactly the behavior the public demo relies on. The
  // configuration gate must therefore treat an empty WS endpoint as normal in
  // demo mode, not as a blocking error.
  if (!rawWsEndpoint || rawWsEndpoint.trim() === '') {
    if (apiMode !== 'demo') {
      errors.push({
        code: 'MISSING_WS_ENDPOINT',
        message: 'VITE_WS_ENDPOINT is required but not configured',
        field: 'wsEndpoint',
      });
    }
  } else {
    const wsResult = validateProtocol(rawWsEndpoint, VALID_WS_PROTOCOLS);
    if (!wsResult.valid) {
      errors.push({
        code: 'INVALID_WS_PROTOCOL',
        message: `WebSocket endpoint must use ws: or wss: protocol${wsResult.actual ? `, got ${wsResult.actual}` : ', got invalid URL'}`,
        field: 'wsEndpoint',
      });
    }
  }

  // Validate environment
  const environment = parseEnvironment(rawEnvironment);
  if (!environment) {
    errors.push({
      code: 'INVALID_ENVIRONMENT',
      message: `VITE_APP_ENV must be one of: ${VALID_ENVIRONMENTS.join(', ')}`,
      field: 'environment',
    });
  }

  // Return result
  if (errors.length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    config: {
      apiEndpoint: rawApiEndpoint!.trim(),
      wsEndpoint: (rawWsEndpoint ?? '').trim(),
      environment: environment!,
      apiMode: apiMode!,
    },
  };
}

/**
 * Normalizes API endpoint by removing trailing slash.
 */
export function normalizeEndpoint(endpoint: string): string {
  return endpoint.replace(/\/+$/, '');
}
