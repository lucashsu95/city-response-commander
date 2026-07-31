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
export type AppEnvironment = 'LOCAL_MOCK' | 'COMPETITION_AWS' | 'TEST';

/** Parsed runtime configuration */
export interface RuntimeConfig {
  /** HTTP API base endpoint (http: or https:) */
  readonly apiEndpoint: string;
  /** WebSocket endpoint (ws: or wss:) */
  readonly wsEndpoint: string;
  /** Current environment profile */
  readonly environment: AppEnvironment;
}

/** Configuration error types */
export type RuntimeConfigErrorCode =
  | 'MISSING_API_ENDPOINT'
  | 'MISSING_WS_ENDPOINT'
  | 'INVALID_API_PROTOCOL'
  | 'INVALID_WS_PROTOCOL'
  | 'INVALID_ENVIRONMENT';

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
const VALID_ENVIRONMENTS: readonly AppEnvironment[] = ['LOCAL_MOCK', 'COMPETITION_AWS', 'TEST'];

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

  // Validate WebSocket endpoint
  if (!rawWsEndpoint || rawWsEndpoint.trim() === '') {
    errors.push({
      code: 'MISSING_WS_ENDPOINT',
      message: 'VITE_WS_ENDPOINT is required but not configured',
      field: 'wsEndpoint',
    });
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
      wsEndpoint: rawWsEndpoint!.trim(),
      environment: environment!,
    },
  };
}

/**
 * Normalizes API endpoint by removing trailing slash.
 */
export function normalizeEndpoint(endpoint: string): string {
  return endpoint.replace(/\/+$/, '');
}
