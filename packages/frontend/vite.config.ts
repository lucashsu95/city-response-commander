/**
 * Vite Configuration
 *
 * Build configuration for the React/TS SPA.
 *
 * @module frontend/vite.config
 */

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // GitHub Pages is mounted at `/<repo>/` when the project's repository name
  // drives the user page; the workflow that publishes the demo frontend
  // uploads `packages/frontend/dist` from this same path. Without `base`,
  // production-mode URLs (`/assets/…`) 404 once the SPA is served under
  // `/city-response-commander/`. The router has been switched to
  // `HashRouter` to keep deep-link refreshes working on Pages.
  base: '/city-response-commander/',
  build: {
    outDir: 'dist',
    sourcemap: true,
    target: 'es2022',
  },
  server: {
    port: 3000,
    strictPort: false,
  },
  preview: {
    port: 3000,
  },
});
