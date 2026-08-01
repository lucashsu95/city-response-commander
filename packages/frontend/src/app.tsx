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
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { DashboardPage } from './pages/dashboard.js';
import { NotFoundPage } from './pages/not_found.js';
import { ConfigurationErrorScreen } from './components/system/configuration_error.js';
import { loadRuntimeConfig } from './config/runtime_config.js';
import { AppConfigProvider } from './state/app_context.js';
import { LocaleProvider } from './i18n/index.js';

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
    return (
      <LocaleProvider>
        <ConfigurationErrorScreen errors={configResult.errors} />
      </LocaleProvider>
    );
  }

  // Configuration is valid; provide it to the routes and render
  return (
    <LocaleProvider>
      <AppConfigProvider config={configResult.config}>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<DashboardPage />} />
            <Route path="*" element={<NotFoundPage />} />
          </Routes>
        </BrowserRouter>
      </AppConfigProvider>
    </LocaleProvider>
  );
}
