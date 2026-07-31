/**
 * Dashboard Page
 *
 * Main dashboard route component wrapping the shell.
 *
 * @module frontend/pages/dashboard
 */

import type { ReactNode } from 'react';
import { DashboardShell } from '../layout/dashboard_shell.js';

/**
 * Dashboard page component.
 * Renders at the root route '/'.
 */
export function DashboardPage(): ReactNode {
  return <DashboardShell />;
}
