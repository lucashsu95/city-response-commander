/**
 * Application Configuration Context (§4.9, §16)
 *
 * Distributes the already-validated runtime configuration to routed
 * components. Values originate from `config/runtime_config.ts`, which stays the
 * frontend's only environment reader; nothing here reads `import.meta.env`.
 *
 * @module frontend/state/app_context
 */

import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import type { RuntimeConfig } from '../config/runtime_config.js';

/** Application context value provided to child components. */
export interface AppContextValue {
  readonly config: RuntimeConfig;
}

const AppConfigContext = createContext<AppContextValue | null>(null);

export interface AppConfigProviderProps {
  /** Validated runtime configuration. */
  readonly config: RuntimeConfig;
  readonly children: ReactNode;
}

/**
 * Provides validated runtime configuration to the routed application.
 */
export function AppConfigProvider({ config, children }: AppConfigProviderProps): ReactNode {
  const value = useMemo<AppContextValue>(() => ({ config }), [config]);
  return <AppConfigContext.Provider value={value}>{children}</AppConfigContext.Provider>;
}

/**
 * Reads the validated runtime configuration.
 *
 * @throws when used outside {@link AppConfigProvider}, which would mean the
 *         configuration gate was bypassed.
 */
export function useAppConfig(): RuntimeConfig {
  const value = useContext(AppConfigContext);
  if (value === null) {
    throw new Error('useAppConfig 必須在 AppConfigProvider 內使用');
  }
  return value.config;
}
