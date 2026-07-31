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
