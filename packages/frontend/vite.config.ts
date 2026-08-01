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
  // The frontend is hosted on a CloudFront distribution at the domain root
  // (no `/<repo>/` prefix), so `base` is `/`. Production-style asset URLs
  // resolve to `/assets/...` and work under the CloudFront root domain. The
  // router stays `HashRouter` so deep-link refreshes inside the SPA continue
  // to work without relying on CloudFront SPA fallback for client routes.
  base: '/',
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
