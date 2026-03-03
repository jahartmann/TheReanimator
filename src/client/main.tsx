/**
 * React SPA entry point.
 * Initializes i18n before rendering the app to prevent translation flicker.
 */

import React from 'react';
import ReactDOM from 'react-dom/client';
import { initPromise } from './i18n';

// Global styles — must be imported at the top level for Vite to process
import '../app/globals.css';

async function bootstrap() {
  // Wait for i18n to initialize (language detection + resource loading)
  await initPromise;

  const { default: App } = await import('./App');

  const root = document.getElementById('root');
  if (!root) {
    console.error('[Bootstrap] #root element not found in DOM');
    return;
  }

  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
}

bootstrap().catch((err) => {
  console.error('[Bootstrap] Fatal error during app startup:', err);
  const root = document.getElementById('root');
  if (root) {
    root.innerHTML = `
      <div style="min-height:100vh;display:flex;align-items:center;justify-content:center;font-family:sans-serif;background:#09090b;color:#fafafa;">
        <div style="text-align:center;padding:2rem;">
          <h1 style="font-size:1.5rem;font-weight:700;margin-bottom:0.5rem;">Reanimator &mdash; Startup Error</h1>
          <pre style="background:#18181b;padding:1rem;border-radius:0.5rem;font-size:0.8rem;text-align:left;max-width:600px;overflow:auto;">${String(err)}</pre>
        </div>
      </div>`;
  }
});
