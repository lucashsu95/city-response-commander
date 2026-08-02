/**
 * Application State Model (§16.4)
 *
 * Frontend-only presentation state types.
 * Display backend-provided values only; no deterministic calculation.
 *
 * @module frontend/state/app_state
 */

// ─── Async Presentation State ──────────────────────────────

/**
 * Presentation state for async data regions.
 *
 * - idle: no request initiated
 * - loading: request in progress
 * - ready: data loaded successfully
 * - empty: data loaded but contains no items
 * - error: request failed
 * - insufficient_data: data loaded but incomplete for rendering
 */
export type AsyncStatus = 'idle' | 'loading' | 'ready' | 'empty' | 'error' | 'insufficient_data';

/**
 * Generic async state wrapper for region data.
 */
export interface AsyncState<T> {
  readonly status: AsyncStatus;
  readonly data: T | null;
  readonly errorMessage: string | null;
}

/**
 * Creates initial idle state.
 */
export function createIdleState<T>(): AsyncState<T> {
  return { status: 'idle', data: null, errorMessage: null };
}

/**
 * Creates loading state.
 */
export function createLoadingState<T>(): AsyncState<T> {
  return { status: 'loading', data: null, errorMessage: null };
}

/**
 * Creates ready state with data.
 */
export function createReadyState<T>(data: T): AsyncState<T> {
  return { status: 'ready', data, errorMessage: null };
}

/**
 * Creates empty state (data loaded but no items).
 */
export function createEmptyState<T>(): AsyncState<T> {
  return { status: 'empty', data: null, errorMessage: null };
}

/**
 * Creates error state.
 */
export function createErrorState<T>(errorMessage: string): AsyncState<T> {
  return { status: 'error', data: null, errorMessage };
}

/**
 * Creates insufficient data state.
 */
export function createInsufficientDataState<T>(): AsyncState<T> {
  return { status: 'insufficient_data', data: null, errorMessage: null };
}

// ─── Operational Status Flags ──────────────────────────────

/**
 * Connection mode for real-time updates.
 * Display-only; frontend does not compute fallback behavior.
 */
export type ConnectionMode = 'websocket' | 'polling' | 'disconnected';

/**
 * Backend-provided operational status flags.
 * Frontend displays these values without calculation.
 */
export interface OperationalStatus {
  /**
   * Data is stale (backend-provided flag).
   * Frontend does not calculate staleness from timestamps.
   */
  readonly isStale: boolean;

  /**
   * Staleness duration in minutes (backend-provided).
   * Only meaningful when isStale is true.
   */
  readonly stalenessMinutes: number | null;

  /**
   * Current connection mode (backend/system-provided).
   */
  readonly connectionMode: ConnectionMode;

  /**
   * Policy is provisional (backend-provided flag).
   * Frontend does not infer provisional status.
   */
  readonly isProvisionalPolicy: boolean;

  /**
   * Manual confirmation required (backend-provided flag).
   * Frontend does not infer manual confirmation requirement.
   */
  readonly manualConfirmationRequired: boolean;
}

/**
 * Creates default operational status (no issues).
 */
export function createDefaultOperationalStatus(): OperationalStatus {
  return {
    isStale: false,
    stalenessMinutes: null,
    connectionMode: 'disconnected',
    isProvisionalPolicy: false,
    manualConfirmationRequired: false,
  };
}

// ─── Configuration Error State ─────────────────────────────

/**
 * Application-level configuration error.
 * Renders accessible error screen instead of crashing.
 */
export interface ConfigurationErrorState {
  readonly hasConfigurationError: true;
  readonly errors: readonly {
    readonly code: string;
    readonly message: string;
    readonly field: string;
  }[];
}

/**
 * Application ready to render.
 */
export interface ConfigurationReadyState {
  readonly hasConfigurationError: false;
}

/**
 * Top-level application configuration state.
 */
export type AppConfigState = ConfigurationErrorState | ConfigurationReadyState;
