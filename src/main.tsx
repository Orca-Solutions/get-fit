import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { registerSW } from 'virtual:pwa-register';
import App from './App';
import { ensurePlan, getProfile } from './db/repo';
import { syncNow } from './lib/sync';
import './styles.css';

registerSW({ immediate: true });

async function boot() {
  // Ask iOS/Chrome not to evict our data. Home-screen apps are exempt anyway; this is belt and braces.
  navigator.storage?.persist?.().catch(() => {});
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
  window.addEventListener('online', () => syncNow());
  document.addEventListener('visibilitychange', () => document.visibilityState === 'visible' && syncNow());
}

boot();
