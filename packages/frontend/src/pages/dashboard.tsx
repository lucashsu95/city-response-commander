/**
 * Dashboard Page
 *
 * Main dashboard route component. Owns the realtime connection lifecycle
 * (§13, §16.4) and feeds its connection mode into the operational status bar.
 *
 * @module frontend/pages/dashboard
 */

import type { ReactNode } from 'react';
import { DashboardShell } from '../layout/dashboard_shell.js';
import { useRealtimeConnection } from '../realtime/use_realtime.js';
import { useAppConfig } from '../state/app_context.js';

/**
 * Dashboard page component.
 * Renders at the root route '/'.
 *
 * The realtime client starts once for the page lifetime using the validated
 * runtime configuration and is disposed on unmount.
 */
export function DashboardPage(): ReactNode {
  const config = useAppConfig();
  const realtime = useRealtimeConnection({
    apiEndpoint: config.apiEndpoint,
    wsEndpoint: config.wsEndpoint,
  });

  return (
    <DashboardShell
      connectionMode={realtime.connectionMode}
      pollingErrorMessage={realtime.pollingErrorMessage}
      pollingUpdateCount={realtime.pollingUpdateCount}
    />
  );
}
