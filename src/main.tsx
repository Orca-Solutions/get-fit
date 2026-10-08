import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { getProfile } from './db/repo';
import { startAutoSync } from './lib/sync';
import './styles.css';

registerSW({ immediate: true });

async function boot() {
  // Ask iOS/Chrome not to evict our data. Home-screen apps are exempt anyway; this is belt and braces.
  navigator.storage?.persist?.().catch(() => {});
  // Render straight away: syncing and planning run from App, so weak signal or a planning error never
  // leaves a blank screen.
  await getProfile().catch(() => {});
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </StrictMode>,
  );
  startAutoSync();
}

boot();
