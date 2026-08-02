/**
 * Application Entry Point
 *
 * Mounts the React application to the DOM.
 *
 * @module frontend/main
 */

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app.js';
import 'leaflet/dist/leaflet.css';
import './styles/global.css';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element not found. Ensure index.html contains <div id="root"></div>');
}

const root = createRoot(rootElement);

root.render(
  <StrictMode>
    <App />
  </StrictMode>
);
