/**
 * Application Root Component (§8, §16)
 *
 * React Router declarative routing with configuration validation.
 * Routes:
 *   /  - Dashboard
 *   *  - Not Found
 *
 * @module frontend/app
 */

import type { ReactNode } from 'react';
import { HashRouter, Routes, Route } from 'react-router-dom';
import { DashboardPage } from './pages/dashboard.js';
import { NotFoundPage } from './pages/not_found.js';
import { ConfigurationErrorScreen } from './components/system/configuration_error.js';
import { loadRuntimeConfig } from './config/runtime_config.js';
import { AppConfigProvider } from './state/app_context.js';

// ─── Application Context ───────────────────────────────────

export type { AppContextValue } from './state/app_context.js';

// ─── Main Application ──────────────────────────────────────

/**
 * Root application component.
 *
 * Validates configuration before rendering routes.
 * Renders configuration error screen if validation fails.
 */
export function App(): ReactNode {
  // Load and validate configuration
  const configResult = loadRuntimeConfig();

  // Render configuration error screen if validation fails
  if (!configResult.ok) {
    return <ConfigurationErrorScreen errors={configResult.errors} />;
  }

  // Configuration is valid; provide it to the routes and render. The router
  // is `HashRouter` so GitHub Pages, which refuses to serve `index.html`
  // for arbitrary refresh paths, never returns a 404 for deep links inside
  // the SPA. The `BrowserRouter` history version remains the production-shape
  // path; switching back is a single import swap.
  return (
    <AppConfigProvider config={configResult.config}>
      <HashRouter>
        <Routes>
          <Route path="/" element={<DashboardPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </HashRouter>
    </AppConfigProvider>
  );
}
