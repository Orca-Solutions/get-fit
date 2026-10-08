import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { ensurePlan, getProfile } from './db/repo';
import { startAutoSync, syncNow } from './lib/sync';
import './styles.css';

registerSW({ immediate: true });

async function boot() {
  // Ask iOS/Chrome not to evict our data. Home-screen apps are exempt anyway; this is belt and braces.
  navigator.storage?.persist?.().catch(() => {});
  // Pull before planning, so a device never generates a block from stale data.
  await syncNow().catch(() => {});
  await getProfile();
  await ensurePlan();
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
